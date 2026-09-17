var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var root = path.join(__dirname, "..");

function fixture(sendImpl) {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/mcp-ui.js"), "utf8")
    .replace(/^import .*$/gm, "")
    .replace(/export function /g, "function ");
  var state = {
    currentSlug: "project-a",
    activeSessionId: 7,
    connected: true,
    currentMode: "auto",
    effectivePermissionMode: "auto",
    permissionCapabilities: { auto: true, mcpOverride: true },
    mcpPermissionModePendingByTarget: {},
    mcpPermissionModeOverrides: {},
  };
  var sent = [];
  var toasts = [];
  var scheduled = [];
  var cleared = [];
  var listeners = [];
  var ws = { readyState: 1, send: function (payload) {
    sent.push(JSON.parse(payload));
    if (sendImpl) return sendImpl(payload);
  } };
  var store = {
    get: function (key) { return state[key]; },
    snap: function () { return state; },
    set: function (patch) {
      var prev = Object.assign({}, state);
      Object.assign(state, patch);
      for (var i = 0; i < listeners.length; i++) listeners[i](state, prev);
    },
    subscribe: function (listener) { listeners.push(listener); },
  };
  var sandbox = {
    store: store,
    getWs: function () { return ws; },
    showToast: function (message, kind) { toasts.push({ message: message, kind: kind }); },
    crypto: { randomUUID: function () { return "mcp-request-1"; } },
    setTimeout: function (callback, delay) { scheduled.push({ callback: callback, delay: delay }); return scheduled.length; },
    clearTimeout: function (id) { cleared.push(id); },
    setHttpMcpServers: function () {},
    refreshIcons: function () {},
  };
  vm.runInNewContext(source + "\nthis.api = { send: sendMcpPermissionMode, result: handleMcpPermissionModeResult, clear: clearMcpPermissionModePending, applicability: mcpPermissionModeApplicability };", sandbox);
  return { api: sandbox.api, state: state, sent: sent, toasts: toasts, scheduled: scheduled, cleared: cleared, ws: ws };
}

test("MCP request state is store-backed, scoped, and sends inheritance as null", function () {
  var f = fixture();
  assert.equal(f.api.send("project-a", 7, "github", ""), true);
  assert.deepEqual(f.sent[0], { type: "set_mcp_permission_mode_override", projectSlug: "project-a", sessionId: 7,
    requestId: "mcp-request-1", serverName: "github", mode: null });
  var keys = Object.keys(f.state.mcpPermissionModePendingByTarget);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^project-a:7:mcp-request-1$/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.mcpPermissionModePendingByTarget[keys[0]])), {
    projectSlug: "project-a", sessionId: 7, requestId: "mcp-request-1", serverName: "github", mode: "", previousMode: "",
  });
  assert.equal(f.api.send("project-a", 7, "github", "auto"), false);
  assert.equal(f.scheduled[0].delay, 10000);
});

test("MCP send false, throw, timeout, and disconnect clear pending state", function () {
  var refused = fixture(function () { return false; });
  assert.equal(refused.api.send("project-a", 7, "github", "auto"), false);
  assert.equal(Object.keys(refused.state.mcpPermissionModePendingByTarget).length, 0);
  assert.match(refused.toasts[0].message, /Failed to send/);

  var thrown = fixture(function () { throw new Error("closed"); });
  assert.equal(thrown.api.send("project-a", 7, "github", "auto"), false);
  assert.equal(Object.keys(thrown.state.mcpPermissionModePendingByTarget).length, 0);

  var timed = fixture();
  timed.api.send("project-a", 7, "github", "auto");
  timed.scheduled[0].callback();
  assert.equal(Object.keys(timed.state.mcpPermissionModePendingByTarget).length, 0);
  assert.match(timed.toasts[0].message, /timed out/);

  var disconnected = fixture();
  disconnected.api.send("project-a", 7, "github", "auto");
  disconnected.api.clear();
  assert.equal(Object.keys(disconnected.state.mcpPermissionModePendingByTarget).length, 0);
  assert.equal(disconnected.cleared.length, 1);
});

test("MCP results require exact correlation and update only the active session", function () {
  var f = fixture();
  f.state.mcpPermissionModeOverrides = { github: "default" };
  f.api.send("project-a", 7, "github", "auto");
  f.api.result({ requestId: "other", projectSlug: "project-a", sessionId: 7, serverName: "github", ok: true,
    mcpPermissionModeOverrides: { github: "auto" } });
  assert.equal(Object.keys(f.state.mcpPermissionModePendingByTarget).length, 1);
  assert.equal(f.state.mcpPermissionModeOverrides.github, "default");
  f.api.result({ requestId: "mcp-request-1", projectSlug: "other", sessionId: 7, serverName: "github", ok: true,
    mcpPermissionModeOverrides: { github: "auto" } });
  assert.equal(Object.keys(f.state.mcpPermissionModePendingByTarget).length, 1);
  f.api.result({ requestId: "mcp-request-1", projectSlug: "project-a", sessionId: 7, serverName: "github", ok: true,
    mcpPermissionModeOverrides: { github: "auto" } });
  assert.equal(Object.keys(f.state.mcpPermissionModePendingByTarget).length, 0);
  assert.equal(f.state.mcpPermissionModeOverrides.github, "auto");

  var stale = fixture();
  stale.api.send("project-a", 7, "github", "auto");
  stale.state.activeSessionId = 8;
  stale.api.result({ requestId: "mcp-request-1", projectSlug: "project-a", sessionId: 7, serverName: "github", ok: true,
    mcpPermissionModeOverrides: { github: "auto" } });
  assert.equal(Object.keys(stale.state.mcpPermissionModeOverrides).length, 0);

  var failed = fixture();
  failed.state.mcpPermissionModeOverrides = { github: "default" };
  failed.api.send("project-a", 7, "github", "auto");
  failed.api.result({ requestId: "mcp-request-1", projectSlug: "project-a", sessionId: 7, serverName: "github", ok: false, error: "denied" });
  assert.equal(failed.state.mcpPermissionModeOverrides.github, "default");
  assert.equal(failed.toasts[0].message, "denied");
});

test("MCP applicability explains capability, pending Auto, and runtime requirements", function () {
  var f = fixture();
  assert.equal(f.api.applicability(f.state).applicable, true);
  f.state.permissionCapabilities = { auto: true, mcpOverride: false };
  assert.match(f.api.applicability(f.state).reason, /unavailable for this SDK session/);
  f.state.permissionCapabilities = { auto: true, mcpOverride: true };
  f.state.effectivePermissionMode = null;
  assert.match(f.api.applicability(f.state).reason, /Waiting for the SDK/);
  f.state.currentMode = "default";
  assert.match(f.api.applicability(f.state).reason, /requires an active Auto session/);
});

test("production MCP rendering exposes Inherit and derives pending UI from the store", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/mcp-ui.js"), "utf8");
  assert.match(source, /optInherit\.textContent = "Inherit"/);
  assert.match(source, /mcpPermissionModePendingByTarget/);
  assert.match(source, /store\.subscribe\(/);
  assert.doesNotMatch(source, /_pendingPermissionModes|select: e\.target/);
});
