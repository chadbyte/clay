var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attachRequestAccess = require("../lib/project-request-access").attachRequestAccess;
var attachFilesystem = require("../lib/project-filesystem").attachFilesystem;
var attachFileHTTP = require("../lib/project-file-http").attachFileHTTP;
var attachFileWatch = require("../lib/project-file-watch").attachFileWatch;

function fixture(t, multiUser) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-file-authority-"));
  var cwd = path.join(root, "project");
  fs.mkdirSync(cwd);
  var external = path.join(root, "personal.md");
  var picture = path.join(root, "personal.png");
  fs.writeFileSync(external, "personal document");
  fs.writeFileSync(picture, "image bytes");
  var user = { id: "user", role: "admin", linuxUser: "mapped" };
  var activeUser = user;
  var allowed = true;
  var sent = [];
  var client = { _clayUser: { id: "user", role: "admin" }, method: "GET" };
  var ctx = {
    cwd: cwd, slug: "project", osUsers: false,
    opts: { canAccessProjectSlug: function () { return allowed; } },
    usersModule: {
      isMultiUser: function () { return multiUser; },
      findUserById: function () { return activeUser; },
      getEffectivePermissions: function () { return { fileBrowser: allowed }; },
    },
    send: function () { throw new Error("Must not broadcast private file content"); },
    sendTo: function (ws, msg) { assert.equal(ws, client); sent.push(msg); },
    getOsUserInfoForWs: function () { return { uid: 4321, gid: 4321 }; },
    sm: { sessions: new Map() }, BINARY_EXTS: new Set(), IMAGE_EXTS: new Set(), IGNORED_DIRS: new Set(), FS_MAX_SIZE: 1024,
  };
  ctx.requestAccess = attachRequestAccess(ctx);
  var watcher = attachFileWatch(ctx);
  Object.assign(ctx, watcher);
  var handler = attachFilesystem(ctx).handleFilesystemMessage;
  var http = attachFileHTTP(ctx).handleHTTP;
  t.after(function () {
    watcher.stopFileWatch(); watcher.stopAllDirWatches();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function request(type, target, extra) {
    handler(client, Object.assign({ type: type, path: target, requestId: "correlated" }, extra));
    return sent[sent.length - 1];
  }
  function get(target, download) {
    var response = { writeHead: function (status) { this.status = status; }, end: function (body) { this.body = body; } };
    http(client, response, (download ? "/api/file/download?path=" : "/api/file?path=") + encodeURIComponent(target));
    return response;
  }
  return { ctx: ctx, client: client, user: user, external: external, picture: picture, sent: sent, request: request, get: get,
    watcher: watcher, revoke: function () { allowed = false; }, removeUser: function () { activeUser = null; } };
}

test("single-user external files open, save, download, preview and update under local OS authority", async function (t) {
  var f = fixture(t, false);
  assert.equal(f.request("fs_read", f.external).content, "personal document");
  assert.equal(f.request("fs_write", f.external, { content: "edited" }).ok, true);
  assert.equal(fs.readFileSync(f.external, "utf8"), "edited");
  assert.equal(f.get(f.external, true).body.toString(), "edited");
  assert.equal(f.get(f.picture, false).body.toString(), "image bytes");
  assert.equal(f.request("fs_list", "..").entries.some(function (entry) { return entry.name === "personal.md"; }), true);
  var changed;
  t.mock.method(fs, "watch", function (dir, callback) {
    changed = callback;
    return { on: function () {}, close: function () {} };
  });
  assert.equal(await f.watcher.startFileWatch(f.client, f.external), true);
  fs.writeFileSync(f.external, "updated");
  changed("change", path.basename(f.external));
  await new Promise(function (resolve) { setTimeout(resolve, 300); });
  assert.equal(f.sent.some(function (msg) { return msg.type === "fs_file_changed" && msg.content === "updated"; }), true);
});

test("unmapped multi-user admins and members cannot access external files or escaping symlinks", function (t) {
  var f = fixture(t, true);
  fs.symlinkSync(f.external, path.join(f.ctx.cwd, "escape.md"));
  ["admin", "member"].forEach(function (role) {
    f.user.role = role;
    [f.external, "../personal.md", "escape.md"].forEach(function (target) {
      assert.equal(f.request("fs_read", target).errorCode, "FILE_SCOPE");
      assert.equal(f.request("fs_write", target, { content: "forbidden" }).errorCode, "FILE_SCOPE");
      assert.equal(f.get(target, true).status, 403);
    });
    assert.equal(f.get(f.picture, false).status, 403);
  });
  assert.equal(fs.readFileSync(f.external, "utf8"), "personal document");
  assert.equal(f.request("fs_read", "missing.md").errorCode, "ENOENT");
  assert.equal(f.get("missing.md", true).status, 404);
});

test("OS denial is distinct from missing files and read access does not imply write access", function (t) {
  var f = fixture(t, false);
  var write = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", function (file, content, options) {
    if (file === f.external) { var denied = new Error("denied"); denied.code = "EACCES"; throw denied; }
    return write(file, content, options);
  });
  assert.equal(f.request("fs_read", f.external).content, "personal document");
  assert.equal(f.request("fs_write", f.external, { content: "no" }).errorCode, "EACCES");
  assert.equal(f.request("fs_read", f.external + ".missing").errorCode, "ENOENT");
  var read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", function (file, options) {
    if (file === f.external) { var denied = new Error("denied"); denied.code = "EACCES"; throw denied; }
    return read(file, options);
  });
  assert.equal(f.get(f.external, true).status, 403);
  assert.match(f.get(f.external, true).body, /operating system denied/);
});

test("mapped OS reads use fresh identity across WS and HTTP and never fall back after identity loss", function (t) {
  var f = fixture(t, true);
  f.ctx.osUsers = true;
  var calls = [];
  f.ctx.fsAsUser = function (operation, args, identity) {
    calls.push({ operation: operation, identity: identity });
    if (operation === "stat") return { size: 6 };
    if (operation === "read") return { content: "mapped" };
    return { buffer: Buffer.from("mapped") };
  };
  var handler = attachFilesystem(f.ctx).handleFilesystemMessage;
  handler(f.client, { type: "fs_read", path: f.external });
  assert.equal(f.sent[f.sent.length - 1].content, "mapped");
  assert.equal(f.get(f.external, true).body.toString(), "mapped");
  calls.forEach(function (call) { assert.equal(call.identity.uid, 4321); });
  var count = calls.length;
  f.user.linuxUser = null;
  handler(f.client, { type: "fs_read", path: f.external });
  assert.equal(f.sent[f.sent.length - 1].errorCode, "OS_IDENTITY");
  assert.equal(f.get(f.external, true).status, 403);
  assert.equal(calls.length, count);
});

test("HTTP revalidates file permission and deleted users rather than cached request roles", function (t) {
  var f = fixture(t, true);
  fs.writeFileSync(path.join(f.ctx.cwd, "file"), "shared");
  assert.equal(f.get("file", true).status, 200);
  f.removeUser();
  assert.equal(f.get("file", true).status, 403);
});
