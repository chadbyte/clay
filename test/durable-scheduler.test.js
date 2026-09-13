var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachScheduler = require("../lib/durable-scheduler").attachDurableScheduler;
var attachStore = require("../lib/durable-scheduler-store").attachDurableSchedulerStore;

var roots = [];
var idCounter = 0;

test.after(function () {
  for (var i = 0; i < roots.length; i++) fs.rmSync(roots[i], { recursive: true, force: true });
});

function tempRoot() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-durable-scheduler-"));
  roots.push(root);
  return root;
}

function create(root, options) {
  options = options || {};
  return attachScheduler({
    storageDir: root,
    namespace: options.namespace || "test",
    now: options.now || function () { return 100000; },
    makeId: function () { idCounter++; return "id-" + idCounter; },
    globalConcurrency: options.globalConcurrency,
    perOwnerConcurrency: options.perOwnerConcurrency,
    maxTimerDelay: options.maxTimerDelay,
    setTimer: options.setTimer || function () { return { unref: function () {} }; },
    clearTimer: options.clearTimer || function () {},
    store: options.store,
  });
}

function spec(key, owner, overrides) {
  return Object.assign({
    type: "test",
    idempotencyKey: key,
    ownerId: owner || "owner-a1",
    projectId: "project-a",
    target: { kind: "session", id: "session-a" },
    payload: { text: key },
    runAt: 100000,
  }, overrides || {});
}

function turn() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

test("queued jobs and idempotency survive restart", function () {
  var root = tempRoot();
  var first = create(root);
  var original = first.enqueue(spec("once", null, { runAt: 200000 }));
  assert.strictEqual(first.enqueue(spec("once", null, { runAt: 200000 })).id, original.id);
  assert.throws(function () { first.enqueue(spec("once", null, { runAt: 300000 })); }, /different job data/);
  assert.throws(function () { first.enqueue(spec("once", "another-owner", { runAt: 200000 })); }, /different job data/);
  first.shutdown();

  var second = create(root);
  assert.strictEqual(second.getJob(original.id).state, "queued");
  assert.strictEqual(second.getJob(original.id).runAt, 200000);
  second.shutdown();
});

test("cancel and replace only mutate queued jobs atomically", function () {
  var scheduler = create(tempRoot());
  var replaced = scheduler.enqueue(spec("replace-me", null, { runAt: 200000 }));
  var updated = scheduler.replaceQueued(replaced.id, { runAt: 300000, payload: { text: "new" } });
  assert.strictEqual(updated.id, replaced.id);
  assert.strictEqual(updated.runAt, 300000);
  assert.deepStrictEqual(updated.payload, { text: "new" });
  var cancelled = scheduler.cancel(replaced.id, "user request");
  assert.strictEqual(cancelled.state, "cancelled");
  assert.throws(function () { scheduler.replaceQueued(replaced.id, { runAt: 400000 }); }, /Only queued/);
  scheduler.shutdown();
});

test("duplicate ticks never dispatch the same job twice", async function () {
  var scheduler = create(tempRoot());
  var calls = 0;
  var finish;
  scheduler.registerHandler("test", function () {
    calls++;
    return new Promise(function (resolve) { finish = resolve; });
  });
  var job = scheduler.enqueue(spec("duplicate"));
  scheduler.tick();
  scheduler.tick();
  await turn();
  assert.strictEqual(calls, 1);
  assert.strictEqual(scheduler.getJob(job.id).state, "running");
  finish("done");
  await turn();
  assert.strictEqual(scheduler.getJob(job.id).state, "completed");
  scheduler.shutdown();
});

test("handler failures are durable and do not retry", async function () {
  var scheduler = create(tempRoot());
  var calls = 0;
  scheduler.registerHandler("test", function () { calls++; throw new Error("handler broke"); });
  var job = scheduler.enqueue(spec("failure"));
  scheduler.tick();
  await turn();
  assert.strictEqual(scheduler.getJob(job.id).state, "failed");
  assert.match(scheduler.getJob(job.id).execution.error, /handler broke/);
  scheduler.tick();
  assert.strictEqual(calls, 1);
  scheduler.shutdown();
});

test("storage errors fail closed before dispatch", function () {
  var saves = 0;
  var scheduler = create(tempRoot(), {
    store: {
      load: function () { return { version: 1, namespace: "test", jobs: [] }; },
      save: function () { saves++; throw new Error("disk unavailable"); },
      close: function () {},
    },
  });
  var calls = 0;
  scheduler.registerHandler("test", function () { calls++; });
  assert.throws(function () { scheduler.enqueue(spec("disk")); }, /disk unavailable/);
  assert.strictEqual(calls, 0);
  assert.strictEqual(saves, 1);
  assert.strictEqual(scheduler.status().healthy, false);
  scheduler.shutdown();
});

test("a claim persistence failure prevents handler dispatch", function () {
  var saved = { version: 1, namespace: "test", jobs: [] };
  var fail = false;
  var scheduler = create(tempRoot(), {
    store: {
      load: function () { return JSON.parse(JSON.stringify(saved)); },
      save: function (next) {
        if (fail) throw new Error("claim write failed");
        saved = JSON.parse(JSON.stringify(next));
      },
      close: function () {},
    },
  });
  var calls = 0;
  scheduler.registerHandler("test", function () { calls++; });
  scheduler.enqueue(spec("claim-disk"));
  fail = true;
  assert.throws(function () { scheduler.tick(); }, /claim write failed/);
  assert.strictEqual(calls, 0);
  assert.strictEqual(saved.jobs[0].state, "queued");
  scheduler.shutdown();
});

test("global and per-owner concurrency dispatch owners fairly", async function () {
  var scheduler = create(tempRoot(), { globalConcurrency: 2, perOwnerConcurrency: 1 });
  var started = [];
  var resolvers = {};
  scheduler.registerHandler("test", function (job) {
    started.push(job.idempotencyKey);
    return new Promise(function (resolve) { resolvers[job.idempotencyKey] = resolve; });
  });
  scheduler.enqueue(spec("a1", "owner-a"));
  scheduler.enqueue(spec("a2", "owner-a"));
  scheduler.enqueue(spec("b1", "owner-b"));
  scheduler.tick();
  await turn();
  assert.deepStrictEqual(started.sort(), ["a1", "b1"]);
  resolvers.a1();
  await turn();
  await turn();
  assert.deepStrictEqual(started.sort(), ["a1", "a2", "b1"]);
  resolvers.a2();
  resolvers.b1();
  await turn();
  scheduler.shutdown();
});

test("user-controlled map keys cannot escape handler, owner, or job lookup", async function () {
  var scheduler = create(tempRoot(), { globalConcurrency: 2, perOwnerConcurrency: 1 });
  var calls = [];
  scheduler.registerHandler("__proto__", function (job) { calls.push(job.id); });
  scheduler.registerHandler("constructor", function (job) { calls.push(job.id); });
  scheduler.enqueue(spec("proto-key", "__proto__", { id: "__proto__", type: "__proto__" }));
  scheduler.enqueue(spec("constructor-key", "constructor", { id: "constructor", type: "constructor" }));
  scheduler.tick();
  await turn();
  assert.deepStrictEqual(calls.sort(), ["__proto__", "constructor"]);
  assert.strictEqual(scheduler.getJob("__proto__").state, "completed");
  scheduler.shutdown();
});

test("timers retain the earliest registered deadline when jobs are added", function () {
  var currentTime = 1000;
  var delays = [];
  var scheduler = create(tempRoot(), {
    now: function () { return currentTime; },
    maxTimerDelay: 30000,
    setTimer: function (_callback, delay) {
      delays.push(delay);
      return { unref: function () {} };
    },
  });
  scheduler.registerHandler("test", function () {});
  scheduler.enqueue(spec("later", null, { runAt: 21000 }));
  scheduler.start();
  assert.strictEqual(delays[delays.length - 1], 20000);
  scheduler.enqueue(spec("latest", null, { runAt: 26000 }));
  assert.strictEqual(delays[delays.length - 1], 20000);
  scheduler.enqueue(spec("earliest", null, { runAt: 6000 }));
  assert.strictEqual(delays[delays.length - 1], 5000);
  scheduler.shutdown();
});

test("due jobs do not create a zero-delay timer spin when capacity is full", async function () {
  var delays = [];
  var scheduler = create(tempRoot(), {
    globalConcurrency: 1,
    maxTimerDelay: 30000,
    setTimer: function (_callback, delay) {
      delays.push(delay);
      return { unref: function () {} };
    },
  });
  scheduler.registerHandler("test", function () { return new Promise(function () {}); });
  scheduler.enqueue(spec("capacity-a"));
  scheduler.enqueue(spec("capacity-b", "owner-b"));
  scheduler.start();
  await turn();
  assert.strictEqual(delays[delays.length - 1], 30000);
  scheduler.shutdown();
});

test("ineligible due work remains queued and unclaimed until eligibility changes", async function () {
  var eligible = false;
  var calls = 0;
  var scheduler = create(tempRoot());
  scheduler.registerHandler("test", function () { calls++; }, {
    canRun: function () { return eligible; },
  });
  var job = scheduler.enqueue(spec("eligibility"));
  scheduler.start();
  scheduler.tick();
  await turn();
  assert.strictEqual(calls, 0);
  assert.strictEqual(scheduler.getJob(job.id).state, "queued");
  assert.strictEqual(scheduler.getJob(job.id).execution, null);
  eligible = true;
  scheduler.tick();
  await turn();
  assert.strictEqual(calls, 1);
  assert.strictEqual(scheduler.getJob(job.id).state, "completed");
  scheduler.shutdown();
});

test("eligibility exceptions before claim leave due work queued", async function () {
  var throws = true;
  var calls = 0;
  var scheduler = create(tempRoot());
  scheduler.registerHandler("test", function () { calls++; }, {
    canRun: function () { if (throws) throw new Error("not ready"); return true; },
  });
  var job = scheduler.enqueue(spec("eligibility-error"));
  assert.doesNotThrow(function () { scheduler.start(); });
  assert.strictEqual(scheduler.getJob(job.id).state, "queued");
  assert.strictEqual(scheduler.getJob(job.id).execution, null);
  throws = false;
  scheduler.tick();
  await turn();
  assert.strictEqual(calls, 1);
  assert.strictEqual(scheduler.getJob(job.id).state, "completed");
  scheduler.shutdown();
});

test("eligibility exceptions after claim requeue before handler invocation", async function () {
  var checks = 0;
  var calls = 0;
  var scheduler = create(tempRoot());
  scheduler.registerHandler("test", function () { calls++; }, {
    canRun: function () { checks++; if (checks > 1) throw new Error("became unavailable"); return true; },
  });
  var job = scheduler.enqueue(spec("eligibility-race"));
  scheduler.tick();
  await turn();
  assert.strictEqual(calls, 0);
  assert.ok(checks >= 2);
  assert.strictEqual(scheduler.getJob(job.id).state, "queued");
  assert.strictEqual(scheduler.getJob(job.id).execution, null);
  scheduler.shutdown();
});

test("unregistering a handler before its microtask safely requeues the claim", async function () {
  var scheduler = create(tempRoot());
  var calls = 0;
  var unregister = scheduler.registerHandler("test", function () { calls++; });
  var job = scheduler.enqueue(spec("unregister"));
  scheduler.tick();
  unregister();
  await turn();
  assert.strictEqual(calls, 0);
  assert.strictEqual(scheduler.getJob(job.id).state, "queued");
  scheduler.registerHandler("test", function () { calls++; });
  scheduler.tick();
  await turn();
  assert.strictEqual(calls, 1);
  assert.strictEqual(scheduler.getJob(job.id).state, "completed");
  scheduler.shutdown();
});

test("an unhealthy engine does not invoke a handler already queued as a microtask", async function () {
  var saved = { version: 1, namespace: "test", jobs: [] };
  var fail = false;
  var scheduler = create(tempRoot(), {
    store: {
      load: function () { return JSON.parse(JSON.stringify(saved)); },
      save: function (next) {
        if (fail) throw new Error("late disk failure");
        saved = JSON.parse(JSON.stringify(next));
      },
      close: function () {},
    },
  });
  var calls = 0;
  scheduler.registerHandler("test", function () { calls++; });
  scheduler.enqueue(spec("health-boundary"));
  var future = scheduler.enqueue(spec("health-failure", null, { runAt: 200000 }));
  scheduler.tick();
  fail = true;
  assert.throws(function () { scheduler.cancel(future.id); }, /late disk failure/);
  await turn();
  assert.strictEqual(calls, 0);
  assert.strictEqual(scheduler.status().healthy, false);
  scheduler.shutdown();
});

test("circular and oversized handler results become durable failures", async function () {
  var scheduler = create(tempRoot(), { globalConcurrency: 2, perOwnerConcurrency: 2 });
  scheduler.registerHandler("test", function (job) {
    if (job.idempotencyKey === "circular") {
      var circular = {};
      circular.self = circular;
      return circular;
    }
    return "x".repeat(70 * 1024);
  });
  var circularJob = scheduler.enqueue(spec("circular"));
  var largeJob = scheduler.enqueue(spec("large"));
  scheduler.tick();
  await turn();
  assert.strictEqual(scheduler.getJob(circularJob.id).state, "failed");
  assert.strictEqual(scheduler.getJob(largeJob.id).state, "failed");
  assert.match(scheduler.getJob(circularJob.id).execution.error, /serializable/);
  assert.match(scheduler.getJob(largeJob.id).execution.error, /too large/);
  scheduler.shutdown();
});

test("shutdown marks possibly dispatched work interrupted and restart does not rerun it", async function () {
  var root = tempRoot();
  var first = create(root);
  var calls = 0;
  first.registerHandler("test", function () { calls++; return new Promise(function () {}); });
  var job = first.enqueue(spec("interrupted"));
  first.tick();
  await turn();
  assert.strictEqual(first.getJob(job.id).state, "running");
  await first.shutdown();

  var second = create(root);
  second.registerHandler("test", function () { calls++; });
  second.tick();
  await turn();
  assert.strictEqual(second.getJob(job.id).state, "interrupted");
  assert.strictEqual(calls, 1);
  second.shutdown();
});

test("shutdown before the dispatch microtask prevents handler invocation", async function () {
  var scheduler = create(tempRoot());
  var calls = 0;
  scheduler.registerHandler("test", function () { calls++; });
  var job = scheduler.enqueue(spec("shutdown-boundary"));
  scheduler.tick();
  await scheduler.shutdown();
  await turn();
  assert.strictEqual(calls, 0);
  assert.strictEqual(scheduler.getJob(job.id).state, "interrupted");
});

test("startup conservatively interrupts a persisted claim", function () {
  var root = tempRoot();
  var filePath = path.join(root, "scheduler-test.json");
  var store = attachStore({ filePath: filePath, namespace: "test" });
  store.save({
    version: 1,
    namespace: "test",
    jobs: [{
      id: "claimed-job",
      idempotencyKey: "claimed-key",
      type: "test",
      ownerId: "owner-a",
      projectId: "project-a",
      target: { kind: "session", id: "session-a" },
      payload: null,
      runAt: 100000,
      state: "claimed",
      createdAt: 90000,
      updatedAt: 100000,
      execution: { claimId: "claim-a", claimedAt: 100000 },
    }],
  });
  store.close();
  var scheduler = create(root);
  assert.strictEqual(scheduler.getJob("claimed-job").state, "interrupted");
  assert.strictEqual(scheduler.getJob("claimed-job").execution.interruptionReason, "server_restarted_after_claim");
  scheduler.shutdown();
});

test("missing handlers preserve work and receipts are persisted before completion", async function () {
  var scheduler = create(tempRoot());
  var job = scheduler.enqueue(spec("receipt"));
  scheduler.start();
  assert.strictEqual(scheduler.getJob(job.id).state, "queued");
  scheduler.registerHandler("test", function (_job, execution) {
    execution.recordMetadata({ source: "stage-two" });
    execution.recordReceipt({ sessionId: "session-123" });
    assert.deepStrictEqual(scheduler.getReceipt(job.id), { sessionId: "session-123" });
    return { accepted: true };
  });
  scheduler.tick();
  await turn();
  assert.strictEqual(scheduler.getJob(job.id).state, "completed");
  assert.deepStrictEqual(scheduler.getJob(job.id).execution.metadata, { source: "stage-two" });
  scheduler.shutdown();
});

test("namespaces use isolated stores", function () {
  var root = tempRoot();
  var prod = create(root, { namespace: "prod" });
  var dev = create(root, { namespace: "dev" });
  prod.enqueue(spec("prod-job", null, { runAt: 200000 }));
  dev.enqueue(spec("dev-job", null, { runAt: 200000 }));
  assert.deepStrictEqual(prod.listJobs().map(function (job) { return job.idempotencyKey; }), ["prod-job"]);
  assert.deepStrictEqual(dev.listJobs().map(function (job) { return job.idempotencyKey; }), ["dev-job"]);
  prod.shutdown();
  dev.shutdown();
});
