"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var vm = require("node:vm");

var closeSource = fs.readFileSync("lib/public/modules/split-view-presentation-close.js", "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
var closeActions = fs.readFileSync("lib/public/modules/split-view-close-actions.js", "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
function extract(source, start, end) {
  var from = source.indexOf(start), to = source.indexOf(end, from);
  assert.notEqual(from, -1, start); assert.notEqual(to, -1, end);
  return source.slice(from, to).replace(/^export /gm, "");
}
var emptySource = fs.readFileSync("lib/public/modules/project-empty-canvas.js", "utf8");
var standaloneScopeSource = extract(emptySource, "function standaloneScope()", "function currentPickerScope(scope)");
var pickerScopeSource = extract(emptySource, "function currentPickerScope(scope)", "function updatePicker(change)");
var showEmptySource = extract(emptySource, "export function showStandaloneEmptyCanvas(host, nativeApp)", "export function clearProjectEmptyCanvas");

function harness(mode) {
  var session = { id: 41, sessionOriginId: "origin-41", ownerId: "owner", sessionRole: "driver" };
  var binding = { sessionId: 41, sessionOriginId: "origin-41", generation: 7, requestId: "bind-7" };
  var view = mode === "saved" ? { id: "view-1", revision: 5, sessions: [{ id: 41, sessionOriginId: session.sessionOriginId }], tree: { id: session.sessionOriginId } } : null;
  var state = { currentSlug: "project", activeProjectSlug: "project", sessionListProjectSlug: "project", currentProjectOwnerId: "owner",
    myUserId: "owner", projectSplitViewSocketGeneration: 3, projectSplitViewContextKey: "project|owner|owner|3", connected: true,
    activeSessionId: 41, projectSplitViewActiveId: view && view.id, projectSplitViewRevision: view ? 5 : 0,
    projectSplitViews: view ? [view] : [], projectSplitViewSingletonOrigin: view ? null : session.sessionOriginId,
    projectStartPicker: null, splitPanes: null };
  var removed = [], renderedEmpty = 0, switched = [], dispatched = [], eventHandler = null;
  var frame = { dataset: { sessionId: "41", sessionOriginId: session.sessionOriginId }, clayPane: { identity: function () {
    return { ready: true, projectSlug: "project", ownerId: "owner", sessionId: 41, binding: binding };
  } }, closest: function () { return pane; } };
  var pane = { isConnected: true, hidden: false, querySelector: function (selector) { return selector === '.split-pane-frame' ? frame : button; } };
  var button = { dataset: {}, addEventListener: function (name, callback) { this.callback = callback; } };
  var context = vm.createContext({
    store: { snap: function () { return Object.assign({}, state); }, get: function (key) { return state[key]; }, set: function (change) { Object.assign(state, change); } },
    viewExists: function (views, id) { return (views || []).find(function (item) { return item.id === id; }) || null; },
    getCachedSessions: function () { return [session]; }, currentSingletonPresentation: function (snapshot) {
      return snapshot.activeSessionId === 41 ? { origin: session.sessionOriginId, session: session } : null;
    }, livePaneBinding: function () { return true; }, samePaneBinding: function (left, right) { return JSON.stringify(left) === JSON.stringify(right); },
    exactDriverForOrigin: function (origin) { return origin === session.sessionOriginId ? session : null; },
    document: { dispatchEvent: function (event) { dispatched.push(event); if (eventHandler) eventHandler({ detail: event.detail }); } },
    CustomEvent: function (name, options) { this.type = name; this.detail = options.detail; },
    removeViewSession: function (currentView, origin) {
      removed.push({ view: currentView, origin: origin });
      return true;
    },
    renderProjectEmptyCanvas: function () { renderedEmpty++; },
    host: {}, nativeApp: {}, layoutScope: function () { return { standalone: true }; },
    switchToStandalone: function (id) { switched.push(id); return true; },
    Number: Number
  });
  vm.runInContext(closeSource, context);
  vm.runInContext(closeActions, context);
  vm.runInContext(standaloneScopeSource + pickerScopeSource + showEmptySource, context);
  context.bindPresentationClose(pane);
  eventHandler = function (event) { context.handlePresentationClose(event.detail, context.host, context.nativeApp); };
  return { context: context, state: state, session: session, binding: binding, frame: frame, pane: pane, button: button,
    removed: removed, switched: switched, dispatched: dispatched, rendered: function () { return renderedEmpty; } };
}

function clickClose(h) {
  h.button.callback({ preventDefault: function () {}, stopImmediatePropagation: function () {} });
}

test("singleton Close dispatches through the real close handler into the empty workspace", function () {
  var h = harness("singleton");
  clickClose(h);
  assert.equal(h.dispatched.length, 1);
  assert.equal(h.dispatched[0].detail.kind, "singleton");
  assert.equal(h.state.projectSplitViewSingletonOrigin, null);
  assert.equal(h.state.projectStartPicker.projectStart, true);
  assert.equal(h.rendered(), 1);
  assert.equal(h.session.id, h.state.activeSessionId, "closing presentation keeps the active session/runtime selected");
  assert.equal(h.context.currentPickerScope(h.state.projectStartPicker.scope), true, "the empty picker scope remains valid while the session runtime stays active");
  h.state.currentSlug = "another-project";
  assert.equal(h.context.currentPickerScope(h.state.projectStartPicker.scope), false, "a workspace change invalidates the empty picker scope");
  assert.equal(h.removed.length, 0, "singleton close does not mutate saved views or delete the session");
});

test("sidebar selection from the empty workspace reopens the retained session", function () {
  var h = harness("singleton");
  clickClose(h);
  assert.equal(h.context.reopenEmptyCanvasSession({ dataset: { sessionId: "41" } }, function (id) { h.switched.push(id); }), true);
  assert.deepEqual(h.switched, [41]);
  assert.equal(h.context.reopenEmptyCanvasSession({ dataset: { sessionId: "999" } }, function (id) { h.switched.push(id); }), false);
  assert.equal(h.context.reopenEmptyCanvasSession({ dataset: { sessionId: "41" } }, function () { return false; }), false,
    "a rejected production session switch is not reported as a successful reopen");
});

test("singleton Close rejects a stale live binding before dispatch", function () {
  var h = harness("singleton");
  h.frame.dataset.sessionOriginId = "replaced-origin";
  clickClose(h);
  assert.equal(h.dispatched.length, 0, "a stale pane binding cannot dispatch close");
});

test("saved-view final-member Close still enters the acknowledged member-removal path", function () {
  var h = harness("saved");
  clickClose(h);
  assert.equal(h.dispatched.length, 1);
  assert.equal(h.dispatched[0].detail.kind, "saved-view");
  assert.equal(h.removed.length, 1);
  assert.equal(h.removed[0].origin, h.session.sessionOriginId);
  assert.deepEqual(Array.from(h.removed[0].view.sessions, function (item) { return item.sessionOriginId; }), [h.session.sessionOriginId]);
  assert.equal(h.rendered(), 0, "the saved view remains on its existing mutation/acknowledgement path");
});
