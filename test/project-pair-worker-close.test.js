var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attachPairWorkerClose = require("../lib/project-pair-worker-close").attachPairWorkerClose;
var multiWorkerFeature = require("../lib/multi-worker-feature");
var createSessionManager = require("../lib/sessions").createSessionManager;
var createSplitGroupStore = require("../lib/session-split-groups").createSplitGroupStore;
var attachSessionPair = require("../lib/project-session-pair").attachSessionPair;
var attachPairResultOutbox = require("../lib/project-pair-result-outbox").attachPairResultOutbox;
var provenance = require("../lib/session-provenance");

var helperPromise = null;
function loadClientHelpers() {
  if (!helperPromise) {
    var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-group-helpers.js"), "utf8");
    helperPromise = import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  }
  return helperPromise;
}

function atomicWrite(filePath, serialized) {
  var tempPath = filePath + ".test";
  fs.writeFileSync(tempPath, serialized, "utf8");
  fs.renameSync(tempPath, filePath);
  return true;
}

async function realFixture(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-real-worker-close-"));
  var mode = "ok";
  var outboxMode = "ok";
  var outboxPersistCalls = 0;
  var outboxFailAt = null;
  var outboxFailKind = null;
  var groupPersistCalls = 0;
  var sent = [];
  var workerStarts = 0;
  var aborts = 0;
  var capability = multiWorkerFeature.fromServerConfig({ multiWorkerRuntimeEnabled: true });
  var sm = createSessionManager({ cwd: dir, sessionsBase: dir, cliSessionsDir: path.join(dir, "cli"),
    send: function () {}, sendTo: function () {} });
  var driver = sm.createSessionRaw({ cliSessionId: "cli-driver", vendor: "codex" });
  var workerA = sm.createSessionRaw({ cliSessionId: "cli-worker-a", vendor: "codex" });
  var workerB = sm.createSessionRaw({ cliSessionId: "cli-worker-b", vendor: "codex" });
  driver.title = "Driver"; workerA.title = "Worker A"; workerB.title = "Worker B";
  driver.queryInstance = {};
  provenance.markWorker(driver, workerA, sm.sessions);
  provenance.markWorker(driver, workerB, sm.sessions);
  workerA._pairGeneration = workerA.sessionProvenance.generation;
  workerB._pairGeneration = workerB.sessionProvenance.generation;
  var store = createSplitGroupStore({ sessions: sm.sessions, sessionsDir: sm.sessionsDir,
    usersModule: null, multiWorkerFeature: capability,
    persistGroups: function (filePath, serialized) {
      groupPersistCalls++;
      if (mode === "false") return false;
      if (mode === "throw") throw new Error("group persistence threw");
      return atomicWrite(filePath, serialized);
    } });
  var created = store.create(null, { members: [driver.localId, workerA.localId],
    pair: { driverId: driver.localId, workerId: workerA.localId } });
  assert.equal(created.ok, true);
  assert.equal(store.addWorker(null, {
    groupId: created.group.id, driverId: driver.localId, driverOriginId: driver.sessionOriginId,
    newWorkerId: workerB.localId, newWorkerOriginId: workerB.sessionOriginId,
  }, capability).ok, true);
  var outbox = attachPairResultOutbox({ storageDir: sm.sessionsDir, projectSlug: "project-a",
    persist: function (filePath, serialized) {
      outboxPersistCalls++;
      if (outboxFailAt === outboxPersistCalls) {
        if (outboxFailKind === "false") return false;
        throw new Error("outbox persistence threw");
      }
      if (outboxMode === "false") return false;
      if (outboxMode === "throw") throw new Error("outbox persistence threw");
      return atomicWrite(filePath, serialized);
    } });
  var sdk = {
    pushMessage: function (target) { return target === driver; },
    startQuery: function (target) { if (target === workerA) workerStarts++; return Promise.resolve(true); },
  };
  var pair = attachSessionPair({ sm: sm, splitStore: store, resultOutbox: outbox,
    multiWorkerFeature: capability, projectSlug: "project-a", getSdk: function () { return sdk; },
    getLinuxUserForSession: function () { return null; }, send: function () {}, sendTo: function () {},
    usersModule: { isMultiUser: function () { return false; } }, onProcessingChanged: function () {} });
  workerA.abortController = { abort: function () { aborts++; } };
  var activeResult = await pair.sendToPartner({ workerId: workerA.localId, taskId: "task-close-a",
    message: "Keep this task live until targeted close.", wait: false }, driver);
  assert.equal(JSON.parse(activeResult.content[0].text).status, "running");
  var queueTool = pair.getToolDefs(driver).find(function (tool) { return tool.name === "queue_partner_followup"; });
  var queued = JSON.parse((await queueTool.handler({ workerId: workerA.localId, taskId: "task-queued-a",
    message: "Queued work must survive a failed close." })).content[0].text);
  assert.equal(queued.status, "queued");
  var permissionPromise = pair.workerPermission.routeIfWorker(workerA,
    { toolName: "Write", input: { file_path: "/tmp/close-test" }, toolUseId: "close-permission" });
  assert.equal(pair.workerPermission.pendingCountFor(workerA), 1);
  var ws = { readyState: 1, _clayActiveSession: driver.localId };
  var sockets = new Set([ws]);
  var handler = attachPairWorkerClose({ sm: sm, splitStore: store, multiWorkerFeature: capability,
    isMate: false, projectSlug: "project-a", hasSocket: function (socket) { return sockets.has(socket); },
    sendTo: function (socket, message) { sent.push(message); }, closeWorker: pair.closeWorker });
  var helpers = await loadClientHelpers();
  var groupProjection = store.listFor(ws)[0];
  var sessionProjection = sm.mapSessionsForClient(Array.from(sm.sessions.values()), driver.localId, {});
  var request = helpers.splitWorkerCloseRequest(groupProjection, sessionProjection, "project-a",
    workerA.localId, "real-close-request");
  assert.ok(request);
  t.after(async function () {
    pair.workerPermission.cancelForSession(workerA, "test cleanup");
    workerA.isProcessing = false;
    await permissionPromise;
    await new Promise(function (resolve) { setTimeout(resolve, 550); });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir: dir, setMode: function (value) { mode = value; },
    setOutboxMode: function (value) { outboxMode = value; }, sm: sm, store: store,
    failOutboxAfter: function (offset, kind) { outboxFailAt = outboxPersistCalls + offset; outboxFailKind = kind; },
    driver: driver, workerA: workerA, workerB: workerB, pair: pair, outbox: outbox,
    handler: handler, ws: ws, sent: sent, request: request, permissionPromise: permissionPromise,
    workerStarts: function () { return workerStarts; }, aborts: function () { return aborts; },
    groupPersistCalls: function () { return groupPersistCalls; } };
}

function session(id, origin, generation) {
  return {
    localId: id,
    ownerId: "owner-a",
    sessionOriginId: origin,
    _pairGeneration: generation || null,
  };
}

function fixture() {
  var driver = session(1, "origin-driver");
  var workerA = session(2, "origin-worker-a", 4);
  var workerB = session(3, "origin-worker-b", 5);
  var sessions = new Map([[1, driver], [2, workerA], [3, workerB]]);
  var group = {
    id: "group-a",
    ownerId: "owner-a",
    members: [1, 2, 3],
    pair: { version: 2, driverId: 1, workerIds: [2, 3] },
  };
  var ws = { readyState: 1, _clayUser: { id: "owner-a" }, _clayActiveSession: 1 };
  var sockets = new Set([ws]);
  var sent = [];
  var closes = [];
  var handler = attachPairWorkerClose({
    sm: { sessions: sessions },
    splitStore: { groupForMember: function (id) { return group.members.indexOf(id) === -1 ? null : group; } },
    multiWorkerFeature: multiWorkerFeature.fromServerConfig({ multiWorkerRuntimeEnabled: true }),
    isMate: false,
    projectSlug: "project-a",
    hasSocket: function (socket) { return sockets.has(socket); },
    sendTo: function (socket, message) { sent.push({ socket: socket, message: message }); },
    closeWorker: function (args, caller) { closes.push({ args: args, caller: caller }); return { status: "closed" }; },
  });
  function message() {
    return {
      type: "split_worker_close",
      requestId: "request-a",
      projectSlug: "project-a",
      groupId: "group-a",
      driverId: 1,
      driverOriginId: "origin-driver",
      workerId: 2,
      workerOriginId: "origin-worker-a",
      generation: 4,
      expectedWorkerIds: [2, 3],
    };
  }
  return { handler: handler, ws: ws, sockets: sockets, sent: sent, closes: closes, group: group, message: message };
}

test("authenticated exact Driver socket closes only the selected Worker generation", function () {
  var f = fixture();
  assert.equal(f.handler.handleMessage(f.ws, f.message()), true);
  assert.equal(f.closes.length, 1);
  assert.deepEqual(f.closes[0].args, { workerId: 2 });
  assert.equal(f.closes[0].caller.localId, 1);
  assert.equal(f.sent[0].message.ok, true);
  assert.equal(f.sent[0].message.workerId, 2);
});

test("real capture failure retains the exact live task and never attempts structural removal", async function (t) {
  var f = await realFixture(t);
  var groupBefore = JSON.parse(JSON.stringify(f.store.groups[0]));
  var token = f.workerA._pairDelegation;
  var tokenBefore = JSON.parse(JSON.stringify(token));
  var persistCalls = f.groupPersistCalls();
  f.setOutboxMode("false");
  assert.equal(f.handler.handleMessage(f.ws, f.request), true);
  assert.equal(f.sent[f.sent.length - 1].ok, false);
  assert.match(f.sent[f.sent.length - 1].error, /persistence returned false|durably capture/);
  assert.deepEqual(f.store.groups[0], groupBefore);
  assert.equal(f.workerA._pairDelegation, token);
  assert.deepEqual(JSON.parse(JSON.stringify(token)), tokenBefore);
  assert.equal(f.pair.workerPermission.pendingCountFor(f.workerA), 1);
  assert.equal(f.aborts(), 0);
  assert.equal(f.outbox.get(token.outboxKey).outcome, null);
  assert.equal(f.groupPersistCalls(), persistCalls);
});

["false", "throw"].forEach(function (rollbackMode) {
  test("failed structural close with rollback " + rollbackMode + " reloads as non-deliverable prepared intent", async function (t) {
    var f = await realFixture(t);
    var token = f.workerA._pairDelegation;
    var tokenBefore = JSON.parse(JSON.stringify(token));
    f.setMode("false");
    f.failOutboxAfter(2, rollbackMode);
    assert.equal(f.handler.handleMessage(f.ws, f.request), true);
    assert.equal(f.sent[f.sent.length - 1].ok, false);
    assert.match(f.sent[f.sent.length - 1].error, /rollback failed/);
    assert.equal(f.workerA._pairDelegation, token);
    assert.deepEqual(JSON.parse(JSON.stringify(token)), tokenBefore);
    assert.equal(f.pair.workerPermission.pendingCountFor(f.workerA), 1);
    assert.equal(f.aborts(), 0);
    var reloaded = attachPairResultOutbox({ storageDir: f.sm.sessionsDir, projectSlug: "project-a" });
    var record = reloaded.get(token.outboxKey);
    assert.equal(record.state, "close_prepared");
    assert.equal(record.outcome, null);
    assert.equal(record.preparedCloseOutcome.status, "interrupted");
    assert.equal(reloaded.beginDelivery(token.outboxKey).ok, false);
  });
});

test("stale identity, membership, project, socket, and generation never reach structural close", function () {
  var mutations = [
    function (f, msg) { msg.projectSlug = "project-b"; },
    function (f, msg) { msg.driverOriginId = "stale-driver"; },
    function (f, msg) { msg.expectedWorkerIds = [3, 2]; },
    function (f, msg) { msg.workerOriginId = "stale-worker"; },
    function (f, msg) { msg.generation = 3; },
    function (f) { f.sockets.clear(); },
  ];
  for (var i = 0; i < mutations.length; i++) {
    var f = fixture();
    var msg = f.message();
    mutations[i](f, msg);
    assert.equal(f.handler.handleMessage(f.ws, msg), true);
    assert.equal(f.closes.length, 0);
    assert.equal(f.sent[0].message.ok, false);
  }
});

test("a replay after the selected Worker leaves the group is rejected without a second mutation", function () {
  var f = fixture();
  var msg = f.message();
  assert.equal(f.handler.handleMessage(f.ws, msg), true);
  f.group.members = [1, 3];
  f.group.pair.workerIds = [3];
  assert.equal(f.handler.handleMessage(f.ws, msg), true);
  assert.equal(f.closes.length, 1);
  assert.equal(f.sent[1].message.ok, false);
  assert.match(f.sent[1].message.error, /membership changed|selected Worker changed/);
});

test("a Worker socket cannot close its peer", function () {
  var f = fixture();
  f.ws._clayActiveSession = 2;
  var msg = f.message();
  msg.driverId = 2;
  msg.driverOriginId = "origin-worker-a";
  msg.workerId = 3;
  msg.workerOriginId = "origin-worker-b";
  msg.generation = 5;
  assert.equal(f.handler.handleMessage(f.ws, msg), true);
  assert.equal(f.closes.length, 0);
  assert.match(f.sent[0].message.error, /configured Driver|roles changed/);
});

test("Mate contexts and server-disabled contexts reject the close contract", function () {
  var f = fixture();
  f.handler = attachPairWorkerClose({
    sm: { sessions: new Map() }, splitStore: {}, multiWorkerFeature: null, isMate: true,
    projectSlug: "project-a", hasSocket: function () { return true; },
    sendTo: function (socket, message) { f.sent.push({ socket: socket, message: message }); },
    closeWorker: function () { f.closes.push(true); },
  });
  assert.equal(f.handler.handleMessage(f.ws, f.message()), true);
  assert.equal(f.closes.length, 0);
  assert.match(f.sent[f.sent.length - 1].message.error, /unavailable/);
});

["false", "throw"].forEach(function (failureMode) {
  test("real close transaction leaves task, queue, permission, and peer unchanged on persistence " + failureMode, async function (t) {
    var f = await realFixture(t);
    var groupBefore = JSON.parse(JSON.stringify(f.store.groups[0]));
    var token = f.workerA._pairDelegation;
    var tokenBefore = JSON.parse(JSON.stringify(token));
    var queue = f.workerA._pairFollowups;
    var queueBefore = JSON.parse(JSON.stringify(queue));
    var registryBefore = JSON.parse(JSON.stringify(f.workerA._pairTaskIds));
    var peerBefore = JSON.parse(JSON.stringify({ provenance: f.workerB.sessionProvenance,
      generation: f.workerB._pairGeneration, processing: f.workerB.isProcessing,
      delegation: f.workerB._pairDelegation || null, queue: f.workerB._pairFollowups || null,
      stopRequested: !!f.workerB.taskStopRequested, historyLength: f.workerB.history.length }));
    f.setMode(failureMode);
    assert.equal(f.handler.handleMessage(f.ws, f.request), true);
    assert.equal(f.sent[f.sent.length - 1].ok, false);
    assert.deepEqual(f.store.groups[0], groupBefore);
    assert.equal(f.workerA._pairDelegation, token);
    assert.deepEqual(JSON.parse(JSON.stringify(token)), tokenBefore);
    assert.equal(f.workerA._pairFollowups, queue);
    assert.deepEqual(JSON.parse(JSON.stringify(queue)), queueBefore);
    assert.deepEqual(JSON.parse(JSON.stringify(f.workerA._pairTaskIds)), registryBefore);
    assert.equal(f.pair.workerPermission.pendingCountFor(f.workerA), 1);
    assert.equal(f.aborts(), 0);
    assert.equal(!!f.workerA.taskStopRequested, false);
    assert.deepEqual(JSON.parse(JSON.stringify({ provenance: f.workerB.sessionProvenance,
      generation: f.workerB._pairGeneration, processing: f.workerB.isProcessing,
      delegation: f.workerB._pairDelegation || null, queue: f.workerB._pairFollowups || null,
      stopRequested: !!f.workerB.taskStopRequested, historyLength: f.workerB.history.length })), peerBefore);
    assert.equal(f.outbox.get(token.outboxKey).outcome, null);
    assert.equal(f.workerStarts(), 1);
  });
});

test("real client payload closes only its exact Worker and retains one durable outcome without replay", async function (t) {
  var f = await realFixture(t);
  var token = f.workerA._pairDelegation;
  var peerGroup = f.store.groups[0];
  var peerBefore = JSON.parse(JSON.stringify({ provenance: f.workerB.sessionProvenance,
    generation: f.workerB._pairGeneration, processing: f.workerB.isProcessing,
    delegation: f.workerB._pairDelegation || null, queue: f.workerB._pairFollowups || null,
    stopRequested: !!f.workerB.taskStopRequested, historyLength: f.workerB.history.length }));
  assert.equal(f.request.driverOriginId, f.driver.sessionOriginId);
  assert.equal(f.request.workerOriginId, f.workerA.sessionOriginId);
  assert.equal(f.request.generation, f.workerA.sessionProvenance.generation);
  assert.deepEqual(f.request.expectedWorkerIds, [f.workerA.localId, f.workerB.localId]);
  assert.equal(f.handler.handleMessage(f.ws, f.request), true);
  assert.equal(f.sent[f.sent.length - 1].ok, true);
  assert.equal(f.store.groups[0], peerGroup);
  assert.deepEqual(f.store.groups[0].pair.workerIds, [f.workerB.localId]);
  assert.equal(f.store.groupForMember(f.workerA.localId), null);
  assert.equal(f.store.groupForMember(f.workerB.localId), peerGroup);
  assert.equal(f.workerB._pairDelegation, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify({ provenance: f.workerB.sessionProvenance,
    generation: f.workerB._pairGeneration, processing: f.workerB.isProcessing,
    delegation: f.workerB._pairDelegation || null, queue: f.workerB._pairFollowups || null,
    stopRequested: !!f.workerB.taskStopRequested, historyLength: f.workerB.history.length })), peerBefore);
  assert.equal(f.aborts(), 1);
  assert.equal(f.pair.workerPermission.pendingCountFor(f.workerA), 0);
  await f.permissionPromise;
  var record = f.outbox.get(token.outboxKey);
  assert.equal(record.outcome.status, "interrupted");
  assert.equal(record.taskId, "task-close-a");
  assert.equal(f.workerStarts(), 1, "the retained result never replays Worker execution");
  var durable = JSON.parse(fs.readFileSync(path.join(f.sm.sessionsDir, "pair-result-outbox.json"), "utf8"));
  assert.equal(durable.records[token.outboxKey].outcome.status, "interrupted");
  var reloadedStore = createSplitGroupStore({ sessions: f.sm.sessions, sessionsDir: f.sm.sessionsDir,
    usersModule: null, multiWorkerFeature: multiWorkerFeature.fromServerConfig({ multiWorkerRuntimeEnabled: true }) });
  assert.deepEqual(reloadedStore.groups[0].pair.workerIds, [f.workerB.localId]);
  var reloadedOutbox = attachPairResultOutbox({ storageDir: f.sm.sessionsDir, projectSlug: "project-a" });
  assert.equal(reloadedOutbox.get(token.outboxKey).outcome.status, "interrupted");
});

test("successful idle close does not drain the selected Worker's retained queue", async function (t) {
  var f = await realFixture(t);
  var token = f.workerA._pairDelegation;
  var startsBefore = f.workerStarts();
  f.workerA.isProcessing = false;
  assert.equal(f.handler.handleMessage(f.ws, f.request), true);
  assert.equal(f.sent[f.sent.length - 1].ok, true);
  assert.equal(f.workerStarts(), startsBefore);
  assert.equal(f.workerA._pairDelegation, undefined);
  assert.equal(f.workerA._pairFollowups.length, 1);
  assert.equal(f.workerA._pairFollowups[0].taskId, "task-queued-a");
  assert.equal(f.workerA._pairFollowups[0].status, "queued");
  assert.equal(f.aborts(), 0);
  assert.equal(f.outbox.get(token.outboxKey).outcome.status, "completed");
});
