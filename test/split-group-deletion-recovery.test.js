var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var createStore = require("../lib/session-split-groups").createSplitGroupStore;
var multiWorkerFeature = require("../lib/multi-worker-feature");
var createSessionManager = require("../lib/sessions").createSessionManager;
var sessionProvenance = require("../lib/session-provenance");
var attachFactory = require("../lib/session-pair-factory").attachPairFactory;

var CAPABILITY = multiWorkerFeature.fromServerConfig({ multiWorkerRuntimeEnabled: true });

function session(id, name, ownerId) {
  return { localId: id, title: name, ownerId: ownerId || null, cliSessionId: "cli-" + name,
    sessionOriginId: "origin-" + name, _pairGeneration: id };
}

function quietLogger() {
  var lines = { error: [], log: [] };
  return { lines: lines, error: function (m) { lines.error.push(m); }, log: function (m) { lines.log.push(m); } };
}

// Deterministic persistence fault plus captured retry timers.
function harness(t, dir) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), "clay-split-cleanup-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var h = { dir: dir, fail: false, writes: 0, timers: [], cleared: 0, logger: quietLogger() };
  h.options = function (sessions, extra) {
    return Object.assign({ sessions: sessions, sessionsDir: dir, usersModule: null, multiWorkerFeature: CAPABILITY,
      logger: h.logger, persistRetryDelaysMs: [10, 20, 40],
      persistGroups: function (file, serialized) {
        if (h.fail) return false;
        h.writes++;
        fs.writeFileSync(file, serialized);
        return true;
      },
      setTimer: function (fn, delay) { var timer = { fn: fn, delay: delay, live: true }; h.timers.push(timer); return timer; },
      clearTimer: function (timer) { if (timer && timer.live) { timer.live = false; h.cleared++; } },
    }, extra || {});
  };
  h.liveTimers = function () { return h.timers.filter(function (timer) { return timer.live; }); };
  h.fire = function () {
    var live = h.liveTimers();
    assert.equal(live.length, 1, "exactly one retry is scheduled");
    live[0].live = false;
    live[0].fn();
  };
  h.disk = function () { return JSON.parse(fs.readFileSync(path.join(dir, "split-groups.json"), "utf8")); };
  return h;
}

function identity(group, sessions, workerId, newWorkerId) {
  var worker = sessions.get(workerId);
  var added = sessions.get(newWorkerId);
  return { groupId: group.id, driverId: 1, driverOriginId: sessions.get(1).sessionOriginId,
    workerId: workerId, workerOriginId: worker.sessionOriginId, generation: worker._pairGeneration,
    newWorkerId: newWorkerId, newWorkerOriginId: added.sessionOriginId };
}

// Driver 1 with Workers 2 and 3, durably persisted before any fault.
function twoWorkerGroup(h, sessions, extra) {
  var store = createStore(h.options(sessions, extra));
  var group = store.create(null, { members: [1, 2], pair: { driverId: 1, workerId: 2 } }).group;
  assert.equal(store.addWorker(null, identity(group, sessions, 2, 3), CAPABILITY).ok, true);
  assert.deepEqual(h.disk()[0].pair.workerIds, [2, 3]);
  return { store: store, group: group };
}

function baseSessions(ownerId) {
  return new Map([[1, session(1, "driver", ownerId)], [2, session(2, "a", ownerId)], [3, session(3, "b", ownerId)],
    [4, session(4, "free", ownerId)], [5, session(5, "other", ownerId)]]);
}

function withoutSession(sessions, id) {
  var next = new Map();
  sessions.forEach(function (value, key) { if (key !== id) next.set(key, value); });
  return next;
}

test("a failed deletion write keeps live membership authoritative, notifies consumers, and retries", function (t) {
  var h = harness(t);
  var sessions = baseSessions();
  var notified = { broadcast: 0, pair: [] };
  var f = twoWorkerGroup(h, sessions, {
    broadcast: function () { notified.broadcast++; },
    onPairChanged: function (group) { notified.pair.push(group.pair && (group.pair.workerIds || [group.pair.workerId]).slice()); },
  });
  h.fail = true;
  sessions.delete(3);
  assert.equal(f.store.dissolveBySession(3), true);
  assert.deepEqual(f.group.members, [1, 2], "the deleted Worker is never restored after a failed write");
  assert.deepEqual(f.group.pair, { version: 2, driverId: 1, workerIds: [2] });
  assert.equal(f.group.pairAnchors.workers.length, 1, "live anchors match the reduced roles");
  assert.equal(f.group.pairAnchors.workers[0].origin, "origin-a");
  assert.equal(notified.broadcast > 0, true);
  assert.deepEqual(notified.pair[notified.pair.length - 1], [2]);
  assert.equal(h.logger.lines.error.length, 1, "the persistence failure is logged");
  var status = f.store.persistenceStatus();
  assert.equal(status.pending, true);
  assert.equal(status.reason, "session deletion");
  assert.equal(status.retryScheduled, true);
  assert.deepEqual(h.disk()[0].pair.workerIds, [2, 3], "disk still holds the stale record");

  h.fire();
  assert.equal(f.store.persistenceStatus().attempts, 2, "a repeated failure is recorded");
  assert.equal(h.liveTimers()[0].delay, 20, "retries back off deterministically");
  h.fail = false;
  h.fire();
  assert.equal(f.store.persistenceStatus().pending, false);
  assert.equal(h.liveTimers().length, 0);
  assert.deepEqual(h.disk()[0].pair.workerIds, [2], "the retry writes the authoritative cleanup");
  assert.deepEqual(h.disk()[0].memberAnchors.members.map(function (a) { return a.origin; }), ["origin-driver", "origin-a"]);
  assert.equal(h.logger.lines.log.length, 1, "recovery is logged");
});

test("an unrelated save succeeds during pending cleanup and flushes it", function (t) {
  var h = harness(t);
  var sessions = baseSessions();
  var f = twoWorkerGroup(h, sessions);
  var other = f.store.create(null, { members: [4, 5] }).group;
  h.fail = true;
  sessions.delete(3);
  f.store.dissolveBySession(3);
  h.fail = false;
  var renamed = f.store.rename(null, { id: other.id, name: "Unrelated" });
  assert.equal(renamed.ok, true, "the pending deletion does not poison other saves");
  assert.equal(f.store.persistenceStatus().pending, false);
  assert.equal(h.liveTimers().length, 0, "the retry timer is cancelled by the successful save");
  var disk = h.disk();
  assert.deepEqual(disk.find(function (g) { return g.id === f.group.id; }).pair.workerIds, [2]);
  assert.equal(disk.find(function (g) { return g.id === other.id; }).name, "Unrelated");
});

test("reversible mutations still roll back while deletion cleanup is pending", function (t) {
  var h = harness(t);
  var sessions = baseSessions();
  var f = twoWorkerGroup(h, sessions);
  h.fail = true;
  sessions.delete(3);
  f.store.dissolveBySession(3);
  var owned = f.store.createOwned(null, { members: [4, 5], pair: { driverId: 4, workerId: 5 } });
  assert.equal(owned.ok, false);
  assert.equal(f.store.groupForMember(4), null, "a failed reversible create is rolled back");
  assert.equal(f.store.dissolveOwned(null, f.group.id), false);
  assert.equal(f.store.groupForMember(1), f.group, "a failed reversible dissolve is rolled back");
  assert.deepEqual(f.group.pair.workerIds, [2], "rollback never restores the deleted Worker");
  assert.equal(f.store.persistenceStatus().pending, true);
});

test("restart before retry retains the exact surviving pair and rewrites the record", function (t) {
  var h = harness(t);
  var sessions = baseSessions();
  var f = twoWorkerGroup(h, sessions);
  h.fail = true;
  sessions.delete(3);
  f.store.dissolveBySession(3);
  f.store.shutdown();
  h.fail = false;
  var renumbered = new Map([[21, session(21, "a")], [22, session(22, "driver")], [23, session(23, "free")]]);
  var reloaded = createStore(h.options(renumbered));
  assert.equal(reloaded.groups.length, 1);
  assert.deepEqual(reloaded.groups[0].members, [22, 21]);
  assert.deepEqual(reloaded.groups[0].pair, { version: 2, driverId: 22, workerIds: [21] });
  assert.equal(reloaded.groupForMember(23), null, "no unrelated session is bound");
  assert.deepEqual(h.disk()[0].pairAnchors.workers.map(function (a) { return a.origin; }), ["origin-a"]);
  var again = createStore(h.options(new Map(renumbered)));
  assert.deepEqual(again.groups[0].pair, { version: 2, driverId: 22, workerIds: [21] }, "repair is stable");
});

test("restart repair stays usable when its rewrite fails, then retries", function (t) {
  var h = harness(t);
  var sessions = baseSessions();
  var f = twoWorkerGroup(h, sessions);
  h.fail = true;
  sessions.delete(3);
  f.store.dissolveBySession(3);
  f.store.shutdown();
  var reloaded = createStore(h.options(withoutSession(sessions, 3)));
  assert.deepEqual(reloaded.groups[0].pair, { version: 2, driverId: 1, workerIds: [2] });
  assert.equal(reloaded.persistenceStatus().pending, true);
  assert.equal(reloaded.persistenceStatus().reason, "startup rewrite");
  h.fail = false;
  h.fire();
  assert.equal(reloaded.persistenceStatus().pending, false);
  assert.deepEqual(h.disk()[0].pair.workerIds, [2]);
});

test("restart repair refuses ambiguous, partial, owner-mismatched, or disagreeing identities", function (t) {
  function staleDisk(ownerId) {
    var h = harness(t);
    var sessions = baseSessions(ownerId);
    var f = twoWorkerGroup(h, sessions);
    h.fail = true;
    sessions.delete(3);
    f.store.dissolveBySession(3);
    f.store.shutdown();
    h.fail = false;
    return { h: h, sessions: withoutSession(sessions, 3) };
  }
  function assertUnrepaired(state, label) {
    var reloaded = createStore(state.h.options(state.sessions));
    assert.deepEqual(reloaded.groups, [], label + ": no group is loaded");
    assert.deepEqual(state.h.disk()[0].pair.workerIds, [2, 3], label + ": the stored record is preserved");
  }
  var partial = staleDisk();
  partial.sessions.set(9, Object.assign(session(9, "imposter"), { sessionOriginId: "origin-b" }));
  assertUnrepaired(partial, "partial identity match");

  var ambiguous = staleDisk();
  ambiguous.sessions.set(9, Object.assign(session(9, "twin"), { cliSessionId: "cli-a", sessionOriginId: "origin-twin" }));
  assertUnrepaired(ambiguous, "ambiguous survivor");

  var owner = staleDisk();
  owner.sessions.get(2).ownerId = "someone-else";
  assertUnrepaired(owner, "owner mismatch");

  var disagree = staleDisk();
  var stored = disagree.h.disk();
  stored[0].memberAnchors.members[1] = { cli: "cli-free", origin: "origin-free" };
  fs.writeFileSync(path.join(disagree.h.dir, "split-groups.json"), JSON.stringify(stored));
  var reloaded = createStore(disagree.h.options(disagree.sessions));
  assert.deepEqual(reloaded.groups, [], "member and pair anchors must agree");
  assert.equal(reloaded.groupForMember(4), null);
});

test("deleting the Driver or the last Worker dissolves live state and restart does not resurrect it", function (t) {
  var h = harness(t);
  var sessions = baseSessions();
  var f = twoWorkerGroup(h, sessions);
  h.fail = true;
  sessions.delete(1);
  assert.equal(f.store.dissolveBySession(1), true);
  assert.equal(f.store.groupForMember(2), null, "Workers are released immediately");
  assert.equal(f.store.groupForMember(3), null);
  f.store.shutdown();
  assert.equal(h.liveTimers().length, 0, "shutdown cancels the pending retry");
  h.fail = false;
  var reloaded = createStore(h.options(withoutSession(sessions, 1)));
  assert.deepEqual(reloaded.groups, [], "a group whose Driver was deleted is not restored");
  assert.deepEqual(h.disk(), [], "the stale record is removed");

  var h2 = harness(t);
  var sessions2 = baseSessions();
  var v2 = twoWorkerGroup(h2, sessions2);
  h2.fail = true;
  sessions2.delete(3);
  v2.store.dissolveBySession(3);
  sessions2.delete(2);
  assert.equal(v2.store.dissolveBySession(2), true, "repeated deletions during an outage are applied");
  assert.equal(v2.store.groupForMember(1), null, "the last Worker deletion dissolves the group");
  assert.equal(v2.store.persistenceStatus().attempts, 2);
  assert.equal(h2.liveTimers().length, 1, "repeated failures keep one retry timer");
  v2.store.shutdown();
  h2.fail = false;
  var restarted = createStore(h2.options(sessions2));
  assert.equal(restarted.groupForMember(1), null, "restart does not resurrect a group without Workers");
  assert.deepEqual(h2.disk(), [], "the stale record without surviving Workers is removed");
});

test("production session deletion applies cleanup through the real manager wiring despite a write fault", function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-split-cleanup-manager-"));
  var h = harness(t, dir);
  var managerOptions = { cwd: path.join(dir, "project"), sessionsBase: path.join(dir, "sessions"),
    cliSessionsDir: path.join(dir, "cli"), send: function () {}, sendTo: function () {} };
  var sm = createSessionManager(managerOptions);
  sm.installedVendors = ["claude", "codex"];
  sm.modelsByVendor = { claude: [{ value: "claude-model" }], codex: [{ value: "codex-model" }] };
  var driver = sm.getActiveSession();
  driver.cliSessionId = "driver-cli"; driver.vendor = "claude"; driver.model = "claude-model"; driver.title = "Driver";
  var peer = sm.createSessionRaw({ cliSessionId: "peer-cli", vendor: "codex", model: "codex-model" });
  sessionProvenance.markWorker(driver, peer, sm.sessions);
  sm.saveSessionFile(driver); sm.saveSessionFile(peer);
  var store = createStore(h.options(sm.sessions, { sessionsDir: sm.sessionsDir }));
  t.after(function () { store.shutdown(); });
  sm.setOnSessionDeleted(store.dissolveBySession);
  var group = store.create(null, { members: [driver.localId, peer.localId],
    pair: { driverId: driver.localId, workerId: peer.localId } }).group;
  var factory = attachFactory({ sm: sm, splitStore: store, isMate: false,
    usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {}, multiWorkerFeature: CAPABILITY });
  var added = factory.addWorkerForDriver(driver, { workerVendor: "codex", workerModel: "codex-model" });
  h.fail = true;
  sm.deleteSessionQuiet(added.worker.localId);
  assert.deepEqual(group.pair.workerIds, [peer.localId]);
  assert.equal(store.persistenceStatus().pending, true);
  var groupsFile = path.join(sm.sessionsDir, "split-groups.json");
  assert.equal(JSON.parse(fs.readFileSync(groupsFile, "utf8"))[0].pair.workerIds.length, 2);
  store.shutdown();
  h.fail = false;
  var restartedManager = createSessionManager(managerOptions);
  var restarted = createStore(h.options(restartedManager.sessions, { sessionsDir: restartedManager.sessionsDir }));
  t.after(function () { restarted.shutdown(); });
  var survivingDriver = Array.from(restartedManager.sessions.values()).find(function (s) { return s.sessionOriginId === driver.sessionOriginId; });
  var survivingPeer = Array.from(restartedManager.sessions.values()).find(function (s) { return s.sessionOriginId === peer.sessionOriginId; });
  assert.ok(survivingDriver && survivingPeer);
  assert.equal(restarted.groups.length, 1, "the surviving pair is retained after restart");
  assert.deepEqual(restarted.groups[0].pair, { version: 2, driverId: survivingDriver.localId, workerIds: [survivingPeer.localId] });
  assert.equal(Array.from(restartedManager.sessions.values()).some(function (s) {
    return s.sessionOriginId === added.worker.sessionOriginId;
  }), false, "the deleted Worker is not resurrected");
});
