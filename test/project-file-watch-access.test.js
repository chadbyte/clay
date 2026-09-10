var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachFileWatch = require("../lib/project-file-watch").attachFileWatch;

function fixture(t) {
  var cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-watch-access-")));
  var client = { id: "member" };
  var allowed = true;
  var identity = { uid: 1234, gid: 1234 };
  var denyRead = false;
  var messages = [];
  var broadcasts = [];
  var operations = [];
  var waiters = [];
  var watcher = attachFileWatch({
    cwd: cwd, FS_MAX_SIZE: 1024, BINARY_EXTS: new Set(), IGNORED_DIRS: new Set(),
    safePath: function (root, rel) {
      var resolved = fs.realpathSync(path.resolve(root, rel));
      return resolved === root || resolved.indexOf(root + path.sep) === 0 ? resolved : null;
    },
    requestAccess: {
      canUseFiles: function (ws) { return ws === client && allowed; },
      osIdentity: function () { if (!identity) throw new Error("identity unavailable"); return identity; },
    },
    fsAsUser: function (op, args, info) {
      operations.push({ op: op, info: info });
      if (denyRead) throw new Error("EACCES");
      if (op === "stat") return fs.statSync(args.file);
      if (op === "read") return { content: fs.readFileSync(args.file, "utf8"), size: fs.statSync(args.file).size };
      return fs.readdirSync(args.dir).map(function (name) { return { name: name, isDir: false }; });
    },
    send: function (msg) { broadcasts.push(msg); },
    sendTo: function (ws, msg) {
      assert.equal(ws, client);
      messages.push(msg);
      waiters.forEach(function (resolve) { resolve(msg); });
      waiters = [];
    },
  });
  t.after(function () {
    watcher.stopFileWatch();
    watcher.stopAllDirWatches();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  return { cwd: cwd, client: client, watcher: watcher, messages: messages, broadcasts: broadcasts, operations: operations,
    revoke: function () { allowed = false; },
    loseIdentity: function () { identity = null; },
    denyRead: function () { denyRead = true; },
    nextMessage: function () { return new Promise(function (resolve) { waiters.push(resolve); }); },
  };
}

function waitForReconciliation() {
  return new Promise(function (resolve) { setTimeout(resolve, 1250); });
}

test("watcher reads use requester OS identity and never broadcast file contents", { timeout: 5000 }, async function (t) {
  var f = fixture(t);
  fs.writeFileSync(path.join(f.cwd, "file.txt"), "initial");
  assert.equal(await f.watcher.startFileWatch(f.client, "file.txt"), true);
  var next = f.nextMessage();
  fs.writeFileSync(path.join(f.cwd, "file.txt"), "changed");
  assert.equal((await next).content, "changed");
  assert.ok(f.operations.some(function (op) { return op.op === "read" && op.info.uid === 1234; }));
  assert.deepEqual(f.broadcasts, []);
});

test("active watcher stops sending after permission revocation", { timeout: 5000 }, async function (t) {
  var f = fixture(t);
  fs.writeFileSync(path.join(f.cwd, "file.txt"), "initial");
  assert.equal(await f.watcher.startFileWatch(f.client, "file.txt"), true);
  f.revoke();
  fs.writeFileSync(path.join(f.cwd, "file.txt"), "secret");
  await waitForReconciliation();
  assert.deepEqual(f.messages, []);
});

test("watcher refuses denied OS reads and missing identity without daemon fallback", async function (t) {
  var f = fixture(t);
  fs.writeFileSync(path.join(f.cwd, "file.txt"), "daemon-readable");
  f.denyRead();
  assert.equal(await f.watcher.startFileWatch(f.client, "file.txt"), false);
  f.loseIdentity();
  assert.equal(await f.watcher.startFileWatch(f.client, "file.txt"), false);
  assert.deepEqual(f.messages, []);
});

test("watcher revalidates paths after a file becomes an escaping symlink", { timeout: 5000 }, async function (t) {
  var f = fixture(t);
  var outside = fs.mkdtempSync(path.join(os.tmpdir(), "clay-watch-outside-"));
  t.after(function () { fs.rmSync(outside, { recursive: true, force: true }); });
  var file = path.join(f.cwd, "file.txt");
  fs.writeFileSync(file, "initial");
  fs.writeFileSync(path.join(outside, "secret"), "outside secret");
  assert.equal(await f.watcher.startFileWatch(f.client, "file.txt"), true);
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(outside, "secret"), file);
  await waitForReconciliation();
  assert.deepEqual(f.messages, []);
});

test("directory updates reach only their subscriber and stop on revocation", { timeout: 5000 }, async function (t) {
  var f = fixture(t);
  var directoryChanged;
  t.mock.method(fs, "watch", function (dir, callback) {
    directoryChanged = callback;
    return { on: function () {}, close: function () {} };
  });
  f.watcher.startDirWatch(f.client, ".");
  var next = f.nextMessage();
  fs.writeFileSync(path.join(f.cwd, "one.txt"), "one");
  directoryChanged();
  var message = await next;
  assert.equal(message.type, "fs_dir_changed");
  assert.equal(message.entries[0].name, "one.txt");
  assert.deepEqual(f.broadcasts, []);
  var count = f.messages.length;
  f.revoke();
  fs.writeFileSync(path.join(f.cwd, "two.txt"), "two");
  directoryChanged();
  await waitForReconciliation();
  assert.equal(f.messages.length, count);
});
