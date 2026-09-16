var test = require("node:test");
var assert = require("node:assert/strict");
var childProcess = require("child_process");
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var readline = require("readline");
var sessionTools = require("../lib/yoke/session-tool-transport");
var scheduledTasks = require("../lib/project-scheduled-tasks");
var attachScheduledTasks = scheduledTasks.attachScheduledTasks;
var createSessionManager = require("../lib/sessions").createSessionManager;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var createSessionQueryToolBridge = require("../lib/session-query-tool-bridge").createSessionQueryToolBridge;
var attachHTTP = require("../lib/project-http").attachHTTP;

test("all ten registry vendors have an explicit delivery classification without claiming runtime execution", function () {
  var expected = {
    claude: "sdk-mcp",
    codex: "dynamic",
    antigravity: "none",
    opencode: "stdio-mcp",
    kimi: "stdio-mcp",
    grok: "stdio-mcp",
    copilot: "stdio-mcp",
    qwen: "stdio-mcp",
    junie: "stdio-mcp",
    kiro: "stdio-mcp",
  };
  var vendors = Object.keys(expected);
  for (var i = 0; i < vendors.length; i++) {
    var vendor = vendors[i];
    assert.equal(sessionTools.capability(vendor).kind, expected[vendor]);
  }
  assert.equal(sessionTools.scheduleToolName("claude", "propose_scheduled_task"), "mcp__clay-scheduled-tasks__propose_scheduled_task");
  assert.equal(sessionTools.scheduleToolName("codex", "propose_scheduled_task"), "propose_scheduled_task");
  assert.equal(sessionTools.scheduleToolName("kiro", "propose_scheduled_task"), "clay-scheduled-tasks__propose_scheduled_task");
  assert.equal(sessionTools.questionToolName("opencode"), "yoke-user-input__ask_user_questions");
  assert.match(scheduledTasks.interviewPrompt("opencode"), /yoke-user-input__ask_user_questions/);
  assert.match(scheduledTasks.interviewPrompt("opencode"), /clay-scheduled-tasks__propose_scheduled_task/);
});

test("legacy Codex resumes expose an honest assisted-interview migration while retaining manual creation", function () {
  var oldSession = { localId: 10, vendor: "codex", mode: "gui", cliSessionId: "legacy-thread", history: [] };
  var newSession = { localId: 11, vendor: "codex", mode: "gui", cliSessionId: "catalog-thread", codexDynamicToolCatalogVersion: sessionTools.CODEX_CATALOG_VERSION, history: [] };
  var freshSession = { localId: 12, vendor: "codex", mode: "gui", history: [] };
  var sessions = new Map([[10, oldSession], [11, newSession], [12, freshSession]]);
  var sent = [];
  var sm = {
    sessions: sessions,
    appendToSessionFile: function () {}, saveSessionFile: function () {},
    sendToSession: function () {},
  };
  var current = oldSession;
  var service = attachScheduledTasks({
    sm: sm, registry: {}, isMate: false,
    getSessionForWs: function () { return current; },
    sendTo: function (ws, message) { sent.push(message); },
    isDriverOperatedSession: function () { return false; },
    canUseSession: function () { return true; },
  });
  assert.deepEqual(service.getToolDefs(oldSession), []);
  assert.equal(service.getSystemPrompt(oldSession), "");
  assert.equal(service.getToolDefs(newSession).length, 5);
  assert.equal(service.getToolDefs(freshSession).length, 5);
  service.handleMessage({}, { type: "scheduled_task_interview_start", sessionId: 10, requestId: "assisted" });
  var rejection = sent.pop();
  assert.equal(rejection.ok, false);
  assert.match(rejection.error, /predates/);
  service.handleMessage({}, { type: "scheduled_task_manual_start", sessionId: 10, requestId: "manual" });
  assert.equal(sent.pop().ok, true);
});

test("confirmed successful fresh Codex catalog markers survive session reload", async function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-codex-tool-catalog-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var options = { cwd: path.join(root, "project"), sessionsBase: path.join(root, "sessions"), cliSessionsDir: path.join(root, "cli"), send: function () {} };
  var first = createSessionManager(options);
  var session = first.createSession({ vendor: "codex" });
  session.mode = "gui";
  var service = attachScheduledTasks({
    sm: first, registry: {}, isMate: false, isDriverOperatedSession: function () { return false; }, canUseSession: function () { return true; },
  });
  var adapter = {
    vendor: "codex", userInputCapability: { mode: "native", native: true },
    createQuery: function () { return Promise.resolve(endingHandle([{ yokeType: "session_started", sessionId: "codex-thread" }])); },
  };
  var sdk = createSDKBridge({
    cwd: options.cwd, sessionManager: first, adapter: adapter, adapters: { codex: adapter }, getSessionToolDefs: service.getToolDefs, send: function () {},
  });
  await sdk.startQuery(session, "Schedule a review", null, null);
  assert.equal(session.codexDynamicToolCatalogVersion, sessionTools.CODEX_CATALOG_VERSION);
  session.codexIssuesToolCatalogVersion = 1;
  first.saveSessionFile(session);
  var second = createSessionManager(options);
  var restored = Array.from(second.sessions.values()).find(function (item) { return item.cliSessionId === "codex-thread"; });
  assert.ok(restored);
  assert.equal(restored.codexDynamicToolCatalogVersion, sessionTools.CODEX_CATALOG_VERSION);
  assert.equal(restored.codexIssuesToolCatalogVersion, 1);
});

test("a runtime without custom-tool delivery does not advertise a broken interview", function () {
  var session = { localId: 9, vendor: "antigravity", mode: "gui", history: [] };
  var service = attachScheduledTasks({
    sm: { sessions: new Map([[9, session]]) },
    registry: {},
    isMate: false,
    isDriverOperatedSession: function () { return false; },
    canUseSession: function () { return true; },
  });
  assert.deepEqual(service.getToolDefs(session), []);
  assert.equal(service.getSystemPrompt(session), "");
});

function endingHandle(events) {
  var index = 0;
  return {
    pushMessage: function () { return true; }, close: function () {},
    [Symbol.asyncIterator]: function () { return { next: function () {
      if (events && index < events.length) return Promise.resolve({ value: events[index++], done: false });
      return Promise.resolve({ done: true });
    } }; },
  };
}

test("the production stdio bridge reaches project-bound schedule and question handlers and rejects a stale process", async function (t) {
  var taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-stdio-schedule-"));
  t.after(function () { fs.rmSync(taskRoot, { recursive: true, force: true }); });
  var session = { localId: 42, vendor: "opencode", mode: "gui", cliSessionId: "resume-42", history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var scheduleAuthorized = true;
  var sessionAuthorized = true;
  var sm = {
    sessions: new Map([[42, session]]), availableModels: [], modelsByVendor: { opencode: [] }, capabilitiesByVendor: { opencode: {} },
    appendToSessionFile: function () {}, saveSessionFile: function () {}, broadcastSessionList: function () {}, sendAndRecord: function () {}, sendToSession: function () {},
  };
  var records = [{ id: "existing-task", name: "Existing", task: "Keep this", prompt: "Keep this", cron: "0 8 * * *", ownerId: null, updatedAt: 10, enabled: true, maxIterations: 2 }];
  var registry = {
    getAll: function () { return records; },
    getById: function (id) { return records.find(function (record) { return record.id === id; }) || null; },
    update: function (id, data) { var record = this.getById(id); if (!record) return null; Object.assign(record, data, { updatedAt: record.updatedAt + 1 }); return record; },
  };
  var service = attachScheduledTasks({
    cwd: taskRoot, sm: sm, registry: registry, isMate: false, isDriverOperatedSession: function () { return false; }, canUseSession: function () { return scheduleAuthorized; },
  });
  var outcomeCalls = 0;
  function toolDefs(boundSession) {
    return service.getToolDefs(boundSession).concat([{ name: "report_scheduled_task_outcome", queryBound: true, description: "Report outcome", inputSchema: { type: "object", properties: { runId: { type: "string" }, outcome: { type: "string" } }, required: ["runId", "outcome"] }, handler: function () { outcomeCalls++; return { content: [{ type: "text", text: "recorded" }] }; } }]);
  }
  var adapter = { vendor: "opencode", createToolServer: function () { return null; }, createQuery: function () { return Promise.resolve(endingHandle()); } };
  var sdk = createSDKBridge({
    cwd: process.cwd(), sessionManager: sm, adapter: adapter, adapters: { opencode: adapter }, getSessionToolDefs: toolDefs,
    canUseSessionTools: function () { return sessionAuthorized; },
    onUserInputRequest: function (boundSession, request, respond) {
      var answers = {};
      for (var ai = 0; ai < request.questions.length; ai++) answers[request.questions[ai].id] = "Answer " + (ai + 1);
      respond(answers);
    }, send: function () {}, clayPort: 1,
  });
  await sdk.startQuery(session, "Schedule this work", null, null);
  var queryGeneration = session._sdkQueryGeneration;
  function getMcpBridgeHandler(sessionId, sessionOnly, requestedGeneration) {
    var boundSession = sm.sessions.get(sessionId);
    var queryBridge = createSessionQueryToolBridge({ session: boundSession, sdk: sdk });
    return {
      listTools: function () { return Promise.resolve(queryBridge.listTools(requestedGeneration)); },
      callTool: function (server, tool, args) {
        var result = queryBridge.callTool(requestedGeneration, server, tool, args);
        return result || Promise.reject(new Error("Session tool not found: " + server + "/" + tool));
      },
    };
  }
  var route = attachHTTP({ cwd: process.cwd(), slug: "", project: "Test", getMcpBridgeHandler: getMcpBridgeHandler }).handleHTTP;
  var server = http.createServer(function (req, res) { route(req, res, "/api/mcp-bridge"); });
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  t.after(function () { server.close(); });
  var port = server.address().port;
  var bridgePath = path.join(__dirname, "..", "lib", "yoke", "mcp-bridge-server.js");
  var proc = childProcess.spawn(process.execPath, [bridgePath, "--port", String(port), "--session", "42", "--query-generation", String(queryGeneration), "--session-only"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(function () { if (!proc.killed) proc.kill(); });
  var lines = readline.createInterface({ input: proc.stdout });
  var pending = new Map();
  lines.on("line", function (line) {
    var message = JSON.parse(line);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  function request(id, method, params) {
    return new Promise(function (resolve) {
      pending.set(id, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} }) + "\n");
    });
  }
  await request(1, "initialize", {});
  var catalog = await request(2, "tools/list", {});
  assert.deepEqual(catalog.result.tools.map(function (tool) { return tool.name; }).sort(), [
    "clay-scheduled-tasks__begin_scheduled_task_interview",
    "clay-scheduled-tasks__list_scheduled_tasks",
    "clay-scheduled-tasks__propose_scheduled_task",
    "clay-scheduled-tasks__read_scheduled_task",
    "clay-scheduled-tasks__report_scheduled_task_outcome",
    "clay-scheduled-tasks__update_scheduled_task",
    "yoke-user-input__ask_user_questions",
  ]);
  var ordinaryBundled = await request(19, "tools/call", { name: "yoke-user-input__ask_user_questions", arguments: { questions: [{ question: "Ordinary first?" }, { question: "Ordinary second?" }] } });
  assert.equal(ordinaryBundled.result.isError, undefined, "the schedule catalog alone must not restrict ordinary structured input");
  var calls = [
    [3, "clay-scheduled-tasks__begin_scheduled_task_interview", {}],
    [4, "yoke-user-input__ask_user_questions", { questions: [{ question: "When?" }] }],
    [5, "clay-scheduled-tasks__propose_scheduled_task", { name: "Review", instructions: "Review the project.", cron: "0 9 * * 1-5" }],
    [24, "clay-scheduled-tasks__report_scheduled_task_outcome", { runId: "run-1", outcome: "completed" }],
  ];
  for (var i = 0; i < calls.length; i++) {
    var response = await request(calls[i][0], "tools/call", { name: calls[i][1], arguments: calls[i][2] });
    assert.equal(response.result.isError, undefined);
  }
  assert.equal(outcomeCalls, 1);
  var listResponse = await request(20, "tools/call", { name: "clay-scheduled-tasks__list_scheduled_tasks", arguments: {} });
  var listed = JSON.parse(listResponse.result.content[0].text);
  assert.equal(listed.tasks[0].id, "existing-task");
  var readResponse = await request(21, "tools/call", { name: "clay-scheduled-tasks__read_scheduled_task", arguments: { id: "existing-task" } });
  var read = JSON.parse(readResponse.result.content[0].text);
  assert.equal(read.record.revision, 10);
  var updateResponse = await request(22, "tools/call", { name: "clay-scheduled-tasks__update_scheduled_task", arguments: { id: "existing-task", revision: 10, cron: "15 8 * * *" } });
  var updated = JSON.parse(updateResponse.result.content[0].text);
  assert.equal(updated.ok, true);
  assert.equal(records.length, 1);
  assert.equal(records[0].cron, "15 8 * * *");
  assert.equal(records[0].task, "Keep this");
  assert.equal(service.activeInterviewId(session) !== null, true);
  assert.equal(session.scheduledTaskDraft.name, "Review");
  var bundledQuestion = await request(23, "tools/call", { name: "yoke-user-input__ask_user_questions", arguments: { questions: [{ question: "What?" }, { question: "When?" }] } });
  assert.equal(bundledQuestion.result.isError, true);
  assert.match(bundledQuestion.result.content[0].text, /exactly one question at a time/);
  scheduleAuthorized = false;
  var deniedSchedule = await request(6, "tools/call", { name: "yoke-user-input__ask_user_questions", arguments: { questions: [{ question: "Denied schedule?" }] } });
  assert.equal(deniedSchedule.result.isError, true);
  assert.match(deniedSchedule.result.content[0].text, /unavailable or older query/);
  scheduleAuthorized = true;
  sessionAuthorized = false;
  var deniedSession = await request(7, "tools/call", { name: "yoke-user-input__ask_user_questions", arguments: { questions: [{ question: "Denied session?" }] } });
  assert.equal(deniedSession.result.isError, true);
  assert.match(deniedSession.result.content[0].text, /unavailable or older query/);
  sessionAuthorized = true;
  await sdk.startQuery(session, "Refine this schedule", null, null);
  var nextGeneration = session._sdkQueryGeneration;
  assert.equal(nextGeneration, queryGeneration + 1);
  var stale = await request(8, "tools/call", { name: "clay-scheduled-tasks__propose_scheduled_task", arguments: { name: "Stale", instructions: "Must fail.", cron: "0 9 * * 1-5" } });
  assert.equal(stale.result.isError, true);
  assert.match(stale.result.content[0].text, /Session tool not found/);
  assert.equal(session.scheduledTaskDraft.name, "Review");

  var nextProc = childProcess.spawn(process.execPath, [bridgePath, "--port", String(port), "--session", "42", "--query-generation", String(nextGeneration), "--session-only"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(function () { if (!nextProc.killed) nextProc.kill(); });
  var nextLines = readline.createInterface({ input: nextProc.stdout });
  var nextPending = new Map();
  nextLines.on("line", function (line) {
    var message = JSON.parse(line);
    if (nextPending.has(message.id)) { nextPending.get(message.id)(message); nextPending.delete(message.id); }
  });
  function nextRequest(id, method, params) {
    return new Promise(function (resolve) {
      nextPending.set(id, resolve);
      nextProc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} }) + "\n");
    });
  }
  await nextRequest(10, "initialize", {});
  var nextCatalog = await nextRequest(11, "tools/list", {});
  assert.deepEqual(nextCatalog.result.tools.map(function (tool) { return tool.name; }).sort(), catalog.result.tools.map(function (tool) { return tool.name; }).sort());
  var currentQuestion = await nextRequest(12, "tools/call", { name: "yoke-user-input__ask_user_questions", arguments: { questions: [{ question: "Still when?" }] } });
  assert.equal(currentQuestion.result.isError, undefined);
  var onceProposal = await nextRequest(14, "tools/call", { name: "clay-scheduled-tasks__propose_scheduled_task", arguments: { name: "Review once", instructions: "Review once.", cron: null, date: "2099-08-09", time: "16:45" } });
  assert.equal(JSON.parse(onceProposal.result.content[0].text).draft.cron, null);
  sm.sessions.set(42, Object.assign({}, session));
  var replacedSession = await nextRequest(13, "tools/call", { name: "yoke-user-input__ask_user_questions", arguments: { questions: [{ question: "Replacement?" }] } });
  assert.equal(replacedSession.result.isError, true);
  assert.match(replacedSession.result.content[0].text, /Session tool not found/);
});
