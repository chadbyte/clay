var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var os = require("os");
var vm = require("vm");
var attachPermissions = require("../lib/users-permissions").attachPermissions;
var attachRequestAccess = require("../lib/project-request-access").attachRequestAccess;
var attachFilesystem = require("../lib/project-filesystem").attachFilesystem;

function fixture(t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-request-access-"));
  t.after(function () { fs.rmSync(cwd, { recursive: true, force: true }); });
  var user = { id: "member", role: "member", permissions: { fileBrowser: true, projectSettings: true } };
  var users = attachPermissions({ findUserById: function () { return user; } });
  users.findUserById = function () { return user; };
  users.isMultiUser = function () { return true; };
  var sent = [];
  var calls = [];
  var grants = new Set(["allowed", "shared"]);
  var ctx = {
    cwd: cwd, slug: "allowed", osUsers: false, usersModule: users,
    sm: { sessions: new Map() },
    sendTo: function (ws, msg) { sent.push(msg); },
    opts: {
      canAccessProjectSlug: function (id, slug) { return id === user.id && grants.has(slug); },
      onGetProjectEnv: function (slug) { calls.push(slug); return { envrc: "MARKER=value" }; },
      onSetProjectEnv: function (slug) { calls.push(slug); return { ok: true }; },
      onGetSharedEnv: function () { calls.push("global"); return { envrc: "GLOBAL=value" }; },
      onSetSharedEnv: function () { calls.push("global"); return { ok: true }; },
    },
    validateEnvString: function () { return null; },
    getOsUserInfoForWs: function () { return null; },
    startFileWatch: function () { calls.push("watch"); },
    stopFileWatch: function () { calls.push("unwatch"); },
  };
  var ws = { _clayUser: { id: user.id, role: "admin" } };
  var access = attachRequestAccess(ctx);
  ctx.requestAccess = access;
  return { ctx: ctx, ws: ws, user: user, sent: sent, calls: calls, grants: grants, access: access,
    handler: attachFilesystem(ctx).handleFilesystemMessage };
}

test("actual message dispatch refuses forbidden destinations before resolving projects", function (t) {
  var f = fixture(t);
  var source = fs.readFileSync(path.join(__dirname, "../lib/project.js"), "utf8");
  var start = source.indexOf("  function handleMessage(ws, msg) {");
  var end = source.indexOf("    // --- DM messages (delegated to server-level handler) ---", start);
  var routed = [];
  var sandbox = { _requestAccess: f.access, _connection: null, slug: "allowed", opts: {
    getProject: function (slug) { routed.push(slug); return { handleMessage: function () {} }; },
  } };
  vm.runInNewContext(source.slice(start, end) + "\n}", sandbox);
  sandbox.handleMessage(f.ws, { type: "fs_read", targetSlug: "forbidden" });
  assert.deepEqual(routed, []);
  assert.match(f.sent[0].text, /access/);
  sandbox.handleMessage(f.ws, { type: "permission_response", targetSlug: "shared" });
  assert.deepEqual(routed, ["shared"]);
  f.grants.delete("allowed");
  sandbox.handleMessage(f.ws, { type: "fs_read", targetSlug: "shared" });
  assert.deepEqual(routed, ["shared"]);
});

test("destination authorization fails closed for missing identity, missing resolver and resolver errors", function (t) {
  var f = fixture(t);
  assert.equal(f.access.permitMessage({}, {}), false);
  delete f.ctx.opts.canAccessProjectSlug;
  assert.equal(f.access.permitMessage(f.ws, {}), false);
  f.ctx.opts.canAccessProjectSlug = function () { throw new Error("unavailable"); };
  assert.equal(f.access.permitMessage(f.ws, {}), false);
});

test("environment reads and writes require access to the exact target", function (t) {
  var f = fixture(t);
  ["get_project_env", "set_project_env"].forEach(function (type) {
    f.handler(f.ws, { type: type, slug: "forbidden", envrc: "MARKER=new" });
  });
  assert.deepEqual(f.calls, []);
  f.handler(f.ws, { type: "get_project_env", slug: "shared" });
  f.handler(f.ws, { type: "set_project_env", slug: "shared", envrc: "MARKER=new" });
  assert.deepEqual(f.calls, ["shared", "shared"]);
  f.grants.delete("shared");
  f.handler(f.ws, { type: "get_project_env", slug: "shared" });
  assert.equal(f.calls.length, 2);
});

test("OS-mapped members cannot read or overwrite server-global settings", function (t) {
  var f = fixture(t);
  f.ctx.osUsers = true;
  f.user.linuxUser = "clay-member";
  ["get_shared_env", "set_shared_env", "read_global_claude_md", "write_global_claude_md"].forEach(function (type) {
    f.handler(f.ws, { type: type, envrc: "MARKER=new", content: "marker" });
    assert.match(f.sent[f.sent.length - 1].text, /not permitted/);
  });
  assert.deepEqual(f.calls, []);
  f.user.role = "admin";
  f.handler(f.ws, { type: "get_shared_env" });
  assert.deepEqual(f.calls, ["global"]);
});

test("all history and watch operations respect disabled file-browser permission", function (t) {
  var f = fixture(t);
  f.user.permissions.fileBrowser = false;
  ["fs_watch", "fs_file_history", "fs_git_diff", "fs_file_at"].forEach(function (type) {
    f.handler(f.ws, { type: type, path: "file.txt", hash: "abcd" });
    assert.match(f.sent[f.sent.length - 1].error, /not permitted/);
  });
  assert.deepEqual(f.calls, []);
  f.handler(f.ws, { type: "fs_unwatch" });
  assert.deepEqual(f.calls, ["unwatch"]);
});

test("filesystem handlers use the mapped identity for relative and absolute targets", function (t) {
  var f = fixture(t);
  var identity = { uid: 4242, username: "mapped-user" };
  var fsCalls = [];
  f.ctx.osUsers = true;
  f.user.linuxUser = "mapped-user";
  f.ctx.getOsUserInfoForWs = function () { return identity; };
  f.ctx.fsAsUser = function (operation, args, actualIdentity) {
    fsCalls.push({ operation: operation, args: args, identity: actualIdentity });
    if (operation === "list") return [{ name: "relative.txt", isDir: false }];
    if (operation === "stat") return { size: 7 };
    if (operation === "read") return { content: "mapped", size: 7 };
    return true;
  };
  f.ctx.BINARY_EXTS = new Set();
  f.ctx.IMAGE_EXTS = new Set();
  f.ctx.IGNORED_DIRS = new Set();
  f.ctx.FS_MAX_SIZE = 1024 * 1024;
  f.handler = attachFilesystem(f.ctx).handleFilesystemMessage;
  f.handler(f.ws, { type: "fs_list", path: "../outside" });
  f.handler(f.ws, { type: "fs_read", path: "/tmp/absolute.txt", requestId: "read-1" });
  f.handler(f.ws, { type: "fs_write", path: "../outside.txt", content: "new" });
  assert.deepEqual(fsCalls.map(function (call) { return call.operation; }), ["list", "stat", "read", "write"]);
  assert.equal(fsCalls[0].args.dir, path.resolve(f.ctx.cwd, "../outside"));
  assert.equal(fsCalls[1].args.file, "/tmp/absolute.txt");
  fsCalls.forEach(function (call) { assert.equal(call.identity, identity); });
  var listMessage = f.sent.find(function (message) { return message.type === "fs_list_result"; });
  var readMessage = f.sent.find(function (message) { return message.type === "fs_read_result"; });
  var writeMessage = f.sent.find(function (message) { return message.type === "fs_write_result"; });
  assert.equal(listMessage.entries[0].path, path.relative(f.ctx.cwd, path.join(f.ctx.cwd, "../outside", "relative.txt")));
  assert.equal(readMessage.content, "mapped");
  assert.equal(writeMessage.ok, true);
});

test("filesystem handlers fail closed for denied OS operations and missing identity", function (t) {
  var f = fixture(t);
  f.ctx.osUsers = true;
  f.user.linuxUser = "mapped-user";
  f.ctx.getOsUserInfoForWs = function () { return { uid: 4242 }; };
  f.ctx.fsAsUser = function () { throw new Error("Permission denied"); };
  f.ctx.BINARY_EXTS = new Set();
  f.ctx.IMAGE_EXTS = new Set();
  f.ctx.IGNORED_DIRS = new Set();
  f.ctx.FS_MAX_SIZE = 1024 * 1024;
  f.handler = attachFilesystem(f.ctx).handleFilesystemMessage;
  f.handler(f.ws, { type: "fs_read", path: "secret.txt", requestId: "denied" });
  assert.match(f.sent[0].error, /Permission denied/);
  f.ctx.getOsUserInfoForWs = function () { return null; };
  f.handler(f.ws, { type: "fs_list", path: "." });
  f.handler(f.ws, { type: "fs_write", path: "secret.txt", content: "nope" });
  assert.match(f.sent[1].error, /OS user identity is unavailable/);
  assert.match(f.sent[2].error, /OS user identity is unavailable/);
});

function session(cwd, id, owner, visibility) {
  return { localId: id, ownerId: owner, sessionVisibility: visibility, title: id,
    history: [{ type: "user_message", text: id + " prompt" },
      { type: "tool_executing", name: "Edit", id: id, input: {
        file_path: path.join(cwd, "file.txt"), old_string: id + " old", new_string: id + " new",
      } }] };
}

test("file history includes only owned or shared sessions; administrators retain access", function (t) {
  var f = fixture(t);
  [["own", "member", "private"], ["shared", "other", "shared"], ["private", "other", "private"],
    ["legacy", null, null]].forEach(function (record) {
    f.ctx.sm.sessions.set(record[0], session(f.ctx.cwd, record[0], record[1], record[2]));
  });
  f.handler(f.ws, { type: "fs_file_history", path: "file.txt" });
  assert.deepEqual(f.sent[0].entries.map(function (entry) { return entry.sessionLocalId; }).sort(), ["own", "shared"]);
  assert.equal(JSON.stringify(f.sent[0]).includes("private old"), false);
  f.user.role = "admin";
  f.handler(f.ws, { type: "fs_file_history", path: "file.txt" });
  assert.equal(f.sent[1].entries.length, 4);
});

test("history rejects escaping paths and Git option injection", function (t) {
  var f = fixture(t);
  [ { path: "../outside" }, { path: "/outside" }, { path: "file.txt", hash: "--output=/tmp/output" } ].forEach(function (input) {
    f.handler(f.ws, Object.assign({ type: "fs_file_at" }, input));
    assert.match(f.sent[f.sent.length - 1].error, /Invalid/);
  });
});

test("unresolved OS identity fails closed before file operations", function (t) {
  var f = fixture(t);
  f.ctx.osUsers = true;
  f.user.linuxUser = "clay-member";
  f.handler(f.ws, { type: "fs_watch", path: "file.txt" });
  assert.deepEqual(f.calls, []);
  assert.match(f.sent[0].error, /identity/);
});
