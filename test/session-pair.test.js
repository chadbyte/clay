var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var pairModule = require("../lib/project-session-pair");
var pairTarget = require("../lib/session-pair-target");
var multiWorkerFeature = require("../lib/multi-worker-feature");
var attachOutbox = require("../lib/project-pair-result-outbox").attachPairResultOutbox;
var attachRecovery = require("../lib/project-pair-result-recovery").attachPairResultRecovery;

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

function atomicPersistForTest(filePath, serialized) {
  var tempPath = filePath + ".tmp-test";
  fs.writeFileSync(tempPath, serialized, "utf8");
  fs.renameSync(tempPath, filePath);
  return true;
}

function fixture(configured, options) {
  options = options || {};
  // Fable receives proactive orchestration guidance; structural Driver
  // capability itself remains model-agnostic.
  var driver = { localId: 1, sessionOriginId: "driver-origin", ownerId: null, title: "Planner", vendor: "claude", model: options.driverModel || "claude-fable-5", history: [], isProcessing: false };
  var worker = { localId: 2, sessionOriginId: "worker-origin", ownerId: null, title: "Builder", vendor: "codex", history: [], isProcessing: false };
  if (options.driverQueryReady) driver.queryInstance = {};
  var workerB = { localId: 3, sessionOriginId: "worker-b-origin", ownerId: null, title: "Reviewer", vendor: "codex", model: "gpt-5.6-terra", history: [], isProcessing: false };
  var sessions = new Map([[1, driver], [2, worker]]);
  if (options.versioned) sessions.set(3, workerB);
  var group = options.ungrouped ? null : { id: "sg_pair", members: options.versioned ? [1, 2, 3] : [1, 2] };
  if (configured && group) group.pair = options.versioned ? { version: 2, driverId: 1, workerIds: [2, 3] } : { driverId: 1, workerId: 2 };
  var events = [];
  var starts = [];
  var driverPushes = [];
  var pairMessages = [];
  var partnerResults = 0;
  var sdkLookups = 0;
  var attached;
  // Under options.manualTurns a Worker's simulated turn does not resolve on a
  // timer. The runnable body is held here per Worker localId and only fires
  // when the test explicitly calls completeWorkerTurn, so ordering between
  // Worker A and Worker B is asserted rather than assumed from real delays.
  var pendingWorkerTurns = {};
  var sm = {
    sessions: sessions,
    installedVendors: ["claude", "codex"],
    modelsByVendor: { claude: [{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" }, { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Claude Sonnet" }], codex: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"] },
    capabilitiesByVendor: {},
    sendAndRecord: function (session, message) { session.history.push(message); },
    sendAndRecordDurably: function (session, message) {
      if (options.durableTranscriptUndefined) return undefined;
      session.history.push(message); return true;
    },
    hasDurableSessionRecord: function (session, predicate) { return !options.noDurableTranscriptEvidence && session.history.some(predicate); },
    saveSessionFile: function () {},
    sendToSession: function (session, message) { if (message.type === "pair_session_created") pairMessages.push(message); },
    broadcastSessionList: function () {},
    createSessionRaw: function (spec) {
      var created = options.allocateSecondWorker ? workerB : worker;
      created.ownerId = spec.ownerId || null;
      created.vendor = spec.vendor;
      created.model = spec.model || null;
      created.effort = spec.effort || null;
      sessions.set(created.localId, created);
      return created;
    },
  };
  var sdk = {
    pushMessage: function (session, text) {
      if (session === driver) {
        driverPushes.push(text);
        if (options.driverPushThrows) throw new Error("driver push failed");
        if (options.driverPushAccepted === false) return false;
        return options.driverPushAccepted !== false;
      }
      return false;
    },
    startQuery: function (session, text, images, linuxUser, beforePush, onAccepted) {
      starts.push({ session: session, text: text });
      session._queryGeneration = (session._queryGeneration || 0) + 1;
      if (session !== worker && session !== workerB) {
        if (options.onDriverStart) options.onDriverStart(session);
        if (options.driverStartReject) return Promise.reject(new Error("driver start failed"));
        if (typeof beforePush === "function") {
          session._queryStarting = true;
          return new Promise(function (resolve, reject) {
            setTimeout(function () {
              if (beforePush() !== true) { session._queryStarting = false; resolve(false); return; }
              session.queryInstance = { id: "driver-result-query" };
              if (!options.driverStartNeverAccept && typeof onAccepted === "function") onAccepted();
              if (options.driverStreamRejectAfterAccept) {
                setTimeout(function () { session._queryStarting = false; reject(new Error("stream failed later")); }, options.driverStreamRejectAfterAccept);
                return;
              }
              session._queryStarting = false;
              resolve(true);
            }, options.driverStartAcceptedDelay || 0);
          });
        }
        return options.driverStartPromise || Promise.resolve();
      }
      delete session._lastTurnInterrupted;
      var runTurn = function () {
        if (options.workerError) {
          session.history.push({ type: "error", text: options.workerError });
        } else if (options.workerInterrupted) {
          session.history.push({ type: "delta", text: "Partial implementation" });
          session.history.push({ type: "info", text: "Interrupted · What should Claude do instead?" });
          session.history.push({ type: "done", code: 0 });
          session._lastTurnInterrupted = true;
        } else {
          session.history.push({ type: "delta", text: session === workerB ? "Partner B result" : "Partner result" });
        }
        session.isProcessing = false;
        if (options.autoTurnDone !== false && !options.workerInterrupted) attached.handleTurnDone(session);
      };
      if (options.manualTurns) {
        pendingWorkerTurns[session.localId] = runTurn;
      } else {
        setTimeout(runTurn, session === workerB ? (options.workerBDelay || options.workerDelay || 20) : (options.workerDelay || 20));
      }
      return Promise.resolve();
    },
  };
  var splitStore = {
    groupForMember: function (id) { return !group || group.members.indexOf(id) === -1 ? null : group; },
    create: function (ws, msg) {
      group = { id: "sg_created", members: msg.members.slice(), pair: msg.pair };
      return { ok: true, group: group };
    },
    dissolve: function (ws, msg) {
      if (!group || group.id !== msg.id) return { ok: false, error: "Split group not found" };
      var removed = group;
      group = null;
      return { ok: true, group: removed };
    },
    removeWorker: function (ownerId, msg, capability) {
      if (!multiWorkerFeature.isEnabled(capability) || !group ||
          group.id !== msg.groupId || group.pair.workerIds.indexOf(msg.workerId) === -1) {
        return { ok: false, error: "The selected Worker changed" };
      }
      var remaining = group.pair.workerIds.filter(function (id) { return id !== msg.workerId; });
      group.members = [group.pair.driverId].concat(remaining);
      group.pair = { version: 2, driverId: group.pair.driverId, workerIds: remaining };
      return { ok: true, group: group };
    },
    addWorker: function (ownerId, msg, capability) {
      if (!multiWorkerFeature.isEnabled(capability) || !group || msg.expectedGroup !== group ||
          group.id !== msg.groupId || !sessions.has(msg.newWorkerId)) return { ok: false, error: "The exact split group changed" };
      var existing = group.pair.workerIds ? group.pair.workerIds.slice() : [group.pair.workerId];
      if (existing.length >= 2 || existing.join(",") !== msg.expectedWorkerIds.join(",")) {
        return { ok: false, error: "The configured Worker membership changed" };
      }
      group.members = [group.pair.driverId].concat(existing, [msg.newWorkerId]);
      group.pair = { version: 2, driverId: group.pair.driverId, workerIds: existing.concat([msg.newWorkerId]) };
      return { ok: true, group: group };
    },
  };
  attached = pairModule.attachSessionPair({
    sm: sm,
    splitStore: splitStore,
    getSdk: function () { sdkLookups++; return options.disableResultSdk && sdkLookups > 1 ? null : sdk; },
    send: function (message) { events.push(message); },
    sendTo: function () {},
    usersModule: { isMultiUser: function () { return false; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
    onPartnerResult: function () { partnerResults++; if (options.throwPartnerResult) throw new Error("result hook failed"); },
    resultOutbox: options.resultOutbox,
    acceptanceTimeoutMs: options.acceptanceTimeoutMs,
    multiWorkerFeature: options.enableMultiWorkerRuntime ? multiWorkerFeature.fromServerConfig({ multiWorkerRuntimeEnabled: true }) : null,
  });
  return { attached: attached, driver: driver, worker: worker, workerB: workerB, sessions: sessions, sm: sm, splitStore: splitStore,
    group: group, getGroup: function () { return group; }, events: events, starts: starts, driverPushes: driverPushes,
    pairMessages: pairMessages, partnerResults: function () { return partnerResults; },
    hasPendingWorkerTurn: function (session) { return typeof pendingWorkerTurns[session.localId] === "function"; },
    completeWorkerTurn: function (session) {
      var runTurn = pendingWorkerTurns[session.localId];
      if (!runTurn) throw new Error("no pending manual turn for Worker " + session.localId);
      delete pendingWorkerTurns[session.localId];
      runTurn();
    } };
}

test("configured pairs expose partner tools only to the Driver", function () {
  var f = fixture(true);
  // A configured Driver also answers its Split Worker's permission requests,
  // so the decision tool sits with the other partner-control tools.
  // A configured Driver gets the partner tools, the autonomous lifecycle
  // tools, and the Worker permission decision tool.
  assert.deepStrictEqual(f.attached.getToolDefs(f.driver).map(function (tool) { return tool.name; }), ["send_to_partner", "read_partner", "interrupt_partner", "close_partner", "message_partner", "partner_status", "replace_partner", "record_partner_evaluation", "queue_partner_followup", "inspect_partner_followups", "cancel_partner_followup", "replace_partner_task", "resume_partner_task", "inspect_worker_proposal", "cancel_worker_proposal", "worker_runtime_catalog", "respond_to_worker_permission"]);
  assert.deepStrictEqual(f.attached.getToolDefs(f.worker).map(function (tool) { return tool.name; }), ["report_partner_outcome"]);
  assert.match(f.attached.getSystemPrompt(f.driver), /Driver/);
  assert.match(f.attached.getSystemPrompt(f.driver), /reuse the same Split Worker for follow-up implementation|Reuse the existing Split Worker/);
  assert.match(f.attached.getSystemPrompt(f.driver), /A human Stop is authoritative/);
  assert.match(f.attached.getSystemPrompt(f.driver), /do not retry, send more work, or replace/);
  assert.match(f.attached.getSystemPrompt(f.driver), /Use close_partner when they ask to close/);
  assert.match(f.attached.getSystemPrompt(f.driver), /Sub-agent/);
  assert.match(f.attached.getToolDefs(f.driver)[0].description, /reuse the same Split Worker for follow-up implementation/);
  assert.match(f.attached.getSystemPrompt(f.worker), /report_partner_outcome/);
});

test("the real coordinator accepts one add card while the existing Worker remains active", async function () {
  var f = fixture(true, { enableMultiWorkerRuntime: true, allocateSecondWorker: true, workerDelay: 20 });
  f.worker.isProcessing = true;
  f.worker._pairGeneration = 4;
  var propose = f.attached.getToolDefs(f.driver).find(function (item) { return item.name === "propose_worker"; });
  assert.ok(propose);
  assert.deepStrictEqual(f.attached.getToolDefs(f.worker).map(function (item) { return item.name; }), ["report_partner_outcome"]);
  var posted = parseToolResult(await propose.handler({
    summary: "A separate verification Worker can proceed independently.",
    plan: "1. Preserve the active Worker\n2. Delegate separate verification files",
    message: "Inspect the independent verification scope and report the result.",
    recommendedVendor: "codex", recommendedModel: "gpt-5.6-sol", recommendedEffort: "medium",
    recommendationRationale: "The installed Codex runtime fits this isolated verification task.",
  }));
  assert.equal(posted.status, "posted");
  var accepted = await f.attached.respondToWorkerProposal({ _clayActiveSession: 1 }, {
    proposalId: posted.proposalId, accepted: true, vendor: "codex", model: "gpt-5.6-sol", effort: "medium",
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(f.getGroup().pair.workerIds, [2, 3]);
  assert.equal(f.worker.isProcessing, true, "adding Worker B does not interrupt Worker A");
  assert.equal(f.starts.filter(function (start) { return start.session === f.workerB; }).length, 1);
  assert.deepStrictEqual(f.attached.getToolDefs(f.workerB).map(function (item) { return item.name; }), ["report_partner_outcome"]);
  assert.match(f.attached.getSystemPrompt(f.driver), /workerId to every targeted/);
  await assert.rejects(f.attached.respondToWorkerProposal({ _clayActiveSession: 1 }, {
    proposalId: posted.proposalId, accepted: true,
  }), /already been resolved/);
});

test("ad-hoc splits expose partner tools to both sessions", function () {
  var f = fixture(false);
  assert.strictEqual(f.attached.getToolDefs(f.driver).length, 4);
  assert.strictEqual(f.attached.getToolDefs(f.worker).length, 4);
});

test("ad-hoc delegation still completes through blocking wait", async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-adhoc-result-"));
  try {
    var outbox = attachOutbox({ storageDir: dir });
    var f = fixture(false, { resultOutbox: outbox });
    var send = f.attached.getToolDefs(f.driver).find(function (tool) { return tool.name === "send_to_partner"; });
    var completed = parseToolResult(await send.handler({ message: "Ad-hoc wait", wait: true, timeoutSeconds: 2 }));
    assert.equal(completed.status, "complete");
    assert.equal(completed.response, "Partner result");
    assert.equal(f.worker._pairDelegation, undefined);
    assert.equal(outbox.list()[0].finalized, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ad-hoc detached delegation uses the fallback callback once", async function () {
  var f = fixture(false, { workerDelay: 15 });
  var send = f.attached.getToolDefs(f.driver).find(function (tool) { return tool.name === "send_to_partner"; });
  await send.handler({ message: "Ad-hoc detached", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 70); });
  assert.equal(f.driverPushes.length, 1);
  assert.match(f.driverPushes[0], /Partner result/);
  assert.equal(f.worker._pairDelegation, undefined);
});

test("real pair handlers address separate V2 Workers and reject ambiguous targets", async function () {
  var f = fixture(true, { versioned: true });
  f.worker.history.push({ type: "user_message", text: "Worker A task" });
  f.workerB.history.push({ type: "user_message", text: "Worker B task" });
  var tools = f.attached.getToolDefs(f.driver);
  var read = tools.find(function (tool) { return tool.name === "read_partner"; });
  var status = tools.find(function (tool) { return tool.name === "partner_status"; });
  var a = parseToolResult(await read.handler({ workerId: 2, lastTurns: 1 }));
  var b = parseToolResult(await read.handler({ workerId: 3, lastTurns: 1 }));
  assert.equal(a.partnerId, 2);
  assert.equal(b.partnerId, 3);
  assert.equal(a.turns[0].user, "Worker A task");
  assert.equal(b.turns[0].user, "Worker B task");
  var ambiguous = await read.handler({ lastTurns: 0 });
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content[0].text, /workerId is required/);
  var roster = parseToolResult(await status.handler({}));
  assert.deepEqual(roster.workerIds, [2, 3]);
  assert.deepEqual(roster.workers.map(function (worker) { return worker.worker.sessionId; }), [2, 3]);
  assert.match(f.attached.getSystemPrompt(f.driver), /workerId=2.*workerId=3/);
  var wrong = await status.handler({ workerId: 99 });
  assert.equal(wrong.isError, true);
  assert.equal(f.getGroup().members.join(","), "1,2,3");
});

test("server-gated V2 runtime delegates concurrently and completes each exact Worker independently", async function () {
  var f = fixture(true, { versioned: true, enableMultiWorkerRuntime: true, workerDelay: 15 });
  var send = f.attached.getToolDefs(f.driver).find(function (tool) { return tool.name === "send_to_partner"; });
  var first = parseToolResult(await send.handler({ workerId: 2, taskId: "task-a", message: "Build A", wait: false }));
  var second = parseToolResult(await send.handler({ workerId: 3, taskId: "task-b", message: "Build B", wait: false }));
  assert.equal(first.partnerId, 2);
  assert.equal(second.partnerId, 3);
  assert.equal(f.worker._pairDelegation.taskId, "task-a");
  assert.equal(f.workerB._pairDelegation.taskId, "task-b");
  await new Promise(function (resolve) { setTimeout(resolve, 80); });
  assert.equal(f.worker._pairDelegation, undefined);
  assert.equal(f.workerB._pairDelegation, undefined);
  assert.equal(f.starts.filter(function (entry) { return entry.session === f.worker; }).length, 1);
  assert.equal(f.starts.filter(function (entry) { return entry.session === f.workerB; }).length, 1);
  assert.equal(f.worker._lastPairOutcome.taskId, "task-a");
  assert.equal(f.workerB._lastPairOutcome.taskId, "task-b");
});

test("durable V2 sender persists and accepts out-of-order results without Worker replay", async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-v2-outbox-"));
  try {
    var outbox = attachOutbox({ storageDir: dir, projectSlug: "project" });
    var f = fixture(true, { versioned: true, enableMultiWorkerRuntime: true, driverQueryReady: true,
      resultOutbox: outbox, workerDelay: 25, workerBDelay: 110 });
    var send = f.attached.getToolDefs(f.driver).find(function (tool) { return tool.name === "send_to_partner"; });
    await send.handler({ workerId: 2, taskId: "durable-a", message: "Durable A" });
    await send.handler({ workerId: 3, taskId: "durable-b", message: "Durable B" });
    await new Promise(function (resolve) { setTimeout(resolve, 55); });
    var early = outbox.list();
    var a = early.find(function (record) { return record.taskId === "durable-a"; });
    var b = early.find(function (record) { return record.taskId === "durable-b"; });
    assert.equal(a.deliveryState, "accepted");
    assert.equal(a.finalized, true);
    assert.equal(b.outcome, null);
    assert.equal(f.workerB.isProcessing, true, "Worker A delivery is independent of running Worker B");
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
    var records = outbox.list();
    assert.equal(records.length, 2);
    assert.equal(records.filter(function (record) { return record.deliveryState === "accepted" && record.finalized; }).length, 2);
    assert.notEqual(records[0].workerOriginId, records[1].workerOriginId);
    assert.equal(f.starts.filter(function (entry) { return entry.session === f.worker || entry.session === f.workerB; }).length, 2,
      "result delivery never redispatches a Worker");
    assert.equal(f.driverPushes.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("V2 Stop retains both durable results until an actual human turn", async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-v2-stop-"));
  try {
    var outbox = attachOutbox({ storageDir: dir });
    var f = fixture(true, { versioned: true, enableMultiWorkerRuntime: true, driverQueryReady: true,
      resultOutbox: outbox, workerDelay: 20, workerBDelay: 30 });
    f.worker._pairGeneration = 1;
    f.worker.sessionProvenance = { kind: "worker", parentSessionOriginId: f.driver.sessionOriginId, generation: 1 };
    f.workerB._pairGeneration = 2;
    f.workerB.sessionProvenance = { kind: "worker", parentSessionOriginId: f.driver.sessionOriginId, generation: 2 };
    var recovery = attachRecovery({ sm: f.sm, store: f.splitStore, outbox: outbox, resultCapture: f.attached.resultCapture,
      wake: f.attached.wakePartnerResult, projectSlug: null, blockedReason: f.attached.stopBarrier,
      sendTo: function () {}, getClients: function () { return []; }, isMultiUser: function () { return false; } });
    var send = f.attached.getToolDefs(f.driver).find(function (tool) { return tool.name === "send_to_partner"; });
    await send.handler({ workerId: 2, taskId: "stopped-a", message: "Stopped A" });
    await send.handler({ workerId: 3, taskId: "stopped-b", message: "Stopped B" });
    f.attached.handleHumanStop(f.driver);
    await new Promise(function (resolve) { setTimeout(resolve, 70); });
    assert.equal(outbox.list().filter(function (record) { return record.state === "blocked" && record.outcome; }).length, 2);
    assert.equal(outbox.list().filter(function (record) { return record.finalized; }).length, 0);
    assert.equal(f.driverPushes.length, 0);
    assert.equal(f.attached.beginHumanTurn(f.driver), true);
    recovery.beginHumanTurn(f.driver);
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.equal(outbox.list().filter(function (record) { return record.deliveryState === "accepted" && record.finalized; }).length, 2);
    assert.equal(f.driverPushes.length, 2, "each retained result is accepted by the Driver once");
    assert.equal(f.starts.filter(function (entry) { return entry.session === f.worker || entry.session === f.workerB; }).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("generation changes fence delayed durable capture and sender acceptance", async function () {
  var captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-v2-stale-capture-"));
  var acceptanceDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-v2-stale-acceptance-"));
  try {
    var calls = 0;
    var captureOutbox = attachOutbox({ storageDir: captureDir, persist: function (target, serialized) {
      calls++;
      if (calls === 2) return false;
      atomicPersistForTest(target, serialized);
      return true;
    } });
    var captureFixture = fixture(true, { versioned: true, enableMultiWorkerRuntime: true, resultOutbox: captureOutbox, workerDelay: 10 });
    captureFixture.worker._pairGeneration = 7;
    await captureFixture.attached.getToolDefs(captureFixture.driver)[0].handler({ workerId: 2, taskId: "stale-capture", message: "Capture later" });
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
    captureFixture.worker._pairGeneration = 8;
    var newerCapture = { taskId: "newer-capture", workerSessionId: 2, generation: 8 };
    captureFixture.worker._pairDelegation = newerCapture;
    await new Promise(function (resolve) { setTimeout(resolve, 90); });
    assert.equal(captureOutbox.list()[0].outcome, null);
    assert.equal(captureOutbox.list()[0].finalized, false);
    assert.equal(captureFixture.worker._pairDelegation, newerCapture);

    var acceptanceOutbox = attachOutbox({ storageDir: acceptanceDir });
    var acceptanceFixture = fixture(true, { versioned: true, enableMultiWorkerRuntime: true, resultOutbox: acceptanceOutbox,
      workerDelay: 10, driverStartAcceptedDelay: 90, acceptanceTimeoutMs: 200 });
    acceptanceFixture.worker._pairGeneration = 11;
    await acceptanceFixture.attached.getToolDefs(acceptanceFixture.driver)[0].handler({ workerId: 2, taskId: "stale-acceptance", message: "Accept later" });
    await new Promise(function (resolve) { setTimeout(resolve, 35); });
    acceptanceFixture.worker._pairGeneration = 12;
    var newerAcceptance = { taskId: "newer-acceptance", workerSessionId: 2, generation: 12 };
    acceptanceFixture.worker._pairDelegation = newerAcceptance;
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
    assert.notEqual(acceptanceOutbox.list()[0].deliveryState, "accepted");
    assert.equal(acceptanceOutbox.list()[0].finalized, false);
    assert.equal(acceptanceFixture.worker._pairDelegation, newerAcceptance);
  } finally {
    fs.rmSync(captureDir, { recursive: true, force: true });
    fs.rmSync(acceptanceDir, { recursive: true, force: true });
  }
});

test("out-of-order V2 completion and follow-up queues stay isolated by Worker", async function () {
  // manualTurns replaces the real SDK timer with an explicit switch per
  // Worker (f.completeWorkerTurn). Ordering between Worker A and Worker B is
  // then asserted by which switch the test has flipped, not by racing
  // arbitrary delays against each other.
  var f = fixture(true, { versioned: true, enableMultiWorkerRuntime: true, manualTurns: true });
  var tools = f.attached.getToolDefs(f.driver);
  var send = tools.find(function (tool) { return tool.name === "send_to_partner"; });
  var queue = tools.find(function (tool) { return tool.name === "queue_partner_followup"; });
  var inspect = tools.find(function (tool) { return tool.name === "inspect_partner_followups"; });
  await send.handler({ workerId: 2, taskId: "active-a", message: "Active A" });
  await send.handler({ workerId: 3, taskId: "active-b", message: "Active B" });
  await queue.handler({ workerId: 2, taskId: "queued-a", message: "Queued A" });
  await queue.handler({ workerId: 3, taskId: "queued-b", message: "Queued B" });
  var a = parseToolResult(await inspect.handler({ workerId: 2 }));
  var b = parseToolResult(await inspect.handler({ workerId: 3 }));
  assert.deepEqual(a.queued.map(function (task) { return task.taskId; }), ["queued-a"]);
  assert.deepEqual(b.queued.map(function (task) { return task.taskId; }), ["queued-b"]);
  assert.ok(f.hasPendingWorkerTurn(f.worker), "active-a has not been released yet");
  assert.ok(f.hasPendingWorkerTurn(f.workerB), "active-b has not been released yet");

  // Finish Worker B's active turn ("active-b"). Dequeuing "queued-b" runs
  // synchronously inside this same call, before it returns.
  f.completeWorkerTurn(f.workerB);
  assert.equal(f.workerB._lastPairOutcome.taskId, "active-b");
  assert.ok(f.hasPendingWorkerTurn(f.workerB), "queued-b started as Worker B's new active turn");
  assert.equal(f.worker._lastPairOutcome, undefined, "Worker A remains untouched by Worker B's completion");
  assert.ok(f.hasPendingWorkerTurn(f.worker), "Worker A's active-a turn is still fully pending");

  // Finish Worker B's now-active turn ("queued-b"). Worker B has now fully
  // drained both of its tasks while Worker A has not been touched at all.
  f.completeWorkerTurn(f.workerB);
  assert.equal(f.workerB._lastPairOutcome.taskId, "queued-b");
  assert.equal(!f.hasPendingWorkerTurn(f.workerB), true, "Worker B has no further queued work");
  assert.equal(f.worker._lastPairOutcome, undefined, "Worker A stays pending through both of Worker B's completions");
  assert.ok(f.hasPendingWorkerTurn(f.worker), "Worker A's active-a turn remains untouched");

  // Only now release Worker A's active turn ("active-a"), which dequeues
  // and starts "queued-a" the same way Worker B's completion did above.
  f.completeWorkerTurn(f.worker);
  assert.equal(f.worker._lastPairOutcome.taskId, "active-a");
  assert.ok(f.hasPendingWorkerTurn(f.worker), "queued-a started as Worker A's new active turn");
  f.completeWorkerTurn(f.worker);
  assert.equal(f.worker._lastPairOutcome.taskId, "queued-a");
  assert.equal(f.workerB._lastPairOutcome.taskId, "queued-b", "Worker B's earlier outcome is untouched by Worker A finishing later");
});

test("V2 Worker permissions bind each request to its exact live Worker", async function () {
  var f = fixture(true, { versioned: true, enableMultiWorkerRuntime: true, driverQueryReady: true });
  var pendingA = f.attached.workerPermission.routeIfWorker(f.worker, { toolName: "Write", input: { path: "a" } });
  var pendingB = f.attached.workerPermission.routeIfWorker(f.workerB, { toolName: "Write", input: { path: "b" } });
  var requests = f.driver.history.filter(function (entry) { return entry.workerPermissionRequest; });
  assert.deepEqual(requests.map(function (entry) { return entry.workerSessionId; }), [2, 3]);
  await f.attached.workerPermission.handleDriverResponse({ requestId: requests[0].requestId, decision: "allow" }, f.driver);
  await f.attached.workerPermission.handleDriverResponse({ requestId: requests[1].requestId, decision: "deny", reason: "B only" }, f.driver);
  assert.deepEqual(await pendingA, { behavior: "allow", updatedInput: { path: "a" } });
  assert.match((await pendingB).message, /B only/);
});

test("a stale Worker generation cannot report or capture a newer generation result", async function () {
  var f = fixture(true, { versioned: true, enableMultiWorkerRuntime: true, workerDelay: 15 });
  f.worker._pairGeneration = 4;
  var tools = f.attached.getToolDefs(f.driver);
  await tools.find(function (tool) { return tool.name === "send_to_partner"; }).handler({ workerId: 2, taskId: "generation-four", message: "Old generation" });
  f.worker._pairGeneration = 5;
  var report = f.attached.getToolDefs(f.worker)[0];
  var rejected = parseToolResult(await report.handler({ taskId: "generation-four", outcome: "completed" }));
  assert.equal(rejected.status, "rejected");
  assert.match(rejected.reason, /no longer matches/);
  await new Promise(function (resolve) { setTimeout(resolve, 40); });
  assert.equal(f.worker._lastPairOutcome, undefined);
  assert.equal(f.worker._pairDelegation.taskId, "generation-four", "uncertain stale work stays retained");
});

test("V2 per-Worker interrupt is exact while human Stop blocks and aborts both Workers", async function () {
  var f = fixture(true, { versioned: true, enableMultiWorkerRuntime: true, workerDelay: 200 });
  var tools = f.attached.getToolDefs(f.driver);
  var send = tools.find(function (tool) { return tool.name === "send_to_partner"; });
  var interrupt = tools.find(function (tool) { return tool.name === "interrupt_partner"; });
  var abortedA = 0, abortedB = 0;
  f.worker.abortController = { abort: function () { abortedA++; } };
  f.workerB.abortController = { abort: function () { abortedB++; } };
  await send.handler({ workerId: 2, taskId: "stop-a", message: "Build A" });
  await send.handler({ workerId: 3, taskId: "stop-b", message: "Build B" });
  await interrupt.handler({ workerId: 2, reason: "Only A" });
  assert.equal(abortedA, 1);
  assert.equal(abortedB, 0);
  assert.equal(f.workerB.taskStopRequested, undefined);
  assert.equal(f.attached.handleHumanStop(f.driver), true);
  assert.equal(abortedA, 2);
  assert.equal(abortedB, 1);
  var blocked = await send.handler({ workerId: 3, message: "Must wait" });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /human stopped/);
  assert.equal(f.attached.beginHumanTurn(f.driver), true);
});

test("server-gated V2 structural close removes only the selected Worker", async function () {
  var f = fixture(true, { versioned: true, enableMultiWorkerRuntime: true });
  var close = f.attached.getToolDefs(f.driver).find(function (tool) { return tool.name === "close_partner"; });
  var result = await close.handler({ workerId: 2 });
  assert.equal(result.isError, undefined);
  assert.deepEqual(f.getGroup().members, [1, 3]);
  assert.deepEqual(f.getGroup().pair.workerIds, [3]);
});

test("task-control schemas parse workerId and handlers preserve exact V2 targets", async function () {
  var f = fixture(true, { versioned: true });
  var tools = f.attached.getToolDefs(f.driver);
  var names = ["queue_partner_followup", "inspect_partner_followups", "cancel_partner_followup", "replace_partner_task", "resume_partner_task"];
  var z = require("zod");
  for (var i = 0; i < names.length; i++) {
    var tool = tools.find(function (entry) { return entry.name === names[i]; });
    assert.ok(tool.inputSchema.workerId, names[i] + " exposes workerId");
    assert.equal(tool.inputSchema.workerId.isOptional(), true);
    var sample = { workerId: 3 };
    if (names[i] === "queue_partner_followup") sample.message = "queued";
    if (names[i] === "cancel_partner_followup") sample.taskId = "missing";
    if (names[i] === "replace_partner_task") { sample.targetTaskId = "missing"; sample.message = "replacement"; }
    if (names[i] === "resume_partner_task") sample.message = "resume";
    assert.doesNotThrow(function () { z.object(tool.inputSchema).parse(sample); }, names[i] + " accepts an integer workerId");
  }
  f.workerB._pairFollowups = [{ taskId: "b-task", status: "queued", message: "B work", workerId: 3 }];
  var inspect = tools.find(function (tool) { return tool.name === "inspect_partner_followups"; });
  var inspected = parseToolResult(await inspect.handler({ workerId: 3 }));
  assert.equal(inspected.current, null);
  assert.equal(inspected.queued[0].workerSessionId, undefined);
  assert.equal(inspected.queued[0].taskId, "b-task");
  var queue = tools.find(function (tool) { return tool.name === "queue_partner_followup"; });
  var blocked = await queue.handler({ workerId: 3, message: "must remain gated" });
  assert.match(blocked.content[0].text, /multi-Worker mutations remain gated/);
  assert.equal(f.workerB._pairFollowups.length, 1, "blocked V2 queue does not mutate the selected Worker");
  var wrong = await queue.handler({ workerId: 99, message: "wrong target" });
  assert.match(wrong.content[0].text, /exact configured Worker/);
  assert.equal(f.workerB._pairFollowups.length, 1, "wrong target does not mutate any queue");
});

test("send_to_partner records attribution and returns the response", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", wait: true, timeoutSeconds: 2 }));
  assert.equal(result.status, "complete");
  assert.equal(result.response, "Partner result");
  assert.equal(result.outcome.taskId, result.taskId);
  assert.equal(result.outcome.verificationAuthority, "unknown");
  assert.strictEqual(f.worker.history[0].delegated, true);
  assert.strictEqual(f.worker.history[0].delegatedBy, 1);
  assert.strictEqual(f.worker.history[0].delegatedByTitle, "Planner");
  assert.match(f.starts[0].text, /taskId=/);
  assert.match(f.starts[0].text, /Inspect the tests/);
  assert.equal(f.worker.history[0].delegatedTaskId, result.taskId);
  assert.deepStrictEqual(f.events.map(function (event) { return event.active; }), [true, false]);
  assert.strictEqual(f.worker._delegatedBy, undefined);
  assert.deepStrictEqual(f.driverPushes, []);
});

test("omitted wait returns promptly and callback resumes the Driver once", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests" }));
  assert.equal(result.status, "running");
  assert.deepStrictEqual(f.driverPushes, []);
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  assert.equal(f.driverPushes.length, 1);
  assert.match(f.driverPushes[0], /Split Worker task delegated through send_to_partner has finished/);
  assert.equal(f.worker._pairDelegation, undefined);
});

test("real completion capture retries persistence without replaying the Worker", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-capture-"));
  var filePath = path.join(directory, "pair-result-outbox.json");
  var persistCalls = 0;
  var outbox = attachOutbox({ filePath: filePath, persist: function (target, serialized) {
    persistCalls++;
    if (persistCalls === 2) return false;
    if (persistCalls === 3) throw new Error("temporary persistence failure");
    var tempPath = target + ".tmp-test";
    fs.writeFileSync(tempPath, serialized, "utf8");
    fs.renameSync(tempPath, target);
    return true;
  } });
  var f = fixture(true, { resultOutbox: outbox, driverQueryReady: true });
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Capture this" }));
  assert.equal(result.status, "running");
  await new Promise(function (resolve) { setTimeout(resolve, 300); });
  var records = outbox.status().records;
  assert.equal(records.length, 1);
  assert.equal(records[0].state, "captured");
  assert.equal(records[0].deliveryState, "accepted");
  assert.equal(f.driverPushes.length, 1);
  assert.equal(f.starts.filter(function (item) { return item.session === f.worker; }).length, 1);
  assert.equal(f.worker._pairDelegation, undefined);
  assert.equal(f.partnerResults(), 1);
  assert.equal(f.partnerResults(), 1);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("sender defers while the Driver query is starting and wakes once afterward", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-wake-"));
  var filePath = path.join(directory, "pair-result-outbox.json");
  var outbox = attachOutbox({ filePath: filePath });
  var f = fixture(true, { resultOutbox: outbox, workerDelay: 10 });
  f.driver._queryStarting = true;
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Wake this result" });
  await new Promise(function (resolve) { setTimeout(resolve, 70); });
  assert.equal(f.driverPushes.length, 0);
  assert.equal(outbox.status().records[0].deliveryState, "pending");
  f.driver._queryStarting = false;
  f.driver.queryInstance = {};
  f.attached.wakePartnerResult(f.driver, f.worker, f.worker._pairDelegation);
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  assert.equal(f.driverPushes.length, 1);
  assert.equal(outbox.status().records[0].deliveryState, "accepted");
  fs.rmSync(directory, { recursive: true, force: true });
});

test("explicit blocking wait captures without autonomous result delivery", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-blocking-"));
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json") });
  var f = fixture(true, { resultOutbox: outbox, driverQueryReady: true });
  var result = parseToolResult(await f.attached.getToolDefs(f.driver)[0].handler({ message: "Return directly", wait: true, timeoutSeconds: 2 }));
  assert.equal(result.status, "complete");
  assert.equal(f.driverPushes.length, 0);
  assert.equal(outbox.status().records[0].deliveryState, "pending");
  fs.rmSync(directory, { recursive: true, force: true });
});

test("a throwing result hook keeps a successfully saved capture pending", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-hook-"));
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json") });
  var f = fixture(true, { resultOutbox: outbox, throwPartnerResult: true });
  var result = parseToolResult(await f.attached.getToolDefs(f.driver)[0].handler({ message: "Keep this pending", wait: true, timeoutSeconds: 2 }));
  assert.equal(result.status, "capture_pending");
  assert.equal(outbox.status().records[0].state, "captured");
  assert.ok(f.worker._pairDelegation);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("false sender acceptance stays pending and never clears the Worker", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-false-"));
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json") });
  var f = fixture(true, { resultOutbox: outbox, driverQueryReady: true, driverPushAccepted: false });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Retain on false" });
  await new Promise(function (resolve) { setTimeout(resolve, 40); });
  f.attached.handleTurnDone(f.worker); f.attached.handleTurnDone(f.worker);
  await new Promise(function (resolve) { setTimeout(resolve, 210); });
  assert.equal(outbox.status().records[0].deliveryState, "pending");
  assert.ok(f.worker._pairDelegation);
  assert.equal(f.driverPushes.length, 3);
  assert.equal(outbox.status().records[0].deliveryAttemptCount, 3);
  f.attached.wakePartnerResult(f.driver, f.worker, f.worker._pairDelegation);
  assert.equal(f.driverPushes.length, 3);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("idle async sender rejection becomes uncertain without replay", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-reject-"));
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json") });
  var f = fixture(true, { resultOutbox: outbox, driverStartReject: true });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Retain on start rejection" });
  await new Promise(function (resolve) { setTimeout(resolve, 250); });
  assert.equal(outbox.status().records[0].deliveryState, "uncertain");
  assert.ok(f.worker._pairDelegation);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("missing SDK retries are bounded and a throwing live push becomes uncertain", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-sdk-"));
  var missing = attachOutbox({ filePath: path.join(directory, "missing.json") });
  var first = fixture(true, { resultOutbox: missing, disableResultSdk: true });
  await first.attached.getToolDefs(first.driver)[0].handler({ message: "Retain without SDK" });
  await new Promise(function (resolve) { setTimeout(resolve, 80); });
  assert.equal(missing.status().records[0].deliveryState, "pending");
  var throwing = attachOutbox({ filePath: path.join(directory, "throwing.json") });
  var second = fixture(true, { resultOutbox: throwing, driverQueryReady: true, driverPushThrows: true });
  await second.attached.getToolDefs(second.driver)[0].handler({ message: "Retain on throw" });
  await new Promise(function (resolve) { setTimeout(resolve, 180); });
  assert.equal(throwing.status().records[0].deliveryState, "uncertain");
  assert.ok(second.worker._pairDelegation);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("startup acceptance delayed beyond 100ms succeeds inside the real starting window", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-timeout-"));
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json") });
  var f = fixture(true, { resultOutbox: outbox, driverStartAcceptedDelay: 180 });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Accept this owned startup" });
  await new Promise(function (resolve) { setTimeout(resolve, 240); });
  assert.equal(outbox.status().records[0].deliveryState, "accepted");
  assert.equal(f.worker._pairDelegation, undefined);
  assert.equal(f.partnerResults(), 1);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("acceptance timeout stays uncertain when a late startup returns false", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-late-false-"));
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json") });
  var f = fixture(true, { resultOutbox: outbox, driverStartAcceptedDelay: 120, acceptanceTimeoutMs: 30 });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Do not replay ambiguous delivery" });
  await new Promise(function (resolve) { setTimeout(resolve, 180); });
  assert.equal(outbox.status().records[0].deliveryState, "uncertain");
  assert.equal(outbox.status().records[0].deliveryAttemptCount, 1);
  assert.ok(f.worker._pairDelegation);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("accepted delivery remains accepted after the full stream rejects", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-post-accept-"));
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json") });
  var f = fixture(true, { resultOutbox: outbox, driverStreamRejectAfterAccept: 30 });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Accept before stream failure" });
  await new Promise(function (resolve) { setTimeout(resolve, 100); });
  assert.equal(outbox.status().records[0].deliveryState, "accepted");
  assert.equal(f.partnerResults(), 1);
  assert.equal(f.worker._pairDelegation, undefined);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("failed post-acceptance persistence is retained as uncertain", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-accept-save-"));
  var calls = 0;
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json"), persist: function (target, serialized) {
    calls++;
    if (calls === 5) return false;
    return atomicPersistForTest(target, serialized);
  } });
  var f = fixture(true, { resultOutbox: outbox, driverQueryReady: true });
  f.driver._queryStarting = true;
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Retain ambiguous accepted save" });
  await new Promise(function (resolve) { setTimeout(resolve, 40); });
  f.driver._queryStarting = false;
  var wakeResult = f.attached.wakePartnerResult(f.driver, f.worker, f.worker._pairDelegation);
  assert.equal(wakeResult.ok, false);
  assert.equal(wakeResult.uncertain, true);
  assert.equal(outbox.status().records[0].deliveryState, "attempting");
  assert.equal(outbox.status().records[0].recoveryState, "uncertain");
  assert.equal(f.driverPushes.length, 1);
  assert.ok(f.worker._pairDelegation);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("failed prerequisite persistence prevents every sender call", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-persist-"));
  var calls = 0;
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json"), persist: function (target, serialized) {
    calls++;
    if (calls === 3) return false;
    return atomicPersistForTest(target, serialized);
  } });
  var f = fixture(true, { resultOutbox: outbox, driverQueryReady: true });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Do not send without state" });
  await new Promise(function (resolve) { setTimeout(resolve, 80); });
  assert.equal(outbox.status().records[0].deliveryState, "pending");
  assert.equal(f.driverPushes.length, 0);
  assert.equal(f.starts.filter(function (item) { return item.session === f.driver; }).length, 0);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("undefined durable transcript acknowledgement never reaches transport", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-transcript-ack-"));
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json") });
  var f = fixture(true, { resultOutbox: outbox, driverQueryReady: true, durableTranscriptUndefined: true,
    noDurableTranscriptEvidence: true });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Require exact durable acknowledgement" });
  await new Promise(function (resolve) { setTimeout(resolve, 250); });
  assert.equal(outbox.status().records[0].deliveryAttemptCount, 3);
  assert.equal(outbox.status().records[0].transcriptPersisted, false);
  assert.equal(f.driverPushes.length, 0);
  assert.ok(f.worker._pairDelegation);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("human Stop blocks the captured callback route before transport", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-sender-stop-"));
  var outbox = attachOutbox({ filePath: path.join(directory, "pair-result-outbox.json") });
  var f = fixture(true, { resultOutbox: outbox, workerDelay: 30, driverQueryReady: true });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Stop before callback" });
  assert.equal(f.attached.handleHumanStop(f.worker), true);
  await new Promise(function (resolve) { setTimeout(resolve, 100); });
  assert.equal(outbox.status().records[0].state, "blocked");
  assert.equal(f.driverPushes.length, 0);
  assert.ok(f.worker._pairDelegation);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("blocking completion capture retains the token when all result saves fail", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-capture-blocked-"));
  var filePath = path.join(directory, "pair-result-outbox.json");
  var calls = 0;
  var outbox = attachOutbox({ filePath: filePath, persist: function (target, serialized) {
    calls++;
    return calls === 1 ? atomicPersistForTest(target, serialized) : false;
  } });
  var f = fixture(true, { resultOutbox: outbox, workerDelay: 10 });
  var result = parseToolResult(await f.attached.getToolDefs(f.driver)[0].handler({ message: "Retain this result", wait: true, timeoutSeconds: 2 }));
  assert.equal(result.status, "capture_pending");
  await new Promise(function (resolve) { setTimeout(resolve, 120); });
  assert.equal(outbox.status().records.length, 1);
  assert.equal(outbox.status().records[0].state, "dispatching");
  assert.ok(f.worker._pairDelegation);
  assert.equal(f.partnerResults(), 0);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("an explicit wait timeout persists callback routing and later delivers", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-capture-watchdog-"));
  var filePath = path.join(directory, "pair-result-outbox.json");
  var outbox = attachOutbox({ filePath: filePath });
  var f = fixture(true, { resultOutbox: outbox, autoTurnDone: false, workerDelay: 1100 });
  var result = parseToolResult(await f.attached.getToolDefs(f.driver)[0].handler({ message: "Watch this result", wait: true, timeoutSeconds: 1 }));
  assert.equal(result.status, "running");
  await new Promise(function (resolve) { setTimeout(resolve, 1300); });
  assert.equal(outbox.status().records[0].state, "captured");
  assert.equal(outbox.status().records[0].deliveryRoute, "callback");
  assert.equal(outbox.status().records[0].deliveryState, "accepted");
  assert.equal(f.partnerResults(), 1);
  assert.equal(f.worker._pairDelegation, undefined);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("a delayed capture retry cannot finish a replacement delegation", async function () {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pair-capture-replace-"));
  var filePath = path.join(directory, "pair-result-outbox.json");
  var calls = 0;
  var outbox = attachOutbox({ filePath: filePath, persist: function (target, serialized) {
    calls++;
    return calls === 1 ? atomicPersistForTest(target, serialized) : false;
  } });
  var f = fixture(true, { resultOutbox: outbox, workerDelay: 10 });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Do not clear the replacement" });
  await new Promise(function (resolve) { setTimeout(resolve, 15); });
  var replacement = { taskId: "replacement", groupId: "sg_pair" };
  f.worker._pairDelegation = replacement;
  await new Promise(function (resolve) { setTimeout(resolve, 100); });
  assert.equal(f.partnerResults(), 0);
  assert.strictEqual(f.worker._pairDelegation, replacement);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("an unpaired Driver can only post the runtime configuration proposal", async function () {
  var f = fixture(false, { ungrouped: true });
  assert.match(f.attached.getSystemPrompt(f.driver), /runtime configuration card/);
  var initialTools = f.attached.getToolDefs(f.driver);
  assert.deepStrictEqual(initialTools.map(function (item) { return item.name; }), ["propose_worker", "inspect_worker_proposal", "cancel_worker_proposal", "worker_runtime_catalog", "respond_to_worker_permission"]);
  var tool = initialTools[0];
  assert.ok(initialTools.some(function (item) { return item.name === "respond_to_worker_permission"; }),
    "the long-lived Driver query can answer permissions after acceptance creates the pair");
  var result = parseToolResult(await tool.handler({
    summary: "Use a visible Worker",
    plan: "1. Build\n2. Test",
    message: "Build the feature",
    recommendationRationale: "The Worker runtime is suited to implementation and test execution.",
  }));
  assert.strictEqual(result.status, "posted");
  assert.strictEqual(f.getGroup(), null);
  assert.strictEqual(f.starts.length, 0);
});

test("only high-tier unpaired Drivers receive proactive Worker guidance", function () {
  var high = fixture(false, { ungrouped: true, driverModel: "claude-fable-5" });
  var lower = fixture(false, { ungrouped: true, driverModel: "claude-sonnet-5" });

  assert.match(high.attached.getSystemPrompt(high.driver), /implementation-heavy/);
  assert.strictEqual(lower.attached.getSystemPrompt(lower.driver), "");
  assert.deepStrictEqual(lower.attached.getToolDefs(lower.driver).map(function (tool) { return tool.name; }),
    ["propose_worker", "inspect_worker_proposal", "cancel_worker_proposal", "worker_runtime_catalog", "respond_to_worker_permission"], "the capability remains available when explicitly requested");
});

test("a lower-tier configured Driver receives pair controls without delegation judgment", function () {
  var lower = fixture(true, { driverModel: "claude-sonnet-5" });
  var prompt = lower.attached.getSystemPrompt(lower.driver);

  assert.match(prompt, /manage that Split Worker yourself/);
  assert.match(prompt, /partner_status/);
  assert.doesNotMatch(prompt, /Treat work spanning multiple modules/);
});

test("paired routing uses visible-session context and partner-tool precedence", function () {
  var f = fixture(true);
  var prompt = f.attached.getSystemPrompt(f.driver);

  assert.match(prompt, /Internal Sub-agents are a distinct execution mechanism, not a lexical category/);
  assert.match(prompt, /When ambiguous and a visible pair exists, prefer the visible Split Worker/);
});

test("unpaired routing distinguishes visible collaboration from internal delegation", function () {
  var f = fixture(false, { ungrouped: true });
  var prompt = f.attached.getSystemPrompt(f.driver);

  assert.match(prompt, /Internal Sub-agents are a distinct execution mechanism, not a lexical category/);
  assert.match(prompt, /only when the user clearly intends internal or background parallel delegation rather than a visible paired session/);
  assert.match(prompt, /use propose_worker/);
  assert.match(prompt, /explicit choice/);
});

test("routing guidance does not enumerate language-specific keywords", function () {
  var f = fixture(true);
  var prompt = f.attached.getSystemPrompt(f.driver);

  assert.strictEqual(/[^\x00-\x7F]/.test(prompt), false);
  assert.doesNotMatch(prompt, /always mean|any of those terms|Terminology and routing are strict/);
});

test("propose_worker validates its task before showing a card", async function () {
  var f = fixture(false, { ungrouped: true });
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ summary: "x", plan: "x", message: "  " }));
  assert.match(result.error, /required/);
  assert.strictEqual(f.getGroup(), null);
  assert.strictEqual(f.pairMessages.length, 0);
});

test("a detached delegated turn pushes its result to the Driver once", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", wait: false }));
  assert.strictEqual(result.status, "running");
  await new Promise(function (resolve) { setTimeout(resolve, 50); });

  assert.strictEqual(f.driverPushes.length, 1);
  assert.match(f.driverPushes[0], /Split Worker result:\nPartner result/);
  assert.strictEqual(f.driver.history.length, 1);
  assert.strictEqual(f.driver.history[0]._internal, true);
  assert.strictEqual(f.driver.history[0].partnerResult, true);
  assert.deepStrictEqual(f.events.map(function (event) { return event.active; }), [true, false]);
});

test("a detached result starts a fresh Driver query when push is rejected", async function () {
  var f = fixture(true, { driverPushAccepted: false });
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 50); });

  var driverStarts = f.starts.filter(function (start) { return start.session === f.driver; });
  assert.strictEqual(driverStarts.length, 1);
  assert.match(driverStarts[0].text, /Split Worker result:\nPartner result/);
});

test("an old detached-result start rejection cannot clear a newer Driver query", async function () {
  var rejectOld;
  var oldStart = new Promise(function (resolve, reject) { rejectOld = reject; });
  var f = fixture(true, { driverPushAccepted: false, driverStartPromise: oldStart });
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  f.driver._queryGeneration += 1;
  f.driver.isProcessing = true;
  rejectOld(new Error("old query failed"));
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.equal(f.driver.isProcessing, true);
  assert.equal(f.driver.history.some(function (entry) { return entry.type === "error" && entry.text === "old query failed"; }), false);
});

test("the current detached-result start rejection clears its Driver query", async function () {
  var rejectCurrent;
  var currentStart = new Promise(function (resolve, reject) { rejectCurrent = reject; });
  var f = fixture(true, { driverPushAccepted: false, driverStartPromise: currentStart });
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  rejectCurrent(new Error("current query failed"));
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.equal(f.driver.isProcessing, false);
  assert.equal(f.driver.history.some(function (entry) { return entry.type === "error" && entry.text === "current query failed"; }), true);
});

test("the initiating lazy query rejection clears processing after its query instance changes", async function () {
  var rejectCurrent;
  var currentStart = new Promise(function (resolve, reject) { rejectCurrent = reject; });
  var f = fixture(true, { driverPushAccepted: false, driverStartPromise: currentStart, onDriverStart: function (session) {
    Promise.resolve().then(function () { session.queryInstance = { id: "current-lazy-query" }; });
  } });
  f.driver.queryInstance = { id: "previous-query" };
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  rejectCurrent(new Error("lazy query failed"));
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.equal(f.driver.isProcessing, false);
  assert.equal(f.driver.history.some(function (entry) { return entry.type === "error" && entry.text === "lazy query failed"; }), true);
});

test("a detached-result rejection cannot mutate a replacement Driver session", async function () {
  var rejectOld;
  var oldStart = new Promise(function (resolve, reject) { rejectOld = reject; });
  var f = fixture(true, { driverPushAccepted: false, driverStartPromise: oldStart });
  await f.attached.getToolDefs(f.driver)[0].handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  var replacement = Object.assign({}, f.driver, { isProcessing: true, history: [] });
  f.sessions.set(f.driver.localId, replacement);
  rejectOld(new Error("replaced query failed"));
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.equal(replacement.isProcessing, true); assert.deepEqual(replacement.history, []);
});

test("the detached monitor delivers failures even when no normal turn-done event arrives", async function () {
  var f = fixture(true, { autoTurnDone: false, workerError: "Worker crashed" });
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 550); });

  assert.strictEqual(f.driverPushes.length, 1);
  assert.match(f.driverPushes[0], /Split Worker error:\nWorker crashed/);
  assert.strictEqual(f.worker._pairDelegation, undefined);
});

test("waiting for an interrupted Worker returns its partial response and interrupted status", async function () {
  var f = fixture(true, { workerInterrupted: true });
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", wait: true, timeoutSeconds: 2 }));
  assert.equal(result.status, "interrupted");
  assert.equal(result.response, "Partial implementation");
  assert.equal(result.outcome.status, "interrupted");
  assert.deepStrictEqual(f.driverPushes, []);
});

test("the detached monitor reports interruption as partial, not completion", async function () {
  var f = fixture(true, { workerInterrupted: true });
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 550); });

  assert.strictEqual(f.driverPushes.length, 1);
  assert.match(f.driverPushes[0], /Split Worker execution interrupted/);
  assert.match(f.driverPushes[0], /PARTIAL/);
  assert.doesNotMatch(f.driverPushes[0], /completed/);
});

test("a human Worker stop suppresses push-back and blocks retries until a new Driver message", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  assert.equal(f.attached.handleHumanStop(f.worker), true);
  await new Promise(function (resolve) { setTimeout(resolve, 50); });

  assert.deepStrictEqual(f.driverPushes, [], "the stopped result cannot wake the Driver");
  var blocked = await tool.handler({ message: "Retry automatically" });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /human stopped/);

  assert.equal(f.attached.beginHumanTurn(f.driver), true);
  var resumed = parseToolResult(await tool.handler({ message: "The human asked to continue", wait: true, timeoutSeconds: 2 }));
  assert.equal(resumed.status, "complete");
});

test("operation ids keep a replayed delegation from being sent twice", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  var args = { message: "Inspect once", wait: true, timeoutSeconds: 2, operationId: "turn-7-send-1" };
  var first = await tool.handler(args);
  var second = await tool.handler(args);

  assert.deepStrictEqual(second, first);
  assert.equal(f.starts.length, 1);
  assert.equal(f.worker.history.filter(function (item) { return item.type === "user_message"; }).length, 1);
  var altered = await tool.handler({ message: "Different task", timeoutSeconds: 2, operationId: "turn-7-send-1" });
  assert.equal(altered.isError, true);
  assert.match(altered.content[0].text, /different input/);
  assert.equal(f.starts.length, 1);
});

test("a new Worker turn clears an earlier interrupted state", async function () {
  var f = fixture(true);
  f.worker._lastTurnInterrupted = true;
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", wait: true, timeoutSeconds: 2 }));
  assert.equal(result.status, "complete");
  assert.equal(result.response, "Partner result");
});

test("a user-started Worker turn never pushes to the Driver", function () {
  var f = fixture(true);
  f.worker.history.push({ type: "user_message", text: "User request" });
  f.worker.history.push({ type: "delta", text: "User-requested result" });

  assert.strictEqual(f.attached.handleTurnDone(f.worker), false);
  assert.deepStrictEqual(f.driverPushes, []);
  assert.deepStrictEqual(f.driver.history, []);
});

test("only the Driver can interrupt a configured Worker's active task", async function () {
  var f = fixture(true);
  var stopped = false;
  f.worker.isProcessing = true;
  f.worker.abortController = { abort: function () { stopped = true; } };
  var tool = f.attached.getToolDefs(f.driver)[2];
  var result = parseToolResult(await tool.handler({}));

  assert.deepStrictEqual(result, { status: "interrupting", partnerId: 2, title: "Builder" });
  assert.strictEqual(stopped, true);
  assert.strictEqual(f.worker.taskStopRequested, true);
  var workerTool = f.attached.getToolDefs(f.worker).find(function (item) { return item.name === "interrupt_partner"; });
  assert.strictEqual(workerTool, undefined);
});

test("the Driver can close an idle Worker while preserving its session", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[3];
  var result = parseToolResult(await tool.handler({}));

  assert.deepStrictEqual(result, { status: "closed", partnerId: 2, interrupted: false, historyPreserved: true });
  assert.strictEqual(f.getGroup(), null);
  // Once ungrouped, this ordinary project chat may become a Driver regardless
  // of its selected model. Closing the pair changes its role, not its agency.
  assert.ok(f.attached.getToolDefs(f.worker).length > 0);
});

test("closing a running Worker interrupts it before dissolving the pair", async function () {
  var f = fixture(true);
  var stopped = false;
  f.worker.isProcessing = true;
  f.worker.abortController = { abort: function () { stopped = true; } };
  var tool = f.attached.getToolDefs(f.driver)[3];
  var result = parseToolResult(await tool.handler({}));

  assert.strictEqual(result.status, "closed");
  assert.strictEqual(result.interrupted, true);
  assert.strictEqual(stopped, true);
  assert.strictEqual(f.worker.taskStopRequested, true);
  assert.strictEqual(f.getGroup(), null);
});

test("a role change invalidates a detached Worker completion", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  f.group.pair = { driverId: 2, workerId: 1 };
  await new Promise(function (resolve) { setTimeout(resolve, 50); });

  assert.deepStrictEqual(f.driverPushes, []);
  assert.deepStrictEqual(f.driver.history, []);
  assert.strictEqual(f.worker._pairDelegation, undefined);
});

test("a delegated session cannot delegate back", async function () {
  var f = fixture(false);
  f.worker._delegatedBy = 1;
  var tool = f.attached.getToolDefs(f.worker)[0];
  var result = await tool.handler({ message: "Send this back" });
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0].text, /cannot delegate/);
});

test("recentTurns returns user-delimited partner turns with capped selection", function () {
  var session = { history: [
    { type: "user_message", text: "First" }, { type: "delta", text: "One" },
    { type: "user_message", text: "Second", delegated: true }, { type: "delta", text: "Two" },
  ] };
  assert.deepStrictEqual(pairModule.recentTurns(session, 1), [{ user: "Second", delegated: true, response: "Two" }]);
});
