var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var continuationModule = require("../lib/project-driver-continuation");
var continuationAccess = require("../lib/driver-continuation-access");
var continuationLease = require("../lib/driver-continuation-lease");
var createSessionManager = require("../lib/sessions").createSessionManager;
var permissionsModule = require("../lib/users-permissions");
var attachUserMessage = require("../lib/project-user-message").attachUserMessage;
var createSplitGroupStore = require("../lib/session-split-groups").createSplitGroupStore;

function payload(result) {
  return JSON.parse(result.content[0].text);
}

function tick() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function fixture(options) {
  var opts = options || {};
  var source = {
    localId: 1,
    cliSessionId: "source-cli",
    ownerId: opts.ownerId || null,
    title: "Foundation work",
    vendor: "codex",
    model: "gpt-6-astra",
    effort: "high",
    permissionMode: opts.permissionMode || "default",
    effectivePermissionMode: opts.effectivePermissionMode || null,
    lastContextUsage: Object.prototype.hasOwnProperty.call(opts, "contextUsage")
      ? opts.contextUsage : { input_tokens: 85000, contextWindow: 100000 },
    sessionVisibility: "shared",
    history: [{ type: "user_message", text: "private full transcript secret", _ts: 1 }],
    pendingPermissions: {},
    pendingAskUser: {},
    _sdkQueryGeneration: 3,
  };
  var sessions = new Map([[1, source]]);
  var updates = [];
  var results = [];
  var starts = [];
  var switches = [];
  var deleted = [];
  var identityListeners = [];
  var saves = [];
  var nextId = 2;
  var worker = null;
  var splitDir = null;
  var splitStore = null;
  if (opts.withPair) {
    source.sessionOriginId = source.sessionOriginId || "source-origin";
    worker = {
      localId: nextId++, cliSessionId: "worker-cli", ownerId: source.ownerId || null,
      title: "Existing Worker", history: [{ type: "assistant", text: "preserved worker history" }],
      pendingPermissions: {}, pendingAskUser: {}, pendingElicitations: {}, pendingUserDialogs: {},
      sessionOriginId: "worker-origin", _pairGeneration: 4,
      sessionProvenance: { version: 1, kind: "worker", parentSessionOriginId: source.sessionOriginId,
        generation: 4, createdVia: "split-worker", createdAt: 10 },
    };
    sessions.set(worker.localId, worker);
    splitDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-continuation-pair-"));
    splitStore = createSplitGroupStore({ sessions: sessions, sessionsDir: splitDir, usersModule: null,
      persistGroups: opts.persistGroups });
    var createdGroup = splitStore.createOwned(source.ownerId || null, { members: [source.localId, worker.localId],
      pair: { driverId: source.localId, workerId: worker.localId } });
    assert.strictEqual(createdGroup.ok, true);
    source._pairTurnControl = { serial: 7, humanStopped: true, stoppedAt: 20, stoppedWorkerId: worker.localId,
      creations: 1, replacements: 0, operations: Object.create(null) };
    source._workerGenerations = [{ generation: 4, workerSessionId: worker.localId, workerOriginId: worker.sessionOriginId,
      vendor: "codex", model: "gpt-6-astra", effort: "high", startedAt: 10, endedAt: null,
      observed: null, evaluation: null }];
  }
  var sm = {
    sessions: sessions,
    sendAndRecord: function (session, event) { session.history.push(event); },
    sendToSession: function (session, event) { updates.push({ session: session, event: event }); },
    saveSessionFile: function (session) {
      var kind = session === source ? "source" : "target";
      var count = saves.filter(function (item) { return item.kind === kind; }).length + 1;
      saves.push({ kind: kind, count: count, session: session });
      if (typeof opts.saveBehavior === "function") return opts.saveBehavior(kind, count, session);
      if (opts.failSourceSave && session === source) return false;
      if (opts.failTargetSave && session !== source) return false;
      return true;
    },
    createSessionRaw: function (settings) {
      var target = Object.assign({
        localId: nextId++,
        history: [],
        pendingPermissions: {},
        pendingAskUser: {},
        sessionOriginId: "origin-target-" + nextId,
      }, settings);
      sessions.set(target.localId, target);
      return target;
    },
    deleteSessionQuiet: function (id) { deleted.push(id); sessions.delete(id); },
    broadcastSessionList: function () {},
    switchSession: function (id, ws) { switches.push(id); ws._clayActiveSession = id; },
    addOnSessionIdentityAssigned: function (listener) {
      identityListeners.push(listener);
      return function () { identityListeners = identityListeners.filter(function (item) { return item !== listener; }); };
    },
    notifySessionIdentityAssigned: function (id) {
      identityListeners.slice().forEach(function (listener) { listener(id); });
    },
  };
  var sdk = {
    startQuery: function (target, prompt) {
      starts.push({ target: target, prompt: prompt });
      if (typeof opts.onStart === "function") opts.onStart(target, splitStore);
      if (opts.startReject) return Promise.resolve(false);
      target.cliSessionId = "target-cli-" + target.localId;
      return Promise.resolve(true);
    },
  };
  sdk.startQueryWithAcceptance = function (target, prompt) {
    return Promise.resolve(sdk.startQuery(target, prompt)).then(function (accepted) {
      if (accepted !== true) return { accepted: false, reason: "The successor did not accept or retain its initial query." };
      target.queryInstance = target.queryInstance || { fixture: true };
      target._awaitingTurnResult = true;
      return { accepted: true, initialAccepted: true, queryAlive: true, queryGeneration: 1 };
    });
  };
  var group = opts.group || null;
  if (!splitStore) splitStore = { groupForMember: function () { return group; } };
  var attached = continuationModule.attachDriverContinuation({
    sm: sm,
    isMate: false,
    projectSlug: "clay",
    splitStore: splitStore,
    pendingMessageQueue: { hasActive: function () { return !!opts.pendingQueue; } },
    dangerouslySkipPermissions: !!opts.forcedSkip,
    isMultiUser: function () { return !!opts.multiUser; },
    isDriverOperatedSession: function (session) { return session.driverOperated === true; },
    authorizeSession: function (session, ownerId) {
      if (typeof opts.authorizeSession === "function") return opts.authorizeSession(session, ownerId);
      if (opts.denied) return false;
      return !opts.multiUser || ownerId === session.ownerId;
    },
    getSdk: function () { return sdk; },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
    sendTo: function (ws, event) { results.push(event); },
    consumePendingMessage: opts.consumePendingMessage,
    identityWaitMs: opts.identityWaitMs,
  });
  var ws = { _clayActiveSession: 1, _clayUser: opts.multiUser ? { id: opts.actorId || source.ownerId } : null };
  return { attached: attached, source: source, worker: worker, splitStore: splitStore, splitDir: splitDir,
    sessions: sessions, updates: updates, results: results, starts: starts, switches: switches, deleted: deleted,
    saves: saves, ws: ws, sm: sm, sdk: sdk };
}

async function propose(f) {
  var tool = f.attached.getToolDefs(f.source, 3)[0];
  var result = payload(await tool.handler(proposalArgs({
    reason: "A real compaction completed and the current task is at a safe boundary.",
  })));
  assert.strictEqual(result.status, "posted");
  var proposals = f.source.history.filter(function (entry) { return entry.type === "driver_continuation_proposal"; });
  return proposals[proposals.length - 1];
}

function proposalArgs(overrides) {
  return Object.assign({
    reason: "The completed phase leaves a clear boundary for a focused continuation.",
    milestone: "The current implementation phase and its focused verification are complete.",
    benefit: "A compact handoff lets the successor focus on the independently reviewable next phase.",
    goal: "Finish Driver continuation safely.",
    constraints: "Keep the source usable.",
    decisions: "Use an explicit approval card because the user owns the transition.",
    rejectedApproaches: "Never autoaccept.",
    unresolved: "Revalidate the working tree.",
    nextAction: "Inspect the current diff before starting the next bounded implementation phase.",
    verification: "Focused retrieval tests passed.",
    repositoryState: "Dirty continuation files are expected.",
  }, overrides || {});
}

test("proposal card is announced only after its transcript record is durable", async function () {
  var modes = ["false", "throw"];
  for (var i = 0; i < modes.length; i++) {
    var mode = modes[i];
    var f = fixture({ saveBehavior: function () {
      if (mode === "throw") throw new Error("disk unavailable");
      return false;
    } });
    var tool = f.attached.getToolDefs(f.source, 3)[0];
    var result = payload(await tool.handler(proposalArgs()));
    assert.match(result.error, /could not be persisted/);
    assert.strictEqual(f.source.history.some(function (entry) {
      return entry.type === "driver_continuation_proposal";
    }), false);
    assert.strictEqual(f.updates.length, 0);
  }
});

test("failed proposal persistence does not consume the source's one proactive card", async function () {
  var modes = ["false", "throw"];
  for (var i = 0; i < modes.length; i++) {
    var failed = false;
    var mode = modes[i];
    var f = fixture({ saveBehavior: function (kind) {
      if (kind === "source" && !failed) {
        failed = true;
        if (mode === "throw") throw new Error("disk unavailable");
        return false;
      }
      return true;
    } });
    var tool = f.attached.getToolDefs(f.source, 3)[0];
    var first = payload(await tool.handler(proposalArgs()));
    assert.match(first.error, /could not be persisted/);
    assert.strictEqual(f.source.history.filter(function (entry) {
      return entry.type === "driver_continuation_proposal";
    }).length, 0);
    var second = payload(await tool.handler(proposalArgs()));
    assert.strictEqual(second.status, "posted");
    assert.strictEqual(f.source.history.filter(function (entry) {
      return entry.type === "driver_continuation_proposal";
    }).length, 1);
  }
});

test("server evidence rejects unknown, low, cumulative, and model-spoofed pressure", async function () {
  var unknown = fixture({ contextUsage: null });
  var unknownResult = payload(await unknown.attached.getToolDefs(unknown.source, 3)[0].handler(
    proposalArgs({ triggerEvidence: { kind: "current_context_pressure", usedRatio: 1 } })));
  assert.match(unknownResult.error, /measured current-context pressure/);

  var low = fixture({ contextUsage: { input_tokens: 79000, contextWindow: 100000 } });
  low.source.history.push({ type: "result", usage: { input_tokens: 9000000, output_tokens: 500000 },
    modelUsage: { "gpt-6-astra": { contextWindow: 100000 } } });
  var lowResult = payload(await low.attached.getToolDefs(low.source, 3)[0].handler(proposalArgs()));
  assert.match(lowResult.error, /measured current-context pressure/);
  assert.strictEqual(low.source.history.some(function (entry) {
    return entry.type === "driver_continuation_proposal";
  }), false);
});

test("a completed server-recorded compaction is objective trigger evidence", async function () {
  var f = fixture({ contextUsage: null });
  f.source.history.push({ type: "compacting", active: true, _ts: 40 });
  f.source.history.push({ type: "compacting", active: false, _ts: 41 });
  var proposal = await propose(f);
  assert.strictEqual(proposal.triggerEvidence.kind, "recorded_compaction");
  assert.strictEqual(proposal.triggerEvidence.observedCount, 1);
  assert.strictEqual(proposal.triggerEvidence.lastObservedAt, 41);
});

test("proposal requires a concrete milestone, benefit, next action, and no guaranteed savings", async function () {
  var cases = [
    [proposalArgs({ milestone: "done" }), /completed milestone/],
    [proposalArgs({ benefit: "fresh" }), /continuity benefit/],
    [proposalArgs({ nextAction: "inspect" }), /prepared, concrete next action/],
    [proposalArgs({ benefit: "This guarantees token savings for the next phase." }), /guaranteed or quantified savings/],
  ];
  for (var i = 0; i < cases.length; i++) {
    var f = fixture();
    var result = payload(await f.attached.getToolDefs(f.source, 3)[0].handler(cases[i][0]));
    assert.match(result.error, cases[i][1]);
  }
});

test("proposal permits its own active turn but rejects other pending source work", async function () {
  var active = fixture();
  active.source.isProcessing = true;
  active.source._awaitingTurnResult = true;
  var posted = payload(await active.attached.getToolDefs(active.source, 3)[0].handler(proposalArgs()));
  assert.strictEqual(posted.status, "posted");

  var blocked = [
    fixture({ pendingQueue: true }),
    fixture(),
    fixture(),
  ];
  blocked[1].source.pendingPermissions = { permission: {} };
  blocked[2].source.autonomousRun = { state: "running" };
  var patterns = [/Pending human messages/, /permission or user-input/, /Until complete/];
  for (var i = 0; i < blocked.length; i++) {
    var result = payload(await blocked[i].attached.getToolDefs(blocked[i].source, 3)[0].handler(proposalArgs()));
    assert.match(result.error, patterns[i]);
    assert.strictEqual(blocked[i].source.history.some(function (entry) {
      return entry.type === "driver_continuation_proposal";
    }), false);
  }
});

test("proposal is recorded with actual context and never exposed under Skip permissions", async function () {
  var f = fixture();
  var guidance = f.attached.getSystemPrompt(f.source);
  assert.match(guidance, /current_context_pressure/);
  assert.match(guidance, /at most once/);
  assert.match(guidance, /Human acceptance is always required/);
  var proposal = await propose(f);
  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(proposal.projectSlug, "clay");
  assert.strictEqual(proposal.contextStatus.current.scope, "current_context");
  assert.strictEqual(proposal.triggerEvidence.kind, "current_context_pressure");
  assert.strictEqual(proposal.triggerEvidence.usedRatio, 0.85);
  assert.strictEqual(proposal.triggerEvidence.thresholdRatio, 0.8);
  assert.match(proposal.milestone, /implementation phase/);
  assert.match(proposal.benefit, /compact handoff/);
  assert.strictEqual(f.attached.getSystemPrompt(f.source), "", "a posted card permanently removes proactive guidance");
  assert.deepStrictEqual(fixture({ permissionMode: "bypassPermissions" }).attached.getToolDefs(f.source), []);
  assert.deepStrictEqual(fixture({ effectivePermissionMode: "bypassPermissions" }).attached.getToolDefs(f.source), []);
  assert.deepStrictEqual(fixture({ forcedSkip: true }).attached.getToolDefs(f.source), []);
  f.source.permissionMode = "bypassPermissions";
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), /disabled while Skip permissions/);
});

test("proposal handlers are bound to the exact query generation", async function () {
  var f = fixture();
  var tool = f.attached.getToolDefs(f.source, 3)[0];
  f.source._sdkQueryGeneration = 4;
  var result = payload(await tool.handler({ reason: "boundary", goal: "continue", nextAction: "inspect" }));
  assert.match(result.error, /older query/);
  assert.strictEqual(f.source.history.length, 1);
});

test("finished Until complete remains a Driver while hidden and Worker identities are excluded", function () {
  var f = fixture();
  f.source.autonomousRun = { state: "complete" };
  assert.strictEqual(f.attached.getToolDefs(f.source, 3).length, 1);
  f.source.hidden = true;
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
  f.source.hidden = false;
  f.source.sessionProvenance = { kind: "worker" };
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
  f.source.sessionProvenance = null;
  f.source.scheduledTaskRun = { role: "driver" };
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
  delete f.source.scheduledTaskRun;
  f.source.projectLogReview = { ref: "log:review" };
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
  delete f.source.projectLogReview;
  f.source.isMate = true;
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
  f.source.isMate = false;
  f.source.driverOperated = true;
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
});

test("proposal authorization is rechecked by both retained handlers and tool discovery", async function () {
  var options = {};
  var f = fixture(options);
  var tool = f.attached.getToolDefs(f.source, 3)[0];
  options.denied = true;
  var result = payload(await tool.handler({ reason: "boundary", goal: "continue", nextAction: "inspect" }));
  assert.match(result.error, /authorized live Project Driver/);
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
});

test("production project authorization rejects missing, inactive, and fail-open actor records", function () {
  var actor = { id: "owner" };
  var users = {
    isMultiUser: function () { return true; },
    findUserById: function () { return actor; },
    canAccessSession: function () { return true; },
  };
  var settings = {
    usersModule: users,
    projectSlug: "clay",
    getProjectAccess: function () { return { visibility: "private", ownerId: "owner" }; },
    canAccessProjectSlug: function () { return true; },
  };
  var session = { ownerId: "owner" };
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), true);
  actor = null;
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), false);
  actor = { id: "owner", disabled: true };
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), false);
  actor = { id: "owner", active: false };
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), false);
  actor = { id: "owner", status: "inactive" };
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), false);
  actor = { id: "owner" };
  settings.getProjectAccess = function () { throw new Error("unavailable"); };
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), false);
  delete settings.getProjectAccess;
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), false);
});

test("production continuation authorization uses live users-permissions access", function () {
  var actors = [{ id: "owner", role: "user" }];
  function findUserById(id) {
    return actors.filter(function (actor) { return actor.id === id; })[0] || null;
  }
  var permissions = permissionsModule.attachPermissions({
    loadUsers: function () { return { users: actors }; },
    saveUsers: function () {},
    findUserById: findUserById,
  });
  var settings = {
    usersModule: {
      isMultiUser: function () { return true; },
      findUserById: findUserById,
      canAccessSession: permissions.canAccessSession,
    },
    projectSlug: "clay",
    getProjectAccess: function () { return { visibility: "private", ownerId: "owner", allowedUsers: [] }; },
    canAccessProjectSlug: function (ownerId, slug) { return ownerId === "owner" && slug === "clay"; },
  };
  var session = { ownerId: "owner", sessionVisibility: "private" };
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), true);
  actors[0].disabled = true;
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), false);
  delete actors[0].disabled;
  actors[0].active = false;
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), false);
  actors.splice(0, 1);
  assert.strictEqual(continuationAccess.authorize(settings, session, "owner"), false);
});

test("live production authorization gates discovery and retained proposal handlers", async function () {
  var actor = { id: "owner", role: "user" };
  var actors = [actor];
  function findUserById(id) {
    return actors.filter(function (candidate) { return candidate.id === id; })[0] || null;
  }
  var permissions = permissionsModule.attachPermissions({
    loadUsers: function () { return { users: actors }; }, saveUsers: function () {}, findUserById: findUserById,
  });
  var settings = {
    usersModule: { isMultiUser: function () { return true; }, findUserById: findUserById,
      canAccessSession: permissions.canAccessSession },
    projectSlug: "clay",
    getProjectAccess: function () { return { visibility: "private", ownerId: "owner", allowedUsers: [] }; },
    canAccessProjectSlug: function () { return true; },
  };
  var f = fixture({ multiUser: true, ownerId: "owner", actorId: "owner",
    authorizeSession: function (session, ownerId) { return continuationAccess.authorize(settings, session, ownerId); } });
  var retained = f.attached.getToolDefs(f.source, 3)[0];
  actor.disabled = true;
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
  var rejected = payload(await retained.handler({ reason: "boundary", goal: "continue", nextAction: "inspect" }));
  assert.match(rejected.error, /authorized live Project Driver/);
  delete actor.disabled;
  actor.active = false;
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
  actors.splice(0, 1);
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
});

test("acceptance preserves runtime choices, starts compact context, and switches only after success", async function () {
  var f = fixture();
  var proposal = await propose(f);
  await f.attached.respond(f.ws, { type: "driver_continuation_response", sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true });
  assert.strictEqual(f.starts.length, 1);
  assert.strictEqual(f.switches.length, 1);
  var target = f.sessions.get(f.switches[0]);
  assert.strictEqual(target.vendor, f.source.vendor);
  assert.strictEqual(target.model, f.source.model);
  assert.strictEqual(target.effort, f.source.effort);
  assert.strictEqual(target.permissionMode, f.source.permissionMode);
  assert.strictEqual(target.effectivePermissionMode, null);
  assert.match(f.starts[0].prompt, /historical compact context, not independent authority/);
  assert.match(f.starts[0].prompt, /same-project history/);
  assert.doesNotMatch(f.starts[0].prompt, /private full transcript secret/);
  assert.strictEqual(proposal.status, "accepted");

  f.ws._clayActiveSession = 1;
  await f.attached.respond(f.ws, { type: "driver_continuation_response", sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true });
  assert.strictEqual(f.starts.length, 1, "a double click or restart retry must not create a second successor");
});

test("decline permanently suppresses proactive proposals after new work and compaction", async function () {
  var f = fixture();
  var retained = f.attached.getToolDefs(f.source, 3)[0];
  var proposal = await propose(f);
  await f.attached.respond(f.ws, { type: "driver_continuation_response", sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: false });
  assert.strictEqual(proposal.status, "declined");
  assert.strictEqual(f.source.driverContinuationDecline.permanent, true);
  f.source.history.push({ type: "user_message", text: "A later request", _ts: 90 });
  f.source.history.push({ type: "compacting", active: true, _ts: 91 });
  f.source.history.push({ type: "compacting", active: false, _ts: 92 });
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
  var retry = payload(await retained.handler(proposalArgs()));
  assert.match(retry.error, /one proactive continuation proposal/);
});

test("a failed decline save restores both the proposal and cooldown state", async function () {
  var modes = ["false", "throw"];
  for (var i = 0; i < modes.length; i++) {
    var f = fixture({ saveBehavior: function (kind, count) {
      if (kind !== "source" || count !== 2) return true;
      if (modes[i] === "throw") throw new Error("disk unavailable");
      return false;
    } });
    var proposal = await propose(f);
    await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: false }), /could not be persisted/);
    assert.strictEqual(proposal.status, "pending");
    assert.strictEqual(f.source.driverContinuationDecline, undefined);
  }
});

test("a new human request invalidates the only pending card without allowing another", async function () {
  var f = fixture();
  var retained = f.attached.getToolDefs(f.source, 3)[0];
  var proposal = await propose(f);
  f.source.history.push({ type: "user_message", text: "The work changed.", _ts: 99 });
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), /source work changed/);
  assert.strictEqual(f.starts.length, 0);
  assert.strictEqual(proposal.status, "superseded");
  var retry = payload(await retained.handler(proposalArgs()));
  assert.match(retry.error, /one proactive continuation proposal/);
  assert.deepStrictEqual(f.attached.getToolDefs(f.source, 3), []);
});

test("exact source owner and active-session correlation are enforced", async function () {
  var f = fixture({ multiUser: true, ownerId: "owner", actorId: "intruder" });
  var proposal = await propose(f);
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), /source Driver session no longer exists/);
  f.ws._clayUser.id = "owner";
  f.ws._clayActiveSession = 99;
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), /another source session/);
});

test("proposal origin must still match the current source origin", async function () {
  var f = fixture();
  var proposal = await propose(f);
  proposal.sourceOriginId = "origin-from-another-source";
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1,
    sourceOriginId: f.source.sessionOriginId, proposalId: proposal.proposalId, accepted: false }),
  /exact continuation proposal was not found/);
  assert.strictEqual(proposal.status, "pending");
});

test("replayed decision treats the old local ID as a hint and resolves the current source by origin", async function () {
  var f = fixture();
  var proposal = await propose(f);
  var oldLocalId = f.source.localId;
  var decoy = { localId: oldLocalId, ownerId: null, sessionOriginId: "origin-decoy", history: [] };
  f.sessions.delete(oldLocalId);
  f.source.localId = 9;
  f.sessions.set(oldLocalId, decoy);
  f.sessions.set(f.source.localId, f.source);
  f.ws._clayActiveSession = f.source.localId;
  var decided = await f.attached.respond(f.ws, { sourceSessionId: oldLocalId,
    sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: false });
  assert.strictEqual(decided.status, "declined");
  assert.strictEqual(decided.sourceSessionId, f.source.localId);
  assert.strictEqual(proposal.status, "declined");
  assert.strictEqual(decoy.history.length, 0);

  var wrong = fixture();
  var wrongProposal = await propose(wrong);
  wrong.sessions.delete(wrong.source.localId);
  wrong.source.localId = 11;
  wrong.sessions.set(11, wrong.source);
  wrong.ws._clayActiveSession = 11;
  await assert.rejects(wrong.attached.respond(wrong.ws, { sourceSessionId: 1,
    sourceOriginId: "origin-wrong", proposalId: wrongProposal.proposalId, accepted: false }),
  /source Driver session no longer exists/);
  assert.strictEqual(wrongProposal.status, "pending");
});

test("busy and pending source work produce specific retry blockers without mutation", async function () {
  var cases = [
    ["isProcessing", true, /current Driver turn/],
    ["pendingPermissions", { p: {} }, /permission or user-input/],
    ["autonomousRun", { state: "running" }, /Until complete/],
    ["scheduledMessage", { text: "later" }, /scheduled callback/],
  ];
  for (var i = 0; i < cases.length; i++) {
    var f = fixture();
    var proposal = await propose(f);
    f.source[cases[i][0]] = cases[i][1];
    await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), cases[i][2]);
    assert.strictEqual(f.starts.length, 0);
    assert.strictEqual(proposal.status, "pending");
  }
  var queuedOptions = {};
  var queued = fixture(queuedOptions);
  var queuedProposal = await propose(queued);
  queuedOptions.pendingQueue = true;
  await assert.rejects(queued.attached.respond(queued.ws, { sourceSessionId: 1, sourceOriginId: queuedProposal.sourceOriginId, proposalId: queuedProposal.proposalId, accepted: true }), /Pending human messages/);

  var workerProposal = fixture();
  var continuation = await propose(workerProposal);
  workerProposal.source.history.push({ type: "worker_proposal", proposalId: "worker", status: "pending" });
  await assert.rejects(workerProposal.attached.respond(workerProposal.ws, { sourceSessionId: 1, sourceOriginId: continuation.sourceOriginId, proposalId: continuation.proposalId, accepted: true }), /Split Worker proposal/);
});

test("an idle same-owner Split Worker moves intact to the accepted successor", async function () {
  var firstQueryPair = null;
  var diskOwnerDuringStart = null;
  var sourceRuntimeAuthorityDuringStart = null;
  var f;
  f = fixture({ withPair: true, onStart: function (target, store) {
    firstQueryPair = store.groupForMember(target.localId);
    sourceRuntimeAuthorityDuringStart = !!store.groupForMember(f.source.localId);
    store.refreshAnchors(f.worker.localId);
    var persisted = JSON.parse(fs.readFileSync(path.join(f.splitDir, "split-groups.json")));
    diskOwnerDuringStart = persisted[0].pair.driverId;
  } });
  var originalGroup = f.splitStore.groupForMember(f.source.localId);
  var originalProvenance = JSON.stringify(f.worker.sessionProvenance);
  var proposal = await propose(f);
  await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true });
  var target = f.sessions.get(f.switches[0]);
  var transferred = f.splitStore.groupForMember(target.localId);
  assert.strictEqual(transferred.id, originalGroup.id);
  assert.strictEqual(transferred.pair.driverId, target.localId);
  assert.strictEqual(transferred.pair.workerId, f.worker.localId);
  assert.strictEqual(f.splitStore.groupForMember(f.source.localId), null);
  assert.strictEqual(f.sessions.get(f.worker.localId), f.worker);
  assert.strictEqual(f.worker.history[0].text, "preserved worker history");
  assert.strictEqual(JSON.stringify(f.worker.sessionProvenance), originalProvenance);
  assert.strictEqual(diskOwnerDuringStart, f.source.localId,
    "SDK identity anchor refresh must not persist staged successor ownership");
  assert.strictEqual(sourceRuntimeAuthorityDuringStart, false,
    "the source must not retain runtime pair authority while the successor initializes");
  assert.ok(firstQueryPair, "the successor first query must mount with the transferred pair context");
  assert.strictEqual(firstQueryPair.pair.driverId, target.localId);
  assert.strictEqual(firstQueryPair.pair.workerId, f.worker.localId);
  assert.notStrictEqual(target._pairTurnControl, f.source._pairTurnControl);
  assert.notStrictEqual(target._pairTurnControl.operations, f.source._pairTurnControl.operations);
  assert.strictEqual(target._pairTurnControl.humanStopped, true);
  assert.strictEqual(target._pairTurnControl.stoppedWorkerId, f.worker.localId);
  target._pairTurnControl.serial++;
  assert.strictEqual(f.source._pairTurnControl.serial, 7, "successor turn-control mutations must not alias the source");
  assert.deepStrictEqual(target._workerGenerations, f.source._workerGenerations);
  assert.notStrictEqual(target._workerGenerations, f.source._workerGenerations);
  f.worker.isProcessing = true;
  f.ws._clayActiveSession = f.source.localId;
  await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true });
  delete f.worker.isProcessing;
  assert.strictEqual(f.starts.length, 1);
  assert.strictEqual(f.switches.length, 2, "committed navigation must not revalidate an already transferred Worker");
  assert.strictEqual(f.splitStore.groups.length, 1);
  assert.strictEqual(f.splitStore.groups[0].pair.driverId, target.localId);
});

test("busy, delegated, queued, and input-waiting Workers reject continuation without mutation", async function () {
  var cases = [
    ["isProcessing", true, /still processing/],
    ["_pairDelegation", { taskId: "task" }, /open delegation/],
    ["_pairFollowups", [{ status: "queued" }], /queued follow-ups/],
    ["pendingPush", [{ text: "queued" }], /waiting for delivery/],
    ["pendingUserDialogs", { dialog: {} }, /permission or user-input/],
  ];
  for (var i = 0; i < cases.length; i++) {
    var f = fixture({ withPair: true });
    f.worker[cases[i][0]] = cases[i][1];
    var tool = f.attached.getToolDefs(f.source, 3)[0];
    var result = payload(await tool.handler(proposalArgs()));
    assert.match(result.error, cases[i][2]);
    assert.strictEqual(f.splitStore.groupForMember(f.source.localId).pair.driverId, f.source.localId);
    assert.strictEqual(f.starts.length, 0);
  }
});

test("paired startup rejection rolls ownership back without replacing the Worker or group", async function () {
  var f = fixture({ withPair: true, startReject: true });
  var group = f.splitStore.groupForMember(f.source.localId);
  var proposal = await propose(f);
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true }), /did not accept/);
  var restored = f.splitStore.groupForMember(f.source.localId);
  assert.strictEqual(restored.id, group.id);
  assert.strictEqual(restored.pair.driverId, f.source.localId);
  assert.strictEqual(restored.pair.workerId, f.worker.localId);
  assert.strictEqual(f.sessions.get(f.worker.localId), f.worker);
  assert.strictEqual(f.sessions.size, 2);
  assert.strictEqual(proposal.status, "pending");
});

test("restart recovery commits one existing successor and transfers the persisted source pair", async function () {
  var f = fixture({ withPair: true });
  var proposal = await propose(f);
  var target = f.sm.createSessionRaw({ ownerId: f.source.ownerId || null, vendor: f.source.vendor,
    model: f.source.model, effort: f.source.effort, permissionMode: f.source.permissionMode });
  target.cliSessionId = "restart-successor";
  target.driverContinuation = { proposalId: proposal.proposalId, sourceOriginId: proposal.sourceOriginId,
    sourceSessionRef: proposal.sourceSessionRef, projectSlug: "clay", status: "starting",
    startupProof: "initialized", acceptedQueryGeneration: 8, acceptedInitialAt: Date.now() };
  proposal.status = "starting";
  proposal.targetSessionId = target.localId;
  proposal.targetOriginId = target.sessionOriginId;
  await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true });
  assert.strictEqual(f.starts.length, 0);
  assert.strictEqual(f.switches[0], target.localId);
  assert.strictEqual(f.splitStore.groups.length, 1);
  assert.strictEqual(f.splitStore.groups[0].pair.driverId, target.localId);
  assert.strictEqual(f.splitStore.groups[0].pair.workerId, f.worker.localId);
  assert.strictEqual(f.splitStore.groupForMember(f.source.localId), null);
});

test("startup rejection leaves the source pending and never switches", async function () {
  var f = fixture({ startReject: true });
  var proposal = await propose(f);
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), /did not accept/);
  assert.strictEqual(f.switches.length, 0);
  assert.strictEqual(f.sessions.size, 1);
  assert.strictEqual(proposal.status, "pending");
  assert.match(proposal.error, /did not accept/);
});

test("source persistence failure restores the review card and does not start a successor", async function () {
  var f = fixture({ saveBehavior: function (kind, count) { return kind !== "source" || count !== 2; } });
  var proposal = await propose(f);
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), /could not be persisted/);
  assert.strictEqual(f.starts.length, 0);
  assert.strictEqual(f.switches.length, 0);
  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(f.updates.some(function (item) {
    return item.event.type === "driver_continuation_update" && item.event.status === "starting";
  }), false, "a failed write must not announce an unpersisted starting state");
});

test("accepted startup without a durable identity never switches or deletes the live successor", async function () {
  var f = fixture({ identityWaitMs: 5 });
  var proposal = await propose(f);
  f.sdk.startQueryWithAcceptance = function (target) {
    target.queryInstance = { live: true };
    target._awaitingTurnResult = true;
    return Promise.resolve({ accepted: true, initialAccepted: true, queryAlive: true, queryGeneration: 1 });
  };
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), /durable session identity/);
  assert.strictEqual(f.switches.length, 0);
  assert.strictEqual(f.sessions.size, 2, "the accepted live successor must not be silently deleted");
  assert.strictEqual(proposal.status, "pending");
  var target = Array.from(f.sessions.values())[1];
  assert.strictEqual(target.driverContinuation.status, "starting");
  target.cliSessionId = "late-durable-identity";
  await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true });
  assert.strictEqual(target.driverContinuation.status, "accepted");
  assert.strictEqual(f.switches[0], target.localId);
});

test("accepted startup waits for provider identity before persisting and switching", async function () {
  var f = fixture({ identityWaitMs: 50 });
  var proposal = await propose(f);
  f.sdk.startQueryWithAcceptance = function (target) {
    target.queryInstance = { live: true };
    target._awaitingTurnResult = true;
    setTimeout(function () {
      target.cliSessionId = "provider-assigned-id";
      f.sm.notifySessionIdentityAssigned(target.localId);
    }, 5);
    return Promise.resolve({ accepted: true, initialAccepted: true, queryAlive: true, queryGeneration: 1 });
  };
  await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true });
  assert.strictEqual(f.switches.length, 1);
  assert.strictEqual(f.sessions.get(f.switches[0]).driverContinuation.status, "accepted");
});

test("post-start revalidation cancels the successor and requires a fresh proposal", async function () {
  var options = {};
  var f = fixture(options);
  var proposal = await propose(f);
  var release;
  var startupCalls = 0;
  f.sdk.startQueryWithAcceptance = function (target) {
    startupCalls++;
    target.cliSessionId = "durable-target";
    target.queryInstance = { live: true };
    return new Promise(function (resolve) {
      release = function () { resolve({ accepted: true, initialAccepted: true, queryAlive: true, queryGeneration: 8 }); };
    });
  };
  var first = f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true });
  await tick();
  options.pendingQueue = true;
  release();
  await assert.rejects(first, /Pending human messages/);
  assert.ok(f.saves.some(function (save) { return save.kind === "target"; }), "startup proof must be saved before revalidation");
  assert.strictEqual(f.switches.length, 0);
  assert.strictEqual(f.sessions.size, 1);
  assert.strictEqual(proposal.status, "superseded");
  assert.strictEqual(startupCalls, 1, "an unsafe proposal must never start a second successor");
});

test("accepted lifecycle without complete initialization proof cannot commit or switch", async function () {
  var f = fixture();
  var proposal = await propose(f);
  f.sdk.startQueryWithAcceptance = function (target) {
    target.cliSessionId = "target-without-generation";
    target.queryInstance = { live: true };
    return Promise.resolve({ accepted: true, initialAccepted: true, queryAlive: true });
  };
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true }), /verified startup proof/);
  assert.strictEqual(f.switches.length, 0);
  assert.strictEqual(proposal.status, "pending");
});

test("late initialization retains the lease until retry commits the single target", async function () {
  var f = fixture();
  var proposal = await propose(f);
  var lateStartup;
  var startupCalls = 0;
  f.sdk.startQueryWithAcceptance = function (target, prompt, images, user, guard, onLate) {
    startupCalls++;
    assert.strictEqual(guard(), true);
    lateStartup = onLate;
    target.cliSessionId = "late-target";
    target.queryInstance = { close: function () {} };
    return Promise.resolve({ accepted: false, initialAccepted: true, queryAlive: true,
      queryGeneration: 9, timedOut: true, reason: "The successor did not initialize in time." });
  };
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true }), /did not initialize in time/);
  assert.strictEqual(f.sessions.size, 2);
  assert.strictEqual(f.source._driverContinuationLease.waitingLateStartup, true);
  lateStartup({ accepted: true, queryAlive: true, queryGeneration: 9 });
  assert.strictEqual(f.source._driverContinuationLease.waitingCommit, true);
  await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true });
  assert.strictEqual(f.source._driverContinuationLease, undefined);
  assert.strictEqual(startupCalls, 1);
  assert.strictEqual(f.sessions.size, 2);
  assert.strictEqual(f.switches.length, 1);
});

test("human work after late init cancels the target and drains the preserved queue once", async function () {
  var consumed = 0;
  var consumedAfterDelete = false;
  var admitted = [];
  var sent = [];
  var f;
  var options = { consumePendingMessage: function (source) {
    consumed++;
    consumedAfterDelete = f.sessions.size === 1 && source === f.source;
  } };
  f = fixture(options);
  var proposal = await propose(f);
  var lateStartup;
  var closed = 0;
  f.sdk.startQueryWithAcceptance = function (target, prompt, images, user, guard, onLate) {
    lateStartup = onLate;
    target.cliSessionId = "late-human-target";
    target.queryInstance = { close: function () { closed++; } };
    return Promise.resolve({ accepted: false, initialAccepted: true, queryAlive: true,
      queryGeneration: 11, timedOut: true, reason: "The successor did not initialize in time." });
  };
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true }), /did not initialize in time/);
  lateStartup({ accepted: true, queryAlive: true, queryGeneration: 11 });
  assert.strictEqual(f.source._driverContinuationLease.waitingCommit, true);
  assert.strictEqual(typeof f.source._driverContinuationLease.onCancel, "function");
  var historyLength = f.source.history.length;
  var queue = {
    inspect: function () { return null; },
    admit: function (source, message) { admitted.push({ source: source, message: message }); return { ok: true }; },
    isPaused: function () { return false; },
    getRevision: function () { return 7; },
  };
  var messages = attachUserMessage({
    cwd: process.cwd(), slug: "clay", isMate: false, sm: {}, sdk: {},
    sendTo: function (ws, message) { sent.push(message); }, sendToSession: function () {},
    sendToSessionOthers: function () {}, clients: new Set(), opts: {},
    usersModule: { isMultiUser: function () { return false; } },
    getSessionForWs: function () { return f.source; }, pendingMessageQueue: queue,
    isDriverOperatedSession: function () { return false; },
    _loop: { handleLoopMessage: function () { return false; } },
  });
  messages.handleUserMessage({ _clayUser: null }, {
    type: "message", text: "Keep working in the source", clientMessageId: "late-human-1",
  });
  await tick();
  assert.strictEqual(admitted.length, 1);
  assert.strictEqual(f.source.history.length, historyLength, "queued source input must not be replayed early");
  assert.strictEqual(closed, 1);
  assert.strictEqual(proposal.status, "superseded");
  assert.deepStrictEqual(f.deleted, [2]);
  assert.strictEqual(f.sessions.size, 1);
  assert.strictEqual(f.source._driverContinuationLease, undefined);
  assert.strictEqual(consumed, 1);
  assert.strictEqual(consumedAfterDelete, true, "source draining starts only after the target is removed");
  assert.ok(sent.some(function (message) { return message.type === "message_queued"; }));
});

test("late-init commit persistence failure retains exclusive ownership for retry", async function () {
  var options = {};
  var f = fixture(options);
  var proposal = await propose(f);
  var lateStartup;
  var startupCalls = 0;
  f.sdk.startQueryWithAcceptance = function (target, prompt, images, user, guard, onLate) {
    startupCalls++;
    lateStartup = onLate;
    target.cliSessionId = "late-persistence-target";
    target.queryInstance = { close: function () {} };
    return Promise.resolve({ accepted: false, initialAccepted: true, queryAlive: true,
      queryGeneration: 12, timedOut: true, reason: "The successor did not initialize in time." });
  };
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true }));
  lateStartup({ accepted: true, queryAlive: true, queryGeneration: 12 });
  var lease = f.source._driverContinuationLease;
  var failed = false;
  options.saveBehavior = function (kind) {
    if (kind === "target" && !failed) { failed = true; return false; }
    return true;
  };
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true }), /prepared successor relationship/);
  assert.strictEqual(f.source._driverContinuationLease, lease);
  assert.strictEqual(f.switches.length, 0);
  assert.strictEqual(f.sessions.size, 2);
  options.saveBehavior = null;
  await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true });
  assert.strictEqual(startupCalls, 1);
  assert.strictEqual(f.source._driverContinuationLease, undefined);
  assert.strictEqual(f.switches.length, 1);
});

test("late initialization target-save failure retains the pair lease and retries one successor", async function () {
  var options = {};
  var f = fixture(Object.assign(options, { withPair: true }));
  var proposal = await propose(f);
  var lateStartup;
  var startupCalls = 0;
  f.sdk.startQueryWithAcceptance = function (target, prompt, images, user, guard, onLate) {
    startupCalls++;
    lateStartup = onLate;
    target.cliSessionId = "late-pair-target";
    target.queryInstance = { close: function () {} };
    return Promise.resolve({ accepted: false, initialAccepted: true, queryAlive: true,
      queryGeneration: 14, timedOut: true, reason: "The successor did not initialize in time." });
  };
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true }));
  var failed = false;
  options.saveBehavior = function (kind) {
    if (kind === "target" && !failed) { failed = true; return false; }
    return true;
  };
  lateStartup({ accepted: true, queryAlive: true, queryGeneration: 14 });
  var lease = f.source._driverContinuationLease;
  assert.ok(lease);
  assert.strictEqual(lease.waitingCommit, true);
  assert.strictEqual(f.sessions.size, 3);
  assert.strictEqual(f.splitStore.groupForMember(f.source.localId), null,
    "the staged owner remains exclusive while persistence is retried");
  options.saveBehavior = null;
  await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true });
  assert.strictEqual(startupCalls, 1);
  assert.strictEqual(f.source._driverContinuationLease, undefined);
  assert.strictEqual(f.switches.length, 1);
  var target = f.sessions.get(f.switches[0]);
  assert.strictEqual(f.splitStore.groupForMember(target.localId).pair.workerId, f.worker.localId);
});

test("paired proof-save retries revalidate staged Worker work before committing", async function () {
  var cases = [
    ["isProcessing", true, /still processing/],
    ["_pairDelegation", { taskId: "task" }, /open delegation/],
    ["_pairFollowups", [{ status: "queued" }], /queued follow-ups/],
    ["pendingPermissions", { request: {} }, /permission or user-input/],
  ];
  for (var i = 0; i < cases.length; i++) {
    var failedProof = false;
    var consumed = 0;
    var options = { withPair: true, consumePendingMessage: function () { consumed++; } };
    options.saveBehavior = function (kind, count) {
      if (kind === "target" && count === 1 && !failedProof) { failedProof = true; return false; }
      return true;
    };
    var f = fixture(options);
    var proposal = await propose(f);
    var decision = { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
      proposalId: proposal.proposalId, accepted: true };
    await assert.rejects(f.attached.respond(f.ws, decision), /verified successor startup could not be persisted/);
    var lease = f.source._driverContinuationLease;
    var target = lease.target;
    var originalProvenance = JSON.stringify(f.worker.sessionProvenance);
    options.saveBehavior = null;
    f.worker[cases[i][0]] = cases[i][1];
    await assert.rejects(f.attached.respond(f.ws, decision), cases[i][2]);
    var persisted = JSON.parse(fs.readFileSync(path.join(f.splitDir, "split-groups.json")));
    assert.strictEqual(f.source._driverContinuationLease, lease);
    assert.strictEqual(f.sessions.has(target.localId), true);
    assert.strictEqual(f.switches.length, 0);
    assert.strictEqual(consumed, 0, "a rejected retry must not drain queued source work");
    assert.strictEqual(persisted.length, 1);
    assert.strictEqual(persisted[0].pair.driverId, f.source.localId);
    assert.strictEqual(f.splitStore.groupForMember(target.localId).pair.workerId, f.worker.localId);
    assert.strictEqual(JSON.stringify(f.worker.sessionProvenance), originalProvenance);
    delete f.worker[cases[i][0]];
    await f.attached.respond(f.ws, decision);
    await tick();
    assert.strictEqual(f.starts.length, 1);
    assert.strictEqual(f.switches[0], target.localId);
    assert.strictEqual(f.source._driverContinuationLease, undefined);
    assert.strictEqual(f.splitStore.groups.length, 1);
    assert.strictEqual(f.splitStore.groups[0].pair.driverId, target.localId);
    assert.strictEqual(f.splitStore.groups[0].pair.workerId, f.worker.localId);
    assert.strictEqual(consumed, 1);
  }
});

test("paired retry cancels cleanly when the ownership commit cannot persist", async function () {
  var modes = ["false", "throw"];
  for (var i = 0; i < modes.length; i++) {
    var failCommit = false;
    var failedProof = false;
    var consumed = 0;
    var options = { withPair: true, consumePendingMessage: function () { consumed++; } };
    options.persistGroups = function (file, serialized) {
      if (failCommit) {
        if (modes[i] === "throw") throw new Error("split disk unavailable");
        return false;
      }
      fs.writeFileSync(file, serialized);
      return true;
    };
    options.saveBehavior = function (kind, count) {
      if (kind === "target" && count === 1 && !failedProof) { failedProof = true; return false; }
      return true;
    };
    var f = fixture(options);
    var proposal = await propose(f);
    var decision = { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
      proposalId: proposal.proposalId, accepted: true };
    await assert.rejects(f.attached.respond(f.ws, decision), /verified successor startup could not be persisted/);
    var target = f.source._driverContinuationLease.target;
    options.saveBehavior = null;
    failCommit = true;
    await assert.rejects(f.attached.respond(f.ws, decision), /ownership transfer could not be persisted/);
    await tick();
    assert.strictEqual(f.sessions.has(target.localId), false);
    assert.strictEqual(f.source._driverContinuationLease, undefined);
    assert.strictEqual(f.switches.length, 0);
    assert.strictEqual(proposal.status, "superseded");
    assert.strictEqual(f.splitStore.groups.length, 1);
    assert.strictEqual(f.splitStore.groups[0].pair.driverId, f.source.localId);
    assert.strictEqual(f.splitStore.groups[0].pair.workerId, f.worker.localId);
    assert.strictEqual(consumed, 1);
  }
});

test("paired retry retains a stopped successor when commit cancellation cannot persist", async function () {
  var failCommit = false;
  var failProof = true;
  var failCancellation = false;
  var closed = 0;
  var consumed = 0;
  var options = { withPair: true, consumePendingMessage: function () { consumed++; } };
  options.persistGroups = function (file, serialized) {
    if (failCommit) return false;
    fs.writeFileSync(file, serialized);
    return true;
  };
  options.saveBehavior = function (kind, count) {
    if (kind === "target" && count === 1 && failProof) { failProof = false; return false; }
    if (kind === "source" && failCancellation) return false;
    return true;
  };
  var f = fixture(options);
  var proposal = await propose(f);
  var decision = { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true };
  await assert.rejects(f.attached.respond(f.ws, decision), /verified successor startup could not be persisted/);
  var lease = f.source._driverContinuationLease;
  var target = lease.target;
  target.queryInstance = { close: function () { closed++; } };
  failCommit = true;
  failCancellation = true;
  await assert.rejects(f.attached.respond(f.ws, decision), /cancelled continuation state could not be persisted/);
  assert.strictEqual(closed, 1, "the retained successor must be stopped before source authority is restored");
  assert.strictEqual(f.sessions.has(target.localId), true);
  assert.strictEqual(f.source._driverContinuationLease, lease);
  assert.strictEqual(f.splitStore.groupForMember(f.source.localId).pair.driverId, f.source.localId);
  assert.strictEqual(f.splitStore.groupForMember(target.localId), null);
  assert.strictEqual(f.switches.length, 0);
  assert.strictEqual(consumed, 0);
  failCancellation = false;
  lease.cancel("Retry cancellation persistence.");
  await tick();
  assert.strictEqual(f.sessions.has(target.localId), false);
  assert.strictEqual(f.source._driverContinuationLease, undefined);
  assert.strictEqual(proposal.status, "superseded");
  assert.strictEqual(consumed, 1);
});

test("paired cancellation retains the successor when source cancellation persistence fails", async function () {
  var options = { withPair: true };
  var consumed = 0;
  options.consumePendingMessage = function () { consumed++; };
  var f = fixture(options);
  var proposal = await propose(f);
  var lateStartup;
  f.sdk.startQueryWithAcceptance = function (target, prompt, images, user, guard, onLate) {
    lateStartup = onLate;
    target.cliSessionId = "late-cancel-target";
    target.queryInstance = { close: function () {} };
    return Promise.resolve({ accepted: false, initialAccepted: true, queryAlive: true,
      queryGeneration: 15, timedOut: true, reason: "The successor did not initialize in time." });
  };
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true }));
  lateStartup({ accepted: true, queryAlive: true, queryGeneration: 15 });
  var target = Array.from(f.sessions.values()).find(function (session) { return session !== f.source && session !== f.worker; });
  assert.strictEqual(f.splitStore.groupForMember(target.localId).pair.driverId, target.localId);
  options.saveBehavior = function (kind) { return kind !== "source"; };
  assert.strictEqual(continuationLease.cancelForHumanMessage(f.source), true);
  assert.strictEqual(f.sessions.has(target.localId), true, "an unpersisted cancellation must not delete the successor");
  assert.ok(f.source._driverContinuationLease);
  assert.strictEqual(f.splitStore.groupForMember(f.source.localId).pair.driverId, f.source.localId);
  assert.strictEqual(consumed, 0);
  options.saveBehavior = null;
  continuationLease.cancelForHumanMessage(f.source);
  await tick();
  assert.strictEqual(f.sessions.has(target.localId), false);
  assert.strictEqual(f.source._driverContinuationLease, undefined);
  assert.strictEqual(proposal.status, "superseded");
  assert.strictEqual(consumed, 1);
});

test("late startup error and restart-stale startup resolve without a second proactive card", async function () {
  var consumed = 0;
  var f = fixture({ consumePendingMessage: function () { consumed++; } });
  var proposal = await propose(f);
  var lateStartup;
  f.sdk.startQueryWithAcceptance = function (target, prompt, images, user, guard, onLate) {
    assert.strictEqual(guard(), true);
    lateStartup = onLate;
    target.cliSessionId = "late-error-target";
    target.queryInstance = { close: function () {} };
    return Promise.resolve({ accepted: false, initialAccepted: true, queryAlive: true,
      queryGeneration: 10, timedOut: true, reason: "The successor did not initialize in time." });
  };
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId,
    proposalId: proposal.proposalId, accepted: true }));
  continuationLease.cancelForHumanMessage(f.source);
  lateStartup({ accepted: false, queryAlive: false, queryGeneration: 10, reason: "Query failed after timeout." });
  await tick();
  assert.strictEqual(f.sessions.size, 1);
  assert.strictEqual(proposal.status, "superseded");
  assert.strictEqual(f.source._driverContinuationLease, undefined);
  assert.strictEqual(consumed, 1, "late failure releases the normal source drain exactly once");

  var restarted = fixture();
  var staleProposal = await propose(restarted);
  var staleTarget = restarted.sm.createSessionRaw({ ownerId: null });
  staleTarget.cliSessionId = "restart-stale-target";
  staleTarget.driverContinuation = { proposalId: staleProposal.proposalId,
    sourceOriginId: staleProposal.sourceOriginId, projectSlug: "clay", status: "starting" };
  await assert.rejects(restarted.attached.respond(restarted.ws, { sourceSessionId: 1,
    sourceOriginId: staleProposal.sourceOriginId, proposalId: staleProposal.proposalId, accepted: true }),
  /did not survive startup/);
  assert.strictEqual(restarted.sessions.size, 1);
  assert.strictEqual(staleProposal.status, "superseded");
  assert.deepStrictEqual(restarted.attached.getToolDefs(restarted.source, 3), []);
});

test("acceptance revalidates changed work, queue state, Skip, and access after startup", async function () {
  var cases = ["context", "queue", "skip", "access"];
  for (var i = 0; i < cases.length; i++) {
    var release;
    var options = {};
    var f = fixture(options);
    var proposal = await propose(f);
    f.sdk.startQueryWithAcceptance = function (target) {
      target.cliSessionId = "target-cli";
      target.queryInstance = { live: true };
      return new Promise(function (resolve) { release = function () {
        resolve({ accepted: true, initialAccepted: true, queryAlive: true, queryGeneration: 4 });
      }; });
    };
    var accepting = f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true });
    await tick();
    if (cases[i] === "context") f.source.history.push({ type: "user_message", text: "new work", _ts: 55 });
    if (cases[i] === "queue") options.pendingQueue = true;
    if (cases[i] === "skip") f.source.permissionMode = "bypassPermissions";
    if (cases[i] === "access") f.source.ownerId = "revoked";
    release();
    await assert.rejects(accepting);
    assert.strictEqual(f.switches.length, 0);
    assert.strictEqual(f.starts.length, 0, "the custom lifecycle is invoked directly without the fixture start shim");
    assert.strictEqual(f.sessions.size, 1, "the unsafe successor must be cancelled before it can act");
    assert.strictEqual(proposal.status, "superseded");
  }
});

test("false and throwing saves at every transition phase never switch and retry without duplicate startup", async function () {
  var phases = [
    ["source", 2], ["target", 1], ["target", 2], ["source", 3], ["target", 3], ["source", 4],
  ];
  var modes = ["false", "throw"];
  for (var mi = 0; mi < modes.length; mi++) {
    for (var pi = 0; pi < phases.length; pi++) {
      var failed = false;
      var phase = phases[pi];
      var f = fixture({ saveBehavior: function (kind, count) {
        if (!failed && kind === phase[0] && count === phase[1]) {
          failed = true;
          if (modes[mi] === "throw") throw new Error("disk unavailable");
          return false;
        }
        return true;
      } });
      var proposal = await propose(f);
      await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }));
      assert.strictEqual(f.switches.length, 0);
      await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true });
      assert.strictEqual(f.starts.length, 1, modes[mi] + " " + phase.join(":") + " must start at most once");
      assert.strictEqual(f.switches.length, 1);
      var target = f.sessions.get(f.switches[0]);
      assert.strictEqual(proposal.status, "accepted");
      assert.strictEqual(target.driverContinuation.status, "accepted");
      assert.strictEqual(proposal.transactionId, target.driverContinuation.transactionId);
    }
  }
});

test("message handler reports async failure without autoaccepting or switching", async function () {
  var f = fixture({ startReject: true });
  var proposal = await propose(f);
  assert.strictEqual(f.attached.handleMessage(f.ws, { type: "driver_continuation_response", requestId: "request-1",
    projectSlug: "clay", sourceOriginId: proposal.sourceOriginId, sourceSessionId: 1,
    proposalId: proposal.proposalId, accepted: true }), true);
  await tick();
  assert.strictEqual(f.results.length, 1);
  assert.strictEqual(f.results[0].ok, false);
  assert.strictEqual(f.results[0].requestId, "request-1");
  assert.strictEqual(f.results[0].projectSlug, "clay");
  assert.strictEqual(f.results[0].sourceOriginId, proposal.sourceOriginId);
  assert.strictEqual(f.switches.length, 0);
});

test("message handler rejects incomplete correlation before touching a proposal", async function () {
  var f = fixture();
  var proposal = await propose(f);
  assert.strictEqual(f.attached.handleMessage(f.ws, { type: "driver_continuation_response",
    sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), true);
  assert.strictEqual(f.results.length, 1);
  assert.strictEqual(f.results[0].ok, false);
  assert.match(f.results[0].error, /correlation is incomplete or stale/);
  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(f.starts.length, 0);
});

test("a concurrent decision cannot switch to a successor before startup proof", async function () {
  var release;
  var f = fixture();
  var proposal = await propose(f);
  f.sdk.startQueryWithAcceptance = function (target) {
    target.cliSessionId = "target-cli";
    return new Promise(function (resolve) { release = function (accepted) {
      resolve({ accepted: accepted, initialAccepted: accepted, queryAlive: accepted, queryGeneration: 6 });
    }; });
  };
  var first = f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true });
  await tick();
  await assert.rejects(f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true }), /still starting/);
  assert.strictEqual(f.switches.length, 0);
  release(true);
  await first;
  assert.strictEqual(f.switches.length, 1);
});

test("successor opens its original by stable origin after local IDs change", async function () {
  var f = fixture();
  var proposal = await propose(f);
  await f.attached.respond(f.ws, { sourceSessionId: 1, sourceOriginId: proposal.sourceOriginId, proposalId: proposal.proposalId, accepted: true });
  var target = f.sessions.get(f.switches[0]);
  f.sessions.delete(1);
  f.source.localId = 9;
  f.sessions.set(9, f.source);
  f.ws._clayActiveSession = target.localId;
  var result = f.attached.openSource(f.ws, { proposalId: proposal.proposalId, sourceOriginId: proposal.sourceOriginId });
  assert.strictEqual(result.targetSessionId, 9);
  assert.strictEqual(f.switches[f.switches.length - 1], 9);
});

test("restart renumbering resolves decisions and successors by durable origin", async function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-continuation-restart-"));
  var sessionsBase = path.join(root, "sessions");
  var cliSessionsDir = path.join(root, "cli");
  fs.mkdirSync(cliSessionsDir, { recursive: true });
  var cwd = path.join(root, "project");
  fs.mkdirSync(cwd, { recursive: true });

  function manager() {
    return createSessionManager({ cwd: cwd, sessionsBase: sessionsBase, cliSessionsDir: cliSessionsDir,
      send: function () {}, sendTo: function () {} });
  }

  function attach(sm, switches, starts) {
    sm.switchSession = function (id, ws) { switches.push(id); ws._clayActiveSession = id; };
    return continuationModule.attachDriverContinuation({
      sm: sm, isMate: false, projectSlug: "clay", splitStore: { groupForMember: function () { return null; } },
      pendingMessageQueue: { hasActive: function () { return false; } }, dangerouslySkipPermissions: false,
      isMultiUser: function () { return false; }, authorizeSession: function () { return true; },
      getSdk: function () { return { startQueryWithAcceptance: function (target) {
        starts.push(target.localId);
        target.cliSessionId = "target-cli";
        target.queryInstance = { initialized: true };
        target._awaitingTurnResult = true;
        return Promise.resolve({ accepted: true, initialAccepted: true, queryAlive: true, queryGeneration: 7 });
      } }; },
      getLinuxUserForSession: function () { return null; }, onProcessingChanged: function () {},
      sendTo: function () {}, identityWaitMs: 10,
    });
  }

  try {
    var firstManager = manager();
    var padding = firstManager.createSessionRaw({});
    padding.cliSessionId = "padding-cli";
    padding.createdAt = 1;
    firstManager.saveSessionFile(padding);
    var source = firstManager.createSessionRaw({ vendor: "codex", model: "gpt-6-astra", effort: "high" });
    source.cliSessionId = "source-cli";
    source.lastContextUsage = { input_tokens: 85000, contextWindow: 100000 };
    source.createdAt = 2;
    source._sdkQueryGeneration = 3;
    source.history.push({ type: "user_message", text: "continue durable work", _ts: 1 });
    firstManager.saveSessionFile(source);
    var firstStarts = [];
    var firstSwitches = [];
    var firstAttached = attach(firstManager, firstSwitches, firstStarts);
    var tool = firstAttached.getToolDefs(source, 3)[0];
    var posted = payload(await tool.handler(proposalArgs()));
    var proposal = continuationModule.findProposal(source, posted.proposalId);
    var firstWs = { _clayActiveSession: source.localId, _clayUser: null };
    var accepted = await firstAttached.respond(firstWs, { sourceSessionId: source.localId,
      sourceOriginId: source.sessionOriginId, proposalId: proposal.proposalId, accepted: true });
    var oldSourceId = source.localId;
    var oldTargetId = accepted.targetSessionId;
    assert.strictEqual(firstStarts.length, 1);
    fs.unlinkSync(path.join(firstManager.sessionsDir, "padding-cli.jsonl"));

    var secondManager = manager();
    var restoredSource = continuationAccess.findOwnedSessionByOrigin(secondManager.sessions, source.sessionOriginId, null);
    var restoredTarget = continuationAccess.findOwnedSessionByOrigin(secondManager.sessions, proposal.targetOriginId, null);
    assert.notStrictEqual(restoredSource.localId, oldSourceId);
    assert.notStrictEqual(restoredTarget.localId, oldTargetId);
    var replayed = continuationModule.findProposal(restoredSource, proposal.proposalId);
    assert.strictEqual(replayed.sourceSessionId, oldSourceId, "the persisted card retains its stale daemon-local snapshot");
    assert.strictEqual(replayed.targetSessionId, oldTargetId, "the persisted relation retains its stale daemon-local snapshot");

    var secondStarts = [];
    var secondSwitches = [];
    var secondAttached = attach(secondManager, secondSwitches, secondStarts);
    assert.deepStrictEqual(secondAttached.getToolDefs(restoredSource, restoredSource._sdkQueryGeneration), [],
      "a historical durable card suppresses proactive proposals after restart");
    var secondWs = { _clayActiveSession: restoredSource.localId, _clayUser: null };
    var retried = await secondAttached.respond(secondWs, { sourceSessionId: oldSourceId,
      sourceOriginId: restoredSource.sessionOriginId, proposalId: replayed.proposalId, accepted: true });
    assert.strictEqual(secondStarts.length, 0, "restart retry must reuse the one durable successor");
    assert.strictEqual(retried.sourceSessionId, restoredSource.localId);
    assert.strictEqual(retried.targetSessionId, restoredTarget.localId);
    assert.deepStrictEqual(secondSwitches, [restoredTarget.localId]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
