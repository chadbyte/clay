var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var claudeAdapterModule = require("../lib/yoke/adapters/claude");
var createClaudeAdapter = claudeAdapterModule.createClaudeAdapter;
var buildWorkerQueryOptions = claudeAdapterModule.contractTestKit.buildWorkerQueryOptions;

// Claude SDK 0.3.286+ leaves an omitted permissionMode to Claude Code's own
// settings defaultMode, which can start a session in auto mode (no asking)
// on third-party providers or with telemetry off. Clay must always send an
// explicit permissionMode so a plain Ask session is never silently widened.

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

function baseSessionManager(sessions) {
  return {
    sessions: sessions,
    availableModels: [],
    modelsByVendor: { claude: [] },
    capabilitiesByVendor: { claude: {} },
    saveSessionFile: function () {},
    appendToSessionFile: function () {},
    broadcastSessionList: function () {},
    sendAndRecord: function () {},
    sendToSession: function () {},
  };
}

test("a plain GUI session always sends an explicit permissionMode, never omitted", async function () {
  var captures = [];
  var sdk = sdkFixture(captures);
  var adapter = createClaudeAdapter({ cwd: process.cwd(), loadSDK: function () { return Promise.resolve(sdk); } });
  var session = { localId: 201, vendor: "claude", mode: "gui", history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sm = baseSessionManager(new Map([[201, session]]));
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: sm, adapter: adapter, adapters: { claude: adapter }, send: function () {} });

  await bridge.startQuery(session, "hello", null, null);

  assert.equal(captures.length, 1);
  assert.equal(captures[0].permissionMode, "default", "Ask/default must be sent explicitly, not omitted");
});

test("acceptEditsAfterStart still applies explicitly, not left to the CLI default", async function () {
  var captures = [];
  var sdk = sdkFixture(captures);
  var adapter = createClaudeAdapter({ cwd: process.cwd(), loadSDK: function () { return Promise.resolve(sdk); } });
  var session = { localId: 202, vendor: "claude", mode: "gui", acceptEditsAfterStart: true, history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sm = baseSessionManager(new Map([[202, session]]));
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: sm, adapter: adapter, adapters: { claude: adapter }, send: function () {} });

  await bridge.startQuery(session, "hello", null, null);

  assert.equal(captures[0].permissionMode, "acceptEdits");
});

test("handleCanUseTool forwards the SDK-reported mcpServer name/source to the client, trusting only the SDK's opts", async function () {
  var recorded = [];
  var session = { localId: 301, permissionMode: "default", pendingPermissions: {} };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: { currentPermissionMode: "default", permissionRequestIndex: {}, sendAndRecord: function (target, message) { recorded.push(message); } },
    adapter: { vendor: "claude" },
    send: function () {},
    onProcessingChanged: function () {},
  });
  // mcpServer arrives via the SDK's trusted opts, never via the tool's own input.
  // "mcp__external-server__query" is not in Clay's auto-approve whitelist,
  // so this must reach the real permission_request path.
  var decisionPromise = bridge.handleCanUseTool(session, "mcp__external-server__query", { title: "spoofed", mcpServer: { name: "attacker", source: "config" } }, {
    toolUseID: "tu1",
    mcpServer: { name: "external-server", source: "project" },
  });
  var request = recorded.find(function (m) { return m.type === "permission_request"; });
  assert.ok(request, "a permission_request must be sent");
  assert.notEqual(request.requestId, "tu1", "requestId is a freshly generated uuid, not the tool_use_id");
  assert.deepEqual(request.mcpServer, { name: "external-server", source: "project" });
  var pending = session.pendingPermissions[request.requestId];
  assert.ok(pending, "the pending entry must be keyed by requestId");
  assert.deepEqual(pending.mcpServer, { name: "external-server", source: "project" });
  pending.resolve({ behavior: "deny", message: "test cleanup" });
  assert.deepEqual(await decisionPromise, { behavior: "deny", message: "test cleanup" });
});

test("handleCanUseTool sends mcpServer: null rather than omitting it when the SDK reports none", async function () {
  var recorded = [];
  var session = { localId: 302, permissionMode: "default", pendingPermissions: {} };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: { currentPermissionMode: "default", permissionRequestIndex: {}, sendAndRecord: function (target, message) { recorded.push(message); } },
    adapter: { vendor: "claude" },
    send: function () {},
    onProcessingChanged: function () {},
  });
  var decisionPromise = bridge.handleCanUseTool(session, "Write", { file_path: "/tmp/x" }, { toolUseID: "tu2" });
  var request = recorded.find(function (m) { return m.type === "permission_request"; });
  assert.equal(request.mcpServer, null);
  session.pendingPermissions[request.requestId].resolve({ behavior: "deny", message: "test cleanup" });
  await decisionPromise;
});

test("a bypass-permissions session still requests the SDK bypass mode explicitly", async function () {
  var captures = [];
  var sdk = sdkFixture(captures);
  var adapter = createClaudeAdapter({ cwd: process.cwd(), loadSDK: function () { return Promise.resolve(sdk); } });
  var session = { localId: 203, vendor: "claude", mode: "gui", permissionMode: "bypassPermissions", history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sm = baseSessionManager(new Map([[203, session]]));
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: sm, adapter: adapter, adapters: { claude: adapter }, send: function () {} });

  await bridge.startQuery(session, "hello", null, null);

  // Clay's own full-access callback stays in canUseTool; the SDK-level
  // bypassPermissions escape hatch is intentionally not requested here.
  assert.equal(captures[0].permissionMode, "default");
});

test("a literal Auto session sends the SDK's own auto mode explicitly, not omitted", async function () {
  var captures = [];
  var sdk = sdkFixture(captures);
  var adapter = createClaudeAdapter({ cwd: process.cwd(), loadSDK: function () { return Promise.resolve(sdk); } });
  var session = { localId: 204, vendor: "claude", mode: "gui", permissionMode: "auto", history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sm = baseSessionManager(new Map([[204, session]]));
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: sm, adapter: adapter, adapters: { claude: adapter }, send: function () {} });

  await bridge.startQuery(session, "hello", null, null);

  assert.equal(captures[0].permissionMode, "auto");
});

test("a Plan session sends plan mode explicitly", async function () {
  var captures = [];
  var sdk = sdkFixture(captures);
  var adapter = createClaudeAdapter({ cwd: process.cwd(), loadSDK: function () { return Promise.resolve(sdk); } });
  var session = { localId: 205, vendor: "claude", mode: "gui", permissionMode: "plan", history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sm = baseSessionManager(new Map([[205, session]]));
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: sm, adapter: adapter, adapters: { claude: adapter }, send: function () {} });

  await bridge.startQuery(session, "hello", null, null);

  assert.equal(captures[0].permissionMode, "plan");
});

test("the OS-worker path forwards every explicit permissionMode, including default, to the worker's query options", function () {
  var modes = ["default", "acceptEdits", "bypassPermissions", "auto", "plan"];
  for (var i = 0; i < modes.length; i++) {
    var options = buildWorkerQueryOptions({}, { permissionMode: modes[i] }, "/tmp/work");
    assert.equal(options.permissionMode, modes[i],
      "mode '" + modes[i] + "' must cross the worker IPC boundary unchanged, including 'default' which is falsy-adjacent but a real string");
  }
});

test("warmup queries stay hardcoded to the SDK's bypassPermissions escape hatch, unaffected by the explicit-default fix", function () {
  var source = fs.readFileSync("lib/yoke/adapters/claude.js", "utf8");
  var matches = source.match(/warmupOptions\.permissionMode = "bypassPermissions";/g) || [];
  assert.ok(matches.length >= 3, "every warmup query construction site must still force bypassPermissions explicitly");
});

test("title generation stays hardcoded to explicit default, unaffected by the explicit-default fix", function () {
  var source = fs.readFileSync("lib/yoke/adapters/claude.js", "utf8");
  var generateTitleBlock = source.slice(source.indexOf("generateTitle: async function(messages, opts) {"));
  generateTitleBlock = generateTitleBlock.slice(0, generateTitleBlock.indexOf("getSessionInfo:"));
  assert.match(generateTitleBlock, /permissionMode:\s*"default",/,
    "title generation already explicitly requested Ask/default before this fix and must still do so");
});
