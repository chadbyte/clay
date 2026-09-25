var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var createSessionManager = require("../lib/sessions").createSessionManager;
var sessionProvenance = require("../lib/session-provenance");
var attachSessionDelete = require("../lib/project-session-delete").attachSessionDelete;
var createStore = require("../lib/session-split-groups").createSplitGroupStore;
var multiWorkerFeature = require("../lib/multi-worker-feature");
var attachFactory = require("../lib/session-pair-factory").attachPairFactory;

var CAPABILITY = multiWorkerFeature.fromServerConfig({ multiWorkerRuntimeEnabled: true });

// Every session lives in a temporary directory owned by the test.
function fixture(t, options) {
  options = options || {};
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-delete-cascade-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var managerOptions = { cwd: path.join(dir, "project"), sessionsBase: path.join(dir, "sessions"),
    cliSessionsDir: path.join(dir, "cli"), send: function () {}, sendTo: function () {} };
  var sm = createSessionManager(managerOptions);
  sm.installedVendors = ["claude", "codex"];
  sm.modelsByVendor = { claude: [{ value: "claude-model" }], codex: [{ value: "codex-model" }] };
  var calls = [];
  var errors = [];
  var denied = new Set();
  var f = { dir: dir, sm: sm, calls: calls, errors: errors, denied: denied, managerOptions: managerOptions };
  f.make = function (name, ownerId, extra) {
    var session = sm.createSessionRaw(Object.assign({ cliSessionId: "cli-" + name, vendor: "codex", model: "codex-model",
      ownerId: ownerId || null }, extra || {}));
    session.title = name;
    session._titleWatcherStop = function () { calls.push("watcher:" + name); };
    if (session.mode === "tui") session.terminalId = session.localId;
    return session;
  };
  f.worker = function (driver, name, ownerId) {
    var worker = f.make(name, ownerId === undefined ? driver.ownerId : ownerId);
    sessionProvenance.markWorker(driver, worker, sm.sessions);
    return worker;
  };
  f.saveAll = function () { sm.sessions.forEach(function (session) { sm.saveSessionFile(session); }); };
  var users = {
    isMultiUser: function () { return !!options.multiUser; },
    canAccessSession: function (userId, session) {
      return (session.ownerId || null) === userId && !denied.has(session.localId);
    },
    getEffectivePermissions: function () { return { sessionDelete: options.deletePermission !== false }; },
  };
  f.handler = attachSessionDelete({
    sm: sm, usersModule: users, osUsers: null, sendTo: function (ws, msg) { errors.push(msg.text); },
    tm: { close: function (id) { calls.push("pty:" + id); } },
    getProjectAccess: function () { return { visibility: "public" }; },
    stopTitleWatcher: function (session) { if (session._titleWatcherStop) session._titleWatcherStop(); },
  });
  f.ws = options.multiUser ? { _clayUser: { id: options.userId || "owner" } } : {};
  f.alive = function (session) { return f.sm.sessions.get(session.localId) === session; };
  f.reloadedOrigins = function () {
    var reloaded = createSessionManager(managerOptions);
    return Array.from(reloaded.sessions.values()).map(function (session) { return session.sessionOriginId; });
  };
  return f;
}

// Driver with three generations (the current one plus two replaced), an
// unrelated Driver with its own Worker, and a plain unrelated session.
function family(f, ownerId) {
  var driver = f.make("driver", ownerId, { mode: "tui" });
  var gen1 = f.worker(driver, "gen1");
  var gen2 = f.worker(driver, "gen2");
  var current = f.worker(driver, "current");
  var otherDriver = f.make("other-driver", ownerId);
  var otherWorker = f.worker(otherDriver, "other-worker");
  var plain = f.make("plain", ownerId);
  f.saveAll();
  return { driver: driver, gen1: gen1, gen2: gen2, current: current, otherDriver: otherDriver,
    otherWorker: otherWorker, plain: plain };
}

test("deleting a Driver removes current and historical Worker generations only", function (t) {
  var f = fixture(t);
  var s = family(f);
  assert.deepEqual([s.gen1, s.gen2, s.current].map(function (w) { return w.sessionProvenance.generation; }), [1, 2, 3]);
  f.handler.deleteSession(f.ws, { id: s.driver.localId });
  [s.driver, s.gen1, s.gen2, s.current].forEach(function (session) { assert.equal(f.alive(session), false, session.title); });
  [s.otherDriver, s.otherWorker, s.plain].forEach(function (session) { assert.equal(f.alive(session), true, session.title); });
  assert.ok(f.calls.indexOf("pty:" + s.driver.localId) !== -1, "the TUI PTY is reaped");
  ["driver", "gen1", "gen2", "current"].forEach(function (name) { assert.ok(f.calls.indexOf("watcher:" + name) !== -1, name); });
  assert.equal(f.calls.indexOf("watcher:other-worker"), -1);
  var origins = f.reloadedOrigins();
  [s.driver, s.gen1, s.gen2, s.current].forEach(function (session) {
    assert.equal(origins.indexOf(session.sessionOriginId), -1, session.title + " history is removed from disk");
  });
  assert.ok(origins.indexOf(s.otherWorker.sessionOriginId) !== -1);
});

test("deleting a Worker never removes its Driver or siblings", function (t) {
  var f = fixture(t);
  var s = family(f);
  f.handler.deleteSession(f.ws, { id: s.gen2.localId });
  assert.equal(f.alive(s.gen2), false);
  [s.driver, s.gen1, s.current].forEach(function (session) { assert.equal(f.alive(session), true, session.title); });
  f.handler.bulkDeleteSessions(f.ws, { sessionIds: [s.gen1.localId, s.otherWorker.localId] });
  [s.driver, s.current, s.otherDriver].forEach(function (session) { assert.equal(f.alive(session), true, session.title); });
  assert.equal(f.alive(s.gen1), false);
  assert.equal(f.alive(s.otherWorker), false);
});

test("bulk deletion cascades each requested Driver and leaves unrelated sessions", function (t) {
  var f = fixture(t);
  var s = family(f);
  f.handler.bulkDeleteSessions(f.ws, { sessionIds: [s.driver.localId, s.plain.localId, "bad", 999] });
  [s.driver, s.gen1, s.gen2, s.current, s.plain].forEach(function (session) { assert.equal(f.alive(session), false, session.title); });
  assert.equal(f.alive(s.otherDriver), true);
  assert.equal(f.alive(s.otherWorker), true);
});

test("cross-owner and ambiguous provenance links are never expanded", function (t) {
  var f = fixture(t, { multiUser: true });
  var driver = f.make("driver", "owner");
  var owned = f.worker(driver, "owned");
  var foreign = f.make("foreign", "intruder");
  foreign.sessionProvenance = Object.assign({}, owned.sessionProvenance, { generation: 9 });
  var twinParent = f.make("twin-parent", "owner");
  var twinChild = f.worker(twinParent, "twin-child");
  var twinImposter = f.make("twin-imposter", "owner");
  twinImposter.sessionOriginId = twinParent.sessionOriginId;
  f.handler.deleteSession(f.ws, { id: driver.localId });
  assert.equal(f.alive(driver), false);
  assert.equal(f.alive(owned), false);
  assert.equal(f.alive(foreign), true, "another owner's session is never deleted by provenance");
  f.handler.deleteSession(f.ws, { id: twinParent.localId });
  assert.equal(f.alive(twinParent), false);
  assert.equal(f.alive(twinChild), true, "an ambiguous parent origin does not expand");
  assert.equal(f.alive(twinImposter), true);
});

test("unauthorized callers and partially inaccessible scopes delete nothing", function (t) {
  var noPermission = fixture(t, { multiUser: true, deletePermission: false });
  var a = family(noPermission, "owner");
  noPermission.handler.deleteSession(noPermission.ws, { id: a.driver.localId });
  noPermission.handler.bulkDeleteSessions(noPermission.ws, { sessionIds: [a.driver.localId, a.plain.localId] });
  assert.equal(noPermission.errors.length, 2);
  assert.equal(noPermission.calls.length, 0, "no runtime cleanup happens before authorization");
  [a.driver, a.gen1, a.plain].forEach(function (session) { assert.equal(noPermission.alive(session), true); });

  var stranger = fixture(t, { multiUser: true, userId: "stranger" });
  var b = family(stranger, "owner");
  stranger.handler.deleteSession(stranger.ws, { id: b.driver.localId });
  stranger.handler.bulkDeleteSessions(stranger.ws, { sessionIds: [b.driver.localId] });
  stranger.handler.bulkDeleteSessions({}, { sessionIds: [b.driver.localId] });
  [b.driver, b.gen1, b.current].forEach(function (session) { assert.equal(stranger.alive(session), true); });

  var partial = fixture(t, { multiUser: true });
  var c = family(partial, "owner");
  partial.denied.add(c.gen1.localId);
  partial.handler.deleteSession(partial.ws, { id: c.driver.localId });
  partial.handler.bulkDeleteSessions(partial.ws, { sessionIds: [c.driver.localId, c.plain.localId] });
  assert.equal(partial.errors.length, 2);
  assert.match(partial.errors[0], /Split Worker sessions is not accessible/);
  assert.equal(partial.calls.length, 0);
  [c.driver, c.gen1, c.gen2, c.current, c.plain].forEach(function (session) {
    assert.equal(partial.alive(session), true, session.title + " survives a refused scope");
  });
});

test("Driver deletion cascades through a live split group during a persistence failure", function (t) {
  var f = fixture(t);
  var driver = f.make("driver");
  driver.vendor = "claude"; driver.model = "claude-model";
  var peer = f.worker(driver, "peer");
  f.saveAll();
  var fail = false;
  var logger = { error: function () {}, log: function () {} };
  var storeOptions = { sessions: f.sm.sessions, sessionsDir: f.sm.sessionsDir, usersModule: null,
    multiWorkerFeature: CAPABILITY, logger: logger, persistRetryDelaysMs: [60000],
    persistGroups: function (file, serialized) { if (fail) return false; fs.writeFileSync(file, serialized); return true; } };
  var store = createStore(storeOptions);
  t.after(function () { store.shutdown(); });
  f.sm.setOnSessionDeleted(store.dissolveBySession);
  var group = store.create(null, { members: [driver.localId, peer.localId],
    pair: { driverId: driver.localId, workerId: peer.localId } }).group;
  var factory = attachFactory({ sm: f.sm, splitStore: store, isMate: false,
    usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {}, multiWorkerFeature: CAPABILITY });
  var added = factory.addWorkerForDriver(driver, { workerVendor: "codex", workerModel: "codex-model" });
  var replaced = factory.replaceWorkerForDriver(driver, peer, { workerVendor: "codex", workerModel: "codex-model" });
  assert.equal(f.alive(peer), true, "replacement preserves the previous generation");
  assert.deepEqual(group.pair.workerIds, [replaced.worker.localId, added.worker.localId]);
  f.handler.deleteSession(f.ws, { id: replaced.worker.localId });
  assert.equal(f.alive(driver), true, "Worker deletion keeps the Driver");
  assert.equal(f.alive(added.worker), true, "Worker deletion keeps its sibling");
  assert.deepEqual(group.pair.workerIds, [added.worker.localId]);

  fail = true;
  f.handler.deleteSession(f.ws, { id: driver.localId });
  [driver, peer, added.worker].forEach(function (session) { assert.equal(f.alive(session), false); });
  assert.equal(store.groups.length, 0, "the live group is removed despite the failed write");
  assert.equal(store.persistenceStatus().pending, true);
  store.shutdown();
  fail = false;
  var restartedManager = createSessionManager(f.managerOptions);
  var restartedStore = createStore(Object.assign({}, storeOptions, { sessions: restartedManager.sessions }));
  t.after(function () { restartedStore.shutdown(); });
  assert.equal(restartedStore.groups.length, 0, "restart does not restore the deleted pair");
  var origins = Array.from(restartedManager.sessions.values()).map(function (session) { return session.sessionOriginId; });
  [driver, peer, added.worker].forEach(function (session) {
    assert.equal(origins.indexOf(session.sessionOriginId), -1, session.title + " is not resurrected");
  });
});

function loadScope() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/session-delete-scope.js"), "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

test("the session list reports every owned Worker, including hidden and replaced generations", function (t) {
  // Single-user projection; the multi-user owner gate has its own tests.
  var users = require("../lib/users");
  var originalMultiUser = users.isMultiUser;
  users.isMultiUser = function () { return false; };
  t.after(function () { users.isMultiUser = originalMultiUser; });
  var f = fixture(t);
  var s = family(f);
  s.gen1.hidden = true;
  var hiddenDriver = f.make("hidden-owner");
  var hiddenOnly = f.worker(hiddenDriver, "hidden-only");
  hiddenOnly.hidden = true;
  var visible = Array.from(f.sm.sessions.values()).filter(function (session) { return !session.hidden; });
  var mapped = f.sm.mapSessionsForClient(visible);
  function row(session) { return mapped.find(function (item) { return item.id === session.localId; }); }
  assert.equal(row(s.driver).ownedWorkerCount, 3, "hidden gen1 is counted");
  assert.equal(row(hiddenDriver).ownedWorkerCount, 1, "a Driver whose only Worker is hidden is not reported as empty");
  assert.equal(row(s.plain).ownedWorkerCount, 0);
  assert.equal(row(s.gen2).ownedWorkerCount, 0);
  assert.equal(mapped.some(function (item) { return item.id === hiddenOnly.localId; }), false, "hidden Workers stay out of the list");
});

test("client confirmations state the full cascade and never understate hidden Workers", async function () {
  var scope = await loadScope();
  var sessions = [
    { id: 1, title: "Lead", sessionRole: "driver", ownedWorkerCount: 3 },
    { id: 2, sessionRole: "worker", parentSessionId: 1, parentAvailable: true, workerGeneration: 1 },
    { id: 3, sessionRole: "worker", parentSessionId: 1, parentAvailable: true, workerGeneration: 2 },
    { id: 4, sessionRole: "worker", parentSessionId: 1, parentAvailable: false },
    { id: 5, title: "Solo", sessionRole: "driver", ownedWorkerCount: 0 },
    { id: 6, title: "Quiet", sessionRole: "driver", ownedWorkerCount: 2 },
    { id: 7, title: "Legacy", sessionRole: "driver" },
  ];
  var driver = scope.describeSessionDelete(sessions[0], sessions);
  assert.equal(driver.workerCount, 3, "the authoritative total wins over the two visible Workers");
  assert.equal(driver.requiresDialog, true);
  assert.match(driver.message, /This Driver and all 3 Split Worker sessions it owns, including hidden sessions and previous generations/);

  var hiddenOnly = scope.describeSessionDelete(sessions[5], sessions);
  assert.equal(hiddenOnly.workerCount, 2, "no visible Worker, but the hidden ones are still stated");
  assert.equal(hiddenOnly.requiresDialog, true);

  var worker = scope.describeSessionDelete(sessions[1], sessions);
  assert.equal(worker.workerCount, 0, "a Worker deletion affects only that Worker");
  assert.equal(worker.requiresDialog, false);
  assert.equal(worker.message, 'Delete "New Session"? This session and its history will be permanently removed.');

  var solo = scope.describeSessionDelete({ id: 5, title: "Solo" }, sessions);
  assert.equal(solo.requiresDialog, false, "the context-menu partial object resolves through the cache");
  assert.equal(scope.describeSessionDelete({ id: 6, title: "Quiet" }, sessions).workerCount, 2);

  var missing = scope.describeSessionDelete({ id: 99, title: "Gone" }, sessions);
  assert.equal(missing.workerCount, null, "a session missing from the cache has an unknown scope");
  assert.equal(missing.requiresDialog, true);
  assert.match(missing.message, /If it is a Driver, every Split Worker session it owns, including hidden sessions and previous generations/);
  var legacy = scope.describeSessionDelete(sessions[6], sessions);
  assert.equal(legacy.requiresDialog, true, "a Driver without the total is never presented as Worker-free");

  var mixed = scope.describeGroupDelete("Mixed", [1, 3, 5, 6], sessions);
  assert.deepEqual(mixed.ids, [1, 3, 5, 6, 2]);
  assert.equal(mixed.exact, true);
  assert.equal(mixed.message, 'Clear "Mixed"? 8 sessions will be permanently removed, including 4 Split Worker sessions owned by these Drivers, including hidden sessions and previous generations.');
  var workersOnly = scope.describeGroupDelete("Workers", [2, 3], sessions);
  assert.equal(workersOnly.message, 'Clear "Workers"? 2 sessions will be permanently removed.');
  var tree = scope.describeGroupDelete("Tree", [1, 2, 3], sessions);
  assert.equal(tree.message, 'Clear "Tree"? 4 sessions will be permanently removed, including 1 Split Worker session owned by these Drivers, including hidden sessions and previous generations.');
  var uncertain = scope.describeGroupDelete("Uncertain", [2, 7, 99], sessions);
  assert.equal(uncertain.exact, false);
  assert.match(uncertain.message, /^Clear "Uncertain"\? At least 3 sessions will be permanently removed, plus every Split Worker session owned by a Driver here/);
});
