var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  var state = { currentSlug: 'project', activeSessionId: 1, sessionOriginId: 'driver', projectSplitViewSocketGeneration: 1, connected: true }, listeners = [], sent = [], opened = [];
  var ws = { readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } };
  var store = { get: function (key) { return state[key]; }, set: function (patch) { var previous = state; state = Object.assign({}, state, patch); listeners.forEach(function (listener) { listener(state, previous); }); }, subscribe: function (fn) { listeners.push(fn); } };
  var context = { store: store, getWs: function () { return ws; }, document: { querySelector: function () { return null; } },
    escapeHtml: function (value) { return value; }, closeLoginBrowser: function () {}, closeTuiModal: function () {}, getTuiModalTerminalId: function () {},
    openLoginBrowser: function (msg) { opened.push(msg); }, openTuiModal: function () { opened.push('terminal'); },
    refreshIcons: function () {}, iconHtml: function () { return ''; }, forwardPaneAuthRequired: function () {}, setTimeout: setTimeout };
  vm.createContext(context);
  var source = fs.readFileSync(require.resolve('../lib/public/modules/vendor-login.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  var personal = fs.readFileSync(require.resolve('../lib/public/modules/personal-provider-context.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(personal + '\n' + source, context);
  return { store: store, ws: ws, sent: sent, opened: opened, api: context,
    event: { slug: 'project', vendor: 'codex', sessionId: 2, workerAuthRequestId: 'receipt', loginCommand: 'codex login', canAutoLogin: true },
    ready: { slug: 'project', vendor: 'codex', sessionId: 2, workerAuthRequestId: 'receipt', terminalId: 42, browserId: 'browser' } };
}
test('live Worker recovery preserves its target, dedupes requests, and opens only its matching reply', function () {
  var f = fixture();
  assert.equal(f.api.handleWorkerAuthRequired(f.event), true);
  assert.equal(f.api.handleWorkerAuthRequired(f.event), false);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].sessionId, 2); assert.equal(f.sent[0].workerAuthRequestId, 'receipt');
  f.api.handleVendorLoginReady(f.ready); assert.equal(f.opened.length, 1);
  assert.equal(f.store.get('activeSessionId'), 1);
});
['activeSessionId', 'sessionOriginId', 'currentSlug', 'projectSplitViewSocketGeneration'].forEach(function (key) {
  test('late ready refuses changed ' + key, function () {
    var f = fixture(); f.api.handleWorkerAuthRequired(f.event);
    var patch = {}; patch[key] = 'changed'; f.store.set(patch);
    f.api.handleVendorLoginReady(f.ready); assert.equal(f.opened.length, 0);
  });
});
test('history, another project, offline and unsupported login cannot start a Worker sign-in', function () {
  var f = fixture(); f.store.set({ replayingHistory: true });
  assert.equal(f.api.handleWorkerAuthRequired(f.event), false);
  f.store.set({ replayingHistory: false, currentSlug: 'other' });
  assert.equal(f.api.handleWorkerAuthRequired(f.event), false);
  f.store.set({ currentSlug: 'project' }); f.ws.readyState = 3;
  assert.equal(f.api.handleWorkerAuthRequired(f.event), false);
  f.ws.readyState = 1;
  assert.equal(f.api.handleWorkerAuthRequired(Object.assign({}, f.event, { canAutoLogin: false })), false);
  assert.equal(f.sent.length, 0);
});
test('disconnect clears pending login so a later explicit attempt can recover', function () {
  var f = fixture(); f.api.handleWorkerAuthRequired(f.event);
  f.ws.readyState = 3; f.store.set({ connected: false });
  f.ws.readyState = 1; f.store.set({ connected: true });
  assert.equal(f.api.handleWorkerAuthRequired(f.event), true);
});
