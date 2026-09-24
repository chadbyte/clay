var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var splitGroups = require("../lib/session-split-groups");
var multiWorkerFeature = require("../lib/multi-worker-feature");
var createSessionManager = require("../lib/sessions").createSessionManager;
var sessionProvenance = require("../lib/session-provenance");
var attachFactory = require("../lib/session-pair-factory").attachPairFactory;

var CAPABILITY = multiWorkerFeature.fromServerConfig({ multiWorkerRuntimeEnabled: true });
var QUIET = { error: function () {}, log: function () {} };

// A persisted Driver with two Workers in real session records under a
// temporary directory.
function fixture(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-split-load-uncertain-"));
  var restores = [];
  t.after(function () {
    restores.forEach(function (restore) { restore(); });
    fs.rmSync(dir, { recursive: true, force: true });
  });
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
  var fail = false;
  var store = splitGroups.createSplitGroupStore({ sessions: sm.sessions, sessionsDir: sm.sessionsDir, usersModule: null,
    multiWorkerFeature: CAPABILITY, logger: QUIET, persistRetryDelaysMs: [60000],
    persistGroups: function (file, serialized) { if (fail) return false; fs.writeFileSync(file, serialized); return true; } });
  t.after(function () { store.shutdown(); });
  sm.setOnSessionDeleted(store.dissolveBySession);
  store.create(null, { members: [driver.localId, peer.localId], pair: { driverId: driver.localId, workerId: peer.localId } });
  var factory = attachFactory({ sm: sm, splitStore: store, isMate: false,
    usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {}, multiWorkerFeature: CAPABILITY });
  var added = factory.addWorkerForDriver(driver, { workerVendor: "codex", workerModel: "codex-model" }).worker;
  var f = { dir: dir, sm: sm, store: store, driver: driver, peer: peer, added: added,
    groupsFile: path.join(sm.sessionsDir, "split-groups.json") };
  f.failWrites = function (value) { fail = value; };
  f.recordFile = function (session) {
    var names = fs.readdirSync(sm.sessionsDir).filter(function (name) { return name.endsWith(".jsonl"); });
    var match = names.filter(function (name) {
      return fs.readFileSync(path.join(sm.sessionsDir, name), "utf8").split("\n")[0].indexOf(session.sessionOriginId) !== -1;
    });
    assert.equal(match.length, 1, "exactly one record holds " + session.title);
    return path.join(sm.sessionsDir, match[0]);
  };
  f.makeUnreadable = function (file) {
    fs.chmodSync(file, 0);
    var restore = function () { try { fs.chmodSync(file, 0o600); } catch (e) {} };
    restores.push(restore);
    return restore;
  };
  f.corrupt = function (file) {
    var original = fs.readFileSync(file);
    fs.writeFileSync(file, "{not json\n");
    return function () { fs.writeFileSync(file, original); };
  };
  // Production wiring: attachSplitGroups passes the manager's load evidence.
  f.restart = function () {
    var manager = createSessionManager(managerOptions);
    var attached = splitGroups.attachSplitGroups({ sm: manager, clients: new Set(), sendTo: function () {},
      usersModule: null, multiWorkerFeature: CAPABILITY, onPairChanged: function () {} });
    t.after(function () { attached.shutdown(); });
    var byOrigin = {};
    manager.sessions.forEach(function (session) { byOrigin[session.sessionOriginId] = session; });
    return { manager: manager, store: attached.store, byOrigin: byOrigin };
  };
  f.disk = function () { return JSON.parse(fs.readFileSync(f.groupsFile, "utf8")); };
  return f;
}

function workerOrigins(group, restarted) {
  return group.pair.workerIds.map(function (id) { return restarted.manager.sessions.get(id).sessionOriginId; });
}

test("an unreadable Worker record preserves the stale group and restores the original pairing later", function (t) {
  if (process.getuid && process.getuid() === 0) { t.skip("root can read mode 000 files"); return; }
  var f = fixture(t);
  var restore = f.makeUnreadable(f.recordFile(f.added));
  var blocked = f.restart();
  assert.equal(blocked.manager.sessionLoadUncertain(), true);
  assert.equal(blocked.byOrigin[f.added.sessionOriginId], undefined, "the unreadable Worker did not load");
  assert.deepEqual(blocked.store.groups, [], "the group is not reduced from uncertain evidence");
  assert.equal(f.disk()[0].pair.workerIds.length, 2, "the stored two-Worker record is preserved");
  blocked.store.shutdown();

  restore();
  var recovered = f.restart();
  assert.equal(recovered.manager.sessionLoadUncertain(), false);
  assert.equal(recovered.store.groups.length, 1);
  assert.deepEqual(workerOrigins(recovered.store.groups[0], recovered),
    [f.peer.sessionOriginId, f.added.sessionOriginId], "the original pairing returns once readable");
});

test("an unparseable Worker record preserves the stale group and restores it when repaired", function (t) {
  var f = fixture(t);
  var restore = f.corrupt(f.recordFile(f.added));
  var blocked = f.restart();
  assert.equal(blocked.manager.sessionLoadUncertain(), true);
  assert.deepEqual(blocked.store.groups, []);
  assert.equal(f.disk()[0].pair.workerIds.length, 2);
  blocked.store.shutdown();
  restore();
  var recovered = f.restart();
  assert.deepEqual(workerOrigins(recovered.store.groups[0], recovered),
    [f.peer.sessionOriginId, f.added.sessionOriginId]);
});

test("a true deletion whose cleanup write failed still shrinks to the survivors on restart", function (t) {
  var f = fixture(t);
  f.failWrites(true);
  f.sm.deleteSessionQuiet(f.added.localId);
  assert.equal(f.store.persistenceStatus().pending, true);
  assert.equal(f.disk()[0].pair.workerIds.length, 2, "the cleanup write failed");
  f.store.shutdown();
  var restarted = f.restart();
  assert.equal(restarted.manager.sessionLoadUncertain(), false);
  assert.equal(restarted.store.groups.length, 1);
  assert.deepEqual(workerOrigins(restarted.store.groups[0], restarted), [f.peer.sessionOriginId]);
  assert.equal(f.disk()[0].pair.workerIds.length, 1, "the repaired record is written");
});

test("an absent Driver or all absent Workers are not dropped while any record is unreadable", function (t) {
  var f = fixture(t);
  f.failWrites(true);
  f.sm.deleteSessionQuiet(f.driver.localId);
  assert.deepEqual(f.store.groups, [], "live membership is dissolved immediately");
  f.store.shutdown();
  var unrelated = path.join(f.sm.sessionsDir, "unrelated-damaged.jsonl");
  fs.writeFileSync(unrelated, "garbage\n");
  var blocked = f.restart();
  assert.equal(blocked.manager.sessionLoadUncertain(), true);
  assert.deepEqual(blocked.store.groups, []);
  assert.equal(f.disk().length, 1, "the record is preserved rather than dropped");
  assert.equal(f.disk()[0].pair.workerIds.length, 2);
  blocked.store.shutdown();
  fs.unlinkSync(unrelated);
  var clean = f.restart();
  assert.equal(clean.manager.sessionLoadUncertain(), false);
  assert.deepEqual(clean.store.groups, []);
  assert.deepEqual(f.disk(), [], "with complete evidence the deleted Driver's record is removed");
});

test("a record whose Workers are all absent is preserved while any record is unparseable", function (t) {
  var f = fixture(t);
  f.failWrites(true);
  f.sm.deleteSessionQuiet(f.added.localId);
  f.sm.deleteSessionQuiet(f.peer.localId);
  assert.deepEqual(f.store.groups, []);
  f.store.shutdown();
  var unrelated = path.join(f.sm.sessionsDir, "unrelated-empty.jsonl");
  fs.writeFileSync(unrelated, "");
  var blocked = f.restart();
  assert.equal(blocked.manager.sessionLoadUncertain(), true);
  assert.ok(blocked.byOrigin[f.driver.sessionOriginId], "the Driver itself loaded");
  assert.equal(f.disk().length, 1, "no Worker is present, yet the record is not dropped");
  blocked.store.shutdown();
  fs.unlinkSync(unrelated);
  var clean = f.restart();
  assert.deepEqual(clean.store.groups, []);
  assert.deepEqual(f.disk(), []);
});
