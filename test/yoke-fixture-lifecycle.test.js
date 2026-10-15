var test = require("node:test");
var assert = require("node:assert/strict");
var EventEmitter = require("node:events");
var stopAndWait = require("./helpers/stop-process-fixture.cjs").stopAndWait;
var liveQuery = require("./helpers/live-query-fixture.cjs");

test("dependency teardown waits for process close before deleting writable storage", async function () {
  var proc = new EventEmitter(); proc.exitCode = null; proc.signalCode = null;
  var events = [];
  var server = { proc: proc, stop: function () {
    events.push("stop-requested"); this.proc = null;
    setImmediate(function () { events.push("last-native-write"); proc.emit("exit", 0); proc.emit("close", 0); });
  } };
  await stopAndWait(server);
  events.push("storage-deleted");
  assert.deepEqual(events, ["stop-requested", "last-native-write", "storage-deleted"]);
  assert.equal(proc.listenerCount("close"), 0);
});
test("unconfirmed dependency shutdown fails and does not delete storage", async function () {
  var proc = new EventEmitter(); proc.exitCode = null; proc.signalCode = null;
  var deleted = false;
  await assert.rejects(stopAndWait({ proc: proc, stop: function () {} }, 10).then(function () { deleted = true; }), /storage retained/);
  assert.equal(deleted, false); assert.equal(proc.listenerCount("close"), 0);
});
test("live query fixtures remain authorized until explicitly closed", async function () {
  var query = liveQuery.create(), settled = false;
  var read = query[Symbol.asyncIterator]().next().then(function (item) { settled = true; return item; });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(settled, false); assert.equal(query.pushMessage("current"), true);
  query.close(); assert.deepEqual(await read, { done: true });
  assert.equal(query.pushMessage("retired"), false);
});

test("Muse fixture snapshots publish atomically and new connections preserve session ownership", function (t) {
  var fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-muse-snapshots-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var createStore = require("./fixtures/muse-session-store.cjs").create;
  var prior = new Map(), observed = 0;
  var owner = createStore(root, { beforeRename: function (file, staged) {
    var ready = fs.readFileSync(staged, "utf8");
    // Pause publication with an empty staged file: readers must still see
    // the complete prior snapshot, never partial bytes from a writer.
    fs.writeFileSync(staged, "");
    if (prior.has(file)) { assert.equal(fs.readFileSync(file, "utf8"), prior.get(file)); observed++; }
    var names = fs.readdirSync(root);
    createStore(root);
    assert.deepEqual(fs.readdirSync(root), names, "a fork helper startup does not truncate or create a session");
    if (prior.has(file)) {
      var id = decodeURIComponent(path.basename(file, ".json"));
      assert.deepEqual(createStore(root).read(id), JSON.parse(prior.get(file)));
    }
    fs.writeFileSync(staged, ready);
    prior.set(file, ready);
  } });
  var id = owner.start();
  var first = { turnId: "one", prompt: "first", answer: "answer one" };
  owner.append(first);
  var title = createStore(root), titleId = title.start();
  assert.notEqual(titleId, id);
  title.append({ turnId: "title", prompt: "title request", answer: "title" });
  assert.deepEqual(title.read(id), [first]);
  var observer = createStore(root);
  assert.throws(function () { observer.append(first); }, /does not own/);
  assert.deepEqual(observer.resume(id), [first]);
  observer.append({ turnId: "two", prompt: "second", answer: "answer two" });
  observer.append(first);
  assert.equal(owner.read(id).length, 2, "resume retains prior turns and repeated completion is idempotent");
  assert.equal(owner.read(titleId).length, 1);
  assert.equal(observed, 1, "controlled delayed publication exercised an existing snapshot");
  assert.equal(fs.readdirSync(root).some(function (name) { return name.endsWith(".tmp"); }), false);
});
