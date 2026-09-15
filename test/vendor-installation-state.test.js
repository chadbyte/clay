var test = require("node:test");
var assert = require("node:assert");
var { createSDKBridge } = require("../lib/sdk-bridge");
var createSessionManager = require("../lib/sessions").createSessionManager;
var { buildInitialModelInfo } = require("../lib/project-connection");

test("new project publishes installed vendors before adapter warmup completes", async function () {
  var finishWarmup;
  var warmupResult = new Promise(function (resolve) {
    finishWarmup = resolve;
  });
  var adapter = {
    vendor: "claude",
    init: function () { return warmupResult; },
  };
  var sent = [];
  var sm = {
    availableModels: [],
    modelsByVendor: {},
    sessions: new Map(),
    setSlashCommandsForVendor: function () {},
  };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    slug: "new-project",
    sessionManager: sm,
    send: function (msg) { sent.push(msg); },
    adapter: adapter,
    adapters: { claude: adapter },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(sm, "installedVendors"), false);

  var pendingWarmup = bridge.warmup(null);

  assert.ok(Array.isArray(sm.installedVendors));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].type, "model_info");
  assert.deepStrictEqual(sent[0].installedVendors, sm.installedVendors);

  finishWarmup({
    models: [],
    defaultModel: "",
    skills: [],
    slashCommands: [],
    capabilities: {},
  });
  await pendingWarmup;
});

test("project connection includes vendor state when the model is empty", function () {
  var msg = buildInitialModelInfo({
    availableVendors: ["claude", "codex", "kiro"],
    installedVendors: ["claude", "codex", "kiro"],
  }, "claude", "", []);

  assert.strictEqual(msg.type, "model_info");
  assert.strictEqual(msg.model, "");
  assert.deepStrictEqual(msg.installedVendors, ["claude", "codex", "kiro"]);
  assert.deepStrictEqual(msg.availableVendors, ["claude", "codex", "kiro"]);
});

test("cold project availability discovery runs before warmup without initializing an adapter", function () {
  var initCalls = 0;
  var adapter = { vendor: "claude", init: function () { initCalls++; return Promise.resolve({ models: [] }); } };
  var sm = createSessionManager({ cwd: process.cwd(), sessionsBase: process.cwd(), cliSessionsDir: process.cwd(), send: function () {} });
  var bridge = createSDKBridge({ cwd: process.cwd(), slug: "cold-project", sessionManager: sm, send: function () {}, adapter: adapter, adapters: { claude: adapter } });
  var discovered = bridge.refreshInstalledVendors(null);
  assert.ok(Array.isArray(discovered));
  assert.strictEqual(initCalls, 0);
  assert.deepStrictEqual(sm.installedVendors, discovered);
  assert.deepStrictEqual(sm.availableVendors, ["claude"]);
});
