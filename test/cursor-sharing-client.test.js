var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

function loadPreference() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/cursor-sharing-preference.js"), "utf8").replace(/^import .*;\n/gm, "").replace(/export function /g, "function ");
  source += "\nthis.api={handleCursorSharingMessage:handleCursorSharingMessage};";
  var state = { connected: true, myUserId: null, cursorSharingEnabled: false, cursorSharingHydrated: false }, sent = [];
  var context = { store: { get: function (key) { return state[key]; }, set: function (value) { state = Object.assign({}, state, value); } }, getWs: function () { return { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } }; }, showToast: function (message) { context.toast = message; } };
  vm.runInNewContext(source, context);
  return { api: context.api, state: state, getState: function () { return state; }, setState: function (value) { state = Object.assign({}, state, value); }, sent: sent, context: context };
}

test("client hydration enables sharing and disabling sends authenticated cleanup", function () {
  var h = loadPreference();
  h.api.handleCursorSharingMessage({ type: "cursor_sharing_state", ready: true, accountId: "u1", cursorSharing: true });
  assert.equal(h.getState().cursorSharingHydrated, true);
  h.api.handleCursorSharingMessage({ type: "cursor_sharing_state", ready: true, accountId: "u1", cursorSharing: false });
  assert.deepEqual(h.sent, [{ type: "cursor_leave" }, { type: "text_select", ranges: [] }]);
  assert.equal(h.getState().cursorSharingEnabled, false);
});

test("client fails closed on account errors and rehydrates after identity changes", function () {
  var h = loadPreference();
  h.setState({ cursorSharingEnabled: true, cursorSharingHydrated: true, cursorSharingAccountId: "u1" });
  h.api.handleCursorSharingMessage({ type: "cursor_sharing_state", ready: false, accountAvailable: false, error: "expired" });
  assert.equal(h.getState().cursorSharingHydrated, false);
  assert.equal(h.context.toast, "expired");
  assert.deepEqual(h.sent, [{ type: "cursor_leave" }, { type: "text_select", ranges: [] }]);
});

test("cursor lifecycle requests canonical state after null-to-account identity and gates movement while unhydrated", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-cursors.js"), "utf8").replace(/^import .*;\n/gm, "").replace(/export function /g, "function ");
  source += "\nthis.api={initCursors:initCursors};";
  var state = { connected: true, myUserId: null, isMultiUserMode: false, cursorSharingEnabled: false, cursorSharingHydrated: false }, sent = [], listeners = [];
  var messages = { addEventListener: function (name, fn) { this[name] = fn; }, querySelectorAll: function () { return []; } };
  var ws = { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } };
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (value) { var prev = state; state = Object.assign({}, state, value); listeners.forEach(function (fn) { fn(state, prev); }); }, subscribe: function (fn) { listeners.push(fn); } },
    getWs: function () { return ws; }, getMessagesEl: function () { return messages; }, getCursorColor: function () { return "#000"; }, avatarUrl: function () { return ""; }, registerTooltip: function () {},
    document: { addEventListener: function (name, fn) { this[name] = fn; }, querySelector: function () { return null; } }, NodeFilter: { SHOW_TEXT: 4 }, setTimeout: setTimeout, clearTimeout: clearTimeout, window: {}, console: console,
  };
  vm.runInNewContext(source, context);
  context.api.initCursors();
  state.cursorSharingEnabled = true;
  state.cursorSharingHydrated = true;
  context.store.set({ myUserId: "u1" });
  assert.deepEqual(sent, [{ type: "cursor_sharing_get", requestId: sent[0].requestId }]);
  sent.length = 0;
  state.cursorSharingHydrated = false;
  messages.mousemove({ clientX: 1, clientY: 1 });
  assert.deepEqual(sent, []);
  context.store.set({ connected: false });
  assert.equal(state.cursorSharingHydrated, false);
});
