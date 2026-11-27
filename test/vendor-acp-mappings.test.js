var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "clay-vendor-mappings-"));
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, "clay");
process.env.CLAY_CONFIG = path.join(root, "config.json");
process.env.CODEX_HOME = path.join(root, "codex");
process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
var Manager = require("../lib/yoke/acp-process-manager").AcpProcessManager;
var generic = require("../lib/yoke/acp-query-handle").createAcpQueryHandle;
var kiro = require("../lib/yoke/adapters/kiro").contractTestKit.createQueryHandle;
var profiles = require("../lib/yoke/acp-agent-profiles");
test.after(function() { fs.rmSync(root, { recursive: true, force: true }); });
function tick() { return new Promise(function(resolve) { setImmediate(resolve); }); }
async function fixture(t, vendor, opts) {
  opts = opts || {};
  var server = new Manager("/fixture/acp", {});
  server.started = true;
  server.proc = { stdin: { write: function() { return true; }, end: function() {} }, kill: function() {} };
  var replies = [], calls = [], reviews = [], inputs = [], finish;
  server._write = function(msg) { replies.push(msg); return true; };
  server.send = function(method, params) {
    calls.push({ method: method, params: params });
    if (/session\/(new|load)/.test(method)) return Promise.resolve({ sessionId: "s", configOptions: opts.configOptions || [] });
    if (method === "session/prompt") return new Promise(function(resolve) { finish = resolve; });
    if (method === "session/set_config_option" && params.configId === "effortLevel") return Promise.resolve({ configOptions: opts.configOptions || [] });
    return Promise.resolve({});
  };
  var handle = (vendor === "kiro" ? kiro : generic)(server, Object.assign({
    vendor: vendor, engine: "v3", cwd: root, model: "auto", canLoadSession: true,
    driver: { permissionModeGuaranteed: true },
    canUseTool: function(name, input) { reviews.push({ name: name, input: input }); return Promise.resolve({ behavior: "allow" }); },
    onUserInputRequest: function(request, respond) { inputs.push({ request: request, respond: respond }); },
  }, opts));
  t.after(function() { handle.close(); server.stop(); });
  handle.pushMessage("fixture"); await tick();
  function request(call) {
    server._handleMessage({ jsonrpc: "2.0", id: 1, method: "session/request_permission", params: {
      sessionId: "s", toolCall: Object.assign({ toolCallId: "t" }, call),
      options: [{ optionId: "once", kind: "allow_once" }, { optionId: "deny", kind: "reject_once" }],
    } });
  }
  function update(payload) { server._handleMessage({ method: "session/update", params: { sessionId: "s", update: payload } }); }
  return { server: server, handle: handle, request: request, update: update, replies: replies, calls: calls, reviews: reviews, inputs: inputs,
    finish: function(result) { finish(result); } };
}
function questionCall(questions) { return { kind: "think", _meta: { qwenInteractionKind: "user_question", qwenQuestions: questions } }; }
var questions = [{ header: "Choice", question: "Choose one", options: [{ label: "A", description: "First" }, { label: "B", description: "Second" }] }];
[false, true].forEach(function(resumed) {
  test("Qwen question round trip, resumed=" + resumed, async function(t) {
    var f = await fixture(t, "qwen", { resumeSessionId: resumed ? "s" : null });
    f.request(questionCall(questions)); await tick();
    assert.equal(f.inputs.length, 1); assert.equal(f.reviews.length, 0);
    f.inputs[0].respond({ "0": ["B"] }); await tick();
    assert.deepEqual(f.replies[0].result, { outcome: { outcome: "selected", optionId: "once" }, answers: { "0": "B" } });
    f.request(questionCall(questions)); await tick(); assert.equal(f.inputs.length, 1);
  });
  test("Kiro advertised effort before prompt, resumed=" + resumed, async function(t) {
    var f = await fixture(t, "kiro", { effort: "high", resumeSessionId: resumed ? "s" : null,
      configOptions: [{ id: "effortLevel", options: [{ value: "high" }] }] });
    var effort = f.calls.findIndex(function(call) { return call.params.configId === "effortLevel"; });
    assert.ok(effort >= 0); assert.ok(effort < f.calls.findIndex(function(call) { return call.method === "session/prompt"; }));
    f.update({ sessionUpdate: "config_option_update", configOptions: [] });
    await assert.rejects(f.handle.setEffort("high"), /did not advertise/);
  });
});
test("Qwen late answer after Stop cannot select an option", async function(t) {
  var f = await fixture(t, "qwen"); f.request(questionCall(questions)); await tick();
  await f.handle.abort(); f.inputs[0].respond({ "0": ["A"] }); await tick();
  var replies = f.replies.filter(function(frame) { return frame.id === 1; });
  assert.equal(replies.length, 1); assert.equal(replies[0].result.outcome.outcome, "cancelled");
});
[null, [], [null], questions.concat(questions, questions, questions)].forEach(function(shape, index) {
  test("Qwen unrepresentable question " + index + " fails closed", async function(t) {
    var f = await fixture(t, "qwen"); f.request(questionCall(shape)); await tick();
    assert.equal(f.inputs.length, 0); assert.equal(f.reviews.length, 0);
    assert.notEqual(f.replies[0].result.outcome.optionId, "once");
  });
});
test("Qwen missing question callback denies without generic review", async function(t) {
  var f = await fixture(t, "qwen", { onUserInputRequest: null }); f.request(questionCall(questions)); await tick();
  assert.equal(f.reviews.length, 0); assert.notEqual(f.replies[0].result.outcome.optionId, "once");
});
test("Qwen edit review uses exact diff instead of incomplete rawInput", async function(t) {
  var f = await fixture(t, "qwen");
  f.request({ kind: "edit", rawInput: { file_path: "wrong" }, content: [{ type: "diff", path: "/fixture/a", oldText: "old", newText: "new" }] }); await tick();
  assert.deepEqual(f.reviews, [{ name: "Edit", input: { file_path: "/fixture/a", old_string: "old", new_string: "new" } }]);
  assert.equal(f.replies[0].result.outcome.optionId, "once");
});
[[], [{ type: "diff", path: "/fixture/a", newText: "new" }], [{ type: "diff", path: "/a", oldText: "", newText: "a" }, { type: "diff", path: "/b", oldText: "", newText: "b" }]].forEach(function(content, index) {
  test("Qwen ambiguous edit " + index + " fails closed", async function(t) {
    var f = await fixture(t, "qwen"); f.request({ kind: "edit", content: content }); await tick();
    assert.equal(f.reviews.length, 0); assert.notEqual(f.replies[0].result.outcome.optionId, "once");
  });
});
[undefined, { inputTokens: 12, outputTokens: 3, cachedReadTokens: 4 }, { inputTokens: -1, outputTokens: 3 }].forEach(function(usage, index) {
  test("ACP context occupancy is separate from prompt metering " + index, async function(t) {
    var f = await fixture(t, "opencode"); f.update({ sessionUpdate: "usage_update", used: 900, size: 1000 });
    f.finish({ stopReason: "end_turn", usage: usage });
    for await (var event of f.handle) { if (event.yokeType === "result") {
      assert.equal(event.lastStreamInputTokens, 900);
      assert.deepEqual(event.usage, index === 1 ? { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 0 } : null); break;
    } }
  });
});
test("Kiro turn metering remains observable without inventing token fields", async function(t) {
  var f = await fixture(t, "kiro");
  var update = { sessionUpdate: "session_info_update", _meta: { kiro: { kind: "turn_completion", promptTurnSummaries: [{ unknownCounter: 4 }] } } };
  f.update(update); f.finish({ stopReason: "end_turn" });
  var metering;
  for await (var event of f.handle) { if (event.eventType === "session/update:turn_completion") metering = event; if (event.yokeType === "result") { assert.equal(event.usage, null); break; } }
  assert.deepEqual(metering.raw, update);
});
test("Copilot server effort is scoped at launch and cannot bleed across sessions", async function(t) {
  var options;
  function FakeManager(binary, opts) { options = opts; this.started = true; }
  FakeManager.prototype.start = function() { return Promise.resolve(); };
  FakeManager.prototype.send = function() { return Promise.resolve({ protocolVersion: 1 }); };
  FakeManager.prototype.stop = function() {};
  var adapter = require("../lib/yoke/adapters/acp").createAcpAdapter("copilot", { cwd: root, _binaryPath: "/fixture/copilot", _AcpProcessManagerCtor: FakeManager });
  t.after(function() { return adapter.shutdown(); });
  await adapter.init({ effort: "high", env: {} });
  assert.deepEqual(options.args, ["--acp", "--effort", "high"]);
  await assert.rejects(adapter.createQuery({ effort: "low" }), /fixed at server launch/);
  var handle = await adapter.createQuery({ effort: "high", skipSkills: true });
  await assert.rejects(handle.setEffort("low"), /fixed at server launch/); handle.close();
});
test("Kimi successor preserves scoped environment and disables its auto-updater", function() {
  var profile = profiles.getAcpAgentProfile("kimi");
  var opts = profile.buildProcessOptions({}, { env: { SCOPED: "yes" } });
  assert.deepEqual(opts.env, { SCOPED: "yes", KIMI_CODE_NO_AUTO_UPDATE: "1" });
  assert.deepEqual(profile.args, ["acp"]);
});

["close", "disconnect", "next turn"].forEach(function(boundary) {
  test("Qwen question reply cannot cross " + boundary, async function(t) {
    var f = await fixture(t, "qwen"); f.request(questionCall(questions)); await tick();
    if (boundary === "close") f.handle.close();
    else if (boundary === "disconnect") f.server._disconnect(new Error("fixture disconnect"));
    else { f.finish({ stopReason: "end_turn" }); await tick(); f.handle.pushMessage("next"); await tick(); }
    f.inputs[0].respond({ "0": ["A"] }); await tick();
    assert.equal(f.replies.filter(function(frame) { return frame.id === 1 && frame.result && frame.result.outcome.optionId === "once"; }).length, 0);
  });
});
test("Qwen allow-all does not answer a question or approve an incomplete edit", async function(t) {
  var f = await fixture(t, "qwen"); await f.handle.setToolPolicy("allow-all");
  f.request(questionCall(questions)); await tick(); assert.equal(f.inputs.length, 1); assert.equal(f.replies.length, 0);
  f.inputs[0].respond.cancel(); await tick();
  f.server._handleMessage({ id: 2, method: "session/request_permission", params: { sessionId: "s",
    toolCall: { toolCallId: "edit", kind: "edit", rawInput: { title: "empty" } },
    options: [{ optionId: "once", kind: "allow_once" }, { optionId: "deny", kind: "reject_once" }] } }); await tick();
  assert.equal(f.replies.find(function(frame) { return frame.id === 2; }).result.outcome.optionId, "deny");
});
test("Qwen questions that would lose choice text fail closed", async function(t) {
  var f = await fixture(t, "qwen");
  f.request(questionCall([{ header: "Choice", question: "Choose", options: [{ label: "x".repeat(61), description: "Long" }, { label: "B", description: "Second" }] }])); await tick();
  assert.equal(f.inputs.length, 0); assert.equal(f.replies[0].result.outcome.optionId, "deny");
});

test("ACP draft usage from an unverified vendor is not treated as turn billing", async function(t) {
  var f = await fixture(t, "grok"); f.finish({ stopReason: "end_turn", usage: { inputTokens: 500, outputTokens: 30, totalTokens: 530 } });
  for await (var event of f.handle) { if (event.yokeType === "result") { assert.equal(event.usage, null); break; } }
});

test("OpenCode later catalog probes keep the launch environment", async function(t) {
  var seen = [];
  function FakeManager() { this.started = true; }
  FakeManager.prototype.start = function() { return Promise.resolve(); };
  FakeManager.prototype.send = function() { return Promise.resolve({ protocolVersion: 1 }); };
  FakeManager.prototype.stop = function() {};
  var adapter = require("../lib/yoke/adapters/acp").createAcpAdapter("opencode", {
    cwd: root, _binaryPath: "/fixture/opencode", _AcpProcessManagerCtor: FakeManager,
    _openCodeAgentNames: [], _openCodeResolvedConfig: { permission: "ask", agent: {} },
    _fetchModels: function(binary, cwd, env) { seen.push(env); return Promise.resolve(["fixture/model"]); },
  });
  t.after(function() { return adapter.shutdown(); });
  await adapter.init({ env: { SCOPED: "yes" } }); await adapter.supportedModels();
  assert.deepEqual(seen, [{ SCOPED: "yes" }, { SCOPED: "yes" }]);
});

[false, true].forEach(function(allowAll) {
  test("Qwen inherited edit kind cannot bypass exact review, allow-all=" + allowAll, async function(t) {
    var f = await fixture(t, "qwen");
    if (allowAll) await f.handle.setToolPolicy("allow-all");
    f.update({ sessionUpdate: "tool_call", toolCallId: "t", kind: "edit", title: "Change file",
      rawInput: { file_path: "/fixture/a" }, content: [{ type: "diff", path: "/fixture/a", oldText: "old", newText: "stale candidate" }] });
    f.request({ title: "Change file", rawInput: { file_path: "/fixture/a" } }); await tick();
    assert.equal(f.reviews.length, 0);
    assert.equal(f.replies.find(function(frame) { return frame.id === 1; }).result.outcome.optionId, "deny");
  });
});
test("Qwen inherited edit kind can review a complete request-local diff", async function(t) {
  var f = await fixture(t, "qwen");
  f.update({ sessionUpdate: "tool_call", toolCallId: "t", kind: "edit", rawInput: {} });
  f.request({ rawInput: {}, content: [{ type: "diff", path: "/fixture/a", oldText: "old", newText: "new" }] }); await tick();
  assert.deepEqual(f.reviews, [{ name: "Edit", input: { file_path: "/fixture/a", old_string: "old", new_string: "new" } }]);
});
test("Qwen Edit name without kind cannot create an incomplete review", async function(t) {
  var f = await fixture(t, "qwen"); f.request({ name: "Edit", rawInput: { file_path: "/fixture/a" } }); await tick();
  assert.equal(f.reviews.length, 0); assert.equal(f.replies[0].result.outcome.optionId, "deny");
});

function effortChoices(value) { return [{ id: "effortLevel", options: [{ value: value }] }]; }
function effortCalls(f) { return f.calls.filter(function(call) { return call.params.configId === "effortLevel"; }); }
function retireConfigTarget(f, boundary) {
  if (boundary === "rebind") f.server.handlers[0].sessionId = "foreign";
  if (boundary === "rebind and restore") { f.server.handlers[0].sessionId = "foreign"; f.server.handlers[0].sessionId = "s"; }
  if (boundary === "process replacement") { f.server.proc = { stdin: { end: function() {} }, kill: function() {} }; f.server._processGeneration++; }
  if (boundary === "process generation") f.server._processGeneration++;
  if (boundary === "remove") f.server.removeHandler(f.server.handlers[0]);
  if (boundary === "close") f.handle.close();
  if (boundary === "disconnect") f.server._disconnect(new Error("fixture disconnect"));
}
["rebind", "rebind and restore", "process replacement", "process generation", "remove", "close", "disconnect"].forEach(function(boundary) {
  test("Kiro effort refuses a retired target before send: " + boundary, async function(t) {
    var f = await fixture(t, "kiro", { configOptions: effortChoices("high") });
    retireConfigTarget(f, boundary);
    await assert.rejects(f.handle.setEffort("high"), /stale/);
    assert.equal(effortCalls(f).length, 0);
  });
  test("Kiro late effort response cannot confirm a retired target: " + boundary, async function(t) {
    var f = await fixture(t, "kiro", { configOptions: effortChoices("high") });
    var send = f.server.send;
    var finish;
    f.server.send = function(method, params) {
      if (params.configId === "effortLevel") { f.calls.push({ method: method, params: params }); return new Promise(function(resolve) { finish = resolve; }); }
      return send(method, params);
    };
    var pending = f.handle.setEffort("high");
    var rejected = assert.rejects(pending, /stale|stopped|abort|disconnect/i);
    await tick(); assert.equal(effortCalls(f).length, 1);
    retireConfigTarget(f, boundary); finish({ configOptions: effortChoices("low") });
    await rejected;
    await assert.rejects(f.handle.setEffort("low"), /stale/);
    assert.equal(effortCalls(f).length, 1);
  });
});
test("Kiro configuration changes before deferred send cannot use an old advertisement", async function(t) {
  var f = await fixture(t, "kiro", { configOptions: effortChoices("high") });
  var pending = f.handle.setEffort("high");
  f.update({ sessionUpdate: "config_option_update", configOptions: effortChoices("low") });
  await assert.rejects(pending, /advertisement changed/); assert.equal(effortCalls(f).length, 0);
});
test("Kiro stale response cannot overwrite newer advertised choices", async function(t) {
  var f = await fixture(t, "kiro", { configOptions: effortChoices("high") });
  var send = f.server.send;
  var finish;
  f.server.send = function(method, params) {
    if (params.configId === "effortLevel") { f.calls.push({ method: method, params: params }); return new Promise(function(resolve) { finish = resolve; }); }
    return send(method, params);
  };
  var pending = f.handle.setEffort("high"); await tick();
  await assert.rejects(f.handle.setEffort("high"), /already pending/);
  f.update({ sessionUpdate: "config_option_update", configOptions: effortChoices("low") });
  finish({ configOptions: effortChoices("high") }); await assert.rejects(pending, /response is stale/);
  f.server.send = send;
  await assert.rejects(f.handle.setEffort("high"), /did not advertise/);
  await f.handle.setEffort("low");
  assert.equal(effortCalls(f).length, 2);
});

test("Kiro advertised adapter effort does not fabricate canonical product support", async function(t) {
  var f = await fixture(t, "kiro", { configOptions: effortChoices("high") });
  var saves = 0;
  var session = { localId: 1, vendor: "kiro", model: "auto", queryInstance: f.handle };
  var sm = { sessions: new Map([[1, session]]), saveSessionFile: function() { saves++; } };
  var bridge = require("../lib/sdk-bridge").createSDKBridge({ cwd: root, sessionManager: sm,
    adapter: { vendor: "kiro" }, send: function() {}, onProcessingChanged: function() {} });
  await assert.rejects(bridge.setEffort(session, "high", { revalidate: function() {} }), /Unsupported reasoning effort/);
  assert.equal(saves, 0); assert.equal(session.effort, undefined); assert.equal(effortCalls(f).length, 0);
  var effects = 0;
  sm.capabilitiesByVendor = { kiro: { effort: false } };
  var mateControl = require("../lib/project-mate-chat-control").attachMateChatControl({
    isMate: true, sm: sm, getAccess: function() { return {}; }, users: { isMultiUser: function() { return false; } },
    actions: { effort: function() { effects++; } },
  });
  await assert.rejects(mateControl.apply(session, { action: "effort", value: "high" }, function() {}, {}), /does not support that effort level/);
  assert.equal(effects, 0); assert.equal(effortCalls(f).length, 0);
});

[undefined, {}, { configOptions: null }].forEach(function(response, index) {
  test("Kiro malformed effort response is not an acknowledgement " + index, async function(t) {
    var f = await fixture(t, "kiro", { configOptions: effortChoices("high") });
    var send = f.server.send;
    f.server.send = function(method, params) {
      if (params.configId === "effortLevel") return Promise.resolve(response);
      return send(method, params);
    };
    await assert.rejects(f.handle.setEffort("high"), /response is malformed.*unconfirmed/);
    f.server.send = send;
    await f.handle.setEffort("high");
  });
});
