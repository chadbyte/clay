var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var attachSessions = require("../lib/project-sessions").attachSessions;
var attachScheduledTasks = require("../lib/project-scheduled-tasks").attachScheduledTasks;
var attachPreferences = require("../lib/users-scheduled-task-preferences").attachScheduledTaskPreferences;
var pathToFileURL = require("node:url").pathToFileURL;

function sessionFixture(options) {
  options = options || {};
  var created = [];
  var sent = [];
  var access = { allowed: true };
  var nextId = 1;
  var sourceSession = { localId: 50, vendor: "claude", mode: "gui", history: [] };
  var sourceUsable = { value: true };
  var sm = {
    sessions: new Map([[50, sourceSession]]), installedVendors: ["codex"], modelsByVendor: { codex: [{ value: "gpt-5.2-codex" }] },
    currentEffortByVendor: { codex: "medium" }, sweepBlankSessions: function () {},
    findReusableBlankSession: function () { return null; },
    createSession: function (options) { created.push(Object.assign({}, options)); var session = Object.assign({ localId: nextId++ }, options); sm.sessions.set(session.localId, session); return session; },
  };
  var users = {
    isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "user-a" || id === "user-b" ? { id: id } : null; },
  };
  var scheduled = attachScheduledTasks({
    sm: sm, registry: { getAll: function () { return []; } }, isMate: false,
    isDriverOperatedSession: function () { return false; }, canAccess: function () { return access.allowed; },
    hasPermission: function () { return access.allowed; }, canUseSession: function () { return access.allowed && sourceUsable.value; },
  });
  var attached = attachSessions({
    slug: "project-a", sm: sm, sdk: {}, clients: new Set(), opts: {}, usersModule: users,
    send: function () {}, sendTo: function (ws, message) { sent.push(message); },
    userPresence: { sessionIdForPersistence: function (session) { return session.localId; }, setPresence: function () {} },
    broadcastPresence: function () {}, getSessionForWs: function () { return sourceSession; },
    canCreateScheduledTaskInterview: function (ws, session) { return scheduled.canCreateInterview(ws, session); },
    resolveDefaultAi: options.resolveDefaultAi || function () { return Promise.resolve({ ready: true, vendor: "codex", model: "gpt-5.2-codex", effort: "high", catalog: { status: "ready", models: [{ value: "gpt-5.2-codex", supportedEffortLevels: ["low", "medium", "high"] }] } }); },
  });
  return { attached: attached, created: created, sent: sent, access: access, sm: sm, sourceUsable: sourceUsable, scheduled: scheduled };
}

function settle() { return new Promise(function (resolve) { setImmediate(resolve); }); }

test("production project factory passes Default AI resolution to the actual sessions handler", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/project.js"), "utf8");
  var start = source.indexOf("var _sessions = attachSessions({");
  var end = source.indexOf("var _models = attachModels({", start);
  var sessionsWiring = source.slice(start, end);
  assert.match(sessionsWiring, /resolveDefaultAi:\s*opts\.resolveDefaultAi/);
  var autonomousStart = source.indexOf("_autonomousRun = attachAutonomousRun({");
  var autonomousEnd = source.indexOf("});", autonomousStart);
  assert.doesNotMatch(source.slice(autonomousStart, autonomousEnd), /resolveDefaultAi/);
});

test("shared Default AI binds the actual new interview session and ignores client runtime fields", async function () {
  var f = sessionFixture();
  var ws = { _clayUser: { id: "user-a" } };
  f.attached.handleSessionsMessage(ws, { type: "new_session", requestId: "valid", scheduleInterview: true, sourceSessionId: 50, projectSlug: "project-a", forceNew: true, mode: "gui", vendor: "claude", model: "client-override", effort: "low" });
  await settle();
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].vendor, "codex");
  assert.equal(f.created[0].model, "gpt-5.2-codex");
  assert.equal(f.created[0].effort, "high");
  assert.equal(f.sent[0].ok, true);
});

test("new interview creation ignores source custom-tool catalog while preserving source", async function () {
  var f = sessionFixture();
  f.sm.sessions.get(50).vendor = "codex";
  f.sm.sessions.get(50).cliSessionId = "legacy-thread";
  f.sm.sessions.get(50).codexDynamicToolCatalogVersion = 0;
  var ws = { _clayUser: { id: "user-a" } };
  assert.equal(f.scheduled.canStartInterview(ws, f.sm.sessions.get(50)), false);
  assert.equal(f.scheduled.canCreateInterview(ws, f.sm.sessions.get(50)), true);
  f.attached.handleSessionsMessage(ws, { type: "new_session", requestId: "legacy", scheduleInterview: true, sourceSessionId: 50, projectSlug: "project-a", forceNew: true, mode: "gui", vendor: "codex", model: "gpt-5.2-codex", effort: "medium" });
  await settle();
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].vendor, "codex");
  assert.equal(f.sm.sessions.get(50).cliSessionId, "legacy-thread");
  assert.equal(f.sm.sessions.get(50).codexDynamicToolCatalogVersion, 0);
});

test("new interview creation does not gate a supported target on the source vendor", async function () {
  var f = sessionFixture();
  f.sm.sessions.get(50).vendor = "antigravity";
  var ws = { _clayUser: { id: "user-a" } };
  f.attached.handleSessionsMessage(ws, { type: "new_session", requestId: "cross-vendor", scheduleInterview: true, sourceSessionId: 50, projectSlug: "project-a", forceNew: true, mode: "gui", vendor: "codex", model: "gpt-5.2-codex" });
  await settle();
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].vendor, "codex");
});

test("source session usability is required before resolving Default AI", async function () {
  var f = sessionFixture();
  f.sourceUsable.value = false;
  var ws = { _clayUser: { id: "user-a" } };
  f.attached.handleSessionsMessage(ws, { type: "new_session", requestId: "unusable-source", scheduleInterview: true, sourceSessionId: 50, projectSlug: "project-a", forceNew: true, mode: "gui", vendor: "codex", model: "gpt-5.2-codex" });
  await settle();
  assert.equal(f.created.length, 0);
});

test("interview creation rejects stale project, revoked permission, and unavailable Default AI", async function () {
  var f = sessionFixture();
  var ws = { _clayUser: { id: "user-a" } };
  f.attached.handleSessionsMessage(ws, { type: "new_session", requestId: "project", scheduleInterview: true, sourceSessionId: 50, projectSlug: "other", forceNew: true, mode: "gui" });
  f.access.allowed = false;
  f.attached.handleSessionsMessage(ws, { type: "new_session", requestId: "permission", scheduleInterview: true, sourceSessionId: 50, projectSlug: "project-a", forceNew: true, mode: "gui" });
  f.access.allowed = true;
  var unavailable = sessionFixture({ resolveDefaultAi: function () { return Promise.resolve({ ready: false, error: "saved model unavailable" }); } });
  unavailable.attached.handleSessionsMessage(ws, { type: "new_session", requestId: "catalog", scheduleInterview: true, sourceSessionId: 50, projectSlug: "project-a", forceNew: true, mode: "gui" });
  await settle();
  assert.equal(f.created.length, 0);
  assert.match(f.sent[0].error, /current project session/);
  assert.match(f.sent[1].error, /current project session/);
  assert.match(unavailable.sent[0].error, /saved model unavailable/i);
});

test("concurrent interview requests dedupe and permission revocation during resolution creates no blank session", async function () {
  var release;
  var pendingRuntime = new Promise(function (resolve) { release = resolve; });
  var f = sessionFixture({ resolveDefaultAi: function () { return pendingRuntime; } });
  var ws = { _clayUser: { id: "user-a" } };
  var msg = { type: "new_session", requestId: "dedupe", scheduleInterview: true, sourceSessionId: 50, projectSlug: "project-a", forceNew: true, mode: "gui" };
  assert.equal(f.attached.handleSessionsMessage(ws, msg), true);
  assert.equal(f.attached.handleSessionsMessage(ws, msg), true);
  f.access.allowed = false;
  release({ ready: true, vendor: "codex", model: "gpt-5.2-codex", effort: "high", catalog: { status: "ready", models: [{ value: "gpt-5.2-codex", supportedEffortLevels: ["high"] }] } });
  await settle();
  assert.equal(f.created.length, 0);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].error, /no longer available/);
});

test("interview engine preferences remain isolated between users", function () {
  var data = { users: [{ id: "a" }, { id: "b" }], invites: [] };
  var preferences = attachPreferences({ loadUsers: function () { return data; }, saveUsers: function (next) { data = next; } });
  assert.equal(preferences.set("a", { vendor: "codex", model: "one", effort: "high" }).ok, true);
  assert.equal(preferences.set("b", { vendor: "claude", model: "two", effort: "medium" }).ok, true);
  assert.deepEqual(preferences.get("a"), { vendor: "codex", model: "one", effort: "high" });
  assert.deepEqual(preferences.get("b"), { vendor: "claude", model: "two", effort: "medium" });
});

test("single-user interview engine preference persists in server config", function () {
  var configValue = { port: 4242 };
  var preferences = attachPreferences({
    loadUsers: function () { return { users: [], invites: [] }; }, saveUsers: function () {},
    configModule: { loadConfig: function () { return configValue; }, saveConfig: function (next) { configValue = next; } },
  });
  assert.equal(preferences.set("default", { vendor: "codex", model: "gpt-5.2-codex", effort: "medium" }).ok, true);
  assert.equal(configValue.port, 4242);
  assert.deepEqual(preferences.get("default"), { vendor: "codex", model: "gpt-5.2-codex", effort: "medium" });
});

test("scheduled-task controls declare aligned split and structured-input button geometry", function () {
  var root = path.join(__dirname, "..");
  var scheduleCss = fs.readFileSync(path.join(root, "lib/public/css/scheduled-tasks.css"), "utf8");
  var rewindCss = fs.readFileSync(path.join(root, "lib/public/css/rewind.css"), "utf8");
  var client = fs.readFileSync(path.join(root, "lib/public/modules/scheduled-tasks.js"), "utf8");
  assert.match(scheduleCss, /\.scheduled-tasks-create-group[^}]*height: 30px/);
  assert.match(scheduleCss, /\.scheduled-tasks-new-menu[^}]*height: 30px[^}]*align-items: center[^}]*justify-content: center/);
  assert.match(scheduleCss, /#scheduled-tasks-panel \.scheduled-tasks-new > svg\.lucide[^}]*width: 14px[^}]*height: 14px/);
  assert.match(scheduleCss, /#scheduled-tasks-panel \.scheduled-tasks-new-menu > svg\.lucide[^}]*width: 13px[^}]*height: 13px/);
  assert.match(scheduleCss, /\.scheduled-task-default-ai/);
  assert.match(scheduleCss, /\.scheduled-task-runtime-row \{[^}]*grid-template-areas: "role vendor model effort"/);
  assert.match(scheduleCss, /@media \(max-width: 700px\)[\s\S]*\.scheduled-task-runtime-row \{[^}]*grid-template-areas: "role vendor vendor" "\. model effort"[^}]*minmax\(96px,\.72fr\)/);
  assert.match(rewindCss, /\.ask-user-actions[^}]*gap: 8px/);
  assert.match(rewindCss, /\.ask-user-submit[^}]*min-height: 36px/);
  assert.match(rewindCss, /\.ask-user-skip[^}]*min-height: 36px/);
  assert.doesNotMatch(client, /Interview engine/);
  assert.match(client, /scheduleInterview: true, sourceSessionId: store\.get\('activeSessionId'\), projectSlug: store\.get\('currentSlug'\)/);
  assert.doesNotMatch(client, /scheduleInterview: true[\s\S]{0,200}vendor:/);
  assert.match(client, /scheduledTaskEngineRequest/);
  assert.match(client, /msg\.projectSlug !== store\.get\('currentSlug'\)/);
});

test("Driver schedule refresh preserves dirty edit text and its base revision while surfacing conflict", async function () {
  var modulePath = pathToFileURL(path.join(__dirname, "..", "lib/public/modules/scheduled-task-edit-state.js")).href + "?test=" + Date.now();
  var editState = { id: "task-1", revision: 10, data: { name: "Unsaved name", instructions: "Unsaved text" }, conflict: "" };
  var editStateModule = await import(modulePath);
  var reconciled = editStateModule.reconcileScheduledTaskEdit(editState, { id: "task-1", revision: 11, name: "Server name" });
  assert.equal(reconciled.revision, 10);
  assert.equal(reconciled.data.name, "Unsaved name");
  assert.equal(reconciled.data.instructions, "Unsaved text");
  assert.match(reconciled.conflict, /text is preserved/);
});

test("execution runtime rendering preserves explicit saved choices across state refresh", async function () {
  function select() {
    var control = { options: [], disabled: false, _value: "", appendChild: function (option) { this.options.push(option); } };
    Object.defineProperty(control, "innerHTML", { set: function (html) { this.options = html ? [{ value: "", textContent: "Default effort", disabled: false }] : []; } });
    Object.defineProperty(control, "value", { get: function () { return this._value; }, set: function (value) { this._value = value; } });
    Object.defineProperty(control, "selectedIndex", { get: function () { for (var i = 0; i < this.options.length; i++) if (this.options[i].value === this._value) return i; return -1; } });
    return control;
  }
  var priorDocument = global.document;
  global.document = { createElement: function () { return { value: "", textContent: "", disabled: false }; } };
  try {
    var modulePath = pathToFileURL(path.join(__dirname, "..", "lib/public/modules/scheduled-task-engine.js")).href + "?test=" + Date.now();
    var engineModule = await import(modulePath);
    var runtimeControls = {};
    ["driver-vendor", "driver-model", "driver-effort", "worker-vendor", "worker-model", "worker-effort"].forEach(function (name) { runtimeControls[name] = select(); });
    var root = { querySelector: function (query) { var match = query.match(/data-runtime="([^"]+)/); return match ? runtimeControls[match[1]] : null; } };
    var execution = { driver: { vendor: "codex", model: "saved-model", effort: "high" }, worker: { vendor: "removed-vendor", model: "worker-model", effort: "medium" } };
    var loadingState = { runtimeInstalledVendors: ["codex"], modelsByVendor: { codex: [] }, catalogReadyByVendor: { codex: false } };
    var rendered = engineModule.renderExecutionRuntime(root, loadingState, execution);
    assert.deepEqual(rendered, execution);
    assert.equal(runtimeControls["worker-vendor"].options.some(function (option) { return option.value === "removed-vendor" && option.disabled; }), true);
    var renderedAgain = engineModule.renderExecutionRuntime(root, Object.assign({}, loadingState), rendered);
    assert.deepEqual(renderedAgain, execution, "loading refreshes preserve every saved runtime choice without fallback");
  } finally { global.document = priorDocument; }
});

test("Change default opens the shared picker without bubbling into its outside-click dismissal", function () {
  var vm = require("node:vm");
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/scheduled-tasks.js"), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace(/^export \{.*;\n/gm, "")
    .replace(/export function /g, "function ");
  var stopped = false;
  var opened = false;
  var context = { openDefaultAi: function () {
    assert.equal(stopped, true, "stop the triggering click before opening the picker");
    opened = true;
  } };
  vm.runInNewContext(source, context);
  context.handleClick({
    target: { closest: function () { return { dataset: { action: "default-ai" } }; } },
    stopPropagation: function () { stopped = true; },
  });
  assert.equal(opened, true);
});
