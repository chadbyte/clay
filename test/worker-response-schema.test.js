var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");
var EventEmitter = require("node:events");
var Client = require("@modelcontextprotocol/sdk/client/index.js").Client;
var InMemoryTransport = require("@modelcontextprotocol/sdk/inMemory.js").InMemoryTransport;
var sdk = require("@anthropic-ai/claude-agent-sdk");
var createClaudeAdapter = require("../lib/yoke/adapters/claude").createClaudeAdapter;
var extractMcpDescriptors = require("../lib/sdk-mcp-descriptors").extractMcpDescriptors;
var attachWorkerPermission = require("../lib/project-worker-permission").attachWorkerPermission;
var attachAskUser = require("../lib/project-ask-user").attachAskUser;
var userInput = require("../lib/yoke/user-input");

// Run the production worker reconstruction and IPC handlers without starting a CLI.
function workerRuntime(daemonServers) {
  var socket = new EventEmitter();
  socket.write = function (line) {
    var message = JSON.parse(line);
    if (message.type !== "mcp_tool_call") return;
    Promise.resolve().then(function () {
      return daemonServers[message.serverName].instance._registeredTools[message.toolName].handler(message.args);
    }).then(function (result) {
      socket.emit("data", Buffer.from(JSON.stringify({ type: "mcp_tool_result", requestId: message.requestId, result: result }) + "\n"));
    });
  };
  var filename = path.join(__dirname, "../lib/yoke/adapters/claude-worker.js");
  var context = vm.createContext({
    require: function (name) {
      if (name === "net") return { connect: function () { return socket; } };
      if (name === "fs") return { writeSync: function () {} };
      if (name.indexOf("./") === 0 || name.indexOf("../") === 0) return require(path.resolve(path.dirname(filename), name));
      return require(name);
    },
    __dirname: path.dirname(filename),
    process: { env: {}, argv: ["node", filename, "/test.sock"], on: function () {} },
    console: console,
    setInterval: function () {}, clearInterval: function () {}, setTimeout: setTimeout,
    AbortController: AbortController,
  });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename: filename });
  return context;
}

function world() {
  var driver = { localId: 1, ownerId: "owner", history: [] };
  var worker = { localId: 2, ownerId: "owner", history: [] };
  var group = { id: "pair", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var deliveries = [];
  var router = attachWorkerPermission({
    sm: { sessions: new Map([[1, driver], [2, worker]]) },
    splitStore: { groupForMember: function () { return group; } },
    resumeDriverWithMessage: function (session, text, meta) { deliveries.push(meta); return true; },
    requestDetach: function () { return true; },
  });
  var adapter = createClaudeAdapter({ cwd: process.cwd() });
  var servers = { "clay-sessions": adapter.createToolServer({ name: "clay-sessions", version: "1.0.0", tools: router.getToolDefs(driver) }) };
  return { driver: driver, worker: worker, router: router, deliveries: deliveries, servers: servers };
}

test("Worker response schemas and calls survive Claude descriptor serialization and IPC reconstruction", { timeout: 5000 }, async function () {
  var w = world();
  var descriptors = JSON.parse(JSON.stringify(extractMcpDescriptors(w.servers)));
  var permission = descriptors[0].tools.find(function (tool) { return tool.name === "respond_to_worker_permission"; });
  assert.deepEqual(permission.inputSchema.required.sort(), ["decision", "requestId"]);
  assert.equal(permission.inputSchema.properties.requestId.type, "string");
  var runtime = workerRuntime(w.servers);
  var rebuilt = runtime.buildMcpServersFromDescriptors(descriptors, sdk)["clay-sessions"];
  var transports = InMemoryTransport.createLinkedPair();
  var client = new Client({ name: "worker-response-regression", version: "1.0.0" });
  try {
    await Promise.all([client.connect(transports[0]), rebuilt.instance.connect(transports[1])]);
    var catalog = await client.listTools();
    var listed = catalog.tools.find(function (tool) { return tool.name === "respond_to_worker_permission"; });
    assert.deepEqual(listed.inputSchema.required.sort(), ["decision", "requestId"]);
    var question = catalog.tools.find(function (tool) { return tool.name === "respond_to_worker_question"; });
    assert.deepEqual(question.inputSchema.required.sort(), ["action", "requestId"]);
    assert.equal(question.inputSchema.properties.answers.type, "object");
    for (var decision of ["allow", "deny"]) {
      var pending = w.router.routeIfWorker(w.worker, { toolName: "Write", input: { file_path: "/tmp/scoped.txt" }, toolUseId: decision });
      var requestId = w.deliveries[w.deliveries.length - 1].requestId;
      var invalid = await client.callTool({ name: "respond_to_worker_permission", arguments: { decision: decision } });
      assert.equal(invalid.isError, true);
      assert.equal(w.router.pendingCountFor(w.worker), 1);
      var response = await client.callTool({ name: "respond_to_worker_permission", arguments: { requestId: requestId, decision: decision, reason: "Outside scope" } });
      assert.equal(JSON.parse(response.content[0].text).status, "resolved");
      var result = await pending;
      assert.equal(result.behavior, decision);
      if (decision === "allow") assert.deepEqual(result.updatedInput, { file_path: "/tmp/scoped.txt" });
      else assert.match(result.message, /Outside scope/);
    }
    var ask = attachAskUser({
      record: function (session, event) { session.history.push(event); },
      getWorkerQuestionRouter: function () { return w.router; },
    });
    var answer = userInput.dispatchUserInput(ask.createHandler(w.worker), {
      questions: [{ id: "scope", question: "Which scope?", options: [{ label: "Existing task" }, { label: "Expanded task" }] }],
    }, { requestId: "native_question" });
    var questionId = w.deliveries[w.deliveries.length - 1].requestId;
    var answered = await client.callTool({ name: "respond_to_worker_question", arguments: {
      requestId: questionId, action: "answer", answers: { scope: ["Existing task"] },
    } });
    assert.equal(JSON.parse(answered.content[0].text).status, "answered");
    assert.deepEqual((await answer).answers, { scope: ["Existing task"] });
  } finally {
    w.router.cancelForSession(w.worker, "Test cleanup");
    await client.close();
    await rebuilt.instance.close();
    await w.servers["clay-sessions"].instance.close();
  }
});

test("descriptor conversion retains Zod v4 fields, nullable values and no-argument tools", function () {
  var z = require("zod");
  var server = createClaudeAdapter({ cwd: process.cwd() }).createToolServer({
    name: "mixed", version: "1.0.0", tools: [
      { name: "v4", description: "v4", inputSchema: { message: z.string(), wait: z.boolean().optional(), cron: z.string().nullable() }, handler: function () {} },
      { name: "empty", description: "empty", inputSchema: {}, handler: function () {} },
    ],
  });
  var descriptors = extractMcpDescriptors({ mixed: server });
  var schema = descriptors[0].tools[0].inputSchema;
  assert.deepEqual(schema.required.sort(), ["cron", "message"]);
  assert.equal(schema.properties.wait.type, "boolean");
  assert.ok(schema.properties.cron.anyOf || Array.isArray(schema.properties.cron.type));
  assert.deepEqual(descriptors[0].tools[1].inputSchema.properties, {});
});

test("unsupported schemas fail explicitly instead of publishing a tool with missing arguments", function () {
  var z = require("zod");
  assert.throws(function () {
    extractMcpDescriptors({ broken: { instance: { _registeredTools: {
      invalid: { inputSchema: z.object({ date: z.date() }) },
    } } } });
  }, /Cannot serialize MCP tool schema broken\/invalid/);
});
