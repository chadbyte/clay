var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(pane) {
  var listeners = {}, sends = [], received = [], socket = { readyState: 1, send: function (data) { sends.push(JSON.parse(data)); } };
  var document = { querySelectorAll: function () { return frames; }, addEventListener: function () {} };
  var context = vm.createContext({ document: document, location: { origin: 'https://clay.test' }, queueMicrotask: function (fn) { fn(); },
    window: { addEventListener: function (name, fn) { listeners[name] = fn; } }, getWs: function () { return socket; } });
  ['store', 'pane-binding', 'pane-browser-transport'].forEach(function (name) {
    var code = fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(code, context);
  });
  var binding = { requestId: 'request-2', generation: 1, projectSlug: 'demo', viewerId: 'owner', ownerId: 'owner', sessionId: 2,
    sessionOriginId: 'origin-2', role: 'driver', workerGeneration: null, parentSessionOriginId: null, groupStamp: null };
  var live = { ready: true, projectSlug: 'demo', ownerId: 'owner', sessionId: 2, binding: binding };
  var frame = { contentWindow: {}, contentDocument: {}, dataset: { sessionId: '2', sessionOriginId: 'origin-2' }, closest: function () { return null; } };
  frame.clayPane = { source: frame.contentWindow, document: frame.contentDocument, identity: function () { return live; },
    browserCommand: function (action, fields, target) { sends.push({ action: action, fields: fields, binding: target }); return true; } };
  var frames = [frame];
  context.store.set({ connected: true, currentSlug: 'demo', myUserId: 'owner', paneMode: !!pane, activeSessionId: pane ? 2 : 1,
    paneReady: true, paneCommittedBinding: binding, paneBindingSessions: [{ id: 2, sessionOriginId: 'origin-2', ownerId: 'owner' }],
    projectSplitViewSingletonOrigin: 'origin-2' });
  context.initBrowserPaneTransport(function (message) { received.push(message); }, function () {});
  function event(patch) {
    var message = { type: 'shared_browser_state', sessionId: 2, paneActivation: binding, present: true };
    var value = Object.assign({ origin: 'https://clay.test', source: frame.contentWindow,
      data: { type: 'clay-pane-browser-update', paneBinding: binding, message: message } }, patch);
    listeners.message(value);
  }
  return { api: context, frames: frames, frame: frame, live: live, binding: binding, socket: socket, sends: sends, received: received, event: event,
    remove: function () { frames = []; } };
}
test('Browser presentation accepts only the current authenticated pane and browser messages', function () {
  var f = fixture();
  f.event({ origin: 'https://foreign.test' }); f.event({ source: {} });
  f.event({ data: { type: 'clay-pane-browser-update', paneBinding: f.binding,
    message: { type: 'shared_browser_state', sessionId: 1, paneActivation: f.binding, present: true } } });
  f.event({ data: { type: 'clay-pane-browser-update', paneBinding: f.binding,
    message: { type: 'permission_request', sessionId: 2, paneActivation: f.binding, present: true } } });
  assert.equal(f.received.length, 0);
  f.event(); assert.equal(f.received.length, 1); assert.equal(f.api.browserPaneSessionId(), 2);
  assert.equal(f.api.sendBrowserPaneCommand('control', { control: 'user' }), true);
  assert.equal(f.sends[0].binding, f.binding);
  assert.equal(f.api.store.get('activeSessionId'), 1);
});
['disconnect', 'owner', 'project', 'binding', 'document', 'window', 'pending', 'removed'].forEach(function (change) {
  test('Browser transport rejects a stale ' + change + ' source', function () {
    var f = fixture(); f.event();
    if (change === 'disconnect') f.api.store.set({ connected: false });
    if (change === 'owner') f.api.store.set({ myUserId: 'foreign' });
    if (change === 'project') f.api.store.set({ currentSlug: 'foreign' });
    if (change === 'binding') f.live.binding = Object.assign({}, f.binding, { generation: 2 });
    if (change === 'document') f.frame.contentDocument = {};
    if (change === 'window') f.frame.contentWindow = {};
    if (change === 'pending') f.frame.dataset.requestedSessionId = '3';
    if (change === 'removed') f.remove();
    assert.equal(f.api.sendBrowserPaneCommand('input', { event: { kind: 'click', x: 1, y: 1 } }), false);
    f.event(); assert.equal(f.received.length, 1); assert.equal(f.sends.length, 0);
  });
});
test('pane Browser commands use its real socket with a fixed field and operation allowlist', function () {
  var f = fixture(true);
  assert.equal(f.api.sendBoundBrowserCommand('control', { control: 'user', sessionId: 99, type: 'delete_session' }, f.binding), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.sends[0])), { type: 'shared_browser_control', sessionId: 2, paneBinding: f.binding, control: 'user' });
  assert.equal(f.api.sendBoundBrowserCommand('delete_session', {}, f.binding), false);
  assert.equal(f.api.sendBoundBrowserCommand('settings', { operation: 'clear' }, f.binding), false);
  assert.equal(f.api.sendBoundBrowserCommand('input', {}, Object.assign({}, f.binding, { generation: 2 })), false);
  f.api.store.set({ panePendingBinding: f.binding });
  assert.equal(f.api.sendBoundBrowserCommand('open', {}, f.binding), false);
  assert.equal(f.sends.length, 1);
});

test('opening Browser after selecting another pane uses that pane while a simple reopen retains the presented tab', function () {
  var f = fixture(), binding = Object.assign({}, f.binding, { sessionId: 3, sessionOriginId: 'origin-3', requestId: 'request-3' });
  var frame = { contentWindow: {}, contentDocument: {}, dataset: { sessionId: '3', sessionOriginId: 'origin-3' }, closest: function () { return null; } };
  frame.clayPane = { source: frame.contentWindow, document: frame.contentDocument, identity: function () {
    return { ready: true, sessionId: 3, ownerId: 'owner', projectSlug: 'demo', binding: binding };
  } };
  f.frames.push(frame);
  var sessions = [{ id: 2, ownerId: 'owner', sessionOriginId: 'origin-2' }, { id: 3, ownerId: 'owner', sessionOriginId: 'origin-3' }];
  var view = { id: 'view', activeSessionOriginId: 'origin-2', sessions: sessions };
  f.api.store.set({ paneBindingSessions: sessions, projectSplitViewSingletonOrigin: null, projectSplitViewActiveId: 'view', projectSplitViews: [view] });
  f.event();
  assert.equal(f.api.ensureBrowserPaneSource(), true); assert.equal(f.api.browserPaneSessionId(), 2);
  f.api.store.set({ projectSplitViews: [Object.assign({}, view, { activeSessionOriginId: 'origin-3' })] });
  assert.equal(f.api.ensureBrowserPaneSource(), true); assert.equal(f.api.browserPaneSessionId(), 3);
  f.api.store.set({ projectSplitViews: [view] });
  assert.equal(f.api.selectBrowserPane(frame, binding), true, 'a Browser chip deliberately selects its source');
  assert.equal(f.api.ensureBrowserPaneSource(), true); assert.equal(f.api.browserPaneSessionId(), 3);
  assert.equal(f.api.store.get('activeSessionId'), 1);
});
