var test = require("node:test");
var assert = require("node:assert/strict");
var createCodexAdapter = require("../lib/yoke/adapters/codex").createCodexAdapter;
var codexContractTestKit = require("../lib/yoke/adapters/codex").contractTestKit;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var attachSessions = require("../lib/project-sessions").attachSessions;

// Codex 0.160 removed the count-based `thread/rollback` method entirely (the
// live app-server rejects it with "unknown variant") in favor of
// `thread/revert`, which cuts at an explicit `beforeTurnId` rather than a
// turn count. Clay must capture Codex's real per-turn id and send it, and
// must never trim its own local history ahead of a provider-side rollback
// that didn't happen.

function createFakeServer() {
  return {
    started: false,
    start: function () { this.started = true; return Promise.resolve(); },
    calls: [],
    send: function (method, params) {
      this.calls.push({ method: method, params: params });
      if (method === "skills/list") return Promise.resolve({ data: [] });
      // Real ThreadRevertResponse always carries `thread`, with that exact
      // thread's own required `id` -- never an empty/placeholder object.
      if (method === "thread/revert") return Promise.resolve({ thread: { id: params.threadId } });
      return Promise.resolve({});
    },
    notify: function () {},
    stop: function () { this.started = false; },
  };
}

test("rollbackThread sends thread/revert with beforeTurnId, not the removed thread/rollback", async function () {
  var server = createFakeServer();
  var adapter = createCodexAdapter({ cwd: process.cwd(), createAppServer: function () { return server; } });
  await adapter.init({});
  await adapter.rollbackThread("thread-1", "turn-abc", {});
  var revertCall = server.calls.find(function (c) { return c.method === "thread/revert"; });
  assert.ok(revertCall, "thread/revert must be sent");
  assert.deepEqual(revertCall.params, { threadId: "thread-1", beforeTurnId: "turn-abc" });
  assert.equal(server.calls.some(function (c) { return c.method === "thread/rollback"; }), false);
});

test("rollbackThread throws rather than silently succeeding when the app-server never starts", async function () {
  // start() resolves (no throw) but never flips `started`, simulating a
  // real-world silent init failure -- the caller must not read this as a
  // successful revert.
  var server = { started: false, start: function () { return Promise.resolve(); }, notify: function () {}, send: function () { return Promise.resolve({}); } };
  var adapter = createCodexAdapter({ cwd: process.cwd(), createAppServer: function () { return server; } });
  await assert.rejects(adapter.rollbackThread("thread-1", "turn-abc", {}), /not running/);
});

test("rollbackThread rejects a malformed or mistargeted revert response instead of trusting it", async function () {
  var wrongThread = { started: false, start: function () { this.started = true; return Promise.resolve(); }, notify: function () {}, send: function (method, params) {
    if (method === "thread/revert") return Promise.resolve({ thread: { id: "some-other-thread" } });
    return Promise.resolve({});
  } };
  var adapterA = createCodexAdapter({ cwd: process.cwd(), createAppServer: function () { return wrongThread; } });
  await adapterA.init({});
  await assert.rejects(adapterA.rollbackThread("thread-1", "turn-abc", {}), /did not confirm/,
    "a response naming a different thread id must not be trusted as this thread's revert");

  var emptyResponse = { started: false, start: function () { this.started = true; return Promise.resolve(); }, notify: function () {}, send: function () { return Promise.resolve({}); } };
  var adapterB = createCodexAdapter({ cwd: process.cwd(), createAppServer: function () { return emptyResponse; } });
  await adapterB.init({});
  await assert.rejects(adapterB.rollbackThread("thread-1", "turn-abc", {}), /did not confirm/,
    "a response missing the required `thread` field must not be trusted as success");
});

test("rollbackThread resolves on a correctly targeted revert response", async function () {
  var server = createFakeServer();
  var adapter = createCodexAdapter({ cwd: process.cwd(), createAppServer: function () { return server; } });
  await adapter.init({});
  var result = await adapter.rollbackThread("thread-1", "turn-abc", {});
  assert.equal(result.thread.id, "thread-1");
});

test("flattenEvent captures Codex's real turnId on the user turn_start event", function () {
  var state = codexContractTestKit.createEventState("gpt-test");
  var events = codexContractTestKit.normalizeEvent({ method: "turn/started", params: { turnId: "turn-xyz" } }, state);
  var turnStart = events.find(function (e) { return e.yokeType === "turn_start"; });
  assert.ok(turnStart, "turn_start must be emitted");
  assert.equal(turnStart.turnId, "turn-xyz");
});

test("sdk-bridge rollbackConversation throws rather than guessing when no turnId was recorded", async function () {
  var calls = [];
  var adapter = { rollbackThread: function (threadId, turnId) { calls.push([threadId, turnId]); return Promise.resolve(); } };
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: {}, adapter: adapter, adapters: { codex: adapter }, send: function () {} });
  var session = { localId: 1, vendor: "codex", cliSessionId: "thread-1" };
  await assert.rejects(bridge.rollbackConversation(session, null), /No turn id recorded/);
  assert.equal(calls.length, 0, "the adapter must never be called with a guessed id");
});

test("sdk-bridge rollbackConversation forwards the real turnId to the adapter", async function () {
  var calls = [];
  var adapter = { rollbackThread: function (threadId, turnId) { calls.push([threadId, turnId]); return Promise.resolve(); } };
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: {}, adapter: adapter, adapters: { codex: adapter }, send: function () {} });
  var session = { localId: 1, vendor: "codex", cliSessionId: "thread-1" };
  await bridge.rollbackConversation(session, "turn-abc");
  assert.deepEqual(calls, [["thread-1", "turn-abc"]]);
});

function rewindFixture(session, overrides) {
  var sent = [];
  var recorded = [];
  var sm = Object.assign({
    sessions: new Map([[session.localId, session]]),
    saveSessionFile: function () {},
    switchSession: function () {},
    broadcastSessionList: function () {},
    sendAndRecord: function (target, message) { recorded.push(message); },
  }, (overrides && overrides.sm) || {});
  var sdk = Object.assign({
    rewindExecuteFiles: function () { return Promise.resolve(); },
    rollbackConversation: function () { return Promise.resolve(); },
    forkSession: function () { return Promise.resolve({}); },
  }, (overrides && overrides.sdk) || {});
  var attached = attachSessions({
    sm: sm, sdk: sdk, clients: new Set(), opts: {},
    usersModule: { isMultiUser: function () { return false; } },
    getSessionForWs: function () { return session; },
    sendTo: function (ws, message) { sent.push(message); },
    onHumanPairStop: function () {},
    onProcessingChanged: function () {},
    hydrateImageRefs: function (x) { return x; },
  });
  return { attached: attached, sent: sent, recorded: recorded, sdk: sdk };
}

test("rewind_execute trims local history only after the provider rollback succeeds", async function () {
  var session = {
    localId: 11, cliSessionId: "thread-1",
    history: [
      { type: "user_message" }, { type: "assistant" },
      { type: "user_message" }, { type: "assistant" },
    ],
    messageUUIDs: [
      { uuid: "u1", type: "user", historyIndex: 0, turnId: "turn-1" },
      { uuid: "a1", type: "assistant", historyIndex: 1 },
      { uuid: "u2", type: "user", historyIndex: 2, turnId: "turn-2" },
      { uuid: "a2", type: "assistant", historyIndex: 3 },
    ],
    pendingAskUser: {}, isProcessing: false,
  };
  var rollbackCalls = [];
  var f = rewindFixture(session, { sdk: { rollbackConversation: function (s, turnId) { rollbackCalls.push(turnId); return Promise.resolve(); } } });
  f.attached.handleSessionsMessage({}, { type: "rewind_execute", uuid: "u1", mode: "chat" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepEqual(rollbackCalls, ["turn-1"], "the real recorded turnId for the target turn must be sent, not a count");
  assert.equal(session.history.length, 0, "local history is trimmed only once the provider rollback is confirmed");
  assert.ok(f.recorded.some(function (m) { return m.type === "rewind_complete"; }));
});

test("rewind_execute aborts and leaves local history untouched when the provider rollback fails", async function () {
  var session = {
    localId: 12, cliSessionId: "thread-1",
    history: [{ type: "user_message" }, { type: "assistant" }],
    messageUUIDs: [{ uuid: "u1", type: "user", historyIndex: 0, turnId: null }],
    pendingAskUser: {}, isProcessing: false,
  };
  var originalHistory = session.history.slice();
  var originalUUIDs = session.messageUUIDs.slice();
  var f = rewindFixture(session, {
    sdk: { rollbackConversation: function () { return Promise.reject(new Error("No turn id recorded; cannot roll back the Codex thread.")); } },
  });
  f.attached.handleSessionsMessage({}, { type: "rewind_execute", uuid: "u1", mode: "chat" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepEqual(session.history, originalHistory, "local history must not be trimmed when the provider rollback failed");
  assert.deepEqual(session.messageUUIDs, originalUUIDs);
  assert.ok(f.sent.some(function (m) { return m.type === "rewind_error"; }), "a user-visible rewind_error must be sent");
  assert.equal(f.recorded.some(function (m) { return m.type === "rewind_complete"; }), false);
});
