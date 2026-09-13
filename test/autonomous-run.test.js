var test = require("node:test");
var assert = require("node:assert/strict");
var autonomousModule = require("../lib/project-autonomous-run");
var fullAccessModule = require("../lib/project-full-access");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachScheduler = require("../lib/durable-scheduler").attachDurableScheduler;
var helper = require("./helpers/autonomous-run-fixture");
var fixture = helper.fixture; var tick = helper.tick; var timerTick = helper.timerTick; var arm = helper.arm; var startRun = helper.startRun;

test("durable lifecycle storage failure blocks the first SDK turn", async function () {
  var scheduler = {
    registerHandler: function () { return function () {}; }, listJobs: function () { return []; },
    enqueue: function () { throw new Error("lifecycle disk unavailable"); }, cancel: function () {}, replaceQueued: function () {},
  };
  var f = fixture(null, null, null, null, null, { durableScheduler: scheduler });
  await arm(f, { maxMinutes: 5 });
  assert.equal(f.controller.consume(f.session, { text: "Do not dispatch", autonomousRunToken: f.session.autonomousRun.armToken }), false);
  await tick(); await tick();
  assert.equal(f.sdkCalls.length, 0);
  assert.equal(f.session.autonomousRun.state, "error");
  f.controller.shutdown();
});

test("durable storage failure while resuming restores access and dispatches no SDK turn", async function () {
  var scheduler = {
    registerHandler: function () { return function () {}; }, listJobs: function () { return []; },
    enqueue: function () { throw new Error("resume disk unavailable"); }, cancel: function () {}, replaceQueued: function () {},
  };
  var now = Date.now();
  var persisted = { id: "resume-storage", state: "paused", objective: "Resume", successCriteria: ["Done"], continuationCount: 0, maxContinuations: 2, maxMinutes: 5,
    startedAt: now, deadlineAt: now + 60000, waitingReason: "Paused after restart.", pausedAfterRestart: true, cancellationEpoch: 1,
    permissionSnapshot: { permissionMode: "default", permissionModeBeforeFullAccess: null, enabled: false } };
  var f = fixture(persisted, null, null, null, null, { durableScheduler: scheduler });
  f.controller.handleMessage({}, { type: "autonomous_run_resume", sessionId: f.session.localId, runId: persisted.id, requestId: "resume-storage" });
  await tick(); await tick(); await tick();
  assert.equal(f.sdkCalls.length, 0); assert.equal(f.session.autonomousRun.state, "error"); assert.equal(f.session.permissionMode, "default");
  assert.equal(f.messages.some(function (entry) { return entry.message.type === "autonomous_run_action_result" && entry.message.ok === false; }), true);
  f.controller.shutdown();
});

test("durable lifecycle restart pauses the run across a changed local id without auto-resume", async function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-autonomous-restart-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  function makeScheduler() { return attachScheduler({ storageDir: dir, namespace: "test", setTimer: function () { return { unref: function () {} }; }, clearTimer: function () {} }); }
  var firstScheduler = makeScheduler(); firstScheduler.start();
  var first = fixture(null, null, null, null, null, { durableScheduler: firstScheduler, localId: 7 });
  await arm(first, { maxMinutes: 5 });
  assert.equal(first.controller.consume(first.session, { text: "Persist", autonomousRunToken: first.session.autonomousRun.armToken }), true);
  var storedRun = JSON.parse(JSON.stringify(first.session.autonomousRun)); var origin = first.session.sessionOriginId;
  first.controller.shutdown(); await firstScheduler.shutdown();
  var secondScheduler = makeScheduler(); secondScheduler.start();
  var second = fixture(storedRun, null, null, null, null, { durableScheduler: secondScheduler, localId: 99, sessionOriginId: origin });
  await tick(); await tick();
  assert.equal(second.session.autonomousRun.state, "paused"); assert.equal(second.session.autonomousRun.pausedAfterRestart, true);
  assert.equal(second.sdkCalls.length, 0); assert.equal(secondScheduler.listJobs().filter(function (job) { return job.state === "queued"; }).length, 0);
  second.controller.shutdown(); await secondScheduler.shutdown();
});

test("a late continuation SDK rejection cannot terminate a newer run or query", async function () {
  var rejectOld;
  var oldStart = new Promise(function (resolve, reject) { rejectOld = reject; });
  var f = fixture(null, null, null, oldStart);
  await arm(f, { maxContinuations: 3, maxMinutes: 5 });
  assert.equal(f.controller.consume(f.session, { text: "Start old run", autonomousRunToken: f.session.autonomousRun.armToken }), true);
  f.controller.onTurnDone(f.session); await timerTick();
  var oldGeneration = f.session._queryGeneration;
  var newer = Object.assign({}, f.session.autonomousRun, { id: "newer-run", state: "running", continuationPending: false });
  f.session.autonomousRun = newer; f.session._queryGeneration = oldGeneration + 1; f.session.isProcessing = true;
  rejectOld(new Error("old continuation failed")); await tick(); await tick();
  assert.equal(f.session.autonomousRun, newer); assert.equal(newer.state, "running"); assert.equal(f.session.isProcessing, true);
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("arming sends no acknowledgement until the permission transition succeeds", async function () {
  var release;
  var gate = new Promise(function (resolve) { release = resolve; });
  var f = fixture(null, gate);
  f.controller.handleMessage({}, { type: "autonomous_run_arm", sessionId: f.session.localId });
  await tick();
  assert.equal(f.messages.some(function (entry) { return entry.message.type === "autonomous_run_arm_result"; }), false);
  release();
  await tick(); await tick();
  assert.equal(f.messages.filter(function (entry) { return entry.message.type === "autonomous_run_arm_result"; }).length, 1);
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("approved brief releases the controller before a long SDK turn so Stop remains usable", async function () {
  var releasePermission;
  var permissionGate = new Promise(function (resolve) { releasePermission = resolve; });
  var releaseSdk;
  var sdkGate = new Promise(function (resolve) { releaseSdk = resolve; });
  var f = fixture(null, permissionGate, null, sdkGate);
  var proposal = { id: "proposal-1", version: 1, objective: "Ship the reviewed task", successCriteria: ["Tests pass"], maxContinuations: 2, maxMinutes: 5 };
  var startPromise = f.controller.startApprovedBrief({}, f.session, proposal, "handoff-1", function () { return true; });
  await tick();
  assert.equal(f.sdkCalls.length, 0);
  releasePermission();
  await tick(); await tick();
  await startPromise;
  assert.equal(f.sdkCalls[0].kind, "start");
  assert.equal(f.session.autonomousRun.state, "running");
  assert.equal(f.messages.some(function (entry) { return entry.message === undefined; }), false);
  assert.equal(f.messages.some(function (entry) { return entry.message && entry.message.source === "loop_interview_run"; }), true);
  f.controller.handleMessage({}, { type: "autonomous_run_stop", sessionId: f.session.localId, runId: f.session.autonomousRun.id, requestId: "stop-1" });
  await tick(); await tick();
  assert.equal(f.session.autonomousRun.state, "stopped");
  assert.deepEqual(f.permissionCalls[f.permissionCalls.length - 1], ["restore", false]);
  releaseSdk();
});

test("approved brief rechecks processing after permission enable", async function () {
  var releasePermission;
  var permissionGate = new Promise(function (resolve) { releasePermission = resolve; });
  var f = fixture(null, permissionGate, null, null, function (session) { session.isProcessing = true; });
  var proposal = { id: "proposal-race", version: 1, objective: "Race", successCriteria: ["Evidence"], maxContinuations: 1, maxMinutes: 1 };
  var handoff = f.controller.startApprovedBrief({}, f.session, proposal, "race-1", function () { return true; });
  releasePermission();
  assert.equal(await handoff, false);
  assert.equal(f.sdkCalls.length, 0);
  f.session.isProcessing = false;
});

test("synchronous approved-start failure clears processing and status", async function () {
  var f = fixture(null, null, null, { throw: new Error("startup failed") });
  var proposal = { id: "proposal-sync-failure", version: 1, objective: "Fail", successCriteria: ["Error is visible"], maxContinuations: 1, maxMinutes: 1 };
  assert.equal(await f.controller.startApprovedBrief({}, f.session, proposal, "sync-failure", function () { return true; }), false);
  assert.equal(f.session.isProcessing, false);
  assert.equal(f.session.autonomousRun.state, "error");
  assert.equal(f.messages.some(function (entry) { return entry.message && entry.message.type === "status" && entry.message.status === "idle"; }), true);
});

test("late SDK rejection cannot finish a newer run", async function () {
  var rejectSdk;
  var sdkGate = new Promise(function (resolve, reject) { rejectSdk = reject; });
  var f = fixture(null, null, null, sdkGate);
  var proposal = { id: "proposal-late", version: 1, objective: "Late", successCriteria: ["Evidence"], maxContinuations: 1, maxMinutes: 1 };
  assert.equal(await f.controller.startApprovedBrief({}, f.session, proposal, "late-1", function () { return true; }), true);
  var oldId = f.session.autonomousRun.id;
  await f.controller.finish(f.session, "stopped", "replaced");
  f.session.isProcessing = true;
  rejectSdk(new Error("late failure"));
  await tick(); await tick();
  assert.equal(f.session.isProcessing, true);
  f.session.isProcessing = false;
  f.session.autonomousRun = { id: "new-run", state: "running", permissionSnapshot: {}, continuationPending: false };
  await tick();
  assert.equal(f.session.autonomousRun.id, "new-run");
  assert.notEqual(f.session.autonomousRun.id, oldId);
});

test("arming acknowledges permission first and one turn completion schedules only one correlated continuation", async function () {
  var f = fixture();
  var run = await startRun(f);
  assert.deepEqual(f.permissionCalls[0], ["set", true]);
  f.session.isProcessing = false;
  f.controller.onTurnDone(f.session);
  f.controller.onTurnDone(f.session);
  await timerTick();
  assert.equal(f.sdkCalls.filter(function (call) { return call.kind === "start"; }).length, 1);
  assert.equal(f.session.autonomousRun.continuationCount, 1);
  assert.equal(f.sdkCalls[0].meta.autonomousRunId, run.id);
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("completion requires concrete criterion evidence and restores permission only after turn completion", async function () {
  var f = fixture();
  var run = await startRun(f, ["Tests pass"]);
  f.session.isProcessing = true;
  var tool = f.controller.getToolDefs(f.session)[0];
  var rejected = JSON.parse((await tool.handler({ runId: run.id, status: "completed", summary: "Done", evidence: ["node --test passed"], criteria: [] })).content[0].text);
  assert.equal(rejected.status, "rejected");
  var recorded = JSON.parse((await tool.handler({ runId: run.id, status: "completed", summary: "Done", evidence: ["node --test passed"], criteria: [{ criterion: "Tests pass", met: true, evidence: "All focused tests passed" }] })).content[0].text);
  assert.equal(recorded.status, "recorded");
  assert.equal(f.session.autonomousRun.state, "reviewing");
  assert.equal(f.permissionCalls.length, 1, "permission remains enabled through the active turn");
  f.session.isProcessing = false;
  f.controller.onTurnDone(f.session);
  await tick(); await tick();
  assert.equal(f.session.autonomousRun.state, "completed");
  assert.equal(f.permissionCalls[1][0], "restore");
  assert.equal(f.pairStops(), 1);
});

test("Stop preserves unrelated pending messages and blocks an already scheduled continuation", async function () {
  var f = fixture();
  var run = await startRun(f);
  f.session.pendingPush = [{ text: "owned", autonomousRunId: run.id }, { text: "human steering" }];
  f.session.isProcessing = false;
  f.controller.onTurnDone(f.session);
  await f.controller.finish(f.session, "stopped", "Stopped by test");
  await tick();
  assert.deepEqual(f.session.pendingPush, [{ text: "human steering" }]);
  assert.equal(f.sdkCalls.length, 0);
  assert.equal(f.session.autonomousRun.state, "stopped");
});

test("arm authorization and token consumption are exact and replay-safe", async function () {
  var f = fixture();
  f.controller.handleMessage({}, { type: "autonomous_run_arm", sessionId: 999 });
  await tick(); await tick();
  var denied = f.messages.map(function (entry) { return entry.message; }).filter(function (entry) { return entry.type === "autonomous_run_arm_result"; }).pop();
  assert.equal(denied.ok, false);
  var result = await arm(f);
  var submission = { text: "Once", autonomousRunToken: result.armToken, autonomousSuccessCriteria: ["Done"] };
  assert.equal(f.controller.consume(f.session, submission), true);
  assert.equal(f.controller.consume(f.session, submission), false);
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("armed criteria are server-owned, persisted in state, and cannot be replaced during consume", async function () {
  var f = fixture();
  var result = await arm(f, { requestId: "arm-criteria", successCriteria: ["Server criterion"] });
  assert.equal(result.requestId, "arm-criteria");
  assert.equal(result.runId, result.run.id);
  assert.deepEqual(result.run.successCriteria, ["Server criterion"]);
  assert.equal(f.controller.consume(f.session, { text: "Ship", autonomousRunToken: result.armToken, autonomousSuccessCriteria: ["Injected criterion"] }), true);
  assert.deepEqual(f.session.autonomousRun.successCriteria, ["Server criterion"]);
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("consume is rejected while a delayed disarm is restoring permissions", async function () {
  var releaseRestore;
  var restoreGate = new Promise(function (resolve) { releaseRestore = resolve; });
  var f = fixture(null, null, restoreGate);
  var result = await arm(f);
  f.controller.handleMessage({}, { type: "autonomous_run_disarm", sessionId: f.session.localId, requestId: "disarm-1", runId: result.run.id });
  assert.equal(f.controller.consume(f.session, { text: "Must not start", autonomousRunToken: result.armToken }), false);
  releaseRestore();
  await tick(); await tick();
  assert.equal(f.session.autonomousRun, null);
  var action = f.messages.map(function (entry) { return entry.message; }).filter(function (entry) { return entry.type === "autonomous_run_action_result"; }).pop();
  assert.equal(action.ok, true);
  assert.equal(action.requestId, "disarm-1");
});

test("continuation and wall-clock limits end a run instead of scheduling extra work", async function () {
  var f = fixture();
  await arm(f, { maxContinuations: 1 });
  var token = f.session.autonomousRun.armToken;
  f.controller.consume(f.session, { text: "Bounded", autonomousRunToken: token });
  f.session.autonomousRun.continuationCount = 1;
  f.controller.onTurnDone(f.session);
  await tick(); await tick();
  assert.equal(f.session.autonomousRun.state, "limit");
  assert.equal(f.sdkCalls.length, 0);

  var g = fixture();
  await startRun(g);
  g.session.autonomousRun.deadlineAt = Date.now() - 1;
  g.controller.onTurnDone(g.session);
  await tick(); await tick();
  assert.equal(g.session.autonomousRun.state, "limit");
  assert.equal(g.sdkCalls.length, 0);
});

test("rate-limit rejection cancels an immediate continuation and waits for its reset", async function () {
  var f = fixture();
  await startRun(f);
  f.session.isProcessing = false;
  f.controller.onTurnDone(f.session);
  f.controller.onRateLimit(f.session, Date.now() + 20);
  await timerTick();
  assert.equal(f.sdkCalls.length, 0);
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  assert.equal(f.sdkCalls.filter(function (call) { return call.kind === "start"; }).length, 1);
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("waiting states wake only from their matching Worker result or AskUser answer", async function () {
  var f = fixture();
  var run = await startRun(f);
  var tool = f.controller.getToolDefs(f.session)[0];
  await tool.handler({ runId: run.id, status: "waiting_worker", summary: "Worker is running", evidence: [], criteria: [] });
  f.session.isProcessing = false;
  f.controller.onTurnDone(f.session);
  await tick();
  assert.equal(f.sdkCalls.length, 0, "waiting for a Worker does not spin");
  f.controller.onPartnerResult(f.session);
  assert.equal(f.session.autonomousRun.state, "running");
  await tool.handler({ runId: run.id, status: "waiting_user", summary: "Need an answer", evidence: [], criteria: [] });
  f.controller.onHumanMessage(f.session);
  assert.equal(f.session.autonomousRun.state, "running", "ordinary input can answer a human wait");
  await tool.handler({ runId: run.id, status: "waiting_user", summary: "Need tool answer", evidence: [], criteria: [] });
  f.controller.onUserAnswer(f.session);
  assert.equal(f.session.autonomousRun.state, "running", "AskUser tool answers wake the run");
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("a newer assessment or human steering invalidates a pending completion", async function () {
  var f = fixture();
  var run = await startRun(f, ["Tests pass"]);
  var tool = f.controller.getToolDefs(f.session)[0];
  var complete = { runId: run.id, status: "completed", summary: "Done", evidence: ["Focused test passed"],
    criteria: [{ criterion: "Tests pass", met: true, evidence: "Focused test passed" }] };
  await tool.handler(complete);
  await tool.handler({ runId: run.id, status: "continue", summary: "More verification needed", evidence: [], criteria: [] });
  f.session.isProcessing = false;
  f.controller.onTurnDone(f.session);
  await timerTick();
  assert.notEqual(f.session.autonomousRun.state, "completed");
  assert.equal(f.session.autonomousRun.completionRequested, false);
  f.session.isProcessing = true;
  await tool.handler(complete);
  await tool.handler({ runId: run.id, status: "waiting_user", summary: "Need confirmation", evidence: [], criteria: [] });
  f.session.isProcessing = false;
  f.controller.onTurnDone(f.session);
  await tick();
  assert.equal(f.session.autonomousRun.state, "waiting-user");
  assert.equal(f.session.autonomousRun.completionRequested, false);
  f.controller.onHumanMessage(f.session);
  assert.equal(f.session.autonomousRun.outcome, null);
  f.controller.onTurnDone(f.session);
  await timerTick();
  assert.notEqual(f.session.autonomousRun.state, "completed");
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("outcome reporting rejects armed, paused, and stale captured sessions", async function () {
  var f = fixture();
  var run = await startRun(f);
  var tool = f.controller.getToolDefs(f.session)[0];
  f.session.autonomousRun.state = "paused";
  var paused = JSON.parse((await tool.handler({ runId: run.id, status: "continue", summary: "x", evidence: [], criteria: [] })).content[0].text);
  assert.equal(paused.status, "rejected");
  f.session.autonomousRun.state = "armed";
  var armed = JSON.parse((await tool.handler({ runId: run.id, status: "continue", summary: "x", evidence: [], criteria: [] })).content[0].text);
  assert.equal(armed.status, "rejected");
  f.session.autonomousRun.state = "running";
  f.controller.onHumanMessage(f.session);
  f.sm.sessions.set(f.session.localId, Object.assign({}, f.session));
  var stale = JSON.parse((await tool.handler({ runId: run.id, status: "continue", summary: "x", evidence: [], criteria: [] })).content[0].text);
  assert.equal(stale.status, "rejected");
  f.sm.sessions.set(f.session.localId, f.session);
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("restart restores permissions, remains paused on ordinary text, and resumes only explicitly", async function () {
  var now = Date.now();
  var persisted = { id: "run-restart", state: "running", objective: "Recover", successCriteria: ["Recovered"],
    continuationCount: 0, maxContinuations: 10, maxMinutes: 60, startedAt: now, deadlineAt: now + 60000,
    permissionSnapshot: { permissionMode: "default", permissionModeBeforeFullAccess: null, enabled: false }, cancellationEpoch: 0 };
  var f = fixture(persisted);
  f.session.permissionMode = "bypassPermissions";
  await tick(); await tick();
  assert.equal(f.session.autonomousRun.state, "paused");
  assert.equal(f.session.permissionMode, "default");
  f.controller.onHumanMessage(f.session);
  assert.equal(f.session.autonomousRun.state, "paused");
  f.controller.handleMessage({}, { type: "autonomous_run_resume", sessionId: f.session.localId, runId: f.session.autonomousRun.id });
  await tick(); await tick();
  assert.deepEqual(f.permissionCalls.slice(-1)[0], ["set", true]);
  assert.notEqual(f.session.autonomousRun.state, "paused");
  await f.controller.finish(f.session, "stopped", "test cleanup");
});

test("durable Worker provenance cannot arm Until complete after pair dissolution", async function () {
  var f = fixture();
  f.session.sessionProvenance = { kind: "worker", generation: 1, parentSessionOriginId: "driver-origin" };
  f.controller.handleMessage({}, { type: "autonomous_run_arm", sessionId: f.session.localId });
  await tick(); await tick();
  var result = f.messages.map(function (entry) { return entry.message; }).filter(function (entry) { return entry.type === "autonomous_run_arm_result"; }).pop();
  assert.equal(result.ok, false);
  assert.match(result.error, /project GUI Driver/);
});

test("a GUI session currently running as TUI cannot arm Until complete", async function () {
  var f = fixture();
  f.session.runtimeMode = "tui";
  f.controller.handleMessage({}, { type: "autonomous_run_arm", sessionId: f.session.localId });
  await tick(); await tick();
  var result = f.messages.map(function (entry) { return entry.message; }).filter(function (entry) { return entry.type === "autonomous_run_arm_result"; }).pop();
  assert.equal(result.ok, false);
});

test("persisted run restoration bounds server-owned text, arrays, and limits", function () {
  var restored = autonomousModule.restoreStoredRun({ state: "running", id: "run", objective: "x".repeat(25000),
    successCriteria: new Array(20).fill("criterion"), continuationCount: 999, maxContinuations: 999, maxMinutes: 9999,
    permissionSnapshot: { permissionMode: "default", enabled: false }, outcome: { assessment: "continue", summary: "y".repeat(5000), evidence: new Array(30).fill("evidence") } });
  assert.equal(restored.objective.length, 20000);
  assert.equal(restored.successCriteria.length, 10);
  assert.equal(restored.continuationCount, 100);
  assert.equal(restored.maxContinuations, 100);
  assert.equal(restored.maxMinutes, 1440);
  assert.equal(restored.outcome.summary.length, 4000);
  assert.equal(restored.outcome.evidence.length, 20);
});

test("full-access transitions serialize and restore the original user state", async function () {
  var release;
  var first = new Promise(function (resolve) { release = resolve; });
  var modes = [];
  var session = { localId: 1, permissionMode: "default", permissionModeBeforeFullAccess: null,
    queryInstance: { setPermissionMode: function (mode) { modes.push(mode); return modes.length === 1 ? first : Promise.resolve(); } } };
  var service = fullAccessModule.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function () {}, broadcastSessionList: function () {} } });
  var prior = service.snapshot(session);
  var enabling = service.setEnabled(session, true);
  var restoring = service.restore(session, prior);
  await tick();
  assert.deepEqual(modes, ["default"]);
  release();
  await enabling; await restoring;
  assert.equal(session.permissionMode, "default");
  assert.equal(session.permissionModeBeforeFullAccess, null);
  assert.deepEqual(modes, ["default", "default"]);
});

test("a failed full-access transition rolls the session back", async function () {
  var session = { localId: 2, permissionMode: "default", permissionModeBeforeFullAccess: null,
    queryInstance: { setPermissionMode: function () { return Promise.reject(new Error("adapter refused")); } } };
  var service = fullAccessModule.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function () {}, broadcastSessionList: function () {} } });
  await assert.rejects(service.setEnabled(session, true), /adapter refused/);
  assert.equal(session.permissionMode, "default");
  assert.equal(session.permissionModeBeforeFullAccess, null);
});
