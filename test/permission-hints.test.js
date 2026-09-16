var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var kit = require("../lib/yoke/adapters/claude").contractTestKit;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

function renderer(replaying) {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/permission-hints.js"), "utf8");
  source = source.replace(/^import .*;\n/gm, "").replace("export function", "function");
  return new Function("store", source + "\nreturn applyPermissionHints;")({ get: function() { return replaying; } });
}

test("permission hints remove persistent approvals and focus decline", function() {
  var removed = 0;
  var focused = 0;
  var container = {
    querySelectorAll: function(selector) {
      assert.match(selector, /notif-banner-always/);
      return [{ remove: function() { removed++; } }];
    },
    querySelector: function(selector) {
      assert.match(selector, /permission-deny/);
      return { focus: function() { focused++; } };
    },
  };
  renderer(false)(container, { defaultToNo: true, suppressAlwaysAllowRule: true });
  assert.equal(removed, 1);
  assert.equal(focused, 1);
  renderer(true)(container, { defaultToNo: true });
  assert.equal(focused, 1, "history replay must not steal focus");
});

test("isolated Worker permission hints reach the daemon callback", async function() {
  var receive;
  var seen;
  kit.createWorkerQueryHandle({
    onMessage: function(fn) { receive = fn; }, onExit: function() {}, send: function() { return true; },
  }, function(name, input, options) { seen = options; return Promise.resolve({ behavior: "deny" }); });
  receive({ type: "permission_request", toolName: "Write", input: {}, defaultToNo: true, suppressAlwaysAllowRule: true });
  await Promise.resolve();
  assert.equal(seen.defaultToNo, true);
  assert.equal(seen.suppressAlwaysAllowRule, true);
});

test("permission hints persist with the pending request and its client event", async function() {
  var recorded = [];
  var sm = { permissionRequestIndex: {}, sendAndRecord: function(session, msg) { recorded.push(msg); } };
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: sm, adapter: { vendor: "claude" }, send: function() {}, onProcessingChanged: function() {} });
  var session = { localId: 17, pendingPermissions: {} };
  var decision = bridge.handleCanUseTool(session, "Write", { file_path: "/tmp/example" }, { defaultToNo: true, suppressAlwaysAllowRule: true });
  var pending = session.pendingPermissions[Object.keys(session.pendingPermissions)[0]];
  assert.equal(pending.defaultToNo, true);
  assert.equal(pending.suppressAlwaysAllowRule, true);
  assert.equal(recorded[0].defaultToNo, true);
  assert.equal(recorded[0].suppressAlwaysAllowRule, true);
  pending.resolve({ behavior: "deny" });
  assert.equal((await decision).behavior, "deny");
});

test("a suppressed persistent approval is enforced by the server", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/project-sessions.js"), "utf8");
  var start = source.indexOf('      if (decision === "allow_always" && pending.suppressAlwaysAllowRule)');
  var end = source.indexOf('\n      sm.sendAndRecord(session, {', start);
  assert.ok(start >= 0 && end > start);
  var respond = new Function("session", "pending", "decision", source.slice(start, end));
  var session = {};
  var result;
  respond(session, { suppressAlwaysAllowRule: true, toolName: "Write", toolInput: {}, resolve: function(value) { result = value; } }, "allow_always");
  assert.equal(session.allowedTools, undefined);
  assert.equal(result.behavior, "allow");
  respond(session, { toolName: "Write", toolInput: {}, resolve: function() {} }, "allow_always");
  assert.equal(session.allowedTools.Write, true);
});
