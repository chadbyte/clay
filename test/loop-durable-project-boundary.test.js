var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachScheduler = require("../lib/durable-scheduler").attachDurableScheduler;
var attachLoop = require("../lib/project-loop").attachLoop;

function turn() { return new Promise(function (resolve) { setImmediate(resolve); }); }

function fixture(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-loop-project-boundary-")); var now = { value: 1000 }; var events = []; var sdkCalls = 0;
  var scheduler = attachScheduler({ storageDir: dir, namespace: "test", now: function () { return now.value; }, setTimer: function () { return { unref: function () {} }; }, clearTimer: function () {} });
  var sessions = new Map();
  var sm = { sessions: sessions, setResolveLoopInfo: function () {}, saveSessionFile: function () {}, broadcastSessionList: function () {}, appendToSessionFile: function () {},
    createSession: function (input) { var session = { localId: sessions.size + 1, ownerId: input.ownerId || null, history: [] }; sessions.set(session.localId, session); return session; } };
  var loop = attachLoop({
    cwd: dir, slug: "project-boundary", sm: sm, durableScheduler: scheduler, loopRegistryPath: path.join(dir, "registry.jsonl"), loopStatePath: path.join(dir, "loop-state.json"),
    sdk: { startQuery: function () { sdkCalls++; return Promise.resolve(); } }, send: function (message) { events.push(message); }, sendTo: function () {}, sendToSession: function () {},
    getHubSchedules: function () { return []; }, getLinuxUserForSession: function () { return null; }, onProcessingChanged: function () {}, hydrateImageRefs: function (value) { return value; },
    isMultiUser: function () { return false; }, authorizeScheduledRun: function () { return true; }, canExecuteScheduledTask: function () { return true; },
    prepareScheduledTask: function () { return { ok: true, activeRun: { runId: "reserved", status: "starting", startedAt: now.value } }; },
    executeScheduledTask: function () { return { ok: false, error: "the pair executor refused this run" }; },
  });
  t.after(async function () { loop.stopTimer(); await scheduler.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir: dir, now: now, scheduler: scheduler, loop: loop, events: events, sdkCalls: function () { return sdkCalls; } };
}

test("durable project dispatch records pair refusal and missing legacy prompt as failures", async function (t) {
  var f = fixture(t);
  var pairRecord = f.loop.loopRegistry.register({ id: "refused-pair", name: "Refused pair", task: "Run", cron: "* * * * *", ownerId: null, source: "schedule", createdViaScheduledTasks: true,
    execution: { driver: { vendor: "claude" }, worker: { vendor: "codex" } } });
  f.loop.loopRegistry.updateRecord(pairRecord.id, { nextRunAt: f.now.value });
  var missingPrompt = f.loop.loopRegistry.register({ id: "missing-prompt", name: "Missing prompt", task: "Run", cron: "* * * * *", ownerId: null });
  f.loop.loopRegistry.updateRecord(missingPrompt.id, { nextRunAt: f.now.value });
  f.scheduler.start(); await turn(); await turn();

  var jobs = f.scheduler.listJobs();
  var refusedJob = jobs.find(function (job) { return job.target.id === pairRecord.id && job.payload.occurrenceAt === f.now.value; });
  var missingJob = jobs.find(function (job) { return job.target.id === missingPrompt.id && job.payload.occurrenceAt === f.now.value; });
  assert.equal(refusedJob.state, "failed"); assert.match(refusedJob.execution.error, /pair executor refused/);
  assert.equal(missingJob.state, "failed"); assert.match(missingJob.execution.error, /PROMPT\.md is missing/);
  assert.equal(f.events.filter(function (event) { return event.type === "loop_error"; }).length, 2); assert.equal(f.sdkCalls(), 0);
  assert.equal(jobs.filter(function (job) { return job.target.id === pairRecord.id && job.payload.occurrenceAt === f.now.value; }).length, 1);
  assert.equal(jobs.filter(function (job) { return job.target.id === missingPrompt.id && job.payload.occurrenceAt === f.now.value; }).length, 1);
});
