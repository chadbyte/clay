var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var home = fs.mkdtempSync(path.join(os.tmpdir(), "clay-transport-"));
process.env.HOME = home;
process.env.CLAY_HOME = path.join(home, ".clay");
var attach = require("../lib/yoke/claude-worker-startup").attachWorkerStartup;
var kit = require("../lib/yoke/adapters/claude").contractTestKit;
test.after(function() { fs.rmSync(home, { recursive: true, force: true }); });

function startup() {
  var timeout;
  var cancelled = 0;
  var killed = 0;
  var worker = { kill: function() { killed++; } };
  attach(worker, { setTimeout: function(fn, ms) { assert.equal(ms, 180000); timeout = fn; return 1; }, clearTimeout: function() { cancelled++; } });
  return { worker: worker, timeout: function() { timeout(); }, cancelled: function() { return cancelled; }, killed: function() { return killed; } };
}

test("worker startup settles on readiness and cancels its deadline", async function() {
  var fixture = startup();
  fixture.worker._readyResolve();
  await fixture.worker.readyPromise;
  assert.equal(fixture.cancelled(), 1);
  assert.equal(fixture.worker._readyReject, null);
});
test("worker startup exit/error rejects rather than leaving createQuery pending", async function() {
  var fixture = startup();
  fixture.worker._readyReject(new Error("Worker exited before ready"));
  await assert.rejects(fixture.worker.readyPromise, /exited before ready/);
  assert.equal(fixture.cancelled(), 1);
});
test("silent startup has a bounded deadline and terminates its worker", async function() {
  var fixture = startup();
  fixture.timeout();
  await assert.rejects(fixture.worker.readyPromise, /startup deadline/);
  assert.equal(fixture.killed(), 1);
});

test("in-process recovery waits for SDK termination, not close or cancellation request", async function() {
  var finish;
  var controller = new AbortController();
  var raw = { close: function() {}, [Symbol.asyncIterator]: function() { return { next: function() { return new Promise(function(resolve) { finish = resolve; }); } }; } };
  var handle = kit.createQueryHandle(raw, kit.createMessageQueue(), controller);
  var next = handle[Symbol.asyncIterator]().next();
  var settled = false;
  var stopped = handle.stopAndWait().then(function() { settled = true; });
  handle.close();
  await Promise.resolve();
  assert.equal(controller.signal.aborted, true);
  assert.equal(settled, false);
  finish({ done: true });
  await next;
  await stopped;
  assert.equal(settled, true);
});

test("worker recovery waits for termination acknowledgement, ignoring local iterator closure", async function() {
  var receive;
  var resolveExit;
  var timer;
  var worker = { process: { killed: false, exitCode: null }, send: function() { return true; }, onMessage: function(fn) { receive = fn; }, exitPromise: new Promise(function(resolve) { resolveExit = resolve; }) };
  var handle = kit.createWorkerQueryHandle(worker);
  var settled = false;
  var stopped = handle.stopAndWait().then(function() { settled = true; });
  timer = worker._abortTimeout;
  handle.close();
  await Promise.resolve();
  assert.equal(settled, false);
  receive({ type: "query_error", error: "socket lost", _fallback: true });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveExit();
  await stopped;
  clearTimeout(timer);
  assert.equal(settled, true);
});

test("worker query completion acknowledges safe stop without waiting for reusable process exit", async function() {
  var receive;
  var worker = { process: { killed: false, exitCode: null }, send: function() { return true; }, onMessage: function(fn) { receive = fn; }, exitPromise: new Promise(function() {}) };
  var handle = kit.createWorkerQueryHandle(worker);
  var stopped = handle.stopAndWait();
  receive({ type: "query_done" });
  await stopped;
  assert.equal(worker._abortTimeout, null, "completed abort must not kill a reused worker later");
});

test("in-process rejected SDK iteration also confirms execution termination", async function() {
  var fail;
  var raw = { [Symbol.asyncIterator]: function() { return { next: function() { return new Promise(function(resolve, reject) { fail = reject; }); } }; } };
  var handle = kit.createQueryHandle(raw, kit.createMessageQueue(), new AbortController());
  var next = handle[Symbol.asyncIterator]().next();
  var rejected = assert.rejects(next, /SDK stopped/);
  var stopped = handle.stopAndWait();
  fail(new Error("SDK stopped"));
  await rejected;
  await stopped;
});
