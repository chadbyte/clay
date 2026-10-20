var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), vm = require('node:vm');
function source(name) { return fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''); }
function childFixture() {
  var state = { connected: true, paneReady: true, activeSessionId: 7, sessionOriginId: 'origin', currentSlug: 'project', myUserId: 'owner', currentVendor: 'codex', currentModel: 'model-a',
    paneCommittedBinding: { sessionId: 7, sessionOriginId: 'origin', projectSlug: 'project', viewerId: 'owner' } };
  var observer, events = [], doc = {}, win = { parent: { CustomEvent: function (type) { this.type = type; } } };
  var frame = { contentWindow: win, contentDocument: doc, dispatchEvent: function (event) { events.push(event); } };
  var api = { store: { snap: function () { return state; }, subscribe: function (callback) { observer = callback; } }, window: win, document: doc };
  vm.runInNewContext(source('pane-header-runtime'), api); api.initPaneHeaderRuntime(frame);
  return { state: state, api: api, frame: frame, events: events, set: function (patch) { var previous = Object.assign({}, state); Object.assign(state, patch); observer(state, previous); } };
}
test('committed child reports read-only metadata once per model/vendor change without ready loops', function () {
  var f = childFixture();
  assert.equal(f.api.paneHeaderRuntime().model, 'model-a');
  f.set({ currentModel: 'model-b' });
  assert.deepEqual(f.events.map(function (event) { return event.type; }), ['clay-pane-config']);
  f.set({ currentModel: 'model-b', currentMsgTs: 9 });
  assert.equal(f.events.length, 1);
  f.set({ currentVendor: 'claude' }); assert.equal(f.events.length, 2);
});
var invalid = [ { connected: false }, { paneReady: false }, { paneSuspended: true }, { panePendingBinding: {} },
  { activeSessionId: 8 }, { sessionOriginId: 'replaced' }, { currentSlug: 'foreign' }, { myUserId: 'foreign' }, { paneCommittedBinding: null } ];
invalid.forEach(function (patch) {
  test('unready or foreign child cannot publish runtime metadata: ' + Object.keys(patch)[0], function () {
    var f = childFixture(); f.set(Object.assign({ currentModel: 'stale' }, patch));
    assert.equal(f.api.paneHeaderRuntime(), null); assert.equal(f.events.length, 0);
  });
});
test('replaced child window or document cannot notify the parent', function () {
  var f = childFixture(); f.frame.contentDocument = {}; f.set({ currentModel: 'stale' }); assert.equal(f.events.length, 0);
  f = childFixture(); f.frame.contentWindow = {}; f.set({ currentModel: 'stale' }); assert.equal(f.events.length, 0);
});
function parentFixture() {
  var binding = { sessionId: 7, sessionOriginId: 'origin' }, session = { id: 7, vendor: 'codex', sessionOriginId: 'origin', model: null };
  var text = {}, icon = {}, runtime = { querySelector: function (selector) { return selector.includes('icon') ? icon : text; }, setAttribute: function (key, value) { this[key] = value; } };
  var live = { ready: true, sessionId: 7, binding: binding }, observed = { vendor: 'codex', model: 'observed-model', binding: binding };
  var frame = { dataset: {}, clayPane: { identity: function () { return live; }, headerRuntime: function () { return observed; } } };
  var pane = { querySelector: function (selector) { return selector.includes('runtime') ? runtime : frame; } };
  var api = { store: { snap: function () { return {}; } }, getCachedSessions: function () { return [session]; },
    paneTarget: function () { return binding; }, samePaneTarget: function (a, b) { return a === b; }, samePaneBinding: function (a, b) { return a === b; },
    livePaneBinding: function () { return true; }, VENDOR_AVATARS: { codex: 'codex.svg' }, VENDOR_NAMES: { codex: 'Codex' },
    modelEntryValue: function (model) { return typeof model === 'string' ? model : model && (model.value || model.id) || ''; } };
  vm.runInNewContext(source('split-pane-runtime'), api);
  return { api: api, pane: pane, frame: frame, live: live, observed: observed, session: session, text: text, runtime: runtime };
}
test('parent uses exact bound child model and supports legacy model objects', function () {
  var f = parentFixture(); f.api.renderPaneRuntime(f.pane, f.session); assert.equal(f.text.textContent, 'observed-model');
  f.live.ready = false; f.session.model = { id: 'selected-model' }; f.api.renderPaneRuntime(f.pane, f.session); assert.equal(f.text.textContent, 'selected-model');
});
['binding', 'vendor', 'retarget', 'readiness', 'source'].forEach(function (change) {
  test('header ignores stale child observation after ' + change + ' changes', function () {
    var f = parentFixture();
    if (change === 'binding') f.observed.binding = {};
    if (change === 'vendor') f.observed.vendor = 'claude';
    if (change === 'retarget') f.frame.dataset.requestedSessionId = '8';
    if (change === 'readiness') f.live.ready = false;
    if (change === 'source') f.api.livePaneBinding = function () { return false; };
    f.api.renderPaneRuntime(f.pane, f.session); assert.equal(f.text.textContent, 'Provider default');
  });
});
test('singleton and multi-pane metadata refresh use actual visible pane identities', function () {
  var text = fs.readFileSync('lib/public/modules/split-view.js', 'utf8');
  var code = text.slice(text.indexOf('export function syncPaneTitles()'), text.indexOf('\nfunction handlePaneMessage')).replace('export ', '');
  var calls = [], panes = [{ dataset: { sessionId: '7', projectSlug: 'project' }, querySelector: function () { return null; } }];
  var api = { host: { querySelectorAll: function (selector) { assert.equal(selector, '.split-pane:not(.split-pane-cached)'); return panes; } },
    sessionById: function (id) { return { id: id, title: 'Conversation ' + id }; }, updateSplitPaneMetadata: function (pane, data) { calls.push(data.sessionId); },
    syncPairChrome: function () {}, store: { get: function () { return null; } } };
  vm.runInNewContext(code, api); api.syncPaneTitles(); assert.deepEqual(calls, [7]);
  panes.push({ dataset: { sessionId: '9', projectSlug: 'project' }, querySelector: function () { return null; } }); calls.length = 0; api.syncPaneTitles(); assert.deepEqual(calls, [7, 9]);
  calls.length = 0; panes[0].querySelector = function () { return { dataset: { requestedSessionId: '11' } }; };
  api.syncPaneTitles(); assert.deepEqual(calls, [9], 'a pending retarget cannot be activated back to its old session by permission refresh');
});
