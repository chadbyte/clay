// Shared ACP Adapter
// ------------------
// Implements the YOKE Adapter contract once for standard ACP agents.

var AcpProcessManager = require("../acp-process-manager").AcpProcessManager;
var INITIALIZE_TIMEOUT_MS = require("../interface").INITIALIZE_TIMEOUT_MS;
var createAcpQueryHandle = require("../acp-query-handle").createAcpQueryHandle;
var profiles = require("../acp-agent-profiles");
var driverRuntime = require("../acp-driver-runtime");
var skillDiscovery = require("../skill-discovery");

function modelValues(configOptions) {
  var models = [];
  var options = Array.isArray(configOptions) ? configOptions : [];
  for (var i = 0; i < options.length; i++) {
    var option = options[i];
    if (option.category !== "model" && option.id !== "model") continue;
    var values = Array.isArray(option.options) ? option.options : [];
    for (var j = 0; j < values.length; j++) {
      var value = values[j] && values[j].value;
      if (value && models.indexOf(value) === -1) models.push(value);
    }
    break;
  }
  return models;
}

function createAcpAdapter(vendor, opts) {
  opts = opts || {};
  var driver = opts._profile || opts._driver || profiles.getAcpAgentDriver(vendor);
  if (!driver) throw new Error("[YOKE] Unknown ACP agent driver: " + vendor);

  var cwd = opts.cwd || process.cwd();
  var binaryPath = opts._binaryPath || profiles.findAcpAgentPath(driver);
  var ProcessManagerCtor = opts._AcpProcessManagerCtor || AcpProcessManager;
  var fetchModels = opts._fetchModels || driver.fetchModels || null;
  var acp = null;
  var initPromise = null;
  var initialized = false;
  var shuttingDown = false;
  var initResult = null;
  var driverState = {};
  var cachedModels = (driver.defaultModels || []).slice();
  var defaultModel = driver.defaultModel || cachedModels[0] || "auto";
  var activeHandles = [];
  var lastActiveAt = Date.now();
  var skillEnv = opts.env || process.env;

  function context(extra) {
    return Object.assign({
      vendor: vendor,
      cwd: cwd,
      driver: driver,
      acp: acp,
      initResult: initResult,
      adapter: adapter,
      binaryPath: binaryPath,
      driverState: driverState,
    }, extra || {});
  }

  function supportsSessionCapability(name) {
    var capabilities = initResult && initResult.agentCapabilities;
    return !!(capabilities && capabilities.sessionCapabilities && capabilities.sessionCapabilities[name]);
  }

  function canLoadSession() {
    if (driver.sessionResume === false) return false;
    return !!(initResult && initResult.agentCapabilities && initResult.agentCapabilities.loadSession);
  }

  function canResumeSession() {
    if (driver.sessionResume === false) return false;
    return supportsSessionCapability("resume");
  }

  function capabilities() {
    var base = {
      effort: false,
      midSessionModelSwitch: false,
      fork: false,
      rollback: false,
      sessionListing: false,
      sessionRename: false,
      thinking: true,
      betas: false,
      rewind: false,
      sessionResume: canResumeSession() || canLoadSession(),
      promptSuggestions: false,
      elicitation: false,
      fileCheckpointing: false,
      contextCompacting: false,
      skillSharing: true,
      toolPolicy: ["ask", "allow-all"],
    };
    return driverRuntime.mergeCapabilities(driver, context(), base);
  }

  function readyResult() {
    var skills = skillDiscovery.discoverSkills(cwd, { env: skillEnv }).map(function(skill) { return skill.name; });
    var result = {
      models: cachedModels.slice(),
      defaultModel: defaultModel,
      skills: skills,
      slashCommands: skills,
      fastModeState: null,
      capabilities: capabilities(),
    };
    return driverRuntime.call(driver, "extendReadyResult", context({ result: result }), function() { return result; }) || result;
  }

  function updateModelsFromSession(sessionResult) {
    var discovered = modelValues(sessionResult && sessionResult.configOptions);
    if (!discovered.length) return;
    cachedModels = discovered;
    var configOptions = sessionResult.configOptions;
    for (var i = 0; i < configOptions.length; i++) {
      if (configOptions[i].category === "model" || configOptions[i].id === "model") {
        defaultModel = configOptions[i].currentValue || defaultModel;
        break;
      }
    }
  }

  function removeHandle(handle) {
    var index = activeHandles.indexOf(handle);
    if (index !== -1) activeHandles.splice(index, 1);
    lastActiveAt = Date.now();
  }

  var adapter = {
    vendor: vendor,

    init: function(initOpts) {
      if (shuttingDown) return Promise.reject(new Error(driver.displayName + " adapter is shutting down"));
      if (initialized && acp && acp.started) return Promise.resolve(readyResult());
      if (initPromise) return initPromise;

      initPromise = (async function() {
        if (!binaryPath) {
          binaryPath = profiles.findAcpAgentPath(driver);
          if (!binaryPath) throw new Error(driver.displayName + " binary not found: " + driver.binaryName);
        }
        var effectiveOpts = Object.assign({}, opts, initOpts || {});
        var prepared = await Promise.all([
          fetchModels ? fetchModels(binaryPath, cwd) : Promise.resolve([]),
          driverRuntime.callAsync(driver, "prepare", context({ initOpts: effectiveOpts }), function() {}),
        ]);
        if (fetchModels) {
          var fetched = prepared[0];
          if (Array.isArray(fetched) && fetched.length) {
            cachedModels = fetched;
            if (cachedModels.indexOf(defaultModel) === -1) defaultModel = cachedModels[0];
          }
        }
        if (shuttingDown) throw new Error(driver.displayName + " adapter is shutting down");

        var processOptions = driverRuntime.buildParams(driver, "buildProcessOptions", context({ initOpts: effectiveOpts }), {
          args: driver.args || [],
          cwd: cwd,
          env: effectiveOpts.env || null,
          logPrefix: vendor + "-acp",
        });
        await driverRuntime.callAsync(driver, "validateProcessOptions", context({
          initOpts: effectiveOpts,
          processOptions: processOptions,
        }), function() {});
        if (shuttingDown) throw new Error(driver.displayName + " adapter is shutting down");
        acp = new ProcessManagerCtor(binaryPath, processOptions);
        await driverRuntime.callAsync(driver, "registerRequestHandlers", context({ acp: acp }), function() {});
        if (shuttingDown) throw new Error(driver.displayName + " adapter is shutting down");
        await acp.start();
        try {
          if (shuttingDown) throw new Error(driver.displayName + " adapter is shutting down");
          var initializeParams = driverRuntime.buildParams(driver, "buildInitializeParams", context({ acp: acp }), {
            protocolVersion: 1,
            clientInfo: { name: "clay", version: "1.0.0" },
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              session: { configOptions: { boolean: {} } },
            },
          });
          initResult = await acp.send("initialize", initializeParams, INITIALIZE_TIMEOUT_MS);
          await driverRuntime.callAsync(driver, "onInitialize", context({ acp: acp, initResult: initResult }), function() {});
          if (shuttingDown) throw new Error(driver.displayName + " adapter is shutting down");
        } catch (e) {
          acp.stop();
          acp = null;
          throw e;
        }
        initialized = true;
        lastActiveAt = Date.now();
        return readyResult();
      })().then(function(result) {
        initPromise = null;
        return result;
      }, function(err) {
        initPromise = null;
        initialized = false;
        throw err;
      });
      return initPromise;
    },

    supportedModels: function() {
      return driverRuntime.callAsync(driver, "supportedModels", context({ models: cachedModels.slice() }), function() {
        if (!fetchModels || !binaryPath) return cachedModels.slice();
        return fetchModels(binaryPath, cwd).then(function(fetched) {
          if (Array.isArray(fetched) && fetched.length) cachedModels = fetched;
          return cachedModels.slice();
        });
      });
    },

    createToolServer: function(definition) {
      return driverRuntime.call(driver, "createToolServer", context({ definition: definition }), function() { return null; });
    },

    createQuery: async function(queryOpts) {
      queryOpts = queryOpts || {};
      if (!initialized || !acp || !acp.started) await adapter.init(queryOpts);
      if (shuttingDown) throw new Error(driver.displayName + " adapter is shutting down");
      var controller = queryOpts.abortController || new AbortController();
      var sharedSkills = queryOpts.skipSkills ? [] : skillDiscovery.discoverSkills(queryOpts.cwd || cwd, queryOpts.skillOptions || { env: queryOpts.env || skillEnv });
      var skillIndex = skillDiscovery.buildSkillIndex(sharedSkills);
      var acpOptions = (queryOpts.adapterOptions && queryOpts.adapterOptions.ACP) || {};
      var handle = null;
      handle = createAcpQueryHandle(acp, {
        vendor: vendor,
        driver: driver,
        cwd: queryOpts.cwd || cwd,
        model: queryOpts.model || defaultModel,
        mode: queryOpts.mode || null,
        systemPrompt: queryOpts.systemPrompt || "",
        appendSystemPrompt: [queryOpts.appendSystemPrompt, skillIndex].filter(function(part) { return !!part; }).join("\n\n"),
        abortController: controller,
        canUseTool: queryOpts.canUseTool || null,
        resumeSessionId: queryOpts.resumeSessionId || null,
        canLoadSession: canLoadSession(),
        canResumeSession: canResumeSession(),
        mcpServers: acpOptions.mcpServers || queryOpts.mcpServers || [],
        onSessionReady: updateModelsFromSession,
        onFinished: function() { removeHandle(handle); },
      });
      activeHandles.push(handle);
      lastActiveAt = Date.now();
      return handle;
    },

    generateTitle: async function(messages, titleOpts) {
      if (driverRuntime.hasHook(driver, "generateTitle")) {
        return driver.generateTitle(context({ messages: messages, opts: titleOpts }));
      }
      var prompt = "Generate a short descriptive title of 3 to 8 words. Output only the title.\n\n";
      for (var i = 0; i < messages.length; i++) prompt += "User message " + (i + 1) + ": " + messages[i] + "\n";
      var handle = await adapter.createQuery({
        cwd: (titleOpts && titleOpts.cwd) || cwd,
        env: titleOpts && titleOpts.env,
        systemPrompt: "You generate concise conversation titles. Output only the title.",
        canUseTool: function() { return Promise.resolve({ behavior: "deny" }); },
      });
      handle.pushMessage(prompt);
      var title = "";
      try {
        for await (var event of handle) {
          if (event.yokeType === "text_delta" && event.text) title += event.text;
          if (event.yokeType === "result") break;
        }
      } finally {
        handle.close();
      }
      return title.replace(/[\r\n]+/g, " ").replace(/^["'\s]+|["'\s.]+$/g, "").trim();
    },

    getSessionInfo: function(sessionId, methodOpts) {
      return driverRuntime.callAsync(driver, "getSessionInfo", context({ sessionId: sessionId, opts: methodOpts }), function() { return null; });
    },
    listSessions: function(methodOpts) {
      return driverRuntime.callAsync(driver, "listSessions", context({ opts: methodOpts }), function() { return []; });
    },
    renameSession: function(sessionId, title, methodOpts) {
      return driverRuntime.callAsync(driver, "renameSession", context({ sessionId: sessionId, title: title, opts: methodOpts }), function() {});
    },
    forkSession: function(sessionId, methodOpts) {
      return driverRuntime.callAsync(driver, "forkSession", context({ sessionId: sessionId, opts: methodOpts }), function() { return null; });
    },

    shutdown: async function() {
      shuttingDown = true;
      var pendingInit = initPromise;
      if (acp) acp.stop();
      if (pendingInit) {
        try { await pendingInit; } catch (e) {}
      }
      var handles = activeHandles.slice();
      for (var i = 0; i < handles.length; i++) handles[i].abort();
      activeHandles = [];
      try {
        if (acp) acp.stop();
        await driverRuntime.callAsync(driver, "onShutdown", context(), function() {});
      } finally {
        acp = null;
        initialized = false;
        shuttingDown = false;
      }
      return true;
    },

    shutdownIfIdle: function(idleMs) {
      if (!acp || activeHandles.length || Date.now() - lastActiveAt < (idleMs || 0)) return Promise.resolve(false);
      return adapter.shutdown();
    },
  };
  return adapter;
}

module.exports = {
  createAcpAdapter: createAcpAdapter,
  modelValues: modelValues,
};
