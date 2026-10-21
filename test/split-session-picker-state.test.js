var test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
test('split insertion rejects stale context, duplicate/foreign members and capacity; late creation never replays into another View', function () {
  var sent = [], inserts = [], notices = [], subscribers = [], state = { connected: true, currentSlug: 'project', currentProjectOwnerId: 'owner', myUserId: 'owner', projectSplitViewSocketGeneration: 1, projectSplitViewActiveId: 'view', projectSplitViewContextKey: 'context' };
  var view = { id: 'view', revision: 1, tree: { id: 'origin-a' }, sessions: [{ id: 1, sessionOriginId: 'origin-a' }], workspace: {} };
  var sessions = [{ id: 1, ownerId: 'owner', sessionOriginId: 'origin-a' }, { id: 2, ownerId: 'owner', sessionOriginId: 'origin-b' }, { id: 3, ownerId: 'foreign', sessionOriginId: 'foreign' }, { id: 4, ownerId: 'owner', sessionOriginId: 'worker', sessionRole: 'worker' }];
  state.projectSplitViews = [view];
  var store = { get: function (key) { return state[key]; }, snap: function () { return state; }, subscribe: function (fn) { subscribers.push(fn); }, set: function (patch) { var before = Object.assign({}, state); Object.assign(state, patch); subscribers.forEach(function (fn) { fn(state, before); }); } };
  var socket = { send: function (value) { sent.push(JSON.parse(value)); } };
  var context = vm.createContext({ store: store, getWs: function () { return socket; }, getCachedSessions: function () { return sessions; }, activeSavedView: function () { return state.projectSplitViews.find(function (v) { return v.id === state.projectSplitViewActiveId; }); },
    viewForOrigin: function () { return null; }, applyPresentationDrop: function (drag, target) { inserts.push({ drag: drag, target: target }); return true; }, mutation: function () {}, checkComposerDeparture: function () {},
    createOptions: function () { return { vendors: [{ id: 'codex', installed: true }] }; }, showToast: function (text) { notices.push(text); }, document: { querySelectorAll: function () { return []; } }, crypto: { randomUUID: function () { return String(sent.length); } }, setTimeout: function () {} });
  ['split-view-layout-scope', 'split-view-picker-actions'].forEach(function (name) { vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context); });
  var receipt = { scope: context.layoutScope(view), origin: 'origin-a' };
  assert.equal(context.insertPickerSession(receipt, 'right', 1), false); assert.equal(context.insertPickerSession(receipt, 'right', 3), false); assert.equal(context.insertPickerSession(receipt, 'right', 4), false);
  assert.equal(context.insertPickerSession(receipt, 'left', 2), true); assert.equal(inserts[0].target.side, 'left'); assert.equal(inserts[0].target.origin, 'origin-a');
  view.workspace.linkedPair = { workerOrigins: Array(7).fill('worker') }; assert.equal(context.createPickerSession(receipt, 'top', 'codex'), false); delete view.workspace.linkedPair;
  assert.equal(context.createPickerSession(receipt, 'invalid', 'codex'), false);
  assert.equal(context.createPickerSession(receipt, 'top', 'not-installed'), false); assert.equal(sent.length, 0);
  assert.equal(context.createPickerSession(receipt, 'top', 'codex'), true); assert.equal(sent[0].activate, false); assert.equal(context.createPickerSession(receipt, 'top', 'codex'), false);
  assert.equal(context.handleSplitSessionCreated({ type: 'new_session_result', requestId: 'foreign', ok: true, sessionId: 2 }), false);
  store.set({ projectSplitViewActiveId: 'different' });
  assert.equal(context.handleSplitSessionCreated({ type: 'new_session_result', requestId: sent[0].requestId, ok: true, sessionId: 2 }), true);
  assert.equal(inserts.length, 1); assert.match(notices[0], /created in Unfiled/); assert.equal(state.splitSessionCreation, null);
  store.set({ projectSplitViewActiveId: 'view' }); assert.equal(context.insertPickerSession(receipt, 'right', 2), false, 'returning to a View never revives an old scope');
  receipt = { scope: context.layoutScope(view), origin: 'origin-a' };
  store.set({ projectSplitViewSocketGeneration: 2 }); assert.equal(context.insertPickerSession(receipt, 'right', 2), false);
  receipt = { scope: context.layoutScope(view), origin: 'origin-a', reservationId: 'cancelled-slot' };
  store.set({ splitSessionPicker: { receipt: receipt } });
  assert.equal(context.createPickerSession(receipt, 'right', 'codex'), true);
  var creation = sent[sent.length - 1];
  store.set({ splitSessionPicker: null });
  assert.equal(context.handleSplitSessionCreated({ type: 'new_session_result', requestId: creation.requestId, ok: true, sessionId: 2 }), true);
  assert.equal(inserts.length, 1, 'Closing an empty pane cancels placement of a later successful creation');
  assert.match(notices[notices.length - 1], /created in Unfiled/);
  context.crypto.randomUUID = undefined;
  receipt = { scope: context.layoutScope(view), origin: 'origin-a' };
  assert.equal(context.createPickerSession(receipt, 'right', 'codex'), true, 'Plain HTTP without randomUUID can still create a split session');
  assert.match(sent[sent.length - 1].requestId, /^split-create-[a-z0-9]+-/);
});
