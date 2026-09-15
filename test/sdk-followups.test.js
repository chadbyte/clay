var test = require("node:test");
var assert = require("node:assert/strict");
var queue = require("../lib/sdk-turn-queue");
var usage = require("../lib/context-usage");
var workerUsage = require("../lib/yoke/claude-context-usage");
var switches = require("../lib/yoke/claude-model-switch");
var kit = require("../lib/yoke/adapters/claude").contractTestKit;

function deferred() {
  var resolve;
  var promise = new Promise(function(done) { resolve = done; });
  return { promise: promise, resolve: resolve };
}

test("SDK queued count overrides stale local counts and accepts zero", function() {
  assert.equal(queue.pendingSends({ _queuedTurnCount: 8 }, { queuedTurnCount: 0 }), 0);
  assert.equal(queue.pendingSends({ _queuedTurnCount: 0 }, { queuedTurnCount: 3 }), 3);
  assert.equal(kit.normalizeEvent({ type: "result", queued_turn_count: 0 }).queuedTurnCount, 0);
  assert.equal(kit.normalizeEvent({ type: "result", queued_turn_count: -1 }).queuedTurnCount, undefined);
});

test("messages admitted after result receipt remain pending", function() {
  var session = { queryInstance: { getSubmittedMessageCount: function() { return 5; } } };
  assert.equal(queue.pendingSends(session, { queuedTurnCount: 0, submittedMessageCount: 3 }), 2);
});

test("older providers retain merged UUID accounting", function() {
  assert.equal(queue.pendingSends({ _queuedTurnCount: 3 }, { answeredUserMessageCount: 2 }), 2);
  assert.equal(queue.pendingSends({ _queuedTurnCount: 3 }, {}), 3);
});

test("routine context reads use summary and reject results from replaced queries", async function() {
  var pending = deferred();
  var seen;
  var session = { queryInstance: { getContextUsage: function(options) { seen = options; return pending.promise; } } };
  var request = usage.readUsage(session);
  await Promise.resolve();
  assert.deepEqual(seen, { detail: "summary" });
  session.queryInstance = {};
  pending.resolve({ totalTokens: 12 });
  assert.equal(await request, null);
  assert.equal(session.lastContextUsage, undefined);
});

test("full details deduplicate concurrent requests and supersede older summary reads", async function() {
  var summary = deferred();
  var full = deferred();
  var session = { queryInstance: { getContextUsage: function(options) { return options.detail === "full" ? full.promise : summary.promise; } } };
  var first = usage.readUsage(session, "summary");
  var detail = usage.readUsage(session, "full");
  assert.equal(usage.readUsage(session, "full"), detail);
  full.resolve({ totalTokens: 30 });
  assert.deepEqual(await detail, { totalTokens: 30 });
  summary.resolve({ totalTokens: 10 });
  assert.equal(await first, null);
  assert.equal(session.lastContextUsage.totalTokens, 30);
});

test("detail responses cannot reach a socket after a session switch or access revocation", async function() {
  var pending = deferred();
  var delivered = [];
  var allowed = true;
  var session = { localId: 1, queryInstance: { getContextUsage: function() { return pending.promise; } } };
  var active = session;
  var handler = usage.attachContextUsage({
    getSessionForWs: function() { return active; },
    sm: { sessions: new Map([[1, session]]) },
    usersModule: { isMultiUser: function() { return true; }, canAccessSession: function() { return allowed; } },
    getProjectAccess: function() { return {}; },
    sendTo: function(ws, message) { delivered.push(message); },
  });
  var ws = { _clayUser: { id: "owner" } };
  assert.equal(handler.handleMessage(ws, { type: "context_usage_request", sessionId: 2 }), true);
  assert.equal(handler.handleMessage(ws, { type: "context_usage_request", sessionId: 1 }), true);
  allowed = false;
  active = null;
  pending.resolve({ totalTokens: 9 });
  await new Promise(function(resolve) { setImmediate(resolve); });
  assert.deepEqual(delivered, []);
});

test("Worker context requests correlate responses and settle on shutdown", async function() {
  var sent = [];
  var requests = workerUsage.createRequests({ send: function(message) { sent.push(message); return true; } });
  var summary = requests.request();
  var full = requests.request({ detail: "full" });
  assert.deepEqual(sent.map(function(message) { return message.options.detail; }), ["summary", "full"]);
  requests.receive({ requestId: sent[1].requestId, data: { totalTokens: 15 } });
  assert.deepEqual(await full, { totalTokens: 15 });
  requests.close();
  assert.equal(await summary, null);
});

test("Worker executes the requested context detail level", async function() {
  var seen;
  var response;
  await workerUsage.respond({ getContextUsage: function(options) { seen = options; return Promise.resolve({ totalTokens: 1 }); } },
    { requestId: "one", options: { detail: "full" } }, function(message) { response = message; });
  assert.deepEqual(seen, { detail: "full" });
  assert.equal(response.requestId, "one");
  assert.equal(response.data.totalTokens, 1);
});

test("PostModelSwitch records confirmed changes and preserves existing hooks", async function() {
  var existing = { hooks: [function() {}] };
  var options = { hooks: { PostModelSwitch: [existing] } };
  var changes = [];
  switches.attach(options, function(change) { changes.push(change); });
  assert.equal(options.hooks.PostModelSwitch[0], existing);
  var hook = options.hooks.PostModelSwitch[1].hooks[0];
  assert.deepEqual(await hook({ from_model: "one", to_model: "two", source: "auto" }), {});
  await hook({ from_model: "two", to_model: "two", source: "sdk" });
  assert.deepEqual(changes, [{ fromModel: "one", toModel: "two", source: "auto" }]);
  assert.equal(options.hooks.PreModelSwitch, undefined);
});

test("a new turn does not reuse a context request from the previous turn", async function() {
  var calls = [];
  var session = { turnCount: 1, queryInstance: { getContextUsage: function() { var pending = deferred(); calls.push(pending); return pending.promise; } } };
  var first = usage.readUsage(session, "summary");
  await Promise.resolve();
  session.turnCount = 2;
  var second = usage.readUsage(session, "summary");
  await Promise.resolve();
  calls[0].resolve({ totalTokens: 1 });
  calls[1].resolve({ totalTokens: 2 });
  assert.equal(await first, null);
  assert.equal((await second).totalTokens, 2);
});

test("Worker handles deliver confirmed model changes to their own callback", function() {
  var receive;
  var changes = [];
  kit.createWorkerQueryHandle({ onMessage: function(fn) { receive = fn; }, onExit: function() {}, send: function() { return true; } },
    null, null, null, null, null, function(change) { changes.push(change); });
  receive({ type: "model_switched", change: { fromModel: "one", toModel: "two", source: "sdk" } });
  assert.deepEqual(changes, [{ fromModel: "one", toModel: "two", source: "sdk" }]);
});

test("Worker context send failures reject immediately", async function() {
  var requests = workerUsage.createRequests({ send: function() { throw new Error("Socket closed"); } });
  await assert.rejects(requests.request(), /Socket closed/);
  requests.close();
});
