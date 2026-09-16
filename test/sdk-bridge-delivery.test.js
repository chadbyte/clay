var test = require("node:test");
var assert = require("node:assert");
var osUsersModule = require("../lib/os-users");

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

test("mapped-user SDK queries pass target-user skill readers to the adapter", async function() {
  var queryOptions = null;
  var adapter = {
    vendor: "codex",
    init: function() { return Promise.resolve({ models: ["gpt-test"], capabilities: {} }); },
    supportedModels: function() { return Promise.resolve(["gpt-test"]); },
    createQuery: function(options) { queryOptions = options; return Promise.resolve(createEndingHandle([])); },
  };
  var mappedInfo = { user: "mapped-user", home: "/mapped/home", uid: 1001, gid: 1001 };
  var originalResolve = osUsersModule.resolveOsUserInfo;
  osUsersModule.resolveOsUserInfo = function() { return mappedInfo; };
  var session = {
    localId: 34,
    vendor: "codex",
    lastLinuxUser: "mapped-user",
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };
  try {
    var bridge = createSDKBridge({
      cwd: process.cwd(),
      osUsers: {},
      sessionManager: { sessions: new Map([[session.localId, session]]), availableModels: [], saveSessionFile: function() {}, sendToSession: function() {}, sendAndRecord: function() {}, broadcastSessionList: function() {} },
      adapter: adapter,
      adapters: { codex: adapter },
      send: function() {},
    });

    await bridge.startQuery(session, "Scoped skill reader", null, "mapped-user");
    assert.strictEqual(queryOptions.skillOptions.scopedHome, true);
    assert.strictEqual(queryOptions.skillOptions.homeDir, "/mapped/home");
    assert.strictEqual(typeof queryOptions.skillOptions.readDir, "function");
    assert.strictEqual(typeof queryOptions.skillOptions.readFile, "function");
    assert.strictEqual(typeof queryOptions.skillOptions.realpath, "function");
  } finally {
    osUsersModule.resolveOsUserInfo = originalResolve;
  }
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

test("schedule-capable queries select structured input before start and keep their query-bound tool pair", async function() {
  var queryOptions = null;
  var generation = 0;
  var presentedQuestions = 0;
  var adapter = {
    vendor: "codex",
    userInputCapability: { mode: "native", native: true },
    createQuery: function(options) { queryOptions = options; return Promise.resolve(createEndingHandle([{ yokeType: "session_started", sessionId: "fresh-schedule-thread" }])); },
  };
  var session = { localId: 36, vendor: "codex", pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {
      sessions: new Map([[36, session]]), availableModels: [], saveSessionFile: function() {},
      broadcastSessionList: function() {}, sendAndRecord: function() {}, sendToSession: function() {},
    },
    adapter: adapter,
    adapters: { codex: adapter },
    getSessionToolDefs: function() {
      generation += 1;
      var queryGeneration = generation;
      var interviewId = null;
      return [{
        name: "begin_scheduled_task_interview", queryBound: true, description: "Begin", inputSchema: {},
        scheduleInterviewActive: function() { return !!interviewId; },
        structuredQuestionLimit: function() { return interviewId ? 1 : null; },
        handler: function() { interviewId = "interview-" + queryGeneration; return Promise.resolve({ content: [{ type: "text", text: interviewId }] }); },
      }, {
        name: "propose_scheduled_task", queryBound: true, description: "Propose", inputSchema: {},
        handler: function() { return Promise.resolve({ content: [{ type: "text", text: interviewId || "missing" }] }); },
      }, {
        name: "list_scheduled_tasks", queryBound: true, description: "List", inputSchema: {}, handler: function() { return Promise.resolve({ content: [] }); },
      }, {
        name: "read_scheduled_task", queryBound: true, description: "Read", inputSchema: {}, handler: function() { return Promise.resolve({ content: [] }); },
      }, {
        name: "update_scheduled_task", queryBound: true, description: "Update", inputSchema: {}, handler: function() { return Promise.resolve({ content: [] }); },
      }, {
        name: "report_scheduled_task_outcome", queryBound: true, description: "Outcome", inputSchema: {}, handler: function() { return Promise.resolve({ content: [{ type: "text", text: "outcome-" + queryGeneration }] }); },
      }, {
        name: "live_tool", description: "Live", inputSchema: {},
        handler: function() { return Promise.resolve({ content: [{ type: "text", text: "generation-" + queryGeneration }] }); },
      }];
    },
    onUserInputRequest: function(boundSession, request, respond) { presentedQuestions += 1; respond({ answer: "ok" }); },
    send: function() {},
  });

  await bridge.startQuery(session, "Schedule this work", null, null);
  assert.equal(session.codexDynamicToolCatalogVersion, 5);
  assert.equal(queryOptions.userInputMode, "fallback");
  assert.equal(queryOptions.dynamicTools.some(function(tool) { return tool.name === "ask_user_questions"; }), true);
  assert.equal(queryOptions.dynamicTools.some(function(tool) { return tool.name === "report_scheduled_task_outcome"; }), true);
  assert.equal((await queryOptions.callDynamicTool("report_scheduled_task_outcome", {})).content[0].text, "outcome-1");
  var ordinaryResponse = function() {};
  ordinaryResponse.cancel = function() { assert.fail("ordinary multi-question input must remain available"); };
  queryOptions.onUserInputRequest({ questions: [{ question: "First?" }, { question: "Second?" }] }, ordinaryResponse);
  assert.equal(presentedQuestions, 1);
  assert.equal((await queryOptions.callDynamicTool("live_tool", {})).content[0].text, "generation-2");
  assert.equal((await queryOptions.callDynamicTool("begin_scheduled_task_interview", {})).content[0].text, "interview-1");
  var cancellation = "";
  var nativeResponse = function() {};
  nativeResponse.cancel = function(reason) { cancellation = reason; };
  queryOptions.onUserInputRequest({ questions: [{ question: "First?" }, { question: "Second?" }] }, nativeResponse);
  assert.match(cancellation, /exactly one question at a time/);
  assert.equal(presentedQuestions, 1, "active schedule multi-question input is rejected before presentation");
  var nativeTool = await queryOptions.canUseTool("AskUserQuestion", { questions: [{ question: "First?" }, { question: "Second?" }] }, {});
  assert.equal(nativeTool.behavior, "deny");
  assert.match(nativeTool.message, /exactly one question at a time/);
  assert.equal((await queryOptions.callDynamicTool("propose_scheduled_task", {})).content[0].text, "interview-1");
  assert.equal((await queryOptions.canUseTool("begin_scheduled_task_interview", {}, {})).behavior, "allow");
  assert.equal(bridge.checkToolWhitelist("mcp__clay-scheduled-tasks__propose_scheduled_task", {}).behavior, "allow");
  var currentSnapshot = bridge.getQueryToolDefs(session, session._sdkQueryGeneration);
  assert.deepEqual(currentSnapshot.map(function(tool) { return tool.name; }).sort(), ["ask_user_questions", "begin_scheduled_task_interview", "list_scheduled_tasks", "live_tool", "propose_scheduled_task", "read_scheduled_task", "report_scheduled_task_outcome", "update_scheduled_task"]);
  assert.deepEqual(bridge.getQueryToolDefs({ localId: session.localId, _sdkQueryGeneration: session._sdkQueryGeneration }, session._sdkQueryGeneration), [], "snapshot identity is the exact session object");
  assert.deepEqual(bridge.getQueryToolDefs(session, session._sdkQueryGeneration - 1), []);
  var fallbackDef = currentSnapshot.find(function(tool) { return tool.name === "ask_user_questions"; });
  session._sdkQueryGeneration += 1;
  assert.deepEqual(bridge.getQueryToolDefs(session, session._sdkQueryGeneration - 1), []);
  var staleFallback = await fallbackDef.handler({ questions: [{ question: "Stale?" }] });
  assert.equal(staleFallback.isError, true);
  assert.match(staleFallback.content[0].text, /older query/);
});

test("Codex catalog marker requires confirmed fresh thread start and is never inferred from a lazy handle or resume", async function () {
  var queryCount = 0;
  var adapter = {
    vendor: "codex",
    userInputCapability: { mode: "native", native: true },
    createQuery: function() {
      queryCount += 1;
      if (queryCount === 1) return Promise.resolve(createEndingHandle([{ yokeType: "error", text: "thread/start failed" }]));
      return Promise.resolve(createEndingHandle([{ yokeType: "session_started", sessionId: "existing-thread" }]));
    },
  };
  var session = { localId: 37, vendor: "codex", pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sessions = new Map([[37, session]]);
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {
      sessions: sessions, availableModels: [], saveSessionFile: function() {}, broadcastSessionList: function() {},
      sendAndRecord: function() {}, sendToSession: function() {},
    },
    adapter: adapter,
    adapters: { codex: adapter },
    getSessionToolDefs: function() {
      return [
        { name: "begin_scheduled_task_interview", queryBound: true, inputSchema: {}, handler: function() {} },
        { name: "propose_scheduled_task", queryBound: true, inputSchema: {}, handler: function() {} },
      ];
    },
    send: function() {},
  });
  await bridge.startQuery(session, "Fresh attempt", null, null);
  assert.equal(session.codexDynamicToolCatalogVersion, undefined, "lazy createQuery success is not catalog confirmation");
  session.cliSessionId = "existing-thread";
  await bridge.startQuery(session, "Resume after failure", null, null);
  assert.equal(session.codexDynamicToolCatalogVersion, undefined, "a resumed session_start cannot mark a catalog omitted by thread/resume");
  assert.equal(require("../lib/yoke/session-tool-transport").availableForSession(session).available, false);
});

test("a fresh Codex scheduled Driver retains its outcome catalog on resume", async function () {
  var queryOptions = [];
  var adapter = {
    vendor: "codex",
    userInputCapability: { mode: "native", native: true },
    createQuery: function(options) {
      queryOptions.push(options);
      return Promise.resolve(createEndingHandle([{ yokeType: "session_started", sessionId: "scheduled-driver-thread" }]));
    },
  };
  var session = { localId: 42, vendor: "codex", pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {
      sessions: new Map([[42, session]]), availableModels: [], saveSessionFile: function() {},
      broadcastSessionList: function() {}, sendAndRecord: function() {}, sendToSession: function() {},
    },
    adapter: adapter,
    adapters: { codex: adapter },
    getSessionToolDefs: function() {
      return [{ name: "report_scheduled_task_outcome", queryBound: true, inputSchema: {}, handler: function() { return Promise.resolve({ content: [] }); } }];
    },
    send: function() {},
  });
  await bridge.startQuery(session, "Run scheduled task", null, null);
  assert.equal(session.codexDynamicToolCatalogVersion, 5);
  assert.equal(require("../lib/yoke/session-tool-transport").availableForSession(session).available, true);
  await bridge.startQuery(session, "Resume review", null, null);
  assert.equal(queryOptions[1].resumeSessionId, "scheduled-driver-thread");
  assert.equal(queryOptions[1].dynamicTools.some(function(tool) { return tool.name === "report_scheduled_task_outcome"; }), true);
});

test("a stale authorized Codex Driver receives only an exact-query Issues recovery bridge", async function () {
  var queryOptions = [];
  var authorized = true;
  var session = { localId: 71, vendor: "codex", cliSessionId: "old-thread", pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var adapter = { vendor: "codex", createQuery: function(options) { queryOptions.push(options); return Promise.resolve(createEndingHandle([])); } };
  var bridge = createSDKBridge({
    cwd: process.cwd(), slug: "private-project", clayPort: 3888, clayAuthToken: "scoped-token",
    sessionManager: { sessions: new Map([[71, session]]), availableModels: [], saveSessionFile: function() {}, broadcastSessionList: function() {}, sendAndRecord: function() {}, sendToSession: function() {} },
    adapter: adapter, adapters: { codex: adapter }, canUseSessionTools: function() { return authorized; },
    getSessionToolDefs: function() {
      return authorized ? [{ name: "create_issue", inputSchema: {}, handler: function() { return Promise.resolve({ content: [] }); } }] : [];
    }, send: function() {},
  });
  await bridge.startQuery(session, "Continue", null, null);
  assert.equal(queryOptions[0].sessionMcpServer.name, "clay-session-tools");
  assert.deepEqual(queryOptions[0].sessionMcpServer.args.slice(-5), ["--session", "71", "--query-generation", "1", "--session-only"]);
  assert.deepEqual(queryOptions[0].sessionMcpServer.env, { CLAY_AUTH_TOKEN: "scoped-token" });
  assert.equal(session.codexIssuesToolCatalogVersion, undefined, "starting a recovery transport does not persist a catalog-complete marker");
  authorized = false;
  await bridge.startQuery(session, "Continue after revocation", null, null);
  assert.equal(queryOptions[1].sessionMcpServer, undefined, "revoked sessions cannot receive the recovery transport");
});

test("a fresh Codex Issues catalog is marked only after thread creation", async function () {
  var session = { localId: 72, vendor: "codex", pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var adapter = { vendor: "codex", createQuery: function() { return Promise.resolve(createEndingHandle([{ yokeType: "session_started", sessionId: "fresh-issues-thread" }])); } };
  var bridge = createSDKBridge({
    cwd: process.cwd(), sessionManager: { sessions: new Map([[72, session]]), availableModels: [], saveSessionFile: function() {}, broadcastSessionList: function() {}, sendAndRecord: function() {}, sendToSession: function() {} },
    adapter: adapter, adapters: { codex: adapter },
    getSessionToolDefs: function() { return [{ name: "create_issue", inputSchema: {}, handler: function() { return Promise.resolve({ content: [] }); } }]; }, send: function() {},
  });
  await bridge.startQuery(session, "Create an issue", null, null);
  assert.equal(session.codexIssuesToolCatalogVersion, 1);
});

test("structured-input fallback rechecks live authorization even when its dynamic handler is retained", async function () {
  var queryOptions = null;
  var authorized = true;
  var prompts = 0;
  var adapter = {
    vendor: "codex",
    userInputCapability: { mode: "fallback", native: false },
    createQuery: function(options) { queryOptions = options; return Promise.resolve(createEndingHandle([])); },
  };
  var session = { localId: 38, vendor: "codex", pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {
      sessions: new Map([[38, session]]), availableModels: [], saveSessionFile: function() {},
      broadcastSessionList: function() {}, sendAndRecord: function() {}, sendToSession: function() {},
    },
    adapter: adapter,
    adapters: { codex: adapter },
    getSessionToolDefs: function() { return [{ name: "begin_scheduled_task_interview", queryBound: true, inputSchema: {}, handler: function() {} }]; },
    canUseSessionTools: function() { return authorized; },
    onUserInputRequest: function(boundSession, request, respond) { prompts += 1; respond({ question_1: "Now" }); },
    send: function() {},
  });
  await bridge.startQuery(session, "Schedule", null, null);
  var fallbackDef = bridge.getQueryToolDefs(session, session._sdkQueryGeneration).find(function(tool) { return tool.name === "ask_user_questions"; });
  authorized = false;
  var denied = await fallbackDef.handler({ questions: [{ question: "When?" }] });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /unavailable or older query/);
  assert.equal(prompts, 0);
  await assert.rejects(queryOptions.callDynamicTool("ask_user_questions", { questions: [{ question: "When?" }] }), /Session tool not found/);
});

test("unsupported schedule transport does not suppress unrelated session tools", async function () {
  var queryOptions = null;
  var prompts = 0;
  var adapter = { vendor: "antigravity", createQuery: function(options) { queryOptions = options; return Promise.resolve(createEndingHandle([])); } };
  var session = { localId: 39, vendor: "antigravity", pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {
      sessions: new Map([[39, session]]), availableModels: [], saveSessionFile: function() {},
      broadcastSessionList: function() {}, sendAndRecord: function() {}, sendToSession: function() {},
    },
    adapter: adapter,
    adapters: { antigravity: adapter },
    getSessionToolDefs: function() { return [{ name: "unrelated_tool", inputSchema: {}, handler: function() {} }]; },
    onUserInputRequest: function(boundSession, request, respond) { prompts += 1; respond({ question_1: "Available" }); },
    send: function() {},
  });
  await bridge.startQuery(session, "Continue", null, null);
  assert.equal(queryOptions.dynamicTools.some(function(tool) { return tool.name === "unrelated_tool"; }), true);
  var question = await queryOptions.callDynamicTool("ask_user_questions", { questions: [{ question: "Continue?" }] });
  assert.equal(question.isError, undefined);
  assert.equal(prompts, 1, "non-schedule structured input is not coupled to schedule capability");
});

test("Loop interview and legacy crafting sessions use the structured-input fallback only while active", async function() {
  var queryOptions = [];
  var adapter = {
    vendor: "codex",
    userInputCapability: { mode: "native", native: true },
    createQuery: function(options) { queryOptions.push(options); return Promise.resolve(createEndingHandle([])); },
  };
  var sessions = new Map();
  var sm = { sessions: sessions, availableModels: [], saveSessionFile: function() {}, broadcastSessionList: function() {}, sendAndRecord: function() {}, sendToSession: function() {} };
  var bridge = createSDKBridge({
    cwd: process.cwd(), sessionManager: sm, adapter: adapter, adapters: { codex: adapter }, send: function() {},
    isDriverOperatedSession: function(session) { return !!session.worker; },
  });
  var interview = { localId: 41, vendor: "codex", history: [{ source: "loop_interview", interviewId: "active" }] };
  sessions.set(41, interview);
  await bridge.startQuery(interview, "question", null, null);
  assert.equal(queryOptions[0].userInputMode, "fallback");
  interview.history.push({ source: "loop_interview_cancel", interviewId: "active" });
  await bridge.startQuery(interview, "ordinary", null, null);
  assert.equal(queryOptions[1].userInputMode, "native");
  var accepted = { localId: 44, vendor: "codex", history: [{ source: "loop_interview", interviewId: "accepted" }, { source: "loop_interview_close", interviewId: "accepted" }], loopInterviewBrief: { id: "brief" } };
  sessions.set(44, accepted);
  await bridge.startQuery(accepted, "after close", null, null);
  assert.equal(queryOptions[2].userInputMode, "native");
  var review = { localId: 45, vendor: "codex", history: [{ source: "loop_interview", interviewId: "review" }], loopInterviewBrief: { id: "brief" } };
  sessions.set(45, review);
  await bridge.startQuery(review, "clarify", null, null);
  assert.equal(queryOptions[3].userInputMode, "fallback");
  review.loopInterviewHandoff = { state: "starting" };
  await bridge.startQuery(review, "handoff", null, null);
  assert.equal(queryOptions[4].userInputMode, "native");
  review.loopInterviewHandoff = null;
  review.autonomousRun = { state: "running" };
  await bridge.startQuery(review, "run", null, null);
  assert.equal(queryOptions[5].userInputMode, "native");
  var crafting = { localId: 42, vendor: "codex", ralphCraftingMode: true, loop: { role: "crafting" } };
  sessions.set(42, crafting);
  await bridge.startQuery(crafting, "craft", null, null);
  assert.equal(queryOptions[6].userInputMode, "fallback");
  var worker = { localId: 43, vendor: "codex", worker: true, ralphCraftingMode: true, loop: { role: "crafting" } };
  sessions.set(43, worker);
  await bridge.startQuery(worker, "worker", null, null);
  assert.equal(queryOptions[7].userInputMode, "native");
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

test("a correlated merged Claude result clears every answered queued message", function() {
  var recorded = [];
  var bridge = createBridge({
    sendAndRecord: function(session, msg) { recorded.push(msg); },
    sendToSession: function() {},
    broadcastSessionList: function() {},
  });
  var session = {
    localId: 13, isProcessing: true, _awaitingTurnResult: true, _queuedTurnCount: 2,
    pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {},
    activeTaskToolIds: {}, taskIdMap: {}, responsePreview: "merged reply", history: [], turnCount: 0,
  };
  bridge.processSDKMessage(session, {
    yokeType: "result", cost: 1, answeredUserMessageCount: 3,
    userMessageIds: ["a", "b", "c"], resultIndex: 0,
  });
  assert.strictEqual(session.isProcessing, false);
  assert.strictEqual(session._awaitingTurnResult, false);
  assert.strictEqual(session._queuedTurnCount, 0);
  var result = recorded.find(function(msg) { return msg.type === "result"; });
  assert.deepStrictEqual(result.userMessageIds, ["a", "b", "c"]);
  assert.strictEqual(result.resultIndex, 0);
});
