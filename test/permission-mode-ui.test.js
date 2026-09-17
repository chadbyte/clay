var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");
var attachSessions = require("../lib/project-sessions").attachSessions;

var root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function permissionClientFixture(sendImpl) {
  var source = read("lib/public/modules/permission-control.js")
    .replace(/^import .*$/gm, "")
    .replace(/export function /g, "function ");
  var state = {
    currentSlug: "project-a",
    activeSessionId: 7,
    currentVendor: "claude",
    connected: true,
    skipPermsEnabled: false,
    permissionModePendingByTarget: {},
    permissionCapabilities: { auto: true },
  };
  var sent = [];
  var toasts = [];
  var scheduled = [];
  var cleared = [];
  var ws = {
    readyState: 1,
    send: function (payload) {
      sent.push(JSON.parse(payload));
      if (sendImpl) return sendImpl(payload);
    },
  };
  var sandbox = {
    store: {
      get: function (key) { return state[key]; },
      set: function (patch) { Object.assign(state, patch); },
    },
    getWs: function () { return ws; },
    showToast: function (message, kind) { toasts.push({ message: message, kind: kind }); },
    crypto: { randomUUID: function () { return "request-1"; } },
    setTimeout: function (callback, delay) { scheduled.push({ callback: callback, delay: delay }); return scheduled.length; },
    clearTimeout: function (id) { cleared.push(id); },
  };
  vm.runInNewContext(source + "\nthis.api = { bindPermissionControl: bindPermissionControl, renderPermissionControl: renderPermissionControl, sendPermissionMode: sendPermissionMode, handlePermissionModeResult: handlePermissionModeResult, permissionPendingFor: permissionPendingFor, permissionStatusText: permissionStatusText };", sandbox);
  return { api: sandbox.api, state: state, sent: sent, toasts: toasts, scheduled: scheduled, cleared: cleared, ws: ws };
}

function controlFixture() {
  var buttons = ["default", "auto", "bypassPermissions"].map(function(mode) {
    var button = {
      dataset: { permissionMode: mode }, disabled: false, hidden: false, title: "",
      setAttribute: function(name, value) { this[name] = value; }, removeAttribute: function(name) { if (name === "title") this.title = ""; },
    };
    button.classList = { toggle: function (name, enabled) { if (name === "active") button.active = enabled; if (name === "pending") button.pending = enabled; } };
    return button;
  });
  var status = { textContent: "", title: "", classList: { toggle: function () {} },
    removeAttribute: function (name) { if (name === "title") this.title = ""; } };
  var clickHandler = null;
  var control = {
    dataset: {}, ariaBusy: "", setAttribute: function(name, value) { this[name] = value; }, classList: { toggle: function () {}, contains: function () { return false; } },
    querySelectorAll: function () { return buttons; },
    querySelector: function () { return status; },
    addEventListener: function (name, handler) { if (name === "click") clickHandler = handler; },
  };
  return { control: control, buttons: buttons, status: status, click: function(button) {
    clickHandler({ target: { closest: function () { return button; } } });
  } };
}

function serverFixture(canAccess, setModeImpl, sdkOverrides, driverOperated, globallyForced) {
  var responses = [];
  var accessArgs = [];
  var sessionMessages = [];
  var session = { localId: 7, ownerId: "owner", vendor: "claude", mode: "gui", permissionMode: "default",
    effectivePermissionMode: "auto", permissionCapabilities: { auto: true, mcpOverride: true }, mcpPermissionModeOverrides: {} };
  var sm = {
    sessions: new Map([[7, session]]),
    currentPermissionMode: "default",
    defaultVendor: "claude",
    saveSessionFile: function () {},
    sendToSession: function (target, message) { sessionMessages.push({ session: target, message: message }); },
  };
  var users = {
    isMultiUser: function () { return true; },
    canAccessSession: function (userId, target, projectAccess) {
      accessArgs.push({ userId: userId, session: target, projectAccess: projectAccess });
      return canAccess;
    },
  };
  var attached = attachSessions({
    slug: "project-a",
    dangerouslySkipPermissions: globallyForced === true,
    sm: sm,
    sdk: sdkOverrides || {},
    clients: new Set(),
    opts: {},
    usersModule: users,
    getProjectAccess: function () { return { visibility: "private", ownerId: "owner" }; },
    getSessionForWs: function () { return session; },
    isDriverOperatedSession: function () { return driverOperated === true; },
    sendTo: function (ws, message) { responses.push(message); },
    fullAccessService: { setMode: function (target, mode) {
      if (setModeImpl) return setModeImpl(target, mode);
      target.permissionMode = mode;
      return Promise.resolve();
    } },
  });
  return { attached: attached, responses: responses, accessArgs: accessArgs, session: session, sessionMessages: sessionMessages };
}

function settle() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

test("standalone header exposes Ask Auto Skip permissions and runtime status", function () {
  var html = read("lib/public/index.html");
  var start = html.indexOf('id="header-full-access-btn"');
  var control = html.slice(start, start + 1200);
  assert.match(control, /data-permission-mode="default"[^>]*aria-label="Ask permissions"[^>]*title="Ask permissions"[^>]*>.*permission-label">Ask/s);
  assert.match(control, /data-permission-mode="auto"[^>]*aria-label="Auto permissions"[^>]*title="Auto permissions"[^>]*>.*permission-label">Auto/s);
  assert.match(control, /permission-spinner/);
  assert.match(control, /data-permission-mode="bypassPermissions"[^>]*aria-label="Skip permissions"[^>]*title="Skip permissions"[^>]*>.*permission-label">Skip</s);
  assert.match(control, /session-permission-status[^>]*aria-live="polite"|aria-live="polite"[^>]*session-permission-status/);
  assert.doesNotMatch(control, /role="switch"|session-full-access-track/);
});

test("standalone and split Driver headers use the shared permission control", function () {
  var header = read("lib/public/modules/app-header.js");
  var split = read("lib/public/modules/split-view.js");
  var shared = read("lib/public/modules/permission-control.js");
  assert.match(header, /from '.\/permission-control\.js'/);
  assert.match(header, /bindPermissionControl\(/);
  assert.match(header, /renderPermissionControl\(/);
  assert.match(split, /from '.\/permission-control\.js'/);
  assert.match(split, /createPermissionControl\("split-pane-full-access hidden"/);
  assert.match(split, /bindPermissionControl\(/);
  assert.match(split, /renderPermissionControl\(/);
  assert.match(shared, /projectSlug: projectSlug, sessionId: sessionId, mode: mode, requestId: requestId/);
  assert.match(shared, /Auto unavailable at runtime/);
  assert.match(shared, /Auto unavailable for this Claude session/);
  assert.doesNotMatch(shared, /dataset\.projectSlug|dataset\.sessionId/);
  assert.doesNotMatch(split, /setPaneFullAccess|Skip permission prompts for this session/);
});

test("permission requests are pending per project and session and include correlation scope", function () {
  var f = permissionClientFixture();
  assert.equal(f.api.sendPermissionMode("project-a", 7, "auto"), true);
  assert.equal(f.api.sendPermissionMode("project-a", 7, "default"), false);
  assert.equal(f.api.sendPermissionMode("project-a", 8, "default"), true);
  assert.deepEqual(f.sent[0], { type: "set_permission_mode", projectSlug: "project-a", sessionId: 7, mode: "auto", requestId: "request-1" });
  assert.equal(f.api.permissionPendingFor("project-a", 7).mode, "auto");
  assert.equal(f.api.permissionPendingFor("project-a", 8).mode, "default");
  assert.equal(f.scheduled[0].delay, 10000);
});

test("permission request send throws and timeouts clear only their scoped pending entry", function () {
  var thrown = permissionClientFixture(function () { throw new Error("socket closed"); });
  assert.equal(thrown.api.sendPermissionMode("project-a", 7, "auto"), false);
  assert.equal(thrown.api.permissionPendingFor("project-a", 7), null);
  assert.match(thrown.toasts[0].message, /socket closed/);

  var refused = permissionClientFixture(function () { return false; });
  assert.equal(refused.api.sendPermissionMode("project-a", 7, "auto"), false);
  assert.equal(refused.api.permissionPendingFor("project-a", 7), null);
  assert.match(refused.toasts[0].message, /declined the request/);

  var timed = permissionClientFixture();
  timed.api.sendPermissionMode("project-a", 7, "auto");
  timed.scheduled[0].callback();
  assert.equal(timed.api.permissionPendingFor("project-a", 7), null);
  assert.match(timed.toasts[0].message, /timed out/);
});

test("bound controls recheck live lock, connection, project, and Auto capability before sending", function () {
  var f = permissionClientFixture();
  var ui = controlFixture();
  var live = { projectSlug: "project-a", sessionId: 7, vendor: "claude", connected: true,
    permissionCapabilities: { auto: true }, visible: true, locked: false };
  f.api.bindPermissionControl(ui.control, function () { return live; });
  ui.click(ui.buttons[1]);
  assert.equal(f.sent.length, 1);
  f.api.handlePermissionModeResult({ projectSlug: "project-a", sessionId: 7, requestId: "request-1", ok: false });

  live.locked = true;
  ui.click(ui.buttons[0]);
  live.locked = false;
  live.connected = false;
  ui.click(ui.buttons[0]);
  live.connected = true;
  live.projectSlug = "stale-project";
  ui.click(ui.buttons[0]);
  live.projectSlug = "project-a";
  live.vendor = "codex";
  live.permissionCapabilities = { auto: false };
  ui.click(ui.buttons[1]);
  assert.equal(f.sent.length, 1);
});

test("production rendering shows Auto only for Claude and disables it only when Claude capability is unavailable", function () {
  var f = permissionClientFixture();
  var other = controlFixture();
  f.api.renderPermissionControl(other.control, { projectSlug: "project-a", sessionId: 7, vendor: "codex",
    permissionMode: "default", effectivePermissionMode: null, permissionCapabilities: { auto: false }, connected: true });
  assert.equal(other.buttons[1].hidden, true);
  assert.equal(other.status.textContent, "");

  var unavailable = controlFixture();
  f.api.renderPermissionControl(unavailable.control, { projectSlug: "project-a", sessionId: 7, vendor: "claude",
    permissionMode: "default", effectivePermissionMode: null, permissionCapabilities: { auto: false }, connected: true });
  assert.equal(unavailable.buttons[1].hidden, false);
  assert.equal(unavailable.buttons[1].disabled, true);
  assert.match(unavailable.buttons[1].title, /unavailable for this Claude session/);
  assert.equal(unavailable.status.textContent, "Auto unavailable for this Claude session");
  f.api.renderPermissionControl(unavailable.control, { projectSlug: "project-a", sessionId: 7, vendor: "claude",
    permissionMode: "default", effectivePermissionMode: "default", permissionCapabilities: { auto: true }, connected: true });
  assert.equal(unavailable.buttons[1].title, "Auto permissions");
});

test("pending rendering marks the control and requested segment busy with a centered spinner", function () {
  var f = permissionClientFixture();
  var ui = controlFixture();
  f.api.sendPermissionMode("project-a", 7, "auto");
  f.api.renderPermissionControl(ui.control, { projectSlug: "project-a", sessionId: 7, vendor: "claude",
    permissionMode: "default", effectivePermissionMode: null, permissionCapabilities: { auto: true }, connected: true });
  assert.equal(ui.control["aria-busy"], "true");
  assert.equal(ui.buttons[1]["aria-busy"], "true");
  assert.equal(ui.buttons[0]["aria-busy"], "false");
  assert.equal(ui.buttons[1].pending, true);
  assert.equal(ui.buttons[0].disabled, true);
  assert.equal(ui.status.textContent, "Applying…");
});

test("daemon-forced Skip permissions is visible, selected, and cannot send a session override", function () {
  var f = permissionClientFixture();
  var ui = controlFixture();
  var state = { projectSlug: "project-a", sessionId: 7, vendor: "claude", permissionMode: "default",
    effectivePermissionMode: "bypassPermissions", permissionCapabilities: { auto: true }, connected: true,
    globalPermissionModeForced: true, visible: true };
  f.api.renderPermissionControl(ui.control, state);
  assert.equal(ui.buttons[0].disabled, true);
  assert.equal(ui.buttons[1].disabled, true);
  assert.equal(ui.buttons[2].disabled, true);
  assert.equal(ui.buttons[0].active, false);
  assert.equal(ui.buttons[2].active, true);
  assert.equal(ui.status.textContent, "Skip permissions forced by the server setting");
  f.api.bindPermissionControl(ui.control, function () { return state; });
  ui.click(ui.buttons[0]);
  assert.equal(f.sent.length, 0);

  f.state.skipPermsEnabled = true;
  assert.equal(f.api.sendPermissionMode("project-a", 7, "default"), false);
  assert.equal(f.sent.length, 0);
  assert.match(f.toasts[0].message, /forced by the server setting/);
});

test("permission results ignore stale correlation and update only the active exact session", function () {
  var f = permissionClientFixture();
  f.api.sendPermissionMode("project-a", 7, "auto");
  f.api.handlePermissionModeResult({ projectSlug: "project-a", sessionId: 7, requestId: "stale", ok: true, mode: "auto" });
  assert.ok(f.api.permissionPendingFor("project-a", 7));
  f.api.handlePermissionModeResult({ projectSlug: "project-a", sessionId: 7, requestId: "request-1", ok: true, mode: "auto", effectivePermissionMode: "default", permissionCapabilities: { auto: true } });
  assert.equal(f.api.permissionPendingFor("project-a", 7), null);
  assert.equal(f.state.currentMode, "auto");
  assert.equal(f.state.effectivePermissionMode, "default");

  var failed = permissionClientFixture();
  failed.api.sendPermissionMode("project-a", 7, "auto");
  failed.api.handlePermissionModeResult({ projectSlug: "project-a", sessionId: 7, requestId: "request-1", ok: false, error: "Auto is unavailable" });
  assert.equal(failed.api.permissionPendingFor("project-a", 7), null);
  assert.equal(failed.toasts[0].message, "Auto is unavailable");
});

test("Auto runtime fallback and unsupported status remain visible", function () {
  var f = permissionClientFixture();
  assert.equal(f.api.permissionStatusText({ permissionMode: "auto", effectivePermissionMode: null }, null, true, true), "Auto selected · waiting for runtime");
  assert.equal(f.api.permissionStatusText({ permissionMode: "auto", effectivePermissionMode: "default" }, null, true, true), "Auto unavailable at runtime · using Ask");
  assert.equal(f.api.permissionStatusText({ permissionMode: "auto", effectivePermissionMode: "plan" }, null, true, true), "Auto unavailable at runtime · using Plan");
  assert.equal(f.api.permissionStatusText({ permissionMode: "auto", effectivePermissionMode: "acceptEdits" }, null, true, true), "Auto unavailable at runtime · using Auto-accept edits");
  assert.equal(f.api.permissionStatusText({ permissionMode: "auto", effectivePermissionMode: "dontAsk" }, null, true, true), "Auto unavailable at runtime · using Don't ask");
  assert.equal(f.api.permissionStatusText({ permissionMode: "auto", effectivePermissionMode: "bypassPermissions" }, null, true, true), "Auto unavailable at runtime · using Skip permissions");
  assert.equal(f.api.permissionStatusText({ permissionMode: "plan" }, null, true, true), "Plan workflow");
  assert.equal(f.api.permissionStatusText({ permissionMode: "acceptEdits" }, null, true, true), "Auto-accept edits workflow");
  assert.equal(f.api.permissionStatusText({ permissionMode: "plan" }, null, false, true), "Plan workflow");
  assert.equal(f.api.permissionStatusText({ permissionMode: "default", effectivePermissionMode: "default" }, null, false, true), "Auto unavailable for this Claude session");
  assert.equal(f.api.permissionStatusText({ permissionMode: "default", effectivePermissionMode: "default" }, null, false, false), "");
});

test("split header uses a compact visible fallback while preserving the full explanation", function () {
  var f = permissionClientFixture();
  var split = controlFixture();
  split.control.classList.contains = function (name) { return name === "split-pane-full-access"; };
  f.api.renderPermissionControl(split.control, { projectSlug: "project-a", sessionId: 7, vendor: "claude",
    permissionMode: "auto", effectivePermissionMode: "default", permissionCapabilities: { auto: true }, connected: true });
  assert.equal(split.status.textContent, "Using Ask");
  assert.equal(split.status.title, "Auto unavailable at runtime · using Ask");
});

test("server correlates invalid and unauthorized permission results using exact project access", function () {
  var allowed = serverFixture(true);
  var ws = { _clayUser: { id: "member" } };
  allowed.attached.handleSessionsMessage(ws, { type: "set_permission_mode", projectSlug: "project-a", sessionId: 7, mode: "bogus", requestId: "invalid-1" });
  assert.equal(allowed.responses[0].type, "permission_mode_result");
  assert.equal(allowed.responses[0].requestId, "invalid-1");
  assert.equal(allowed.responses[0].ok, false);
  assert.match(allowed.responses[0].error, /Unknown permission mode/);
  assert.deepEqual(allowed.accessArgs[0].projectAccess, { visibility: "private", ownerId: "owner" });

  var denied = serverFixture(false);
  denied.attached.handleSessionsMessage(ws, { type: "set_permission_mode", projectSlug: "project-a", sessionId: 7, mode: "auto", requestId: "denied-1" });
  assert.equal(denied.responses[0].requestId, "denied-1");
  assert.equal(denied.responses[0].ok, false);
  assert.equal(denied.responses[0].mode, null);
  assert.equal(denied.responses[0].permissionCapabilities, null);

  var wrongProject = serverFixture(true);
  wrongProject.attached.handleSessionsMessage(ws, { type: "set_permission_mode", projectSlug: "stale-project", sessionId: 7, mode: "auto", requestId: "project-1" });
  assert.equal(wrongProject.responses[0].requestId, "project-1");
  assert.equal(wrongProject.responses[0].projectSlug, "stale-project");
  assert.equal(wrongProject.responses[0].sessionId, 7);
  assert.equal(wrongProject.responses[0].ok, false);
  assert.equal(wrongProject.accessArgs.length, 0);

  var source = read("lib/project-sessions.js");
  var legacyStart = source.indexOf('if (msg.type === "set_session_full_access")');
  var legacyEnd = source.indexOf('if (msg.type === "set_server_default_mode"', legacyStart);
  var legacy = source.slice(legacyStart, legacyEnd);
  assert.match(legacy, /canAccessSession\(ws\._clayUser\.id, fullAccessSession, getProjectAccess\(\)\)/);
  assert.match(legacy, /isDriverOperatedSession\(fullAccessSession\)/);
  assert.doesNotMatch(legacy, /visibility: "public"/);
});

test("server correlates authorized success and service rejection through the real handler", async function () {
  var ws = { _clayUser: { id: "member" } };
  var allowed = serverFixture(true);
  allowed.attached.handleSessionsMessage(ws, { type: "set_permission_mode", projectSlug: "project-a", sessionId: 7, mode: "auto", requestId: "success-1" });
  await settle();
  assert.equal(allowed.responses.length, 1);
  assert.equal(allowed.responses[0].type, "permission_mode_result");
  assert.equal(allowed.responses[0].requestId, "success-1");
  assert.equal(allowed.responses[0].projectSlug, "project-a");
  assert.equal(allowed.responses[0].sessionId, 7);
  assert.equal(allowed.responses[0].ok, true);
  assert.equal(allowed.responses[0].mode, "auto");
  assert.equal(allowed.responses[0].permissionCapabilities.auto, true);
  assert.equal(allowed.sessionMessages.length, 1);
  assert.equal(allowed.sessionMessages[0].message.permissionRequestId, "success-1");

  var rejected = serverFixture(true, function () { return Promise.reject(new Error("SDK transition failed")); });
  rejected.attached.handleSessionsMessage(ws, { type: "set_permission_mode", projectSlug: "project-a", sessionId: 7, mode: "auto", requestId: "failure-1" });
  await settle();
  assert.equal(rejected.responses.length, 1);
  assert.equal(rejected.responses[0].requestId, "failure-1");
  assert.equal(rejected.responses[0].projectSlug, "project-a");
  assert.equal(rejected.responses[0].sessionId, 7);
  assert.equal(rejected.responses[0].ok, false);
  assert.match(rejected.responses[0].error, /SDK transition failed/);
  assert.equal(rejected.sessionMessages.length, 0);
});

test("server rejects permission changes for daemon-forced bypass and terminal sessions", function () {
  var ws = { _clayUser: { id: "member" } };
  var forced = serverFixture(true, null, {}, false, true);
  forced.attached.handleSessionsMessage(ws, { type: "set_permission_mode", projectSlug: "project-a", sessionId: 7,
    mode: "default", requestId: "forced-1" });
  assert.equal(forced.responses.length, 1);
  assert.equal(forced.responses[0].requestId, "forced-1");
  assert.equal(forced.responses[0].ok, false);
  assert.match(forced.responses[0].error, /forced by the server setting/);
  assert.equal(forced.session.permissionMode, "default");

  var terminal = serverFixture(true);
  terminal.session.runtimeMode = "tui";
  terminal.attached.handleSessionsMessage(ws, { type: "set_permission_mode", projectSlug: "project-a", sessionId: 7,
    mode: "auto", requestId: "terminal-1" });
  assert.equal(terminal.responses.length, 1);
  assert.equal(terminal.responses[0].requestId, "terminal-1");
  assert.equal(terminal.responses[0].ok, false);
  assert.match(terminal.responses[0].error, /GUI session/);
  assert.equal(terminal.session.permissionMode, "default");
});

test("server MCP handler correlates exact authorized changes and inheritance", async function () {
  var calls = [];
  var sdk = { setMcpPermissionModeOverride: function (session, serverName, mode) {
    calls.push({ session: session, serverName: serverName, mode: mode });
    return Promise.resolve({ ok: true });
  } };
  var fixture = serverFixture(true, null, sdk);
  var ws = { _clayUser: { id: "member" } };
  fixture.attached.handleSessionsMessage(ws, { type: "set_mcp_permission_mode_override", projectSlug: "project-a",
    sessionId: 7, serverName: "github", mode: "auto", requestId: "mcp-1" });
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].session, fixture.session);
  assert.equal(calls[0].serverName, "github");
  assert.equal(calls[0].mode, "auto");
  assert.deepEqual(fixture.responses[0], {
    type: "mcp_permission_mode_result", ok: true, requestId: "mcp-1", projectSlug: "project-a",
    sessionId: 7, serverName: "github", mode: "auto", mcpPermissionModeOverrides: { github: "auto" }, error: null,
  });

  fixture.attached.handleSessionsMessage(ws, { type: "set_mcp_permission_mode_override", projectSlug: "project-a",
    sessionId: 7, serverName: "github", mode: null, requestId: "mcp-2" });
  await settle();
  assert.equal(calls[1].mode, null);
  assert.deepEqual(fixture.responses[1].mcpPermissionModeOverrides, {});
});

test("server MCP handler rejects every invalid, unauthorized, or Worker request with correlation", function () {
  var ws = { _clayUser: { id: "member" } };
  var cases = [
    { fixture: serverFixture(true, null, {}), message: { projectSlug: "project-a", sessionId: 7, serverName: "github", mode: "auto", requestId: "unsupported" } },
    { fixture: serverFixture(false, null, { setMcpPermissionModeOverride: function () {} }), message: { projectSlug: "project-a", sessionId: 7, serverName: "github", mode: "auto", requestId: "denied" } },
    { fixture: serverFixture(true, null, { setMcpPermissionModeOverride: function () {} }, true), message: { projectSlug: "project-a", sessionId: 7, serverName: "github", mode: "auto", requestId: "worker" } },
    { fixture: serverFixture(true, null, { setMcpPermissionModeOverride: function () {} }), message: { projectSlug: "other", sessionId: 7, serverName: "github", mode: "auto", requestId: "project" } },
    { fixture: serverFixture(true, null, { setMcpPermissionModeOverride: function () {} }), message: { projectSlug: "project-a", sessionId: 7, serverName: "github", mode: "bogus", requestId: "mode" } },
  ];
  for (var i = 0; i < cases.length; i++) {
    cases[i].message.type = "set_mcp_permission_mode_override";
    cases[i].fixture.attached.handleSessionsMessage(ws, cases[i].message);
    assert.equal(cases[i].fixture.responses.length, 1);
    assert.equal(cases[i].fixture.responses[0].type, "mcp_permission_mode_result");
    assert.equal(cases[i].fixture.responses[0].requestId, cases[i].message.requestId);
    assert.equal(cases[i].fixture.responses[0].projectSlug, cases[i].message.projectSlug);
    assert.equal(cases[i].fixture.responses[0].sessionId, 7);
    assert.equal(cases[i].fixture.responses[0].serverName, "github");
    assert.equal(cases[i].fixture.responses[0].ok, false);
  }
});

test("split pair chrome never rewrites segmented permission selection", function () {
  var source = read("lib/public/modules/split-pair-ui.js");
  var start = source.indexOf("export function syncPairChrome");
  var end = source.indexOf("\nexport function", start + 1);
  var sync = source.slice(start, end === -1 ? source.length : end);
  assert.match(sync, /querySelector\("\.split-pane-full-access"\)/);
  assert.doesNotMatch(sync, /aria-pressed|aria-checked|dataset\.permissionMode/);
  assert.doesNotMatch(sync, /classList\.toggle\("active"/);
});

test("browser fixture mounts production controls and routes mock socket results through production", function () {
  var fixture = read("test/fixtures/permission-mode-browser.html");
  var sharedCss = read("lib/public/css/overlays.css");
  var paneCss = read("lib/public/css/pane.css");
  assert.match(fixture, /from '\.\.\/\.\.\/lib\/public\/modules\/store\.js'/);
  assert.match(fixture, /from '\.\.\/\.\.\/lib\/public\/modules\/ws-ref\.js'/);
  assert.match(fixture, /from '\.\.\/\.\.\/lib\/public\/modules\/permission-control\.js'/);
  assert.match(fixture, /createPermissionControl\("", "Standalone session permission mode"\)/);
  assert.match(fixture, /createPermissionControl\("split-pane-full-access", "Split Driver session permission mode"\)/);
  assert.match(fixture, /bindPermissionControl\(standalone, currentControlState\)/);
  assert.match(fixture, /bindPermissionControl\(split, currentControlState\)/);
  assert.match(fixture, /handlePermissionModeResult\(response\)/);
  assert.match(fixture, /setWs\(mockSocket\)/);
  assert.match(fixture, /value="fallback"/);
  assert.match(fixture, /value="reject"/);
  assert.match(fixture, /value="hold"/);
  assert.match(fixture, /id="toggle-online"/);
  assert.match(fixture, /id="switch-session"/);
  assert.match(fixture, /id="toggle-global-skip"/);
  assert.match(fixture, /globalPermissionModeForced: state\.skipPermsEnabled/);
  assert.match(fixture, /Split Driver header/);
  assert.match(fixture, /<header class="split-pane-header">/);
  assert.match(fixture, /split-pane-vendor/);
  assert.match(fixture, /split-pair-role split-pair-role-driver/);
  assert.match(fixture, /split-pane-close/);
  assert.match(fixture, /lib\/public\/style\.css/);
  assert.match(fixture, /overflow-wrap: anywhere/);
  assert.match(fixture, /@media \(max-width: 600px\)/);
  assert.doesNotMatch(fixture, /data-permission-mode=/);
  assert.doesNotMatch(fixture, /classList\.toggle\("active"\)|setAttribute\("aria-pressed"/);
  assert.match(sharedCss, /\.session-permission-control \{[^}]*flex-wrap: nowrap/s);
  assert.match(sharedCss, /\.session-permission-segmented \{[^}]*flex: 0 0 auto/s);
  assert.match(sharedCss, /\.permission-spinner/);
  assert.match(sharedCss, /prefers-reduced-motion: reduce/);
  assert.match(sharedCss, /\.session-permission-status \{[^}]*text-overflow: ellipsis[^}]*white-space: nowrap/s);
  assert.match(sharedCss, /\.session-permission-control\.permission-pending \.session-permission-status:not\(\.hidden\) \{/);
  assert.match(sharedCss, /\.permission-spinner \{[^}]*visibility: hidden/s);
  assert.match(paneCss, /\.split-pane-header \.session-permission-status/);
  assert.match(sharedCss, /button\.active \{[^}]*background: var\(--input-bg\)[^}]*color: var\(--text\)[^}]*font-weight: var\(--font-weight-heading/s);
  assert.match(sharedCss, /:root\.light-theme \.session-permission-segmented button\.active \{[^}]*background: var\(--bg\)/s);
  assert.match(sharedCss, /button \{[^}]*font-weight: 500/s);
  assert.match(sharedCss, /permission-control:not\(\.permission-pending\).*button:disabled \{[^}]*color: var\(--text-muted\)[^}]*opacity: \.65/s);
  assert.match(sharedCss, /button\.pending \.permission-label \{ visibility: hidden; \}/);
  assert.match(sharedCss, /\.permission-spinner \{ position: absolute;[^}]*transform: translate\(-50%, -50%\)/s);
  assert.match(sharedCss, /@keyframes permission-spin \{[^}]*translate\(-50%, -50%\) rotate\(360deg\)/s);
  assert.match(paneCss, /\.split-pane-header \{[^}]*height: 28px[^}]*min-height: 28px/s);
  assert.match(paneCss, /\.split-pane-header \.split-pane-full-access \{[^}]*height: 24px[^}]*font-size: 11px/s);
  assert.match(paneCss, /\.split-pane-header \.session-permission-segmented button \{[^}]*height: 20px[^}]*font-size: 11px/s);
  assert.match(paneCss, /\.split-pane-header \.session-permission-segmented \{[^}]*height: 24px[^}]*padding: 1px/s);
  assert.doesNotMatch(paneCss, /\.split-pane-header \.split-pane-full-access \{[^}]*overflow: hidden/s);
  assert.match(fixture, /id="theme-mode"/);
  assert.match(fixture, /id="split-width"/);
  assert.match(fixture, /value="390"/);
  assert.match(fixture, /classList\.toggle\("light-theme"/);
  assert.match(fixture, /\.fixture-split-pane \{ --fixture-split-width: 356px; flex: 0 0 var\(--fixture-split-width\)/);
  assert.match(fixture, /\.fixture-split-pane \{ flex: none; \}/);
  assert.match(fixture, /setProperty\("--fixture-split-width"/);
  assert.doesNotMatch(fixture, /style\.flexBasis/);
});
