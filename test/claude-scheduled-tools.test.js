var test = require("node:test");
var assert = require("node:assert/strict");
var Client = require("@modelcontextprotocol/sdk/client/index.js").Client;
var InMemoryTransport = require("@modelcontextprotocol/sdk/inMemory.js").InMemoryTransport;
var execFileSync = require("node:child_process").execFileSync;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var createClaudeAdapter = require("../lib/yoke/adapters/claude").createClaudeAdapter;
var scheduledTasksModule = require("../lib/project-scheduled-tasks");
var attachScheduledTasks = scheduledTasksModule.attachScheduledTasks;

function sdkFixture(captures) {
  return {
    query: function (args) {
      captures.push(args.options);
      return {
        close: function () {},
        setPermissionMode: function () {},
        [Symbol.asyncIterator]: function () { return { next: function () { return Promise.resolve({ done: true }); } }; },
      };
    },
  };
}

test("actual Claude adapter receives query-bound schedule and structured-input MCP servers on fresh and resumed queries", async function () {
  var captures = [];
  var sdk = sdkFixture(captures);
  var adapter = createClaudeAdapter({ cwd: process.cwd(), loadSDK: function () { return Promise.resolve(sdk); } });
  var directServer = adapter.createToolServer({
    name: "review",
    version: "1.0.0",
    tools: [{
      name: "probe",
      description: "probe",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      handler: function () { return { content: [{ type: "text", text: "ok" }] }; },
    }],
  });
  assert.equal(directServer.type, "sdk");
  assert.equal(typeof directServer.instance._registeredTools.probe.inputSchema.shape.name.parse, "function");
  var fresh = { localId: 81, vendor: "claude", mode: "gui", history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var resumed = { localId: 82, vendor: "claude", mode: "gui", cliSessionId: "resume-82", history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var outcomeOnly = { localId: 83, vendor: "claude", mode: "gui", history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sessions = new Map([[81, fresh], [82, resumed], [83, outcomeOnly]]);
  var sm = {
    sessions: sessions, availableModels: [], modelsByVendor: { claude: [] }, capabilitiesByVendor: { claude: {} },
    saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {}, sendAndRecord: function () {}, sendToSession: function () {},
  };
  var service = attachScheduledTasks({
    cwd: process.cwd(), sm: sm, registry: { getAll: function () { return []; } }, isMate: false,
    sendTo: function () {}, isDriverOperatedSession: function () { return false; }, canUseSession: function () { return true; },
  });
  var outcomeCalls = 0;
  function toolDefs(session) {
    var outcome = { name: "report_scheduled_task_outcome", queryBound: true, description: "Report outcome", inputSchema: { type: "object", properties: { runId: { type: "string" }, outcome: { type: "string" } }, required: ["runId", "outcome"] }, handler: function () { outcomeCalls++; return { content: [{ type: "text", text: "recorded" }] }; } };
    return session === outcomeOnly ? [outcome] : service.getToolDefs(session).concat([outcome]);
  }
  var bridge = createSDKBridge({
    cwd: process.cwd(), sessionManager: sm, adapter: adapter, adapters: { claude: adapter },
    getSessionToolDefs: toolDefs,
    onUserInputRequest: function (session, request, respond) { respond({ task: "Check the build" }); },
    send: function () {},
  });

  var blankInterviewPrompt = scheduledTasksModule.interviewPrompt();
  assert.match(blankInterviewPrompt, /first ask what task they want scheduled/);
  assert.match(blankInterviewPrompt, /mcp__yoke-user-input__ask_user_questions/);
  assert.match(blankInterviewPrompt, /mcp__clay-scheduled-tasks__propose_scheduled_task/);
  await bridge.startQuery(fresh, blankInterviewPrompt, null, null);
  await bridge.startQuery(resumed, "Schedule this existing conversation", null, null);
  assert.equal(captures.length, 2);
  for (var i = 0; i < captures.length; i++) {
    var servers = captures[i].mcpServers;
    assert.deepEqual(Object.keys(servers).sort(), ["clay-scheduled-tasks", "yoke-user-input"]);
    assert.ok(servers["clay-scheduled-tasks"]);
    assert.ok(servers["yoke-user-input"]);
    assert.equal(captures[i].dynamicTools, undefined, "Claude receives tools through native SDK MCP servers, not Codex dynamicTools");
    var scheduleTools = servers["clay-scheduled-tasks"].instance._registeredTools;
    assert.deepEqual(Object.keys(scheduleTools).sort(), ["begin_scheduled_task_interview", "list_scheduled_tasks", "propose_scheduled_task", "read_scheduled_task", "report_scheduled_task_outcome", "update_scheduled_task"]);
    assert.equal(typeof scheduleTools.propose_scheduled_task.inputSchema.shape.name.parse, "function");
    assert.equal(scheduleTools.propose_scheduled_task.inputSchema.shape.cron.parse(null), null);
    assert.deepEqual(scheduleTools.propose_scheduled_task.inputSchema.shape.scheduleRule.parse({ anchorDate: "2099-08-09", time: "16:45" }), { anchorDate: "2099-08-09", time: "16:45" });
    var ordinaryBundled = await captures[i].canUseTool("AskUserQuestion", { questions: [{ question: "First?" }, { question: "Second?" }] }, { toolUseID: "ordinary-bundled-" + i });
    assert.equal(ordinaryBundled.behavior, "deny");
    assert.match(ordinaryBundled.message, /structured input fallback/);
    assert.doesNotMatch(ordinaryBundled.message, /exactly one question/);
    var began = await scheduleTools.begin_scheduled_task_interview.handler({});
    assert.equal(JSON.parse(began.content[0].text).status, "interview_started");
    await scheduleTools.report_scheduled_task_outcome.handler({ runId: "run-" + i, outcome: "completed" });
    var nativeBundled = await captures[i].canUseTool("AskUserQuestion", { questions: [{ question: "What task?" }, { question: "When?" }] }, { toolUseID: "native-bundled-" + i });
    assert.equal(nativeBundled.behavior, "deny");
    assert.match(nativeBundled.message, /exactly one question at a time/);
    var nativeSingle = await captures[i].canUseTool("AskUserQuestion", { questions: [{ question: "What task?" }] }, { toolUseID: "native-single-" + i });
    assert.equal(nativeSingle.behavior, "deny");
    assert.match(nativeSingle.message, /structured input fallback/);
    var proposed = await scheduleTools.propose_scheduled_task.handler({ name: "Claude task", instructions: "Run the focused checks.", cron: "0 9 * * 1-5" });
    assert.equal(JSON.parse(proposed.content[0].text).status, "proposed");
    var once = await scheduleTools.propose_scheduled_task.handler({ name: "Claude once", instructions: "Run once.", cron: null, date: "2099-08-09", time: "16:45" });
    assert.equal(JSON.parse(once.content[0].text).draft.cron, null);
    var fallback = servers["yoke-user-input"].instance._registeredTools.ask_user_questions;
    var bundled = await fallback.handler({ questions: [{ question: "What task?" }, { question: "When?" }] });
    assert.equal(bundled.isError, true);
    assert.match(bundled.content[0].text, /exactly one question at a time/);
    var answer = await fallback.handler({ questions: [{ id: "task", question: "What task should run?", options: [] }] });
    assert.equal(JSON.parse(answer.content[0].text).task[0], "Check the build");
  }
  assert.equal(outcomeCalls, 2);
  var transports = InMemoryTransport.createLinkedPair();
  var client = new Client({ name: "scheduled-task-regression", version: "1.0.0" });
  await Promise.all([
    client.connect(transports[0]),
    captures[0].mcpServers["clay-scheduled-tasks"].instance.connect(transports[1]),
  ]);
  var catalog = await client.listTools();
  var proposalTool = catalog.tools.find(function (tool) { return tool.name === "propose_scheduled_task"; });
  assert.deepEqual(proposalTool.inputSchema.required.sort(), ["cron", "instructions", "name"]);
  assert.equal(proposalTool.inputSchema.properties.name.type, "string");
  assert.ok(proposalTool.inputSchema.properties.cron.anyOf || Array.isArray(proposalTool.inputSchema.properties.cron.type));
  assert.ok(proposalTool.inputSchema.properties.scheduleRule);
  var catalogCall = await client.callTool({
    name: "propose_scheduled_task",
    arguments: { name: "Catalog task", instructions: "Validate the native MCP call.", cron: "15 10 * * 1-5" },
  });
  assert.equal(JSON.parse(catalogCall.content[0].text).status, "proposed");
  var invalidCall = await client.callTool({
    name: "propose_scheduled_task",
    arguments: { instructions: "Missing required name.", cron: "15 10 * * 1-5" },
  });
  assert.equal(invalidCall.isError, true);
  assert.match(invalidCall.content[0].text, /invalid|validation|required/i);
  await client.close();
  assert.equal(captures[1].resume, "resume-82");
  await bridge.startQuery(outcomeOnly, "Finish the scheduled run", null, null);
  var outcomeServer = captures[2].mcpServers["clay-scheduled-tasks"].instance._registeredTools;
  assert.deepEqual(Object.keys(outcomeServer), ["report_scheduled_task_outcome"]);
  await outcomeServer.report_scheduled_task_outcome.handler({ runId: "run-only", outcome: "completed" });
  assert.equal(outcomeCalls, 3);
});

test("Claude MCP catalog accepts all scheduled schemas with repository SDK and Zod v3", async function () {
  var adapter = createClaudeAdapter({ cwd: process.cwd() });
  var sessions = new Map();
  var service = attachScheduledTasks({
    cwd: process.cwd(), sm: { sessions: sessions }, registry: { getAll: function () { return []; } },
    isMate: false, sendTo: function () {}, isDriverOperatedSession: function () { return false; },
    canUseSession: function () { return true; },
  });
  var session = { localId: 91, vendor: "claude", mode: "gui", history: [], _sdkQueryGeneration: 1 };
  sessions.set(session.localId, session);
  var server = adapter.createToolServer({ name: "clay-scheduled-tasks", version: "1.0.0", tools: service.getToolDefs(session) });
  var transports = InMemoryTransport.createLinkedPair();
  var client = new Client({ name: "repository-sdk-regression", version: "1.0.0" });
  try {
    await Promise.all([client.connect(transports[0]), server.instance.connect(transports[1])]);
    var catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map(function (tool) { return tool.name; }).sort(), [
      "begin_scheduled_task_interview", "list_scheduled_tasks", "propose_scheduled_task",
      "read_scheduled_task", "update_scheduled_task",
    ]);
  } finally {
    await client.close();
    await server.instance.close();
  }
});

var daemonNodeModules = process.env.CLAUDE_COMPAT_NODE_MODULES_ROOT || "";
test("Claude MCP catalog accepts scheduled schemas with optional exact daemon dependencies", { skip: !daemonNodeModules }, function () {
  var root = daemonNodeModules;
  var script = [
    "var Module = require('module'); var path = require('path'); var root = process.env.CLAUDE_COMPAT_NODE_MODULES_ROOT; var sdkPath = path.join(root, '@anthropic-ai/claude-agent-sdk'); var zodPath = path.join(root, 'zod'); var zodV3Path = path.join(zodPath, 'v3'); var exactSdk = require(sdkPath); var exactZodV3 = require(zodV3Path); var sdkPackage = require(path.join(sdkPath, 'package.json')); var zodPackage = require(path.join(zodPath, 'package.json')); if (!sdkPackage.version || !zodPackage.version || require.resolve(sdkPath).indexOf(root) !== 0 || require.resolve(zodV3Path).indexOf(root) !== 0 || !exactSdk.createSdkMcpServer || !exactZodV3.z) throw new Error('Exact dependency path/version assertion failed: SDK ' + sdkPackage.version + ', Zod ' + zodPackage.version); var load = Module._load; Module._load = function (request, parent, isMain) { if (request === 'zod/v3') return exactZodV3; if (request === 'zod') return require(zodPath); if (request === '@anthropic-ai/claude-agent-sdk') return exactSdk; return load.call(this, request, parent, isMain); };",
    "var Client = require('@modelcontextprotocol/sdk/client/index.js').Client;",
    "var T = require('@modelcontextprotocol/sdk/inMemory.js').InMemoryTransport;",
    "var adapter = require('./lib/yoke/adapters/claude').createClaudeAdapter({ cwd: process.cwd() });",
    "var attach = require('./lib/project-scheduled-tasks').attachScheduledTasks;",
    "var sessions = new Map();",
    "var service = attach({ cwd: process.cwd(), sm: { sessions: sessions }, registry: { getAll: function () { return []; } }, isMate: false, sendTo: function () {}, isDriverOperatedSession: function () { return false; }, canUseSession: function () { return true; } });",
    "var session = { localId: 92, vendor: 'claude', mode: 'gui', history: [], _sdkQueryGeneration: 1 }; sessions.set(92, session);",
    "var server = adapter.createToolServer({ name: 'clay-scheduled-tasks', version: '1.0.0', tools: service.getToolDefs(session) });",
    "var pair = T.createLinkedPair(); var client = new Client({ name: 'exact-daemon-regression', version: '1.0.0' });",
    "Promise.all([client.connect(pair[0]), server.instance.connect(pair[1])]).then(function () { return client.listTools(); }).then(function (catalog) { var names = catalog.tools.map(function (tool) { return tool.name; }).sort().join(','); if (names !== 'begin_scheduled_task_interview,list_scheduled_tasks,propose_scheduled_task,read_scheduled_task,update_scheduled_task') throw new Error('Unexpected scheduled tool catalog: ' + names); }).then(function () { return client.close(); }).then(function () { return server.instance.close(); }).catch(function (error) { console.error(error.stack || error); process.exitCode = 1; });",
  ].join("\n");
  execFileSync(process.execPath, ["-e", script], { cwd: process.cwd(), env: Object.assign({}, process.env, { CLAUDE_COMPAT_NODE_MODULES_ROOT: root }) });
});
