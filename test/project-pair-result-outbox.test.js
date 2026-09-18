var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attach = require("../lib/project-pair-result-outbox").attachPairResultOutbox;
var createSessionManager = require("../lib/sessions").createSessionManager;

function tempPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-outbox-")), "pair-result-outbox.json");
}

function atomicPersist(filePath, serialized) {
  var tempPath = filePath + ".tmp-test";
  fs.writeFileSync(tempPath, serialized, "utf8");
  fs.renameSync(tempPath, filePath);
  return true;
}

test("prepared close survives reload as non-deliverable intent and terminal evidence can supersede it", function () {
  var filePath = tempPath();
  var outbox = attach({ filePath: filePath });
  var started = outbox.begin({ ownerId: "owner", projectSlug: "project", groupId: "group",
    driverOriginId: "driver-origin", workerOriginId: "worker-origin",
    taskId: "task-prepared", generation: 2, deliveryRoute: "callback" });
  var proposed = { taskId: "task-prepared", generation: 2, status: "interrupted", response: "partial" };
  assert.equal(outbox.prepareCapture(started.key, proposed).ok, true);
  var reloaded = attach({ filePath: filePath });
  var prepared = reloaded.get(started.key);
  assert.equal(prepared.state, "close_prepared");
  assert.equal(prepared.outcome, null);
  assert.deepEqual(prepared.preparedCloseOutcome, proposed);
  assert.equal(reloaded.beginDelivery(started.key).ok, false);
  assert.equal(reloaded.status().records[0].recoveryState, "uncertain");
  var actual = { taskId: "task-prepared", generation: 2, status: "completed", response: "actual result" };
  var restoredWorker = { ownerId: "owner", sessionOriginId: "worker-origin", history: [{
    type: "pair_task_completed", ownerId: "owner", driverOriginId: "driver-origin",
    workerOriginId: "worker-origin", taskId: "task-prepared", generation: 2, outcome: actual,
  }] };
  var recovered = reloaded.recoverPending(new Map([[1, restoredWorker]]));
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].result.ok, true);
  assert.deepEqual(reloaded.get(started.key).outcome, actual);
  assert.equal(reloaded.get(started.key).preparedCloseOutcome, null);
  assert.equal(reloaded.get(started.key).closePreparationState, "superseded_by_terminal_evidence");
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("captures one immutable result after false and throw persistence failures", async function () {
  var filePath = tempPath();
  var calls = 0;
  var outbox = attach({ filePath: filePath, persist: function (target, serialized) {
    calls++;
    if (calls === 2) return false;
    if (calls === 3) throw new Error("disk unavailable");
    return atomicPersist(target, serialized);
  } });
  var started = outbox.begin({ ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin", taskId: "task-1", generation: 2, driverSessionId: 9, workerSessionId: 10, message: "Build it" });
  assert.equal(started.ok, true);
  var completed = new Promise(function (resolve) {
    var result = outbox.capture(started.key, { taskId: "task-1", status: "completed", response: "Done" }, resolve);
    assert.equal(result.ok, false);
  });
  var retry = await completed;
  assert.equal(retry.ok, true);
  assert.equal(outbox.status().records.length, 1);
  assert.equal(outbox.status().records[0].state, "captured");
  assert.equal(outbox.status().records[0].outcome.response, "Done");
  var reloaded = attach({ filePath: filePath });
  var records = reloaded.status().records;
  assert.equal(records.length, 1);
  assert.equal(records[0].driverOriginId, "driver-origin");
  assert.equal(records[0].workerOriginId, "worker-origin");
  assert.equal(records[0].workerSessionId, 10);
  assert.equal(reloaded.capture(started.key, { taskId: "task-1", status: "failed", response: "Duplicate" }).conflict, true);
  assert.equal(reloaded.status().records[0].outcome.response, "Done");
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("a delayed capture retry cannot overwrite newer delivery or routing state", function () {
  var filePath = tempPath(), timers = [], calls = 0, callbackCalls = 0;
  var outbox = attach({ filePath: filePath, setTimeout: function (fn) { timers.push(fn); return timers.length; },
    persist: function (target, serialized) {
      calls++;
      if (calls === 2) return false;
      return atomicPersist(target, serialized);
    } });
  var started = outbox.begin({ ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin",
    taskId: "task-race", generation: 1, deliveryRoute: "blocking" });
  var firstOutcome = { taskId: "task-race", generation: 1, status: "completed", response: "first" };
  var secondOutcome = { taskId: "task-race", generation: 1, status: "completed", response: "second" };
  var callback = function () { callbackCalls++; };
  assert.equal(outbox.capture(started.key, firstOutcome, callback).ok, false);
  assert.equal(outbox.capture(started.key, firstOutcome, callback).inFlight, true);
  assert.equal(outbox.capture(started.key, secondOutcome).conflict, true);
  assert.equal(outbox.setRoute(started.key, "callback").ok, true);
  assert.equal(outbox.markBlocked(started.key, "stopped").ok, true);
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(callbackCalls, 1);
  var captured = outbox.get(started.key);
  assert.equal(captured.outcome.response, "first");
  assert.equal(captured.deliveryRoute, "callback");
  assert.equal(captured.state, "blocked");
  var delivery = outbox.beginDelivery(started.key);
  assert.equal(outbox.markTranscript(started.key, delivery.attemptId).ok, true);
  assert.equal(outbox.markDelivery(started.key, delivery.attemptId, "accepted", { acceptedAt: Date.now() }).ok, true);
  timers[0]();
  var accepted = outbox.get(started.key);
  assert.equal(accepted.deliveryState, "accepted");
  assert.equal(accepted.deliveryAttemptCount, 1);
  assert.equal(accepted.transcriptPersisted, true);
  assert.equal(accepted.deliveryRoute, "callback");
  assert.equal(accepted.state, "blocked");
  assert.equal(accepted.outcome.response, "first");
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("a new manager exposes dispatching records as uncertain without replaying execution", function () {
  var filePath = tempPath();
  var first = attach({ filePath: filePath });
  var started = first.begin({ ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin", taskId: "task-2", generation: 3, driverSessionId: 41, workerSessionId: 42, message: "Inspect it" });
  assert.equal(started.ok, true);
  var second = attach({ filePath: filePath });
  var records = second.status().records;
  assert.equal(records.length, 1);
  assert.equal(records[0].state, "dispatching");
  assert.equal(records[0].recoveryState, "uncertain");
  assert.equal(records[0].deliveryState, "pending");
  assert.equal(records[0].driverOriginId, "driver-origin");
  assert.equal(records[0].workerOriginId, "worker-origin");
  assert.equal(records[0].taskId, "task-2");
  assert.equal(records[0].generation, 3);
  assert.equal(records[0].workerSessionId, 42);
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("failed begin does not create an in-memory dispatch or overwrite corrupt storage", function () {
  var filePath = tempPath();
  var calls = 0;
  var outbox = attach({ filePath: filePath, persist: function (target, serialized) {
    calls++;
    if (calls === 1) return false;
    return atomicPersist(target, serialized);
  } });
  var args = { ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin", taskId: "task-fail", generation: 1 };
  assert.equal(outbox.begin(args).ok, false);
  assert.equal(outbox.begin(args).ok, true);
  assert.equal(outbox.status().records.length, 1);
  fs.writeFileSync(filePath, "not-json", "utf8");
  var corrupt = attach({ filePath: filePath });
  assert.equal(corrupt.begin(args).ok, false);
  assert.equal(fs.readFileSync(filePath, "utf8"), "not-json");
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("stable numeric session ids cannot create a durable dispatch", function () {
  var outbox = attach({ filePath: tempPath() });
  var result = outbox.begin({ ownerId: "owner", driverOriginId: null, workerOriginId: null, taskId: "task-origin", generation: 1 });
  assert.equal(result.ok, false);
});

test("durable transcript helper refuses sessions without durable storage", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-durable-transcript-"));
  var manager = createSessionManager({ cwd: path.join(root, "project"), sessionsBase: path.join(root, "sessions"),
    cliSessionsDir: path.join(root, "cli"), send: function () {} });
  var session = manager.createSessionRaw({ ownerId: "owner" });
  assert.equal(manager.sendAndRecordDurably(session, { type: "user_message", text: "must persist" }), false);
  assert.equal(session.history.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("durable transcript helper distinguishes append failure from post-append send throws", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-durable-result-"));
  var throwOnSend = false;
  var manager = createSessionManager({ cwd: path.join(root, "project"), sessionsBase: path.join(root, "sessions"),
    cliSessionsDir: path.join(root, "cli"), send: function () { if (throwOnSend) throw new Error("client send failed"); } });
  throwOnSend = true;
  var durable = manager.createSessionRaw({ cliSessionId: "durable", ownerId: "owner" });
  durable.isProcessing = true;
  assert.equal(manager.saveSessionFile(durable), true);
  var record = { type: "user_message", text: "persist before send", pairResultOutboxKey: "key-1" };
  assert.equal(manager.sendAndRecordDurably(durable, record), true);
  assert.equal(manager.hasDurableSessionRecord(durable, function (entry) { return entry.pairResultOutboxKey === "key-1"; }), true);
  var blocked = manager.createSessionRaw({ cliSessionId: "blocked", ownerId: "owner" });
  assert.equal(manager.saveSessionFile(blocked), true);
  fs.unlinkSync(path.join(manager.sessionsDir, "blocked.jsonl"));
  fs.mkdirSync(path.join(manager.sessionsDir, "blocked.jsonl"), { recursive: true });
  var originalError = console.error;
  console.error = function () {};
  try { assert.equal(manager.sendAndRecordDurably(blocked, { type: "user_message", text: "cannot append" }), false); }
  finally { console.error = originalError; }
  assert.equal(blocked.history.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("delivery transitions require persistence before send and preserve uncertain acceptance", function () {
  var filePath = tempPath(), calls = 0;
  var outbox = attach({ filePath: filePath, persist: function (target, serialized) {
    calls++;
    if (calls === 3 || calls === 5) return false;
    return atomicPersist(target, serialized);
  } });
  var started = outbox.begin({ ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin", taskId: "task-delivery", generation: 1 });
  assert.equal(outbox.capture(started.key, { taskId: "task-delivery", generation: 1, status: "completed" }).ok, true);
  assert.equal(outbox.beginDelivery(started.key).ok, false);
  assert.equal(outbox.status().records[0].deliveryState, "pending");
  var delivery = outbox.beginDelivery(started.key);
  assert.equal(delivery.ok, true);
  assert.equal(outbox.markDelivery(started.key, delivery.attemptId, "accepted", { acceptedAt: Date.now() }).ok, false);
  assert.equal(outbox.status().records[0].recoveryState, "uncertain");
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("delivery attempts and callback route remain monotonic across reloads", function () {
  var filePath = tempPath();
  var first = attach({ filePath: filePath });
  var started = first.begin({ ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin",
    taskId: "task-budget", generation: 1, deliveryRoute: "blocking" });
  assert.equal(first.capture(started.key, { taskId: "task-budget", generation: 1, status: "completed" }).ok, true);
  assert.equal(first.beginDelivery(started.key).blocked, true);
  assert.equal(first.setRoute(started.key, "callback").ok, true);
  var attempt = first.beginDelivery(started.key);
  assert.equal(attempt.attemptId.endsWith(":1"), true);
  assert.equal(first.markDelivery(started.key, attempt.attemptId, "pending", { deliveryError: "not accepted" }).ok, true);
  var second = attach({ filePath: filePath });
  var next = second.beginDelivery(started.key);
  assert.equal(next.attemptId.endsWith(":2"), true);
  assert.equal(second.status().records[0].deliveryRoute, "callback");
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("reload treats an in-flight delivery as uncertain and never starts another attempt", function () {
  var filePath = tempPath();
  var first = attach({ filePath: filePath });
  var started = first.begin({ ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin",
    taskId: "task-in-flight", generation: 1, deliveryRoute: "callback" });
  first.capture(started.key, { taskId: "task-in-flight", generation: 1, status: "completed" });
  var attempt = first.beginDelivery(started.key);
  assert.equal(attempt.ok, true);
  var second = attach({ filePath: filePath });
  assert.equal(second.status().records[0].recoveryState, "uncertain");
  assert.equal(second.beginDelivery(started.key).inFlight, true);
  assert.equal(second.get(started.key).deliveryAttemptCount, 1);
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("stale attempt transitions cannot overwrite a newer delivery attempt", function () {
  var filePath = tempPath();
  var outbox = attach({ filePath: filePath });
  var started = outbox.begin({ ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin",
    taskId: "task-stale", generation: 1, deliveryRoute: "callback" });
  outbox.capture(started.key, { taskId: "task-stale", generation: 1, status: "completed" });
  var first = outbox.beginDelivery(started.key);
  outbox.markDelivery(started.key, first.attemptId, "pending", { deliveryError: "retry" });
  var second = outbox.beginDelivery(started.key);
  assert.equal(outbox.markDelivery(started.key, first.attemptId, "accepted", {}).stale, true);
  assert.equal(outbox.get(started.key).attemptId, second.attemptId);
  assert.equal(outbox.get(started.key).deliveryState, "attempting");
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("manual retry keeps lifetime attempt identity monotonic and rejects an old callback", function () {
  var filePath = tempPath(), outbox = attach({ filePath: filePath });
  var started = outbox.begin({ ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin",
    taskId: "task-manual", generation: 1, deliveryRoute: "callback" });
  outbox.capture(started.key, { taskId: "task-manual", generation: 1, status: "completed", response: "done" });
  var first = outbox.beginDelivery(started.key);
  assert.equal(first.attemptId.endsWith(":1"), true);
  assert.equal(outbox.markDelivery(started.key, first.attemptId, "uncertain").ok, true);
  assert.equal(outbox.grantManualRetry(started.key).ok, true);
  var second = outbox.beginDelivery(started.key);
  assert.equal(second.attemptId.endsWith(":2"), true);
  assert.equal(outbox.markDelivery(started.key, first.attemptId, "accepted").stale, true);
  assert.equal(outbox.get(started.key).deliveryState, "attempting");
  assert.equal(outbox.get(started.key).attemptId, second.attemptId);
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("a human turn clears Stop without erasing uncertain acceptance", function () {
  var filePath = tempPath(), outbox = attach({ filePath: filePath });
  var started = outbox.begin({ ownerId: "owner", driverOriginId: "driver-origin", workerOriginId: "worker-origin",
    taskId: "task-stop-uncertain", generation: 1, deliveryRoute: "callback" });
  outbox.capture(started.key, { taskId: "task-stop-uncertain", generation: 1, status: "completed", response: "done" });
  var attempt = outbox.beginDelivery(started.key);
  outbox.markDelivery(started.key, attempt.attemptId, "uncertain");
  outbox.markBlocked(started.key, "Human stopped", "human_stop");
  var authorized = outbox.authorizeHumanTurn(started.key);
  assert.equal(authorized.ok, true);
  assert.equal(authorized.record.deliveryState, "uncertain");
  assert.equal(authorized.record.blockedCode, null);
  assert.equal(outbox.beginDelivery(started.key).terminal, true);
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test("actual session-manager reload recovers only persisted terminal outcomes", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-session-reload-"));
  var sessionsBase = path.join(root, "sessions");
  function manager() { return createSessionManager({ cwd: path.join(root, "project"), sessionsBase: sessionsBase, cliSessionsDir: path.join(root, "cli"), send: function () {} }); }
  var firstManager = manager();
  var filler = firstManager.createSessionRaw({ cliSessionId: "filler", ownerId: "owner" });
  firstManager.saveSessionFile(filler);
  var worker = firstManager.createSessionRaw({ cliSessionId: "worker", ownerId: "owner" });
  var driver = firstManager.createSessionRaw({ cliSessionId: "driver", ownerId: "owner" });
  var outboxPath = path.join(firstManager.sessionsDir, "pair-result-outbox.json");
  var first = attach({ filePath: outboxPath });
  function dispatch(taskId, generation, status, response) {
    var key = first.begin({ ownerId: "owner", driverOriginId: driver.sessionOriginId, workerOriginId: worker.sessionOriginId,
      taskId: taskId, generation: generation, workerSessionId: worker.localId, historyStartIndex: worker.history.length }).key;
    worker.history.push({ type: "user_message", delegatedTaskId: taskId, delegatedGeneration: generation, text: taskId });
    if (!status) worker.history.push({ type: "delta", text: "Partial but not terminal" });
    firstManager.saveSessionFile(worker);
    if (status) firstManager.sendAndRecord(worker, { type: "pair_task_completed", _internal: true, ownerId: "owner",
      driverOriginId: driver.sessionOriginId, workerOriginId: worker.sessionOriginId, taskId: taskId, generation: generation,
      outcome: { taskId: taskId, generation: generation, status: status, response: response } });
    return key;
  }
  dispatch("task-complete", 1, "completed", "Done");
  dispatch("task-failed", 2, "failed", "Failed");
  dispatch("task-interrupted", 3, "interrupted", "Partial");
  var dispatchOnly = dispatch("task-pending", 4, null, null);
  firstManager.saveSessionFile(driver);
  fs.unlinkSync(path.join(firstManager.sessionsDir, "filler.jsonl"));
  var reloadedManager = manager();
  var restoredWorker = Array.from(reloadedManager.sessions.values()).find(function (session) { return session.sessionOriginId === worker.sessionOriginId; });
  assert.notEqual(restoredWorker.localId, worker.localId);
  var second = attach({ filePath: outboxPath });
  var recovered = second.recoverPending(reloadedManager.sessions);
  assert.equal(recovered.filter(function (item) { return item.result.ok; }).length, 3);
  var records = second.status().records;
  assert.deepEqual(records.filter(function (record) { return record.state === "captured"; }).map(function (record) { return record.outcome.status; }).sort(), ["completed", "failed", "interrupted"]);
  assert.equal(records.find(function (record) { return record.key.indexOf("task-pending") !== -1; }).recoveryState, "uncertain");
  var wrongOwner = Object.assign({}, restoredWorker, { ownerId: "other-owner" });
  assert.equal(second.recover(dispatchOnly, wrongOwner).uncertain, true);
  restoredWorker.history.push({ type: "pair_task_completed", ownerId: "owner", driverOriginId: driver.sessionOriginId,
    workerOriginId: worker.sessionOriginId, taskId: "wrong-task", generation: 999, outcome: { taskId: "wrong-task", generation: 999, status: "completed" } });
  var fabricated = second.recover(dispatchOnly, restoredWorker);
  assert.equal(fabricated.uncertain, true);
  fs.rmSync(root, { recursive: true, force: true });
});
