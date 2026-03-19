const crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var os = require("os");
var net = require("net");
var { execSync, spawn } = require("child_process");
var { resolveOsUserInfo } = require("./os-users");
var usersModule = require("./users");

// Async message queue for streaming input to SDK
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

function createSDKBridge(opts) {
  var cwd = opts.cwd;
  var slug = opts.slug || "";
  var sm = opts.sessionManager;   // session manager instance
  var send = opts.send;           // broadcast to all clients
  var pushModule = opts.pushModule;
  var getSDK = opts.getSDK;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var onProcessingChanged = opts.onProcessingChanged || function () {};


  // --- Skill discovery helpers ---

  function discoverSkillDirs() {
    var skills = {};
    var dirs = [
      path.join(os.homedir(), ".claude", "skills"),
      path.join(cwd, ".claude", "skills"),
    ];
    for (var d = 0; d < dirs.length; d++) {
      var base = dirs[d];
      var entries;
      try {
        entries = fs.readdirSync(base, { withFileTypes: true });
      } catch (e) {
        continue; // directory doesn't exist
      }
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        var skillDir = path.join(base, entry.name);
        var skillMd = path.join(skillDir, "SKILL.md");
        try {
          fs.accessSync(skillMd, fs.constants.R_OK);
          // project skills override global skills with same name
          skills[entry.name] = skillDir;
        } catch (e) {
          // no SKILL.md, skip
        }
      }
    }
    return skills;
  }

  function mergeSkills(sdkSkills, fsSkills) {
    var merged = new Set();
    if (Array.isArray(sdkSkills)) {
      for (var i = 0; i < sdkSkills.length; i++) {
        merged.add(sdkSkills[i]);
      }
    }
    var fsNames = Object.keys(fsSkills);
    for (var i = 0; i < fsNames.length; i++) {
      merged.add(fsNames[i]);
    }
    return merged;
  }

  function sendAndRecord(session, obj) {
    sm.sendAndRecord(session, obj);
  }

  function processSDKMessage(session, parsed) {
    // Extract session_id from any message that carries it
    if (parsed.session_id && !session.cliSessionId) {
      session.cliSessionId = parsed.session_id;
      sm.saveSessionFile(session);
      sendAndRecord(session, { type: "session_id", cliSessionId: session.cliSessionId });
    } else if (parsed.session_id) {
      session.cliSessionId = parsed.session_id;
    }

    // Capture message UUIDs for rewind support
    if (parsed.uuid) {
      if (parsed.type === "user" && !parsed.parent_tool_use_id) {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "user", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "user" });
      } else if (parsed.type === "assistant") {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "assistant", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "assistant" });
      }
    }

    // Cache slash_commands and model from CLI init message
    if (parsed.type === "system" && parsed.subtype === "init") {
      var fsSkills = discoverSkillDirs();
      sm.skillNames = mergeSkills(parsed.skills, fsSkills);
      if (parsed.slash_commands) {
        // Union: SDK slash_commands + merged skills (deduplicated)
        var seen = new Set();
        var combined = [];
        var all = parsed.slash_commands.concat(Array.from(sm.skillNames));
        for (var k = 0; k < all.length; k++) {
          if (!seen.has(all[k])) {
            seen.add(all[k]);
            combined.push(all[k]);
          }
        }
        sm.slashCommands = combined;
        send({ type: "slash_commands", commands: sm.slashCommands });
      }
      if (parsed.model) {
        sm.currentModel = sm._savedDefaultModel || parsed.model;
        send({ type: "model_info", model: sm.currentModel, models: sm.availableModels || [] });
      }
      if (parsed.fast_mode_state) {
        sendAndRecord(session, { type: "fast_mode_state", state: parsed.fast_mode_state });
      }
    }

    if (parsed.type === "stream_event" && parsed.event) {
      var evt = parsed.event;

      if (evt.type === "message_start" && evt.message && evt.message.usage) {
        var u = evt.message.usage;
        session.lastStreamInputTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
      }

      if (evt.type === "content_block_start") {
        var block = evt.content_block;
        var idx = evt.index;

        if (block.type === "tool_use") {
          session.blocks[idx] = { type: "tool_use", id: block.id, name: block.name, inputJson: "" };
          sendAndRecord(session, { type: "tool_start", id: block.id, name: block.name });
        } else if (block.type === "thinking") {
          session.blocks[idx] = { type: "thinking", thinkingText: "", startTime: Date.now() };
          sendAndRecord(session, { type: "thinking_start" });
        } else if (block.type === "text") {
          session.blocks[idx] = { type: "text" };
        }
      }

      if (evt.type === "content_block_delta" && evt.delta) {
        var idx = evt.index;

        if (evt.delta.type === "text_delta" && typeof evt.delta.text === "string") {
          session.streamedText = true;
          if (session.responsePreview.length < 200) {
            session.responsePreview += evt.delta.text;
          }
          // Accumulate text for mate DM response
          if (typeof session._mateDmResponseText === "string") {
            session._mateDmResponseText += evt.delta.text;
          }
          sendAndRecord(session, { type: "delta", text: evt.delta.text });
        } else if (evt.delta.type === "input_json_delta" && session.blocks[idx]) {
          session.blocks[idx].inputJson += evt.delta.partial_json;
        } else if (evt.delta.type === "thinking_delta" && session.blocks[idx]) {
          session.blocks[idx].thinkingText += evt.delta.thinking;
          sendAndRecord(session, { type: "thinking_delta", text: evt.delta.thinking });
        }
      }

      if (evt.type === "content_block_stop") {
        var idx = evt.index;
        var block = session.blocks[idx];

        if (block && block.type === "tool_use") {
          var input = {};
          try { input = JSON.parse(block.inputJson); } catch {}
          sendAndRecord(session, { type: "tool_executing", id: block.id, name: block.name, input: input });

          // Track active Task tools for sub-agent done detection
          if (block.name === "Task") {
            if (!session.activeTaskToolIds) session.activeTaskToolIds = {};
            session.activeTaskToolIds[block.id] = true;
          }

          if (pushModule && block.name === "AskUserQuestion" && input.questions) {
            var q = input.questions[0];
            pushModule.sendPush({
              type: "ask_user",
              slug: slug,
              title: "Claude has a question",
              body: q ? q.question : "Waiting for your response",
              tag: "claude-ask",
            });
          }
        } else if (block && block.type === "thinking") {
          var duration = block.startTime ? (Date.now() - block.startTime) / 1000 : 0;
          sendAndRecord(session, { type: "thinking_stop", duration: duration });
        }

        delete session.blocks[idx];
      }

    } else if ((parsed.type === "assistant" || parsed.type === "user") && parsed.message && parsed.message.content) {
      // Sub-agent messages: extract tool_use blocks for activity display
      if (parsed.parent_tool_use_id) {
        processSubagentMessage(session, parsed);
        return;
      }

      var content = parsed.message.content;

      // Fallback: if assistant text wasn't streamed via deltas, send it now
      if (parsed.type === "assistant" && !session.streamedText && Array.isArray(content)) {
        var assistantText = content
          .filter(function(c) { return c.type === "text"; })
          .map(function(c) { return c.text; })
          .join("");
        if (assistantText) {
          if (session.responsePreview.length < 200) {
            session.responsePreview += assistantText;
          }
          sendAndRecord(session, { type: "delta", text: assistantText });
        }
      }

      // Check for local slash command output in user messages
      if (parsed.type === "user") {
        var fullText = "";
        if (typeof content === "string") {
          fullText = content;
        } else if (Array.isArray(content)) {
          fullText = content
            .filter(function(c) { return c.type === "text"; })
            .map(function(c) { return c.text; })
            .join("\n");
        }
        if (fullText.indexOf("local-command-stdout") !== -1) {
          var m = fullText.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
          if (m) {
            sendAndRecord(session, { type: "slash_command_result", text: m[1].trim() });
          }
        }
      }

      if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (block.type === "tool_result" && !session.sentToolResults[block.tool_use_id]) {
            // Clear active Task tool when its result arrives
            if (session.activeTaskToolIds && session.activeTaskToolIds[block.tool_use_id]) {
              sendAndRecord(session, {
                type: "subagent_done",
                parentToolId: block.tool_use_id,
              });
              delete session.activeTaskToolIds[block.tool_use_id];
            }
            var resultText = "";
            var resultImages = [];
            if (typeof block.content === "string") {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .filter(function(c) { return c.type === "text"; })
                .map(function(c) { return c.text; })
                .join("\n");
              for (var ri = 0; ri < block.content.length; ri++) {
                var rc = block.content[ri];
                if (rc.type === "image" && rc.source) {
                  resultImages.push({
                    mediaType: rc.source.media_type,
                    data: rc.source.data,
                  });
                }
              }
            }
            session.sentToolResults[block.tool_use_id] = true;
            var toolResultMsg = {
              type: "tool_result",
              id: block.tool_use_id,
              content: resultText,
              is_error: block.is_error || false,
            };
            if (resultImages.length > 0) toolResultMsg.images = resultImages;
            sendAndRecord(session, toolResultMsg);
          }
        }
      }

    } else if (parsed.type === "result") {
      session.blocks = {};
      session.sentToolResults = {};
      session.pendingPermissions = {};
      session.pendingElicitations = {};
      // Record ask_user_answered for any leftover pending questions so replay pairs correctly
      var leftoverAskIds = Object.keys(session.pendingAskUser);
      for (var lai = 0; lai < leftoverAskIds.length; lai++) {
        sendAndRecord(session, { type: "ask_user_answered", toolId: leftoverAskIds[lai] });
      }
      session.pendingAskUser = {};
      session.activeTaskToolIds = {};
      session.taskIdMap = {};
      session.isProcessing = false;
      onProcessingChanged();
      var lastStreamInput = session.lastStreamInputTokens || null;
      session.lastStreamInputTokens = null;
      sendAndRecord(session, {
        type: "result",
        cost: parsed.total_cost_usd,
        duration: parsed.duration_ms,
        usage: parsed.usage || null,
        modelUsage: parsed.modelUsage || null,
        sessionId: parsed.session_id,
        lastStreamInputTokens: lastStreamInput,
      });
      if (parsed.fast_mode_state) {
        sendAndRecord(session, { type: "fast_mode_state", state: parsed.fast_mode_state });
      }
      // Detect "Not logged in · Please run /login" from SDK.
      // This is a short canned response with zero cost, not actual AI output.
      var previewTrimmed = (session.responsePreview || "").trim();
      var isZeroCost = !parsed.total_cost_usd || parsed.total_cost_usd === 0;
      var isLoginPrompt = isZeroCost && previewTrimmed.length < 100
        && /not logged in/i.test(previewTrimmed) && /\/login/i.test(previewTrimmed);
      if (isLoginPrompt) {
        var authUser = session.ownerId ? usersModule.findUserById(session.ownerId) : null;
        var authLinuxUser = authUser && authUser.linuxUser ? authUser.linuxUser : null;
        var canAutoLogin = !usersModule.isMultiUser()
          || !!authLinuxUser
          || (authUser && authUser.role === "admin");
        sendAndRecord(session, {
          type: "auth_required",
          text: "Claude Code is not logged in.",
          linuxUser: authLinuxUser,
          canAutoLogin: canAutoLogin,
        });
        // Reset CLI session so next query starts fresh with new auth
        session.cliSessionId = null;
      }
      sendAndRecord(session, { type: "done", code: 0 });
      if (pushModule) {
        var preview = (session.responsePreview || "").replace(/\s+/g, " ").trim();
        if (preview.length > 140) preview = preview.substring(0, 140) + "...";
        pushModule.sendPush({
          type: "done",
          slug: slug,
          title: session.title || "Claude",
          body: preview || "Response ready",
          tag: "claude-done",
        });
      }
      // Reset for next turn in the same query
      session.responsePreview = "";
      session.streamedText = false;
      sm.broadcastSessionList();

    } else if (parsed.type === "system" && parsed.subtype === "status") {
      if (parsed.status === "compacting") {
        sendAndRecord(session, { type: "compacting", active: true });
      } else if (session.compacting) {
        sendAndRecord(session, { type: "compacting", active: false });
      }
      session.compacting = parsed.status === "compacting";

    } else if (parsed.type === "system" && parsed.subtype === "task_started") {
      var parentId = parsed.tool_use_id;
      if (parentId) {
        if (!session.taskIdMap) session.taskIdMap = {};
        session.taskIdMap[parentId] = parsed.task_id;
        sendAndRecord(session, {
          type: "task_started",
          parentToolId: parentId,
          taskId: parsed.task_id,
          description: parsed.description || "",
        });
      }

    } else if (parsed.type === "system" && parsed.subtype === "task_progress") {
      var parentId = parsed.tool_use_id;
      if (parentId) {
        sendAndRecord(session, {
          type: "task_progress",
          parentToolId: parentId,
          taskId: parsed.task_id,
          usage: parsed.usage || null,
          lastToolName: parsed.last_tool_name || null,
          description: parsed.description || "",
          summary: parsed.summary || null,
        });
      }

    } else if (parsed.type === "tool_progress") {
      // Sub-agent tool_progress: forward as activity update
      var parentId = parsed.parent_tool_use_id;
      if (parentId) {
        sendAndRecord(session, {
          type: "subagent_activity",
          parentToolId: parentId,
          text: parsed.content || "",
        });
      }

    } else if (parsed.type === "task_notification") {
      var parentId = parsed.parent_tool_use_id;
      if (parentId) {
        sendAndRecord(session, {
          type: "subagent_done",
          parentToolId: parentId,
          status: parsed.status || "completed",
          summary: parsed.summary || "",
          usage: parsed.usage || null,
        });
      }
      if (session.taskIdMap) {
        for (var k in session.taskIdMap) {
          if (session.taskIdMap[k] === parsed.task_id) {
            delete session.taskIdMap[k];
            break;
          }
        }
      }

    } else if (parsed.type === "rate_limit_event" && parsed.rate_limit_info) {
      var info = parsed.rate_limit_info;
      if (info.status === "allowed_warning" || info.status === "rejected") {
        sendAndRecord(session, {
          type: "rate_limit",
          status: info.status,
          resetsAt: info.resetsAt ? info.resetsAt * 1000 : null,
          rateLimitType: info.rateLimitType || null,
          utilization: info.utilization || null,
          isUsingOverage: info.isUsingOverage || false,
        });
      }

    } else if (parsed.type === "prompt_suggestion") {
      sendAndRecord(session, {
        type: "prompt_suggestion",
        suggestion: parsed.suggestion || "",
      });

    } else if (parsed.type && parsed.type !== "system" && parsed.type !== "user") {
    }
  }

  // --- Sub-agent message processing ---

  function toolActivityTextForSubagent(name, input) {
    if (name === "Bash" && input && input.description) return input.description;
    if (name === "Read" && input && input.file_path) return "Reading " + input.file_path.split("/").pop();
    if (name === "Edit" && input && input.file_path) return "Editing " + input.file_path.split("/").pop();
    if (name === "Write" && input && input.file_path) return "Writing " + input.file_path.split("/").pop();
    if (name === "Grep" && input && input.pattern) return "Searching for " + input.pattern;
    if (name === "Glob" && input && input.pattern) return "Finding " + input.pattern;
    if (name === "WebSearch" && input && input.query) return "Searching: " + input.query;
    if (name === "WebFetch") return "Fetching URL...";
    if (name === "Task" && input && input.description) return input.description;
    return "Running " + name + "...";
  }

  function processSubagentMessage(session, parsed) {
    var parentId = parsed.parent_tool_use_id;
    var content = parsed.message.content;
    if (!Array.isArray(content)) return;

    if (parsed.type === "assistant") {
      // Extract tool_use blocks from sub-agent assistant messages
      for (var i = 0; i < content.length; i++) {
        var block = content[i];
        if (block.type === "tool_use") {
          var activityText = toolActivityTextForSubagent(block.name, block.input);
          sendAndRecord(session, {
            type: "subagent_tool",
            parentToolId: parentId,
            toolName: block.name,
            toolId: block.id,
            text: activityText,
          });
        } else if (block.type === "thinking") {
          sendAndRecord(session, {
            type: "subagent_activity",
            parentToolId: parentId,
            text: "Thinking...",
          });
        } else if (block.type === "text" && block.text) {
          sendAndRecord(session, {
            type: "subagent_activity",
            parentToolId: parentId,
            text: "Writing response...",
          });
        }
      }
    }
    // user messages with parent_tool_use_id contain tool_results — skip silently
  }

  // --- MCP elicitation ---

  function handleElicitation(session, request, opts) {
    // Ralph Loop: auto-reject elicitation in autonomous mode
    if (session.loop && session.loop.active && session.loop.role !== "crafting") {
      return Promise.resolve({ action: "reject" });
    }

    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      if (!session.pendingElicitations) session.pendingElicitations = {};
      session.pendingElicitations[requestId] = {
        resolve: resolve,
        request: request,
      };
      sendAndRecord(session, {
        type: "elicitation_request",
        requestId: requestId,
        serverName: request.serverName,
        message: request.message,
        mode: request.mode || "form",
        url: request.url || null,
        elicitationId: request.elicitationId || null,
        requestedSchema: request.requestedSchema || null,
      });

      if (pushModule) {
        pushModule.sendPush({
          type: "elicitation",
          slug: slug,
          title: (request.serverName || "MCP Server") + " needs input",
          body: request.message || "Waiting for your response",
          tag: "claude-elicitation",
        });
      }

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingElicitations[requestId];
          resolve({ action: "reject" });
        });
      }
    });
  }

  // --- Worker process management (OS-level multi-user) ---

  var WORKER_SCRIPT = path.join(__dirname, "sdk-worker.js");

  // Ensure the package directory tree is world-readable so OS-level users
  // can access the worker script and its dependencies (the install path
  // may be under /root/.npm/_npx/ which defaults to 700)
  (function ensurePackageReadable() {
    try {
      // Walk up from __dirname to find the package root (where node_modules lives)
      var pkgDir = path.join(__dirname, "..");
      // Open read+execute on each ancestor directory up to and including the
      // npx cache entry so that non-root users can traverse the path
      var dir = pkgDir;
      var dirs = [];
      while (dir !== path.dirname(dir)) {
        dirs.push(dir);
        // Stop once we leave the npm cache tree
        if (dir.indexOf(".npm") === -1 && dir.indexOf("node_modules") === -1) break;
        dir = path.dirname(dir);
      }
      for (var di = 0; di < dirs.length; di++) {
        try {
          var st = fs.statSync(dirs[di]);
          // Add o+rx if not already present
          if ((st.mode & 0o005) !== 0o005) {
            fs.chmodSync(dirs[di], st.mode | 0o005);
          }
        } catch (e) {}
      }
      // Recursively make the package contents readable
      var { execSync: chmodExec } = require("child_process");
      chmodExec("chmod -R o+rX " + JSON.stringify(pkgDir), { stdio: "ignore", timeout: 5000 });
    } catch (e) {}
  })();

  // resolveLinuxUser delegates to shared os-users utility
  function resolveLinuxUser(username) {
    return resolveOsUserInfo(username);
  }

  /**
   * Spawn an SDK worker process running as the given Linux user.
   * Returns a worker handle with send/kill/event methods.
   */
  function spawnWorker(linuxUser) {
    var userInfo = resolveLinuxUser(linuxUser);
    var socketId = crypto.randomUUID();
    var socketPath = path.join(os.tmpdir(), "clay-worker-" + socketId + ".sock");

    var worker = {
      process: null,
      connection: null,
      socketPath: socketPath,
      server: null,
      messageHandlers: [],
      ready: false,
      readyPromise: null,
      _readyResolve: null,
      buffer: "",
    };

    worker.readyPromise = new Promise(function(resolve) {
      worker._readyResolve = resolve;
    });

    // Create Unix socket server
    worker.server = net.createServer(function(connection) {
      worker.connection = connection;
      connection.on("data", function(chunk) {
        worker.buffer += chunk.toString();
        var lines = worker.buffer.split("\n");
        worker.buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          try {
            var msg = JSON.parse(lines[i]);
            if (msg.type === "ready") {
              worker.ready = true;
              if (worker._readyResolve) {
                worker._readyResolve();
                worker._readyResolve = null;
              }
            }
            for (var h = 0; h < worker.messageHandlers.length; h++) {
              worker.messageHandlers[h](msg);
            }
          } catch (e) {
            console.error("[sdk-bridge] Failed to parse worker message:", e.message);
          }
        }
      });
      connection.on("error", function(err) {
        console.error("[sdk-bridge] Worker connection error:", err.message);
      });
    });

    worker.server.listen(socketPath, function() {
      // Set socket permissions so the target user can connect
      try { fs.chmodSync(socketPath, 0o777); } catch (e) {}

      // Spawn worker process as the target Linux user
      var workerEnv = {
        HOME: userInfo.home,
        USER: linuxUser,
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        NODE_PATH: process.env.NODE_PATH || "",
        LANG: process.env.LANG || "en_US.UTF-8",
      };

      worker.process = spawn(process.execPath, [WORKER_SCRIPT, socketPath], {
        uid: userInfo.uid,
        gid: userInfo.gid,
        env: workerEnv,
        cwd: cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      worker.process.stdout.on("data", function(data) {
        console.log("[sdk-worker:" + linuxUser + "] " + data.toString().trim());
      });
      worker._stderrBuf = "";
      worker.process.stderr.on("data", function(data) {
        var text = data.toString().trim();
        worker._stderrBuf += text + "\n";
        console.error("[sdk-worker:" + linuxUser + "] " + text);
      });

      worker.process.on("exit", function(code, signal) {
        console.log("[sdk-bridge] Worker for " + linuxUser + " exited (code=" + code + ", signal=" + signal + ")");
        // Notify message handlers about unexpected exit so sessions don't hang
        if (code !== 0 && code !== null) {
          var stderrText = worker._stderrBuf || "";
          for (var h = 0; h < worker.messageHandlers.length; h++) {
            worker.messageHandlers[h]({
              type: "query_error",
              error: stderrText || "Worker exited with code " + code,
              exitCode: code,
              stderr: stderrText || null,
            });
          }
        }
        cleanupWorker(worker);
      });
    });

    worker.send = function(msg) {
      if (!worker.connection || worker.connection.destroyed) return;
      try {
        worker.connection.write(JSON.stringify(msg) + "\n");
      } catch (e) {
        console.error("[sdk-bridge] Failed to send to worker:", e.message);
      }
    };

    worker.onMessage = function(handler) {
      worker.messageHandlers.push(handler);
    };

    worker.kill = function() {
      worker.send({ type: "shutdown" });
      // Force kill after 3 seconds if still alive
      setTimeout(function() {
        if (worker.process && !worker.process.killed) {
          try { worker.process.kill("SIGKILL"); } catch (e) {}
        }
      }, 3000);
      cleanupWorker(worker);
    };

    return worker;
  }

  function cleanupWorker(worker) {
    if (worker.connection && !worker.connection.destroyed) {
      try { worker.connection.end(); } catch (e) {}
    }
    if (worker.server) {
      try { worker.server.close(); } catch (e) {}
    }
    // Remove socket file
    try { fs.unlinkSync(worker.socketPath); } catch (e) {}
    worker.ready = false;
  }

  /**
   * Start a query via a worker process running as the target Linux user.
   * Mirrors the in-process startQuery flow but delegates SDK execution to the worker.
   */
  async function startQueryViaWorker(session, text, images, linuxUser) {
    var worker;
    try {
      worker = spawnWorker(linuxUser);
      session.worker = worker;
    } catch (e) {
      session.isProcessing = false;
      onProcessingChanged();
      sendAndRecord(session, { type: "error", text: "Failed to spawn worker for " + linuxUser + ": " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }

    session.messageQueue = "worker"; // sentinel: messages go via worker IPC
    session.blocks = {};
    session.sentToolResults = {};
    session.activeTaskToolIds = {};
    session.pendingElicitations = {};
    session.streamedText = false;
    session.responsePreview = "";
    session.abortController = { abort: function() { worker.send({ type: "abort" }); } };

    // Build initial user message content
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }

    var initialMessage = {
      type: "user",
      message: { role: "user", content: content },
    };

    // Build serializable query options (no callbacks, no AbortController)
    var queryOptions = {
      cwd: cwd,
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
      promptSuggestions: true,
      agentProgressSummaries: true,
    };

    if (sm.currentModel) queryOptions.model = sm.currentModel;
    if (sm.currentEffort) queryOptions.effort = sm.currentEffort;
    if (sm.currentBetas && sm.currentBetas.length > 0) queryOptions.betas = sm.currentBetas;
    if (sm.currentThinking === "disabled") {
      queryOptions.thinking = { type: "disabled" };
    } else if (sm.currentThinking === "budget" && sm.currentThinkingBudget) {
      queryOptions.thinking = { type: "enabled", budgetTokens: sm.currentThinkingBudget };
    }

    if (dangerouslySkipPermissions) {
      queryOptions.permissionMode = "bypassPermissions";
      queryOptions.allowDangerouslySkipPermissions = true;
    } else {
      var modeToApply = session.acceptEditsAfterStart ? "acceptEdits" : sm.currentPermissionMode;
      if (session.acceptEditsAfterStart) delete session.acceptEditsAfterStart;
      if (modeToApply && modeToApply !== "default") {
        queryOptions.permissionMode = modeToApply;
      }
    }

    if (session.cliSessionId) {
      queryOptions.resume = session.cliSessionId;
      if (session.lastRewindUuid) {
        queryOptions.resumeSessionAt = session.lastRewindUuid;
        delete session.lastRewindUuid;
      }
    }

    // Set up message handler for worker events
    worker.onMessage(function(msg) {
      switch (msg.type) {
        case "sdk_event":
          processSDKMessage(session, msg.event);
          break;

        case "permission_request":
          handleCanUseTool(session, msg.toolName, msg.input, {
            toolUseID: msg.toolUseId,
            decisionReason: msg.decisionReason,
            signal: session.abortController ? { addEventListener: function() {} } : undefined,
          }).then(function(result) {
            worker.send({ type: "permission_response", requestId: msg.requestId, result: result });
          });
          break;

        case "ask_user_request":
          // Delegate to the daemon's AskUserQuestion handling
          handleCanUseTool(session, "AskUserQuestion", msg.input, {
            toolUseID: msg.toolUseId,
            signal: session.abortController ? { addEventListener: function() {} } : undefined,
          }).then(function(result) {
            worker.send({ type: "ask_user_response", toolUseId: msg.toolUseId, result: result });
          });
          break;

        case "elicitation_request":
          handleElicitation(session, {
            serverName: msg.serverName,
            message: msg.message,
            mode: msg.mode,
            url: msg.url,
            elicitationId: msg.elicitationId,
            requestedSchema: msg.requestedSchema,
          }, {
            signal: session.abortController ? { addEventListener: function() {} } : undefined,
          }).then(function(result) {
            worker.send({ type: "elicitation_response", requestId: msg.requestId, result: result });
          });
          break;

        case "query_done":
          // Stream ended normally
          if (session.isProcessing && session.taskStopRequested) {
            session.isProcessing = false;
            onProcessingChanged();
            sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
            sendAndRecord(session, { type: "done", code: 0 });
            sm.broadcastSessionList();
          }
          cleanupSessionWorker(session);
          if (session.onQueryComplete) {
            try { session.onQueryComplete(session); } catch (err) {
              console.error("[sdk-bridge] onQueryComplete error:", err.message || err);
            }
          }
          break;

        case "query_error":
          if (session.isProcessing) {
            session.isProcessing = false;
            onProcessingChanged();
            var isAbort = (msg.error && (msg.error.indexOf("AbortError") !== -1 || msg.error.indexOf("aborted") !== -1))
              || session.taskStopRequested;
            if (isAbort) {
              if (!session.destroying) {
                sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
                sendAndRecord(session, { type: "done", code: 0 });
              }
            } else if (session.destroying) {
              console.log("[sdk-bridge] Suppressing worker error during shutdown for session " + session.localId);
            } else {
              var errDetail = msg.error || "Unknown error";
              if (msg.stderr) errDetail += "\nstderr: " + msg.stderr;
              if (msg.exitCode != null) errDetail += " (exitCode: " + msg.exitCode + ")";
              console.error("[sdk-bridge] Worker query error for session " + session.localId + ":", errDetail);

              var errLower = errDetail.toLowerCase();
              var isContextOverflow = errLower.indexOf("prompt is too long") !== -1
                || errLower.indexOf("context_length") !== -1
                || errLower.indexOf("maximum context length") !== -1;
              var isAuthError = errLower.indexOf("not logged in") !== -1
                || errLower.indexOf("unauthenticated") !== -1
                || errLower.indexOf("authentication") !== -1
                || errLower.indexOf("sign in") !== -1
                || errLower.indexOf("log in") !== -1
                || errLower.indexOf("please login") !== -1;
              if (isContextOverflow) {
                sendAndRecord(session, { type: "context_overflow", text: "Conversation too long to continue." });
              } else if (isAuthError) {
                var authUser = session.ownerId ? usersModule.findUserById(session.ownerId) : null;
                var authLinuxUser = authUser && authUser.linuxUser ? authUser.linuxUser : null;
                // Determine if auto-login (auto terminal + claude) is safe:
                // - Single-user mode: always ok
                // - Multi-user + OS user isolation (linuxUser set): ok (isolated)
                // - Multi-user + admin role: ok (they own the shared account)
                // - Multi-user + regular user (no linuxUser): not ok (shared account)
                var canAutoLogin = !usersModule.isMultiUser()
                  || !!authLinuxUser
                  || (authUser && authUser.role === "admin");
                sendAndRecord(session, {
                  type: "auth_required",
                  text: "Claude Code is not logged in.",
                  linuxUser: authLinuxUser,
                  canAutoLogin: canAutoLogin,
                });
              } else {
                sendAndRecord(session, { type: "error", text: "Claude process error: " + msg.error });
              }
              sendAndRecord(session, { type: "done", code: 1 });
              if (pushModule) {
                pushModule.sendPush({
                  type: "error",
                  slug: slug,
                  title: "Connection Lost",
                  body: "Claude process disconnected: " + (msg.error || "unknown error"),
                  tag: "claude-error",
                });
              }
            }
            sm.broadcastSessionList();
          }
          cleanupSessionWorker(session);
          if (session.onQueryComplete) {
            try { session.onQueryComplete(session); } catch (err) {
              console.error("[sdk-bridge] onQueryComplete error:", err.message || err);
            }
          }
          break;

        case "model_changed":
          sm.currentModel = msg.model;
          send({ type: "model_info", model: msg.model, models: sm.availableModels || [] });
          send({ type: "config_state", model: sm.currentModel, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
          break;

        case "effort_changed":
          sm.currentEffort = msg.effort;
          send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
          break;

        case "permission_mode_changed":
          sm.currentPermissionMode = msg.mode;
          send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
          break;

        case "worker_error":
          send({ type: "error", text: msg.error });
          break;
      }
    });

    // Wait for worker to be ready, then send query
    try {
      await worker.readyPromise;
    } catch (e) {
      session.isProcessing = false;
      onProcessingChanged();
      sendAndRecord(session, { type: "error", text: "Worker failed to connect: " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      cleanupSessionWorker(session);
      return;
    }

    worker.send({
      type: "query_start",
      prompt: initialMessage,
      options: queryOptions,
      singleTurn: !!session.singleTurn,
    });
  }

  function cleanupSessionWorker(session) {
    session.queryInstance = null;
    session.messageQueue = null;
    session.abortController = null;
    session.taskStopRequested = false;
    session.pendingPermissions = {};
    session.pendingAskUser = {};
    session.pendingElicitations = {};
    if (session.worker) {
      session.worker.kill();
      session.worker = null;
    }
  }

  /**
   * Run warmup via a worker process for a specific Linux user.
   */
  async function warmupViaWorker(linuxUser) {
    var worker;
    try {
      worker = spawnWorker(linuxUser);
    } catch (e) {
      send({ type: "error", text: "Failed to spawn warmup worker for " + linuxUser + ": " + (e.message || e) });
      return;
    }

    var warmupDone = false;

    worker.onMessage(function(msg) {
      if (msg.type === "warmup_done" && !warmupDone) {
        warmupDone = true;
        var result = msg.result || {};
        var fsSkills = discoverSkillDirs();
        sm.skillNames = mergeSkills(result.skills, fsSkills);
        if (result.slashCommands) {
          var seen = new Set();
          var combined = [];
          var all = result.slashCommands.concat(Array.from(sm.skillNames));
          for (var k = 0; k < all.length; k++) {
            if (!seen.has(all[k])) {
              seen.add(all[k]);
              combined.push(all[k]);
            }
          }
          sm.slashCommands = combined;
          send({ type: "slash_commands", commands: sm.slashCommands });
        }
        if (result.model) {
          sm.currentModel = sm._savedDefaultModel || result.model;
        }
        sm.availableModels = result.models || [];
        send({ type: "model_info", model: sm.currentModel || "", models: sm.availableModels || [] });
        worker.kill();
      } else if (msg.type === "warmup_error" && !warmupDone) {
        warmupDone = true;
        send({ type: "error", text: msg.error || "Warmup failed" });
        worker.kill();
      }
    });

    try {
      await worker.readyPromise;
    } catch (e) {
      send({ type: "error", text: "Warmup worker failed to connect: " + (e.message || e) });
      cleanupWorker(worker);
      return;
    }

    var warmupOptions = { cwd: cwd, settingSources: ["user", "project", "local"] };
    if (dangerouslySkipPermissions) {
      warmupOptions.permissionMode = "bypassPermissions";
      warmupOptions.allowDangerouslySkipPermissions = true;
    }
    worker.send({ type: "warmup", options: warmupOptions });
  }

  // --- SDK query lifecycle ---

  function handleCanUseTool(session, toolName, input, opts) {
    // Ralph Loop execution: auto-approve all tools, deny interactive ones.
    // Crafting sessions are interactive — user and Claude collaborate to build PROMPT.md / JUDGE.md.
    if (session.loop && session.loop.active && session.loop.role !== "crafting") {
      if (toolName === "AskUserQuestion") {
        return Promise.resolve({ behavior: "deny", message: "Autonomous mode. Make your own decision." });
      }
      if (toolName === "EnterPlanMode") {
        return Promise.resolve({ behavior: "deny", message: "Do not enter plan mode. Execute directly." });
      }
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // AskUserQuestion: wait for user answers via WebSocket
    if (toolName === "AskUserQuestion") {
      return new Promise(function(resolve) {
        session.pendingAskUser[opts.toolUseID] = {
          resolve: resolve,
          input: input,
        };
        if (opts.signal) {
          opts.signal.addEventListener("abort", function() {
            delete session.pendingAskUser[opts.toolUseID];
            sendAndRecord(session, { type: "ask_user_answered", toolId: opts.toolUseID });
            resolve({ behavior: "deny", message: "Cancelled" });
          });
        }
      });
    }

    // Auto-approve if tool was previously allowed for session
    if (session.allowedTools && session.allowedTools[toolName]) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // Regular tool permission request: send to client and wait
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      session.pendingPermissions[requestId] = {
        resolve: resolve,
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };

      var permMsg = {
        type: "permission_request",
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };
      sendAndRecord(session, permMsg);

      if (pushModule) {
        pushModule.sendPush({
          type: "permission_request",
          slug: slug,
          requestId: requestId,
          title: permissionPushTitle(toolName, input),
          body: permissionPushBody(toolName, input),
        });
      }

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingPermissions[requestId];
          sendAndRecord(session, { type: "permission_cancel", requestId: requestId });
          resolve({ behavior: "deny", message: "Request cancelled" });
        });
      }
    });
  }

  /**
   * Detect running Claude Code CLI processes that may conflict with our SDK queries.
   * Only returns processes whose cwd matches our project directory.
   * Returns an array of { pid, command } for each conflicting process found.
   */
  function findConflictingClaude() {
    try {
      var output = execSync("ps ax -o pid,command 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      var lines = output.trim().split("\n");
      var candidates = [];
      for (var i = 1; i < lines.length; i++) { // skip header
        var line = lines[i].trim();
        var m = line.match(/^(\d+)\s+(.+)/);
        if (!m) continue;
        var pid = parseInt(m[1], 10);
        var cmd = m[2];
        // Skip our own process
        if (pid === process.pid) continue;
        // Skip node processes (our daemon, dev watchers, etc.)
        if (/\bnode\b/.test(cmd.split(/\s/)[0])) continue;
        // Match actual claude binary (e.g. /Users/x/.claude/local/claude, /usr/local/bin/claude)
        if (/\/claude(\s|$)/.test(cmd) || /^claude(\s|$)/.test(cmd)) {
          candidates.push({ pid: pid, command: cmd.substring(0, 200) });
        }
      }

      // Filter to only processes whose cwd matches our project
      var results = [];
      for (var j = 0; j < candidates.length; j++) {
        var c = candidates[j];
        try {
          // Use /proc/<pid>/cwd symlink (always available on Linux, no lsof dependency)
          var procCwd = fs.readlinkSync("/proc/" + c.pid + "/cwd");
          if (procCwd === cwd) {
            results.push(c);
          }
        } catch (e) {
          // /proc read failed — include as candidate anyway (conservative)
          results.push(c);
        }
      }
      return results;
    } catch (e) {
      return [];
    }
  }

  /**
   * Verify that a PID is actually a claude binary process (not arbitrary).
   */
  function isClaudeProcess(pid) {
    try {
      var output = execSync("ps -p " + pid + " -o command= 2>/dev/null", { encoding: "utf8", timeout: 3000 }).trim();
      return /\/claude(\s|$)/.test(output) || /^claude(\s|$)/.test(output);
    } catch (e) {
      return false;
    }
  }

  async function processQueryStream(session) {
    try {
      for await (var msg of session.queryInstance) {
        processSDKMessage(session, msg);
      }
      // Stream ended normally after a task stop — no "result" message was sent,
      // so the session is still marked as processing. Send interrupted feedback.
      if (session.isProcessing && session.taskStopRequested) {
        session.isProcessing = false;
        onProcessingChanged();
        sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
        sendAndRecord(session, { type: "done", code: 0 });
        sm.broadcastSessionList();
      }
    } catch (err) {
      if (session.isProcessing) {
        session.isProcessing = false;
        onProcessingChanged();
        if (err.name === "AbortError" || (session.abortController && session.abortController.signal.aborted) || session.taskStopRequested) {
          if (!session.destroying) {
            sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
            sendAndRecord(session, { type: "done", code: 0 });
          }
        } else if (session.destroying) {
          // Suppress error messages during shutdown
          console.log("[sdk-bridge] Suppressing stream error during shutdown for session " + session.localId);
        } else {
          var errDetail = err.message || String(err);
          if (err.stderr) errDetail += "\nstderr: " + err.stderr;
          if (err.exitCode != null) errDetail += " (exitCode: " + err.exitCode + ")";
          console.error("[sdk-bridge] Query stream error for session " + session.localId + ":", errDetail);
          console.error("[sdk-bridge] Stack:", err.stack || "(no stack)");

          // Check for conflicting Claude processes only on exit code 1
          var isExitCode1 = err.exitCode === 1 || (err.message && err.message.indexOf("exited with code 1") !== -1);
          var conflicts = isExitCode1 ? findConflictingClaude() : [];
          if (conflicts.length > 0) {
            console.error("[sdk-bridge] Found " + conflicts.length + " conflicting Claude process(es):", conflicts.map(function(c) { return "PID " + c.pid; }).join(", "));
            sendAndRecord(session, {
              type: "process_conflict",
              text: "Another Claude Code process is already running in this project.",
              processes: conflicts,
            });
          } else {
            var errLower = errDetail.toLowerCase();
            var isContextOverflow = errLower.indexOf("prompt is too long") !== -1
              || errLower.indexOf("context_length") !== -1
              || errLower.indexOf("maximum context length") !== -1;
            var isAuthError = errLower.indexOf("not logged in") !== -1
              || errLower.indexOf("unauthenticated") !== -1
              || errLower.indexOf("authentication") !== -1
              || errLower.indexOf("sign in") !== -1
              || errLower.indexOf("log in") !== -1
              || errLower.indexOf("please login") !== -1;
            if (isContextOverflow) {
              sendAndRecord(session, {
                type: "context_overflow",
                text: "Conversation too long to continue.",
              });
            } else if (isAuthError) {
              var authUser = session.ownerId ? usersModule.findUserById(session.ownerId) : null;
              var authLinuxUser = authUser && authUser.linuxUser ? authUser.linuxUser : null;
              var canAutoLogin = !usersModule.isMultiUser()
                || !!authLinuxUser
                || (authUser && authUser.role === "admin");
              sendAndRecord(session, {
                type: "auth_required",
                text: "Claude Code is not logged in.",
                linuxUser: authLinuxUser,
                canAutoLogin: canAutoLogin,
              });
            } else {
              sendAndRecord(session, { type: "error", text: "Claude process error: " + err.message });
            }
          }
          sendAndRecord(session, { type: "done", code: 1 });
          if (pushModule) {
            pushModule.sendPush({
              type: "error",
              slug: slug,
              title: "Connection Lost",
              body: "Claude process disconnected: " + (err.message || "unknown error"),
              tag: "claude-error",
            });
          }
        }
        sm.broadcastSessionList();
      }
    } finally {
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
      session.taskStopRequested = false;
      session.pendingPermissions = {};
      session.pendingAskUser = {};
      session.pendingElicitations = {};
    }
    // Ralph Loop: notify completion so loop orchestrator can proceed
    if (session.onQueryComplete) {
      console.log("[sdk-bridge] Calling onQueryComplete for session " + session.localId + " (title: " + (session.title || "?") + ")");
      try {
        session.onQueryComplete(session);
      } catch (err) {
        console.error("[sdk-bridge] onQueryComplete error:", err.message || err);
      }
    }
  }

  async function getOrCreateRewindQuery(session) {
    if (session.queryInstance) return { query: session.queryInstance, isTemp: false, cleanup: function() {} };

    var sdk;
    try {
      sdk = await getSDK();
    } catch (e) {
      sendAndRecord(session, { type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      throw e;
    }
    var mq = createMessageQueue();

    var tempQuery = sdk.query({
      prompt: mq,
      options: {
        cwd: cwd,
        settingSources: ["user", "project", "local"],
        enableFileCheckpointing: true,
        resume: session.cliSessionId,
      },
    });

    // Drain messages in background (stream stays alive until mq.end())
    (async function() {
      try { for await (var msg of tempQuery) {} } catch(e) {}
    })();

    return {
      query: tempQuery,
      isTemp: true,
      cleanup: function() { try { mq.end(); } catch(e) {} },
    };
  }

  async function startQuery(session, text, images, linuxUser) {
    // OS-level isolation: delegate to worker process if linuxUser is set
    if (linuxUser) {
      return startQueryViaWorker(session, text, images, linuxUser);
    }

    var sdk;
    try {
      sdk = await getSDK();
    } catch (e) {
      session.isProcessing = false;
      onProcessingChanged();
      sendAndRecord(session, { type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }

    session.messageQueue = createMessageQueue();
    session.blocks = {};
    session.sentToolResults = {};
    session.activeTaskToolIds = {};
    session.pendingElicitations = {};
    session.streamedText = false;
    session.responsePreview = "";

    // Build initial user message
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }

    session.messageQueue.push({
      type: "user",
      message: { role: "user", content: content },
    });

    session.abortController = new AbortController();

    var queryOptions = {
      cwd: cwd,
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
      abortController: session.abortController,
      promptSuggestions: true,
      agentProgressSummaries: true,
      canUseTool: function(toolName, input, toolOpts) {
        return handleCanUseTool(session, toolName, input, toolOpts);
      },
      onElicitation: function(request, elicitOpts) {
        return handleElicitation(session, request, elicitOpts);
      },
    };

    if (sm.currentModel) {
      queryOptions.model = sm.currentModel;
    }

    if (sm.currentEffort) {
      queryOptions.effort = sm.currentEffort;
    }

    if (sm.currentBetas && sm.currentBetas.length > 0) {
      queryOptions.betas = sm.currentBetas;
    }

    if (sm.currentThinking === "disabled") {
      queryOptions.thinking = { type: "disabled" };
    } else if (sm.currentThinking === "budget" && sm.currentThinkingBudget) {
      queryOptions.thinking = { type: "enabled", budgetTokens: sm.currentThinkingBudget };
    }

    if (dangerouslySkipPermissions) {
      queryOptions.permissionMode = "bypassPermissions";
      queryOptions.allowDangerouslySkipPermissions = true;
    } else {
      // Pass permissionMode in queryOptions at creation time to avoid race condition
      var modeToApply = session.acceptEditsAfterStart ? "acceptEdits" : sm.currentPermissionMode;
      if (session.acceptEditsAfterStart) delete session.acceptEditsAfterStart;
      if (modeToApply && modeToApply !== "default") {
        queryOptions.permissionMode = modeToApply;
      }
    }

    if (session.cliSessionId) {
      queryOptions.resume = session.cliSessionId;
      if (session.lastRewindUuid) {
        queryOptions.resumeSessionAt = session.lastRewindUuid;
        delete session.lastRewindUuid;
      }
    }

    try {
      session.queryInstance = sdk.query({
        prompt: session.messageQueue,
        options: queryOptions,
      });
    } catch (e) {
      console.error("[sdk-bridge] Failed to create query for session " + session.localId + ":", e.message || e);
      console.error("[sdk-bridge] cliSessionId:", session.cliSessionId, "resume:", !!queryOptions.resume);
      console.error("[sdk-bridge] Stack:", e.stack || "(no stack)");
      session.isProcessing = false;
      onProcessingChanged();
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
      sendAndRecord(session, { type: "error", text: "Failed to start query: " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }

    // For single-turn sessions (Ralph Loop), end the message queue so the SDK
    // query finishes after processing the one message. Without this, the query
    // stream stays open forever waiting for more messages, and onQueryComplete
    // never fires.
    if (session.singleTurn) {
      session.messageQueue.end();
    }

    session.streamPromise = processQueryStream(session).catch(function(err) {
    });
  }

  function pushMessage(session, text, images) {
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }
    var userMsg = {
      type: "user",
      message: { role: "user", content: content },
    };
    // Route through worker if active, otherwise direct to message queue
    if (session.worker) {
      session.worker.send({ type: "push_message", content: userMsg });
    } else {
      session.messageQueue.push(userMsg);
    }
  }

  function permissionPushTitle(toolName, input) {
    if (!input) return "Claude wants to use " + toolName;
    var file = input.file_path ? input.file_path.split(/[/\\]/).pop() : "";
    switch (toolName) {
      case "Bash": return "Claude wants to run a command";
      case "Edit": return "Claude wants to edit " + (file || "a file");
      case "Write": return "Claude wants to write " + (file || "a file");
      case "Read": return "Claude wants to read " + (file || "a file");
      case "Grep": return "Claude wants to search files";
      case "Glob": return "Claude wants to find files";
      case "WebFetch": return "Claude wants to fetch a URL";
      case "WebSearch": return "Claude wants to search the web";
      case "Task": return "Claude wants to launch an agent";
      default: return "Claude wants to use " + toolName;
    }
  }

  function permissionPushBody(toolName, input) {
    if (!input) return "";
    var text = "";
    if (toolName === "Bash" && input.command) {
      text = input.command;
    } else if (toolName === "Edit" && input.file_path) {
      text = input.file_path.split(/[/\\]/).pop() + ": " + (input.old_string || "").substring(0, 40) + " \u2192 " + (input.new_string || "").substring(0, 40);
    } else if (toolName === "Write" && input.file_path) {
      text = input.file_path;
    } else if (input.file_path) {
      text = input.file_path;
    } else if (input.command) {
      text = input.command;
    } else if (input.url) {
      text = input.url;
    } else if (input.query) {
      text = input.query;
    } else if (input.pattern) {
      text = input.pattern;
    } else if (input.description) {
      text = input.description;
    }
    if (text.length > 120) text = text.substring(0, 120) + "...";
    return text;
  }

  // SDK warmup: grab slash_commands, model, and available models from SDK init
  async function warmup(linuxUser) {
    // OS-level isolation: delegate warmup to worker process
    if (linuxUser) {
      return warmupViaWorker(linuxUser);
    }

    try {
      var sdk = await getSDK();
      var ac = new AbortController();
      var mq = createMessageQueue();
      mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
      mq.end();
      var warmupOptions = { cwd: cwd, settingSources: ["user", "project", "local"], abortController: ac };
      if (dangerouslySkipPermissions) {
        warmupOptions.permissionMode = "bypassPermissions";
        warmupOptions.allowDangerouslySkipPermissions = true;
      }
      var stream = sdk.query({
        prompt: mq,
        options: warmupOptions,
      });
      for await (var msg of stream) {
        if (msg.type === "system" && msg.subtype === "init") {
          var fsSkills = discoverSkillDirs();
          sm.skillNames = mergeSkills(msg.skills, fsSkills);
          if (msg.slash_commands) {
            // Union: SDK slash_commands + merged skills (deduplicated)
            var seen = new Set();
            var combined = [];
            var all = msg.slash_commands.concat(Array.from(sm.skillNames));
            for (var k = 0; k < all.length; k++) {
              if (!seen.has(all[k])) {
                seen.add(all[k]);
                combined.push(all[k]);
              }
            }
            sm.slashCommands = combined;
            send({ type: "slash_commands", commands: sm.slashCommands });
          }
          if (msg.model) {
            sm.currentModel = msg.model;
          }
          // Fetch available models before aborting
          try {
            var models = await stream.supportedModels();
            sm.availableModels = models || [];
          } catch (e) {}
          send({ type: "model_info", model: sm.currentModel || "", models: sm.availableModels || [] });
          ac.abort();
          break;
        }
      }
    } catch (e) {
      if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
        send({ type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      }
    }
  }

  async function setModel(session, model) {
    if (session.worker) {
      session.worker.send({ type: "set_model", model: model });
      return;
    }
    if (!session.queryInstance) {
      // No active query — just store the model for next startQuery
      sm.currentModel = model;
      send({ type: "model_info", model: model, models: sm.availableModels || [] });
      send({ type: "config_state", model: sm.currentModel, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return;
    }
    try {
      await session.queryInstance.setModel(model);
      sm.currentModel = model;
      send({ type: "model_info", model: model, models: sm.availableModels || [] });
      send({ type: "config_state", model: sm.currentModel, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
    } catch (e) {
      send({ type: "error", text: "Failed to switch model: " + (e.message || e) });
    }
  }

  async function setEffort(session, effort) {
    if (session.worker) {
      session.worker.send({ type: "set_effort", effort: effort });
      return;
    }
    if (!session.queryInstance) {
      sm.currentEffort = effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
      return;
    }
    try {
      await session.queryInstance.setEffort(effort);
      sm.currentEffort = effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
    } catch (e) {
      send({ type: "error", text: "Failed to set effort: " + (e.message || e) });
    }
  }

  async function setPermissionMode(session, mode) {
    // When dangerouslySkipPermissions is active, ignore mode changes from UI
    // to prevent accidentally downgrading from bypassPermissions
    if (dangerouslySkipPermissions) {
      send({ type: "config_state", model: sm.currentModel || "", mode: "bypassPermissions", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return;
    }
    if (session.worker) {
      session.worker.send({ type: "set_permission_mode", mode: mode });
      return;
    }
    if (!session.queryInstance) {
      // No active query — just store the mode for next startQuery
      sm.currentPermissionMode = mode;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return;
    }
    try {
      await session.queryInstance.setPermissionMode(mode);
      sm.currentPermissionMode = mode;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
    } catch (e) {
      send({ type: "error", text: "Failed to set permission mode: " + (e.message || e) });
    }
  }

  async function stopTask(taskId) {
    var session = sm.getActiveSession();
    if (!session) return;
    session.taskStopRequested = true;
    if (session.worker) {
      session.worker.send({ type: "stop_task", taskId: taskId });
      return;
    }
    if (!session.queryInstance) return;
    try {
      await session.queryInstance.stopTask(taskId);
    } catch (e) {
      console.error("[sdk-bridge] stopTask error:", e.message);
    }
    // SDK stopTask doesn't reliably stop the sub-agent, so abort the entire
    // session as a fallback to ensure the process actually stops.
    if (session.abortController) {
      session.abortController.abort();
    }
  }

  return {
    createMessageQueue: createMessageQueue,
    processSDKMessage: processSDKMessage,
    handleCanUseTool: handleCanUseTool,
    handleElicitation: handleElicitation,
    processQueryStream: processQueryStream,
    getOrCreateRewindQuery: getOrCreateRewindQuery,
    startQuery: startQuery,
    pushMessage: pushMessage,
    setModel: setModel,
    setEffort: setEffort,
    setPermissionMode: setPermissionMode,
    isClaudeProcess: isClaudeProcess,
    permissionPushTitle: permissionPushTitle,
    permissionPushBody: permissionPushBody,
    warmup: warmup,
    stopTask: stopTask,
  };
}

module.exports = { createSDKBridge, createMessageQueue };
