var test = require("node:test");
var assert = require("node:assert/strict");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var createAcpAdapter = require("../lib/yoke/adapters/acp").createAcpAdapter;
var acpUserInput = require("../lib/yoke/acp-user-input");
var elicitationResponse = require("../lib/project-elicitation-response");
var userInput = require("../lib/yoke/user-input");

var VENDORS = ["opencode", "kimi", "grok", "copilot", "qwen", "junie"];

function pendingHandle() {
  return {
    pushMessage: function () { return true; },
    close: function () {},
    [Symbol.asyncIterator]: function () { return { next: function () { return new Promise(function () {}); } }; },
  };
}

function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }

function fakeAcp() {
  var calls = [];
  return {
    calls: calls,
    respond: function (id, result) { calls.push({ id: id, result: result }); },
    respondError: function (id, code, message) { calls.push({ id: id, error: { code: code, message: message } }); },
  };
}

async function startVendorQuery(vendor, localId) {
  var recorded = [];
  var adapter = createAcpAdapter(vendor, {});
  var queryOptions = null;
  adapter.createQuery = function (options) { queryOptions = options; return Promise.resolve(pendingHandle()); };
  var session = { localId: localId, vendor: vendor, pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var adapters = {};
  adapters[vendor] = adapter;
  var ready = {};
  ready[vendor] = {};
  var models = {};
  models[vendor] = [];
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {
      sessions: new Map([[localId, session]]), availableModels: [], capabilitiesByVendor: ready, modelsByVendor: models, saveSessionFile: function () {},
      broadcastSessionList: function () {}, sendAndRecord: function (target, message) { recorded.push(message); }, sendToSession: function () {},
    },
    adapter: adapter,
    adapters: adapters,
    getSessionToolDefs: function () { return []; },
    onUserInputRequest: function (boundSession, request, respond) { respond({}); },
    send: function () {},
  });
  await bridge.startQuery(session, "Plan the change", null, null);
  return { bridge: bridge, session: session, queryOptions: queryOptions, recorded: recorded, adapter: adapter };
}

function browserReply(run, requestId, action, content) {
  var sent = [];
  elicitationResponse.handleElicitationResponse(run.session, {}, { requestId: requestId, action: action, content: content }, {
    sendTo: function (ws, message) { sent.push(message); },
    sendAndRecord: function (target, message) { run.recorded.push(message); },
  });
  return sent;
}

function lastRequest(run) {
  var requests = run.recorded.filter(function (message) { return message.type === "elicitation_request"; });
  return requests[requests.length - 1];
}

test("shared ACP vendors keep the ask_user_questions fallback in ordinary sessions", async function () {
  for (var i = 0; i < VENDORS.length; i++) {
    var vendor = VENDORS[i];
    var adapter = createAcpAdapter(vendor, {});
    assert.equal(userInput.selectMode(adapter, "auto"), "fallback", vendor);
    assert.equal(adapter.userInputCapability.nativeElicitation, true, vendor);
    var run = await startVendorQuery(vendor, 900 + i);
    assert.equal(run.queryOptions.userInputMode, "fallback", vendor);
    assert.equal(typeof run.queryOptions.onUserInputRequest, "function", vendor + " still receives native elicitation");
    var tools = run.bridge.getQueryToolDefs(run.session, run.session._sdkQueryGeneration).map(function (tool) { return tool.name; });
    assert.ok(tools.indexOf("ask_user_questions") !== -1, vendor + " exposes ask_user_questions through the exact-query bridge");
    var mcpServers = run.queryOptions.adapterOptions.ACP.mcpServers.map(function (server) { return server.name; });
    assert.ok(mcpServers.indexOf("clay-tools") !== -1, vendor + " receives the clay-tools bridge");
  }
});

test("native ACP form elicitation round-trips through the SDK bridge without question limits", async function () {
  var run = await startVendorQuery("opencode", 950);
  var acp = fakeAcp();
  var properties = { a: { type: "string" }, b: { type: "boolean" }, c: { type: "integer", minimum: 1 }, d: { type: "array", items: { anyOf: [{ const: "x", title: "X" }, { const: "y", title: "Y" }] } } };
  properties["field_" + "n".repeat(140)] = { type: "string", description: "Long description ".repeat(150) };
  var schema = { type: "object", properties: properties, required: ["a", "c"] };
  acpUserInput.handleElicitation(acp, { id: 61, method: "elicitation/create", params: { sessionId: "s", mode: "form", message: "Configure", requestedSchema: schema } },
    run.queryOptions.onUserInputRequest, run.queryOptions.onElicitation, new AbortController().signal, "opencode", "OpenCode");
  await tick();
  var request = lastRequest(run);
  assert.equal(request.mode, "form");
  assert.deepEqual(request.requestedSchema, schema);

  var invalid = browserReply(run, request.requestId, "accept", { a: "", c: 0, d: ["z"] });
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].type, "elicitation_error");
  assert.ok(run.session.pendingElicitations[request.requestId], "invalid form stays pending and editable");
  assert.deepEqual(acp.calls, []);

  assert.deepEqual(browserReply(run, request.requestId, "accept", { a: "", b: false, c: 2, d: ["y"] }), []);
  await tick();
  assert.deepEqual(acp.calls, [{ id: 61, result: { action: "accept", content: { a: "", b: false, c: 2, d: ["y"] } } }]);
  assert.equal(run.recorded.filter(function (m) { return m.type === "elicitation_resolved"; }).pop().action, "accept");
});

test("decline, cancel, abort and unsupported modes keep distinct ACP outcomes exactly once", async function () {
  var run = await startVendorQuery("qwen", 951);
  var schema = { type: "object", properties: { a: { type: "string" } } };
  function ask(acp, id, signal) {
    acpUserInput.handleElicitation(acp, { id: id, method: "elicitation/create", params: { sessionId: "s", mode: "form", message: "Q", requestedSchema: schema } },
      run.queryOptions.onUserInputRequest, run.queryOptions.onElicitation, signal || new AbortController().signal, "qwen", "Qwen Code");
  }
  var declined = fakeAcp();
  ask(declined, 71);
  await tick();
  browserReply(run, lastRequest(run).requestId, "decline");
  await tick();
  assert.deepEqual(declined.calls, [{ id: 71, result: { action: "decline" } }]);

  var legacy = fakeAcp();
  ask(legacy, 72);
  await tick();
  browserReply(run, lastRequest(run).requestId, "reject");
  await tick();
  assert.deepEqual(legacy.calls, [{ id: 72, result: { action: "decline" } }], "legacy browser reject is an explicit decline");

  var cancelled = fakeAcp();
  ask(cancelled, 73);
  await tick();
  browserReply(run, lastRequest(run).requestId, "cancel");
  await tick();
  assert.deepEqual(cancelled.calls, [{ id: 73, result: { action: "cancel" } }]);

  var aborted = fakeAcp();
  var controller = new AbortController();
  ask(aborted, 74, controller.signal);
  await tick();
  var abortedId = lastRequest(run).requestId;
  controller.abort();
  controller.abort();
  await tick();
  assert.deepEqual(aborted.calls, [{ id: 74, result: { action: "cancel" } }]);
  assert.equal(run.recorded.filter(function (m) { return m.type === "elicitation_resolved" && m.requestId === abortedId; }).map(function (m) { return m.action; }).join(), "cancel");
  var late = browserReply(run, abortedId, "accept", { a: "late" });
  await tick();
  assert.equal(late[0].expired, true, "late browser answer is reported as expired");
  assert.equal(aborted.calls.length, 1, "late answer never reaches the agent");

  var unsupported = fakeAcp();
  acpUserInput.handleElicitation(unsupported, { id: 75, method: "elicitation/create", params: { sessionId: "s", mode: "url", url: "https://example.com", elicitationId: "e" } },
    run.queryOptions.onUserInputRequest, null, new AbortController().signal, "qwen", "Qwen Code");
  assert.equal(unsupported.calls.length, 1);
  assert.equal(unsupported.calls[0].error.code, -32602);
});
