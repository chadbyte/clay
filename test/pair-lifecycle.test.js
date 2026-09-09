// Split Worker lifecycle: proposal-gated creation, bounded capacity status,
// safe replacement that preserves history, the active-worker interrupt gate,
// model availability, and the per-generation evaluation ledger.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var pairModule = require("../lib/project-session-pair");

var CLAUDE_CATALOG = [
  { value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" },
  { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Claude Sonnet" },
];
var CODEX_CATALOG = ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"];

function parse(result) { return JSON.parse(result.content[0].text); }

function toolNamed(tools, name) {
  for (var i = 0; i < tools.length; i++) {
    if (tools[i].name === name) return tools[i];
  }
  return null;
}

// A world with a real attachSessionPair over a mutable split store. Worker
// sessions are created for real (fresh objects), so replacement can be observed
// as a genuinely different session that leaves the old one in place.
function makeWorld(options) {
  var opts = options || {};
  var nextId = 10;
  var driver = {
    localId: 1, ownerId: opts.ownerId || null, title: "Planner", vendor: opts.driverVendor || "claude",
    model: opts.driverModel === undefined ? "claude-fable-5" : opts.driverModel,
    history: [], isProcessing: false,
  };
  var sessions = new Map([[1, driver]]);
  var groups = [];
  var created = [];
  var sessionEvents = [];
  // The real module starts a 500ms monitor interval for a detached
  // delegation. Tests complete delegations explicitly instead of waiting on
  // that clock, and every interval this world creates is tracked so no test
  // leaves a timer behind.
  var intervals = [];
  var nextGroup = 1;
  var world = null;
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
    sendToSession: function (session, message) { sessionEvents.push({ session: session, message: message }); },
    broadcastSessionList: function () {},
    createSessionRaw: function (spec) {
      var s = {
        localId: nextId++, ownerId: spec.ownerId || null, vendor: spec.vendor,
        model: spec.model || null, effort: spec.effort || null,
        history: [], isProcessing: false, lastActivity: Date.now(),
      };
      sessions.set(s.localId, s);
      created.push(s);
      return s;
    },
  };

  // Mirrors the real bridge: a queued push is only accepted by a live query,
  // so a fresh Worker goes through startQuery. Returning true here would leave
  // the Worker permanently "processing" and every default-wait delegation would
  // poll until its deadline.
  var sdk = {
    pushMessage: function () { return false; },
    startQuery: function (session, text) {
      session.history.push({ type: "delta", text: "worker result" });
      session.isProcessing = false;
      return Promise.resolve();
    },
  };

  var attached = pairModule.attachSessionPair({
    sm: sm,
    splitStore: {
      groupForMember: function (id) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].members.indexOf(id) !== -1) return groups[i];
        }
        return null;
      },
      create: function (ws, msg) {
        // Lets a test fail exactly one group write, to exercise the
        // post-dissolve rollback path. The restore call that follows is
        // allowed through, which is what the rollback depends on.
        if (world && world.failNextCreate) {
          world.failNextCreate = false;
          return { ok: false, error: "A session can belong to only one split group" };
        }
        var g = { id: "sg_" + (nextGroup++), members: msg.members.slice(), pair: msg.pair,
          ownerId: ws && ws._clayUser ? ws._clayUser.id : null };
        groups.push(g);
        return { ok: true, group: g };
      },
      dissolve: function (ws, msg) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].id !== msg.id) continue;
          var removed = groups.splice(i, 1)[0];
          return { ok: true, group: removed };
        }
        return { ok: false, error: "Split group not found" };
      },
    },
    getSdk: function () { return sdk; },
    send: function () {},
    sendTo: function () {},
    usersModule: { isMultiUser: function () { return !!opts.multiUser; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
  });

  world = {
    attached: attached, driver: driver, sm: sm, sessions: sessions,
    groups: groups, created: created, sdk: sdk, sessionEvents: sessionEvents,
    tools: function (session) { return attached.getToolDefs(session || driver); },
    tool: function (name, session) { return toolNamed(attached.getToolDefs(session || driver), name); },
    worker: function () {
      var g = groups[0];
      return g && g.pair ? sessions.get(g.pair.workerId) : null;
    },
    // Finish whatever the Worker was handed, the way the real bridge does on
    // turn completion, and drop the monitor interval that a detached
    // delegation started. Deterministic: no timer has to fire.
    completeTurn: function (session) {
      var target = session || world.worker();
      if (target) attached.handleTurnDone(target);
      world.clearTimers();
    },
    clearTimers: function () {
      for (var i = 0; i < intervals.length; i++) clearInterval(intervals[i]);
      intervals.length = 0;
    },
    dispose: function () {
      world.clearTimers();
      global.setInterval = realSetInterval;
    },
    pendingTimers: function () { return intervals.length; },
    failNextCreate: false,
  };
  return world;
}

// Delegate, then let the Worker's turn complete the way the real bridge does.
// Without the turn-done hook the delegation token stays open, and a Worker
// holding an open delegated task is legitimately not safe to replace.
async function makePair(world, message) {
  if (!world.worker()) {
    var proposalTool = world.tool("propose_worker");
    var posted = parse(await proposalTool.handler({
      summary: "Use a visible Split Worker",
      plan: "1. Execute the task\n2. Report the result",
      message: message || "Build it",
      recommendedVendor: "codex",
      recommendedModel: "gpt-5.6-sol",
      recommendedEffort: "medium",
      recommendationRationale: "Codex Sol at medium effort is a balanced fit for implementation and reporting.",
    }));
    var accepted = await world.attached.respondToWorkerProposal({ _clayActiveSession: 1 }, {
      proposalId: posted.proposalId,
      accepted: true,
      vendor: "codex",
      model: "gpt-5.6-sol",
      effort: "medium",
    });
    await Promise.resolve();
    world.completeTurn();
    return { partnerId: world.worker().localId, accepted: accepted.ok };
  }
  var send = world.tool("send_to_partner");
  var result = parse(await send.handler({ message: message || "Build it", wait: false }));
  world.completeTurn();
  await Promise.resolve();
  return result;
}

async function replaceThroughProposal(world, args) {
  var input = Object.assign({
    message: "Continue the delegated work",
    recommendationRationale: "A fresh Codex Worker at medium effort fits the next implementation task.",
  }, args || {});
  var pending = world.driver.history.filter(function (item) {
    return item && item.type === "worker_proposal" && item.action === "replace" && item.status === "pending";
  });
  var proposal = pending[pending.length - 1];
  if (!proposal) {
    var posted = parse(await world.tool("replace_partner").handler(input));
    if (posted.error) return { isError: true, content: [{ type: "text", text: "Error: " + posted.error }] };
    proposal = world.driver.history.filter(function (item) {
      return item && item.type === "worker_proposal" && item.proposalId === posted.proposalId;
    })[0];
  }
  var response;
  try {
    response = await world.attached.respondToWorkerProposal({ _clayActiveSession: 1 }, {
      proposalId: proposal.proposalId,
      accepted: true,
      vendor: args && args.workerVendor || proposal.recommendedVendor,
      model: args && args.workerModel || proposal.recommendedModel,
      effort: args && args.workerEffort || proposal.recommendedEffort,
    });
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: "Error: " + (e.message || String(e)) }] };
  }
  if (!response.ok) return { isError: true, content: [{ type: "text", text: "Error: " + response.error }] };
  await new Promise(function (resolve) { setImmediate(resolve); });
  return { content: [{ type: "text", text: JSON.stringify(response.replacement) }] };
}

// --- Direct creation, no proposal ----------------------------------------

test("an eligible Driver is paired explicitly before seamless delegation", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  assert.equal(world.groups.length, 0, "no pair yet");

  var result = await makePair(world, "Implement the parser");
  assert.equal(result.accepted, true, "the Worker was created after acceptance");
  assert.equal(world.groups.length, 1);
  assert.deepEqual(world.groups[0].pair, { driverId: 1, workerId: world.worker().localId });

  assert.equal(world.tool("propose_worker"), null, "the creation proposal is no longer offered after pairing");
  var proposalSource = fs.readFileSync(path.join(root, "lib/project-worker-proposal.js"), "utf8");
  assert.match(proposalSource, /name: "propose_worker"/);
});

test("the proposal path stays loadable and response-routed", function () {
  var proposal = require("../lib/project-worker-proposal");
  assert.equal(typeof proposal.attachWorkerProposal, "function");
  var source = fs.readFileSync(path.join(root, "lib/project-worker-proposal.js"), "utf8");
  assert.match(source, /function handleMessage/, "the client message handler is still present");
  assert.match(source, /function getToolDefs/, "the definitions are offered while unpaired");
  var pairSource = fs.readFileSync(path.join(root, "lib/project-session-pair.js"), "utf8");
  assert.match(pairSource, /if \(workerProposal\.handleMessage\(ws, msg\)\) return true;/,
    "so an in-flight worker_proposal_response still resolves");
});

test("Codex keeps a stable pair tool catalog across proposal acceptance", async function (t) {
  var world = makeWorld({ driverVendor: "codex" });
  t.after(world.dispose);
  var initialTools = world.tools();
  var initialNames = initialTools.map(function (tool) { return tool.name; });
  var capturedSend = toolNamed(initialTools, "send_to_partner");

  assert.ok(initialNames.indexOf("propose_worker") !== -1);
  assert.ok(capturedSend, "the future paired tool is registered when the Codex thread starts");
  assert.ok(initialNames.indexOf("partner_status") !== -1);

  await makePair(world, "Implement the parser");

  var pairedNames = world.tools().map(function (tool) { return tool.name; });
  assert.deepEqual(pairedNames, initialNames, "resuming the Codex thread does not require a catalog update");
  var result = parse(await capturedSend.handler({ message: "Fix the parser", wait: false }));
  assert.equal(result.status, "running", "the handler resolves the newly created pair at call time");
  world.completeTurn();
});

// --- Bounded status -------------------------------------------------------

test("partner_status reports bounded capacity and no transcript", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();
  worker.lastContextUsage = { input_tokens: 40000, contextWindow: 200000 };
  worker.history.push({ type: "user_message", text: "secret task detail" });
  worker.history.push({ type: "delta", text: "a very long private answer" });

  var status = parse(await world.tool("partner_status").handler({}));

  assert.equal(status.worker.sessionId, worker.localId);
  assert.equal(status.worker.vendor, "codex");
  assert.equal(status.worker.generation, 1);
  assert.equal(status.identity.sessionId, worker.localId);
  assert.equal(status.identity.kind, "worker");
  assert.equal(status.configuration.model, "gpt-5.6-sol");
  assert.equal(typeof status.time.observedAt, "number");
  assert.equal(status.context.current.source, "adapter_context_usage");
  assert.equal(status.context.current.usedTokens, 40000);
  assert.equal(status.context.current.windowTokens, 200000);
  assert.equal(status.context.current.usedRatio, 0.2, "capacity ratio from authoritative accounting");
  assert.equal(status.continuity.userTurns >= 1, true);
  assert.equal(typeof status.continuity.historyEntries, "number");
  assert.equal(status.replaceSafe, true);
  assert.equal(status.replaceBlockedReason, null);
  assert.equal(Object.prototype.hasOwnProperty.call(status, "driverTier"), false,
    "status does not imply a model-tier policy");

  var text = JSON.stringify(status);
  assert.equal(text.indexOf("a very long private answer"), -1, "no transcript is returned");
  assert.equal(text.indexOf("secret task detail"), -1);
});

test("status separates current context from cumulative and last-task usage", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();
  worker.history.push({
    type: "result",
    usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 },
  });

  var status = parse(await world.tool("partner_status").handler({}));
  assert.equal(status.context.current.source, "unavailable");
  assert.equal(status.context.current.usedTokens, null, "an accumulated result total is not presented as current context");
  assert.equal(status.context.current.usedRatio, null);
  assert.equal(status.context.current.scope, "unknown");
  assert.deepEqual(status.context.cumulative, { inputTokens: 100, outputTokens: 50, tasksObserved: 1, scope: "loaded_session_history", complete: false });
  assert.deepEqual(status.context.lastTask, { inputTokens: 100, outputTokens: 50, currentInputTokens: null });
  assert.deepEqual(status.context.compactions, { observedCount: 0, active: false, lastObservedAt: null, scope: "loaded_session_history", complete: false });
});

test("status uses an exact last-stream reading and reports observed compactions", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();
  worker.history.push({ type: "compacting", active: true, _ts: 100 });
  worker.history.push({ type: "compacting", active: false, _ts: 200 });
  worker.history.push({ type: "result", usage: { input_tokens: 300, output_tokens: 20 }, lastStreamInputTokens: 175 });
  var status = parse(await world.tool("partner_status").handler({}));
  assert.equal(status.context.current.source, "last_stream_input");
  assert.equal(status.context.current.usedTokens, 175);
  assert.deepEqual(status.context.compactions, { observedCount: 1, active: false, lastObservedAt: 200, scope: "loaded_session_history", complete: false });
});

test("status uses the latest matching model window and leaves missing usage unknown", function () {
  var status = pairModule.attachSessionPair;
  assert.equal(typeof status, "function");
  var context = require("../lib/project-pair-lifecycle").contextStatus({
    vendor: "codex", model: "model-b", history: [
      { type: "result", usage: null, modelUsage: { "model-b": { contextWindow: 1000 } } },
      { type: "result", usage: null, modelUsage: { "other": { contextWindow: 9999 }, "model-b": { contextWindow: 2000 } } },
    ],
  });
  assert.equal(context.current.windowTokens, 2000);
  assert.equal(context.current.usedTokens, null);
  assert.equal(context.current.scope, "partial_current_context");
  assert.equal(context.cumulative.inputTokens, null);
  assert.equal(context.cumulative.outputTokens, null);
  assert.equal(context.cumulative.tasksObserved, 2);
});

test("status marks an active Worker unsafe to replace", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  world.worker().isProcessing = true;

  var status = parse(await world.tool("partner_status").handler({}));
  assert.equal(status.replaceSafe, false);
  assert.match(status.replaceBlockedReason, /mid-turn/);
});

// --- Reuse ----------------------------------------------------------------

test("a second delegation reuses the same Worker session", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world, "First task");
  var first = world.worker().localId;

  var again = await makePair(world, "Second task");
  assert.equal(again.workerCreated, undefined, "delegation results have no legacy creation field");
  assert.equal(world.worker().localId, first, "the same session handled it");
  assert.equal(world.groups.length, 1);
});

test("message_partner reports runtime queue acceptance without claiming delivery", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();
  var pushes = [];
  world.sdk.pushMessage = function (target, message) { pushes.push({ target: target, message: message }); return true; };
  worker.isProcessing = true;
  var delivered = parse(await world.tool("message_partner").handler({ message: "Keep the API narrow", requestId: "msg-1" }));
  assert.deepEqual(delivered, { status: "queued", requestId: "msg-1", partnerId: worker.localId, acknowledgement: "input_queue", runtimeState: "active" });
  assert.equal(worker._pairDelegation, undefined);
  assert.equal(worker.history[worker.history.length - 1].type, "partner_message");
  var replay = parse(await world.tool("message_partner").handler({ message: "Keep the API narrow", requestId: "msg-1" }));
  assert.deepEqual(replay, delivered);
  assert.equal(pushes.length, 1, "the request id deduplicates a replay within the human turn");
  var altered = parse(await world.tool("message_partner").handler({ message: "Different payload", requestId: "msg-1" }));
  assert.equal(altered.status, "rejected");
  assert.match(altered.reason, /different input/);
  assert.equal(pushes.length, 1);

  worker._queryStarting = true;
  var queued = parse(await world.tool("message_partner").handler({ message: "Also run the focused test", requestId: "msg-2" }));
  assert.equal(queued.status, "queued");
  assert.equal(queued.acknowledgement, "input_queue");
  assert.equal(pushes.length, 2);
});

test("message_partner rejects idle delivery and cannot bypass a human Stop", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();
  var pushes = 0;
  world.sdk.pushMessage = function () { pushes++; return true; };
  var idle = parse(await world.tool("message_partner").handler({ message: "Do more", requestId: "msg-idle" }));
  assert.equal(idle.status, "rejected");
  assert.match(idle.reason, /no active turn/);

  worker.isProcessing = true;
  assert.equal(world.attached.handleHumanStop(worker), true);
  var stopped = parse(await world.tool("message_partner").handler({ message: "Retry", requestId: "msg-stopped" }));
  assert.equal(stopped.status, "rejected");
  assert.match(stopped.reason, /human stopped/);
  assert.equal(pushes, 0);
});

test("a queued follow-up promotes its exact record through the real delegation path once", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();
  var starts = [];
  world.sdk.startQuery = function (target, message) {
    starts.push({ target: target, message: message });
    return Promise.resolve();
  };
  var running = parse(await world.tool("send_to_partner").handler({ message: "First", wait: false, taskId: "task-first" }));
  assert.equal(running.status, "running");
  var queued = parse(await world.tool("queue_partner_followup").handler({ message: "Second", taskId: "task-second" }));
  assert.equal(queued.status, "queued");
  worker.history.push({ type: "delta", text: "first partial" });
  worker.isProcessing = false;
  world.completeTurn(worker);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(worker._pairDelegation.taskId, "task-second");
  assert.equal(worker._pairDelegation.status, "running");
  var workerStarts = starts.filter(function (item) { return item.target === worker; });
  assert.equal(workerStarts.length, 2, "each Worker task starts once");
  assert.match(workerStarts[1].message, /taskId=task-second generation=1/);
  var inspected = parse(await world.tool("inspect_partner_followups").handler({}));
  assert.equal(inspected.current.taskId, "task-second");
  assert.equal(inspected.queued.length, 0);
});

test("a captured send_to_partner handler cannot create after its exact pair is gone", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var captured = world.tool("send_to_partner");
  var sessionCount = world.sessions.size;
  var createdCount = world.created.length;
  var creationReservations = world.driver._pairTurnControl.creations;

  world.groups.length = 0;
  var result = await captured.handler({ message: "Bypass the proposal", wait: false });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /requires an exact existing Driver\/Split Worker pair/);
  assert.match(result.content[0].text, /call propose_worker while unpaired/);
  assert.equal(world.groups.length, 0, "no pair was recreated");
  assert.equal(world.sessions.size, sessionCount, "no session was created");
  assert.equal(world.created.length, createdCount, "the factory was never reached");
  assert.equal(world.driver._pairTurnControl.creations, creationReservations, "no creation reservation was made");
});

// --- Replacement ----------------------------------------------------------

test("replace_partner swaps in a fresh Worker and preserves the old session", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var oldWorker = world.worker();
  oldWorker.history.push({ type: "user_message", text: "old work" });

  var result = parse(await replaceThroughProposal(world, {}));

  assert.equal(result.status, "replaced");
  var status = parse(await world.tool("partner_status").handler({}));
  assert.equal(status.replacement.transactionId, result.transactionId);
  assert.equal(status.replacement.status, "completed");
  assert.equal(status.replacement.stage, "committed");
  assert.equal(result.previousWorkerSessionId, oldWorker.localId);
  assert.equal(result.previousWorkerHistoryPreserved, true);
  assert.equal(result.generation, 2, "the new Worker is generation 2");
  assert.notEqual(result.workerSessionId, oldWorker.localId, "a genuinely different session");

  // The old session still exists with its history intact and is no longer paired.
  assert.equal(world.sessions.has(oldWorker.localId), true, "not deleted");
  assert.equal(oldWorker.history.length > 0, true, "history preserved");
  assert.equal(world.groups.length, 1, "exactly one pair");
  assert.equal(world.groups[0].pair.workerId, result.workerSessionId);
  assert.notEqual(world.groups[0].pair.workerId, oldWorker.localId);
  assert.equal(oldWorker.sessionProvenance.kind, "worker");
  assert.equal(world.worker().sessionProvenance.parentSessionOriginId, oldWorker.sessionProvenance.parentSessionOriginId);
  assert.equal(world.worker().sessionProvenance.generation, 2);
  assert.deepEqual(world.tools(oldWorker), [], "a replaced historical Worker never resurfaces as a Driver");
  assert.equal(world.attached.getSystemPrompt(oldWorker), "", "a historical Worker receives no Driver proposal prompt");
});

test("dissolving a factory-created pair preserves Worker classification", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();
  var close = world.tool("close_partner");
  var result = parse(await close.handler({}));
  assert.equal(result.status, "closed");
  assert.equal(world.groups.length, 0);
  assert.equal(worker.sessionProvenance.kind, "worker");
  assert.deepEqual(world.tools(worker), []);
  assert.equal(world.attached.getSystemPrompt(worker), "");
});

test("replacement is limited to one successful generation per human turn", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);

  var first = parse(await replaceThroughProposal(world, {}));
  assert.equal(first.status, "replaced");
  var blocked = await replaceThroughProposal(world, {});
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /replacement limit/);
  assert.equal(world.created.length, 2, "the blocked retry creates no session");

  world.attached.beginHumanTurn(world.driver);
  var nextTurn = parse(await replaceThroughProposal(world, {}));
  assert.equal(nextTurn.status, "replaced");
  assert.equal(world.created.length, 3);
});

test("replacement refuses an active Worker unless interrupt is explicit", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();
  var aborted = false;
  worker.isProcessing = true;
  worker.abortController = { abort: function () { aborted = true; } };

  var refused = await replaceThroughProposal(world, {});
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /mid-turn/);
  assert.match(refused.content[0].text, /interrupt set to true/);
  assert.equal(aborted, false, "nothing was stopped");
  assert.equal(world.groups[0].pair.workerId, worker.localId, "the pair is untouched");

  var refusedProposal = world.driver.history.filter(function (item) {
    return item && item.type === "worker_proposal" && item.action === "replace" && item.status === "pending";
  })[0];
  await world.attached.respondToWorkerProposal({ _clayActiveSession: 1 }, {
    proposalId: refusedProposal.proposalId, accepted: false,
  });

  var forced = parse(await replaceThroughProposal(world, { interrupt: true }));
  assert.equal(forced.status, "replaced");
  assert.equal(forced.interrupted, true);
  assert.equal(aborted, true, "the old Worker was stopped first");
  assert.equal(worker.taskStopRequested, true);
});

test("partner status exposes the exact replacement waiting for approval", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var posted = parse(await world.tool("replace_partner").handler({
    message: "Independent review", recommendationRationale: "A fresh context is appropriate for independent review.",
  }));
  var status = parse(await world.tool("partner_status").handler({}));
  assert.equal(status.proposal.status, "pending");
  assert.equal(status.proposal.proposal.proposalId, posted.proposalId);
  assert.equal(status.proposal.proposal.action, "replace");
  assert.equal(typeof status.proposal.proposal.createdAt, "number");
  assert.match(status.proposal.proposal.transactionId, /^replace_/);
  assert.equal(status.replacement, null, "no replacement transaction starts before approval");
});

test("replacement can deliver the next task to the new Worker atomically", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world, "Old task");
  var oldWorker = world.worker();

  var result = parse(await replaceThroughProposal(world, { message: "Fresh task", wait: false }));
  assert.equal(result.status, "replaced");

  var newWorker = world.worker();
  assert.notEqual(newWorker.localId, oldWorker.localId);
  var delegated = newWorker.history.filter(function (h) { return h.type === "user_message"; });
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0].text, "Fresh task");
  assert.equal(delegated[0].delegatedBy, 1);
});

test("late completion from an interrupted old generation cannot attach to its replacement", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var oldWorker = world.worker();
  oldWorker.isProcessing = true;
  oldWorker.abortController = { abort: function () {} };
  var send = world.tool("send_to_partner");
  world.sdk.pushMessage = function () { return true; };
  var running = parse(await send.handler({ message: "Old generation task", wait: false, taskId: "old-task" }));
  assert.equal(running.status, "running");
  var replaced = parse(await replaceThroughProposal(world, { interrupt: true }));
  var newWorker = world.worker();
  assert.notEqual(newWorker.localId, oldWorker.localId);
  assert.equal(replaced.generation, newWorker._pairGeneration);
  var completionCount = world.sessionEvents.filter(function (event) { return event.message.type === "partner_task_completed"; }).length;
  oldWorker.history.push({ type: "delta", text: "late old result" });
  oldWorker.isProcessing = false;
  assert.equal(world.attached.handleTurnDone(oldWorker), false);
  assert.equal(newWorker._lastPairOutcome, undefined);
  assert.equal(world.sessionEvents.filter(function (event) { return event.message.type === "partner_task_completed"; }).length, completionCount);
});

test("replacement cancels anything the old Worker was waiting on", function () {
  var lifecycleSource = fs.readFileSync(path.join(root, "lib/project-pair-lifecycle.js"), "utf8");
  assert.match(lifecycleSource, /ctx\.cancelWorkerPermissions\(oldWorker, "The Driver replaced this Split Worker\."\)/,
    "pending Worker permission decisions die with the pair");
  assert.match(lifecycleSource, /ctx\.finishDelegation\(group, caller, oldWorker, oldWorker\._pairDelegation\)/,
    "and so does an open delegation");
  var pairSource = fs.readFileSync(path.join(root, "lib/project-session-pair.js"), "utf8");
  assert.match(pairSource, /cancelWorkerPermissions: function \(worker, reason\) \{ return workerPermission\.cancelForSession\(worker, reason\); \}/);
  assert.match(lifecycleSource, /There is no archive concept in the repo to hook/,
    "and history is never deleted");
});

// --- Model availability ---------------------------------------------------

test("a Worker model must be genuinely available", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);

  var posted = parse(await world.tool("propose_worker").handler({
    summary: "x", plan: "x", message: "x", recommendationRationale: "Use a confirmed runtime.",
  }));
  await assert.rejects(world.attached.respondToWorkerProposal({ _clayActiveSession: 1 }, {
    proposalId: posted.proposalId, accepted: true, vendor: "not-installed", model: "", effort: "medium",
  }), /not installed/);
  assert.equal(world.groups.length, 0, "nothing was created");
  await world.attached.respondToWorkerProposal({ _clayActiveSession: 1 }, {
    proposalId: posted.proposalId, accepted: false,
  });

  await makePair(world);
  var badReplace = await replaceThroughProposal(world, { workerVendor: "nope" });
  assert.equal(badReplace.isError, true);
  assert.match(badReplace.content[0].text, /vendor is not installed/);

  var factorySource = fs.readFileSync(path.join(root, "lib/session-pair-factory.js"), "utf8");
  assert.match(factorySource, /function validateVendor\(vendor\) \{[\s\S]*?installed\.indexOf\(vendor\) === -1/,
    "availability is checked against the installed list, not the caller's word");
});

// --- Evaluation ledger ----------------------------------------------------

test("a recorded evaluation is bounded and comes back through status", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);

  var recorded = parse(await world.tool("record_partner_evaluation").handler({
    outcome: "Partial",
    note: "  drifted from the spec  ",
  }));
  assert.equal(recorded.status, "recorded");
  assert.equal(recorded.generation, 1);
  assert.equal(recorded.evaluation.outcome, "partial", "normalized");
  assert.equal(recorded.evaluation.note, "drifted from the spec", "trimmed");

  var status = parse(await world.tool("partner_status").handler({}));
  assert.equal(status.generations.length, 1);
  assert.equal(status.generations[0].evaluation.outcome, "partial");
  assert.equal(status.generations[0].vendor, "codex");
});

test("an evaluation outcome outside the enum is refused", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var tool = world.tool("record_partner_evaluation");
  var bad = ["great", "", "SUCCESS", null, 3, {}];
  for (var i = 0; i < bad.length; i++) {
    var res = await tool.handler({ outcome: bad[i] });
    assert.equal(res.isError, true, JSON.stringify(bad[i]) + " is refused");
    assert.match(res.content[0].text, /succeeded, partial, failed, abandoned/);
  }
  var lifecycleSource = fs.readFileSync(path.join(root, "lib/project-pair-lifecycle.js"), "utf8");
  assert.match(lifecycleSource, /var EVALUATION_OUTCOMES = \["succeeded", "partial", "failed", "abandoned"\];/);
  assert.match(lifecycleSource, /No global or cross-user ranking/,
    "no global model ranking is invented");
});

test("replacement records the observed signals for the generation it closed", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var oldWorker = world.worker();
  oldWorker.history.push({ type: "user_message", text: "t" });
  oldWorker.history.push({ type: "error", text: "boom" });
  oldWorker.lastContextUsage = { input_tokens: 5000, contextWindow: 10000 };

  await replaceThroughProposal(world, { evaluation: { outcome: "failed", note: "errored out" } });

  var status = parse(await world.tool("partner_status").handler({}));
  var closed = status.generations[0];
  assert.equal(closed.generation, 1);
  assert.equal(closed.evaluation.outcome, "failed");
  assert.equal(closed.observed.errorEntries, 1, "server-measured, not model-claimed");
  assert.equal(closed.observed.usedRatio, 0.5);
  assert.equal(status.generations.length, 2, "and the new generation is tracked");
  assert.equal(status.generations[1].generation, 2);
  assert.equal(status.generations[1].evaluation, null);
});

// --- Security -------------------------------------------------------------

test("Driver tools are available regardless of model tier", function () {
  var below = makeWorld({ driverModel: "claude-sonnet-5" });
  assert.ok(below.tools().length > 0, "Sonnet can drive when the user chooses it");

  var none = makeWorld({ driverModel: "" });
  assert.ok(none.tools().length > 0, "the provider default may resolve at query start");

  var eligible = makeWorld({ driverModel: "claude-fable-5" });
  assert.ok(eligible.tools().length > 0);
});

test("pair creation preserves explicit roles for a user-selected Driver model", function () {
  var factory = require("../lib/session-pair-factory");
  var driver = { localId: 1, ownerId: null, vendor: "claude", model: "claude-sonnet-5", history: [] };
  var sessions = new Map([[1, driver]]);
  var f = factory.attachPairFactory({
    sm: {
      sessions: sessions,
      installedVendors: ["claude", "codex"],
      modelsByVendor: { claude: CLAUDE_CATALOG, codex: CODEX_CATALOG },
      defaultModelByVendor: {},
      createSessionRaw: function (spec) {
        var s = { localId: 2, ownerId: spec.ownerId || null, vendor: spec.vendor, history: [] };
        sessions.set(2, s);
        return s;
      },
      broadcastSessionList: function () {},
      sendToSession: function () {},
    },
    splitStore: {
      groupForMember: function () { return null; },
      create: function (ws, msg) {
        return { ok: true, group: { members: msg.members, pair: msg.pair } };
      },
    },
    ctx: { isMate: false, usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {} },
  });

  var created = f.createPairRecord(
    { _clayUser: null },
    { driver: { sessionId: 1 }, worker: { vendor: "codex" } }
  );
  assert.equal(created.group.pair.driverId, driver.localId, "the existing session remains the Driver");
  assert.equal(created.group.pair.workerId, created.worker.localId, "the new session is explicitly the Worker");
});

test("only the exact live Driver of the exact pair can manage it", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();

  // The Worker cannot manage the pair.
  assert.deepEqual(world.tools(worker).map(function (tool) { return tool.name; }), ["report_partner_outcome"], "a configured Worker gets only its outcome-report tool");

  // A same-id session from another owner is refused by the lifecycle guard.
  var lifecycle = require("../lib/project-pair-lifecycle");
  assert.match(fs.readFileSync(path.join(root, "lib/project-pair-lifecycle.js"), "utf8"),
    /if \(\(caller\.ownerId \|\| null\) !== \(worker\.ownerId \|\| null\)\) throw new Error\("split partner access denied"\)/,
    "cross-owner access is denied");
  assert.equal(typeof lifecycle.attachPairLifecycle, "function");

  // A stale pair reference cannot be managed: dissolve, then try again.
  var replace = world.tool("replace_partner");
  world.groups.length = 0;
  var stale = parse(await replace.handler({ message: "Continue", recommendationRationale: "Use a fresh runtime." }));
  assert.match(stale.error, /exact paired Driver/);
});

test("replacement raises one product-choice card, not a provider permission", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  await replaceThroughProposal(world, {});
  await world.tool("record_partner_evaluation").handler({ outcome: "succeeded" });

  // Nothing in the Driver or Worker history is a permission or proposal event.
  var everything = [];
  world.sessions.forEach(function (s) { everything = everything.concat(s.history || []); });
  var gates = everything.filter(function (h) {
    return h && (h.type === "permission_request" || h.type === "worker_proposal");
  });
  assert.equal(gates.filter(function (h) { return h.type === "permission_request"; }).length, 0);
  assert.equal(gates.filter(function (h) { return h.type === "worker_proposal" && h.action === "replace"; }).length, 1);
});

test("full access auto-accepts an exact replacement recommendation through the same transaction", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var oldWorker = world.worker();
  world.driver.permissionMode = "bypassPermissions";

  var result = parse(await world.tool("replace_partner").handler({
    message: "Continue with a fresh implementation context",
    workerVendor: "codex",
    workerModel: "gpt-5.6-sol",
    workerEffort: "medium",
    recommendationRationale: "Codex Sol at medium effort fits this bounded continuation task.",
  }));
  await new Promise(function (resolve) { setImmediate(resolve); });
  var card = world.driver.history.filter(function (item) {
    return item && item.type === "worker_proposal" && item.action === "replace";
  })[0];

  assert.equal(result.status, "auto_accepted");
  assert.equal(card.autoAccepted, true);
  assert.equal(card.decisionMode, "driver_recommendation");
  assert.equal(world.sessions.has(oldWorker.localId), true, "the old Worker history remains available");
  assert.notEqual(world.worker().localId, oldWorker.localId);
});

test("full-access auto-accept still obeys the human Stop replacement barrier", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var oldWorker = world.worker();
  var oldGroup = world.groups[0];
  world.driver.permissionMode = "bypassPermissions";
  assert.equal(world.attached.handleHumanStop(oldWorker), true);

  var result = parse(await world.tool("replace_partner").handler({
    message: "Retry without a new human turn",
    workerVendor: "codex",
    workerModel: "gpt-5.6-sol",
    workerEffort: "medium",
    recommendationRationale: "A fresh Codex Worker would otherwise fit this retry.",
  }));
  var card = world.driver.history.filter(function (item) {
    return item && item.type === "worker_proposal" && item.action === "replace";
  })[0];

  assert.equal(result.status, "posted", "the failed automatic decision leaves user control pending");
  assert.equal(card.status, "pending");
  assert.match(card.error, /human stopped/);
  assert.equal(world.groups[0], oldGroup);
  assert.equal(world.worker(), oldWorker);
});

// --- Auto-approval and conventions ---------------------------------------

test("every lifecycle tool is auto-approved, in exactly the emittable forms", function () {
  var bridge = require("../lib/sdk-bridge");
  var check = bridge.createSDKBridge({
    cwd: root,
    sessionManager: { sessions: new Map(), permissionRequestIndex: {} },
    send: function () {},
  }).checkToolWhitelist;
  function allowed(name) { return !!check(name, {}); }

  var lifecycleTools = ["partner_status", "replace_partner", "interrupt_partner",
    "close_partner", "message_partner", "inspect_worker_proposal", "cancel_worker_proposal",
    "worker_runtime_catalog", "queue_partner_followup", "inspect_partner_followups",
    "cancel_partner_followup", "replace_partner_task", "resume_partner_task", "report_partner_outcome",
    "record_partner_evaluation", "respond_to_worker_permission"];
  for (var i = 0; i < lifecycleTools.length; i++) {
    assert.equal(allowed("mcp__clay-sessions__" + lifecycleTools[i]), true,
      lifecycleTools[i] + " is auto-approved under the MCP form");
    assert.equal(allowed(lifecycleTools[i]), true,
      lifecycleTools[i] + " is auto-approved under the Codex dynamic form");
  }
  // Codex canonicalizes these two itself, so only the MCP form can arrive.
  assert.equal(allowed("mcp__clay-sessions__send_to_partner"), true);
  assert.equal(allowed("mcp__clay-sessions__read_partner"), true);
  assert.equal(allowed("send_to_partner"), false, "a bare form the bridge never emits is not allowed");
  assert.equal(allowed("read_partner"), false);

  // Nothing broader, and no spoofing an unrelated server's identically named tool.
  assert.equal(allowed("mcp__clay-sessions__spawn_sessions"), false, "arbitrary session creation still prompts");
  assert.equal(allowed("mcp__evil__replace_partner"), false, "another server cannot borrow the name");
  assert.equal(allowed("mcp__evil__respond_to_worker_permission"), false);
  assert.equal(allowed("mcp__clay-sessions__evil__replace_partner"), false,
    "the server segment is matched exactly, not by trailing suffix");
  assert.equal(allowed("propose_worker"), true, "the non-mutating proposal itself is auto-approved");
  assert.equal(allowed("mcp__clay-sessions__propose_worker"), true);
  assert.equal(allowed("replace_partner_extra"), false, "no prefix matching");
});

test("the Driver prompt explains pending and audited full-access runtime decisions", function () {
  var prompts = require("../lib/session-pair-prompts");
  assert.match(prompts.DRIVER, /protect your own context/);
  assert.match(prompts.DRIVER, /keep the Split Worker compact/);
  assert.match(prompts.DRIVER, /Reuse the existing Split Worker only when its accumulated context genuinely helps/);
  assert.match(prompts.DRIVER, /replace it instead of carrying that cost forward/);
  assert.match(prompts.DRIVER, /Never tell the user that you will reuse the current Worker before checking partner_status/);
  assert.match(prompts.DRIVER, /explicitly say that the decision changed and give the reason/);
  assert.match(prompts.DRIVER, /replace_partner always posts that card/);
  assert.match(prompts.DRIVER, /may auto-accept your exact server-validated recommendation/);
  assert.match(prompts.DRIVER, /rationale explaining why all three fit the task/);
  assert.match(prompts.DRIVER, /remains visible as an audit trail/);
  assert.match(prompts.DRIVER, /record_partner_evaluation/);
  assert.match(prompts.DRIVER, /not a general ranking of models/);
  assert.match(prompts.DRIVER, /spanning multiple modules/);
  assert.match(prompts.DRIVER, /Your own capability is not a reason to retain that execution/);
  assert.match(prompts.DRIVER, /unless the user explicitly asks you to work directly/);
  assert.equal(/[^\x00-\x7F]/.test(prompts.DRIVER), false, "English ASCII only");
  assert.equal(/[^\x00-\x7F]/.test(prompts.UNPAIRED), false);
  assert.match(prompts.UNPAIRED, /call propose_worker/);
  assert.match(prompts.UNPAIRED, /crosses client\/server\/data boundaries/);
  assert.match(prompts.UNPAIRED, /Your own capability is not a reason to skip delegation/);
  assert.match(prompts.UNPAIRED, /unless the user explicitly asks you to work directly/);
  var proposalSource = fs.readFileSync(path.join(root, "lib/project-worker-proposal.js"), "utf8");
  assert.match(proposalSource, /Do not skip delegation merely because you can implement it yourself/);
});

test("server conventions and module sizes hold", function () {
  var files = ["lib/project-pair-lifecycle.js", "lib/session-driver-eligibility.js",
    "lib/session-driver-orchestration.js", "lib/session-pair-prompts.js", "lib/session-pair-factory.js",
    "lib/project-session-pair.js", "lib/session-pair-mcp-server.js",
    "lib/session-pair-turn-control.js"];
  for (var i = 0; i < files.length; i++) {
    var src = fs.readFileSync(path.join(root, files[i]), "utf8");
    assert.equal(/=>/.test(src), false, files[i] + ": no arrow functions");
    assert.equal(/^\s*(const|let)\s/m.test(src), false, files[i] + ": var only");
    assert.equal(/localStorage|alert\(|confirm\(/.test(src), false, files[i] + ": no browser dialogs");
    assert.ok(src.split("\n").length < 500, files[i] + " is under 500 lines");
  }
  // project.js stays thin: it wires the pair module, it holds no lifecycle logic.
  var projectSource = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  assert.equal(/replacePartner|partnerStatus|recordEvaluation|EVALUATION_OUTCOMES/.test(projectSource), false);
});

// --- No orphans on rejection ---------------------------------------------

test("Driver model choice and failed pair preflight preserve exact roles without orphans", function (t) {
  var factory = require("../lib/session-pair-factory");

  function harness(options) {
    var opts = options || {};
    var sessions = new Map();
    var createdSpecs = [];
    var groupsCreated = [];
    if (opts.existingDriver) {
      sessions.set(1, opts.existingDriver);
    }
    var f = factory.attachPairFactory({
      sm: {
        sessions: sessions,
        installedVendors: opts.installedVendors || ["claude", "codex"],
        modelsByVendor: opts.modelsByVendor === undefined
          ? { claude: CLAUDE_CATALOG, codex: CODEX_CATALOG }
          : opts.modelsByVendor,
        defaultModelByVendor: opts.defaultModelByVendor || {},
        lastVendor: "codex",
        createSessionRaw: function (spec) {
          createdSpecs.push(spec);
          var s = { localId: 100 + createdSpecs.length, ownerId: spec.ownerId || null,
            vendor: spec.vendor, model: spec.model || null, history: [] };
          sessions.set(s.localId, s);
          return s;
        },
        deleteSessionQuiet: function (id) { sessions.delete(id); },
        broadcastSessionList: function () {},
        sendToSession: function () {},
      },
      splitStore: {
        groupForMember: function () { return null; },
        create: function (ws, msg) {
          if (opts.groupCreateFails) return { ok: false, error: "A session can belong to only one split group" };
          groupsCreated.push(msg);
          return { ok: true, group: { id: "sg_x", members: msg.members.slice(), pair: msg.pair } };
        },
      },
      ctx: { isMate: false, usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {} },
    });
    return { f: f, sessions: sessions, createdSpecs: createdSpecs, groupsCreated: groupsCreated };
  }

  // 1. An existing Driver below the former tier threshold is allowed.
  var h1 = harness({ existingDriver: { localId: 1, ownerId: null, vendor: "claude", model: "claude-sonnet-5", history: [] } });
  var existingCreated = h1.f.createPairRecord(
    { _clayUser: null },
    { driver: { sessionId: 1 }, worker: { vendor: "codex" } }
  );
  assert.equal(h1.createdSpecs.length, 1, "only the Worker was created");
  assert.equal(existingCreated.group.pair.driverId, 1);
  assert.equal(existingCreated.group.pair.workerId, existingCreated.worker.localId);

  // 2. A newly requested Driver may use the vendor's lower-tier default.
  var h2 = harness({ defaultModelByVendor: { claude: "claude-sonnet-5" } });
  var defaultCreated = h2.f.createPairRecord(
    { _clayUser: null },
    { driver: { vendor: "claude" }, worker: { vendor: "codex" } }
  );
  assert.equal(h2.createdSpecs.length, 2, "Driver and Worker were created");
  assert.equal(defaultCreated.group.pair.driverId, defaultCreated.driver.localId);
  assert.equal(defaultCreated.group.pair.workerId, defaultCreated.worker.localId);

  // 3. A newly requested Driver may use an explicit available lower-tier model.
  var h3 = harness({ defaultModelByVendor: { claude: "claude-fable-5" } });
  var explicitCreated = h3.f.createPairRecord(
    { _clayUser: null },
    { driver: { vendor: "claude", model: "claude-sonnet-5" }, worker: { vendor: "codex" } }
  );
  assert.equal(explicitCreated.driver.model, "claude-sonnet-5");

  // 4. An unusable Worker request also creates nothing, including no Driver.
  var h4 = harness({ defaultModelByVendor: { claude: "claude-fable-5" } });
  assert.throws(function () {
    h4.f.createPairRecord({ _clayUser: null },
      { driver: { vendor: "claude" }, worker: { vendor: "not-installed" } });
  }, /vendor is not installed/);
  assert.deepEqual(h4.createdSpecs, [], "the Worker request is validated before the Driver is created");

  var h5 = harness({ defaultModelByVendor: { claude: "claude-fable-5" } });
  assert.throws(function () {
    h5.f.createPairRecord({ _clayUser: null },
      { driver: { vendor: "claude" }, worker: { vendor: "codex", model: "gpt-9-imaginary" } });
  }, /model is not available for vendor/);
  assert.deepEqual(h5.createdSpecs, []);

  // 5. A late group-write failure cleans up only what this call created.
  var existing = { localId: 1, ownerId: null, vendor: "claude", model: "claude-fable-5", history: [] };
  var h6 = harness({ existingDriver: existing, groupCreateFails: true });
  assert.throws(function () {
    h6.f.createPairRecord({ _clayUser: null }, { driver: { sessionId: 1 }, worker: { vendor: "codex" } });
  }, /only one split group/);
  assert.equal(h6.sessions.has(1), true, "the pre-existing Driver is untouched");
  assert.equal(h6.sessions.size, 1, "the Worker this call created was removed");

  var h7 = harness({ defaultModelByVendor: { claude: "claude-fable-5" }, groupCreateFails: true });
  assert.throws(function () {
    h7.f.createPairRecord({ _clayUser: null }, { driver: { vendor: "claude" }, worker: { vendor: "codex" } });
  }, /only one split group/);
  assert.equal(h7.sessions.size, 0, "both sessions this call created were removed");
});

test("an explicit model must match the catalog, and an empty catalog fails closed", function (t) {
  var factory = require("../lib/session-pair-factory");
  function f(catalog) {
    return factory.attachPairFactory({
      sm: {
        sessions: new Map(),
        installedVendors: ["claude", "codex"],
        modelsByVendor: catalog,
        defaultModelByVendor: {},
        createSessionRaw: function () { throw new Error("should not create"); },
        broadcastSessionList: function () {},
        sendToSession: function () {},
      },
      splitStore: { groupForMember: function () { return null; }, create: function () { throw new Error("no"); } },
      ctx: { isMate: false, usersModule: { isMultiUser: function () { return false; } }, sendTo: function () {} },
    });
  }

  var full = f({ claude: CLAUDE_CATALOG, codex: CODEX_CATALOG });
  // Matched through the canonical matcher: alias, id and resolvedModel all work.
  assert.equal(full.validateModel("claude", "fable"), "fable");
  assert.equal(full.validateModel("claude", "claude-fable-5"), "claude-fable-5");
  assert.equal(full.validateModel("codex", "gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(full.validateModel("claude", ""), null, "no explicit model is fine");
  assert.throws(function () { full.validateModel("codex", "gpt-9-imaginary"); }, /model is not available/);
  assert.throws(function () { full.validateModel("claude", "claude-opus-5"); },
    /model is not available/, "a real model absent from this catalog is still refused");

  // An unpopulated catalog cannot confirm anything, so caller text is refused
  // rather than forwarded on trust.
  var empty = f({ claude: [], codex: [] });
  assert.throws(function () { empty.validateModel("codex", "gpt-5.6-sol"); },
    /no models are available yet/);
  assert.equal(empty.validateModel("codex", ""), null, "but an absent request still needs no catalog");

  var missing = f({});
  assert.throws(function () { missing.validateModel("codex", "gpt-5.6-sol"); }, /no models are available yet/);

  var src = fs.readFileSync(path.join(root, "lib/session-pair-factory.js"), "utf8");
  assert.match(src, /models\.modelEntryMatches\(catalog\[i\], requested\)/,
    "matching goes through the repo's canonical matcher");
});

// --- Transactional replacement -------------------------------------------

test("an invalid replacement vendor or model preserves the exact old pair", async function (t) {
  var cases = [
    { args: { workerVendor: "not-installed" }, error: /vendor is not installed/ },
    { args: { workerModel: "gpt-9-imaginary" }, error: /model is unavailable/ },
    { args: { workerVendor: "codex", workerModel: "claude-fable-5" }, error: /model is unavailable/ },
  ];
  for (var i = 0; i < cases.length; i++) {
    var world = makeWorld();
    t.after(world.dispose);
    await makePair(world, "Original task");
    var oldWorker = world.worker();
    var oldGroupId = world.groups[0].id;
    oldWorker.history.push({ type: "delta", text: "important prior work" });
    var historyBefore = oldWorker.history.length;

    var aborted = false;
    oldWorker.abortController = { abort: function () { aborted = true; } };

    var res = await replaceThroughProposal(world, cases[i].args);
    assert.equal(res.isError, true, JSON.stringify(cases[i].args) + " is refused");
    assert.match(res.content[0].text, cases[i].error);

    // The exact old pair, Worker and history survive untouched, and nothing
    // was interrupted or cancelled on the way to the refusal.
    assert.equal(world.groups.length, 1, "the group still exists");
    assert.equal(world.groups[0].id, oldGroupId, "the same group record");
    assert.deepEqual(world.groups[0].pair, { driverId: 1, workerId: oldWorker.localId });
    assert.equal(world.worker().localId, oldWorker.localId, "the same Worker session");
    assert.equal(oldWorker.history.length, historyBefore, "its history is intact");
    assert.equal(aborted, false, "it was never interrupted");
    assert.equal(oldWorker.taskStopRequested, undefined);
  }
});

test("an active Worker with an invalid replacement is not stopped", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var worker = world.worker();
  var aborted = false;
  worker.isProcessing = true;
  worker.abortController = { abort: function () { aborted = true; } };

  // Preflight runs before the interrupt gate, so the bad runtime is reported
  // rather than the "pass interrupt true" message, and nothing is stopped.
  var res = await replaceThroughProposal(world, { interrupt: true, workerVendor: "nope" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /vendor is not installed/);
  assert.equal(aborted, false, "the running Worker was left alone");
  assert.equal(world.groups.length, 1);
  assert.equal(world.worker().localId, worker.localId);
});

test("a failed replacement creation rolls the old pair back", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var oldWorker = world.worker();

  // The rollback path is asserted structurally: it re-creates the same members
  // and roles, and every destructive step is ordered after preflight.
  var lifecycleSource = fs.readFileSync(path.join(root, "lib/project-pair-lifecycle.js"), "utf8");
  assert.match(lifecycleSource, /var restored = store\.create\(ws, \{\s*\n\s*members: \[caller\.localId, oldWorker\.localId\],/,
    "the dissolve is rolled back by re-creating the same members and roles");
  assert.match(lifecycleSource, /The previous pair was restored with its session, history and open generation intact\./);
  assert.match(lifecycleSource, /Its interrupted turn cannot be resumed/,
    "and an explicit interrupt is documented as irreversible");
  assert.match(lifecycleSource, /An explicit interrupt=true is NOT reversible/);
  assert.match(lifecycleSource, /ctx\.preflightWorkerForDriver\(caller, \{/,
    "and preflight precedes every destructive step");
  var replaceBody = lifecycleSource.slice(lifecycleSource.indexOf("function replacePartner(args, caller)"));
  replaceBody = replaceBody.slice(0, replaceBody.indexOf("function applyEvaluation"));
  assert.ok(replaceBody.indexOf("preflightWorkerForDriver") < replaceBody.indexOf("abortController"),
    "preflight precedes the interrupt");
  assert.ok(replaceBody.indexOf("preflightWorkerForDriver") < replaceBody.indexOf("cancelWorkerPermissions"),
    "preflight precedes the permission cancellation");
  assert.ok(replaceBody.indexOf("preflightWorkerForDriver") < replaceBody.indexOf("store.dissolve"),
    "preflight precedes the dissolve");
  assert.equal(oldWorker.localId, world.worker().localId, "and this world is unchanged");
});

test("no test leaves an interval behind", function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  assert.equal(world.pendingTimers(), 0, "a fresh world has no timers");
  return makePair(world).then(function () {
    // makePair completes the detached delegation explicitly and clears the
    // monitor interval, without waiting on the module's 500ms clock.
    assert.equal(world.pendingTimers(), 0, "the delegation monitor was cleared");
    assert.equal(world.worker()._pairDelegation, undefined, "and the delegation is closed");
  });
});

// --- Exact live session identity -----------------------------------------

test("a stale session object cannot drive the pair through a captured handler", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var driver = world.driver;

  // Handlers are captured per query and outlive the session they bound to.
  var captured = {
    status: world.tool("partner_status"),
    replace: world.tool("replace_partner"),
    evaluate: world.tool("record_partner_evaluation"),
    send: world.tool("send_to_partner"),
    read: world.tool("read_partner"),
    interrupt: world.tool("interrupt_partner"),
    close: world.tool("close_partner"),
  };
  var workerBefore = world.worker().localId;
  var groupBefore = world.groups[0].id;

  // The session is replaced in the manager by a different object with the same
  // localId — a restart, a rehydration, or an impostor.
  var impostor = {
    localId: driver.localId, ownerId: driver.ownerId, vendor: "claude",
    model: "claude-fable-5", history: [], isProcessing: false,
  };
  world.sessions.set(driver.localId, impostor);

  var lifecycleTools = ["status", "replace", "evaluate"];
  for (var i = 0; i < lifecycleTools.length; i++) {
    var res = await captured[lifecycleTools[i]].handler({ outcome: "succeeded" });
    if (lifecycleTools[i] === "replace") {
      var staleProposal = parse(res);
      assert.match(staleProposal.error, /exact paired Driver/);
      continue;
    }
    assert.equal(res.isError, true, lifecycleTools[i] + " refuses a stale caller");
    assert.match(res.content[0].text, /no longer live/);
  }

  var baseTools = ["send", "read", "interrupt", "close"];
  for (var j = 0; j < baseTools.length; j++) {
    var baseRes = await captured[baseTools[j]].handler({ message: "sneak in" });
    assert.equal(baseRes.isError, true, baseTools[j] + " refuses a stale caller");
    assert.match(baseRes.content[0].text, /no longer live/);
  }

  // Nothing was touched by any of the refused calls.
  assert.equal(world.groups.length, 1);
  assert.equal(world.groups[0].id, groupBefore);
  assert.equal(world.worker().localId, workerBefore);
  assert.deepEqual(driver._workerGenerations[0].evaluation, null, "no evaluation was written");
  assert.equal(driver._workerGenerations[0].endedAt, null, "and no generation was closed");
});

test("the identity check precedes eligibility and group lookup", function () {
  var lifecycleSource = fs.readFileSync(path.join(root, "lib/project-pair-lifecycle.js"), "utf8");
  var fn = lifecycleSource.slice(lifecycleSource.indexOf("function resolveDriverPair(caller)"));
  fn = fn.slice(0, fn.indexOf("function replaceBlockedReason"));
  assert.match(fn, /if \(sm\.sessions\.get\(caller\.localId\) !== caller\) \{/);
  assert.ok(fn.indexOf("sm.sessions.get(caller.localId) !== caller") < fn.indexOf("evaluateDriverSession"),
    "identity is settled before anything is read off the caller");
  assert.ok(fn.indexOf("sm.sessions.get(caller.localId) !== caller") < fn.indexOf("groupForMember"),
    "and before the group lookup");

  var pairSource = fs.readFileSync(path.join(root, "lib/project-session-pair.js"), "utf8");
  var gap = pairSource.slice(pairSource.indexOf("function groupAndPartner(caller,"));
  gap = gap.slice(0, gap.indexOf("function broadcastDelegation"));
  assert.match(gap, /if \(sm\.sessions\.get\(caller\.localId\) !== caller\) \{/,
    "the four base tools enforce the same rule");
  assert.ok(gap.indexOf("sm.sessions.get(caller.localId) !== caller") < gap.indexOf("groupForMember"));
});

// --- Rollback leaves the ledger untouched --------------------------------

test("a failed idle replacement leaves the old generation open and unevaluated", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var oldWorker = world.worker();
  var oldGroupId = world.groups[0].id;
  oldWorker.history.push({ type: "delta", text: "prior work" });
  var historyBefore = oldWorker.history.length;

  // Preflight passes; the group write for the replacement fails.
  var realCreate = world.storeCreate;
  world.failNextCreate = true;

  var res = await replaceThroughProposal(world, {
    evaluation: { outcome: "failed", note: "should not be recorded" },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /could not create the replacement Split Worker/);
  assert.match(res.content[0].text, /previous pair was restored with its session, history and open generation intact/);
  assert.equal(/interrupted turn cannot be resumed/.test(res.content[0].text), false,
    "an idle replacement was never interrupted, so it does not claim otherwise");

  // The ledger entry for the surviving Worker is still open and unevaluated.
  var ledger = world.driver._workerGenerations;
  assert.equal(ledger.length, 1, "no new generation was started");
  assert.equal(ledger[0].generation, 1);
  assert.equal(ledger[0].endedAt, null, "the generation is still open");
  assert.equal(ledger[0].observed, null, "no closing observations were recorded");
  assert.equal(ledger[0].evaluation, null, "and the supplied evaluation was not applied");

  // The session, its history and the pair all survive.
  assert.equal(world.sessions.has(oldWorker.localId), true);
  assert.equal(oldWorker.history.length, historyBefore);
  assert.equal(world.groups.length, 1, "the pair was restored");
  assert.deepEqual(world.groups[0].pair, { driverId: 1, workerId: oldWorker.localId });
  assert.notEqual(world.groups[0].id, oldGroupId, "with a newly issued group id, as documented");
  var failedStatus = parse(await world.tool("partner_status").handler({}));
  assert.equal(failedStatus.replacement.status, "failed");
  assert.equal(failedStatus.replacement.sourceTurnState, "idle");
  assert.equal(failedStatus.replacement.sourceStopped, false);
  assert.equal(failedStatus.replacement.sourcePairRestored, true);
  assert.equal(failedStatus.replacement.filesPreserved, true);

  // Retrying the same approved card preserves its originally proposed assessment.
  world.failNextCreate = false;
  var ok = parse(await replaceThroughProposal(world, { evaluation: { outcome: "partial" } }));
  assert.equal(ok.status, "replaced");
  assert.equal(ledger[0].endedAt !== null, true, "now it is closed");
  assert.equal(ledger[0].evaluation.outcome, "failed");
});

test("a malformed evaluation is rejected before anything is destroyed", async function (t) {
  var world = makeWorld();
  t.after(world.dispose);
  await makePair(world);
  var oldWorker = world.worker();
  var oldGroupId = world.groups[0].id;

  var res = await replaceThroughProposal(world, { evaluation: { outcome: "amazing" } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /succeeded, partial, failed, abandoned/);

  assert.equal(world.groups.length, 1, "the pair was never dissolved");
  assert.equal(world.groups[0].id, oldGroupId, "the same group record");
  assert.equal(world.worker().localId, oldWorker.localId);
  assert.equal(world.driver._workerGenerations[0].endedAt, null, "and the generation stays open");
});
