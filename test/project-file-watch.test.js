var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachFileWatch = require("../lib/project-file-watch").attachFileWatch;

function createFixture(t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-file-watch-"));
  var messages = new Map();
  var messageWaiters = new Map();
  var watcher = attachFileWatch({
    cwd: cwd,
    send: function () {},
    sendTo: function (client, message) {
      var list = messages.get(client) || [];
      list.push(message);
      messages.set(client, list);
      var waiters = messageWaiters.get(client) || [];
      for (var i = waiters.length - 1; i >= 0; i--) {
        if (!waiters[i].check(message)) continue;
        var resolve = waiters[i].resolve;
        waiters.splice(i, 1);
        resolve(message);
      }
    },
    safePath: function (root, relPath) {
      var resolved = path.resolve(root, relPath);
      if (resolved !== root && resolved.indexOf(root + path.sep) !== 0) return null;
      return resolved;
    },
    BINARY_EXTS: new Set(),
    FS_MAX_SIZE: 1024 * 1024,
    IGNORED_DIRS: new Set(),
  });
  t.after(function () {
    watcher.stopFileWatch();
    watcher.stopAllDirWatches();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  function waitForMessage(client, check) {
    var existing = messages.get(client) || [];
    for (var i = 0; i < existing.length; i++) {
      if (check(existing[i])) return Promise.resolve(existing[i]);
    }
    return new Promise(function (resolve) {
      var waiters = messageWaiters.get(client) || [];
      waiters.push({ check: check, resolve: resolve });
      messageWaiters.set(client, waiters);
    });
  }
  return { cwd: cwd, messages: messages, watcher: watcher, waitForMessage: waitForMessage };
}

function replaceFile(cwd, name, content) {
  var tempPath = path.join(cwd, name + ".tmp");
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, path.join(cwd, name));
}

test("file watch survives repeated atomic replacements", { timeout: 15000 }, async function (t) {
  var fixture = createFixture(t);
  var client = {};
  fs.writeFileSync(path.join(fixture.cwd, "document.md"), "one", "utf8");
  assert.strictEqual(await fixture.watcher.startFileWatch(client, "document.md"), true);

  var two = fixture.waitForMessage(client, function (message) { return message.content === "two"; });
  replaceFile(fixture.cwd, "document.md", "two");
  await two;

  var three = fixture.waitForMessage(client, function (message) { return message.content === "three"; });
  replaceFile(fixture.cwd, "document.md", "three");
  await three;
});

test("file watches remain isolated per browser client", { timeout: 15000 }, async function (t) {
  var fixture = createFixture(t);
  var firstClient = {};
  var secondClient = {};
  fs.writeFileSync(path.join(fixture.cwd, "first.md"), "first", "utf8");
  fs.writeFileSync(path.join(fixture.cwd, "second.md"), "second", "utf8");
  var ready = await Promise.all([
    fixture.watcher.startFileWatch(firstClient, "first.md"),
    fixture.watcher.startFileWatch(secondClient, "second.md"),
  ]);
  assert.deepStrictEqual(ready, [true, true]);

  var firstUpdate = fixture.waitForMessage(firstClient, function (message) { return message.path === "first.md"; });
  var secondUpdate = fixture.waitForMessage(secondClient, function (message) { return message.path === "second.md"; });
  fs.writeFileSync(path.join(fixture.cwd, "first.md"), "first updated", "utf8");
  fs.writeFileSync(path.join(fixture.cwd, "second.md"), "second updated", "utf8");
  await Promise.all([firstUpdate, secondUpdate]);

  assert.deepStrictEqual((fixture.messages.get(firstClient) || []).map(function (message) {
    return message.path;
  }), ["first.md"]);
  assert.deepStrictEqual((fixture.messages.get(secondClient) || []).map(function (message) {
    return message.path;
  }), ["second.md"]);
});

test('one socket keeps bounded independent instance watches and releases only the exact receipt', { timeout: 15000 }, async function (t) {
  var f = createFixture(t), client = {}, foreign = {};
  fs.writeFileSync(path.join(f.cwd, 'a.md'), 'a'); fs.writeFileSync(path.join(f.cwd, 'b.md'), 'b');
  assert.equal(await f.watcher.startFileWatch(client, 'a.md', { instanceId: 'pane-a', requestId: 'read-a' }), true);
  assert.equal(await f.watcher.startFileWatch(client, 'b.md', { instanceId: 'pane-b', requestId: 'read-b' }), true);
  f.watcher.stopFileWatch(foreign, { instanceId: 'pane-a', requestId: 'read-a' });
  var a = f.waitForMessage(client, function (msg) { return msg.instanceId === 'pane-a' && msg.content === 'a2'; });
  fs.writeFileSync(path.join(f.cwd, 'a.md'), 'a2'); assert.equal((await a).requestId, 'read-a');
  assert.equal(await f.watcher.startFileWatch(client, 'b.md', { instanceId: 'pane-b', requestId: 'read-b2' }), true);
  f.watcher.stopFileWatch(client, { instanceId: 'pane-b', requestId: 'read-b' });
  f.watcher.stopFileWatch(client, { instanceId: 'pane-a', requestId: 'read-a' });
  var b = f.waitForMessage(client, function (msg) { return msg.instanceId === 'pane-b' && msg.content === 'b2'; });
  fs.writeFileSync(path.join(f.cwd, 'a.md'), 'a3'); fs.writeFileSync(path.join(f.cwd, 'b.md'), 'b2');
  assert.equal((await b).requestId, 'read-b2');
  for (var i = 0; i < 7; i++) assert.equal(await f.watcher.startFileWatch(client, 'a.md', { instanceId: 'extra-' + i, requestId: 'r' }), true);
  assert.equal(await f.watcher.startFileWatch(client, 'a.md', { instanceId: 'overflow', requestId: 'r' }), false);
  assert.equal(await f.watcher.startFileWatch(client, 'a.md', { instanceId: '../bad', requestId: 'r' }), false);
  await new Promise(function (resolve) { setTimeout(resolve, 1100); });
  assert.ok(!(f.messages.get(client) || []).some(function (msg) { return msg.instanceId === 'pane-a' && msg.content === 'a3'; }));
  f.watcher.stopFileWatch(client);
});
