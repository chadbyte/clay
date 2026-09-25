var test = require("node:test");
var assert = require("node:assert");
var proposalModule = require("../lib/project-worker-proposal");

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

function nextTurn() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function fixture(options) {
  var opts = options || {};
  var session = {
    localId: 1,
    sessionOriginId: "driver-origin",
    ownerId: null,
    title: "Planner",
    vendor: "claude",
    model: "claude-fable",
    mode: "gui",
    history: [],
    sentToolResults: {},
    isProcessing: false,
  };
  var sessions = new Map([[session.localId, session]]);
  var seededWorkers = opts.workers || [];
  for (var wi = 0; wi < seededWorkers.length; wi++) sessions.set(seededWorkers[wi].localId, seededWorkers[wi]);
  var updates = [];
  var directEvents = [];
  var starts = [];
  var pairs = [];
  var additions = [];
  var delegations = [];
  var adapters = {};
  var sm = {
    sessions: sessions,
    installedVendors: ["claude", "codex"],
    currentModel: "claude-sonnet-4-6",
    modelsByVendor: {
      claude: [{ value: "claude-fable", displayName: "Claude Fable" }],
      codex: [{ value: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" }],
    },
    capabilitiesByVendor: { claude: { effort: true }, codex: { effort: true } },
    sendAndRecord: function (target, message) { target.history.push(message); },
    saveSessionFile: function () {},
    sendToSession: function (target, message) { updates.push(message); },
  };
  var sdk = {
    pushMessage: function () { return false; },
    startQuery: function (target, text) {
      starts.push({ session: target, text: text });
      return Promise.resolve();
    },
  };
  var attached = proposalModule.attachWorkerProposal({
    sm: sm,
    isMate: false,
    splitStore: { groupForMember: function () { return opts.group || null; } },
    getSdk: function () { return sdk; },
    sendTo: function (ws, message) { directEvents.push(message); },
    usersModule: { isMultiUser: function () { return false; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
    adapters: adapters,
    recordGenerationStart: function () {},
    createPairRecord: function (ws, message) {
      pairs.push(message);
      return {
        worker: { localId: 2 },
        group: { id: "sg_worker", members: [1, 2], pair: { driverId: 1, workerId: 2 } },
      };
    },
    addWorkerForDriver: function (driver, message) {
      additions.push({ driver: driver, message: message });
      if (typeof opts.addWorkerForDriver === "function") return opts.addWorkerForDriver(driver, message, sessions);
      throw new Error("addition was not configured");
    },
    sendToPartner: function (args, target) {
      delegations.push({ args: args, session: target });
      return Promise.resolve({
        content: [{ type: "text", text: JSON.stringify({ status: "complete", response: "Implemented and tested." }) }],
      });
    },
    multiWorkerFeature: opts.multiWorkerFeature,
  });
  return {
    attached: attached,
    session: session,
    updates: updates,
    directEvents: directEvents,
    starts: starts,
    pairs: pairs,
    additions: additions,
    delegations: delegations,
    adapters: adapters,
    sm: sm,
    ws: { _clayActiveSession: session.localId },
  };
}

async function postProposal(f) {
  var tool = f.attached.getToolDefs(f.session)[0];
  var result = parseToolResult(await tool.handler({
    summary: "The implementation is large enough to benefit from a dedicated Worker.",
    plan: "1. Inspect the current flow\n2. Implement the change\n3. Run focused tests",
    message: "Implement the approved change and run focused tests.",
    recommendedVendor: "codex",
    recommendedModel: "gpt-5.6-sol",
    recommendedEffort: "high",
    recommendationRationale: "Codex Sol at high effort fits the implementation and verification workload.",
  }));
  assert.strictEqual(result.status, "posted");
  return f.session.history.filter(function (item) { return item.type === "worker_proposal"; })[0];
}

test("every eligible unpaired Driver receives the proposal tool but only high-tier models receive its prompt", function () {
  var f = fixture();
  assert.deepStrictEqual(f.attached.getToolDefs(f.session).map(function (tool) { return tool.name; }), ["propose_worker", "inspect_worker_proposal", "cancel_worker_proposal", "worker_runtime_catalog"]);
  assert.match(f.attached.getSystemPrompt(f.session), /runtime configuration card/);
  f.session.model = "claude-sonnet-4-6";
  assert.deepStrictEqual(f.attached.getToolDefs(f.session).map(function (tool) { return tool.name; }), ["propose_worker", "inspect_worker_proposal", "cancel_worker_proposal", "worker_runtime_catalog"]);
  assert.strictEqual(f.attached.getSystemPrompt(f.session), "");
  f.session.vendor = "codex";
  f.session.model = "gpt-5.6-terra";
  assert.deepStrictEqual(f.attached.getToolDefs(f.session).map(function (tool) { return tool.name; }), ["propose_worker", "inspect_worker_proposal", "cancel_worker_proposal", "worker_runtime_catalog"]);
  assert.strictEqual(f.attached.getSystemPrompt(f.session), "");
  f.session.model = "gpt-6-astra";
  assert.match(f.attached.getSystemPrompt(f.session), /runtime configuration card/);
  f.session.mode = "tui";
  assert.deepStrictEqual(f.attached.getToolDefs(f.session), []);
});

test("a proposal cannot outlive its exact session while model catalogs load", async function () {
  var f = fixture();
  var resolveCatalog;
  f.sm.modelsByVendor.codex = [];
  f.adapters.codex = {
    supportedModels: function () {
      return new Promise(function (resolve) { resolveCatalog = resolve; });
    },
  };
  var oldSession = f.session;
  var tool = f.attached.getToolDefs(oldSession)[0];
  var pending = tool.handler({
    summary: "Use a visible Worker.",
    plan: "1. Implement\n2. Verify",
    message: "Implement and verify the change.",
    recommendedVendor: "codex",
    recommendedModel: "gpt-5.6-sol",
    recommendedEffort: "high",
    recommendationRationale: "Codex Sol at high effort fits this task.",
  });
  await nextTurn();
  var replacement = Object.assign({}, oldSession, { history: [] });
  f.sm.sessions.set(oldSession.localId, replacement);
  resolveCatalog([{ value: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" }]);

  var result = parseToolResult(await pending);
  assert.match(result.error, /membership changed while runtimes were loading/);
  assert.strictEqual(oldSession.history.length, 0, "the stale session receives no audit record");
  assert.strictEqual(replacement.history.length, 0, "the replacement session receives no forged record");
  assert.strictEqual(f.pairs.length, 0);
  assert.strictEqual(f.delegations.length, 0);
});

test("declining a Worker proposal resumes the Driver", async function () {
  var f = fixture();
  var proposal = await postProposal(f);
  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(proposal.recommendedVendor, "codex");
  assert.strictEqual(proposal.recommendedModel, "gpt-5.6-sol");

  var response = await f.attached.respondToProposal(f.ws, {
    proposalId: proposal.proposalId,
    accepted: false,
  });
  assert.deepStrictEqual(response, { ok: true, status: "declined" });
  assert.strictEqual(proposal.status, "declined");
  assert.match(f.starts[0].text, /Continue this task in the current Driver session/);
  assert.strictEqual(f.session.history[f.session.history.length - 1]._internal, true);
});

test("a same-vendor fallback recommends a different execution model", async function () {
  var f = fixture();
  f.sm.installedVendors = ["claude"];
  f.sm.modelsByVendor.claude = [
    { value: "claude-fable", displayName: "Claude Fable" },
    { value: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
  ];
  var proposal = await postProposal(f);
  assert.strictEqual(proposal.recommendedVendor, "claude");
  assert.strictEqual(proposal.recommendedModel, "claude-sonnet-4-6");
});

test("skip permissions records the card before auto-accepting an exact recommendation", async function () {
  var f = fixture();
  f.session.permissionMode = "bypassPermissions";
  var tool = f.attached.getToolDefs(f.session)[0];
  var result = parseToolResult(await tool.handler({
    summary: "The implementation is large enough to benefit from a dedicated Worker.",
    plan: "1. Inspect the current flow\n2. Implement the change\n3. Run focused tests",
    message: "Implement the approved change and run focused tests.",
    recommendedVendor: "codex",
    recommendedModel: "gpt-5.6-sol",
    recommendedEffort: "high",
    recommendationRationale: "Codex Sol at high effort fits the implementation and verification workload.",
  }));
  var proposal = f.session.history.filter(function (item) { return item.type === "worker_proposal"; })[0];

  assert.strictEqual(result.status, "auto_accepted");
  assert.strictEqual(proposal.autoAccepted, true);
  assert.strictEqual(proposal.decisionMode, "driver_recommendation");
  assert.ok(proposal.status === "running" || proposal.status === "completed");
  assert.match(proposal.recommendationRationale, /Codex Sol/);
  assert.strictEqual(f.session.history.indexOf(proposal) >= 0, true, "the audit card is recorded in history");
  assert.strictEqual(f.pairs.length, 1);
  assert.strictEqual(f.delegations.length, 1);
});

test("skip permissions off leaves a Worker proposal pending", async function () {
  var f = fixture();
  var proposal = await postProposal(f);

  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(proposal.autoApproved, undefined);
  assert.strictEqual(f.pairs.length, 0);
  assert.strictEqual(f.delegations.length, 0);
});

test("full access fails closed to a pending card when the recommendation is not exact", async function () {
  var f = fixture();
  f.session.dangerouslySkipPermissions = true;
  var tool = f.attached.getToolDefs(f.session)[0];
  await tool.handler({
    summary: "The implementation is large enough to benefit from a dedicated Worker.",
    plan: "1. Inspect the current flow\n2. Implement the change\n3. Run focused tests",
    message: "Implement the approved change and run focused tests.",
    recommendationRationale: "Use the best available runtime for the implementation.",
  });

  var proposal = f.session.history.filter(function (item) { return item.type === "worker_proposal"; })[0];
  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(f.pairs.length, 0);
});

test("full access cannot auto-accept a forged model recommendation", async function () {
  var f = fixture();
  f.session.permissionMode = "bypassPermissions";
  var result = parseToolResult(await f.attached.getToolDefs(f.session)[0].handler({
    summary: "Use a visible Worker.",
    plan: "1. Implement\n2. Verify",
    message: "Implement and verify the change.",
    recommendedVendor: "codex",
    recommendedModel: "gpt-forged",
    recommendedEffort: "high",
    recommendationRationale: "The claimed runtime would fit the task.",
  }));
  var proposal = f.session.history.filter(function (item) { return item.type === "worker_proposal"; })[0];

  assert.strictEqual(result.status, "posted");
  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(proposal.autoAccepted, undefined);
  assert.notStrictEqual(proposal.recommendedModel, "gpt-forged");
  assert.strictEqual(f.pairs.length, 0);
});

test("a forged effort choice is refused instead of silently substituted", async function () {
  var f = fixture();
  var proposal = await postProposal(f);
  await assert.rejects(f.attached.respondToProposal(f.ws, {
    proposalId: proposal.proposalId,
    accepted: true,
    vendor: "codex",
    model: "gpt-5.6-sol",
    effort: "impossible",
  }), /reasoning effort is unavailable/);
  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(f.pairs.length, 0);
  assert.strictEqual(f.delegations.length, 0);
});

test("a client response cannot forge the full-access auto-accept audit state", async function () {
  var f = fixture();
  var proposal = await postProposal(f);
  await f.attached.respondToProposal(f.ws, {
    proposalId: proposal.proposalId,
    accepted: true,
    vendor: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
    autoAccepted: true,
  });

  assert.strictEqual(proposal.autoAccepted, false);
  assert.strictEqual(proposal.decisionMode, "user");
});

test("accepting a Worker suggestion creates the split, delegates, and returns the result", async function () {
  var f = fixture();
  var proposal = await postProposal(f);
  var response = await f.attached.respondToProposal(f.ws, {
    proposalId: proposal.proposalId,
    accepted: true,
    vendor: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
  });
  assert.strictEqual(response.status, "running");
  assert.deepStrictEqual(f.pairs[0], {
    driver: { sessionId: 1 },
    worker: { vendor: "codex", model: "gpt-5.6-sol", effort: "high" },
  });
  assert.strictEqual(f.directEvents[0].type, "pair_session_created");
  assert.strictEqual(f.delegations[0].args.message, "Implement the approved change and run focused tests.");

  await nextTurn();
  assert.strictEqual(proposal.status, "completed");
  assert.strictEqual(proposal.resultPreview, "Implemented and tested.");
  assert.match(f.starts[0].text, /Worker execution completed/);
  assert.ok(f.starts[0].text.includes("workerId=" + proposal.workerId));
  assert.match(f.starts[0].text, /send a follow-up with send_to_partner/);
  assert.match(f.starts[0].text, /never substitute a background Sub-agent/);
  assert.match(f.starts[0].text, /Implemented and tested/);
  assert.ok(f.updates.some(function (message) { return message.status === "running"; }));
  assert.ok(f.updates.some(function (message) { return message.status === "completed"; }));
});

test("an interrupted Worker proposal stays interrupted and warns the Driver", async function () {
  var f = fixture();
  f.attached = proposalModule.attachWorkerProposal({
    sm: f.sm,
    isMate: false,
    splitStore: { groupForMember: function () { return null; } },
    getSdk: function () { return { pushMessage: function () { return false; }, startQuery: function (target, text) { f.starts.push({ session: target, text: text }); return Promise.resolve(); } }; },
    sendTo: function (ws, message) { f.directEvents.push(message); },
    usersModule: { isMultiUser: function () { return false; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
    adapters: {},
    recordGenerationStart: function () {},
    createPairRecord: function () { return { worker: { localId: 2 }, group: { id: "sg_worker", members: [1, 2] } }; },
    sendToPartner: function () { return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "interrupted", response: "Partial implementation" }) }] }); },
  });
  var proposal = await postProposal(f);
  await f.attached.respondToProposal(f.ws, { proposalId: proposal.proposalId, accepted: true, vendor: "codex", model: "gpt-5.6-sol", effort: "high" });
  await nextTurn();
  assert.strictEqual(proposal.status, "interrupted");
  assert.match(f.starts[0].text, /Worker execution interrupted/);
  assert.match(f.starts[0].text, /PARTIAL/);
  assert.doesNotMatch(f.starts[0].text, /The user interrupted/);
  assert.match(f.starts[0].text, /If the human stopped it, do not retry/);
});

function replacementFixture(status) {
  var group = { id: "existing-pair", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var f = fixture({ group: group });
  f.sm.sessions.set(2, { localId: 2, ownerId: null, sessionOriginId: "worker-origin", _pairGeneration: 1 });
  f.session.history.push({ type: "worker_proposal", proposalId: "accepted-worker", status: status, workerId: 2, groupId: group.id });
  return f;
}

function replacementArgs() {
  return { message: "Implement the next bounded task.", recommendationRationale: "A lighter model fits this task.", workerVendor: "codex", workerModel: "gpt-5.6-sol", workerEffort: "medium" };
}

test("accepted running proposal does not masquerade as an unanswered replacement decision", async function () {
  var f = replacementFixture("running");
  var result = parseToolResult(await f.attached.proposeReplacement(replacementArgs(), f.session));
  assert.strictEqual(result.status, "posted");
  assert.strictEqual(f.session.history.length, 2);
  assert.strictEqual(f.session.history[0].status, "running", "do not claim the old execution completed");
  assert.strictEqual(f.session.history[1].status, "pending");
  assert.strictEqual(f.session.history[1].action, "replace");
  assert.strictEqual(f.pairs.length, 0, "posting does not replace a runtime");
  assert.strictEqual(f.delegations.length, 0);
});

test("pending and starting proposals still block duplicate replacement cards", async function () {
  for (var status of ["pending", "starting"]) {
    var f = replacementFixture(status);
    var result = parseToolResult(await f.attached.proposeReplacement(replacementArgs(), f.session));
    assert.match(result.error, /already awaiting a decision/);
    assert.strictEqual(f.session.history.length, 1);
    assert.strictEqual(f.session.history[0].status, status);
  }
});

test("concurrent replacement proposals create only one pending decision", async function () {
  var f = replacementFixture("running");
  var results = await Promise.all([
    f.attached.proposeReplacement(replacementArgs(), f.session),
    f.attached.proposeReplacement(replacementArgs(), f.session),
  ]);
  var values = results.map(parseToolResult);
  assert.strictEqual(values.filter(function (value) { return value.status === "posted"; }).length, 1);
  assert.strictEqual(values.filter(function (value) { return value.error; }).length, 1);
  assert.strictEqual(f.session.history.length, 2);
});

test("a V2 replacement card cannot outlive another member's generation change", async function () {
  var feature = require("../lib/multi-worker-feature").fromServerConfig({ multiWorkerRuntimeEnabled: true });
  var group = { id: "v2-pair", members: [1, 2, 3],
    pair: { version: 2, driverId: 1, workerIds: [2, 3] } };
  var f = fixture({ group: group, multiWorkerFeature: feature });
  var workerA = { localId: 2, ownerId: null, sessionOriginId: "worker-a", _pairGeneration: 4 };
  var workerB = { localId: 3, ownerId: null, sessionOriginId: "worker-b", _pairGeneration: 5 };
  f.sm.sessions.set(2, workerA); f.sm.sessions.set(3, workerB);
  var args = replacementArgs();
  args.workerId = 2;
  var posted = parseToolResult(await f.attached.proposeReplacement(args, f.session));
  assert.equal(posted.status, "posted");
  var proposal = f.session.history[f.session.history.length - 1];
  workerB._pairGeneration = 6;
  await assert.rejects(f.attached.respondToProposal(f.ws, { proposalId: proposal.proposalId,
    accepted: true, vendor: "codex", model: "gpt-5.6-sol", effort: "medium" }), /pair changed/);
  assert.equal(proposal.status, "pending");
  assert.equal(workerA._pairGeneration, 4, "the selected Worker is untouched");
});

test("an authoritative configuration card adds one exact second Worker and delegates once", async function () {
  var feature = require("../lib/multi-worker-feature").fromServerConfig({ multiWorkerRuntimeEnabled: true });
  var worker = { localId: 2, ownerId: null, sessionOriginId: "worker-a", _pairGeneration: 4, history: [] };
  var group = { id: "pair", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var f = fixture({ group: group, workers: [worker], multiWorkerFeature: feature,
    addWorkerForDriver: function (driver, args, sessions) {
      assert.strictEqual(args.expectedGroup, group);
      assert.deepStrictEqual(args.expectedWorkerIds, [2]);
      var added = { localId: 3, ownerId: null, sessionOriginId: "worker-b", _pairGeneration: 5, history: [] };
      sessions.set(3, added);
      group.members = [1, 2, 3];
      group.pair = { version: 2, driverId: 1, workerIds: [2, 3] };
      return { driver: driver, worker: added, group: group };
    } });
  var tool = f.attached.getToolDefs(f.session, { persistent: true, controlsOnly: true }).find(function (item) { return item.name === "propose_worker"; });
  assert.ok(tool, "the paired Driver receives the add proposal tool only through the enabled server feature");
  var posted = parseToolResult(await tool.handler({ summary: "Parallel independent verification is useful.",
    plan: "1. Keep Worker A running\n2. Give Worker B separate files", message: "Verify the independent backend paths.",
    recommendedVendor: "codex", recommendedModel: "gpt-5.6-sol", recommendedEffort: "medium",
    recommendationRationale: "The installed Codex runtime fits this independent verification." }));
  assert.strictEqual(posted.status, "posted");
  var proposal = f.session.history[f.session.history.length - 1];
  assert.strictEqual(proposal.action, "add");
  assert.deepStrictEqual(proposal.sourceWorkerIds, [2]);
  assert.strictEqual(proposal.sourceWorkers[0].generation, 4);
  var accepted = await f.attached.respondToProposal(f.ws, { proposalId: proposal.proposalId,
    accepted: true, vendor: "codex", model: "gpt-5.6-sol", effort: "medium" });
  assert.strictEqual(accepted.ok, true);
  await nextTurn();
  assert.strictEqual(f.additions.length, 1);
  assert.strictEqual(f.delegations.length, 1);
  assert.strictEqual(f.delegations[0].args.workerId, 3);
  assert.strictEqual(f.sm.sessions.get(2), worker, "the running peer identity is unchanged");
  await assert.rejects(f.attached.respondToProposal(f.ws, { proposalId: proposal.proposalId, accepted: true }), /already been resolved/);
  assert.strictEqual(f.additions.length, 1, "duplicate acceptance allocates nothing");
});

test("a third Worker is rejected before allocation and stale add cards cannot mutate membership", async function () {
  var feature = require("../lib/multi-worker-feature").fromServerConfig({ multiWorkerRuntimeEnabled: true });
  var workerA = { localId: 2, ownerId: null, sessionOriginId: "worker-a", _pairGeneration: 4, history: [] };
  var workerB = { localId: 3, ownerId: null, sessionOriginId: "worker-b", _pairGeneration: 5, history: [] };
  var fullGroup = { id: "full", members: [1, 2, 3], pair: { version: 2, driverId: 1, workerIds: [2, 3] } };
  var full = fixture({ group: fullGroup, workers: [workerA, workerB], multiWorkerFeature: feature });
  var fullTool = full.attached.getToolDefs(full.session, { persistent: true, controlsOnly: true }).find(function (item) { return item.name === "propose_worker"; });
  var denied = parseToolResult(await fullTool.handler({ summary: "No", plan: "No", message: "No", recommendationRationale: "No" }));
  assert.match(denied.error, /at most two/);
  assert.strictEqual(full.additions.length, 0);
  assert.strictEqual(full.session.history.length, 0);

  var group = { id: "stale", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var stale = fixture({ group: group, workers: [workerA], multiWorkerFeature: feature,
    addWorkerForDriver: function () { throw new Error("must not allocate"); } });
  var tool = stale.attached.getToolDefs(stale.session, { persistent: true, controlsOnly: true }).find(function (item) { return item.name === "propose_worker"; });
  var posted = parseToolResult(await tool.handler({ summary: "Independent work", plan: "1. Verify", message: "Verify",
    recommendedVendor: "codex", recommendedModel: "gpt-5.6-sol", recommendedEffort: "medium", recommendationRationale: "Exact runtime" }));
  workerA._pairGeneration = 9;
  await assert.rejects(stale.attached.respondToProposal(stale.ws, { proposalId: posted.proposalId,
    accepted: true, vendor: "codex", model: "gpt-5.6-sol", effort: "medium" }), /membership changed/);
  assert.strictEqual(stale.additions.length, 0);
  assert.strictEqual(workerB._pairGeneration, 5);
});

test("a failed add transaction keeps the card pending and preserves the existing Worker", async function () {
  var feature = require("../lib/multi-worker-feature").fromServerConfig({ multiWorkerRuntimeEnabled: true });
  var worker = { localId: 2, ownerId: null, sessionOriginId: "worker-a", _pairGeneration: 4, history: [] };
  var group = { id: "pair", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var f = fixture({ group: group, workers: [worker], multiWorkerFeature: feature,
    addWorkerForDriver: function () { throw new Error("Split Worker session persistence returned false"); } });
  var tool = f.attached.getToolDefs(f.session, { persistent: true, controlsOnly: true }).find(function (item) { return item.name === "propose_worker"; });
  var posted = parseToolResult(await tool.handler({ summary: "Independent work", plan: "1. Verify", message: "Verify",
    recommendedVendor: "codex", recommendedModel: "gpt-5.6-sol", recommendedEffort: "medium", recommendationRationale: "Exact runtime" }));
  var result = await f.attached.respondToProposal(f.ws, { proposalId: posted.proposalId,
    accepted: true, vendor: "codex", model: "gpt-5.6-sol", effort: "medium" });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /persistence returned false/);
  assert.strictEqual(f.session.history[f.session.history.length - 1].status, "pending");
  assert.deepStrictEqual(group.members, [1, 2]);
  assert.strictEqual(f.sm.sessions.get(2), worker);
  assert.strictEqual(f.delegations.length, 0);
});

test("pending proposals can be inspected and cancelled by exact id", async function () {
  var f = fixture();
  var proposal = await postProposal(f);
  var tools = f.attached.getToolDefs(f.session);
  var inspected = parseToolResult(await tools[1].handler({}));
  assert.strictEqual(inspected.status, "pending");
  assert.strictEqual(inspected.proposal.proposalId, proposal.proposalId);
  assert.strictEqual(inspected.proposal.status, "pending");
  assert.strictEqual(inspected.proposal.pending, true);
  assert.strictEqual(inspected.proposal.decisionRequired, true);
  assert.strictEqual(typeof inspected.proposal.createdAt, "number");
  var wrong = parseToolResult(await tools[2].handler({ proposalId: "worker_wrong" }));
  assert.strictEqual(wrong.status, "rejected");
  var cancelled = parseToolResult(await tools[2].handler({ proposalId: proposal.proposalId }));
  assert.deepStrictEqual(cancelled, { status: "cancelled", proposalId: proposal.proposalId });
  assert.strictEqual(proposal.status, "cancelled");
  await assert.rejects(f.attached.respondToProposal(f.ws, {
    proposalId: proposal.proposalId, accepted: true,
  }), /already been resolved/);
  assert.strictEqual(f.pairs.length, 0);
});

test("an exact supersede retires the stale card before a new decision is posted", async function () {
  var f = fixture();
  var first = await postProposal(f);
  var result = parseToolResult(await f.attached.getToolDefs(f.session)[0].handler({
    summary: "Use a revised visible Worker",
    plan: "1. Implement the revised task\n2. Verify it",
    message: "Implement the revised task.",
    recommendedVendor: "codex",
    recommendedModel: "gpt-5.6-sol",
    recommendedEffort: "high",
    recommendationRationale: "The revised task still fits Codex Sol.",
    supersedeProposalId: first.proposalId,
  }));
  assert.strictEqual(result.status, "posted");
  assert.strictEqual(first.status, "superseded");
  assert.strictEqual(first.supersededBy, result.proposalId);
  await assert.rejects(f.attached.respondToProposal(f.ws, {
    proposalId: first.proposalId, accepted: true,
  }), /already been resolved/);
  assert.strictEqual(f.pairs.length, 0, "a stale approval cannot mutate the pair");
});

test("cancel and supersede cannot race past an acceptance boundary", async function () {
  var f = fixture();
  var proposal = await postProposal(f);
  proposal.status = "starting";
  var tools = f.attached.getToolDefs(f.session);
  var cancelled = parseToolResult(await tools[2].handler({ proposalId: proposal.proposalId }));
  assert.strictEqual(cancelled.status, "rejected");
  var superseded = parseToolResult(await tools[0].handler({
    summary: "Replace it", plan: "1. Replace", message: "Replace it",
    recommendationRationale: "A revised runtime is requested.", supersedeProposalId: proposal.proposalId,
  }));
  assert.match(superseded.error, /already starting/);
  assert.strictEqual(proposal.status, "starting");
});
