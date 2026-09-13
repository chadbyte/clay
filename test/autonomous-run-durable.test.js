var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachScheduler = require("../lib/durable-scheduler").attachDurableScheduler;
var helper = require("./helpers/autonomous-run-fixture");
var fixture = helper.fixture; var tick = helper.tick; var arm = helper.arm;

function engine(dir, now) {
  return attachScheduler({ storageDir: dir, namespace: "test", now: now ? function () { return now.value; } : undefined,
    setTimer: function () { return { unref: function () {} }; }, clearTimer: function () {} });
}

test("durable lifecycle jobs gate continuation dispatch and Stop cancels pending wakes", async function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-autonomous-durable-")); t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var scheduler = engine(dir); scheduler.start(); var f = fixture(null, null, null, null, null, { durableScheduler: scheduler });
  await arm(f, { maxContinuations: 2, maxMinutes: 5 });
  assert.equal(f.controller.consume(f.session, { text: "Finish", autonomousRunToken: f.session.autonomousRun.armToken }), true);
  f.controller.onTurnDone(f.session); scheduler.tick(); await tick(); await tick(); assert.equal(f.sdkCalls.filter(function (call) { return call.kind === "start"; }).length, 1);
  f.session.isProcessing = false; f.controller.onRateLimit(f.session, Date.now() + 60000); var runId = f.session.autonomousRun.id;
  await f.controller.finish(f.session, "stopped", "Stopped by test"); assert.equal(scheduler.listJobs().filter(function (job) { return job.payload.runId === runId && job.state === "queued"; }).length, 0);
  f.controller.shutdown(); await scheduler.shutdown();
});

test("durable lifecycle permits repeated continuation and rate-limit wake identities", async function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-autonomous-sequence-")); t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var scheduler = engine(dir); scheduler.start(); var f = fixture(null, null, null, null, null, { durableScheduler: scheduler });
  await arm(f, { maxContinuations: 5, maxMinutes: 5 }); assert.equal(f.controller.consume(f.session, { text: "Continue repeatedly", autonomousRunToken: f.session.autonomousRun.armToken }), true);
  for (var i = 0; i < 3; i++) { f.controller.onTurnDone(f.session); scheduler.tick(); await tick(); await tick(); f.session.isProcessing = false; }
  var jobs = scheduler.listJobs().filter(function (job) { return job.payload.kind === "continuation"; });
  assert.equal(jobs.length, 3); assert.equal(new Set(jobs.map(function (job) { return job.idempotencyKey; })).size, 3);
  f.controller.onRateLimit(f.session, Date.now() + 60000); var first = scheduler.listJobs().filter(function (job) { return job.payload.kind === "rate-limit"; })[0];
  f.controller.onRateLimit(f.session, Date.now() + 90000); var current = scheduler.listJobs().filter(function (job) { return job.payload.kind === "rate-limit" && job.state === "queued"; })[0];
  assert.notEqual(current.idempotencyKey, first.idempotencyKey); await f.controller.finish(f.session, "stopped", "test cleanup"); f.controller.shutdown(); await scheduler.shutdown();
});

test("durable lifecycle reads multi-user mode live and never promotes a local sentinel", async function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-autonomous-live-mode-")); var multiUser = false; t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var scheduler = engine(dir); scheduler.start(); var f = fixture(null, null, null, null, null, { durableScheduler: scheduler, isMultiUser: function () { return multiUser; } });
  await arm(f, { maxMinutes: 5 }); assert.equal(f.controller.consume(f.session, { text: "Mode changes", autonomousRunToken: f.session.autonomousRun.armToken }), true);
  assert.equal(scheduler.listJobs().filter(function (job) { return job.state === "queued"; })[0].ownerId, "local-user");
  multiUser = true; f.controller.onRateLimit(f.session, Date.now() + 60000); await tick(); await tick();
  assert.equal(f.session.autonomousRun.state, "error"); assert.match(f.session.autonomousRun.terminalReason, /explicit session owner/); assert.equal(f.sdkCalls.length, 0);
  f.controller.shutdown(); await scheduler.shutdown();
});

test("an exact deadline still terminates owned work after authorization is revoked", async function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-autonomous-deadline-revoked-")); var now = { value: Date.now() }; var allowed = true; var originalNow = Date.now;
  Date.now = function () { return now.value; }; t.after(function () { Date.now = originalNow; fs.rmSync(dir, { recursive: true, force: true }); });
  var scheduler = engine(dir, now); scheduler.start(); var f = fixture(null, null, null, null, null, { durableScheduler: scheduler, isMultiUser: function () { return true; }, authorizeSession: function () { return allowed; } });
  f.session.ownerId = "revoked-owner";
  await arm(f, { maxMinutes: 1 }); assert.equal(f.controller.consume(f.session, { text: "Expire safely", autonomousRunToken: f.session.autonomousRun.armToken }), true);
  allowed = false; f.session.ownerId = null; now.value = f.session.autonomousRun.deadlineAt; scheduler.tick(); await tick(); await tick(); await tick();
  assert.equal(f.session.autonomousRun.state, "limit"); assert.equal(f.session.permissionMode, "default"); assert.equal(f.sdkCalls.length, 0);
  f.controller.shutdown(); await scheduler.shutdown();
});

test("claimed stale deadlines cannot mutate a stopped or replacement run", async function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-autonomous-deadline-stale-")); var now = { value: Date.now() }; var originalNow = Date.now;
  Date.now = function () { return now.value; }; t.after(function () { Date.now = originalNow; fs.rmSync(dir, { recursive: true, force: true }); });
  var scheduler = engine(dir, now); var f = fixture(null, null, null, null, null, { durableScheduler: scheduler }); await arm(f, { maxMinutes: 1 });
  assert.equal(f.controller.consume(f.session, { text: "Replace safely", autonomousRunToken: f.session.autonomousRun.armToken }), true);
  now.value = f.session.autonomousRun.deadlineAt; scheduler.start();
  var replacement = Object.assign({}, f.session.autonomousRun, { id: "replacement-run", state: "stopped", cancellationEpoch: f.session.autonomousRun.cancellationEpoch + 1 });
  f.session.autonomousRun = replacement; await tick(); await tick();
  assert.equal(f.session.autonomousRun, replacement); assert.equal(replacement.state, "stopped"); assert.equal(f.sdkCalls.length, 0);
  f.controller.shutdown(); await scheduler.shutdown();
});
