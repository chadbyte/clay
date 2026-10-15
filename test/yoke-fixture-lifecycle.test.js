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
