var assert = require("assert");
var test = require("node:test");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var storageModule = require("../lib/users-context-view-preferences");
var serviceModule = require("../lib/server-context-view");

function storage(initial, multiUser, configInitial) {
  var data = JSON.parse(JSON.stringify(initial));
  var config = Object.assign({}, configInitial || {});
  var configModule = { loadConfig: function () { return Object.assign({}, config); }, saveConfig: function (next) { config = Object.assign({}, next); } };
  var preferences = storageModule.attachContextViewPreferences({
    loadUsers: function () { return JSON.parse(JSON.stringify(data)); },
    saveUsers: function (next) { data = JSON.parse(JSON.stringify(next)); },
    isMultiUser: function () { return multiUser; },
    configModule: configModule,
  });
  return { preferences: preferences, data: function () { return data; }, config: function () { return config; } };
}

test("context view persists across fresh single-user instances while preserving config", function () {
  var fixture = storage({ users: [] }, false, { port: 2633, tls: true });
  assert.deepEqual(fixture.preferences.get("default"), { present: false, mode: "off", source: null });
  assert.equal(fixture.preferences.set("default", "panel").ok, true);
  var reloaded = storage(fixture.data(), false, fixture.config());
  assert.equal(reloaded.preferences.get("default").mode, "panel");
  assert.equal(reloaded.config().port, 2633);
  assert.equal(reloaded.preferences.set("default", "invalid").ok, false);
});

test("context view isolates multi-user records and rejects missing users", function () {
  var fixture = storage({ users: [{ id: "u1" }, { id: "u2", contextViewPreference: "mini" }] }, true);
  assert.equal(fixture.preferences.set("u1", "panel").ok, true);
  assert.equal(fixture.preferences.get("u1").mode, "panel");
  assert.equal(fixture.preferences.get("u2").mode, "mini");
  assert.equal(fixture.preferences.set("missing", "off").ok, false);
});

function serviceFixture(options) {
  options = options || {};
  var records = { u1: { id: "u1" }, u2: { id: "u2" } };
  var persisted = storage({ users: [{ id: "u1" }, { id: "u2" }] }, true);
  var clients = [];
  var users = {
    isMultiUser: function () { return true; },
    findUserById: function (id) { return records[id] || null; },
    getContextViewPreference: function (id) { return persisted.preferences.get(id); },
    setContextViewPreference: function (id, mode) { return persisted.preferences.set(id, mode); },
  };
  var service = serviceModule.attachContextViewService({ users: users, forEachAppClient: function (fn) { clients.forEach(fn); }, serverEpoch: "context-test" });
  function ws(id) { var socket = { readyState: 1, _clayUser: { id: id }, sent: [] }; socket.send = function (message) { socket.sent.push(JSON.parse(message)); }; return socket; }
  return { service: service, ws: ws, clients: clients, records: records };
}

test("context view broadcasts across projects only to the same user", function () {
  var fixture = serviceFixture();
  var sourceProject = fixture.ws("u1");
  var otherProject = fixture.ws("u1");
  var otherUser = fixture.ws("u2");
  fixture.clients.push(otherProject, otherUser);
  fixture.service.handleMessage(sourceProject, { type: "context_view_set", requestId: "save", mode: "mini" });
  assert.equal(otherProject.sent[0].mode, "mini");
  assert.equal(otherUser.sent.length, 0);
  assert.equal(sourceProject.sent[0].requestId, "save");
});

test("context view service rejects invalid modes and revoked actors using real storage", function () {
  var fixture = serviceFixture();
  var invalid = fixture.ws("u1");
  fixture.service.handleMessage(invalid, { type: "context_view_set", requestId: "invalid", mode: "not-a-mode" });
  assert.equal(invalid.sent[0].ready, false);
  assert.match(invalid.sent[0].error, /invalid/i);
  var revoked = fixture.ws("u1");
  fixture.records.u1 = null;
  fixture.service.handleMessage(revoked, { type: "context_view_get", requestId: "revoked" });
  assert.equal(revoked.sent[0].accountAvailable, false);
  assert.equal(revoked.sent[0].accountId, null);
});

function loadClient() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/context-view-preference.js"), "utf8");
  source = source.replace(/^import .*;\n/gm, "").replace(/export function /g, "function ").replace(/export \{ validMode \};/g, "");
  source += "\nthis.api={getContextView:getContextView,getEffectiveContextView:getEffectiveContextView,beginContextViewConnection:beginContextViewConnection,requestContextView:requestContextView,setContextView:setContextView,handleContextViewMessage:handleContextViewMessage};";
  var state = { connected: true, myUserId: "u1", currentSlug: "project-a", contextViewOverride: null, contextViewPreferenceState: { mode: "off", canonicalMode: "off", preferencePresent: false, loading: false, saving: false, requestId: null, saveRequestId: null, pendingSaves: [], accountId: "u1", serverEpoch: "old", canonicalRevision: 2, error: "" } };
  var listeners = [];
  var sent = [];
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (value) { var previous = state; state = Object.assign({}, state, value); listeners.forEach(function (listener) { listener(state, previous); }); }, subscribe: function (listener) { listeners.push(listener); } },
    getWs: function () { return { readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } }; },
    Date: Date,
  };
  vm.runInNewContext(source, context);
  return { api: context.api, state: function () { return state; }, sent: sent, set: function (value) { context.store.set(value); } };
}

test("context view client confirms older rapid save before rolling back latest failure", function () {
  var fixture = loadClient();
  fixture.api.setContextView("mini");
  var first = fixture.state().contextViewPreferenceState.saveRequestId;
  fixture.api.setContextView("panel");
  var second = fixture.state().contextViewPreferenceState.saveRequestId;
  fixture.api.handleContextViewMessage({ type: "context_view_state", requestId: first, accountId: "u1", serverEpoch: "old", canonicalRevision: 3, mode: "mini", ready: true });
  assert.equal(fixture.state().contextViewPreferenceState.mode, "panel");
  assert.equal(fixture.state().contextViewPreferenceState.saveRequestId, second);
  fixture.api.handleContextViewMessage({ type: "context_view_state", requestId: second, accountId: "u1", serverEpoch: "old", canonicalRevision: 4, ready: false, error: "save failed" });
  assert.equal(fixture.state().contextViewPreferenceState.saving, false);
  assert.equal(fixture.api.getContextView(), "mini");
  assert.equal(fixture.state().contextViewPreferenceState.error, "save failed");
});

test("context view broadcast updates canonical mode without replacing pending optimistic mode", function () {
  var fixture = loadClient();
  fixture.api.setContextView("mini");
  var saveId = fixture.state().contextViewPreferenceState.saveRequestId;
  fixture.api.handleContextViewMessage({ type: "context_view_state", accountId: "u1", serverEpoch: "old", canonicalRevision: 3, mode: "panel", preferencePresent: true });
  assert.equal(fixture.api.getContextView(), "mini");
  assert.equal(fixture.state().contextViewPreferenceState.canonicalMode, "panel");
  assert.equal(fixture.state().contextViewPreferenceState.saveRequestId, saveId);
  fixture.api.handleContextViewMessage({ type: "context_view_state", requestId: saveId, accountId: "u1", serverEpoch: "old", canonicalRevision: 4, mode: "mini", ready: true });
  assert.equal(fixture.api.getContextView(), "mini");
  assert.equal(fixture.state().contextViewPreferenceState.saving, false);
});

test("context view reverse-order ACK keeps newer confirmed intent and ignores older revision", function () {
  var fixture = loadClient();
  fixture.api.setContextView("mini");
  var first = fixture.state().contextViewPreferenceState.saveRequestId;
  fixture.api.setContextView("panel");
  var second = fixture.state().contextViewPreferenceState.saveRequestId;
  fixture.api.handleContextViewMessage({ type: "context_view_state", requestId: second, accountId: "u1", serverEpoch: "old", canonicalRevision: 4, mode: "panel", ready: true, preferencePresent: true });
  assert.equal(fixture.api.getContextView(), "panel");
  assert.equal(fixture.state().contextViewPreferenceState.canonicalMode, "panel");
  assert.equal(fixture.state().contextViewPreferenceState.canonicalRevision, 4);
  assert.equal(fixture.state().contextViewPreferenceState.saving, false);
  fixture.api.handleContextViewMessage({ type: "context_view_state", requestId: first, accountId: "u1", serverEpoch: "old", canonicalRevision: 3, mode: "mini", ready: true });
  assert.equal(fixture.api.getContextView(), "panel");
  assert.equal(fixture.state().contextViewPreferenceState.canonicalMode, "panel");
  assert.equal(fixture.state().contextViewPreferenceState.canonicalRevision, 4);

  var ordered = loadClient();
  ordered.api.setContextView("mini");
  var older = ordered.state().contextViewPreferenceState.saveRequestId;
  ordered.api.setContextView("panel");
  var newer = ordered.state().contextViewPreferenceState.saveRequestId;
  ordered.api.handleContextViewMessage({ type: "context_view_state", accountId: "u1", serverEpoch: "old", canonicalRevision: 4, mode: "panel", ready: true, preferencePresent: true });
  ordered.api.handleContextViewMessage({ type: "context_view_state", requestId: older, accountId: "u1", serverEpoch: "old", canonicalRevision: 3, mode: "mini", ready: true });
  assert.equal(ordered.state().contextViewPreferenceState.canonicalRevision, 4);
  assert.equal(ordered.api.getContextView(), "panel");
  ordered.api.handleContextViewMessage({ type: "context_view_state", requestId: newer, accountId: "u1", serverEpoch: "old", canonicalRevision: 5, ready: false, error: "save failed" });
  assert.equal(ordered.api.getContextView(), "panel");
  assert.equal(ordered.state().contextViewPreferenceState.canonicalMode, "panel");
});

test("context view correlated account loss settles the pending save", function () {
  var fixture = loadClient();
  fixture.api.setContextView("panel");
  var saveId = fixture.state().contextViewPreferenceState.saveRequestId;
  fixture.api.handleContextViewMessage({ type: "context_view_state", requestId: saveId, accountId: null, accountAvailable: false, serverEpoch: "old", error: "Your account is no longer available." });
  assert.equal(fixture.state().contextViewPreferenceState.saving, false);
  assert.equal(fixture.state().contextViewPreferenceState.saveRequestId, null);
  assert.equal(fixture.api.getContextView(), "off");
});

test("context view reconnect drops lost save before the new GET reply", function () {
  var fixture = loadClient();
  fixture.api.setContextView("panel");
  fixture.api.beginContextViewConnection();
  assert.equal(fixture.api.getContextView(), "off");
  assert.equal(fixture.state().contextViewPreferenceState.saving, false);
  assert.equal(fixture.state().contextViewPreferenceState.saveRequestId, null);
  fixture.api.requestContextView();
  var requestId = fixture.state().contextViewPreferenceState.requestId;
  fixture.api.handleContextViewMessage({ type: "context_view_state", requestId: requestId, accountId: "u1", serverEpoch: "new", canonicalRevision: 0, mode: "mini", preferencePresent: true, ready: true });
  assert.equal(fixture.api.getContextView(), "mini");
  assert.equal(fixture.state().contextViewPreferenceState.loading, false);
});

test("app panels use server preference authority and pane override remains transient", function () {
  var panels = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-panels.js"), "utf8");
  var pane = fs.readFileSync(path.join(__dirname, "../lib/public/modules/pane-bridge.js"), "utf8");
  assert.equal(panels.indexOf("localStorage.getItem(\"clay-context-view\")"), -1);
  assert.equal(panels.indexOf("localStorage.setItem(\"clay-context-view\")"), -1);
  assert.ok(panels.indexOf("getStoredContextView") !== -1);
  assert.ok(panels.indexOf("store.subscribe") !== -1);
  assert.equal(panels.indexOf("clay-context-view-changed"), -1);
  assert.doesNotMatch(panels, /setContextView\("off"\)\) applyContextView/);
  assert.doesNotMatch(panels, /setContextView\("mini"\)\) applyContextView/);
  assert.doesNotMatch(panels, /setContextView\("panel"\)\) applyContextView/);
  assert.match(pane, /contextViewOverride/);
});

test("context view effective mode uses the transient store override without changing preference", function () {
  var fixture = loadClient();
  fixture.set({ contextViewOverride: "panel" });
  fixture.set({ paneMode: false });
  assert.equal(fixture.api.getEffectiveContextView(), "off");
  fixture.set({ paneMode: true });
  assert.equal(fixture.api.getEffectiveContextView(), "panel");
  fixture.set({ contextViewPreferenceState: Object.assign({}, fixture.state().contextViewPreferenceState, { mode: "mini", canonicalMode: "mini" }) });
  fixture.set({ contextViewOverride: "off" });
  assert.equal(fixture.api.getEffectiveContextView(), "off");
  fixture.set({ contextViewOverride: null });
  assert.equal(fixture.api.getEffectiveContextView(), "mini");
});

test("context view boundary reset clears the pane override", function () {
  var fixture = loadClient();
  fixture.set({ contextViewOverride: "panel" });
  fixture.set({ myUserId: "u2" });
  assert.equal(fixture.state().contextViewOverride, null);
  assert.equal(fixture.state().contextViewPreferenceState.mode, "off");
});
