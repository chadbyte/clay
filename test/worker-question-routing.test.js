var test = require("node:test");
var assert = require("node:assert/strict");
var attachWorkerPermission = require("../lib/project-worker-permission").attachWorkerPermission;
var attachAskUser = require("../lib/project-ask-user").attachAskUser;
var userInput = require("../lib/yoke/user-input");

function world(options) {
  options = options || {};
  var driver = { localId: 1, ownerId: "owner", history: [] };
  var worker = { localId: 2, ownerId: "owner", history: [] };
  var sessions = new Map([[1, driver], [2, worker]]);
  var group = { id: "pair", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var deliveries = [];
  var detached = [];
  var router = attachWorkerPermission({
    sm: { sessions: sessions },
    splitStore: { groupForMember: function (id) { return group.members.indexOf(id) === -1 ? null : group; } },
    resumeDriverWithMessage: function (session, text, meta) { deliveries.push({ session: session, text: text, meta: meta }); return !options.unreachable; },
    requestDetach: function (session) { detached.push(session); },
  });
  var ask = attachAskUser({
    record: function (session, event) { session.history.push(event); },
    getWorkerQuestionRouter: function () { return router; },
  });
  var input = { questions: [{ id: "scope", question: "Proceed with the scoped alias?", options: [{ label: "Proceed" }, { label: "Hold" }], secret: !!options.secret }] };
  var controller = new AbortController();
  var promise = userInput.dispatchUserInput(ask.createHandler(worker), input, { signal: controller.signal, requestId: "native_question" });
  var tool = router.getToolDefs(driver).filter(function (def) { return def.name === "respond_to_worker_question"; })[0];
  return { driver: driver, worker: worker, sessions: sessions, group: group, deliveries: deliveries,
    detached: detached, router: router, promise: promise, controller: controller, input: input,
    ask: ask,
    answer: function (args) { return tool.handler(Object.assign({ requestId: deliveries[0].meta.requestId, action: "answer", answers: { scope: ["Proceed"] } }, args)); } };
}

function payload(result) { return JSON.parse(result.content[0].text); }

test("native Claude question reaches the Driver and maps its answer to the provider", async function () {
  var w = world();
  assert.equal(w.deliveries[0].session, w.driver);
  assert.match(w.deliveries[0].text, /new authorization/);
  assert.match(w.deliveries[0].text, /Proceed/);
  assert.deepEqual(w.detached, [w.worker]);
  assert.equal(payload(await w.answer()).status, "answered");
  var result = await w.promise;
  assert.deepEqual(userInput.claudePermissionResult(w.input, result).updatedInput.answers, { "Proceed with the scoped alias?": "Proceed" });
  assert.equal(w.worker.history[1].type, "ask_user_answered");
  assert.equal(w.worker.history[1].answeredByDriver, 1);
  assert.deepEqual(w.worker.history[1].answers, { 0: "Proceed" });
  assert.deepEqual(w.worker.pendingAskUser, {});
  assert.equal(payload(await w.answer()).status, "already_resolved");
});

test("invalid answers remain retryable and cannot consume the question", async function () {
  var w = world();
  assert.equal((await w.answer({ answers: {} })).isError, true);
  assert.equal((await w.answer({ answers: { scope: ["Proceed", "Hold"] } })).isError, true);
  assert.equal(payload(await w.answer({ answers: { scope: ["Use the later authorized instruction."] } })).status, "answered");
  assert.equal((await w.promise).status, "submitted");
});

test("escalation preserves the human card and a human can still answer", async function () {
  var w = world();
  assert.equal(payload(await w.answer({ action: "escalate" })).status, "awaiting_user");
  assert.ok(w.worker.pendingAskUser.native_question);
  w.worker.pendingAskUser.native_question.respond({ scope: ["Hold"] });
  assert.deepEqual((await w.promise).answers, { scope: ["Hold"] });
  assert.equal(payload(await w.answer()).status, "already_resolved");
});

test("human answer wins a race with the Driver", async function () {
  var w = world();
  w.worker.pendingAskUser.native_question.respond({ scope: ["Hold"] });
  assert.equal(payload(await w.answer()).status, "already_resolved");
  assert.deepEqual((await w.promise).answers, { scope: ["Hold"] });
  assert.equal(w.worker.history.length, 1);
});

test("replaced Driver cannot answer through a captured tool", async function () {
  var w = world();
  w.sessions.set(1, Object.assign({}, w.driver));
  assert.equal((await w.answer()).isError, true);
  w.controller.abort();
  assert.equal((await w.promise).status, "cancelled");
});

test("pair and owner changes cancel rather than route answers to a different Worker", async function () {
  for (var change of [function (w) { w.group.id = "replacement"; }, function (w) { w.worker.ownerId = "other"; }, function (w) { w.sessions.set(2, Object.assign({}, w.worker)); }]) {
    var w = world();
    change(w);
    assert.equal((await w.answer()).isError, true);
    assert.equal((await w.promise).status, "cancelled");
  }
});

test("Worker stop and query abort settle routed questions", async function () {
  var w = world();
  assert.equal(w.router.cancelForSession(w.worker, "Stopped"), 1);
  assert.equal((await w.promise).reason, "Stopped");
  var aborted = world();
  aborted.controller.abort();
  assert.equal((await aborted.promise).status, "cancelled");
  assert.equal(payload(await aborted.answer()).status, "already_resolved");
});

test("unreachable Drivers and secret questions keep human input available", async function () {
  for (var options of [{ unreachable: true }, { secret: true }]) {
    var w = world(options);
    assert.ok(w.worker.pendingAskUser.native_question);
    if (options.secret) assert.equal(w.deliveries.length, 0);
    w.worker.pendingAskUser.native_question.respond({ scope: ["Hold"] });
    assert.equal((await w.promise).status, "submitted");
  }
});


test("a different Driver cannot answer and the exact Driver can retry", async function () {
  var w = world();
  var other = { localId: 9, ownerId: "owner" };
  w.sessions.set(9, other);
  var tool = w.router.getToolDefs(other, { dormantDriver: true }).filter(function (def) { return def.name === "respond_to_worker_question"; })[0];
  assert.equal((await tool.handler({ requestId: w.deliveries[0].meta.requestId, action: "answer", answers: { scope: ["Hold"] } })).isError, true);
  assert.equal(payload(await w.answer()).status, "answered");
  await w.promise;
});

test("fallback question tools use the same Driver response lifecycle", async function () {
  var w = world();
  await w.answer();
  await w.promise;
  var reply = w.ask.getToolDefs(w.worker)[0].handler(w.input);
  var requestId = w.deliveries[1].meta.requestId;
  assert.equal(payload(await w.answer({ requestId: requestId })).status, "answered");
  assert.deepEqual(payload(await reply), { scope: ["Proceed"] });
});

test("concurrent questions for two Workers remain independently addressable", async function () {
  var w = world();
  var second = { localId: 3, ownerId: "owner", history: [] };
  w.sessions.set(3, second);
  w.group.members.push(3);
  w.group.pair = { version: 2, driverId: 1, workerIds: [2, 3] };
  var reply = userInput.dispatchUserInput(w.ask.createHandler(second), w.input);
  assert.equal(w.deliveries[1].meta.workerSessionId, 3);
  await w.answer({ requestId: w.deliveries[1].meta.requestId, answers: { scope: ["Hold"] } });
  assert.deepEqual((await reply).answers, { scope: ["Hold"] });
  assert.ok(w.worker.pendingAskUser.native_question);
  await w.answer();
  assert.deepEqual((await w.promise).answers, { scope: ["Proceed"] });
});


test("expired Driver response leaves the question available to the human", async function (t) {
  var w = world();
  var later = Date.now() + 6 * 60 * 1000;
  t.mock.method(Date, "now", function () { return later; });
  assert.equal(payload(await w.answer()).status, "already_resolved");
  assert.ok(w.worker.pendingAskUser.native_question);
  w.worker.pendingAskUser.native_question.respond({ scope: ["Hold"] });
  assert.equal((await w.promise).status, "submitted");
});

test("pair loss cancels a question even when the Driver never replies", async function (t) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  var w = world();
  w.group.pair = null;
  t.mock.timers.tick(2000);
  assert.equal((await w.promise).status, "cancelled");
  assert.deepEqual(w.worker.pendingAskUser, {});
});
