var test = require("node:test");
var assert = require("node:assert");

var { createKiroAdapter } = require("../lib/yoke/adapters/kiro");
var createKiroQueryHandle = require("../lib/yoke/adapters/kiro").contractTestKit.createQueryHandle;

test("v3 resume suppresses replay and configures supervised model selection", async function() {
  var calls = [];

  function FakeAcpServer() {
    this.started = false;
    this.handlers = [];
    this.proc = null;
  }

  FakeAcpServer.prototype.start = function() {
    this.started = true;
    return Promise.resolve();
  };

  FakeAcpServer.prototype.addRequestHandler = function() {};

  FakeAcpServer.prototype.addHandler = function(fn) {
    var entry = { sessionId: null, fn: fn };
    this.handlers.push(entry);
    return entry;
  };

  FakeAcpServer.prototype.removeHandler = function(entry) {
    var index = this.handlers.indexOf(entry);
    if (index !== -1) this.handlers.splice(index, 1);
  };

  FakeAcpServer.prototype.send = function(method, params) {
    calls.push({ method: method, params: params });
    if (method === "initialize") return Promise.resolve({ protocolVersion: 1 });
    if (method === "session/new") return Promise.resolve({ sessionId: "sess-fresh" });
    if (method === "session/load") {
      this.handlers[0].fn({
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OLD" } },
        },
      });
      return Promise.resolve({});
    }
    if (method === "session/prompt") {
      this.handlers[0].fn({
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "NEW" } },
        },
      });
      this.handlers[0].fn({
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "session_info_update",
            _meta: { kiro: { kind: "context_usage", contextUsage: { usagePercentage: 10 } } },
          },
        },
      });
      return Promise.resolve({ stopReason: "end_turn" });
    }
    return Promise.resolve({});
  };

  FakeAcpServer.prototype.notify = function() {};
  FakeAcpServer.prototype.stop = function() { this.started = false; };

  var adapter = createKiroAdapter({
    cwd: process.cwd(),
    _binaryPath: "/fake/kiro-cli",
    _AcpServerCtor: FakeAcpServer,
    _fetchKasToken: function() { return Promise.resolve({ accessToken: "token" }); },
    _fetchModels: function() {
      return Promise.resolve({
        models: ["auto"],
        defaultModel: "auto",
        contextWindows: { auto: 1000 },
      });
    },
  });

  await adapter.init();
  var bridgeDescriptor = { name: "clay-tools", command: "/usr/bin/node", args: ["bridge.js", "--session", "7", "--query-generation", "2"] };
  var freshHandle = await adapter.createQuery({
    cwd: process.cwd(), model: "auto",
    adapterOptions: { KIRO: { mode: "vibe", mcpServers: [bridgeDescriptor] } },
  });
  freshHandle.pushMessage("fresh");
  for await (var freshEvent of freshHandle) { if (freshEvent.yokeType === "result") break; }
  freshHandle.close();
  var disabledHandle = await adapter.createQuery({
    cwd: process.cwd(),
    model: "auto",
    skillOptions: { disable: true },
    adapterOptions: { KIRO: { mode: "vibe", mcpServers: [bridgeDescriptor] } },
  });
  disabledHandle.pushMessage("disabled");
  for await (var disabledEvent of disabledHandle) { if (disabledEvent.yokeType === "result") break; }
  disabledHandle.close();
  var handle = await adapter.createQuery({
    cwd: process.cwd(),
    model: "auto",
    systemPrompt: "Base instructions",
    appendSystemPrompt: "You are the Driver",
    resumeSessionId: "sess-existing",
    adapterOptions: { KIRO: { mode: "vibe", mcpServers: [bridgeDescriptor] } },
    canUseTool: function() { return Promise.resolve({ behavior: "deny" }); },
  });
  handle.pushMessage("hello");

  var text = "";
  var result = null;
  for await (var event of handle) {
    if (event.yokeType === "text_delta") text += event.text;
    if (event.yokeType === "result") { result = event; break; }
  }
  handle.close();
  await adapter.shutdown();

  assert.strictEqual(text, "NEW");
  assert.strictEqual(result.sessionId, "sess-existing");
  assert.strictEqual(result.usage.input_tokens, 100);
  assert.ok(calls.some(function(call) {
    return call.method === "session/set_config_option"
      && call.params.configId === "autopilot"
      && call.params.value === "off";
  }));
  assert.ok(calls.some(function(call) {
    return call.method === "session/set_config_option"
      && call.params.configId === "model"
      && call.params.value === "auto";
  }));
  assert.ok(!calls.some(function(call) { return call.method === "session/set_model"; }));
  var newCall = calls.find(function(call) { return call.method === "session/new"; });
  var loadCall = calls.find(function(call) { return call.method === "session/load"; });
  assert.deepEqual(newCall.params.mcpServers, [bridgeDescriptor]);
  assert.deepEqual(loadCall.params.mcpServers, [bridgeDescriptor]);
  var promptCall = calls.find(function(call) { return call.method === "session/prompt" && call.params.sessionId === "sess-existing"; });
  assert.match(promptCall.params.prompt[0].text, /Base instructions/);
  assert.match(promptCall.params.prompt[0].text, /You are the Driver/);
  var disabledPromptCall = calls.find(function(call) {
    return call.method === "session/prompt" && call.params.prompt[0].text === "disabled";
  });
  assert.ok(disabledPromptCall);
  assert.doesNotMatch(disabledPromptCall.params.prompt[0].text, /Available shared skills/);
});

function createQueryServer(send) {
  return {
    started: true,
    calls: [],
    responses: [],
    handlers: [],
    send: send,
    addHandler: function(fn) { var entry = { sessionId: null, fn: fn }; this.handlers.push(entry); return entry; },
    removeHandler: function(entry) { var index = this.handlers.indexOf(entry); if (index !== -1) this.handlers.splice(index, 1); },
    notify: function() {},
    respond: function(id, result) { this.responses.push({ id: id, result: result }); },
  };
}

test("Kiro resume and requested configuration failures stop before prompting", async function() {
  var loadServer = createQueryServer(function(method, params) {
    this.calls.push({ method: method, params: params });
    if (method === "session/load") return Promise.reject(new Error("resume unavailable"));
    return Promise.resolve({ sessionId: "must-not-replace" });
  });
  var loadHandle = createKiroQueryHandle(loadServer, {
    cwd: process.cwd(), engine: "v3", model: "auto", resumeSessionId: "existing", mcpServers: [],
  });
  loadHandle.pushMessage("resume");
  var loadErrors = [];
  for await (var loadEvent of loadHandle) if (loadEvent.yokeType === "error") loadErrors.push(loadEvent.text);
  assert.deepStrictEqual(loadErrors, ["resume unavailable"]);
  assert.strictEqual(loadServer.calls.some(function(call) { return call.method === "session/new"; }), false);
  assert.strictEqual(loadServer.calls.some(function(call) { return call.method === "session/prompt"; }), false);

  var configServer = createQueryServer(function(method, params) {
    this.calls.push({ method: method, params: params });
    if (method === "session/new") return Promise.resolve({ sessionId: "fresh" });
    if (method === "session/set_config_option" && params.configId === "model") return Promise.reject(new Error("model unavailable"));
    return Promise.resolve({});
  });
  var configHandle = createKiroQueryHandle(configServer, {
    cwd: process.cwd(), engine: "v3", model: "model-x", mcpServers: [],
  });
  configHandle.pushMessage("configured");
  var configErrors = [];
  for await (var configEvent of configHandle) if (configEvent.yokeType === "error") configErrors.push(configEvent.text);
  assert.deepStrictEqual(configErrors, ["model unavailable"]);
  assert.strictEqual(configServer.calls.some(function(call) { return call.method === "session/prompt"; }), false);
});

test("Kiro cancels permission requests with unrecognized option kinds", async function() {
  var promptResolve;
  var seenTool = null;
  var server = createQueryServer(function(method, params) {
    this.calls.push({ method: method, params: params });
    if (method === "session/new") return Promise.resolve({ sessionId: "fresh" });
    if (method === "session/prompt") return new Promise(function(resolve) { promptResolve = resolve; });
    return Promise.resolve({});
  });
  var handle = createKiroQueryHandle(server, {
    cwd: process.cwd(), engine: "v3", model: "auto", mcpServers: [],
    canUseTool: function(toolName, input) { seenTool = { toolName: toolName, input: input }; return Promise.resolve({ behavior: "allow" }); },
  });
  handle.pushMessage("permission");
  await new Promise(function(resolve) { setImmediate(resolve); });
  server.handlers[0].fn({ method: "session/update", params: { sessionId: "fresh", update: {
    sessionUpdate: "tool_call", toolCallId: "tool-1", name: "future_tool", title: "Unknown", rawInput: { value: 7 },
  } } });
  server.handlers[0].fn({ id: 91, method: "session/request_permission", params: {
    sessionId: "fresh", toolCall: { toolCallId: "tool-1", title: "Unknown" },
    options: [{ optionId: "first", kind: "future_allow" }, { optionId: "last", kind: "future_reject" }],
  } });
  await new Promise(function(resolve) { setImmediate(resolve); });
  assert.deepStrictEqual(seenTool, { toolName: "future_tool", input: { value: 7 } });
  assert.deepStrictEqual(server.responses, [{ id: 91, result: { outcome: { outcome: "cancelled" } } }]);
  promptResolve({ stopReason: "cancelled" });
  handle.endInput();
  for await (var event of handle) {}
});
