var test = require("node:test");
var assert = require("node:assert");
var osUsers = require("../lib/os-users");
var permissions = require("../lib/users-permissions").attachPermissions({
  loadUsers: function() { return { users: [] }; },
  saveUsers: function() {},
  findUserById: function(id) {
    if (id === "admin") return { id: id, role: "admin" };
    if (id === "alice") return { id: id, role: "user" };
    return null;
  },
});

test("user-switched processes always initialize account groups", function() {
  var spawn = osUsers.wrapSpawnAsUser("node", ["worker.js"], { uid: 1201, gid: 1301 }, function() { return true; });
  assert.strictEqual(spawn.command, "setpriv");
  assert.ok(spawn.args.includes("--init-groups"));
  assert.strictEqual(osUsers.setInheritGroups, undefined);
});

test("missing setpriv falls back to the source uid and gid spawn", function() {
  var spawn = osUsers.wrapSpawnAsUser("node", ["worker.js"], { uid: 1201, gid: 1301 }, function() { return false; });
  assert.strictEqual(spawn.command, "node");
  assert.deepStrictEqual(spawn.args, ["worker.js"]);
  assert.strictEqual(spawn.options.uid, 1201);
  assert.strictEqual(spawn.options.gid, 1301);
});

test("new Linux usernames skip occupied names", function() {
  var occupied = { "clay-alice": true, "clay-alice-2": true };
  var available = osUsers.findAvailableLinuxUsername("clay-alice", function(name) { return !!occupied[name]; });
  assert.strictEqual(available, "clay-alice-3");
});

test("new Linux usernames retry after a useradd collision race", function() {
  var occupied = {};
  var created = [];
  var name = osUsers.allocateLinuxUsername("clay-alice", function(candidate) {
    return !!occupied[candidate];
  }, function(candidate) {
    created.push(candidate);
    if (candidate === "clay-alice") {
      occupied[candidate] = true;
      throw new Error("useradd: user already exists");
    }
    occupied[candidate] = true;
  });
  assert.deepStrictEqual(created, ["clay-alice", "clay-alice-2"]);
  assert.strictEqual(name, "clay-alice-2");
});

test("new Linux usernames advance after a collision that NSS cannot see yet", function() {
  var created = [];
  var name = osUsers.allocateLinuxUsername("clay-alice", function() {
    return false;
  }, function(candidate) {
    created.push(candidate);
    if (candidate === "clay-alice") throw new Error("useradd: user already exists");
  });
  assert.deepStrictEqual(created, ["clay-alice", "clay-alice-2"]);
  assert.strictEqual(name, "clay-alice-2");
});

test("new Linux usernames recognize opaque useradd status-nine collisions", function() {
  var created = [];
  var name = osUsers.allocateLinuxUsername("clay-alice", function() {
    return false;
  }, function(candidate) {
    created.push(candidate);
    if (candidate === "clay-alice") {
      var error = new Error("opaque failure");
      error.status = 9;
      throw error;
    }
  });
  assert.deepStrictEqual(created, ["clay-alice", "clay-alice-2"]);
  assert.strictEqual(name, "clay-alice-2");
});

test("legacy projects remain public and ownerless sessions remain admin-only", function() {
  var legacyProject = { slug: "legacy" };
  assert.strictEqual(permissions.canAccessProject("alice", legacyProject), true);
  assert.strictEqual(permissions.canAccessSession("alice", { id: 1 }, legacyProject), false);
  assert.strictEqual(permissions.canAccessSession("admin", { id: 1 }, legacyProject), true);
});

test("retired group setting rejects legacy writes without invoking a callback", function() {
  var replies = [];
  var called = false;
  var ctx = {
    usersModule: {isMultiUser: function() {return false;}},
    opts: {onGetDaemonConfig: function() {return {osUsers:true};}, onSetInheritGroups: function() {called = true;}},
    sendTo: function(ws, data) {replies.push(data);}
  };
  require('../lib/project-server-settings').handleServerSettings(ctx, {}, {type:'set_inherit_groups',value:false});
  assert.strictEqual(called, false);
  assert.strictEqual(replies[0].ok, false);
  assert.match(replies[0].error, /no longer configurable/);
});
