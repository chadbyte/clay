var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachPairResultOutbox = require("../lib/project-pair-result-outbox").attachPairResultOutbox;
var attachPairResultRecovery = require("../lib/project-pair-result-recovery").attachPairResultRecovery;
var attachPairResultDelivery = require("../lib/project-pair-result-delivery").attachPairResultDelivery;
var createSessionManager = require("../lib/sessions").createSessionManager;

function fixture(ownerId) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-result-recovery-"));
  var outbox = attachPairResultOutbox({ storageDir: dir, projectSlug: "project" });
  var driver = { localId: 31, ownerId: ownerId || null, sessionOriginId: "driver-origin", history: [] };
  var worker = { localId: 47, ownerId: ownerId || null, sessionOriginId: "worker-origin", history: [],
    sessionProvenance: { kind: "worker", parentSessionOriginId: "driver-origin", generation: 2 } };
  var sessions = new Map([[driver.localId, driver], [worker.localId, worker]]);
  var group = { id: "group", members: [driver.localId, worker.localId], pair: { driverId: driver.localId, workerId: worker.localId } };
  var store = { groupForMember: function (id) { return group.members.indexOf(id) === -1 ? null : group; } };
  var wakeCount = 0, finishCount = 0, clients = new Set(), viewedListener = null;
  var recovery = attachPairResultRecovery({
    sm: { sessions: sessions, addOnSessionViewed: function (listener) { viewedListener = listener; } }, store: store, outbox: outbox,
    resultCapture: { finish: function (caller, partner, token) {
      finishCount++;
      var saved = outbox.markFinalized(token.outboxKey);
      if (saved.ok) { delete partner._pairDelegation; delete partner._delegatedBy; }
      return saved.ok;
    } },
    wake: function () { wakeCount++; return { ok: true }; }, projectSlug: "project",
    sendTo: function (ws, message) { ws.messages.push(message); }, getClients: function () { return clients; },
    isMultiUser: function () { return !!ownerId; },
  });
  function captured(route) {
    var begun = outbox.begin({ ownerId: ownerId || null, projectSlug: "project", driverOriginId: "driver-origin",
      workerOriginId: "worker-origin", taskId: "task", generation: 2, historyStartIndex: 0,
      message: "bounded task", deliveryRoute: route || "callback" });
    assert.equal(begun.ok, true);
    assert.equal(outbox.capture(begun.key, { status: "completed", taskId: "task", generation: 2, response: "done" }).ok, true);
    return begun.key;
  }
  return { dir: dir, outbox: outbox, driver: driver, worker: worker, sessions: sessions, group: group,
    recovery: recovery, captured: captured, clients: clients,
    view: function (session, ws) { viewedListener(session, ws, function (message) { ws.messages.push(message); }); },
    wakeCount: function () { return wakeCount; }, finishCount: function () { return finishCount; } };
}

test("pending recovery reconstructs only result delivery and coalesces availability wakes", async function () {
  var f = fixture(), key = f.captured();
  f.recovery.available(f.driver); f.recovery.available(f.driver); f.recovery.available(f.driver);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(f.wakeCount(), 1);
  assert.equal(f.worker.history.length, 0);
  assert.equal(f.worker._pairDelegation.outboxKey, key);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("accepted recovery finalizes once without replaying transport", function () {
  var f = fixture(), key = f.captured(), attempt = f.outbox.beginDelivery(key);
  assert.equal(f.outbox.markDelivery(key, attempt.attemptId, "accepted", { acceptedAt: Date.now() }).ok, true);
  f.recovery.reconcile();
  f.recovery.reconcile();
  assert.equal(f.wakeCount(), 0);
  assert.equal(f.finishCount(), 1);
  assert.equal(f.outbox.get(key).finalized, true);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("unproven prepared close never becomes an outcome from recovery topology", function () {
  var mutations = [
    function (f) { f.group.members = []; f.group.pair = null; },
    function (f) { f.group.members = [f.driver.localId]; f.group.pair = { driverId: f.driver.localId, workerId: 999 }; },
    function (f) {
      var replacement = { localId: 88, ownerId: "owner", sessionOriginId: "replacement-origin", history: [] };
      f.sessions.set(replacement.localId, replacement);
      f.group.members = [f.driver.localId, replacement.localId];
      f.group.pair = { driverId: f.driver.localId, workerId: replacement.localId };
    },
    function (f) { f.worker.ownerId = "changed-owner"; },
    function (f) { f.worker.sessionProvenance.generation = 3; },
  ];
  for (var i = 0; i < mutations.length; i++) {
    var f = fixture("owner");
    var begun = f.outbox.begin({ ownerId: "owner", projectSlug: "project", groupId: f.group.id,
      driverOriginId: "driver-origin", workerOriginId: "worker-origin", taskId: "close-task-" + i,
      generation: 2, historyStartIndex: 0, message: "close task", deliveryRoute: "callback" });
    var proposed = { taskId: "close-task-" + i, generation: 2, status: "interrupted", response: "partial" };
    assert.equal(f.outbox.prepareCapture(begun.key, proposed).ok, true);
    mutations[i](f);
    f.recovery.reconcile();
    var retained = f.outbox.get(begun.key);
    assert.equal(retained.state, "close_prepared");
    assert.equal(retained.outcome, null);
    assert.deepEqual(retained.preparedCloseOutcome, proposed);
    assert.equal(f.wakeCount(), 0);
    var ws = { _clayUser: { id: "owner" }, _clayActiveSession: f.driver.localId, messages: [] };
    f.recovery.sendState(f.driver, ws);
    assert.deepEqual(ws.messages[0].items, []);
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("restart converts attempting to visible uncertain and requires explicit duplicate confirmation", async function () {
  var f = fixture("owner"), key = f.captured(), attempt = f.outbox.beginDelivery(key);
  assert.equal(attempt.ok, true);
  f.recovery.reconcile();
  assert.equal(f.outbox.get(key).deliveryState, "uncertain");
  assert.equal(f.wakeCount(), 0);
  var ws = { _clayUser: { id: "owner" }, _clayActiveSession: f.driver.localId, messages: [] };
  f.recovery.sendState(f.driver, ws);
  var item = ws.messages[0].items[0];
  assert.equal(item.state, "uncertain");
  assert.equal(item.confirmDuplicate, true);
  f.recovery.handleMessage(ws, { type: "pair_result_retry", id: item.id, confirmDuplicate: false });
  assert.equal(f.outbox.get(key).deliveryState, "uncertain");
  f.recovery.handleMessage(ws, { type: "pair_result_retry", id: item.id, confirmDuplicate: true });
  assert.equal(f.outbox.get(key).deliveryState, "pending");
  assert.equal(f.outbox.get(key).manualRetryCount, 1);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(f.wakeCount(), 1);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("owner mismatch cannot read or retry a retained outcome", function () {
  var f = fixture("owner"); f.captured();
  var ws = { _clayUser: { id: "intruder" }, _clayActiveSession: f.driver.localId, messages: [] };
  assert.equal(f.recovery.sendState(f.driver, ws), false);
  assert.equal(f.recovery.handleMessage(ws, { type: "pair_result_state_request" }), true);
  assert.deepEqual(ws.messages, []);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("visibility distinguishes missing durable completion from failed finalization", function () {
  var f = fixture("owner");
  var dispatch = f.outbox.begin({ ownerId: "owner", projectSlug: "project", driverOriginId: "driver-origin",
    workerOriginId: "worker-origin", taskId: "capture-missing", generation: 2, deliveryRoute: "callback" });
  var acceptedKey = f.captured(), attempt = f.outbox.beginDelivery(acceptedKey);
  f.outbox.markDelivery(acceptedKey, attempt.attemptId, "accepted");
  var ws = { _clayUser: { id: "owner" }, _clayActiveSession: f.driver.localId, messages: [] };
  f.recovery.sendState(f.driver, ws);
  assert.equal(ws.messages[0].items.length, 1);
  assert.equal(ws.messages[0].items[0].hasCompletedResult, false);
  assert.match(ws.messages[0].items[0].message, /no durable completed result/i);
  f.outbox.markFinalizationFailure(acceptedKey, "Result hook failed");
  f.recovery.sendState(f.driver, ws);
  var latest = ws.messages[1].items;
  assert.equal(latest.length, 2);
  assert.equal(latest.find(function (item) { return item.hasCompletedResult; }).state, "blocked");
  assert.equal(f.outbox.get(dispatch.key).outcome, null);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("session view stays quiet for an exact healthy live dispatch but exposes capture failure and abandonment", function () {
  var f = fixture("owner");
  var dispatch = f.outbox.begin({ ownerId: "owner", projectSlug: "project", driverOriginId: "driver-origin",
    workerOriginId: "worker-origin", taskId: "live-task", generation: 2, deliveryRoute: "callback" });
  f.worker._pairDelegation = { outboxKey: dispatch.key, taskId: "live-task", generation: 2, from: f.driver.localId, groupId: f.group.id };
  f.worker._delegatedBy = f.driver.localId; f.worker.isProcessing = true;
  var ws = { _clayUser: { id: "owner" }, _clayActiveSession: f.driver.localId, messages: [] };
  f.view(f.driver, ws);
  assert.deepEqual(ws.messages[0].items, []);
  f.worker.isProcessing = false; f.worker._pairDelegation._capturePending = true;
  f.view(f.driver, ws);
  assert.equal(ws.messages[1].items.length, 1);
  assert.equal(ws.messages[1].items[0].hasCompletedResult, false);
  delete f.worker._pairDelegation; delete f.worker._delegatedBy;
  f.view(f.driver, ws);
  assert.equal(ws.messages[2].items.length, 1);
  assert.match(ws.messages[2].items[0].message, /no durable completed result/i);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("Stop remains authoritative until an actual human turn authorizes delivery", async function () {
  var f = fixture(), key = f.captured();
  assert.equal(f.outbox.markBlocked(key, "The human stopped this Split Worker turn.", "human_stop").ok, true);
  f.recovery.process(key, true);
  assert.equal(f.wakeCount(), 0);
  f.recovery.beginHumanTurn(f.driver);
  assert.equal(f.outbox.get(key).blockedCode, null);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(f.wakeCount(), 1);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("client routing clears status on switch and uses a custom duplicate confirmation", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/pair-result-status.js"), "utf8");
  var router = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
  assert.match(source, /showConfirm\(/);
  assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/);
  assert.match(router, /case "pair_result_status"/);
  assert.match(router, /case "session_switched":\s*clearPairResultStatus\(\)/);
});

test("real manager reload and session activation drive the real sender without Worker execution", async function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-result-integration-"));
  var sessionsBase = path.join(root, "sessions"), projectPath = path.join(root, "project");
  function manager() { return createSessionManager({ cwd: projectPath, sessionsBase: sessionsBase,
    cliSessionsDir: path.join(root, "cli"), send: function () {}, sendTo: function (ws, message) { ws.messages.push(message); } }); }
  var firstManager = manager();
  var driver = firstManager.createSessionRaw({ cliSessionId: "driver", ownerId: "owner" });
  var worker = firstManager.createSessionRaw({ cliSessionId: "worker", ownerId: "owner" });
  worker.sessionProvenance = { kind: "worker", parentSessionOriginId: driver.sessionOriginId, generation: 2, createdVia: "split-worker" };
  firstManager.saveSessionFile(driver); firstManager.saveSessionFile(worker);
  var firstOutbox = attachPairResultOutbox({ storageDir: firstManager.sessionsDir, projectSlug: "project" });
  var begun = firstOutbox.begin({ ownerId: "owner", projectSlug: "project", driverOriginId: driver.sessionOriginId,
    workerOriginId: worker.sessionOriginId, taskId: "reload-task", generation: 2, message: "finished work", deliveryRoute: "callback" });
  firstOutbox.capture(begun.key, { taskId: "reload-task", generation: 2, status: "completed", response: "retained result" });
  var reloadedManager = manager(), restoredDriver, restoredWorker;
  reloadedManager.sessions.forEach(function (session) {
    if (session.sessionOriginId === driver.sessionOriginId) restoredDriver = session;
    if (session.sessionOriginId === worker.sessionOriginId) restoredWorker = session;
  });
  assert.ok(restoredDriver); assert.ok(restoredWorker);
  var group = { id: "restored-pair", members: [restoredDriver.localId, restoredWorker.localId],
    pair: { driverId: restoredDriver.localId, workerId: restoredWorker.localId } };
  var store = { groupForMember: function (id) { return group.members.indexOf(id) === -1 ? null : group; } };
  var outbox = attachPairResultOutbox({ storageDir: reloadedManager.sessionsDir, projectSlug: "project" });
  var starts = 0, workerStarts = 0, stopReason = null, recovery;
  var sdk = { pushMessage: function () { return false; }, startQuery: function (session, text, images, linuxUser, beforePush, onAccepted) {
    if (session === restoredWorker) workerStarts++;
    else starts++;
    session._queryStarting = true;
    if (beforePush() === true) onAccepted();
    session._queryStarting = false;
    return Promise.resolve(true);
  } };
  function finish(caller, partner, token) {
    var saved = outbox.markFinalized(token.outboxKey);
    if (saved.ok) { delete partner._pairDelegation; delete partner._delegatedBy; }
    return saved.ok;
  }
  var delivery = attachPairResultDelivery({ sm: reloadedManager, store: store, outbox: outbox, getSdk: function () { return sdk; },
    getLinuxUserForSession: function () { return null; }, blockedReason: function () { return stopReason; }, finish: finish,
    onStateChange: function (caller, record) { if (recovery) recovery.stateChanged(caller, record); } });
  recovery = attachPairResultRecovery({ sm: reloadedManager, store: store, outbox: outbox,
    resultCapture: { finish: finish }, wake: delivery.wake, projectSlug: "project", blockedReason: function () { return stopReason; },
    sendTo: function (ws, message) { ws.messages.push(message); }, getClients: function () { return []; }, isMultiUser: function () { return true; } });
  var ws = { _clayUser: { id: "owner" }, _clayActiveSession: restoredDriver.localId, readyState: 1, messages: [] };
  reloadedManager.switchSession(restoredDriver.localId, ws);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.ok(ws.messages.findIndex(function (message) { return message.type === "history_done"; }) <
    ws.messages.findIndex(function (message) { return message.type === "pair_result_status"; }));
  assert.equal(starts, 1); assert.equal(workerStarts, 0);
  assert.equal(outbox.get(begun.key).deliveryState, "accepted");
  assert.equal(outbox.get(begun.key).finalized, true);
  var stopped = outbox.begin({ ownerId: "owner", projectSlug: "project", driverOriginId: restoredDriver.sessionOriginId,
    workerOriginId: restoredWorker.sessionOriginId, taskId: "stopped-task", generation: 2, message: "other result", deliveryRoute: "blocking" });
  outbox.capture(stopped.key, { taskId: "stopped-task", generation: 2, status: "completed", response: "stopped result" });
  stopReason = "The human stopped this Split Worker turn.";
  recovery.process(stopped.key, true);
  assert.equal(outbox.get(stopped.key).blockedCode, "human_stop");
  assert.equal(outbox.get(stopped.key).finalized, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("real manager reload routes two renumbered Worker results by stable origins without redispatch", async function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-v2-result-reload-"));
  var sessionsBase = path.join(root, "sessions"), projectPath = path.join(root, "project");
  function manager() { return createSessionManager({ cwd: projectPath, sessionsBase: sessionsBase,
    cliSessionsDir: path.join(root, "cli"), send: function () {}, sendTo: function () {} }); }
  var first = manager();
  var padding = first.createSessionRaw({ cliSessionId: "padding", ownerId: "owner" });
  var driver = first.createSessionRaw({ cliSessionId: "driver-v2", ownerId: "owner" });
  var workerA = first.createSessionRaw({ cliSessionId: "worker-a-v2", ownerId: "owner" });
  var workerB = first.createSessionRaw({ cliSessionId: "worker-b-v2", ownerId: "owner" });
  workerA.sessionProvenance = { kind: "worker", parentSessionOriginId: driver.sessionOriginId, generation: 4, createdVia: "split-worker" };
  workerB.sessionProvenance = { kind: "worker", parentSessionOriginId: driver.sessionOriginId, generation: 5, createdVia: "split-worker" };
  first.saveSessionFile(driver); first.saveSessionFile(workerA); first.saveSessionFile(workerB);
  first.deleteSession(padding.localId);
  var firstOutbox = attachPairResultOutbox({ storageDir: first.sessionsDir, projectSlug: "project" });
  var startedA = firstOutbox.begin({ ownerId: "owner", projectSlug: "project", driverOriginId: driver.sessionOriginId,
    workerOriginId: workerA.sessionOriginId, taskId: "reload-a", generation: 4, message: "A", deliveryRoute: "callback" });
  var startedB = firstOutbox.begin({ ownerId: "owner", projectSlug: "project", driverOriginId: driver.sessionOriginId,
    workerOriginId: workerB.sessionOriginId, taskId: "reload-b", generation: 5, message: "B", deliveryRoute: "callback" });
  firstOutbox.capture(startedA.key, { taskId: "reload-a", generation: 4, status: "completed", response: "A done" });
  firstOutbox.capture(startedB.key, { taskId: "reload-b", generation: 5, status: "completed", response: "B done" });

  var reloaded = manager(), restoredDriver, restoredA, restoredB;
  reloaded.sessions.forEach(function (session) {
    if (session.sessionOriginId === driver.sessionOriginId) restoredDriver = session;
    if (session.sessionOriginId === workerA.sessionOriginId) restoredA = session;
    if (session.sessionOriginId === workerB.sessionOriginId) restoredB = session;
  });
  assert.notEqual(restoredDriver.localId, driver.localId, "removing the padding session renumbers restored sessions");
  var group = { id: "injected-v2", members: [restoredDriver.localId, restoredA.localId, restoredB.localId],
    pair: { version: 2, driverId: restoredDriver.localId, workerIds: [restoredA.localId, restoredB.localId] } };
  var store = { groupForMember: function (id) { return group.members.indexOf(id) === -1 ? null : group; } };
  var outbox = attachPairResultOutbox({ storageDir: reloaded.sessionsDir, projectSlug: "project" });
  var driverStarts = 0, workerStarts = 0, recovery;
  var sdk = { pushMessage: function () { return false; }, startQuery: function (session, text, images, linuxUser, beforePush, onAccepted) {
    if (session === restoredA || session === restoredB) workerStarts++;
    else driverStarts++;
    if (beforePush() === true) onAccepted();
    return Promise.resolve(true);
  } };
  function finish(caller, partner, token) {
    var saved = outbox.markFinalized(token.outboxKey);
    if (saved.ok) { delete partner._pairDelegation; delete partner._delegatedBy; }
    return saved.ok;
  }
  var delivery = attachPairResultDelivery({ sm: reloaded, store: store, outbox: outbox, getSdk: function () { return sdk; },
    getLinuxUserForSession: function () { return null; }, blockedReason: function () { return null; }, finish: finish,
    onStateChange: function (caller, record) { if (recovery) recovery.stateChanged(caller, record); } });
  recovery = attachPairResultRecovery({ sm: reloaded, store: store, outbox: outbox, resultCapture: { finish: finish },
    wake: delivery.wake, projectSlug: "project", blockedReason: function () { return null; }, sendTo: function () {},
    getClients: function () { return []; }, isMultiUser: function () { return true; } });
  recovery.available(restoredDriver);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(driverStarts, 2);
  assert.equal(workerStarts, 0);
  assert.equal(outbox.list().filter(function (record) { return record.deliveryState === "accepted" && record.finalized; }).length, 2);
  assert.equal(restoredA.history.filter(function (entry) { return entry && entry.type === "user_message"; }).length, 0);
  assert.equal(restoredB.history.filter(function (entry) { return entry && entry.type === "user_message"; }).length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("explicit retry resets live token flags while stale sender acceptance stays isolated", async function () {
  var f = fixture("owner"), key = f.captured(), callbacks = [], recovery;
  var sm = { sessions: f.sessions, addOnSessionViewed: function () {},
    sendAndRecordDurably: function (session, record) { session.history.push(record); return true; },
    hasDurableSessionRecord: function () { return false; } };
  var sdk = { pushMessage: function () { return false; }, startQuery: function (session, text, images, linuxUser, beforePush, onAccepted) {
    session._queryStarting = true;
    assert.equal(beforePush(), true);
    callbacks.push(onAccepted);
    session._queryStarting = false;
    return new Promise(function () {});
  } };
  function finish(caller, partner, token) {
    var saved = f.outbox.markFinalized(token.outboxKey);
    if (saved.ok) { delete partner._pairDelegation; delete partner._delegatedBy; }
    return saved.ok;
  }
  var delivery = attachPairResultDelivery({ sm: sm, store: { groupForMember: function () { return f.group; } }, outbox: f.outbox,
    getSdk: function () { return sdk; }, getLinuxUserForSession: function () { return null; }, blockedReason: function () { return null; },
    acceptanceTimeoutMs: 10, finish: finish, onStateChange: function (caller, record) { if (recovery) recovery.stateChanged(caller, record); } });
  recovery = attachPairResultRecovery({ sm: sm, store: { groupForMember: function () { return f.group; } }, outbox: f.outbox,
    resultCapture: { finish: finish }, wake: delivery.wake, projectSlug: "project", blockedReason: function () { return null; },
    sendTo: function (ws, message) { ws.messages.push(message); }, getClients: function () { return []; }, isMultiUser: function () { return true; } });
  recovery.process(key, true);
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  assert.equal(f.outbox.get(key).deliveryState, "uncertain");
  assert.equal(f.worker._pairDelegation._deliveryUncertain, true);
  var ws = { _clayUser: { id: "owner" }, _clayActiveSession: f.driver.localId, messages: [] };
  recovery.sendState(f.driver, ws);
  recovery.handleMessage(ws, { type: "pair_result_retry", id: ws.messages[0].items[0].id, confirmDuplicate: true,
    sessionId: f.driver.localId, projectSlug: "project" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(callbacks.length, 2);
  assert.equal(f.worker._pairDelegation._deliveryUncertain, undefined);
  assert.equal(f.outbox.get(key).attemptId.endsWith(":2"), true);
  callbacks[0]();
  assert.equal(f.outbox.get(key).deliveryState, "attempting");
  callbacks[1]();
  assert.equal(f.outbox.get(key).deliveryState, "accepted");
  assert.equal(f.outbox.get(key).finalized, true);
  fs.rmSync(f.dir, { recursive: true, force: true });
});
