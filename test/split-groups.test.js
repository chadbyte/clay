var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var { attachSplitGroups, createSplitGroupStore, autoGroupName } = require("../lib/session-split-groups");

function loadClientHelpers() {
  var file = path.join(__dirname, "../lib/public/modules/split-group-helpers.js");
  var source = fs.readFileSync(file, "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

function fixture(t, multiUser) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-split-groups-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var sessions = new Map([
    [1, { localId: 1, title: "First session", ownerId: "u1" }],
    [2, { localId: 2, title: "Second session", ownerId: "u1" }],
    [3, { localId: 3, title: "Third session", ownerId: "u2" }],
  ]);
  var usersModule = {
    isMultiUser: function () { return !!multiUser; },
    canAccessSession: function (userId, session) { return userId === session.ownerId; },
  };
  var broadcasts = 0;
  var store = createSplitGroupStore({
    sessions: sessions,
    sessionsDir: dir,
    usersModule: usersModule,
    broadcast: function () { broadcasts++; },
  });
  return {
    dir: dir,
    sessions: sessions,
    store: store,
    ws1: { _clayUser: { id: "u1" } },
    ws2: { _clayUser: { id: "u2" } },
    broadcasts: function () { return broadcasts; },
  };
}

test("create persists a valid two-session split group", function (t) {
  var f = fixture(t, false);
  var result = f.store.create(f.ws1, { members: [1, 2] });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.group.members, [1, 2]);
  assert.strictEqual(result.group.name, "First session | Second session");
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(f.dir, "split-groups.json"))).length, 1);
  assert.strictEqual(f.broadcasts(), 1);
});

test("create rejects invalid or already-grouped members", function (t) {
  var f = fixture(t, false);
  assert.strictEqual(f.store.create(f.ws1, { members: [1] }).ok, false);
  assert.strictEqual(f.store.create(f.ws1, { members: [1, 2, 3] }).ok, false);
  assert.strictEqual(f.store.create(f.ws1, { members: [1, 1] }).ok, false);
  assert.strictEqual(f.store.create(f.ws1, { members: [1, 99] }).ok, false);
  assert.strictEqual(f.store.create(f.ws1, { members: [1, 2] }).ok, true);
  assert.strictEqual(f.store.create(f.ws1, { members: [2, 3] }).ok, false);
});

test("rename marks a group customized, caps its name, and enforces ownership", function (t) {
  var f = fixture(t, true);
  var created = f.store.create(f.ws1, { members: [1, 2] });
  assert.strictEqual(created.ok, true);
  assert.strictEqual(f.store.rename(f.ws2, { id: created.group.id, name: "Nope" }).ok, false);
  var renamed = f.store.rename(f.ws1, { id: created.group.id, name: "x".repeat(100) });
  assert.strictEqual(renamed.ok, true);
  assert.strictEqual(renamed.group.name.length, 80);
  assert.strictEqual(renamed.group.nameCustomized, true);
  f.sessions.get(1).title = "Changed member";
  assert.strictEqual(f.store.refreshAutoName(1), false);
  assert.strictEqual(renamed.group.name, "x".repeat(80));
});

test("an uncustomized group name follows member session renames", function (t) {
  var f = fixture(t, false);
  var group = f.store.create(f.ws1, { members: [1, 2] }).group;
  f.sessions.get(1).title = "Renamed first";
  assert.strictEqual(f.store.refreshAutoName(1), true);
  assert.strictEqual(group.name, "Renamed first | Second session");
});

test("dissolve removes a group and a second dissolve is an error", function (t) {
  var f = fixture(t, false);
  var group = f.store.create(f.ws1, { members: [1, 2] }).group;
  assert.strictEqual(f.store.dissolve(f.ws1, { id: group.id }).ok, true);
  assert.strictEqual(f.store.dissolve(f.ws1, { id: group.id }).ok, false);
  assert.deepStrictEqual(f.store.groups, []);
});

test("dissolveBySession removes a group containing the deleted session", function (t) {
  var f = fixture(t, false);
  f.store.create(f.ws1, { members: [1, 2] });
  assert.strictEqual(f.store.dissolveBySession(2), true);
  assert.strictEqual(f.store.dissolveBySession(2), false);
  assert.deepStrictEqual(f.store.groups, []);
});

test("a group survives a restart that renumbers member localIds", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).cliSessionId = "cli-aaa";
  f.sessions.get(2).cliSessionId = "cli-bbb";
  var created = f.store.create(f.ws1, { members: [1, 2] });
  assert.strictEqual(created.ok, true);
  assert.deepStrictEqual(created.group.memberCliIds, ["cli-aaa", "cli-bbb"]);

  // Simulated restart: same sessions, freshly renumbered localIds.
  var renumbered = new Map([
    [11, { localId: 11, title: "First session", cliSessionId: "cli-aaa" }],
    [12, { localId: 12, title: "Second session", cliSessionId: "cli-bbb" }],
  ]);
  var reloaded = createSplitGroupStore({ sessions: renumbered, sessionsDir: f.dir, usersModule: null });
  assert.strictEqual(reloaded.groups.length, 1);
  assert.deepStrictEqual(reloaded.groups[0].members, [11, 12]);
  // The rewritten file carries the remapped ids too.
  var persisted = JSON.parse(fs.readFileSync(path.join(f.dir, "split-groups.json")));
  assert.deepStrictEqual(persisted[0].members, [11, 12]);
});

test("configured pair roles survive member renumbering", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).cliSessionId = "cli-driver";
  f.sessions.get(2).cliSessionId = "cli-worker";
  var created = f.store.create(f.ws1, {
    members: [1, 2],
    pair: { driverId: 1, workerId: 2 },
  });
  assert.strictEqual(created.ok, true);
  assert.deepStrictEqual(created.group.pairCliIds, ["cli-driver", "cli-worker"]);

  var renumbered = new Map([
    [21, { localId: 21, title: "Driver", cliSessionId: "cli-driver" }],
    [22, { localId: 22, title: "Worker", cliSessionId: "cli-worker" }],
  ]);
  var reloaded = createSplitGroupStore({ sessions: renumbered, sessionsDir: f.dir, usersModule: null });
  assert.deepStrictEqual(reloaded.groups[0].members, [21, 22]);
  assert.deepStrictEqual(reloaded.groups[0].pair, { driverId: 21, workerId: 22 });
});

test("owned Driver transfer keeps one group and stable Worker anchors across reload and renumber", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).sessionOriginId = "origin-source";
  f.sessions.get(2).sessionOriginId = "origin-worker";
  f.sessions.get(1).cliSessionId = "cli-source";
  f.sessions.get(2).cliSessionId = "cli-worker";
  f.sessions.set(4, { localId: 4, title: "Successor", ownerId: "u1", cliSessionId: "cli-successor",
    sessionOriginId: "origin-successor" });
  var created = f.store.createOwned("u1", { members: [1, 2], pair: { driverId: 1, workerId: 2 } });
  assert.strictEqual(created.ok, true);
  var beforeDisk = fs.readFileSync(path.join(f.dir, "split-groups.json"), "utf8");
  var staged = f.store.beginOwnedDriverTransfer("u1", {
    id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
  });
  assert.strictEqual(staged.ok, true);
  assert.deepStrictEqual(created.group.pair, { driverId: 1, workerId: 2 });
  assert.deepStrictEqual(f.store.groupForMember(4).pair, { driverId: 4, workerId: 2 });
  assert.strictEqual(f.store.groupForMember(1), null);
  assert.strictEqual(fs.readFileSync(path.join(f.dir, "split-groups.json"), "utf8"), beforeDisk,
    "staging itself must not write the successor ownership");
  f.sessions.set(5, { localId: 5, title: "Other A", ownerId: "u1", cliSessionId: "cli-other-a" });
  f.sessions.set(6, { localId: 6, title: "Other B", ownerId: "u1", cliSessionId: "cli-other-b" });
  assert.strictEqual(f.store.createOwned("u1", { members: [1, 5], pair: { driverId: 1, workerId: 5 } }).ok, false);
  assert.strictEqual(f.store.createOwned("u1", { members: [4, 5], pair: { driverId: 4, workerId: 5 } }).ok, false);
  assert.strictEqual(f.store.createOwned("u1", { members: [2, 5], pair: { driverId: 2, workerId: 5 } }).ok, false);
  var other = f.store.createOwned("u1", { members: [5, 6], pair: { driverId: 5, workerId: 6 } });
  assert.strictEqual(other.ok, true);
  assert.strictEqual(f.store.rename(f.ws1, { id: other.group.id, name: "Renamed elsewhere" }).ok, true);
  f.store.refreshAnchors(2);
  var stagedList = f.store.listFor(f.ws1);
  assert.strictEqual(stagedList.find(function (item) { return item.id === created.group.id; }).pair.driverId, 1);
  var stagedDisk = JSON.parse(fs.readFileSync(path.join(f.dir, "split-groups.json")));
  assert.strictEqual(stagedDisk.find(function (item) { return item.id === created.group.id; }).pair.driverId, 1);
  assert.strictEqual(f.store.commitOwnedDriverTransfer(staged.transaction).ok, true);
  assert.deepStrictEqual(created.group.memberOriginIds, ["origin-successor", "origin-worker"]);
  assert.deepStrictEqual(created.group.pairOriginIds, ["origin-successor", "origin-worker"]);

  var renumbered = new Map([
    [41, { localId: 41, title: "Successor", ownerId: "u1", cliSessionId: "cli-successor", sessionOriginId: "origin-successor" }],
    [42, { localId: 42, title: "Worker", ownerId: "u1", cliSessionId: "cli-worker", sessionOriginId: "origin-worker" }],
    [43, { localId: 43, title: "Source", ownerId: "u1", cliSessionId: "cli-source", sessionOriginId: "origin-source" }],
  ]);
  var reloaded = createSplitGroupStore({ sessions: renumbered, sessionsDir: f.dir, usersModule: null });
  assert.strictEqual(reloaded.groups.length, 1);
  assert.strictEqual(reloaded.groups[0].id, created.group.id);
  assert.deepStrictEqual(reloaded.groups[0].members, [41, 42]);
  assert.deepStrictEqual(reloaded.groups[0].pair, { driverId: 41, workerId: 42 });
  assert.strictEqual(reloaded.groupForMember(43), null);
});

test("owned Driver transfer rollback restores the exact source group without recreation", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).cliSessionId = "cli-source";
  f.sessions.get(2).cliSessionId = "cli-worker";
  f.sessions.set(4, { localId: 4, title: "Successor", ownerId: "u1", cliSessionId: "cli-successor" });
  var created = f.store.createOwned("u1", { members: [1, 2], pair: { driverId: 1, workerId: 2 } });
  var staged = f.store.beginOwnedDriverTransfer("u1", {
    id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
  });
  assert.strictEqual(f.store.commitOwnedDriverTransfer(staged.transaction).ok, true);
  assert.strictEqual(f.store.rollbackOwnedDriverTransfer(staged.transaction).ok, true);
  assert.strictEqual(f.store.groups.length, 1);
  assert.strictEqual(f.store.groups[0].id, created.group.id);
  assert.deepStrictEqual(f.store.groups[0].members, [1, 2]);
  assert.deepStrictEqual(f.store.groups[0].pair, { driverId: 1, workerId: 2 });
  var persisted = JSON.parse(fs.readFileSync(path.join(f.dir, "split-groups.json")));
  assert.deepStrictEqual(persisted[0].memberCliIds, ["cli-source", "cli-worker"]);
  assert.deepStrictEqual(persisted[0].pairCliIds, ["cli-source", "cli-worker"]);
});

test("owned Driver transfer commit failure restores the in-memory and durable source pair", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).cliSessionId = "cli-source";
  f.sessions.get(2).cliSessionId = "cli-worker";
  f.sessions.set(4, { localId: 4, title: "Successor", ownerId: "u1", cliSessionId: "cli-successor" });
  var created = f.store.createOwned("u1", { members: [1, 2], pair: { driverId: 1, workerId: 2 } });
  var staged = f.store.beginOwnedDriverTransfer("u1", {
    id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
  });
  var originalRename = fs.renameSync;
  fs.renameSync = function () { throw new Error("disk unavailable"); };
  var committed;
  try { committed = f.store.commitOwnedDriverTransfer(staged.transaction); }
  finally { fs.renameSync = originalRename; }
  assert.strictEqual(committed.ok, false);
  assert.deepStrictEqual(created.group.members, [1, 2]);
  assert.deepStrictEqual(created.group.pair, { driverId: 1, workerId: 2 });
  var persisted = JSON.parse(fs.readFileSync(path.join(f.dir, "split-groups.json")));
  assert.deepStrictEqual(persisted[0].members, [1, 2]);
  assert.deepStrictEqual(persisted[0].pair, { driverId: 1, workerId: 2 });
});

test("owned Driver transfer rolls back both false and throwing persistence results", function (t) {
  var modes = ["false", "throw"];
  var dirs = [];
  t.after(function () {
    for (var di = 0; di < dirs.length; di++) fs.rmSync(dirs[di], { recursive: true, force: true });
  });
  for (var i = 0; i < modes.length; i++) {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-split-transfer-save-"));
    dirs.push(dir);
    var sessions = new Map([
      [1, { localId: 1, ownerId: "u1", cliSessionId: "cli-source" }],
      [2, { localId: 2, ownerId: "u1", cliSessionId: "cli-worker" }],
      [4, { localId: 4, ownerId: "u1", cliSessionId: "cli-successor" }],
    ]);
    var fail = false;
    var mode = modes[i];
    var store = createSplitGroupStore({ sessions: sessions, sessionsDir: dir, usersModule: null,
      persistGroups: function (file, serialized) {
        if (fail) {
          if (mode === "throw") throw new Error("disk unavailable");
          return false;
        }
        fs.writeFileSync(file, serialized);
        return true;
      } });
    var created = store.createOwned("u1", { members: [1, 2], pair: { driverId: 1, workerId: 2 } });
    var staged = store.beginOwnedDriverTransfer("u1", {
      id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
    });
    fail = true;
    assert.strictEqual(store.commitOwnedDriverTransfer(staged.transaction).ok, false);
    assert.deepStrictEqual(created.group.members, [1, 2]);
    assert.deepStrictEqual(created.group.pair, { driverId: 1, workerId: 2 });
    var persisted = JSON.parse(fs.readFileSync(path.join(dir, "split-groups.json")));
    assert.deepStrictEqual(persisted[0].members, [1, 2]);
    assert.deepStrictEqual(persisted[0].pair, { driverId: 1, workerId: 2 });
  }
});

test("owned Driver transfer keeps the committed owner when rollback persistence fails", function (t) {
  var modes = ["false", "throw"];
  var dirs = [];
  t.after(function () {
    for (var di = 0; di < dirs.length; di++) fs.rmSync(dirs[di], { recursive: true, force: true });
  });
  for (var i = 0; i < modes.length; i++) {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-split-transfer-rollback-"));
    dirs.push(dir);
    var sessions = new Map([
      [1, { localId: 1, ownerId: "u1", cliSessionId: "cli-source" }],
      [2, { localId: 2, ownerId: "u1", cliSessionId: "cli-worker" }],
      [4, { localId: 4, ownerId: "u1", cliSessionId: "cli-successor" }],
    ]);
    var fail = false;
    var mode = modes[i];
    var store = createSplitGroupStore({ sessions: sessions, sessionsDir: dir, usersModule: null,
      persistGroups: function (file, serialized) {
        if (fail) {
          if (mode === "throw") throw new Error("disk unavailable");
          return false;
        }
        fs.writeFileSync(file, serialized);
        return true;
      } });
    var created = store.createOwned("u1", { members: [1, 2], pair: { driverId: 1, workerId: 2 } });
    var staged = store.beginOwnedDriverTransfer("u1", {
      id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
    });
    assert.strictEqual(store.commitOwnedDriverTransfer(staged.transaction).ok, true);
    fail = true;
    assert.strictEqual(store.rollbackOwnedDriverTransfer(staged.transaction).ok, false);
    assert.deepStrictEqual(created.group.members, [4, 2]);
    assert.deepStrictEqual(created.group.pair, { driverId: 4, workerId: 2 });
    var persisted = JSON.parse(fs.readFileSync(path.join(dir, "split-groups.json")));
    assert.deepStrictEqual(persisted[0].members, [4, 2]);
    assert.deepStrictEqual(persisted[0].pair, { driverId: 4, workerId: 2 });
  }
});

test("owned Driver transfer rejects stale ownership, roles, live objects, and duplicate membership", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).cliSessionId = "cli-source";
  f.sessions.get(2).cliSessionId = "cli-worker";
  f.sessions.set(4, { localId: 4, title: "Successor", ownerId: "u1", cliSessionId: "cli-successor" });
  f.sessions.set(5, { localId: 5, title: "Other", ownerId: "u1", cliSessionId: "cli-other" });
  var created = f.store.createOwned("u1", { members: [1, 2], pair: { driverId: 1, workerId: 2 } });
  assert.strictEqual(f.store.beginOwnedDriverTransfer("u2", {
    id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
  }).ok, false);
  assert.strictEqual(f.store.beginOwnedDriverTransfer("u1", {
    id: created.group.id, sourceDriverId: 2, targetDriverId: 4, workerId: 1,
  }).ok, false);
  var other = f.store.createOwned("u1", { members: [4, 5], pair: { driverId: 4, workerId: 5 } });
  assert.strictEqual(other.ok, true);
  assert.strictEqual(f.store.beginOwnedDriverTransfer("u1", {
    id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
  }).ok, false);
  assert.strictEqual(f.store.dissolveOwned("u1", other.group.id), true);

  var stagedOwner = f.store.beginOwnedDriverTransfer("u1", {
    id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
  });
  f.sessions.get(4).ownerId = "u2";
  assert.strictEqual(f.store.commitOwnedDriverTransfer(stagedOwner.transaction).ok, false);
  assert.deepStrictEqual(created.group.pair, { driverId: 1, workerId: 2 });
  f.sessions.get(4).ownerId = "u1";

  var stagedObject = f.store.beginOwnedDriverTransfer("u1", {
    id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
  });
  var target = f.sessions.get(4);
  f.sessions.set(4, Object.assign({}, target));
  assert.strictEqual(f.store.commitOwnedDriverTransfer(stagedObject.transaction).ok, false);
  assert.deepStrictEqual(created.group.pair, { driverId: 1, workerId: 2 });
  f.sessions.set(4, target);

  var stagedDuplicate = f.store.beginOwnedDriverTransfer("u1", {
    id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
  });
  f.store.groups.push({ id: "duplicate", ownerId: "u1", members: [4, 5],
    pair: { driverId: 4, workerId: 5 }, createdAt: Date.now() });
  assert.strictEqual(f.store.commitOwnedDriverTransfer(stagedDuplicate.transaction).ok, false);
  assert.deepStrictEqual(created.group.pair, { driverId: 1, workerId: 2 });
  f.store.groups.pop();
});

test("owned Driver transfer requires a durable target CLI identity before commit", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).sessionOriginId = "origin-source";
  f.sessions.get(2).sessionOriginId = "origin-worker";
  f.sessions.set(4, { localId: 4, title: "Successor", ownerId: "u1", sessionOriginId: "origin-successor" });
  var created = f.store.createOwned("u1", { members: [1, 2], pair: { driverId: 1, workerId: 2 } });
  var staged = f.store.beginOwnedDriverTransfer("u1", {
    id: created.group.id, sourceDriverId: 1, targetDriverId: 4, workerId: 2,
  });
  assert.strictEqual(f.store.commitOwnedDriverTransfer(staged.transaction).ok, false);
  assert.deepStrictEqual(created.group.pair, { driverId: 1, workerId: 2 });
});

test("split groups can reload from origin anchors before CLI identities exist", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).sessionOriginId = "origin-successor";
  f.sessions.get(2).sessionOriginId = "origin-worker";
  f.store.createOwned("u1", { members: [1, 2], pair: { driverId: 1, workerId: 2 } });
  var renumbered = new Map([
    [40, { localId: 40, ownerId: "u1", sessionOriginId: "origin-successor" }],
    [41, { localId: 41, ownerId: "u1", sessionOriginId: "origin-worker" }],
  ]);
  var reloaded = createSplitGroupStore({ sessions: renumbered, sessionsDir: f.dir, usersModule: null });
  assert.deepStrictEqual(reloaded.groups[0].members, [40, 41]);
  assert.deepStrictEqual(reloaded.groups[0].pair, { driverId: 40, workerId: 41 });
});

test("an in-progress Worker becomes restart-safe when its session identity arrives", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).cliSessionId = "cli-driver";
  var created = f.store.create(f.ws1, {
    members: [1, 2],
    pair: { driverId: 1, workerId: 2 },
  });
  assert.strictEqual(created.ok, true);
  assert.deepStrictEqual(created.group.memberCliIds, ["cli-driver", null]);

  f.sessions.get(2).cliSessionId = "cli-worker";
  assert.strictEqual(f.store.refreshAnchors(2), true);
  var persisted = JSON.parse(fs.readFileSync(path.join(f.dir, "split-groups.json")));
  assert.deepStrictEqual(persisted[0].memberCliIds, ["cli-driver", "cli-worker"]);
  assert.deepStrictEqual(persisted[0].pairCliIds, ["cli-driver", "cli-worker"]);

  var renumbered = new Map([
    [11, { localId: 11, title: "Driver", cliSessionId: "cli-driver" }],
    [12, { localId: 12, title: "Worker", cliSessionId: "cli-worker" }],
  ]);
  var reloaded = createSplitGroupStore({ sessions: renumbered, sessionsDir: f.dir, usersModule: null });
  assert.deepStrictEqual(reloaded.groups[0].members, [11, 12]);
  assert.deepStrictEqual(reloaded.groups[0].pair, { driverId: 11, workerId: 12 });
});

test("configured pair roles must reference both members", function (t) {
  var f = fixture(t, false);
  var result = f.store.create(f.ws1, {
    members: [1, 2],
    pair: { driverId: 1, workerId: 3 },
  });
  assert.strictEqual(result.ok, false);
});

test("setPair assigns roles on an existing group and derives the worker", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).cliSessionId = "cli-a";
  f.sessions.get(2).cliSessionId = "cli-b";
  var group = f.store.create(f.ws1, { members: [1, 2] }).group;
  assert.strictEqual(group.pair, undefined);

  var set = f.store.setPair(f.ws1, { id: group.id, driverId: 2 });
  assert.strictEqual(set.ok, true);
  assert.deepStrictEqual(set.group.pair, { driverId: 2, workerId: 1 });
  assert.deepStrictEqual(set.group.pairCliIds, ["cli-b", "cli-a"]);
  var persisted = JSON.parse(fs.readFileSync(path.join(f.dir, "split-groups.json")));
  assert.deepStrictEqual(persisted[0].pair, { driverId: 2, workerId: 1 });
});

test("setPair clears roles with a null driverId", function (t) {
  var f = fixture(t, false);
  var group = f.store.create(f.ws1, { members: [1, 2], pair: { driverId: 1, workerId: 2 } }).group;
  var cleared = f.store.setPair(f.ws1, { id: group.id, driverId: null });
  assert.strictEqual(cleared.ok, true);
  assert.strictEqual(cleared.group.pair, undefined);
  assert.strictEqual(cleared.group.pairCliIds, undefined);
  var persisted = JSON.parse(fs.readFileSync(path.join(f.dir, "split-groups.json")));
  assert.strictEqual(persisted[0].pair, undefined);
});

test("pair changes notify the runtime for both assignment and clearing", function (t) {
  var f = fixture(t, false);
  var changed = [];
  var store = createSplitGroupStore({
    sessions: f.sessions,
    sessionsDir: f.dir,
    usersModule: null,
    onPairChanged: function (group) { changed.push(group.pair ? group.pair.driverId : null); },
  });
  var group = store.create(f.ws1, { members: [1, 2] }).group;
  store.setPair(f.ws1, { id: group.id, driverId: 1 });
  store.setPair(f.ws1, { id: group.id, driverId: null });
  assert.deepStrictEqual(changed, [1, null]);
});

test("setPair rejects non-members, unknown groups, and non-owners", function (t) {
  var f = fixture(t, true);
  var group = f.store.create(f.ws1, { members: [1, 2] }).group;
  assert.strictEqual(f.store.setPair(f.ws1, { id: group.id, driverId: 3 }).ok, false);
  assert.strictEqual(f.store.setPair(f.ws1, { id: "sg_missing", driverId: 1 }).ok, false);
  assert.strictEqual(f.store.setPair(f.ws2, { id: group.id, driverId: 1 }).ok, false);
});

test("a group anchored to a vanished cliSessionId is pruned on load", function (t) {
  var f = fixture(t, false);
  f.sessions.get(1).cliSessionId = "cli-aaa";
  f.sessions.get(2).cliSessionId = "cli-bbb";
  assert.strictEqual(f.store.create(f.ws1, { members: [1, 2] }).ok, true);
  var renumbered = new Map([
    [11, { localId: 11, title: "First session", cliSessionId: "cli-aaa" }],
  ]);
  var reloaded = createSplitGroupStore({ sessions: renumbered, sessionsDir: f.dir, usersModule: null });
  assert.deepStrictEqual(reloaded.groups, []);
});

test("load prunes and rewrites groups whose member session is missing", function (t) {
  var f = fixture(t, false);
  fs.writeFileSync(path.join(f.dir, "split-groups.json"), JSON.stringify([
    { id: "sg_valid", name: "Valid", members: [1, 2], createdAt: 1 },
    { id: "sg_stale", name: "Stale", members: [1, 99], createdAt: 2 },
  ]));
  var reloaded = createSplitGroupStore({ sessions: f.sessions, sessionsDir: f.dir, usersModule: null });
  assert.deepStrictEqual(reloaded.groups.map(function (group) { return group.id; }), ["sg_valid"]);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(f.dir, "split-groups.json"))).length, 1);
});

test("autoGroupName truncates both titles and joins them with the separator", function () {
  assert.strictEqual(autoGroupName("123456789012345678901", "abcdefghijklmnopqrstu"),
    "1234567890123456789… | abcdefghijklmnopqrs…");
});

test("pane connections receive pair roles for Worker chrome enforcement", function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-split-pane-state-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var sessions = new Map([
    [1, { localId: 1, title: "Driver", ownerId: null }],
    [2, { localId: 2, title: "Worker", ownerId: null }],
  ]);
  var sent = [];
  var attached = attachSplitGroups({
    sm: {
      sessions: sessions,
      sessionsDir: dir,
      setOnSessionDeleted: function () {},
      setOnSessionRenamed: function () {},
      setOnSessionIdentityAssigned: function () {},
    },
    clients: new Set(),
    usersModule: null,
    sendTo: function (ws, message) { sent.push({ ws: ws, message: message }); },
  });
  attached.store.create(null, {
    members: [1, 2],
    pair: { driverId: 1, workerId: 2 },
  });
  var pane = { _clayPane: true };
  attached.sendConnectionState(pane);

  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].ws, pane);
  assert.deepStrictEqual(sent[0].message.groups[0].pair, { driverId: 1, workerId: 2 });
});

test("client helpers derive grouped ids and preserve stored member order", async function () {
  var helpers = await loadClientHelpers();
  var groups = [{ id: "a", members: [2, 1] }, { id: "b", members: [3, 4] }];
  assert.deepStrictEqual(Array.from(helpers.groupedSessionIds(groups)), [2, 1, 3, 4]);
  assert.strictEqual(helpers.findSplitGroup(groups, [2, 1]).id, "a");
  assert.strictEqual(helpers.findSplitGroup(groups, [1, 2]), null);
  assert.strictEqual(helpers.isConfiguredWorker([
    { id: "pair", members: [1, 2], pair: { driverId: 1, workerId: 2 } },
  ], 2), true);
  assert.strictEqual(helpers.isConfiguredWorker([{ id: "plain", members: [1, 2] }], 2), false);
});
