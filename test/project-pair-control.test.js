var test = require("node:test");
var assert = require("node:assert/strict");
var taskModule = require("../lib/project-pair-task-control");
var replacementState = require("../lib/project-pair-replacement-state");
var runtimeCatalog = require("../lib/worker-runtime-catalog");

function parse(value) { return JSON.parse(value.content[0].text); }

function fixture() {
  var driver = { localId: 1, ownerId: "owner" };
  var worker = { localId: 2, ownerId: "owner", _pairGeneration: 3, isProcessing: true };
  var sessions = new Map([[1, driver], [2, worker]]);
  var deliveries = [];
  var events = [];
  var stopped = false;
  var control = taskModule.attachPairTaskControl({
    sm: { sessions: sessions, sendToSession: function (session, message) { events.push({ session: session, message: message }); } },
    resolvePair: function (caller) {
      if (caller !== driver) throw new Error("only the Driver can direct this pair");
      return { partner: worker };
    },
    rolesFor: function (session) { return session === worker ? { driver: driver, worker: worker } : null; },
    turnControl: {
      assertWorkerAction: function () { if (stopped) throw new Error("human stopped"); },
      blockedReason: function () { return stopped ? "human stopped" : null; },
    },
    sendFollowup: function (args) { deliveries.push(args); return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "running", taskId: args.taskId }) }] }); },
  });
  return { control: control, driver: driver, worker: worker, deliveries: deliveries, events: events,
    stop: function (value) { stopped = value; } };
}

test("follow-up queue inspect and cancel use exact task ids", async function () {
  var f = fixture();
  var active = f.control.begin(f.worker, f.driver, "Implement", "task-active");
  f.worker._pairDelegation = active;
  var queued = parse(await f.control.queue({ message: "Review", taskId: "task-review" }, f.driver));
  assert.equal(queued.status, "queued");
  assert.equal(queued.task.taskId, "task-review");
  var status = parse(await f.control.inspect({}, f.driver));
  assert.equal(status.current.taskId, "task-active");
  assert.equal(status.queued[0].taskId, "task-review");
  assert.equal(parse(await f.control.cancel({ taskId: "wrong" }, f.driver)).status, "rejected");
  assert.equal(parse(await f.control.cancel({ taskId: "task-review" }, f.driver)).status, "cancelled");
  assert.equal(parse(await f.control.inspect({}, f.driver)).queued.length, 0);
});

test("direction correction preserves partial Worker report then starts the correlated replacement", async function () {
  var f = fixture();
  var aborted = false;
  var active = f.control.begin(f.worker, f.driver, "Implement A", "task-a");
  f.worker._pairDelegation = active;
  f.worker.abortController = { abort: function () { aborted = true; } };
  var reportTool = f.control.workerToolDefs(f.worker)[0];
  assert.equal(parse(await reportTool.handler({ taskId: "task-a", outcome: "partial", summary: "Half done", changedFiles: ["lib/a.js"], verifications: [{ command: "node test/a.js", result: "passed" }], unverified: ["browser"], processes: ["none"], nextAction: "Review first" })).status, "recorded");
  var replaced = parse(await f.control.replaceTask({ targetTaskId: "task-a", message: "Correct direction", taskId: "task-b", reason: "Wrong boundary" }, f.driver));
  assert.equal(replaced.status, "interrupting");
  assert.equal(aborted, true);
  var outcome = f.control.complete(f.worker, f.driver, active, "interrupted", "Partial code", null);
  assert.equal(outcome.status, "interrupted", "the observed interruption is authoritative over a partial report");
  assert.equal(outcome.workerReport.outcome, "partial");
  assert.deepEqual(outcome.changedFiles, ["lib/a.js"]);
  assert.equal(outcome.interruption.interruptedBy, "driver");
  delete f.worker._pairDelegation;
  f.worker.isProcessing = false;
  assert.equal(f.control.drain(f.driver, f.worker), true);
  await Promise.resolve();
  assert.equal(f.deliveries[0].taskId, "task-b");
  assert.equal(f.events[0].message.type, "partner_task_completed");
});

test("human Stop blocks queued drain, task replacement, and resume", async function () {
  var f = fixture();
  var active = f.control.begin(f.worker, f.driver, "Implement", "task-stop");
  f.worker._pairDelegation = active;
  f.control.markInterruption(f.worker, "user", "Human Stop", active.taskId);
  f.control.complete(f.worker, f.driver, active, "interrupted", "partial", null);
  delete f.worker._pairDelegation;
  f.worker.isProcessing = false;
  f.stop(true);
  assert.equal(f.control.drain(f.driver, f.worker), false);
  assert.equal(parse(await f.control.resumeTask({ taskId: "task-resume" }, f.driver)).status, "rejected");
  assert.equal(parse(await f.control.replaceTask({ targetTaskId: "task-stop", message: "retry" }, f.driver)).status, "rejected");
  assert.equal(f.deliveries.length, 0);
});

test("replacement transactions replay completed results and expose failed rollback state", function () {
  var driver = {};
  var worker = { localId: 2, _pairGeneration: 4 };
  var entry = replacementState.begin(driver, "replace-one", worker);
  replacementState.stage(entry.transaction, "creating_target");
  var result = { workerSessionId: 3, generation: 5 };
  replacementState.complete(entry.transaction, result);
  assert.equal(replacementState.replayValue(replacementState.begin(driver, "replace-one", worker)), result);
  assert.throws(function () { replacementState.begin(driver, "replace-one", worker, "changed"); }, /different input/);
  var failed = replacementState.begin(driver, "replace-two", worker);
  replacementState.fail(failed.transaction, "creation_failed", new Error("offline"), "source_pair_restored");
  assert.equal(failed.transaction.failure.rollback, "source_pair_restored");
  assert.throws(function () { replacementState.replayValue(replacementState.begin(driver, "replace-two", worker)); }, /offline/);
});

test("runtime catalog lists only executable combinations and explains unavailable vendors", function () {
  var catalog = runtimeCatalog.build({ installedVendors: ["codex", "claude"], modelsByVendor: {
    codex: [{ value: "gpt-sol", supportedEffortLevels: ["low", "high"] }], claude: [],
  }, capabilitiesByVendor: { codex: { effort: true }, claude: { effort: true } }, unavailableReasons: { claude: "catalog timeout" } }, false);
  assert.deepEqual(catalog.vendors[0].combinations, [{ model: "gpt-sol", effort: "low" }, { model: "gpt-sol", effort: "high" }]);
  assert.equal(catalog.vendors[1].status, "temporarily_unavailable");
  assert.equal(catalog.vendors[1].unavailableReason, "catalog timeout");
  assert.equal(catalog.approval.mode, "user_required");
});
