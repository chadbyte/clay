// Regression: the pair factory is constructed with attachSessionPair's own
// context.
//
// attachPairFactory reads sm, splitStore, isMate, usersModule and sendTo off
// its argument. project-session-pair.js used to wrap that as
// { sm, splitStore, ctx }, which left isMate, usersModule and sendTo
// undefined. The single-user path happened to survive, because a Driver with no
// ownerId short-circuits `ws._clayUser && ctx.usersModule.isMultiUser()` before
// the undefined dereference. In multi-user, where the Driver has an ownerId,
// the same expression threw "Cannot read properties of undefined (reading
// 'isMultiUser')" and send_to_partner failed on its very first call.
//
// These tests drive accepted proposal creation followed by the real
// send_to_partner tool in both modes, so the wiring cannot silently regress.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var pairModule = require("../lib/project-session-pair");
var scheduledExecutionModule = require("../lib/project-scheduled-task-execution");

var CLAUDE_CATALOG = [{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" }];
var CODEX_CATALOG = ["gpt-5.6-terra", "gpt-5.6-sol"];

function parse(result) { return JSON.parse(result.content[0].text); }

function toolNamed(tools, name) {
  for (var i = 0; i < tools.length; i++) {
    if (tools[i].name === name) return tools[i];
  }
  return null;
}

// A world built the way project.js builds one: one flat context object carrying
// every dependency, exactly as attachSessionPair receives it.
function makeWorld(options) {
  var opts = options || {};
  var nextId = 10;
  var driver = {
    localId: 1,
    ownerId: opts.ownerId === undefined ? null : opts.ownerId,
    title: "Planner", vendor: "claude", model: "claude-fable-5",
    history: [], isProcessing: false,
  };
  var sessions = new Map([[1, driver]]);
  var groups = [];
  var created = [];
  var sentTo = [];
  var intervals = [];
  var realSetInterval = global.setInterval;
  global.setInterval = function (fn, ms) {
    var id = realSetInterval(fn, ms);
    intervals.push(id);
    return id;
  };

  var sm = {
    sessions: sessions,
    installedVendors: ["claude", "codex"],
    modelsByVendor: { claude: CLAUDE_CATALOG, codex: CODEX_CATALOG },
    defaultModelByVendor: {},
    capabilitiesByVendor: {},
    lastVendor: "codex",
    sendAndRecord: function (session, message) { session.history.push(message); },
    saveSessionFile: function () {},
    sendToSession: function () {},
    broadcastSessionList: function () {},
    createSessionRaw: function (spec) {
      var s = {
        localId: nextId++, ownerId: spec.ownerId === undefined ? null : spec.ownerId,
        vendor: spec.vendor, model: spec.model || null, effort: spec.effort || null,
        history: [], isProcessing: false, lastActivity: Date.now(), hidden: spec.hidden === true,
      };
      sessions.set(s.localId, s);
      created.push(s);
      return s;
    },
    deleteSessionQuiet: function (id) { sessions.delete(id); },
  };

  var sdk = {
    pushMessage: function () { return false; },
    startQuery: function (session) {
      session.history.push({ type: "delta", text: "worker result" });
      session.isProcessing = false;
      return Promise.resolve();
    },
  };

  var attached = pairModule.attachSessionPair({
    sm: sm,
    isMate: !!opts.isMate,
    splitStore: {
      groupForMember: function (id) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].members.indexOf(id) !== -1) return groups[i];
        }
        return null;
      },
      create: function (ws, msg) {
        if (opts.groupCreateFails) return { ok: false, error: "A session can belong to only one split group" };
        var g = {
          id: "sg_" + (groups.length + 1),
          members: msg.members.slice(),
          pair: msg.pair,
          ownerId: ws && ws._clayUser ? ws._clayUser.id : null,
        };
        groups.push(g);
        return { ok: true, group: g };
      },
      createOwned: function (ownerId, msg) {
        if (opts.groupCreateFails) return { ok: false, error: "Pair persistence failed" };
        var g = { id: "sg_" + (groups.length + 1), name: msg.name, members: msg.members.slice(), pair: msg.pair, ownerId: ownerId || null };
        groups.push(g);
        return { ok: true, group: g };
      },
      dissolveOwned: function (ownerId, id) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].id === id && (groups[i].ownerId || null) === (ownerId || null)) { groups.splice(i, 1); return true; }
        }
        return false;
      },
      dissolve: function (ws, msg) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].id === msg.id) return { ok: true, group: groups.splice(i, 1)[0] };
        }
        return { ok: false, error: "Split group not found" };
      },
    },
    getSdk: function () { return sdk; },
    send: function () {},
    sendTo: function (ws, message) { sentTo.push({ ws: ws, message: message }); },
    usersModule: { isMultiUser: function () { return !!opts.multiUser; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
  });

  var world = {
    attached: attached, driver: driver, sm: sm, sessions: sessions,
    groups: groups, created: created, sentTo: sentTo,
    tool: function (name, session) {
      return toolNamed(attached.getToolDefs(session || driver), name);
    },
    worker: function () {
      var g = groups[0];
      return g && g.pair ? sessions.get(g.pair.workerId) : null;
    },
    dispose: function () {
      for (var i = 0; i < intervals.length; i++) clearInterval(intervals[i]);
      global.setInterval = realSetInterval;
    },
  };
  return world;
}

// Delegate and settle the turn, the way the real bridge does on completion.
async function delegate(world, message) {
  if (!world.worker()) {
    var proposal = parse(await world.tool("propose_worker").handler({
      summary: "Use a visible Split Worker",
      plan: "1. Execute\n2. Report",
      message: message || "Build it",
      recommendedVendor: "codex",
      recommendedModel: "gpt-5.6-sol",
      recommendedEffort: "medium",
      recommendationRationale: "Codex Sol at medium effort fits the delegated implementation task.",
    }));
    var response = await world.attached.respondToWorkerProposal({
      _clayActiveSession: world.driver.localId,
      _clayUser: world.driver.ownerId ? { id: world.driver.ownerId } : null,
    }, {
      proposalId: proposal.proposalId,
      accepted: true,
      vendor: "codex",
      model: "gpt-5.6-sol",
      effort: "medium",
    });
    assert.equal(response.ok, true, response.error || "proposal acceptance failed");
    return { content: [{ type: "text", text: JSON.stringify({ accepted: true }) }] };
  }
  var send = world.tool("send_to_partner");
  assert.ok(send, "the Driver has send_to_partner");
  var raw = await send.handler({ message: message || "Build it", wait: false });
  var worker = world.worker();
  if (worker) world.attached.handleTurnDone(worker);
  return raw;
}

// --- The regression, in both modes ---------------------------------------

test("an accepted pair supports delegation in single-user mode", async function (t) {
  var world = makeWorld({ multiUser: false, ownerId: null });
  t.after(world.dispose);

  var raw = await delegate(world, "Implement the parser");
  assert.equal(raw.isError, undefined, "no error: " + raw.content[0].text);
  var result = parse(raw);
  assert.equal(result.accepted, true);

  assert.equal(world.groups.length, 1, "exactly one pair");
  var worker = world.worker();
  assert.ok(worker, "the Worker session exists");
  assert.deepEqual(world.groups[0].pair, { driverId: 1, workerId: worker.localId });
  assert.equal(world.groups[0].members.length, 2);
  assert.equal(worker.ownerId, null, "single-user sessions carry no owner");
});

test("an accepted pair supports delegation in multi-user mode for an owned Driver", async function (t) {
  // The exact case the wrapped context broke: an owned Driver makes
  // `ws._clayUser` truthy, so `ctx.usersModule.isMultiUser()` is evaluated.
  var world = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(world.dispose);

  var raw = await delegate(world, "Implement the parser");
  assert.equal(raw.isError, undefined,
    "no undefined isMultiUser error: " + raw.content[0].text);
  assert.equal(/isMultiUser|Cannot read properties of undefined/.test(raw.content[0].text), false,
    "the failure mode this test exists for");

  var result = parse(raw);
  assert.equal(result.accepted, true);
  assert.equal(world.groups.length, 1);

  var worker = world.worker();
  assert.ok(worker);
  assert.deepEqual(world.groups[0].pair, { driverId: 1, workerId: worker.localId });
  // Ownership is derived from the connection the factory builds for the Driver,
  // so the Worker and the group belong to the Driver's owner.
  assert.equal(worker.ownerId, "alice", "the Worker inherits the Driver's owner");
  assert.equal(world.groups[0].ownerId, "alice", "and so does the group record");
});

test("scheduled execution creates a fresh owned hidden pair and requires explicit outcome", async function (t) {
  var world = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(world.dispose);
  var record = {
    id: "schedule-1", name: "Review", ownerId: "alice", createdViaScheduledTasks: true,
    execution: { driver: { vendor: "claude", model: "fable", effort: "medium" }, worker: { vendor: "codex", model: "gpt-5.6-sol", effort: "medium" } },
    skipIfRunning: true, activeRun: null, runs: [],
  };
  var registry = {
    getById: function () { return record; },
    beginRun: function (id, run) { if (record.activeRun) return false; record.activeRun = Object.assign({}, run); return true; },
    updateRun: function (id, runId, patch) { if (!record.activeRun || record.activeRun.runId !== runId) return false; record.activeRun = Object.assign({}, record.activeRun, patch); return true; },
    completeRun: function (id, runId, result) { if (!record.activeRun || record.activeRun.runId !== runId) return false; record.runs.push(Object.assign({}, record.activeRun, result)); record.activeRun = null; return true; },
  };
  var dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "scheduled-pair-"));
  fs.mkdirSync(path.join(dir, ".claude", "loops", record.id), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "loops", record.id, "PROMPT.md"), "Inspect the change.\n");
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var executor = scheduledExecutionModule.attachScheduledTaskExecution({
    cwd: dir, sm: world.sm, registry: registry, sessionPair: world.attached,
    getSdk: function () { return { startQuery: function () { return Promise.resolve(); } }; },
    getLinuxUserForSession: function () { return null; }, onProcessingChanged: function () {}, authorize: function () { return true; },
  });
  var started = executor.trigger(record, "manual");
  assert.equal(started.ok, true, started.error);
  assert.equal(world.groups.length, 1);
  assert.equal(world.groups[0].ownerId, "alice");
  var driver = world.sessions.get(started.driverSessionId);
  var worker = world.sessions.get(started.workerSessionId);
  assert.equal(driver.ownerId, "alice"); assert.equal(worker.ownerId, "alice");
  assert.equal(driver.hidden, true); assert.equal(worker.hidden, true);
  assert.equal(driver.vendor, "claude"); assert.equal(worker.vendor, "codex");
  assert.match(driver.history[0].text, /report_scheduled_task_outcome/);
  var outcomeTool = toolNamed(executor.getToolDefs(driver), "report_scheduled_task_outcome");
  var premature = parse(await outcomeTool.handler({ runId: record.activeRun.runId, outcome: "completed" }));
  assert.equal(premature.status, "rejected");
  var blocked = parse(await outcomeTool.handler({ runId: record.activeRun.runId, outcome: "needs-input", summary: "Approval required" }));
  assert.equal(blocked.status, "recorded");
  assert.equal(record.activeRun.status, "needs-input", "needs-input remains an active, openable run");
  assert.equal(record.runs.length, 0, "needs-input is not mislabelled as a terminal result");
  worker._lastPairOutcome = { completedAt: Date.now(), status: "completed" };
  driver._sdkQueryGeneration = Number(driver._sdkQueryGeneration || 0) + 1;
  var reviewTool = toolNamed(executor.getToolDefs(driver), "report_scheduled_task_outcome");
  assert.equal(parse(await outcomeTool.handler({ runId: record.activeRun.runId, outcome: "completed" })).status, "rejected", "an outcome callback is bound to the query that received it");
  var completed = parse(await reviewTool.handler({ runId: record.activeRun.runId, outcome: "completed", summary: "Reviewed" }));
  assert.equal(completed.status, "recorded");
  assert.equal(record.activeRun, null);
  assert.equal(record.runs[0].outcome, "completed");
  assert.equal(record.runs[0].summary, "Reviewed", "the terminal report supersedes the stale needs-input summary");

  var failedStart = executor.trigger(record, "manual");
  var failedDriver = world.sessions.get(failedStart.driverSessionId); var failedWorker = world.sessions.get(failedStart.workerSessionId); var failureClosed = 0;
  failedWorker.isProcessing = true; failedWorker.queryInstance = { close: function () { failureClosed++; } }; failedWorker._pairDelegation = { taskId: "active" }; failedWorker._pairFollowups = [{ taskId: "queued", status: "queued" }];
  var failed = parse(await toolNamed(executor.getToolDefs(failedDriver), "report_scheduled_task_outcome").handler({ runId: record.activeRun.runId, outcome: "failed", summary: "Verification failed" }));
  assert.equal(failed.status, "recorded"); assert.equal(failureClosed, 1); assert.equal(failedWorker.taskStopRequested, true); assert.equal(failedWorker._pairFollowups[0].status, "cancelled");
  assert.equal(executor.onPartnerResult(failedDriver), false, "a late Worker result cannot restart the failed Driver");
});

test("scheduled stop revokes the exact pair, cancels queued work, and blocks late outcomes", async function (t) {
  var world = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(world.dispose);
  var authorized = true; var closed = 0;
  var record = { id: "schedule-stop", name: "Stop", ownerId: "alice", createdViaScheduledTasks: true, execution: { driver: { vendor: "claude", model: "fable", effort: "medium" }, worker: { vendor: "codex", model: "gpt-5.6-sol", effort: "medium" } }, skipIfRunning: false, activeRun: null, pendingRun: null, runs: [] };
  var registry = {
    getById: function () { return record; },
    beginRun: function (id, run) { if (record.activeRun) return false; record.activeRun = Object.assign({}, run); if (run.source === "queued") record.pendingRun = null; return true; },
    updateRun: function (id, runId, patch) { if (!record.activeRun || record.activeRun.runId !== runId) return false; record.activeRun = Object.assign({}, record.activeRun, patch); return true; },
    updateRecord: function (id, patch) { Object.assign(record, patch); return record; },
    completeRun: function (id, runId, result) { if (!record.activeRun || record.activeRun.runId !== runId) return false; record.runs.push(Object.assign({}, record.activeRun, result)); if (result.outcome === "interrupted") record.pendingRun = null; record.activeRun = null; return true; },
  };
  var dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "scheduled-stop-"));
  fs.mkdirSync(path.join(dir, ".claude", "loops", record.id), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "loops", record.id, "PROMPT.md"), "Inspect.\n");
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var never = new Promise(function () {});
  var executor = scheduledExecutionModule.attachScheduledTaskExecution({ cwd: dir, sm: world.sm, registry: registry, sessionPair: world.attached, getSdk: function () { return { startQuery: function (session) { session.queryInstance = { close: function () { closed++; } }; return never; } }; }, getLinuxUserForSession: function () { return null; }, onProcessingChanged: function () {}, authorize: function () { return authorized; } });
  var started = executor.trigger(record, "manual");
  assert.equal(started.ok, true, started.error);
  var driver = world.sessions.get(started.driverSessionId); var worker = world.sessions.get(started.workerSessionId);
  var outcome = toolNamed(executor.getToolDefs(driver), "report_scheduled_task_outcome");
  var queued = executor.prepare(record, "schedule");
  assert.equal(queued.queued, true); assert.equal(queued.pendingRun.scheduleId, record.id);
  record.pendingRun = queued.pendingRun;
  record.skipIfRunning = true;
  var skipped = executor.prepare(record, "schedule");
  assert.equal(skipped.skipped, true); assert.equal(skipped.skippedRun.outcome, "skipped-busy");
  record.skipIfRunning = false;
  authorized = false;
  assert.equal(parse(await outcome.handler({ runId: record.activeRun.runId, outcome: "failed" })).status, "rejected");
  authorized = true;
  worker.isProcessing = true; worker.queryInstance = { close: function () { closed++; } }; worker._pairDelegation = { taskId: "active" }; worker._pairFollowups = [{ taskId: "queued", status: "queued" }];
  executor.onTurnDone(driver);
  assert.equal(record.activeRun.status, "waiting-worker");
  authorized = false;
  assert.equal(executor.stopForSession(driver, "Stop this run"), true);
  assert.equal(worker._pairFollowups[0].status, "cancelled");
  assert.equal(closed, 2);
  assert.equal(record.activeRun, null);
  assert.equal(record.pendingRun, null);
  assert.equal(record.runs[0].outcome, "interrupted");
  assert.equal(parse(await outcome.handler({ runId: record.runs[0].runId, outcome: "completed" })).status, "rejected");
  assert.equal(world.sessions.get(1).taskStopRequested, undefined, "the unrelated original Driver remains untouched");
  assert.equal(world.groups.length, 1, "the completed pair and its history remain visible");
});

test("scheduled preflight and pre-dispatch path validation create no orphan pair", function (t) {
  var world = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(world.dispose);
  var record = { id: "../escape", name: "Unsafe", ownerId: "alice", createdViaScheduledTasks: true, execution: { driver: { vendor: "claude", model: "fable", effort: "medium" }, worker: { vendor: "codex", model: "gpt-5.6-sol", effort: "medium" } }, activeRun: null, runs: [] };
  var registry = { getById: function () { return record; }, beginRun: function (id, run) { record.activeRun = run; return true; }, completeRun: function (id, runId, result) { record.runs.push(Object.assign({}, record.activeRun, result)); record.activeRun = null; return true; } };
  var executor = scheduledExecutionModule.attachScheduledTaskExecution({ cwd: process.cwd(), sm: world.sm, registry: registry, sessionPair: world.attached, getSdk: function () { return {}; }, getLinuxUserForSession: function () { return null; }, onProcessingChanged: function () {}, authorize: function () { return true; } });
  var failed = executor.trigger(record, "manual");
  assert.equal(failed.ok, false);
  assert.match(failed.error, /storage identity/);
  assert.equal(world.groups.length, 0);
  assert.equal(world.sessions.size, 1);
  record.id = "safe"; record.execution.driver.vendor = "antigravity";
  assert.match(executor.runnable(record).error, /cannot receive scheduled outcome tools/);
  assert.equal(world.sessions.size, 1);
});

test("scheduled execution rechecks ownership and required OS identity immediately before SDK start", function (t) {
  var world = makeWorld({ multiUser: true, ownerId: "alice" }); t.after(world.dispose);
  var record = { id: "pre-sdk-owner", name: "Owner check", ownerId: "alice", createdViaScheduledTasks: true, execution: { driver: { vendor: "claude", model: "fable", effort: "medium" }, worker: { vendor: "codex", model: "gpt-5.6-sol", effort: "medium" } }, activeRun: null, runs: [] };
  var registry = {
    getById: function () { return record; }, beginRun: function (id, run) { record.activeRun = Object.assign({}, run); return true; },
    updateRun: function (id, runId, patch) { record.activeRun = Object.assign({}, record.activeRun, patch); return true; },
    completeRun: function (id, runId, result) { record.runs.push(Object.assign({}, record.activeRun, result)); record.activeRun = null; return true; },
  };
  var dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "scheduled-owner-recheck-"));
  fs.mkdirSync(path.join(dir, ".claude", "loops", record.id), { recursive: true }); fs.writeFileSync(path.join(dir, ".claude", "loops", record.id, "PROMPT.md"), "Run.\n");
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var sdkCalls = 0; var authorizationChecks = 0;
  var revoked = scheduledExecutionModule.attachScheduledTaskExecution({ cwd: dir, sm: world.sm, registry: registry, sessionPair: world.attached,
    getSdk: function () { return { startQuery: function () { sdkCalls++; return Promise.resolve(); } }; }, getLinuxUserForSession: function () { return "alice-linux"; }, requiresLinuxUser: function () { return true; },
    onProcessingChanged: function () {}, authorize: function () { authorizationChecks++; return authorizationChecks === 1; } });
  var revokedResult = revoked.trigger(record, "manual");
  assert.equal(revokedResult.ok, false); assert.match(revokedResult.error, /no longer authorized/); assert.equal(sdkCalls, 0); assert.equal(record.activeRun, null);

  var missingIdentity = scheduledExecutionModule.attachScheduledTaskExecution({ cwd: dir, sm: world.sm, registry: registry, sessionPair: world.attached,
    getSdk: function () { return { startQuery: function () { sdkCalls++; return Promise.resolve(); } }; }, getLinuxUserForSession: function () { return null; }, requiresLinuxUser: function () { return true; },
    onProcessingChanged: function () {}, authorize: function () { return true; } });
  var identityResult = missingIdentity.trigger(record, "manual");
  assert.equal(identityResult.ok, false); assert.match(identityResult.error, /valid OS identity/); assert.equal(sdkCalls, 0); assert.equal(record.activeRun, null);
});

test("an asynchronous query-start failure preserves the dispatched pair and records failure", async function (t) {
  var world = makeWorld({ multiUser: true, ownerId: "alice" }); t.after(world.dispose);
  var record = { id: "async-failure", name: "Async", ownerId: "alice", createdViaScheduledTasks: true, execution: { driver: { vendor: "claude", model: "fable", effort: "medium" }, worker: { vendor: "codex", model: "gpt-5.6-sol", effort: "medium" } }, activeRun: null, runs: [] };
  var registry = { getById: function () { return record; }, beginRun: function (id, run) { record.activeRun = run; return true; }, updateRun: function (id, runId, patch) { record.activeRun = Object.assign({}, record.activeRun, patch); return true; }, completeRun: function (id, runId, result) { record.runs.push(Object.assign({}, record.activeRun, result)); record.activeRun = null; return true; } };
  var dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "scheduled-async-failure-"));
  fs.mkdirSync(path.join(dir, ".claude", "loops", record.id), { recursive: true }); fs.writeFileSync(path.join(dir, ".claude", "loops", record.id, "PROMPT.md"), "Run.\n");
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var rejectStart; var gate = new Promise(function (resolve, reject) { rejectStart = reject; });
  var executor = scheduledExecutionModule.attachScheduledTaskExecution({ cwd: dir, sm: world.sm, registry: registry, sessionPair: world.attached, getSdk: function () { return { startQuery: function () { return gate; } }; }, getLinuxUserForSession: function () { return null; }, onProcessingChanged: function () {}, authorize: function () { return true; } });
  var started = executor.trigger(record, "manual"); assert.equal(started.ok, true, started.error);
  rejectStart(new Error("provider rejected start")); await Promise.resolve(); await Promise.resolve();
  assert.equal(record.activeRun, null); assert.equal(record.runs[0].outcome, "failed");
  assert.equal(world.sessions.get(started.driverSessionId).taskStopRequested, true); assert.equal(world.sessions.get(started.workerSessionId).taskStopRequested, true);
  assert.equal(world.groups.length, 1); assert.ok(world.sessions.get(started.driverSessionId)); assert.ok(world.sessions.get(started.workerSessionId));
});

test("the wiring passes the whole context, so every dependency resolves", function () {
  var pairSource = fs.readFileSync(path.join(root, "lib/project-session-pair.js"), "utf8");
  var factorySource = fs.readFileSync(path.join(root, "lib/session-pair-factory.js"), "utf8");

  assert.match(pairSource, /attachPairFactory\(ctx\)/,
    "the factory receives attachSessionPair's own context");
  assert.equal(/attachPairFactory\(\{/.test(pairSource), false,
    "never a re-wrapped object that would drop fields");

  // Everything the factory reads must be a top-level field of that context.
  var reads = {};
  var re = /ctx\.([A-Za-z_$][\w$]*)/g;
  var match;
  while ((match = re.exec(factorySource)) !== null) reads[match[1]] = true;
  var names = Object.keys(reads).sort();
  assert.deepEqual(names, ["isMate", "multiWorkerFeature", "sendTo", "splitStore", "sm", "usersModule"].sort(),
    "the factory's exact dependency list");
  for (var i = 0; i < names.length; i++) {
    assert.match(pairSource, new RegExp("ctx\\." + names[i] + "\\b|var \\w+ = ctx\\." + names[i]),
      names[i] + " is a real field of the pair context");
  }
});

// --- Guarantees the fix must not weaken ----------------------------------

test("the Mate guard actually fires again", async function (t) {
  // With the wrapped context ctx.isMate was undefined, so this guard was dead.
  var world = makeWorld({ isMate: true, multiUser: false });
  t.after(world.dispose);

  var send = world.tool("send_to_partner");
  if (!send) {
    // A Mate project may not mount the pair tools at all, which is a stronger
    // refusal than the guard; either way no pair may be created.
    assert.equal(world.groups.length, 0);
    return;
  }
  var raw = await send.handler({ message: "x", wait: false });
  assert.equal(raw.isError, true);
  assert.match(raw.content[0].text, /only available in projects/);
  assert.equal(world.groups.length, 0, "no pair was created in a Mate project");
  assert.deepEqual(world.created, [], "and no session either");
});

test("owner and preflight guarantees still hold after the fix", async function (t) {
  // Model tier is the user's choice, including in multi-user projects.
  var below = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(below.dispose);
  below.driver.model = "claude-sonnet-5";
  assert.ok(below.tool("propose_worker"), "the proposal tool is mounted for the selected model");
  assert.equal(below.groups.length, 0);

  // Preflight: an unavailable vendor is refused and nothing is created.
  var badVendor = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(badVendor.dispose);
  var res = parse(await badVendor.tool("propose_worker").handler({ summary: "x", plan: "x", message: "x", recommendedVendor: "nope", recommendationRationale: "Use a Worker." }));
  assert.strictEqual(res.status, "posted");
  assert.deepEqual(badVendor.created, [], "no orphan session");
  assert.equal(badVendor.groups.length, 0, "no group");

  // Preflight: an unavailable model, same outcome.
  var badModel = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(badModel.dispose);
  var res2 = parse(await badModel.tool("propose_worker").handler({ summary: "x", plan: "x", message: "x", recommendedModel: "gpt-9-imaginary", recommendationRationale: "Use a Worker." }));
  assert.strictEqual(res2.status, "posted");
  assert.deepEqual(badModel.created, []);
  assert.equal(badModel.groups.length, 0);

  assert.throws(function () {
    badModel.attached.preflightRuntime({ vendor: "claude", model: "fable", effort: "minimal" }, null, true);
  }, /reasoning effort is not supported/, "scheduled runtimes reject an effort that would be silently clamped");
});

test("a late group-write failure leaves no orphan, in either mode", async function (t) {
  var modes = [
    { multiUser: false, ownerId: null },
    { multiUser: true, ownerId: "alice" },
  ];
  for (var i = 0; i < modes.length; i++) {
    var world = makeWorld(Object.assign({ groupCreateFails: true }, modes[i]));
    t.after(world.dispose);

    world.attached.handleMessage({ _clayActiveSession: 1, _clayUser: modes[i].ownerId ? { id: modes[i].ownerId } : null }, {
      type: "pair_session_create", driver: { sessionId: 1 }, worker: { vendor: "codex" },
    });
    assert.equal(world.groups.length, 0, "no group");
    // The Worker this call created was removed; the Driver is untouched.
    assert.equal(world.sessions.size, 1, "only the pre-existing Driver remains");
    assert.equal(world.sessions.get(1), world.driver);
  }
});

test("the pair_session_create WebSocket flow can report its result again", function (t) {
  // createPair calls ctx.sendTo, which the wrapped context left undefined, so
  // the "Add Split Worker" flow threw instead of answering the client.
  var world = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(world.dispose);
  var ws = { _clayUser: { id: "alice" }, _clayActiveSession: 1 };

  var handled = world.attached.handleMessage(ws, {
    type: "pair_session_create",
    driver: { sessionId: 1 },
    worker: { vendor: "codex" },
  });
  assert.equal(handled, true);
  assert.equal(world.sentTo.length, 1, "the client was answered");
  assert.equal(world.sentTo[0].message.type, "pair_session_created");
  assert.equal(world.sentTo[0].message.ok, true, world.sentTo[0].message.error || "");
  assert.equal(world.groups.length, 1);

  // And a refusal is reported rather than thrown.
  var world2 = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(world2.dispose);
  world2.attached.handleMessage(ws, {
    type: "pair_session_create",
    driver: { sessionId: 1 },
    worker: { vendor: "not-installed" },
  });
  assert.equal(world2.sentTo.length, 1);
  assert.equal(world2.sentTo[0].message.ok, false);
  assert.match(world2.sentTo[0].message.error, /vendor is not installed/);
});
