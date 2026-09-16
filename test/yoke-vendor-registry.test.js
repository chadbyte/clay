var test = require("node:test");
var assert = require("node:assert");

var yoke = require("../lib/yoke");
var createKiroAdapter = require("../lib/yoke/adapters/kiro").createKiroAdapter;

var SUPPORTED_VENDORS = ["claude", "codex", "grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode", "kiro"];

function FakeAcpServer() {
  this.started = false;
  this.requestHandlers = {};
}

FakeAcpServer.prototype.addRequestHandler = function(method, handler) {
  this.requestHandlers[method] = handler;
};
FakeAcpServer.prototype.start = function() {
  this.started = true;
  return Promise.resolve();
};
FakeAcpServer.prototype.send = function(method) {
  if (method === "initialize") return Promise.resolve({ protocolVersion: 1 });
  return Promise.resolve({});
};
FakeAcpServer.prototype.stop = function() {
  this.started = false;
};

test("YOKE registry covers every supported adapter vendor", function() {
  for (var i = 0; i < SUPPORTED_VENDORS.length; i++) {
    var info = yoke.getVendorInfo(SUPPORTED_VENDORS[i]);
    assert.ok(info);
    assert.strictEqual(typeof info.displayName, "string");
    assert.strictEqual(typeof info.loginCommand, "string");
    assert.ok(Array.isArray(info.sessionModes));
    assert.ok(info.sessionModes.length > 0);
    assert.strictEqual(typeof info.osUserIsolation, "boolean");
    assert.strictEqual(typeof info.rateLimitTracking, "boolean");
    for (var j = 0; j < info.sessionModes.length; j++) {
      assert.ok(info.sessionModes[j] === "gui" || info.sessionModes[j] === "tui");
    }
  }
});

test("YOKE registry returns null for an unknown vendor", function() {
  assert.strictEqual(yoke.getVendorInfo("nope"), null);
});

test("Codex usage dashboard links to the current Codex usage page", function() {
  assert.strictEqual(yoke.getVendorInfo("codex").usageDashboard.href, "https://chatgpt.com/codex/settings/usage");
});

test("adapter startup logs one registration summary instead of creation per vendor", async function() {
  var originalLog = console.log;
  var logs = [];
  console.log = function(message) {
    logs.push(String(message));
  };
  var created;
  try {
    created = yoke.createAdapters({
      cwd: process.cwd(),
      slug: "log-test",
      _installed: { codex: true },
    });
  } finally {
    console.log = originalLog;
  }
  assert.deepStrictEqual(logs, ["[yoke] Adapters registered for log-test: codex"]);
  assert.strictEqual(logs.some(function(line) { return line.indexOf("Adapter created: codex") !== -1; }), false);
  await created.adapters.codex.shutdown();
});

test("shared Claude creation is logged once across project registrations", function() {
  var originalLog = console.log;
  var logs = [];
  console.log = function(message) {
    logs.push(String(message));
  };
  try {
    yoke.createAdapters({ cwd: process.cwd(), slug: "shared-a", _installed: { claude: true } });
    yoke.createAdapters({ cwd: process.cwd(), slug: "shared-b", _installed: { claude: true } });
  } finally {
    console.log = originalLog;
  }
  assert.strictEqual(logs.filter(function(line) {
    return line === "[yoke] Shared adapter created: claude";
  }).length, 1);
  assert.deepStrictEqual(logs.filter(function(line) {
    return line.indexOf("[yoke] Adapters registered for shared-") === 0;
  }), [
    "[yoke] Adapters registered for shared-a: claude",
    "[yoke] Adapters registered for shared-b: claude",
  ]);
});

test("default vendor follows the declared cross-vendor preference order", function() {
  assert.strictEqual(yoke.resolveDefaultVendor({ kiro: {} }), "kiro");
  assert.strictEqual(yoke.resolveDefaultVendor({ kiro: {}, opencode: {} }), "opencode");
  assert.strictEqual(yoke.resolveDefaultVendor({ kiro: {}, opencode: {}, antigravity: {} }), "antigravity");
  assert.strictEqual(yoke.resolveDefaultVendor({ kiro: {}, codex: {} }), "codex");
  assert.strictEqual(yoke.resolveDefaultVendor({ kiro: {}, opencode: {}, antigravity: {}, codex: {}, claude: {} }), "claude");
  assert.strictEqual(yoke.resolveDefaultVendor([]), "claude");
});

test("every YOKE vendor supports GUI sessions", function() {
  for (var i = 0; i < SUPPORTED_VENDORS.length; i++) {
    assert.notStrictEqual(yoke.getVendorInfo(SUPPORTED_VENDORS[i]).sessionModes.indexOf("gui"), -1);
  }
});

test("Kiro remains unavailable for OS-user isolation", function() {
  assert.strictEqual(yoke.getVendorInfo("kiro").osUserIsolation, false);
});

test("subprocess vendors remain unavailable for OS-user isolation", function() {
  assert.strictEqual(yoke.getVendorInfo("antigravity").osUserIsolation, false);
  assert.strictEqual(yoke.getVendorInfo("opencode").osUserIsolation, false);
  assert.strictEqual(yoke.getVendorInfo("kimi").osUserIsolation, false);
  assert.strictEqual(yoke.getVendorInfo("grok").osUserIsolation, false);
  assert.strictEqual(yoke.getVendorInfo("copilot").osUserIsolation, false);
  assert.strictEqual(yoke.getVendorInfo("qwen").osUserIsolation, false);
  assert.strictEqual(yoke.getVendorInfo("junie").osUserIsolation, false);
});

test("Kiro capabilities do not promise stubbed controls", async function() {
  var adapter = createKiroAdapter({
    cwd: process.cwd(),
    _binaryPath: "/contract/kiro-cli",
    _AcpServerCtor: FakeAcpServer,
    _fetchModels: function() {
      return Promise.resolve({ models: ["auto"], defaultModel: "auto", contextWindows: {} });
    },
  });
  var result = await adapter.init();
  assert.strictEqual(result.capabilities.effort, false);
  assert.deepStrictEqual(result.capabilities.toolPolicy, ["ask"]);
  await adapter.shutdown();
});

test("clampEffort keeps supported levels and maps unsupported ones to the nearest", function() {
  assert.strictEqual(yoke.clampEffort("claude", "max"), "max");
  assert.strictEqual(yoke.clampEffort("claude", "minimal"), "low");
  assert.strictEqual(yoke.clampEffort("codex", "minimal"), "low");
  assert.strictEqual(yoke.clampEffort("codex", "max"), "max");
  assert.strictEqual(yoke.clampEffort("codex", "medium"), "medium");
});

test("clampEffort returns undefined for no-effort vendors and junk input", function() {
  assert.strictEqual(yoke.clampEffort("kiro", "high"), undefined);
  assert.strictEqual(yoke.clampEffort("antigravity", "high"), "high");
  assert.strictEqual(yoke.clampEffort("opencode", "high"), undefined);
  assert.strictEqual(yoke.clampEffort("claude", "turbo"), undefined);
  assert.strictEqual(yoke.clampEffort("claude", ""), undefined);
  assert.strictEqual(yoke.clampEffort("unknown-vendor", "high"), undefined);
});
