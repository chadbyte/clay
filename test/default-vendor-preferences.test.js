var assert = require("assert");
var test = require("node:test");
var preferencesModule = require("../lib/users-default-vendor-preferences");
var serviceModule = require("../lib/server-default-vendor");
var fs = require("fs");
var vm = require("vm");
var path = require("path");

function storage(initial, multiUser, configInitial) {
  var data = JSON.parse(JSON.stringify(initial));
  var config = Object.assign({}, configInitial || {});
  var configModule = {
    loadConfig: function () { return Object.assign({}, config); },
    saveConfig: function (next) { config = Object.assign({}, next); },
  };
  var preferences = preferencesModule.attachDefaultVendorPreferences({
    loadUsers: function () { return JSON.parse(JSON.stringify(data)); },
    saveUsers: function (next) { data = JSON.parse(JSON.stringify(next)); },
    isMultiUser: function () { return multiUser; },
    configModule: configModule,
  });
  return { preferences: preferences, read: function () { return data; }, config: function () { return config; } };
}

test("default coding vendor persists in single-user config without dropping settings", function () {
  var fixture = storage({ users: [] }, false, { port: 2633, tls: true });
  assert.equal(fixture.preferences.setDefaultVendor("default", "codex").ok, true);
  assert.deepEqual(fixture.config(), { port: 2633, tls: true, defaultVendorPreference: "codex" });
  assert.equal(fixture.preferences.getDefaultVendor("default").vendor, "codex");
  assert.equal(fixture.preferences.setDefaultVendor("default", "").ok, true);
  assert.deepEqual(fixture.config(), { port: 2633, tls: true });
});

test("clearing a single-user record preference also clears an older config preference", function () {
  var fixture = storage({ users: [{ id: "default", defaultVendorPreference: "codex" }] }, false, { defaultVendorPreference: "claude", keep: true });
  assert.equal(fixture.preferences.getDefaultVendor("default").vendor, "codex");
  assert.equal(fixture.preferences.setDefaultVendor("default", "").ok, true);
  assert.equal(fixture.preferences.getDefaultVendor("default").present, false);
  assert.equal(fixture.config().defaultVendorPreference, undefined);
  assert.equal(fixture.config().keep, true);
});

test("default coding vendor is isolated per multi-user record and rejects invalid values", function () {
  var fixture = storage({ users: [{ id: "u1" }, { id: "u2", defaultVendorPreference: "claude" }] }, true);
  assert.equal(fixture.preferences.setDefaultVendor("u1", "codex").ok, true);
  assert.equal(fixture.preferences.getDefaultVendor("u1").vendor, "codex");
  assert.equal(fixture.preferences.getDefaultVendor("u2").vendor, "claude");
  assert.equal(fixture.preferences.setDefaultVendor("u1", "not a vendor").ok, false);
  assert.equal(fixture.preferences.setDefaultVendor("missing", "codex").ok, false);
});

function serviceFixture() {
  var records = { u1: { id: "u1" }, u2: { id: "u2" } };
  var saved = {};
  var clients = [];
  var users = {
    isMultiUser: function () { return true; },
    findUserById: function (id) { return records[id] || null; },
    getDefaultVendorPreference: function (id) { return { present: !!saved[id], vendor: saved[id] || null }; },
    setDefaultVendorPreference: function (id, vendor) { saved[id] = vendor; return { ok: true, vendor: vendor }; },
  };
  var homeChatHandler = { findMateProject: function () { return { ctx: { getVendorModelAvailability: function () { return [{ id: "claude", installed: true }, { id: "codex", installed: true }]; } } }; } };
  var service = serviceModule.attachDefaultVendorService({ users: users, homeChatHandler: homeChatHandler, forEachAppClient: function (fn) { clients.forEach(fn); }, serverEpoch: "test-epoch" });
  function ws(id) { var socket = { readyState: 1, _clayUser: { id: id }, sent: [] }; socket.send = function (value) { socket.sent.push(JSON.parse(value)); }; return socket; }
  return { service: service, ws: ws, clients: clients, saved: saved };
}

test("default vendor service validates installed vendors and broadcasts only to same user", function () {
  var fixture = serviceFixture();
  var first = fixture.ws("u1");
  var sameUser = fixture.ws("u1");
  var otherUser = fixture.ws("u2");
  fixture.clients.push(sameUser, otherUser);
  fixture.service.handleMessage(first, { type: "default_vendor_set", requestId: "save", vendor: "codex" });
  assert.equal(fixture.saved.u1, "codex");
  assert.equal(sameUser.sent.some(function (message) { return message.preference === "codex"; }), true);
  assert.equal(otherUser.sent.some(function (message) { return message.preference === "codex"; }), false);
  assert.equal(sameUser.sent.some(function (message) { return Object.prototype.hasOwnProperty.call(message, "projectSlug"); }), false);
  fixture.service.handleMessage(first, { type: "default_vendor_set", requestId: "bad", vendor: "kiro" });
  assert.match(first.sent[first.sent.length - 1].error, /not installed or authorized/);
});

test("same-user broadcasts omit source project while correlated replies retain it", function () {
  var fixture = serviceFixture();
  var projectOne = fixture.ws("u1");
  var projectTwo = fixture.ws("u1");
  fixture.clients.push(projectTwo);
  fixture.service.handleMessage(projectOne, { type: "default_vendor_set", requestId: "project-one", vendor: "codex" }, "project-one");
  assert.equal(projectTwo.sent[0].projectSlug, undefined);
  assert.equal(projectOne.sent[0].projectSlug, "project-one");
  assert.equal(projectOne.sent[0].requestId, "project-one");
});

test("default vendor save failure leaves the canonical preference unchanged", function () {
  var fixture = serviceFixture();
  var ws = fixture.ws("u1");
  fixture.saved.u1 = "claude";
  fixture.service = serviceModule.attachDefaultVendorService({
    users: {
      isMultiUser: function () { return true; },
      findUserById: function (id) { return id === "u1" ? { id: id } : null; },
      getDefaultVendorPreference: function () { return { present: true, vendor: "claude" }; },
      setDefaultVendorPreference: function () { return { ok: false, error: "save failed" }; },
    },
    homeChatHandler: { findMateProject: function () { return { ctx: { getVendorModelAvailability: function () { return [{ id: "codex", installed: true }]; } } }; } },
    forEachAppClient: function () {},
    serverEpoch: "failure-epoch",
  });
  fixture.service.handleMessage(ws, { type: "default_vendor_set", requestId: "failure", vendor: "codex" });
  assert.equal(ws.sent[0].preference, undefined);
  assert.equal(ws.sent[0].error, "save failed");
  assert.equal(fixture.saved.u1, "claude");
});

test("default vendor service derives the live actor on availability lookup", function () {
  var observed = null;
  var fixture = serviceFixture();
  fixture.service = serviceModule.attachDefaultVendorService({
    users: {
      isMultiUser: function () { return true; },
      findUserById: function (id) { return id === "u1" ? { id: id, role: "user" } : null; },
      getDefaultVendorPreference: function () { return { present: false, vendor: null }; },
      setDefaultVendorPreference: function () { return { ok: true }; },
    },
    homeChatHandler: { findMateProject: function () { return { ctx: { getVendorModelAvailability: function (socket) { observed = socket._clayUser; return [{ id: "codex", installed: true }]; } } }; } },
    forEachAppClient: function () {},
    serverEpoch: "actor-epoch",
  });
  var socket = fixture.ws("u1");
  socket._clayUser.role = "stale-client-role";
  fixture.service.handleMessage(socket, { type: "default_vendor_get", requestId: "fresh" });
  assert.deepEqual(observed, { id: "u1", role: "user" });
});

function loadClient() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/default-vendor.js"), "utf8");
  source = source.replace(/^import .*;\n/gm, "").replace(/export function /g, "function ");
  source += "\nthis.api={requestDefaultVendor:requestDefaultVendor,beginDefaultVendorConnection:beginDefaultVendorConnection,saveDefaultVendor:saveDefaultVendor,handleDefaultVendorMessage:handleDefaultVendorMessage};";
  var state = { connected: true, myUserId: "u1", currentSlug: "project-a", defaultVendorState: { loading: false, saving: false, getRequestId: null, saveRequestId: null, preference: "claude", preferencePresent: true, installedVendors: ["claude", "codex"], accountId: "u1", projectSlug: "project-a", serverEpoch: "old", canonicalRevision: 3, error: "" } };
  var listeners = [];
  var sent = [];
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (value) { var previous = state; state = Object.assign({}, state, value); listeners.forEach(function (listener) { listener(state, previous); }); }, subscribe: function (listener) { listeners.push(listener); } },
    getWs: function () { return { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } }; },
    firstInstalledVendor: function (installed) { return installed[0] || ""; },
    Date: Date,
  };
  vm.runInNewContext(source, context);
  return { api: context.api, getState: function () { return state; }, sent: sent, set: function (value) { context.store.set(value); } };
}

test("client correlates requests, resets account/project boundaries, and ignores stale epochs", function () {
  var fixture = loadClient();
  fixture.api.requestDefaultVendor();
  var requestId = fixture.getState().defaultVendorState.getRequestId;
  assert.equal(fixture.getState().defaultVendorState.loading, true);
  fixture.api.handleDefaultVendorMessage({ type: "default_vendor_state", requestId: "old", accountId: "u1", projectSlug: "project-a", serverEpoch: "old", preference: "codex", canonicalRevision: 4 });
  assert.equal(fixture.getState().defaultVendorState.preference, "claude");
  fixture.api.handleDefaultVendorMessage({ type: "default_vendor_state", requestId: requestId, accountId: "u1", projectSlug: "project-a", serverEpoch: "new", preference: "codex", canonicalRevision: 0, ready: true });
  assert.equal(fixture.getState().defaultVendorState.preference, "codex");
  fixture.api.handleDefaultVendorMessage({ type: "default_vendor_state", requestId: null, accountId: "u1", projectSlug: "project-a", serverEpoch: "old", preference: "claude", canonicalRevision: 8 });
  assert.equal(fixture.getState().defaultVendorState.preference, "codex");
  fixture.api.handleDefaultVendorMessage({ type: "default_vendor_state", requestId: "null-account", accountId: null, projectSlug: "project-a", error: "Your account is no longer available." });
  assert.equal(fixture.getState().defaultVendorState.preference, "codex");
  fixture.set({ currentSlug: "project-b" });
  assert.equal(fixture.getState().defaultVendorState.preference, null);
  assert.equal(fixture.getState().defaultVendorState.projectSlug, "project-b");
});

test("client save failure preserves the prior preference and exposes pending/error state", function () {
  var fixture = loadClient();
  fixture.api.saveDefaultVendor("codex");
  var requestId = fixture.getState().defaultVendorState.saveRequestId;
  assert.equal(fixture.getState().defaultVendorState.saving, true);
  fixture.api.handleDefaultVendorMessage({ type: "default_vendor_state", requestId: requestId, accountId: "u1", projectSlug: "project-a", serverEpoch: "old", ready: false, error: "save failed" });
  assert.equal(fixture.getState().defaultVendorState.preference, "claude");
  assert.equal(fixture.getState().defaultVendorState.saving, false);
  assert.equal(fixture.getState().defaultVendorState.error, "save failed");
});

test("client keeps a pending save through unrelated broadcasts and accepts correlated null-account failure", function () {
  var fixture = loadClient();
  fixture.api.saveDefaultVendor("codex");
  var requestId = fixture.getState().defaultVendorState.saveRequestId;
  fixture.api.handleDefaultVendorMessage({ type: "default_vendor_state", requestId: null, accountId: "u1", serverEpoch: "old", canonicalRevision: 4, preference: "codex", preferencePresent: true });
  assert.equal(fixture.getState().defaultVendorState.saving, true);
  assert.equal(fixture.getState().defaultVendorState.saveRequestId, requestId);
  fixture.api.handleDefaultVendorMessage({ type: "default_vendor_state", requestId: requestId, accountId: null, accountAvailable: false, serverEpoch: "old", ready: false, error: "Your account is no longer available." });
  assert.equal(fixture.getState().defaultVendorState.saving, false);
  assert.equal(fixture.getState().defaultVendorState.saveRequestId, null);
  assert.equal(fixture.getState().defaultVendorState.preference, "codex");
  assert.equal(fixture.getState().defaultVendorState.error, "Your account is no longer available.");
});

test("client clears a lost pending save before reconnect GET and accepts the new ACK", function () {
  var fixture = loadClient();
  fixture.api.saveDefaultVendor("codex");
  assert.equal(fixture.getState().defaultVendorState.saving, true);
  fixture.api.beginDefaultVendorConnection();
  assert.equal(fixture.getState().defaultVendorState.saving, false);
  assert.equal(fixture.getState().defaultVendorState.saveRequestId, null);
  fixture.api.requestDefaultVendor();
  var getRequestId = fixture.getState().defaultVendorState.getRequestId;
  fixture.api.handleDefaultVendorMessage({ type: "default_vendor_state", requestId: getRequestId, accountId: "u1", projectSlug: "project-a", serverEpoch: "new", canonicalRevision: 0, preference: "claude", preferencePresent: true, ready: true });
  assert.equal(fixture.getState().defaultVendorState.loading, false);
  assert.equal(fixture.getState().defaultVendorState.preference, "claude");
});

test("production menus expose independent default controls and rerender from preference broadcasts", function () {
  var desktop = fs.readFileSync(path.join(__dirname, "../lib/public/modules/sidebar-sessions.js"), "utf8");
  var mobile = fs.readFileSync(path.join(__dirname, "../lib/public/modules/sidebar-mobile.js"), "utf8");
  assert.match(desktop, /store\.subscribe\(function \(state, previous\)/);
  assert.match(desktop, /className = "session-new-set-default"/);
  assert.match(mobile, /className = "mobile-vendor-set-default"/);
  assert.match(desktop, /saveDefaultVendor\(vendor\)/);
  assert.match(mobile, /saveDefaultVendor\(vendor\)/);
  assert.match(desktop, /Saved default /);
  assert.match(desktop, /is unavailable\. Using /);
  assert.match(mobile, /Saved default /);
  assert.match(mobile, /is unavailable\. Using /);
  assert.match(desktop, /Use automatic default/);
  assert.match(mobile, /Use automatic default/);
  assert.doesNotMatch(desktop, /saveDefaultVendor\(vendor\)\) defaultBtn\.textContent/);
  assert.doesNotMatch(mobile, /saveDefaultVendor\(vendor\)\) defaultBtn\.textContent/);
  assert.match(desktop, /sessionCtxMenuAnchor/);
});
