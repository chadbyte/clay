var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachScheduler = require("../lib/durable-scheduler").attachDurableScheduler;
var createRegistry = require("../lib/scheduler").createLoopRegistry;
var attachSchedule = require("../lib/loop-durable-schedule").attachLoopDurableSchedule;

var roots = [];
var jobIds = 0;
test.after(function () { for (var i = 0; i < roots.length; i++) fs.rmSync(roots[i], { recursive: true, force: true }); });
function root() { var value = fs.mkdtempSync(path.join(os.tmpdir(), "clay-loop-durable-")); roots.push(value); return value; }
function turn() { return new Promise(function (resolve) { setImmediate(resolve); }); }
function engine(dir, now) {
  return attachScheduler({ storageDir: dir, namespace: "test", now: function () { return now.value; }, makeId: function () { jobIds++; return "job-" + jobIds; }, setTimer: function () { return { unref: function () {} }; }, clearTimer: function () {} });
}
function dueRecord(registry, id, dueAt, ownerId) {
  var record = registry.register({ id: id, name: id, task: "run", cron: "* * * * *", enabled: true, ownerId: ownerId || null });
  registry.updateRecord(id, { nextRunAt: dueAt });
  return record;
}

test("one shared engine dispatches durable occurrences for multiple projects and owners", async function () {
  var dir = root(); var now = { value: 1000 }; var scheduler = engine(dir, now); var calls = [];
  var first = createRegistry({ cwd: dir, registryPath: path.join(dir, "first.jsonl"), onTrigger: function (record) { calls.push("first:" + record.ownerId); } }); first.load(); dueRecord(first, "one", 1000, "owner-a");
  var second = createRegistry({ cwd: dir, registryPath: path.join(dir, "second.jsonl"), onTrigger: function (record) { calls.push("second:" + record.ownerId); } }); second.load(); dueRecord(second, "two", 1000, "owner-b");
  var a = attachSchedule({ scheduler: scheduler, registry: first, projectId: "first", isMultiUser: true, authorize: function () { return true; } });
  var b = attachSchedule({ scheduler: scheduler, registry: second, projectId: "second", isMultiUser: true, authorize: function () { return true; } });
  scheduler.start(); scheduler.tick(); await turn(); await turn();
  assert.deepEqual(calls.sort(), ["first:owner-a", "second:owner-b"]);
  assert.equal(scheduler.listJobs().filter(function (job) { return job.execution && job.execution.receipt; }).length, 2);
  a.shutdown(); b.shutdown(); await scheduler.shutdown();
});

test("metadata edits preserve a queued occurrence while disable and delete cancel it", function () {
  var dir = root(); var now = { value: 1000 }; var scheduler = engine(dir, now);
  var registry = createRegistry({ cwd: dir, registryPath: path.join(dir, "registry.jsonl") }); registry.load(); dueRecord(registry, "stable", 5000);
  var service = attachSchedule({ scheduler: scheduler, registry: registry, projectId: "project", isMultiUser: false });
  var original = scheduler.listJobs().filter(function (job) { return job.state === "queued"; })[0];
  registry.update("stable", { name: "Renamed" }); service.sync();
  var afterEdit = scheduler.listJobs().filter(function (job) { return job.state === "queued"; })[0];
  assert.equal(afterEdit.id, original.id); assert.equal(afterEdit.runAt, 5000);
  registry.toggleEnabled("stable"); service.sync(); assert.equal(scheduler.getJob(original.id).state, "cancelled");
  registry.toggleEnabled("stable"); service.sync(); var replacement = scheduler.listJobs().filter(function (job) { return job.state === "queued"; })[0];
  registry.remove("stable"); service.sync(); assert.equal(scheduler.getJob(replacement.id).state, "cancelled");
  service.shutdown(); scheduler.shutdown();
});

test("ownerless multi-user records fail closed with an explicit setup marker", function () {
  var dir = root(); var now = { value: 1000 }; var scheduler = engine(dir, now);
  var registry = createRegistry({ cwd: dir, registryPath: path.join(dir, "registry.jsonl") }); registry.load(); dueRecord(registry, "ownerless", 1000);
  var service = attachSchedule({ scheduler: scheduler, registry: registry, projectId: "project", isMultiUser: true, authorize: function () { return true; } });
  var record = registry.getById("ownerless");
  assert.equal(record.enabled, false); assert.equal(record.needsOwner, true); assert.equal(record.setupRequired, "owner");
  assert.equal(scheduler.listJobs().filter(function (job) { return job.state === "queued"; }).length, 0);
  service.shutdown(); scheduler.shutdown();
});

test("busy legacy work stays durably queued and dispatches once eligible", async function () {
  var dir = root(); var now = { value: 1000 }; var scheduler = engine(dir, now); var busy = true; var calls = 0;
  var registry = createRegistry({ cwd: dir, registryPath: path.join(dir, "registry.jsonl"), onTrigger: function () { calls++; } }); registry.load(); dueRecord(registry, "busy", 1000);
  var service = attachSchedule({ scheduler: scheduler, registry: registry, projectId: "project", isMultiUser: false, canRun: function () { return !busy; } });
  scheduler.start(); scheduler.tick(); await turn(); assert.equal(calls, 0); assert.equal(scheduler.listJobs()[0].state, "queued");
  busy = false; scheduler.tick(); await turn(); await turn(); assert.equal(calls, 1); assert.equal(scheduler.listJobs()[0].state, "completed");
  service.shutdown(); scheduler.shutdown();
});

test("a biweekly schedule rule advances from its anchor and persists start counts", async function (t) {
  var originalNow = Date.now;
  var dueAt = new Date(2028, 0, 5, 9, 0, 0).getTime();
  var now = { value: dueAt + 1000 };
  Date.now = function () { return now.value; };
  t.after(function () { Date.now = originalNow; });
  var dir = root(); var scheduler = engine(dir, now); var calls = 0;
  var registry = createRegistry({ cwd: dir, registryPath: path.join(dir, "registry.jsonl"), onTrigger: function () { calls++; } }); registry.load();
  var rule = { version: 1, timezone: "server-local", anchorDate: "2028-01-03", time: "09:00", recurrence: { every: 2, unit: "week", weekdays: [1, 3] } };
  var record = registry.register({ id: "biweekly", name: "Biweekly", task: "run", scheduleRule: rule, date: rule.anchorDate, time: rule.time, enabled: true });
  registry.updateRecord(record.id, { nextRunAt: dueAt });
  var service = attachSchedule({ scheduler: scheduler, registry: registry, projectId: "project", isMultiUser: false });
  scheduler.start(); scheduler.tick(); await turn(); await turn();
  assert.equal(calls, 1); assert.equal(record.scheduleStartCount, 1);
  assert.equal(record.nextRunAt, new Date(2028, 0, 17, 9, 0, 0).getTime());
  service.shutdown(); scheduler.shutdown();
});

test("a persisted queued occurrence survives engine and registry restart", async function () {
  var dir = root(); var now = { value: 1000 }; var firstEngine = engine(dir, now); var registryPath = path.join(dir, "registry.jsonl");
  var firstRegistry = createRegistry({ cwd: dir, registryPath: registryPath }); firstRegistry.load(); dueRecord(firstRegistry, "restart", 1000);
  var firstService = attachSchedule({ scheduler: firstEngine, registry: firstRegistry, projectId: "project", isMultiUser: false }); firstService.shutdown(); await firstEngine.shutdown();
  var secondEngine = engine(dir, now); var calls = 0; var secondRegistry = createRegistry({ cwd: dir, registryPath: registryPath, onTrigger: function () { calls++; } }); secondRegistry.load();
  var secondService = attachSchedule({ scheduler: secondEngine, registry: secondRegistry, projectId: "project", isMultiUser: false }); secondEngine.start(); secondEngine.tick(); await turn(); await turn();
  assert.equal(calls, 1); assert.equal(secondEngine.listJobs()[0].state, "completed");
  secondService.shutdown(); secondEngine.shutdown();
});

test("a running occurrence ignores harmless revision changes without a duplicate idempotency conflict", async function () {
  var dir = root(); var now = { value: 1000 }; var scheduler = engine(dir, now); var calls = 0;
  var registry = createRegistry({ cwd: dir, registryPath: path.join(dir, "registry.jsonl"), onTrigger: function () { calls++; } }); registry.load(); dueRecord(registry, "running-edit", 1000);
  var service = attachSchedule({ scheduler: scheduler, registry: registry, projectId: "project", isMultiUser: false });
  scheduler.start();
  assert.equal(scheduler.listJobs()[0].state, "running");
  assert.doesNotThrow(function () { registry.updateRecord("running-edit", { name: "Renamed while claimed" }); });
  assert.equal(scheduler.listJobs().filter(function (job) { return job.payload.occurrenceAt === 1000; }).length, 1);
  await turn(); await turn(); assert.equal(calls, 1);
  service.shutdown(); scheduler.shutdown();
});

test("an interrupted ledger occurrence is consumed before its successor is enqueued", async function () {
  var dir = root(); var now = { value: 1000 }; var registryPath = path.join(dir, "registry.jsonl"); var calls = 0;
  var firstEngine = engine(dir, now); var firstRegistry = createRegistry({ cwd: dir, registryPath: registryPath, onTrigger: function () { calls++; } }); firstRegistry.load(); dueRecord(firstRegistry, "interrupted", 1000);
  var firstService = attachSchedule({ scheduler: firstEngine, registry: firstRegistry, projectId: "project", isMultiUser: false }); firstEngine.start();
  assert.equal(firstEngine.listJobs()[0].state, "running");
  await firstEngine.shutdown(); firstService.shutdown();
  var secondEngine = engine(dir, now); var secondRegistry = createRegistry({ cwd: dir, registryPath: registryPath, onTrigger: function () { calls++; } }); secondRegistry.load();
  var secondService = attachSchedule({ scheduler: secondEngine, registry: secondRegistry, projectId: "project", isMultiUser: false });
  assert.equal(calls, 0); assert.equal(secondEngine.listJobs()[0].state, "interrupted");
  assert.notEqual(secondRegistry.getById("interrupted").nextRunAt, 1000);
  assert.equal(secondEngine.listJobs().filter(function (job) { return job.state === "queued"; }).length, 1);
  secondService.shutdown(); secondEngine.shutdown();
});

test("restart after registry advance but before engine settlement keeps only the persisted successor", async function () {
  var dir = root(); var now = { value: 1000 }; var registryPath = path.join(dir, "registry.jsonl"); var calls = 0; var firstEngine = engine(dir, now);
  var firstRegistry = createRegistry({
    cwd: dir, registryPath: registryPath,
    onTrigger: function () { calls++; firstEngine.shutdown(); },
  });
  firstRegistry.load(); dueRecord(firstRegistry, "advance-crash", 1000);
  var firstService = attachSchedule({ scheduler: firstEngine, registry: firstRegistry, projectId: "project", isMultiUser: false });
  firstEngine.start(); await turn(); await turn();
  var advancedAt = firstRegistry.getById("advance-crash").nextRunAt;
  assert.equal(calls, 1); assert.notEqual(advancedAt, 1000); assert.equal(firstEngine.listJobs()[0].state, "interrupted");
  firstService.shutdown();

  var secondEngine = engine(dir, now); var secondRegistry = createRegistry({ cwd: dir, registryPath: registryPath, onTrigger: function () { calls++; } }); secondRegistry.load();
  var secondService = attachSchedule({ scheduler: secondEngine, registry: secondRegistry, projectId: "project", isMultiUser: false });
  var queued = secondEngine.listJobs().filter(function (job) { return job.state === "queued"; });
  assert.equal(queued.length, 1); assert.equal(queued[0].payload.occurrenceAt, advancedAt);
  assert.equal(secondEngine.listJobs().filter(function (job) { return job.payload.occurrenceAt === 1000; }).length, 1);
  secondService.shutdown(); secondEngine.shutdown();
});

test("durable sync applies the overdue rule cutoff before enqueueing", function (t) {
  var originalNow = Date.now; var dir = root(); var registryPath = path.join(dir, "registry.jsonl");
  var now = { value: new Date(2099, 0, 5, 8, 59, 0).getTime() };
  Date.now = function () { return now.value; };
  t.after(function () { Date.now = originalNow; });
  var scheduler = engine(dir, now); var calls = 0;
  var registry = createRegistry({ cwd: dir, registryPath: registryPath, onTrigger: function () { calls++; } }); registry.load();
  var rule = { version: 1, timezone: "server-local", anchorDate: "2099-01-05", time: "09:00", recurrence: { every: 1, unit: "day" }, recurrenceEnd: { type: "until", date: "2099-01-05" }, interval: { every: 30, unit: "minute", end: { type: "until", time: "09:45" } } };
  var record = registry.register({ id: "overdue-cutoff", name: "Overdue", task: "run", source: "schedule", scheduleRule: rule, date: rule.anchorDate, time: rule.time, enabled: true });
  now.value = new Date(2099, 0, 5, 10, 0, 0).getTime();
  var service = attachSchedule({ scheduler: scheduler, registry: registry, projectId: "project", isMultiUser: false });
  assert.equal(calls, 0); assert.equal(record.enabled, false); assert.equal(record.nextRunAt, null);
  assert.equal(scheduler.listJobs().filter(function (job) { return job.state === "queued"; }).length, 0);
  service.shutdown(); scheduler.shutdown();
});

test("registry updates roll back when durable job persistence fails", function () {
  var dir = root(); var now = { value: 1000 }; var registryPath = path.join(dir, "registry.jsonl"); var stored = { version: 1, namespace: "test", jobs: [] }; var failWrites = false; var service;
  var store = {
    load: function () { return JSON.parse(JSON.stringify(stored)); },
    save: function (data) { if (failWrites) throw new Error("injected durable write failure"); stored = JSON.parse(JSON.stringify(data)); },
    close: function () {},
  };
  var scheduler = attachScheduler({ store: store, namespace: "test", now: function () { return now.value; }, makeId: function () { jobIds++; return "job-" + jobIds; }, setTimer: function () { return { unref: function () {} }; }, clearTimer: function () {} });
  var calls = 0;
  var registry = createRegistry({ cwd: dir, registryPath: registryPath, onTrigger: function () { calls++; }, onChange: function () { if (service) service.sync(); } }); registry.load();
  var record = dueRecord(registry, "rollback-sync", 5000); service = attachSchedule({ scheduler: scheduler, registry: registry, projectId: "project", isMultiUser: false });
  var oldRevision = record.updatedAt; failWrites = true;
  var result = registry.update(record.id, { name: "Must roll back" });
  var diskRecord = JSON.parse(fs.readFileSync(registryPath, "utf8").trim());
  assert.equal(result, null); assert.equal(record.name, "rollback-sync"); assert.equal(record.updatedAt, oldRevision); assert.equal(diskRecord.name, "rollback-sync");
  assert.match(registry.getLastSaveError(), /durable synchronization failed/); assert.equal(calls, 0);
  service.shutdown(); scheduler.shutdown();
});

test("pause, resume, delete, and recreate at the same due time use new occurrence identities", function () {
  var dir = root(); var now = { value: 1000 }; var scheduler = engine(dir, now); var registryPath = path.join(dir, "registry.jsonl");
  var registry = createRegistry({ cwd: dir, registryPath: registryPath }); registry.load();
  var first = registry.register({ id: "lifecycle", name: "Once", task: "run", source: "schedule", date: "1970-01-01", time: "00:00", enabled: true }); registry.updateRecord(first.id, { nextRunAt: 5000, enabled: true });
  var service = attachSchedule({ scheduler: scheduler, registry: registry, projectId: "project", isMultiUser: false });
  var firstJob = scheduler.listJobs().filter(function (job) { return job.state === "queued"; })[0];
  registry.toggleEnabled(first.id); registry.toggleEnabled(first.id); registry.updateRecord(first.id, { nextRunAt: 5000 }); service.sync();
  var resumed = scheduler.listJobs().filter(function (job) { return job.state === "queued"; })[0];
  assert.notEqual(resumed.idempotencyKey, firstJob.idempotencyKey); assert.equal(scheduler.getJob(firstJob.id).state, "cancelled");
  registry.remove(first.id);
  var recreated = registry.register({ id: "lifecycle", name: "Recreated", task: "run", source: "schedule", date: "1970-01-01", time: "00:00", enabled: true }); registry.updateRecord(recreated.id, { nextRunAt: 5000, enabled: true }); service.sync();
  var latest = scheduler.listJobs().filter(function (job) { return job.state === "queued"; })[0];
  assert.notEqual(latest.idempotencyKey, resumed.idempotencyKey); assert.equal(scheduler.getJob(resumed.id).state, "cancelled");
  service.shutdown(); scheduler.shutdown();
});

test("null nextRunAt never creates a due-zero job and live multi-user mode revokes the local sentinel", function () {
  var dir = root(); var now = { value: 1000 }; var scheduler = engine(dir, now); var multiUser = false;
  var registry = createRegistry({ cwd: dir, registryPath: path.join(dir, "registry.jsonl") }); registry.load(); var record = dueRecord(registry, "mode-change", 5000);
  var service = attachSchedule({ scheduler: scheduler, registry: registry, projectId: "project", isMultiUser: function () { return multiUser; }, authorize: function () { return true; } });
  var localJob = scheduler.listJobs().filter(function (job) { return job.state === "queued"; })[0]; assert.equal(localJob.ownerId, "local-user");
  multiUser = true; service.sync(); assert.equal(scheduler.getJob(localJob.id).state, "cancelled"); assert.equal(record.needsOwner, true); assert.equal(record.nextRunAt, null);
  service.sync(); assert.equal(scheduler.listJobs().some(function (job) { return job.state === "queued" && job.runAt === 0; }), false);
  service.shutdown(); scheduler.shutdown();
});
