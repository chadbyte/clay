var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var createStore = require("../lib/session-split-groups").createSplitGroupStore;
var multiWorkerFeature = require("../lib/multi-worker-feature");
var attachFactory = require("../lib/session-pair-factory").attachPairFactory;
var attachLifecycle = require("../lib/project-pair-lifecycle").attachPairLifecycle;
var attachTurnControl = require("../lib/session-pair-turn-control").attachPairTurnControl;
var structuralClose = require("../lib/project-pair-structural-close");

var CAPABILITY = multiWorkerFeature.fromServerConfig({ multiWorkerRuntimeEnabled: true });

function session(id, origin, generation) {
  return { localId: id, title: origin, ownerId: null, cliSessionId: "cli-" + origin,
    sessionOriginId: "origin-" + origin, _pairGeneration: generation || null };
}

function fixture(t, persistGroups) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-v2-store-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var sessions = new Map([[1, session(1, "driver")], [2, session(2, "a", 4)], [3, session(3, "b", 5)], [4, session(4, "c", 6)]]);
  var store = createStore({ sessions: sessions, sessionsDir: dir, usersModule: null,
    multiWorkerFeature: CAPABILITY, persistGroups: persistGroups });
  var created = store.create(null, { members: [1, 2], pair: { driverId: 1, workerId: 2 } });
  assert.equal(created.ok, true);
  return { dir: dir, sessions: sessions, store: store, group: created.group };
}

function identity(f, workerId, newWorkerId) {
  var worker = f.sessions.get(workerId);
  var added = f.sessions.get(newWorkerId);
  return { groupId: f.group.id, driverId: 1, driverOriginId: "origin-driver",
    workerId: workerId, workerOriginId: worker.sessionOriginId, generation: worker._pairGeneration,
    newWorkerId: newWorkerId, newWorkerOriginId: added.sessionOriginId };
}

test("server-gated add persists V2 anchors and reloads renumbered exact identities", function (t) {
  var f = fixture(t);
  var added = f.store.addWorker(null, identity(f, 2, 3), CAPABILITY);
  assert.equal(added.ok, true);
  assert.deepEqual(f.group.pair, { version: 2, driverId: 1, workerIds: [2, 3] });
  assert.equal(f.group.memberAnchors.version, 2);
  assert.equal(f.store.addWorker(null, identity(f, 2, 4), CAPABILITY).ok, false, "two Workers is the hard maximum");

  var renumbered = new Map([[11, session(11, "b", 5)], [12, session(12, "driver")], [13, session(13, "a", 4)]]);
  var reloaded = createStore({ sessions: renumbered, sessionsDir: f.dir, usersModule: null, multiWorkerFeature: CAPABILITY });
  assert.deepEqual(reloaded.groups[0].members, [12, 13, 11]);
  assert.deepEqual(reloaded.groups[0].pair, { version: 2, driverId: 12, workerIds: [13, 11] });
});

test("malformed stored records are pruned without startup crashes while future formats remain intact", function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-v2-malformed-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var future = { id: "future", members: [1, 2], pair: { version: 99, driverId: 1, workerIds: [2] },
    diagnostic: { keep: true } };
  fs.writeFileSync(path.join(dir, "split-groups.json"), JSON.stringify([
    null, 7, {}, { id: "missing-members" },
    { id: "invalid-pair", members: [1, 2], pair: { driverId: 1, workerId: 1 } }, future,
  ], null, 2) + "\n");
  var sessions = new Map([[1, session(1, "driver")], [2, session(2, "a")]]);
  var store;
  assert.doesNotThrow(function () {
    store = createStore({ sessions: sessions, sessionsDir: dir, usersModule: null });
  });
  assert.deepEqual(store.groups, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "split-groups.json"), "utf8")), [future]);
  assert.equal(store.create(null, { members: [1, 2], pair: { driverId: 1, workerId: 2 } }).ok, true);
});

test("inconsistent V2 role anchors stay diagnostic while a valid neighboring group reloads and rewrites", function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-v2-inconsistent-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var original = new Map([[1, session(1, "driver")], [2, session(2, "a")], [3, session(3, "b")],
    [5, session(5, "neighbor-a")], [6, session(6, "neighbor-b")]]);
  var initial = createStore({ sessions: original, sessionsDir: dir, usersModule: null, multiWorkerFeature: CAPABILITY });
  var versioned = initial.create(null, { members: [1, 2], pair: { driverId: 1, workerId: 2 } }).group;
  assert.equal(initial.addWorker(null, { groupId: versioned.id, driverId: 1, driverOriginId: "origin-driver",
    newWorkerId: 3, newWorkerOriginId: "origin-b" }, CAPABILITY).ok, true);
  var neighbor = initial.create(null, { members: [5, 6], pair: { driverId: 5, workerId: 6 } }).group;
  var file = path.join(dir, "split-groups.json");
  var stored = JSON.parse(fs.readFileSync(file, "utf8"));
  var corrupt = stored.find(function (group) { return group.id === versioned.id; });
  corrupt.pairAnchors.workers = corrupt.pairAnchors.workers.slice(0, 1);
  var diagnostic = JSON.parse(JSON.stringify(corrupt));
  fs.writeFileSync(file, JSON.stringify(stored, null, 2) + "\n");

  var renumbered = new Map([[1, session(1, "driver")], [2, session(2, "a")], [3, session(3, "b")],
    [50, session(50, "neighbor-a")], [60, session(60, "neighbor-b")]]);
  var reloaded;
  assert.doesNotThrow(function () {
    reloaded = createStore({ sessions: renumbered, sessionsDir: dir, usersModule: null, multiWorkerFeature: CAPABILITY });
  });
  assert.equal(reloaded.groups.length, 1);
  assert.equal(reloaded.groups[0].id, neighbor.id);
  assert.deepEqual(reloaded.groups[0].members, [50, 60]);
  var rewritten = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(rewritten.find(function (group) { return group.id === versioned.id; }), diagnostic);
  assert.deepEqual(rewritten.find(function (group) { return group.id === neighbor.id; }).members, [50, 60]);
});

test("replace and remove affect only the selected Worker and reject stale identity or generation", function (t) {
  var f = fixture(t);
  assert.equal(f.store.addWorker(null, identity(f, 2, 3), CAPABILITY).ok, true);
  var stale = identity(f, 2, 4);
  stale.generation = 3;
  assert.match(f.store.replaceWorker(null, stale, CAPABILITY).error, /identity or generation changed/);
  assert.equal(f.store.replaceWorker(null, identity(f, 2, 4), CAPABILITY).ok, true);
  assert.deepEqual(f.group.pair.workerIds, [4, 3]);
  assert.equal(f.store.groupForMember(3), f.group, "the other Worker remains attached");
  assert.equal(f.store.groupForMember(2), null, "the replaced Worker is detached");
  var remove = identity(f, 3, 2);
  delete remove.newWorkerId; delete remove.newWorkerOriginId;
  assert.equal(f.store.removeWorker(null, remove, CAPABILITY).ok, true);
  assert.deepEqual(f.group.pair, { version: 2, driverId: 1, workerIds: [4] });
});

test("false and throwing persistence roll back memberships and anchors without disturbing the other Worker", function (t) {
  var mode = "ok";
  var f = fixture(t, function () {
    if (mode === "false") return false;
    if (mode === "throw") throw new Error("disk unavailable");
    return true;
  });
  var before = JSON.stringify(f.group);
  mode = "false";
  assert.equal(f.store.addWorker(null, identity(f, 2, 3), CAPABILITY).ok, false);
  assert.equal(JSON.stringify(f.group), before);
  assert.equal(f.store.groupForMember(3), null);
  mode = "throw";
  assert.equal(f.store.addWorker(null, identity(f, 2, 3), CAPABILITY).ok, false);
  assert.equal(JSON.stringify(f.group), before);
});

test("production admission stays off and scheduled Driver transfer explicitly rejects V2", function (t) {
  var f = fixture(t);
  assert.equal(f.store.addWorker(null, identity(f, 2, 3), CAPABILITY).ok, true);
  assert.match(f.store.beginOwnedDriverTransfer(null, { id: f.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2 }).error,
    /Version 2 Driver transfer is not enabled/);
  var denied = f.store.replaceWorker(null, identity(f, 2, 4), null);
  assert.match(denied.error, /server multi-Worker feature/);
});

test("the real factory adds and replaces one selected Worker without changing the other", function (t) {
  var f = fixture(t);
  var driver = f.sessions.get(1);
  driver.vendor = "claude"; driver.model = "claude-model"; driver.history = [];
  var nextId = 10;
  var sm = {
    sessions: f.sessions,
    installedVendors: ["claude", "codex"],
    modelsByVendor: { claude: [{ value: "claude-model" }], codex: [{ value: "codex-model" }] },
    createSessionRaw: function (spec) {
      var created = session(nextId++, "created-" + nextId);
      created.ownerId = spec.ownerId || null; created.vendor = spec.vendor; created.model = spec.model; created.effort = spec.effort;
      f.sessions.set(created.localId, created);
      return created;
    },
    deleteSessionQuiet: function (id) { f.sessions.delete(id); },
    saveSessionFile: function () {}, broadcastSessionList: function () {}, sendToSession: function () {},
  };
  var factory = attachFactory({ sm: sm, splitStore: f.store, isMate: false,
    usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {}, multiWorkerFeature: CAPABILITY });
  var added = factory.addWorkerForDriver(driver, { workerVendor: "codex", workerModel: "codex-model" });
  added.worker._pairGeneration = 7;
  assert.deepEqual(f.group.pair.workerIds, [2, added.worker.localId]);
  var replaced = factory.replaceWorkerForDriver(driver, f.sessions.get(2), {
    workerVendor: "codex", workerModel: "codex-model",
  });
  assert.deepEqual(f.group.pair.workerIds, [replaced.worker.localId, added.worker.localId]);
  assert.equal(f.store.groupForMember(added.worker.localId), f.group);
  assert.equal(f.sessions.has(2), true, "replaced history remains available");
});

test("lifecycle replacement and close route through the selected Worker while its peer stays attached", async function (t) {
  var f = fixture(t);
  var driver = f.sessions.get(1);
  var workerA = f.sessions.get(2);
  driver.vendor = "claude"; driver.model = "claude-model"; driver.history = [];
  workerA.vendor = "codex"; workerA.model = "codex-model"; workerA.history = [];
  var nextId = 20;
  var sm = { sessions: f.sessions, installedVendors: ["claude", "codex"],
    modelsByVendor: { claude: [{ value: "claude-model" }], codex: [{ value: "codex-model" }] },
    createSessionRaw: function (spec) {
      var created = session(nextId++, "lifecycle-" + nextId);
      created.ownerId = spec.ownerId || null; created.vendor = spec.vendor; created.model = spec.model;
      created.effort = spec.effort; created.history = []; f.sessions.set(created.localId, created); return created;
    },
    deleteSessionQuiet: function (id) { f.sessions.delete(id); }, saveSessionFile: function () {},
    broadcastSessionList: function () {}, sendToSession: function () {},
  };
  var factory = attachFactory({ sm: sm, splitStore: f.store, isMate: false,
    usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {}, multiWorkerFeature: CAPABILITY });
  var workerB = factory.addWorkerForDriver(driver, { workerVendor: "codex", workerModel: "codex-model" }).worker;
  var turnControl = attachTurnControl({ sm: sm, splitStore: f.store });
  var lifecycle = attachLifecycle({ sm: sm, splitStore: f.store, turnControl: turnControl,
    multiWorkerFeature: CAPABILITY,
    preflightWorkerForDriver: factory.preflightWorkerForDriver,
    replaceWorkerForDriver: factory.replaceWorkerForDriver,
    createWorkerForDriver: factory.createWorkerForDriver,
    cancelWorkerPermissions: function () {}, markInterruption: function () {},
    sendToPartner: function () { throw new Error("not reached"); },
  });
  lifecycle.recordGenerationStart(driver, workerA);
  lifecycle.recordGenerationStart(driver, workerB);
  var replaced = await lifecycle.replacePartner({ workerId: workerA.localId, workerVendor: "codex",
    workerModel: "codex-model", transactionId: "replace-worker-a" }, driver);
  var replacement = f.sessions.get(replaced.workerSessionId);
  assert.deepEqual(f.group.pair.workerIds, [replacement.localId, workerB.localId]);
  assert.equal(f.store.groupForMember(workerB.localId), f.group);
  var closed = structuralClose.removeSelectedWorker(f.store, f.group, driver, replacement, CAPABILITY);
  assert.equal(closed.ok, true);
  assert.deepEqual(f.group.pair.workerIds, [workerB.localId]);
  assert.equal(f.store.groupForMember(workerB.localId), f.group);
});

test("factory cleanup removes a newly allocated Worker when the structural transaction is rejected", function () {
  var driver = session(1, "driver");
  driver.vendor = "claude"; driver.model = "claude-model"; driver.history = [];
  var sessions = new Map([[1, driver]]);
  var group = { id: "pair", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var nextId = 9;
  var sm = { sessions: sessions, installedVendors: ["claude", "codex"],
    modelsByVendor: { codex: [{ value: "codex-model" }] },
    createSessionRaw: function (spec) {
      var created = session(nextId++, "orphan-candidate"); created.vendor = spec.vendor;
      sessions.set(created.localId, created); return created;
    },
    deleteSessionQuiet: function (id) { sessions.delete(id); }, saveSessionFile: function () {},
    broadcastSessionList: function () {}, sendToSession: function () {},
  };
  var factory = attachFactory({ sm: sm, isMate: false, multiWorkerFeature: CAPABILITY,
    usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {},
    splitStore: { groupForMember: function () { return group; }, addWorker: function () {
      return { ok: false, error: "stale group" };
    } },
  });
  assert.throws(function () {
    factory.addWorkerForDriver(driver, { workerVendor: "codex", workerModel: "codex-model" });
  }, /stale group/);
  assert.deepEqual(Array.from(sessions.keys()), [1]);
});

test("factory persistence false or throw prevents structural mutation and cleans up the candidate", function () {
  ["driver-false", "worker-false", "worker-throw"].forEach(function (mode) {
    var driver = session(1, "driver");
    driver.vendor = "claude"; driver.model = "claude-model"; driver.history = [];
    var peer = session(2, "peer", 1);
    var sessions = new Map([[1, driver], [2, peer]]);
    var group = { id: "pair-" + mode, ownerId: null, members: [1, 2], pair: { driverId: 1, workerId: 2 } };
    var before = JSON.stringify(group);
    var storeMutations = 0;
    var sm = { sessions: sessions, installedVendors: ["claude", "codex"],
      modelsByVendor: { codex: [{ value: "codex-model" }] },
      createSessionRaw: function (spec) {
        var created = session(9, "candidate"); created.vendor = spec.vendor; created.history = [];
        sessions.set(created.localId, created); return created;
      },
      deleteSessionQuiet: function (id) { sessions.delete(id); },
      saveSessionFile: function (target) {
        if (mode === "driver-false" && target === driver) return false;
        if (target !== driver && mode === "worker-false") return false;
        if (target !== driver && mode === "worker-throw") throw new Error("session disk unavailable");
        return true;
      },
      broadcastSessionList: function () {}, sendToSession: function () {},
    };
    var factory = attachFactory({ sm: sm, isMate: false, multiWorkerFeature: CAPABILITY,
      usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {},
      splitStore: { groupForMember: function () { return group; }, addWorker: function () {
        storeMutations++;
        return { ok: true, group: group };
      } },
    });
    assert.throws(function () {
      factory.addWorkerForDriver(driver, { workerVendor: "codex", workerModel: "codex-model" });
    }, /persistence returned false|session disk unavailable/);
    assert.equal(storeMutations, 0, mode + " must fail before group mutation");
    assert.equal(JSON.stringify(group), before);
    assert.deepEqual(Array.from(sessions.keys()), [1, 2]);
  });
});
