var test = require("node:test");
var assert = require("node:assert");

var createAcpAdapter = require("../lib/yoke/adapters/acp").createAcpAdapter;
var createAcpQueryHandle = require("../lib/yoke/acp-query-handle").createAcpQueryHandle;
var getProfile = require("../lib/yoke/acp-agent-profiles").getAcpAgentProfile;

function FakeManager(executablePath, opts) {
  this.executablePath = executablePath;
  this.opts = opts;
  this.started = false;
  this.handlers = [];
  this.calls = [];
  FakeManager.instances.push(this);
}
FakeManager.instances = [];
FakeManager.prototype.start = function() { this.started = true; return Promise.resolve(); };
FakeManager.prototype.stop = function() { this.started = false; };
FakeManager.prototype.addRequestHandler = function(method, fn) {
  this.requestHandlers = this.requestHandlers || {};
  this.requestHandlers[method] = fn;
};
FakeManager.prototype.addHandler = function(fn) {
  var entry = { sessionId: null, fn: fn };
  this.handlers.push(entry);
  return entry;
};
FakeManager.prototype.removeHandler = function(entry) {
  var index = this.handlers.indexOf(entry);
  if (index !== -1) this.handlers.splice(index, 1);
};
FakeManager.prototype.notify = function(method, params) { this.calls.push({ method: method, params: params, notification: true }); };
FakeManager.prototype.respond = function(id, result) { this.calls.push({ id: id, result: result, response: true }); };
FakeManager.prototype.send = function(method, params) {
  this.calls.push({ method: method, params: params });
  if (method === "initialize") {
    return Promise.resolve({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
    });
  }
  if (method === "session/new") {
    return Promise.resolve(this.sessionResult || {
      sessionId: "session-1",
      configOptions: [{
        id: "model",
        category: "model",
        currentValue: "provider/default",
        options: [
          { value: "provider/default", name: "Default" },
          { value: "provider/fast", name: "Fast" },
        ],
      }, {
        id: "mode",
        category: "mode",
        currentValue: "auto-approve",
        options: [
          { value: "default", name: "Default" },
          { value: "auto-approve", name: "Auto approve" },
        ],
      }],
    });
  }
  if (method === "session/prompt") {
    var entry = this.handlers[0];
    entry.fn({
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
      },
    });
    return Promise.resolve({ stopReason: "end_turn" });
  }
  if (method === "session/set_config_option" && params.configId === "model" && this.rejectModelChange) {
    return Promise.reject(new Error("model rejected"));
  }
  return Promise.resolve({});
};

function adapterOptions(profile) {
  return {
    cwd: process.cwd(),
    _profile: profile,
    _binaryPath: "/contract/" + profile.binaryName,
    _AcpProcessManagerCtor: FakeManager,
    _fetchModels: function() { return Promise.resolve([]); },
    _openCodeAgentNames: [],
    _openCodeResolvedConfig: {
      permission: "ask",
      agent: {
        build: { permission: "ask" },
        plan: { permission: "ask" },
      },
    },
  };
}

test("OpenCode profile uses its official ACP entry point", function() {
  assert.deepStrictEqual(getProfile("opencode").args, ["acp"]);
});

test("new ACP profiles use their official supervised entry points", function() {
  assert.deepStrictEqual(getProfile("kimi").args, ["acp"]);
  assert.deepStrictEqual(getProfile("grok").args, ["--no-auto-update", "--permission-mode", "ask", "agent", "stdio"]);
  assert.deepStrictEqual(getProfile("copilot").args, ["--acp"]);
  assert.deepStrictEqual(getProfile("qwen").args, ["--acp", "--approval-mode", "default"]);
  assert.deepStrictEqual(getProfile("junie").args, ["--acp", "true"]);
});

test("new ACP vendor factories satisfy the shared YOKE contract", function() {
  var vendors = ["kimi", "grok", "copilot", "qwen", "junie"];
  for (var i = 0; i < vendors.length; i++) {
    var adapter = require("../lib/yoke").createAdapter({ vendor: vendors[i], cwd: process.cwd() });
    assert.strictEqual(adapter.vendor, vendors[i]);
    assert.strictEqual(typeof adapter.createQuery, "function");
  }
});

test("all six shared ACP production adapters replace the stdio bridge config on the next resumed query", async function () {
  var vendors = ["opencode", "kimi", "grok", "copilot", "qwen", "junie"];
  for (var i = 0; i < vendors.length; i++) {
    FakeManager.instances = [];
    var profile = getProfile(vendors[i]);
    var adapter = createAcpAdapter(vendors[i], adapterOptions(profile));
    await adapter.init();
    var freshDescriptor = { name: "clay-tools", command: process.execPath, args: ["bridge.js", "--session", "51", "--query-generation", "3"] };
    var resumedDescriptor = { name: "clay-tools", command: process.execPath, args: ["bridge.js", "--session", "51", "--query-generation", "4"] };
    var fresh = await adapter.createQuery({ cwd: process.cwd(), adapterOptions: { ACP: { mcpServers: [freshDescriptor] } } });
    fresh.pushMessage("fresh");
    for await (var freshEvent of fresh) { if (freshEvent.yokeType === "result") break; }
    fresh.close();
    var resumed = await adapter.createQuery({ cwd: process.cwd(), resumeSessionId: "session-1", adapterOptions: { ACP: { mcpServers: [resumedDescriptor] } } });
    resumed.pushMessage("resumed");
    for await (var resumedEvent of resumed) { if (resumedEvent.yokeType === "result") break; }
    resumed.close();
    var manager = FakeManager.instances[0];
    var freshCall = manager.calls.find(function (call) { return call.method === "session/new"; });
    var resumeCall = manager.calls.find(function (call) { return call.method === "session/resume"; });
    assert.deepEqual(freshCall.params.mcpServers, [freshDescriptor], vendors[i] + " fresh catalog");
    assert.deepEqual(resumeCall.params.mcpServers, [resumedDescriptor], vendors[i] + " replacement catalog");
    await adapter.shutdown();
  }
});

["kimi", "copilot", "junie"].forEach(function(vendor) {
  test(vendor + " ACP profile replaces an exposed unsafe mode before prompting", async function() {
    FakeManager.instances = [];
    var adapter = createAcpAdapter(vendor, adapterOptions(getProfile(vendor)));
    await adapter.init();
    var handle = await adapter.createQuery({ cwd: process.cwd(), model: "auto" });
    handle.pushMessage("permission mode test");
    for await (var event of handle) {
      if (event.yokeType === "result") break;
    }
    assert.ok(FakeManager.instances[0].calls.some(function(call) {
      return call.method === "session/set_config_option" && call.params.configId === "mode" && call.params.value === "default";
    }));
    handle.close();
    await adapter.shutdown();
  });
});

test("OpenCode derives session resume support from the ACP handshake", async function() {
  FakeManager.instances = [];
  var options = adapterOptions(getProfile("opencode"));
  options._openCodeAgentNames = ["custom"];
  options.env = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      theme: "clay",
      agent: { custom: { model: "provider/custom", permission: "allow" } },
    }),
  };
  var adapter = createAcpAdapter("opencode", options);
  var ready = await adapter.init();
  assert.strictEqual(ready.capabilities.sessionResume, true);
  assert.deepStrictEqual(FakeManager.instances[0].opts.args, ["acp"]);
  var enforced = JSON.parse(FakeManager.instances[0].opts.env.OPENCODE_CONFIG_CONTENT);
  assert.strictEqual(enforced.permission, "ask");
  assert.strictEqual(enforced.theme, "clay");
  assert.deepStrictEqual(enforced.agent.custom, { model: "provider/custom", permission: "ask" });
  assert.strictEqual(enforced.agent.build.permission, "ask");
  assert.strictEqual(enforced.agent.plan.permission, "ask");
  await adapter.shutdown();
});

test("ACP adapter forwards the scoped environment to its process manager", async function() {
  FakeManager.instances = [];
  var adapter = createAcpAdapter("opencode", adapterOptions(getProfile("opencode")));
  await adapter.init({ env: { PROJECT_TOKEN: "scoped" } });
  assert.strictEqual(FakeManager.instances[0].opts.env.PROJECT_TOKEN, "scoped");
  await adapter.shutdown();
});

test("OpenCode rejects late configuration that restores permissive agent rules", async function() {
  FakeManager.instances = [];
  var options = adapterOptions(getProfile("opencode"));
  options._openCodeResolvedConfig = {
    permission: "ask",
    agent: {
      build: { permission: "ask" },
      managed: { permission: { edit: "allow", bash: "ask" } },
    },
  };
  var adapter = createAcpAdapter("opencode", options);
  await assert.rejects(adapter.init(), /unsafe resolved permissions: managed/);
  assert.strictEqual(FakeManager.instances.length, 0);
});

test("OpenCode rejects late configuration that replaces the global ask rule", async function() {
  FakeManager.instances = [];
  var options = adapterOptions(getProfile("opencode"));
  options._openCodeResolvedConfig = { permission: "allow", agent: {} };
  var adapter = createAcpAdapter("opencode", options);
  await assert.rejects(adapter.init(), /does not preserve global ask permissions/);
  assert.strictEqual(FakeManager.instances.length, 0);
});

test("OpenCode accepts normalized safe recursive ask/deny permissions", function() {
  var validate = require("../lib/yoke/acp-agent-profiles").validateOpenCodeConfig;
  assert.doesNotThrow(function() {
    validate({ permission: { "*": "ask", edit: "deny", shell: { read: "ask" } }, agent: {
      build: { permission: { edit: "ask", shell: "deny" } },
    } });
  });
  assert.doesNotThrow(function() { validate({ permission: "ask", agent: {} }); });
  assert.throws(function() { validate({ permission: {}, agent: {} }); }, /global ask permissions/);
  assert.throws(function() { validate({ permission: { "*": "allow" }, agent: {} }); }, /global ask permissions/);
  assert.throws(function() { validate({ permission: { "*": "ask" }, agent: { build: { permission: { shell: "allow" } } } }); }, /unsafe resolved permissions: build/);
  assert.throws(function() { validate({ permission: { "*": "ask" }, agent: { build: { permission: {} } } }); }, /unsafe resolved permissions: build/);
  assert.throws(function() { validate({ permission: { "*": "ask" }, agent: { build: null } }); }, /malformed resolved configuration: build/);
});

test("ACP shutdown cancels in-flight initialization without poisoning retry", async function() {
  FakeManager.instances = [];
  var releaseModels;
  var fetchCount = 0;
  var options = adapterOptions(getProfile("opencode"));
  options._fetchModels = function() {
    fetchCount++;
    if (fetchCount > 1) return Promise.resolve([]);
    return new Promise(function(resolve) { releaseModels = resolve; });
  };
  var adapter = createAcpAdapter("opencode", options);
  var initPromise = adapter.init();
  var rejected = assert.rejects(initPromise, /adapter is shutting down/);
  await new Promise(function(resolve) { setImmediate(resolve); });
  var shutdownPromise = adapter.shutdown();
  releaseModels([]);
  await rejected;
  assert.strictEqual(await shutdownPromise, true);
  assert.strictEqual(FakeManager.instances.length, 0);

  await adapter.init();
  assert.strictEqual(FakeManager.instances.length, 1);
  assert.strictEqual(FakeManager.instances[0].started, true);
  await adapter.shutdown();
});

test("shared ACP adapter streams standard updates through the YOKE contract", async function() {
  FakeManager.instances = [];
  var adapter = createAcpAdapter("opencode", adapterOptions(getProfile("opencode")));
  await adapter.init();
  var handle = await adapter.createQuery({
    cwd: process.cwd(),
    model: "provider/default",
    adapterOptions: { ACP: { mcpServers: [{ name: "clay-tools", command: "node", args: ["bridge.js"], env: [] }] } },
  });
  assert.strictEqual(handle.pushMessage("hello"), true);
  handle.endInput();
  assert.strictEqual(handle.pushMessage("must not queue"), false);
  var events = [];
  for await (var event of handle) {
    events.push(event);
  }
  handle.close();
  assert.ok(events.some(function(event) { return event.yokeType === "text_delta" && event.text === "hello"; }));
  assert.ok(events.some(function(event) { return event.yokeType === "result" && event.sessionId === "session-1"; }));
  assert.ok(FakeManager.instances[0].calls.some(function(call) {
    return call.method === "session/set_config_option" && call.params.configId === "model";
  }));
  assert.strictEqual(FakeManager.instances[0].calls.some(function(call) {
    return call.method === "session/set_config_option" && call.params.configId === "mode";
  }), false);
  var newSessionCall = FakeManager.instances[0].calls.find(function(call) { return call.method === "session/new"; });
  assert.strictEqual(newSessionCall.params.mcpServers[0].name, "clay-tools");
  await adapter.shutdown();
});

test("ACP vendor drivers extend YOKE without replacing the shared defaults", async function() {
  FakeManager.instances = [];
  var flags = {
    registered: false,
    initialized: false,
    sessionReady: false,
    opened: false,
    supervised: false,
    prompted: false,
    stopped: false,
    cancelled: false,
    shutdown: false,
  };
  var driver = Object.assign({}, getProfile("opencode"), {
    buildProcessOptions: function(ctx, base) {
      base.args = base.args.concat(["--vendor-extension"]);
      return base;
    },
    buildInitializeParams: function(ctx, base) {
      base._meta = { vendorExtension: true };
      return base;
    },
    registerRequestHandlers: function(ctx) {
      ctx.acp.addRequestHandler("vendor/token", function() { return { token: "test" }; });
      flags.registered = true;
    },
    onInitialize: function() { flags.initialized = true; },
    extendCapabilities: function() { return { effort: true, sessionListing: true }; },
    extendReadyResult: function(ctx, next) {
      var result = next();
      result.vendorReady = true;
      return result;
    },
    supportedModels: function() { return ["vendor/rich-model"]; },
    buildSessionParams: function(ctx, base) {
      base._meta = { operation: ctx.operation };
      return base;
    },
    afterSessionOpen: function() { flags.sessionReady = true; },
    openSession: function(ctx, next) { flags.opened = true; return next(); },
    ensureSafePermissionMode: function(ctx, next) { flags.supervised = true; return next(); },
    setModel: function(ctx) {
      return ctx.acp.send("vendor/set_model", { sessionId: ctx.state.sessionId, model: ctx.model });
    },
    buildPromptParams: function(ctx, base) {
      base._meta = { vendorPrompt: true };
      return base;
    },
    prompt: function(ctx, next) { flags.prompted = true; return next(); },
    normalizeUpdate: function(ctx, next) {
      var events = next();
      events.push({ yokeType: "runtime_specific", vendor: ctx.vendor, eventType: "vendor/extra" });
      return events;
    },
    buildResult: function(ctx, next) {
      var event = next();
      event.vendorUsage = { credits: 2 };
      return event;
    },
    createToolServer: function(ctx) { return { definition: ctx.definition, vendor: ctx.vendor }; },
    listSessions: function() { return [{ sessionId: "vendor-session" }]; },
    stopTask: function() { flags.stopped = true; },
    getContextUsage: function() { return { vendorTokens: 9 }; },
    cancel: function() { flags.cancelled = true; },
    onShutdown: function() { flags.shutdown = true; },
  });
  var adapter = createAcpAdapter("opencode", adapterOptions(driver));
  var ready = await adapter.init();
  var manager = FakeManager.instances[0];
  assert.strictEqual(ready.capabilities.effort, true);
  assert.strictEqual(ready.capabilities.sessionListing, true);
  assert.strictEqual(ready.vendorReady, true);
  assert.deepStrictEqual(await adapter.supportedModels(), ["vendor/rich-model"]);
  assert.strictEqual(flags.registered, true);
  assert.strictEqual(flags.initialized, true);
  assert.ok(manager.requestHandlers["vendor/token"]);
  assert.deepStrictEqual(manager.opts.args, ["acp", "--vendor-extension"]);
  assert.deepStrictEqual(manager.calls[0].params._meta, { vendorExtension: true });
  assert.deepStrictEqual(adapter.createToolServer({ name: "tool" }), {
    definition: { name: "tool" },
    vendor: "opencode",
  });
  assert.deepStrictEqual(await adapter.listSessions(), [{ sessionId: "vendor-session" }]);

  var handle = await adapter.createQuery({ cwd: process.cwd(), model: "provider/default" });
  handle.pushMessage("extension test");
  var events = [];
  for await (var event of handle) {
    events.push(event);
    if (event.yokeType === "result") break;
  }
  handle.close();
  assert.strictEqual(flags.sessionReady, true);
  assert.strictEqual(flags.opened, true);
  assert.strictEqual(flags.supervised, true);
  assert.strictEqual(flags.prompted, true);
  var newCall = manager.calls.find(function(call) { return call.method === "session/new"; });
  var promptCall = manager.calls.find(function(call) { return call.method === "session/prompt"; });
  assert.deepStrictEqual(newCall.params._meta, { operation: "new" });
  assert.deepStrictEqual(promptCall.params._meta, { vendorPrompt: true });
  assert.ok(manager.calls.some(function(call) { return call.method === "vendor/set_model"; }));
  assert.ok(events.some(function(event) { return event.eventType === "vendor/extra"; }));
  assert.deepStrictEqual(events.find(function(event) { return event.yokeType === "result"; }).vendorUsage, { credits: 2 });
  await handle.stopTask("task-1");
  assert.strictEqual(flags.stopped, true);
  assert.deepStrictEqual(await handle.getContextUsage(), { vendorTokens: 9 });
  var cancelledHandle = await adapter.createQuery({ cwd: process.cwd() });
  cancelledHandle.abort();
  assert.strictEqual(flags.cancelled, true);
  await adapter.shutdown();
  assert.strictEqual(flags.shutdown, true);
});

test("shared ACP permission routing returns the nested selected outcome", async function() {
  var manager = new FakeManager("/contract/acp", {});
  manager.started = true;
  var seenTool = null;
  var handle = createAcpQueryHandle(manager, {
    vendor: "opencode",
    cwd: process.cwd(),
    driver: {
      mapPermissionRequest: function(ctx, next) {
        var mapped = next();
        mapped.toolName = "VendorExecute";
        mapped.input = { command: "vendor-command" };
        return mapped;
      },
      buildPermissionResponse: function(ctx, next) {
        var result = next();
        result._meta = { vendorPermission: true };
        return result;
      },
    },
    canUseTool: function(toolName, input) {
      seenTool = { toolName: toolName, input: input };
      return Promise.resolve({ behavior: "allow" });
    },
  });
  handle.pushMessage("permission test");
  await new Promise(function(resolve) { setImmediate(resolve); });
  manager.handlers[0].fn({
    id: 42,
    method: "session/request_permission",
    params: {
      sessionId: "session-1",
      toolCall: { toolCallId: "tool-1", kind: "execute", title: "Run" },
      options: [
        { optionId: "allow-forever", kind: "allow_always" },
        { optionId: "allow", kind: "allow_once" },
        { optionId: "deny-forever", kind: "reject_always" },
        { optionId: "deny", kind: "reject_once" },
      ],
    },
  });
  await new Promise(function(resolve) { setImmediate(resolve); });
  var response = manager.calls.find(function(call) { return call.response && call.id === 42; });
  assert.deepStrictEqual(seenTool, { toolName: "VendorExecute", input: { command: "vendor-command" } });
  assert.deepStrictEqual(response.result, {
    outcome: { outcome: "selected", optionId: "allow" },
    _meta: { vendorPermission: true },
  });
  handle.abort();
});

[
  "yolo",
  "auto_edit",
].forEach(function(unsafeMode) {
  test("shared ACP sessions fail closed for unsafe mode " + unsafeMode, async function() {
    var manager = new FakeManager("/contract/acp", {});
    manager.started = true;
    manager.sessionResult = {
      sessionId: "unsafe-session",
      configOptions: [{
        id: "mode",
        category: "mode",
        currentValue: unsafeMode,
        options: [{ value: unsafeMode, name: "Unsafe" }],
      }],
    };
    var handle = createAcpQueryHandle(manager, { vendor: "opencode", cwd: process.cwd() });
    handle.pushMessage("must not run");
    var errors = [];
    for await (var event of handle) {
      if (event.yokeType === "error") errors.push(event.text);
    }
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /unsafe permission mode/);
    assert.strictEqual(manager.calls.some(function(call) { return call.method === "session/prompt"; }), false);
  });
});

test("shared ACP model changes propagate agent rejection", async function() {
  var manager = new FakeManager("/contract/acp", {});
  manager.started = true;
  manager.rejectModelChange = true;
  var handle = createAcpQueryHandle(manager, {
    vendor: "opencode",
    driver: getProfile("opencode"),
    cwd: process.cwd(),
    model: "auto",
  });
  handle.pushMessage("model test");
  var sawResult = false;
  for await (var event of handle) {
    if (event.yokeType === "result") {
      sawResult = true;
      break;
    }
  }
  assert.strictEqual(sawResult, true);
  await assert.rejects(handle.setModel("provider/fast"), /model rejected/);
  handle.close();
});
