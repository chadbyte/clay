var test = require("node:test");
var assert = require("node:assert");
var pairModule = require("../lib/project-session-pair");

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

function fixture(configured, options) {
  options = options || {};
  // Fable receives proactive orchestration guidance; structural Driver
  // capability itself remains model-agnostic.
  var driver = { localId: 1, ownerId: null, title: "Planner", vendor: "claude", model: options.driverModel || "claude-fable-5", history: [], isProcessing: false };
  var worker = { localId: 2, ownerId: null, title: "Builder", vendor: "codex", history: [], isProcessing: false };
  var sessions = new Map([[1, driver], [2, worker]]);
  var group = options.ungrouped ? null : { id: "sg_pair", members: [1, 2] };
  if (configured && group) group.pair = { driverId: 1, workerId: 2 };
  var events = [];
  var starts = [];
  var driverPushes = [];
  var pairMessages = [];
  var attached;
  var sm = {
    sessions: sessions,
    installedVendors: ["claude", "codex"],
    modelsByVendor: { claude: [{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" }, { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Claude Sonnet" }], codex: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"] },
    capabilitiesByVendor: {},
    sendAndRecord: function (session, message) { session.history.push(message); },
    saveSessionFile: function () {},
    sendToSession: function (session, message) { if (message.type === "pair_session_created") pairMessages.push(message); },
    broadcastSessionList: function () {},
    createSessionRaw: function (spec) {
      worker.ownerId = spec.ownerId || null;
      worker.vendor = spec.vendor;
      worker.model = spec.model || null;
      worker.effort = spec.effort || null;
      sessions.set(worker.localId, worker);
      return worker;
    },
  };
  var sdk = {
    pushMessage: function (session, text) {
      if (session === driver) {
        driverPushes.push(text);
        return options.driverPushAccepted !== false;
      }
      return false;
    },
    startQuery: function (session, text) {
      starts.push({ session: session, text: text });
      if (session !== worker) return Promise.resolve();
      delete session._lastTurnInterrupted;
      setTimeout(function () {
        if (options.workerError) {
          session.history.push({ type: "error", text: options.workerError });
        } else if (options.workerInterrupted) {
          session.history.push({ type: "delta", text: "Partial implementation" });
          session.history.push({ type: "info", text: "Interrupted · What should Claude do instead?" });
          session.history.push({ type: "done", code: 0 });
          session._lastTurnInterrupted = true;
        } else {
          session.history.push({ type: "delta", text: "Partner result" });
        }
        session.isProcessing = false;
        if (options.autoTurnDone !== false && !options.workerInterrupted) attached.handleTurnDone(session);
      }, options.workerDelay || 20);
      return Promise.resolve();
    },
  };
  attached = pairModule.attachSessionPair({
    sm: sm,
    splitStore: {
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
    },
    getSdk: function () { return sdk; },
    send: function (message) { events.push(message); },
    sendTo: function () {},
    usersModule: { isMultiUser: function () { return false; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
  });
  return { attached: attached, driver: driver, worker: worker, group: group, getGroup: function () { return group; }, events: events, starts: starts, driverPushes: driverPushes, pairMessages: pairMessages };
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

test("ad-hoc splits expose partner tools to both sessions", function () {
  var f = fixture(false);
  assert.strictEqual(f.attached.getToolDefs(f.driver).length, 4);
  assert.strictEqual(f.attached.getToolDefs(f.worker).length, 4);
});

test("send_to_partner records attribution and returns the response", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", timeoutSeconds: 2 }));
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
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", timeoutSeconds: 2 }));
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
  var resumed = parseToolResult(await tool.handler({ message: "The human asked to continue", timeoutSeconds: 2 }));
  assert.equal(resumed.status, "complete");
});

test("operation ids keep a replayed delegation from being sent twice", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  var args = { message: "Inspect once", timeoutSeconds: 2, operationId: "turn-7-send-1" };
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
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", timeoutSeconds: 2 }));
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
