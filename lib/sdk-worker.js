// DEPRECATED: This file has been moved to lib/yoke/adapters/claude-worker.js
// It is kept here temporarily for backward compatibility with running worker processes.
// New worker spawns use the path from adapter.workerScriptPath.
//
// sdk-worker.js — Standalone worker process for OS-level user isolation.
// Runs as a target Linux user, loads the Claude Agent SDK, and communicates
// with the main Clay daemon over a Unix domain socket using JSON lines.
//
// Usage: node sdk-worker.js <socket-path>

// Force IPv4-only for all child processes (including SDK CLI subprocess).
// Without this, Node 22+ happy eyeballs tries IPv6 first (10s timeout on
// servers without IPv6 outbound), causing massive cold-start delays.
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || "") + " --dns-result-order=ipv4first --no-network-family-autoselection";

// Early diagnostic — writes directly to fd 2 to ensure output even if pipes close fast
var _workerBootTs = Date.now();
try { require("fs").writeSync(2, "[sdk-worker] BOOT pid=" + process.pid + " uid=" + (typeof process.getuid === "function" ? process.getuid() : "?") + " argv=" + process.argv.slice(1).join(" ") + " bootTs=" + _workerBootTs + "\n"); } catch (e) {}

var net = require("net");
var crypto = require("crypto");
var path = require("path");

var socketPath = process.argv[2];
if (!socketPath) {
  console.error("[sdk-worker] Missing socket path argument");
  process.exit(1);
}

// --- State ---
var sdkModule = null;
var queryInstance = null;
var messageQueue = null;
var abortController = null;
var pendingPermissions = {};  // requestId -> resolve
var pendingAskUser = {};      // toolUseId -> resolve
var pendingElicitations = {}; // requestId -> resolve
var pendingMcpCalls = {};     // requestId -> { resolve, reject }
var conn = null;
var buffer = "";

// --- Message queue (same implementation as sdk-bridge.js) ---
function createMessageQueue() {
  var queue = [];
  var waiting = null;
  var ended = false;
  return {
    push: function(msg) {
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    end: function() {
      ended = true;
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: undefined, done: true });
      }
    },
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise(function(resolve) {
            waiting = resolve;
          });
        },
      };
    },
  };
}

// --- SDK loader ---
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
}

// --- IPC helpers ---
function sendToDaemon(msg) {
  if (!conn || conn.destroyed) return;
  try {
    conn.write(JSON.stringify(msg) + "\n");
  } catch (e) {
    console.error("[sdk-worker] Failed to send message:", e.message);
  }
}

function handleMessage(msg) {
  try { require("fs").writeSync(2, "[sdk-worker] MSG: " + msg.type + "\n"); } catch (e) {}
  switch (msg.type) {
    case "query_start":
      handleQueryStart(msg);
      break;
    case "push_message":
      handlePushMessage(msg);
      break;
    case "end_messages":
      if (messageQueue) messageQueue.end();
      break;
    case "abort":
      if (abortController) abortController.abort();
      break;
    case "set_model":
      handleSetModel(msg);
      break;
    case "set_effort":
      handleSetEffort(msg);
      break;
    case "set_permission_mode":
      handleSetPermissionMode(msg);
      break;
    case "stop_task":
      handleStopTask(msg);
      break;
    case "permission_response":
      handlePermissionResponse(msg);
      break;
    case "ask_user_response":
      handleAskUserResponse(msg);
      break;
    case "elicitation_response":
      handleElicitationResponse(msg);
      break;
    case "mcp_tool_result":
      handleMcpToolResult(msg);
      break;
    case "warmup":
      handleWarmup(msg);
      break;
    case "shutdown":
      gracefulExit(0);
      break;
    default:
      console.error("[sdk-worker] Unknown message type:", msg.type);
  }
}

// --- canUseTool: delegates to daemon via IPC ---
function canUseTool(toolName, input, opts) {
  var requestId = crypto.randomUUID();
  sendToDaemon({
    type: "permission_request",
    requestId: requestId,
    toolName: toolName,
    input: input,
    toolUseId: opts.toolUseID || "",
    decisionReason: opts.decisionReason || "",
  });
  return new Promise(function(resolve) {
    pendingPermissions[requestId] = resolve;
    if (opts.signal) {
      opts.signal.addEventListener("abort", function() {
        delete pendingPermissions[requestId];
        resolve({ behavior: "deny", message: "Cancelled" });
      });
    }
  });
}

// --- onElicitation: delegates to daemon via IPC ---
function onElicitation(request, opts) {
  var requestId = crypto.randomUUID();
  sendToDaemon({
    type: "elicitation_request",
    requestId: requestId,
    serverName: request.serverName,
    message: request.message,
    mode: request.mode || "form",
    url: request.url || null,
    elicitationId: request.elicitationId || null,
    requestedSchema: request.requestedSchema || null,
  });
  return new Promise(function(resolve) {
    pendingElicitations[requestId] = resolve;
    if (opts.signal) {
      opts.signal.addEventListener("abort", function() {
        delete pendingElicitations[requestId];
        resolve({ action: "cancel" });
      });
    }
  });
}

function handlePermissionResponse(msg) {
  var resolve = pendingPermissions[msg.requestId];
  if (resolve) {
    delete pendingPermissions[msg.requestId];
    resolve(msg.result);
  }
}

function handleAskUserResponse(msg) {
  var resolve = pendingAskUser[msg.toolUseId];
  if (resolve) {
    delete pendingAskUser[msg.toolUseId];
    resolve(msg.result);
  }
}

function handleElicitationResponse(msg) {
  var resolve = pendingElicitations[msg.requestId];
  if (resolve) {
    delete pendingElicitations[msg.requestId];
    resolve(msg.result);
  }
}

function handleMcpToolResult(msg) {
  var pending = pendingMcpCalls[msg.requestId];
  if (!pending) return;
  delete pendingMcpCalls[msg.requestId];
  if (msg.error) {
    pending.reject(new Error(msg.error));
  } else {
    pending.resolve(msg.result);
  }
}

// Reconstruct MCP servers from serializable descriptors with IPC-proxied handlers.
// Each tool call is forwarded to the daemon which has the real MCP server instances.
function buildMcpServersFromDescriptors(sdk, descriptors) {
  if (!descriptors || descriptors.length === 0) return null;
  var z;
  try { z = require("zod").z; } catch (e) {
    try { z = require("zod"); } catch (e2) {
      console.error("[sdk-worker] Failed to load zod for MCP reconstruction:", e2.message);
      return null;
    }
  }
  var createSdkMcpServer = sdk.createSdkMcpServer;
  var toolFn = sdk.tool;
  if (!createSdkMcpServer || !toolFn) {
    console.error("[sdk-worker] SDK missing createSdkMcpServer or tool helper");
    return null;
  }

  var servers = {};
  for (var i = 0; i < descriptors.length; i++) {
    var desc = descriptors[i];
    var tools = [];
    for (var j = 0; j < desc.tools.length; j++) {
      var td = desc.tools[j];
      var shape = buildZodShape(z, td.inputSchema);
      tools.push(toolFn(
        td.name,
        td.description || td.name,
        shape,
        createMcpProxyHandler(desc.serverName, td.name)
      ));
    }
    if (tools.length > 0) {
      servers[desc.serverName] = createSdkMcpServer({
        name: desc.serverName,
        version: "1.0.0",
        tools: tools,
      });
    }
  }
  return Object.keys(servers).length > 0 ? servers : null;
}

function createMcpProxyHandler(serverName, toolName) {
  return function(args) {
    return new Promise(function(resolve, reject) {
      var requestId = "mcp_" + Date.now() + "_" + crypto.randomUUID().slice(0, 8);
      pendingMcpCalls[requestId] = { resolve: resolve, reject: reject };
      sendToDaemon({
        type: "mcp_tool_call",
        requestId: requestId,
        serverName: serverName,
        toolName: toolName,
        args: args,
      });
    });
  };
}

// Build a Zod shape from MCP JSON Schema inputSchema (mirrors project-mcp.js logic)
function buildZodShape(z, inputSchema) {
  if (!inputSchema || !inputSchema.properties) return {};
  var shape = {};
  var props = inputSchema.properties;
  var required = inputSchema.required || [];
  var keys = Object.keys(props);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var p = props[k];
    var field;
    if (p.type === "number" || p.type === "integer") {
      field = z.number();
    } else if (p.type === "boolean") {
      field = z.boolean();
    } else if (p.type === "array") {
      field = z.array(z.any());
    } else if (p.type === "object") {
      field = z.record(z.any());
    } else if (p.enum) {
      field = z.enum(p.enum);
    } else {
      field = z.string();
    }
    if (p.description) field = field.describe(p.description);
    if (required.indexOf(k) === -1) field = field.optional();
    shape[k] = field;
  }
  return shape;
}

// --- Query handling ---
async function handleQueryStart(msg) {
  var t0 = msg._perfT0 || Date.now();
  var localT0 = Date.now();
  function perf(label) { console.log("[PERF] sdk-worker: " + label + " +" + (Date.now() - t0) + "ms (local +" + (Date.now() - localT0) + "ms)"); }
  perf("handleQueryStart entered");

  var sdk;
  try {
    perf("loading SDK");
    sdk = await getSDK();
    perf("SDK loaded");
  } catch (e) {
    sendToDaemon({ type: "query_error", error: "Failed to load SDK: " + (e.message || e), exitCode: null, stderr: null });
    return;
  }

  messageQueue = createMessageQueue();
  abortController = new AbortController();

  // Push the initial user message
  if (msg.prompt) {
    messageQueue.push(msg.prompt);
  }

  // Reconstruct MCP servers from serializable descriptors (IPC-proxied handlers)
  if (msg.mcpDescriptors) {
    var _mcpServers = buildMcpServersFromDescriptors(sdk, msg.mcpDescriptors);
    if (_mcpServers) {
      perf("MCP servers reconstructed from descriptors (" + Object.keys(_mcpServers).length + " servers)");
    }
  }

  // Build query options (callbacks are local, everything else from daemon)
  var options = msg.options || {};
  if (_mcpServers) options.mcpServers = _mcpServers;
  options.abortController = abortController;
  options.debug = true;
  options.debugFile = "/tmp/clay-cli-debug-" + process.pid + ".log";
  // Override CLI subprocess spawn to inject NODE_OPTIONS for IPv4-first DNS.
  // The SDK constructs its own env for the CLI process, so worker env vars
  // like NODE_OPTIONS are not inherited. We intercept the spawn to fix this.
  options.spawnClaudeCodeProcess = function(spawnOpts) {
    // Force IPv4-only at every level: preload script patches dns.lookup to
    // only return IPv4, disables autoSelectFamily, and sets ipv4first order.
    // This is needed because the CLI's Axios-based HTTP client ignores
    // NODE_OPTIONS dns flags and still attempts IPv6 connections via its
    // custom TLS agent, causing 5-10s timeouts on IPv6-less servers.
    var preloadScript = require("path").join(__dirname, "ipv4-only.js");
    var extraOpts = " --require " + JSON.stringify(preloadScript);
    extraOpts += " --dns-result-order=ipv4first --no-network-family-autoselection";
    spawnOpts.env.NODE_OPTIONS = (spawnOpts.env.NODE_OPTIONS || "") + extraOpts;
    console.log("[sdk-worker] spawnClaudeCodeProcess called, command=" + spawnOpts.command);
    var cp = require("child_process").spawn(spawnOpts.command, spawnOpts.args, {
      cwd: spawnOpts.cwd,
      env: spawnOpts.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Capture ALL CLI stderr
    if (cp.stderr) {
      cp.stderr.on("data", function(chunk) {
        var lines = chunk.toString().split("\n");
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (line) console.log("[CLI-STDERR] " + line.substring(0, 500));
        }
      });
    }
    return cp;
  };
  options.canUseTool = function(toolName, input, toolOpts) {
    // AskUserQuestion is handled specially: we send it as a separate IPC type
    // so the daemon can use its own AskUserQuestion handling logic
    if (toolName === "AskUserQuestion") {
      var toolUseId = toolOpts.toolUseID || "";
      sendToDaemon({
        type: "ask_user_request",
        toolUseId: toolUseId,
        input: input,
      });
      return new Promise(function(resolve) {
        pendingAskUser[toolUseId] = resolve;
        if (toolOpts.signal) {
          toolOpts.signal.addEventListener("abort", function() {
            delete pendingAskUser[toolUseId];
            resolve({ behavior: "deny", message: "Cancelled" });
          });
        }
      });
    }
    return canUseTool(toolName, input, toolOpts);
  };
  options.onElicitation = function(request, elicitOpts) {
    return onElicitation(request, elicitOpts);
  };

  perf("creating query instance");
  try {
    queryInstance = sdk.query({
      prompt: messageQueue,
      options: options,
    });
    perf("query instance created");
  } catch (e) {
    sendToDaemon({ type: "query_error", error: "Failed to create query: " + (e.message || e), exitCode: null, stderr: null });
    queryInstance = null;
    messageQueue = null;
    abortController = null;
    return;
  }

  // If single-turn, end the message queue immediately
  if (msg.singleTurn) {
    messageQueue.end();
  }

  // Stream events to daemon
  try {
    var firstEvent = true;
    var firstText = true;
    var eventCounts = {};
    for await (var event of queryInstance) {
      var etype = (event && event.type || "?");
      var esubtype = (event && event.subtype || "");
      eventCounts[etype] = (eventCounts[etype] || 0) + 1;
      if (firstEvent) {
        perf("FIRST event from SDK (type=" + etype + " subtype=" + esubtype + ")");
        firstEvent = false;
      }
      // Log every non-content event, and the first content/text event
      if (etype !== "content_block_delta" && etype !== "content_block_start" && etype !== "content_block_stop") {
        var extraInfo = "";
        if (esubtype === "api_retry") {
          // Dump full event to see all available fields
          try {
            var retryDump = JSON.stringify(event, function(k, v) {
              if (typeof v === "string" && v.length > 200) return v.substring(0, 200) + "...[truncated]";
              return v;
            });
            extraInfo = " FULL=" + retryDump;
          } catch (je) {
            extraInfo = " keys=" + Object.keys(event).join(",");
          }
        }
        perf("SDK event #" + eventCounts[etype] + " type=" + etype + " subtype=" + esubtype + extraInfo);
      }
      if (firstText && (etype === "content_block_delta" || etype === "assistant" || (etype === "content_block_start"))) {
        perf("FIRST TEXT/CONTENT event (type=" + etype + " subtype=" + esubtype + ")");
        firstText = false;
      }
      sendToDaemon({ type: "sdk_event", event: event });
    }
    perf("all events streamed (counts=" + JSON.stringify(eventCounts) + "), fetching context usage");
    // Fetch context usage breakdown before queryInstance is cleared
    try {
      if (queryInstance && typeof queryInstance.getContextUsage === "function") {
        var ctxUsage = await queryInstance.getContextUsage();
        sendToDaemon({ type: "context_usage", data: ctxUsage });
        perf("context usage sent");
      }
    } catch (e) {
      // Non-fatal: SDK may have already shut down
      console.error("[sdk-worker] getContextUsage failed (non-fatal):", e.message);
    }
    perf("sending query_done");
    sendToDaemon({ type: "query_done" });
  } catch (err) {
    var errMsg = err.message || String(err);
    sendToDaemon({
      type: "query_error",
      error: errMsg,
      exitCode: err.exitCode != null ? err.exitCode : null,
      stderr: err.stderr || null,
    });
  } finally {
    queryInstance = null;
    messageQueue = null;
    abortController = null;
    pendingPermissions = {};
    pendingAskUser = {};
    pendingElicitations = {};
  }
}

function handlePushMessage(msg) {
  if (!messageQueue) return;
  messageQueue.push(msg.content);
}

async function handleSetModel(msg) {
  if (!queryInstance) return;
  try {
    await queryInstance.setModel(msg.model);
    sendToDaemon({ type: "model_changed", model: msg.model });
  } catch (e) {
    sendToDaemon({ type: "worker_error", error: "Failed to set model: " + (e.message || e) });
  }
}

async function handleSetEffort(msg) {
  if (!queryInstance) return;
  try {
    await queryInstance.setEffort(msg.effort);
    sendToDaemon({ type: "effort_changed", effort: msg.effort });
  } catch (e) {
    sendToDaemon({ type: "worker_error", error: "Failed to set effort: " + (e.message || e) });
  }
}

async function handleSetPermissionMode(msg) {
  if (!queryInstance) return;
  try {
    await queryInstance.setPermissionMode(msg.mode);
    sendToDaemon({ type: "permission_mode_changed", mode: msg.mode });
  } catch (e) {
    sendToDaemon({ type: "worker_error", error: "Failed to set permission mode: " + (e.message || e) });
  }
}

async function handleStopTask(msg) {
  if (!queryInstance) return;
  try {
    await queryInstance.stopTask(msg.taskId);
  } catch (e) {
    console.error("[sdk-worker] stopTask error:", e.message);
  }
  // Also abort as fallback (matches daemon behavior)
  if (abortController) {
    abortController.abort();
  }
}

// --- Warmup ---
async function handleWarmup(msg) {
  var sdk;
  try {
    sdk = await getSDK();
  } catch (e) {
    sendToDaemon({ type: "warmup_error", error: "Failed to load SDK: " + (e.message || e) });
    return;
  }

  var ac = new AbortController();
  var mq = createMessageQueue();
  mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
  mq.end();

  var warmupOptions = msg.options || {};
  warmupOptions.abortController = ac;

  try {
    var stream = sdk.query({
      prompt: mq,
      options: warmupOptions,
    });

    for await (var event of stream) {
      if (event.type === "system" && event.subtype === "init") {
        var result = {
          slashCommands: event.slash_commands || [],
          model: event.model || "",
          skills: event.skills || [],
          fastModeState: event.fast_mode_state || null,
        };

        // Fetch available models before aborting
        try {
          var models = await stream.supportedModels();
          result.models = models || [];
        } catch (e) {
          result.models = [];
        }

        sendToDaemon({ type: "warmup_done", result: result });
        ac.abort();
        break;
      }
    }
  } catch (e) {
    if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
      sendToDaemon({ type: "warmup_error", error: "Warmup failed: " + (e.message || e) });
    }
  }
}

// --- Cleanup ---
var _exitScheduled = false;
function cleanup() {
  if (_keepAlive) {
    try { clearInterval(_keepAlive); } catch (e) {}
  }
  if (abortController) {
    try { abortController.abort(); } catch (e) {}
  }
  if (messageQueue) {
    try { messageQueue.end(); } catch (e) {}
  }
  if (conn && !conn.destroyed) {
    try { conn.end(); } catch (e) {}
  }
}

// Exit with a grace period so the SDK can flush session state to disk.
// Without this, process.exit(0) kills pending async writes and the
// session file may be incomplete, causing "no conversation found" on resume.
function gracefulExit(code) {
  if (_exitScheduled) return;
  _exitScheduled = true;
  cleanup();
  setTimeout(function() { process.exit(code); }, 800);
}

// Keep event loop alive — without this, Node may exit if the socket handle
// gets unreferenced (observed on Linux with uid/gid spawn)
var _keepAlive = setInterval(function() {}, 30000);

// --- Connect to daemon socket ---
try { require("fs").writeSync(2, "[sdk-worker] Connecting to socket: " + socketPath + " +" + (Date.now() - _workerBootTs) + "ms since boot\n"); } catch (e) {}
conn = net.connect(socketPath, function() {
  try { require("fs").writeSync(2, "[sdk-worker] Connected, sending ready +" + (Date.now() - _workerBootTs) + "ms since boot\n"); } catch (e) {}
  sendToDaemon({ type: "ready" });
});

conn.on("data", function(chunk) {
  buffer += chunk.toString();
  var lines = buffer.split("\n");
  buffer = lines.pop(); // keep incomplete line in buffer
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      var msg = JSON.parse(lines[i]);
      handleMessage(msg);
    } catch (e) {
      console.error("[sdk-worker] Failed to parse message:", e.message);
    }
  }
});

conn.on("error", function(err) {
  console.error("[sdk-worker] Socket error:", err.message);
  gracefulExit(1);
});

conn.on("close", function() {
  try { require("fs").writeSync(2, "[sdk-worker] EXIT REASON: socket closed\n"); } catch (e) {}
  gracefulExit(0);
});

// Handle process signals
process.on("SIGTERM", function() {
  try { require("fs").writeSync(2, "[sdk-worker] EXIT REASON: SIGTERM\n"); } catch (e) {}
  gracefulExit(0);
});

process.on("SIGINT", function() {
  try { require("fs").writeSync(2, "[sdk-worker] EXIT REASON: SIGINT\n"); } catch (e) {}
  gracefulExit(0);
});
