var childProcess = require("child_process");
var readline = require("readline");
var skillDiscovery = require("../skill-discovery");

function findBinary() {
  if (process.env.ANTIGRAVITY_CLI_PATH) return process.env.ANTIGRAVITY_CLI_PATH;
  try {
    var command = process.platform === "win32" ? "where" : "which";
    return childProcess.execFileSync(command, ["agy"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim().split(/\r?\n/)[0] || null;
  } catch (e) {
    return null;
  }
}

function modelValue(model) {
  if (typeof model === "string") return model;
  return model && (model.id || model.slug || model.value || model.model);
}

function parseModels(stdout) {
  try {
    var parsed = JSON.parse(String(stdout || ""));
    var list = Array.isArray(parsed) ? parsed : (parsed.models || parsed.data || []);
    var models = [];
    for (var i = 0; i < list.length; i++) {
      var value = modelValue(list[i]);
      if (value && models.indexOf(value) === -1) models.push(value);
    }
    return models;
  } catch (e) {
    var lines = String(stdout || "").split(/\r?\n/);
    var fallback = [];
    for (var j = 0; j < lines.length; j++) {
      var match = lines[j].trim().match(/^([^\s]+)\s+/);
      if (match && fallback.indexOf(match[1]) === -1) fallback.push(match[1]);
    }
    return fallback;
  }
}

function fetchModels(binaryPath, cwd) {
  return new Promise(function(resolve) {
    childProcess.execFile(binaryPath, ["models", "--output-format", "json"], {
      cwd: cwd || process.cwd(),
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
    }, function(err, stdout) {
      if (err || !stdout) { resolve([]); return; }
      resolve(parseModels(stdout));
    });
  });
}

function isAuthError(value) {
  return /authentication required|not authenticated|sign in|log ?in|credentials|unauthorized|forbidden|\b401\b/i.test(String(value || ""));
}

function toolName(name) {
  var value = String(name || "").toLowerCase();
  if (value === "run_command" || value === "shell" || value === "bash") return "Bash";
  if (value.indexOf("read") !== -1) return "Read";
  if (value.indexOf("write") !== -1 || value.indexOf("create") !== -1) return "Write";
  if (value.indexOf("edit") !== -1 || value.indexOf("replace") !== -1 || value.indexOf("delete") !== -1) return "Edit";
  if (value.indexOf("search_web") !== -1 || value.indexOf("web_search") !== -1) return "WebSearch";
  if (value.indexOf("fetch") !== -1 || value.indexOf("url") !== -1) return "WebFetch";
  if (value.indexOf("search") !== -1 || value.indexOf("grep") !== -1) return "Grep";
  if (value.indexOf("glob") !== -1 || value.indexOf("find") !== -1) return "Glob";
  if (value.indexOf("subagent") !== -1 || value.indexOf("task") !== -1) return "Task";
  return name || "Tool";
}

function createAntigravityQueryHandle(binaryPath, queryOpts, onFinished) {
  var processHandle = null;
  var outputReader = null;
  var events = [];
  var eventWaiter = null;
  var messages = [];
  var started = false;
  var activeTurn = false;
  var ended = false;
  var inputEnded = false;
  var finished = false;
  var stderr = "";
  var sessionId = queryOpts.resumeSessionId || null;
  var model = queryOpts.model || "auto";
  var effort = queryOpts.effort || null;
  var toolPolicy = queryOpts.dangerouslySkipPermissions ? "allow-all" : "ask";
  var blockCounter = 0;
  var textBlockId = null;
  var toolBlocks = {};
  var latestUsage = null;
  var firstMessage = true;

  function notifyFinished() {
    if (finished) return;
    finished = true;
    if (typeof onFinished === "function") onFinished();
  }

  function pushEvent(event) {
    if (ended) return;
    if (eventWaiter) {
      var resolve = eventWaiter;
      eventWaiter = null;
      resolve({ value: event, done: false });
    } else {
      events.push(event);
    }
  }

  function endEvents() {
    if (ended) return;
    ended = true;
    if (eventWaiter) {
      var resolve = eventWaiter;
      eventWaiter = null;
      resolve({ value: undefined, done: true });
    }
    notifyFinished();
  }

  function buildPrompt(text, images) {
    var prompt = text || "";
    if (firstMessage) {
      var systemParts = [queryOpts.systemPrompt, queryOpts.appendSystemPrompt].filter(function(part) { return !!part; });
      if (systemParts.length) prompt = systemParts.join("\n\n") + "\n\n" + prompt;
      firstMessage = false;
    }
    if (images && images.length) {
      prompt += "\n\n[Clay could not forward " + images.length + " attached image(s) because Antigravity CLI stream input currently accepts text only.]";
    }
    return prompt;
  }

  function writeNextMessage() {
    if (!processHandle || !processHandle.stdin || activeTurn || !messages.length) return;
    activeTurn = true;
    textBlockId = null;
    toolBlocks = {};
    pushEvent({ yokeType: "turn_start", messageType: "user" });
    processHandle.stdin.write(JSON.stringify({
      event: "user",
      message: { content: messages.shift() },
    }) + "\n");
  }

  function finishTurn(result) {
    result = result || {};
    if (result.conversation_id) sessionId = result.conversation_id;
    if (result.usage) latestUsage = result.usage;
    var status = result.status || "SUCCESS";
    if (status !== "SUCCESS") {
      if (status === "CANCELED" || status === "INTERRUPTED") {
        pushEvent({ yokeType: "interrupted" });
      } else {
        var errorText = result.error || "Antigravity CLI ended the turn with status " + status;
        pushEvent(isAuthError(errorText)
          ? { yokeType: "auth_required", vendor: "antigravity" }
          : { yokeType: "error", text: errorText });
      }
    }
    pushEvent({
      yokeType: "result",
      messageType: "assistant",
      cost: null,
      duration: typeof result.duration_seconds === "number" ? result.duration_seconds * 1000 : null,
      usage: latestUsage ? {
        input_tokens: latestUsage.input_tokens || 0,
        output_tokens: latestUsage.output_tokens || 0,
        cache_read_input_tokens: latestUsage.cache_read_tokens || 0,
        cache_creation_input_tokens: 0,
      } : null,
      sessionId: sessionId,
      lastStreamInputTokens: latestUsage ? latestUsage.input_tokens : null,
    });
    activeTurn = false;
    if (messages.length) writeNextMessage();
    else if (inputEnded && processHandle && processHandle.stdin) processHandle.stdin.end();
  }

  function handleStep(step) {
    if (!step) return;
    if (step.step_type === "agent_response") {
      if (!textBlockId) {
        textBlockId = "agy_blk_" + (++blockCounter);
        pushEvent({ yokeType: "text_start", blockId: textBlockId });
      }
      if (step.text_delta) pushEvent({ yokeType: "text_delta", blockId: textBlockId, text: step.text_delta });
      return;
    }
    if (step.step_type !== "tool") return;
    var info = step.tool_info || {};
    var id = "agy_tool_" + step.step_index;
    var name = toolName(step.tool_name || info.name);
    if (!toolBlocks[id]) {
      toolBlocks[id] = "agy_blk_" + (++blockCounter);
      pushEvent({ yokeType: "tool_start", blockId: toolBlocks[id], toolId: id, toolName: name });
      pushEvent({ yokeType: "tool_executing", blockId: toolBlocks[id], toolId: id, toolName: name, input: info.parameters || {} });
    }
    if (step.state === "DONE") {
      var error = info.error;
      pushEvent({
        yokeType: "tool_result",
        blockId: toolBlocks[id],
        toolId: id,
        content: error ? (error.message || String(error)) : (info.output || ""),
        isError: !!error,
      });
    }
  }

  function handleOutput(line) {
    var event;
    try { event = JSON.parse(line); } catch (e) { return; }
    if (event.event === "init") {
      sessionId = event.conversation_id || (event.init && event.init.conversation_id) || sessionId;
      return;
    }
    if (event.event === "step_update") {
      handleStep(event.step_update);
      return;
    }
    if (event.event === "result") finishTurn(event.result);
  }

  function start() {
    if (started || ended) return;
    started = true;
    var args = ["--input-format", "stream-json", "--output-format", "stream-json"];
    if (sessionId) args.push("--conversation", sessionId);
    if (model && model !== "auto") args.push("--model", model);
    if (effort) args.push("--effort", effort);
    if (toolPolicy === "allow-all") args.push("--dangerously-skip-permissions");
    var spawnProcess = queryOpts._spawn || childProcess.spawn;
    processHandle = spawnProcess(binaryPath, args, {
      cwd: queryOpts.cwd || process.cwd(),
      env: Object.assign({}, process.env, queryOpts.env || {}),
      stdio: ["pipe", "pipe", "pipe"],
    });
    outputReader = readline.createInterface({ input: processHandle.stdout });
    outputReader.on("line", handleOutput);
    processHandle.stderr.on("data", function(chunk) {
      stderr += String(chunk);
      if (stderr.length > 65536) stderr = stderr.slice(-65536);
    });
    processHandle.on("error", function(err) {
      pushEvent({ yokeType: "error", text: "Failed to start Antigravity CLI: " + err.message });
      endEvents();
    });
    processHandle.on("exit", function(code, signal) {
      if (!ended && activeTurn) {
        var message = stderr.trim() || "Antigravity CLI exited before completing the turn";
        pushEvent(isAuthError(message)
          ? { yokeType: "auth_required", vendor: "antigravity" }
          : { yokeType: "error", text: message + (code ? " (exit " + code + ")" : signal ? " (" + signal + ")" : "") });
      }
      endEvents();
    });
    writeNextMessage();
  }

  var handle = {
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (events.length) return Promise.resolve({ value: events.shift(), done: false });
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise(function(resolve) { eventWaiter = resolve; });
        },
      };
    },
    pushMessage: function(text, images) {
      if (ended || inputEnded) return false;
      messages.push(buildPrompt(text, images));
      if (!started) start();
      else writeNextMessage();
      return true;
    },
    setModel: function(value) {
      if (started) return Promise.reject(new Error("Antigravity CLI cannot switch models after a streaming session starts"));
      model = value || "auto";
      return Promise.resolve();
    },
    setEffort: function(value) {
      if (started) return Promise.reject(new Error("Antigravity CLI cannot switch effort after a streaming session starts"));
      effort = value || null;
      return Promise.resolve();
    },
    setToolPolicy: function(policy) {
      if (started) return Promise.reject(new Error("Antigravity CLI cannot switch tool policy after a streaming session starts"));
      toolPolicy = policy === "allow-all" ? "allow-all" : "ask";
      return Promise.resolve();
    },
    stopTask: function() { return Promise.resolve(); },
    getContextUsage: function() {
      if (!latestUsage) return Promise.resolve(null);
      return Promise.resolve({
        input_tokens: (latestUsage.input_tokens || 0) + (latestUsage.cache_read_tokens || 0),
        contextWindow: null,
      });
    },
    endInput: function() {
      inputEnded = true;
      if (!activeTurn && processHandle && processHandle.stdin) processHandle.stdin.end();
    },
    abort: function() {
      if (ended) return;
      pushEvent({ yokeType: "interrupted" });
      if (processHandle) processHandle.kill("SIGINT");
      endEvents();
    },
    close: function() {
      inputEnded = true;
      if (processHandle && processHandle.stdin) processHandle.stdin.end();
      endEvents();
    },
  };
  return handle;
}

function createAntigravityAdapter(opts) {
  opts = opts || {};
  var cwd = opts.cwd || process.cwd();
  var binaryPath = opts._binaryPath || null;
  var cachedModels = ["auto"];
  var activeHandles = [];

  function capabilities() {
    return {
      effort: true,
      midSessionModelSwitch: false,
      fork: false,
      rollback: false,
      sessionListing: false,
      sessionRename: false,
      thinking: false,
      betas: false,
      rewind: false,
      sessionResume: true,
      promptSuggestions: false,
      elicitation: false,
      fileCheckpointing: false,
      contextCompacting: false,
      queryBoundTools: { mode: "none", reason: "The current Clay adapter does not forward custom-tool configuration to agy." },
      skillSharing: true,
      toolPolicy: ["ask", "allow-all"],
    };
  }

  var adapter = {
    vendor: "antigravity",
    init: async function() {
      if (!binaryPath) binaryPath = findBinary();
      if (!binaryPath) throw new Error("Antigravity CLI binary not found: agy");
      var fetched = opts._fetchModels ? await opts._fetchModels(binaryPath, cwd) : await fetchModels(binaryPath, cwd);
      if (fetched && fetched.length) cachedModels = fetched;
      var skills = skillDiscovery.discoverSkills(cwd).map(function(skill) { return skill.name; });
      return {
        models: cachedModels.slice(),
        defaultModel: cachedModels[0] || "auto",
        skills: skills,
        slashCommands: skills,
        fastModeState: null,
        capabilities: capabilities(),
      };
    },
    supportedModels: function() { return Promise.resolve(cachedModels.slice()); },
    createToolServer: function() { return null; },
    createQuery: async function(queryOpts) {
      if (!binaryPath) await adapter.init();
      queryOpts = queryOpts || {};
      var antigravityOpts = (queryOpts.adapterOptions && queryOpts.adapterOptions.ANTIGRAVITY) || {};
      var handle;
      handle = createAntigravityQueryHandle(binaryPath, Object.assign({}, queryOpts, {
        dangerouslySkipPermissions: !!antigravityOpts.dangerouslySkipPermissions,
        env: antigravityOpts.env || queryOpts.env || null,
        _spawn: opts._spawn || null,
      }), function() {
        var index = activeHandles.indexOf(handle);
        if (index !== -1) activeHandles.splice(index, 1);
      });
      activeHandles.push(handle);
      return handle;
    },
    generateTitle: async function(messages, titleOpts) {
      var handle = await adapter.createQuery({
        cwd: (titleOpts && titleOpts.cwd) || cwd,
        env: titleOpts && titleOpts.env,
        systemPrompt: "Generate a concise conversation title of 3 to 8 words. Output only the title.",
      });
      var prompt = messages.join("\n");
      var title = "";
      handle.pushMessage(prompt);
      handle.endInput();
      for await (var event of handle) {
        if (event.yokeType === "text_delta") title += event.text;
      }
      return title.trim().replace(/^['\"]|['\"]$/g, "").slice(0, 80) || "New conversation";
    },
    shutdown: function() {
      var handles = activeHandles.slice();
      for (var i = 0; i < handles.length; i++) handles[i].abort();
      activeHandles = [];
      return Promise.resolve(true);
    },
  };
  return adapter;
}

module.exports = {
  createAntigravityAdapter: createAntigravityAdapter,
  createAntigravityQueryHandle: createAntigravityQueryHandle,
  fetchModels: fetchModels,
  parseModels: parseModels,
};
