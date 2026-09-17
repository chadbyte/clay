var test = require("node:test");
var assert = require("node:assert/strict");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

function fixture() {
  var sessions = new Map();
  var sm = {
    sessions: sessions,
    currentPermissionMode: "default",
    permissionRequestIndex: {},
    saveSessionFile: function () {},
    sendToSession: function () {},
    sendAndRecord: function () {},
  };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: sm,
    adapter: { vendor: "claude" },
    send: function () {},
    onProcessingChanged: function () {},
  });
  return { bridge: bridge, sm: sm, sessions: sessions };
}

test("bridge PreToolUse policy allows the existing safe Bash whitelist", function () {
  var f = fixture();
  var input = { command: "git status --short" };
  assert.deepEqual(f.bridge.handlePreToolUsePolicy({}, "Bash", input), { behavior: "allow", updatedInput: input });
});

test("bridge PreToolUse policy defers non-whitelisted tools to the SDK classifier", function () {
  var f = fixture();
  assert.equal(f.bridge.handlePreToolUsePolicy({}, "Write", { file_path: "/tmp/example" }), null);
  assert.equal(f.bridge.handlePreToolUsePolicy({}, "Bash", { command: "rm example" }), null);
});

test("bridge PreToolUse policy applies home debate denial before the whitelist", function () {
  var f = fixture();
  var session = { homeDebatePlanning: true, history: [] };
  var decision = f.bridge.handlePreToolUsePolicy(session, "Read", { file_path: "/tmp/example" });
  assert.equal(decision.behavior, "deny");
  assert.match(decision.message, /debate topic/);
});

test("bridge PreToolUse policy leaves AskUserQuestion to the user-input path", function () {
  var f = fixture();
  assert.equal(f.bridge.handlePreToolUsePolicy({}, "AskUserQuestion", { questions: [] }), null);
});

test("runtime-effective events apply only to the live exact query generation", function () {
  var f = fixture();
  var handle = {};
  var session = { localId: 7, vendor: "claude", permissionMode: "auto", effectivePermissionMode: null,
    permissionCapabilities: { auto: true, mcpOverride: false }, queryInstance: handle, _sdkQueryGeneration: 3 };
  f.sessions.set(7, session);
  assert.equal(f.bridge.recordRuntimeEffectivePermissionMode(session, handle, 3, { yokeType: "status", permissionMode: "auto" }), true);
  assert.equal(session.effectivePermissionMode, "auto");
  session.effectivePermissionMode = "default";
  assert.equal(f.bridge.recordRuntimeEffectivePermissionMode(session, {}, 3, { yokeType: "status", permissionMode: "auto" }), false);
  assert.equal(f.bridge.recordRuntimeEffectivePermissionMode(session, handle, 2, { yokeType: "init", permissionMode: "auto" }), false);
  assert.equal(session.effectivePermissionMode, "default");
  f.sessions.set(7, { localId: 7 });
  assert.equal(f.bridge.recordRuntimeEffectivePermissionMode(session, handle, 3, { yokeType: "status", permissionMode: "auto" }), false);
  assert.equal(session.effectivePermissionMode, "default");
});
