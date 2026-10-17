var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var ownership = require("../lib/project-ownership");
var permissions = require("../lib/users-permissions").attachPermissions({ findUserById: function (id) { return accounts.find(function (user) { return user.id === id; }); } });
var accounts = [{ id: "admin-z", role: "admin" }, { id: "admin-a", role: "admin" }, { id: "owner", role: "user", linuxUser: "owner" }];

function copy(value) { return JSON.parse(JSON.stringify(value)); }

test("repair preserves valid ownership and shares, selects stable administrator for public orphans only", function () {
  var config = { projects: [
    { slug: "valid", ownerId: "owner", visibility: "public", allowedUsers: ["admin-z"] },
    { slug: "missing", visibility: "public" },
    { slug: "deleted", ownerId: "deleted", visibility: "public" },
    { slug: "secret", ownerId: "deleted", path: "/unavailable", visibility: "private", allowedUsers: ["admin-a"] },
    { slug: "mate-host", visibility: "public" },
  ] };
  var original = copy(config);
  var persisted;
  var result = ownership.repair(config, accounts, function (value) { persisted = copy(value); }, function () { throw new Error("Unavailable"); });
  assert.deepEqual(config, original);
  assert.deepEqual(result, persisted);
  assert.deepEqual(result.projects[0], original.projects[0]);
  assert.equal(result.projects[1].ownerId, "admin-a");
  assert.equal(result.projects[2].ownerId, "admin-a");
  assert.equal(result.projects[3].ownerId, "deleted");
  assert.equal(result.projects[3].ownershipRecovery, "required");
  assert.deepEqual(result.projects[3].allowedUsers, ["admin-a"]);
  assert.deepEqual(result.projects[4], original.projects[4]);
  var writes = 0;
  assert.equal(ownership.repair(result, accounts.slice().reverse(), function () { writes++; }), result);
  assert.equal(writes, 0);
  assert.equal(permissions.canAccessProject("admin-a", result.projects[3]), false);
});

test("migration fails without publishing ownership when atomic persistence fails; retry is deterministic", function () {
  var config = { singleUserMigratedUserId: "admin-z", projects: [{ slug: "legacy" }] };
  var before = copy(config);
  assert.throws(function () { ownership.repair(config, accounts, function () { throw new Error("EACCES"); }); }, /EACCES/);
  assert.deepEqual(config, before);
  var saved = ownership.repair(config, accounts, function () {});
  assert.equal(saved.projects[0].ownerId, "admin-z");
  assert.equal(ownership.repair(config, [], function () { assert.fail("pre-account write"); }), config);
});

test("private recovery requires real unique OS UID/home mapping and rejects shared roots, UID aliases and symlinks", function (t) {
  var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-owner-mapping-")));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var home = path.join(root, "home");
  var project = path.join(home, "project");
  fs.mkdirSync(project, { recursive: true });
  var uid = fs.statSync(project).uid;
  function resolve() { return { home: home, uid: uid }; }
  var record = { slug: "private", path: project, visibility: "private" };
  assert.equal(ownership.verifiedPrivateOwner(record, accounts, resolve), "owner");
  assert.equal(ownership.verifiedPrivateOwner(record, accounts.concat([{ id: "alias", linuxUser: "alias" }]), resolve), null);
  assert.equal(ownership.verifiedPrivateOwner(record, accounts, function () { return { home: root + "-prefix", uid: uid }; }), null);
  assert.equal(ownership.verifiedPrivateOwner(record, accounts, function () { return { home: home, uid: uid + 1 }; }), null);
  var link = path.join(root, "link");
  fs.symlinkSync(home, link);
  assert.equal(ownership.verifiedPrivateOwner(Object.assign({}, record, { path: path.join(link, "project") }), accounts, resolve), null);
  var saved = ownership.repair({ projects: [record] }, accounts, function () {}, resolve);
  assert.equal(saved.projects[0].ownerId, "owner");
});

test("content access requires accounts; public membership never grants private or ownerless sessions", function () {
  var project = { visibility: "public", ownerId: "owner" };
  assert.equal(permissions.canAccessProject(null, project), false);
  assert.equal(permissions.canAccessProject("deleted", project), false);
  assert.equal(permissions.canAccessProject("admin-a", { visibility: "private", ownerId: "owner" }), false);
  assert.equal(permissions.canAccessProject("admin-a", { visibility: "private", ownerId: "owner", allowedUsers: ["admin-a"] }), true);
  assert.equal(permissions.canAccessSession("admin-a", { ownerId: "owner", sessionVisibility: "private" }, project), false);
  assert.equal(permissions.canAccessSession("admin-a", { ownerId: "owner", sessionVisibility: "shared" }, project), true);
  assert.equal(permissions.canAccessSession("admin-a", {}, project), false);
});

test("worktrees inherit both repaired ownership and unresolved recovery; no private sessions are transferred", function () {
  var access = require("../lib/daemon-project-access");
  var privateSession = { ownerId: "deleted", sessionVisibility: "private" };
  var repaired = ownership.repair({ projects: [{ slug: "public", ownerId: "deleted", visibility: "public" }, { slug: "private", path: "/missing", visibility: "private" }] }, accounts, function () {});
  assert.equal(access.getProjectAccess(repaired, "public--branch", false).ownerId, "admin-a");
  assert.equal(access.getProjectAccess(repaired, "private--branch", false).ownershipRecovery, "required");
  assert.equal(permissions.canAccessSession("admin-a", privateSession, access.getProjectAccess(repaired, "public", false)), false);
  assert.equal(privateSession.ownerId, "deleted");
});

test("directory registration denies foreign roots, nested paths and aliases even for administrators", function (t) {
  var attach = require("../lib/server-path-access").attachPathAccess;
  var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-path-scope-")));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var foreign = path.join(root, "foreign");
  fs.mkdirSync(path.join(foreign, "nested"), { recursive: true });
  var alias = path.join(root, "alias");
  fs.symlinkSync(foreign, alias);
  var projects = new Map([["foreign", { getStatus: function () { return { path: foreign }; } }]]);
  var check = attach({ projects: projects, users: { isMultiUser: function () { return true; }, findUserById: function (id) { return accounts.find(function (user) { return user.id === id; }); }, getAllUsers: function () { return accounts; } }, canAccess: function (id) { return id === "owner"; } });
  assert.equal(check("admin-a", foreign), false);
  assert.equal(check("admin-a", path.join(foreign, "nested")), false);
  assert.equal(check("admin-a", alias), false);
  assert.equal(check("admin-a", root), false);
  assert.equal(check("owner", foreign), true);
});

test("production atomic configuration persistence survives restart and refuses a failed rename", function (t) {
  var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-ownership-persist-")));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var source = [
    'var assert = require("node:assert/strict");',
    'var fs = require("node:fs");',
    'var cfg = require("./lib/config");',
    'var repair = require("./lib/project-ownership").repair;',
    'var users = [{id:"b",role:"admin"},{id:"a",role:"admin"}];',
    'var initial = {projects:[{slug:"orphan",visibility:"public"}]};',
    'var saved = repair(initial, users, cfg.saveConfig);',
    'assert.equal(cfg.loadConfig().projects[0].ownerId,"a");',
    'assert.deepEqual(repair(cfg.loadConfig(), users.reverse(), function(){throw new Error("Unexpected write");}), saved);',
    'fs.unlinkSync(cfg.configPath()); fs.mkdirSync(cfg.configPath());',
    'assert.throws(function(){repair(initial,users,cfg.saveConfig);});',
    'assert.equal(initial.projects[0].ownerId,undefined);',
  ].join("\n");
  var result = require("node:child_process").spawnSync(process.execPath, ["-e", source], {
    cwd: path.join(__dirname, ".."), encoding: "utf8",
    env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: root, SUDO_USER: "", SUDO_HOME: "", CLAY_DEV: "" }),
  });
  assert.equal(result.status, 0, result.stderr);
});

test("registration persists repaired metadata before runtime and keeps the caller config unchanged on failure", function () {
  var config = { projects: [] };
  var entry = { slug: "new", visibility: "public" };
  assert.throws(function () { ownership.register(config, entry, accounts, function () { throw new Error("write failed"); }); }, /write failed/);
  assert.deepEqual(config.projects, []);
  var saved;
  var registered = ownership.register(config, entry, accounts, function (value) { saved = copy(value); });
  assert.equal(registered.projects[0].ownerId, "admin-a");
  assert.deepEqual(registered, saved);
});

test("push previews use live session access and never broadcast private payloads to administrators", function () {
  var delivered = [];
  var session = { localId: 1, ownerId: "owner", sessionVisibility: "private" };
  var projectAccess = { visibility: "public", ownerId: "owner" };
  var scoped = require("../lib/project-push-access").scopedPush({
    sendPush: function () { assert.fail("Global private push broadcast"); },
    sendPushToUser: function (id) { delivered.push(id); },
  }, {
    slug: "project", users: Object.assign({}, permissions, { isMultiUser: function () { return true; }, getAllUsers: function () { return accounts; } }),
    getProject: function () { return { getStatus: function () { return {}; }, getSessionManager: function () { return { sessions: new Map([[1, session]]) }; } }; },
    getAccess: function () { return projectAccess; }, canAccessProject: function (id) { return permissions.canAccessProject(id, projectAccess); },
  });
  scoped.sendPush({ sessionId: 1, title: "private preview" });
  assert.deepEqual(delivered, ["owner"]);
  scoped.sendPushToUser("admin-a", { data: { sessionId: 1, slug: "project" } });
  assert.deepEqual(delivered, ["owner"]);
  session.sessionVisibility = "shared";
  scoped.sendPush({ sessionId: 1 });
  assert.deepEqual(delivered.slice(1).sort(), accounts.map(function (user) { return user.id; }).sort());
  delivered.length = 0;
  projectAccess.visibility = "private";
  scoped.sendPush({ sessionId: 1 });
  assert.deepEqual(delivered, ["owner"]);
});
