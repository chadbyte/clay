var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var EventEmitter = require("events");
var attachScheduler = require("../lib/durable-scheduler").attachDurableScheduler;
var attachStore = require("../lib/durable-scheduler-store").attachDurableSchedulerStore;
var attachLifecycle = require("../lib/server-durable-scheduler").attachDurableSchedulerLifecycle;

var roots = [];

test.after(function () {
  for (var i = 0; i < roots.length; i++) fs.rmSync(roots[i], { recursive: true, force: true });
});

function tempRoot() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-durable-scheduler-store-"));
  roots.push(root);
  return root;
}

function spec(key) {
  return {
    type: "test",
    idempotencyKey: key,
    ownerId: "owner-a",
    projectId: "project-a",
    target: { kind: "session", id: "session-a" },
    payload: { text: key },
    runAt: 100000,
  };
}

function create(root, store) {
  return attachScheduler({
    storageDir: root,
    namespace: "test",
    now: function () { return 100000; },
    setTimer: function () { return { unref: function () {} }; },
    clearTimer: function () {},
    store: store,
  });
}

test("store rejects concurrent writers and corrupt data", function () {
  var root = tempRoot();
  var filePath = path.join(root, "queue.json");
  var first = attachStore({ filePath: filePath, namespace: "test" });
  assert.throws(function () { attachStore({ filePath: filePath, namespace: "test" }); }, /already owned/);
  first.close();
  fs.writeFileSync(filePath, "not-json", "utf8");
  var corrupt = attachStore({ filePath: filePath, namespace: "test" });
  assert.throws(function () { corrupt.load(); }, /corrupt or unreadable/);
  corrupt.close();
});

test("invalid saved jobs release the writer lock after constructor failure", function () {
  var root = tempRoot();
  var filePath = path.join(root, "scheduler-test.json");
  var first = Object.assign(spec("saved-a"), { id: "duplicate", state: "queued", createdAt: 90000, updatedAt: 90000, execution: null });
  var second = Object.assign(spec("saved-b"), { id: "duplicate", state: "queued", createdAt: 90000, updatedAt: 90000, execution: null });
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, namespace: "test", jobs: [first, second] }), "utf8");
  assert.throws(function () { create(root); }, /invalid durable data/);
  var store = attachStore({ filePath: filePath, namespace: "test" });
  store.close();
});

test("recovery write failure closes the acquired store", function () {
  var closed = false;
  var claimed = Object.assign(spec("recovery-write"), {
    id: "recovery-write",
    state: "claimed",
    createdAt: 90000,
    updatedAt: 100000,
    execution: { claimId: "claim-recovery", claimedAt: 100000 },
  });
  assert.throws(function () {
    create(tempRoot(), {
      load: function () { return { version: 1, namespace: "test", jobs: [claimed] }; },
      save: function () { throw new Error("recovery disk failure"); },
      close: function () { closed = true; },
    });
  }, /recovery disk failure/);
  assert.strictEqual(closed, true);
});

test("atomic saves sync file and parent directory and recover stale locks", function () {
  var root = tempRoot();
  var filePath = path.join(root, "queue.json");
  var staleLock = filePath + ".lock";
  fs.writeFileSync(staleLock, JSON.stringify({ pid: 99999999, namespace: "test", token: "dead" }), "utf8");
  var fsImpl = Object.create(fs);
  var syncs = 0;
  var directoryOpenAttempts = 0;
  fsImpl.openSync = function (target, flags, mode) {
    if (target === root) directoryOpenAttempts++;
    return fs.openSync(target, flags, mode);
  };
  fsImpl.fsyncSync = function (fd) { syncs++; return fs.fsyncSync(fd); };
  var store = attachStore({ filePath: filePath, namespace: "test", fs: fsImpl });
  store.save({ version: 1, namespace: "test", jobs: [] });
  assert.ok(syncs >= 1);
  assert.strictEqual(directoryOpenAttempts, 1);
  assert.strictEqual(fs.readdirSync(root).filter(function (name) { return name.indexOf(".stale-") !== -1; }).length, 0);
  store.close();
});

test("stale-lock recovery serializes a fresh acquirer during the stale read", function () {
  var root = tempRoot();
  var filePath = path.join(root, "queue.json");
  var lockPath = filePath + ".lock";
  var oldLockText = JSON.stringify({ pid: 99999999, namespace: "test", token: "dead" });
  fs.writeFileSync(lockPath, oldLockText, "utf8");
  var fakeFs = Object.create(fs);
  var innerAcquired = false;
  var outerAcquired = false;
  var interleaved = false;
  fakeFs.readFileSync = function (target, encoding) {
    if (target === lockPath && !interleaved) {
      interleaved = true;
      try {
        var inner = attachStore({ filePath: filePath, namespace: "test" });
        innerAcquired = true;
        inner.close();
      } catch (error) {
        assert.match(error.message, /acquisition is already in progress/);
      }
      return oldLockText;
    }
    return fs.readFileSync(target, encoding);
  };
  var outer = attachStore({ filePath: filePath, namespace: "test", fs: fakeFs });
  outerAcquired = true;
  var concurrentStaleRecoverersBothAcquired = innerAcquired && outerAcquired;
  assert.strictEqual(interleaved, true);
  assert.strictEqual(concurrentStaleRecoverersBothAcquired, false);
  assert.strictEqual(Number(innerAcquired) + Number(outerAcquired), 1);
  assert.throws(function () { attachStore({ filePath: filePath, namespace: "test" }); }, /already owned/);
  outer.close();
});

test("HTTP server close shuts the scheduler down exactly once", async function () {
  var server = new EventEmitter();
  var starts = 0;
  var shutdowns = 0;
  var lifecycle = attachLifecycle({
    server: server,
    scheduler: {
      start: function () { starts++; },
      shutdown: function () { shutdowns++; return Promise.resolve(); },
    },
  });
  assert.strictEqual(starts, 1);
  server.emit("close");
  server.emit("close");
  await lifecycle.shutdown();
  assert.strictEqual(shutdowns, 1);
});
