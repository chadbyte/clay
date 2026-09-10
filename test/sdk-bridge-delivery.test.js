var test = require("node:test");
var assert = require("node:assert");

var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var attachAskUser = require("../lib/project-ask-user").attachAskUser;

function createBridge(sessionManager, onProcessingChanged) {
  return createSDKBridge({
    cwd: process.cwd(),
    sessionManager: sessionManager || {},
    adapter: { vendor: "codex" },
    send: function () {},
    onProcessingChanged: onProcessingChanged || function () {},
  });
}

function createEndingHandle(events, beforeDone) {
  var index = 0;
  return {
    pushMessage: function() { return true; },
    close: function() {},
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (index < events.length) {
            var event = events[index++];
            return Promise.resolve({ value: event, done: false });
          }
          if (beforeDone) beforeDone();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

test("pushMessage retires a query handle that rejects delivery", function() {
  var bridge = createBridge();
  var closeCount = 0;
  var query = {
    pushMessage: function() { return false; },
    close: function() { closeCount++; },
  };
  var session = {
    localId: 7,
    queryInstance: query,
    abortController: { signal: {} },
    messageQueue: {},
  };

  assert.strictEqual(bridge.pushMessage(session, "hello"), false);
  assert.strictEqual(closeCount, 1);
  assert.strictEqual(session.queryInstance, null);
  assert.strictEqual(session.abortController, null);
  assert.strictEqual(session.messageQueue, null);
});

test("session runtime refresh retires idle handles and defers busy handles to the next turn", function() {
  var bridge = createBridge();
  var idleClosed = 0;
  var idle = {
    queryInstance: { close: function () { idleClosed++; } },
    abortController: {},
    messageQueue: {},
    isProcessing: false,
  };
  assert.strictEqual(bridge.refreshSessionRuntime(idle), true);
  assert.strictEqual(idleClosed, 1);
  assert.strictEqual(idle.queryInstance, null);
  assert.strictEqual(idle._runtimeRefreshRequested, false);

  var busyClosed = 0;
  var busy = {
    localId: 23,
    queryInstance: { pushMessage: function () { return true; }, close: function () { busyClosed++; } },
    abortController: {},
    messageQueue: {},
    isProcessing: true,
  };
  assert.strictEqual(bridge.refreshSessionRuntime(busy), true);
  assert.strictEqual(busyClosed, 0);
  assert.strictEqual(busy._runtimeRefreshRequested, true);
  assert.strictEqual(bridge.pushMessage(busy, "next turn"), false);
  assert.strictEqual(busyClosed, 1);
  assert.strictEqual(busy.queryInstance, null);
  assert.strictEqual(busy._runtimeRefreshRequested, false);
});

test("environment refresh retires only idle sessions and reclaims idle adapter processes", async function() {
  var idleClosed = 0;
  var busyClosed = 0;
  var reclaims = 0;
  var sessions = new Map();
  sessions.set(1, { queryInstance: { close: function() { idleClosed++; } }, isProcessing: false });
  sessions.set(2, { queryInstance: { close: function() { busyClosed++; } }, isProcessing: true });
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: { sessions: sessions },
    adapter: { vendor: "codex" },
    adapters: {
      codex: { shutdownIfIdle: function(idleMs) { assert.strictEqual(idleMs, 0); reclaims++; return Promise.resolve(true); } },
      acp: { shutdownIfIdle: function(idleMs) { assert.strictEqual(idleMs, 0); reclaims++; return Promise.resolve(true); } },
      kiro: { shutdownIfIdle: function(idleMs) { assert.strictEqual(idleMs, 0); reclaims++; return Promise.resolve(true); } },
    },
    send: function() {},
  });

  assert.strictEqual(bridge.refreshEnvironmentRuntime(), true);
  await new Promise(function(resolve) { setImmediate(resolve); });
  assert.strictEqual(idleClosed, 1);
  assert.strictEqual(busyClosed, 0);
  assert.strictEqual(sessions.get(1).queryInstance, null);
  assert.strictEqual(sessions.get(2)._runtimeRefreshRequested, true);
  assert.strictEqual(reclaims, 3);
  sessions.get(2).isProcessing = false;
  assert.strictEqual(bridge.pushMessage(sessions.get(2), "after completion"), false);
  assert.strictEqual(busyClosed, 1);
  assert.strictEqual(sessions.get(2).queryInstance, null);
});

test("main SDK queries pass the scoped environment through readiness and resumed createQuery", async function() {
  var initOptions = null;
  var queryOptions = null;
  var handle = createEndingHandle([]);
  var adapter = {
    vendor: "codex",
    init: function(options) {
      initOptions = options;
      return Promise.resolve({ models: ["gpt-test"], capabilities: {} });
    },
    supportedModels: function() { return Promise.resolve(["gpt-test"]); },
    createQuery: function(options) { queryOptions = options; return Promise.resolve(handle); },
  };
  var sessions = new Map();
  var session = {
    localId: 31,
    vendor: "codex",
    cliSessionId: "resume-31",
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };
  sessions.set(session.localId, session);
  var sm = {
    sessions: sessions,
    availableModels: [],
    saveSessionFile: function() {},
    broadcastSessionList: function() {},
    sendAndRecord: function() {},
    sendToSession: function() {},
  };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: sm,
    adapter: adapter,
    adapters: { codex: adapter },
    getRuntimeEnv: function() { return { PROJECT_TOKEN: "scoped" }; },
    send: function() {},
  });

  await bridge.startQuery(session, "A resumed request", null, null);
  assert.deepStrictEqual(initOptions.env, { PROJECT_TOKEN: "scoped" });
  assert.deepStrictEqual(queryOptions.env, { PROJECT_TOKEN: "scoped" });
  assert.strictEqual(queryOptions.resumeSessionId, "resume-31");
});

test("main SDK queries expose session dynamic tools and use their canonical approval identity", async function() {
  var queryOptions = null;
  var adapter = {
    vendor: "codex",
    userInputCapability: { mode: "native", native: true },
    createQuery: function(options) { queryOptions = options; return Promise.resolve(createEndingHandle([])); },
  };
  var session = { localId: 32, vendor: "codex", pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {
      sessions: new Map([[32, session]]), availableModels: [], saveSessionFile: function() {},
      broadcastSessionList: function() {}, sendAndRecord: function() {}, sendToSession: function() {},
    },
    adapter: adapter,
    adapters: { codex: adapter },
    getSessionToolDefs: function() {
      return [{
        name: "search_workspace_history",
        description: "Search owned history",
        inputSchema: {},
        permissionName: "mcp__clay-workspace__search_workspace_history",
        handler: function() { return Promise.resolve({ content: [] }); },
      }];
    },
    send: function() {},
  });
  await bridge.startQuery(session, "Find prior work", null, null);
  assert.deepEqual(queryOptions.dynamicTools.map(function(tool) { return tool.name; }), ["search_workspace_history"]);
  assert.equal((await queryOptions.canUseTool("search_workspace_history", {}, {})).behavior, "allow");
});

test("resumed Codex tools resolve the current live session handler", async function() {
  var queryOptions = null;
  var toolPhase = "unavailable";
  var calls = [];
  var adapter = {
    vendor: "codex",
    userInputCapability: { mode: "native", native: true },
    createQuery: function(options) { queryOptions = options; return Promise.resolve(createEndingHandle([])); },
  };
  var session = {
    localId: 33,
    vendor: "codex",
    cliSessionId: "resume-with-persisted-tools",
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {
      sessions: new Map([[33, session]]), availableModels: [], saveSessionFile: function() {},
      broadcastSessionList: function() {}, sendAndRecord: function() {}, sendToSession: function() {},
    },
    adapter: adapter,
    adapters: { codex: adapter },
    getSessionToolDefs: function() {
      if (toolPhase === "unavailable") return [];
      return [{
        name: "propose_worker",
        description: "Propose a Worker",
        inputSchema: {},
        handler: function(args) {
          calls.push(args);
          return Promise.resolve({ content: [{ type: "text", text: "posted" }] });
        },
      }];
    },
    send: function() {},
  });

  await bridge.startQuery(session, "Continue the resumed thread", null, null);
  assert.deepEqual(queryOptions.dynamicTools, [],
    "thread/resume relies on the dynamic catalog Codex already persisted");
  toolPhase = "available";
  var result = await queryOptions.callDynamicTool("propose_worker", { summary: "Delegate it" });
  assert.equal(result.content[0].text, "posted");
  assert.deepEqual(calls, [{ summary: "Delegate it" }]);
});

test("rewind queries receive the scoped environment when they create a temporary handle", async function() {
  var capturedOptions = null;
  var handle = createEndingHandle([]);
  var adapter = {
    vendor: "claude",
    createQuery: function(options) { capturedOptions = options; return Promise.resolve(handle); },
  };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: { sendAndRecord: function() {}, sendToSession: function() {} },
    adapter: adapter,
    getRuntimeEnv: function() { return { PROJECT_TOKEN: "rewind" }; },
    send: function() {},
  });
  var result = await bridge.getOrCreateRewindQuery({ cliSessionId: "resume-rewind" });
  assert.deepStrictEqual(capturedOptions.env, { PROJECT_TOKEN: "rewind" });
  assert.strictEqual(capturedOptions.resumeSessionId, "resume-rewind");
  result.cleanup();
});

test("a started session persists its identity and refreshes split anchors immediately", function() {
  var saved = [];
  var assigned = [];
  var recorded = [];
  var bridge = createBridge({
    saveSessionFile: function(session) { saved.push(session.cliSessionId); },
    notifySessionIdentityAssigned: function(localId) { assigned.push(localId); },
    sendAndRecord: function(session, msg) { recorded.push(msg); },
  });
  var session = { localId: 5, cliSessionId: null };
  bridge.processSDKMessage(session, { yokeType: "session_started", sessionId: "thread-worker" });
  assert.strictEqual(session.cliSessionId, "thread-worker");
  assert.deepStrictEqual(saved, ["thread-worker"]);
  assert.deepStrictEqual(assigned, [5]);
  assert.deepStrictEqual(recorded, [{ type: "session_id", cliSessionId: "thread-worker" }]);
});

test("mention sessions preserve the mapped Linux user", async function() {
  var capturedOptions = null;
  var handle = createEndingHandle([]);
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {},
    adapter: {
      vendor: "codex",
      createQuery: function(options) {
        capturedOptions = options;
        return Promise.resolve(handle);
      },
    },
    send: function() {},
  });

  var mentionSession = await bridge.createMentionSession({
    linuxUser: "clay-alice",
    claudeMd: "",
    initialContext: "context",
    initialMessage: "question",
    onDelta: function() {},
    onDone: function() {},
    onError: function() {},
  });

  assert.ok(mentionSession);
  assert.strictEqual(capturedOptions.linuxUser, "clay-alice");
});

test("mention sessions receive the scoped runtime environment", async function() {
  var capturedOptions = null;
  var handle = createEndingHandle([]);
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {},
    adapter: { vendor: "codex", createQuery: function(options) { capturedOptions = options; return Promise.resolve(handle); } },
    getRuntimeEnv: function() { return { PROJECT_TOKEN: "not logged" }; },
    send: function() {},
  });

  await bridge.createMentionSession({ claudeMd: "", initialContext: "context", initialMessage: "question", onDelta: function() {}, onDone: function() {}, onError: function() {} });
  assert.deepStrictEqual(capturedOptions.env, { PROJECT_TOKEN: "not logged" });
});

test("pushMessage retires a query handle that throws during delivery", function() {
  var bridge = createBridge();
  var query = {
    pushMessage: function() { throw new Error("closed input"); },
    close: function() {},
  };
  var session = { localId: 8, queryInstance: query };

  assert.strictEqual(bridge.pushMessage(session, "hello"), false);
  assert.strictEqual(session.queryInstance, null);
});

test("rejected delivery does not clear resources from a replacement query", function() {
  var bridge = createBridge();
  var replacementQuery = { pushMessage: function() { return true; } };
  var replacementAbortController = { signal: {} };
  var replacementMessageQueue = {};
  var session = {
    localId: 9,
    abortController: { signal: {} },
    messageQueue: {},
  };
  var originalQuery = {
    pushMessage: function() {
      session.queryInstance = replacementQuery;
      session.abortController = replacementAbortController;
      session.messageQueue = replacementMessageQueue;
      return false;
    },
    close: function() {},
  };
  session.queryInstance = originalQuery;

  assert.strictEqual(bridge.pushMessage(session, "hello"), false);
  assert.strictEqual(session.queryInstance, replacementQuery);
  assert.strictEqual(session.abortController, replacementAbortController);
  assert.strictEqual(session.messageQueue, replacementMessageQueue);
});

test("adapter errors finish a result-less stream instead of leaving it processing", async function() {
  var recorded = [];
  var broadcasts = 0;
  var bridge = createBridge({
    sendAndRecord: function(session, msg) { recorded.push(msg); },
    sendToSession: function() {},
    broadcastSessionList: function() { broadcasts++; },
  });
  var handle = createEndingHandle([{ yokeType: "error", text: "turn failed" }]);
  var session = {
    localId: 10,
    vendor: "codex",
    queryInstance: handle,
    isProcessing: true,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };

  await bridge.processQueryStream(session);

  assert.strictEqual(session.isProcessing, false);
  assert.strictEqual(recorded.filter(function(msg) { return msg.type === "error"; }).length, 1);
  assert.strictEqual(recorded[recorded.length - 1].type, "done");
  assert.strictEqual(recorded[recorded.length - 1].code, 1);
  assert.strictEqual(broadcasts, 1);
});

test("native AskUserQuestion block completion does not record a second question", function() {
  var recorded = [];
  var bridge = createBridge({
    sendAndRecord: function(session, msg) { recorded.push(msg); session.history.push(msg); },
    sendToSession: function() {},
    broadcastSessionList: function() {},
  });
  var input = { questions: [{ header: "Direction", question: "Which outcome?", options: [{ label: "Ship" }] }] };
  var session = {
    localId: 19,
    vendor: "claude",
    history: [{ type: "tool_executing", id: "ask-19", name: "AskUserQuestion", input: input }],
    blocks: {},
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };

  bridge.processSDKMessage(session, { yokeType: "tool_start", blockId: "blk-19", toolId: "ask-19", toolName: "AskUserQuestion" });
  bridge.processSDKMessage(session, { yokeType: "tool_input_delta", blockId: "blk-19", partialJson: JSON.stringify(input) });
  bridge.processSDKMessage(session, { yokeType: "block_stop", blockId: "blk-19" });

  assert.equal(recorded.filter(function(msg) { return msg.type === "tool_executing" && msg.name === "AskUserQuestion"; }).length, 0);
  assert.equal(recorded.filter(function(msg) { return msg.type === "done"; }).length, 0);
});

test("native AskUserQuestion recording is idempotent whichever callback arrives first", function() {
  var input = { questions: [{ question: "Which outcome?", options: [{ label: "Ship" }] }] };
  function request() {
    return { id: "ask-order", questions: input.questions };
  }
  function respond() {}
  respond.cancel = function () {};

  function run(order) {
    var history = [];
    var session = { localId: 20, history: [], blocks: {}, pendingAskUser: {} };
    var askUser = attachAskUser({ record: function (boundSession, event) { boundSession.history.push(event); history.push(event); } });
    var bridge = createBridge({ sendAndRecord: function (boundSession, event) { boundSession.history.push(event); history.push(event); }, sendToSession: function () {}, broadcastSessionList: function () {} });
    if (order === "native-first") askUser.createHandler(session)(request(), respond);
    bridge.processSDKMessage(session, { yokeType: "tool_start", blockId: "blk-order", toolId: "ask-order", toolName: "AskUserQuestion" });
    bridge.processSDKMessage(session, { yokeType: "tool_input_delta", blockId: "blk-order", partialJson: JSON.stringify(input) });
    bridge.processSDKMessage(session, { yokeType: "block_stop", blockId: "blk-order" });
    if (order === "block-first") askUser.createHandler(session)(request(), respond);
    return history.filter(function (event) { return event.type === "tool_executing" && event.name === "AskUserQuestion"; });
  }

  assert.equal(run("native-first").length, 1);
  assert.equal(run("block-first").length, 1);
});

test("Codex writer conflicts surface a recoverable session error", async function() {
  var recorded = [];
  var bridge = createBridge({
    sendAndRecord: function(session, msg) { recorded.push(msg); },
    sendToSession: function() {},
    broadcastSessionList: function() {},
  });
  var handle = createEndingHandle([{
    yokeType: "error",
    text: "thread-store conflict: thread abc already has an active writer",
  }]);
  var session = {
    localId: 14,
    vendor: "codex",
    queryInstance: handle,
    isProcessing: true,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };

  await bridge.processQueryStream(session);

  var conflicts = recorded.filter(function(msg) { return msg.type === "session_writer_conflict"; });
  assert.strictEqual(conflicts.length, 1);
  assert.match(conflicts[0].text, /another Clay or Codex process/);
  assert.strictEqual(recorded.filter(function(msg) { return msg.type === "error"; }).length, 0);
  assert.strictEqual(recorded[recorded.length - 1].type, "done");
  assert.strictEqual(session.isProcessing, false);
});

test("an old stream ending cannot stop its replacement query", async function() {
  var recorded = [];
  var replacement = { pushMessage: function() { return true; } };
  var session;
  var handle = createEndingHandle([], function() {
    session.queryInstance = replacement;
  });
  var bridge = createBridge({
    sendAndRecord: function(activeSession, msg) { recorded.push(msg); },
    sendToSession: function() {},
    broadcastSessionList: function() {},
  });
  session = {
    localId: 11,
    vendor: "codex",
    queryInstance: handle,
    isProcessing: true,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };

  await bridge.processQueryStream(session);

  assert.strictEqual(session.isProcessing, true);
  assert.strictEqual(session.queryInstance, replacement);
  assert.strictEqual(recorded.length, 0);
});

test("accepted pushes track turns queued behind the active turn", function() {
  var bridge = createBridge();
  var session = {
    localId: 12,
    queryInstance: { pushMessage: function() { return true; } },
    _awaitingTurnResult: true,
    _queuedTurnCount: 0,
  };

  assert.strictEqual(bridge.pushMessage(session, "follow up"), true);
  assert.strictEqual(session._awaitingTurnResult, true);
  assert.strictEqual(session._queuedTurnCount, 1);
});

test("task-stop stream end resets queued-turn state", async function() {
  var bridge = createBridge({
    sendAndRecord: function() {},
    sendToSession: function() {},
    broadcastSessionList: function() {},
  });
  var handle = createEndingHandle([]);
  var session = {
    localId: 16,
    vendor: "codex",
    queryInstance: handle,
    isProcessing: true,
    taskStopRequested: true,
    _awaitingTurnResult: true,
    _queuedTurnCount: 2,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };

  await bridge.processQueryStream(session);

  assert.strictEqual(session.isProcessing, false);
  assert.strictEqual(session._awaitingTurnResult, false);
  assert.strictEqual(session._queuedTurnCount, 0);
});

test("post-interrupt result does not restore processing status", async function() {
  var events = [];
  var bridge = createBridge({
    sendAndRecord: function(session, msg) { events.push({ channel: "recorded", msg: msg }); },
    sendToSession: function(session, msg) { events.push({ channel: "direct", msg: msg }); },
    broadcastSessionList: function() {},
  });
  var interruptedHandle = createEndingHandle([]);
  var session = {
    localId: 17,
    vendor: "codex",
    queryInstance: interruptedHandle,
    isProcessing: true,
    taskStopRequested: true,
    _awaitingTurnResult: true,
    _queuedTurnCount: 1,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
    activeTaskToolIds: {},
    taskIdMap: {},
    history: [],
    turnCount: 0,
  };

  await bridge.processQueryStream(session);
  events = [];
  session.queryInstance = { pushMessage: function() { return true; } };
  session.isProcessing = true;

  assert.strictEqual(bridge.pushMessage(session, "fresh message"), true);
  assert.strictEqual(session._awaitingTurnResult, true);
  assert.strictEqual(session._queuedTurnCount || 0, 0);
  bridge.processSDKMessage(session, { yokeType: "result", cost: 1, duration: 10 });

  var doneIndex = events.findIndex(function(event) { return event.msg.type === "done"; });
  assert.notStrictEqual(doneIndex, -1);
  assert.strictEqual(events.slice(doneIndex + 1).some(function(event) {
    return event.msg.type === "status" && event.msg.status === "processing";
  }), false);
});

test("result-less adapter-error end resets queued-turn state", async function() {
  var bridge = createBridge({
    sendAndRecord: function() {},
    sendToSession: function() {},
    broadcastSessionList: function() {},
  });
  var handle = createEndingHandle([{ yokeType: "error", text: "turn failed" }]);
  var session = {
    localId: 18,
    vendor: "codex",
    queryInstance: handle,
    isProcessing: true,
    _awaitingTurnResult: true,
    _queuedTurnCount: 2,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };

  await bridge.processQueryStream(session);

  assert.strictEqual(session.isProcessing, false);
  assert.strictEqual(session._awaitingTurnResult, false);
  assert.strictEqual(session._queuedTurnCount, 0);
});

test("background task state replaces the prior set and init clears it", function() {
  var direct = [];
  var broadcasts = 0;
  var bridge = createBridge({
    sendAndRecord: function() {},
    sendToSession: function(session, msg) { direct.push(msg); },
    broadcastSessionList: function() { broadcasts++; },
  });
  var session = { localId: 15, activeBackgroundTasks: [{ task_id: "old" }] };
  var tasks = [{ task_id: "new", task_type: "shell", description: "Waiting" }];
  var before = Date.now();
  bridge.processSDKMessage(session, { yokeType: "background_tasks_changed", tasks: tasks });
  // The stored set replaces the prior one and gains a start stamp (see
  // lib/background-task-timing.js) that drives the composer's elapsed timer.
  assert.strictEqual(session.activeBackgroundTasks.length, 1);
  var stored = session.activeBackgroundTasks[0];
  assert.strictEqual(stored.task_id, "new");
  assert.strictEqual(stored.task_type, "shell");
  assert.strictEqual(stored.description, "Waiting");
  assert.ok(stored.started_at >= before && stored.started_at <= Date.now(),
    "a newly seen task is stamped with the current time");
  assert.deepStrictEqual(direct[0], { type: "active_background_tasks", tasks: session.activeBackgroundTasks });
  assert.strictEqual(broadcasts, 0);
  bridge.processSDKMessage(session, { yokeType: "background_tasks_changed", tasks: [] });
  assert.deepStrictEqual(session.activeBackgroundTasks, []);
  assert.deepStrictEqual(direct[1], { type: "active_background_tasks", tasks: [] });
  assert.strictEqual(broadcasts, 1);
  session.activeBackgroundTasks = tasks;
  bridge.processSDKMessage(session, { yokeType: "init" });
  assert.deepStrictEqual(session.activeBackgroundTasks, []);
  assert.deepStrictEqual(direct[2], { type: "active_background_tasks", tasks: [] });
  assert.strictEqual(broadcasts, 2);
});

test("a result keeps processing active while a queued turn continues", function() {
  var recorded = [];
  var direct = [];
  var sequence = [];
  var processingChanges = 0;
  var bridge = createBridge({
    sendAndRecord: function(session, msg) { recorded.push(msg); sequence.push(msg); },
    sendToSession: function(session, msg) { direct.push(msg); sequence.push(msg); },
    broadcastSessionList: function() {},
  }, function() { processingChanges++; });
  var session = {
    localId: 13,
    isProcessing: true,
    _awaitingTurnResult: true,
    _queuedTurnCount: 1,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
    activeTaskToolIds: {},
    taskIdMap: {},
    responsePreview: "first reply",
    history: [],
    turnCount: 0,
  };

  bridge.processSDKMessage(session, { yokeType: "result", cost: 1, duration: 10 });

  assert.strictEqual(session.isProcessing, true);
  assert.strictEqual(session._awaitingTurnResult, true);
  assert.strictEqual(session._queuedTurnCount, 0);
  assert.strictEqual(processingChanges, 0);
  assert.deepStrictEqual(direct[direct.length - 1], { type: "status", status: "processing" });
  var doneIndex = sequence.findIndex(function(msg) { return msg.type === "done"; });
  assert.deepStrictEqual(sequence[doneIndex + 1], { type: "status", status: "processing" });

  bridge.processSDKMessage(session, { yokeType: "result", cost: 1, duration: 10 });

  assert.strictEqual(session.isProcessing, false);
  assert.strictEqual(session._awaitingTurnResult, false);
  assert.strictEqual(processingChanges, 1);
  assert.strictEqual(recorded[recorded.length - 1].type, "done");
});

test("Mate result notifications retain the assistant preview alongside canonical done events", function() {
  var recorded = [];
  var notified = [];
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    slug: "mate-mate-a",
    mateDisplayName: "Clay",
    sessionManager: {
      sendAndRecord: function(session, msg) { recorded.push(msg); },
      sendToSession: function() {},
      broadcastSessionList: function() {},
    },
    adapter: { vendor: "claude" },
    send: function() {},
    onProcessingChanged: function() {},
    getNotificationsModule: function() {
      return { notify: function(type, payload) { notified.push({ type: type, payload: payload }); } };
    },
  });
  var session = {
    localId: 21,
    ownerId: "u1",
    isProcessing: true,
    _awaitingTurnResult: true,
    _queuedTurnCount: 0,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
    activeTaskToolIds: {},
    taskIdMap: {},
    responsePreview: "Assistant output visible in the Home notification",
    history: [],
    turnCount: 0,
  };
  bridge.processSDKMessage(session, { yokeType: "result", cost: 1, duration: 10 });
  assert.deepStrictEqual(recorded.slice(-2).map(function(message) { return message.type; }), ["result", "done"]);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].type, "response_done");
  assert.equal(notified[0].payload.preview, "Assistant output visible in the Home notification");
  assert.equal(notified[0].payload.mateId, "mate-a");
});

test("a visibly presented exact Home response skips completion notifications but still finishes", function() {
  var recorded = [];
  var notified = [];
  var pushed = [];
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    slug: "mate-mate-a",
    mateDisplayName: "Clay",
    sessionManager: {
      sendAndRecord: function(session, msg) { recorded.push(msg); },
      sendToSession: function() {},
      broadcastSessionList: function() {},
    },
    adapter: { vendor: "claude" },
    send: function() {},
    onProcessingChanged: function() {},
    shouldSuppressResponseNotification: function(session) { return session.localId === 22; },
    pushModule: { sendPush: function(payload) { pushed.push(payload); } },
    getNotificationsModule: function() {
      return { notify: function(type, payload) { notified.push({ type: type, payload: payload }); } };
    },
  });
  var session = {
    localId: 22,
    ownerId: "u1",
    isProcessing: true,
    _awaitingTurnResult: true,
    _queuedTurnCount: 0,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
    activeTaskToolIds: {},
    taskIdMap: {},
    responsePreview: "Already visible in Home",
    history: [],
    turnCount: 0,
  };
  bridge.processSDKMessage(session, { yokeType: "result", cost: 1, duration: 10 });
  assert.deepEqual(recorded.slice(-2).map(function(message) { return message.type; }), ["result", "done"]);
  assert.equal(session.isProcessing, false);
  assert.equal(notified.length, 0);
  assert.equal(pushed.length, 0);
});
