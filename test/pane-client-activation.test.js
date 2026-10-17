var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(frameData) {
  var sent = [], paints = [], events = [], timer = 0, taken = [], restored = [];
  var input = { value: 'Draft A', selectionStart: 2, selectionEnd: 5, selectionDirection: 'backward', setSelectionRange: function (a, b, direction) { this.selectionStart = a; this.selectionEnd = b; this.selectionDirection = direction; } };
  var messages = { dataset: { controlSessionId: '1', controlSessionOrigin: 'origin-1' } }, app = { inert: false };
  var groups = [{ id: 'pair-a', members: [1, 2], pair: { driverId: 1, workerId: 2 } }, { id: 'pair-b', members: [3, 4], pair: { driverId: 3, workerId: 4 } }];
  var sessions = [1, 2, 3, 4, 5].map(function (id) { return { id: id, ownerId: 'owner', sessionOriginId: 'origin-' + id, sessionRole: id % 2 === 0 ? 'worker' : 'driver', parentSessionId: id % 2 === 0 ? id - 1 : null, parentAvailable: true, workerGeneration: id % 2 === 0 ? 1 : null, mode: 'gui' }; });
  var frame = { dataset: frameData || {}, dispatchEvent: function (event) { events.push(event.type); } };
  var listeners = {}, context = vm.createContext({
    URL: URL, URLSearchParams: URLSearchParams, location: { pathname: '/p/reuse/', search: '?pane=1&session=1', origin: 'https://fixture' },
    document: { documentElement: { dataset: {} }, getElementById: function (id) { return id === 'app' ? app : id === 'messages' ? messages : input; }, addEventListener: function (name, fn) { listeners[name] = fn; } },
    window: { frameElement: frame, parent: { CustomEvent: function (type) { this.type = type; } } },
    getCachedSessions: function () { return sessions; }, getWs: function () { return socket; },
    requestAnimationFrame: function (fn) { paints.push(fn); }, queueMicrotask: function () {}, setTimeout: function () { return ++timer; }, clearTimeout: function () {},
    ctx: { inputEl: input }, uploadingCount: 0, pendingImages: [{ data: 'image' }], pendingPastes: [{ text: 'paste' }], pendingFiles: [{ path: 'file' }], scheduleDelayMs: 120000,
    hasRecordedSpeechFor: function () { return false; }, autoResize: function () {}, renderInputPreviews: function () {},
    updateContextPanel: function () {},
    clearPendingImages: function () { context.pendingImages = []; context.pendingPastes = []; context.pendingFiles = []; },
    clearScheduleDelay: function () { context.scheduleDelayMs = 0; }, setScheduleDelayMs: function (value) { context.scheduleDelayMs = value; },
    resetHistoryReplayBatch: function () { context.store.set({ historyReplayBatch: null, replayingHistory: false }); },
  });
  ['store', 'pane-binding', 'pane-activation'].forEach(function (name) {
    var source = fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context, { filename: name });
  });
  var inputSource = fs.readFileSync('lib/public/modules/input.js', 'utf8');
  vm.runInContext(inputSource.slice(inputSource.indexOf('export function composerDepartureReason'), inputSource.indexOf('export function clearPendingImages')).replace(/export /g, ''), context);
  var socket = { readyState: 1, send: function (data) { sent.push(JSON.parse(data)); } };
  context.store.set({ paneMode: true, currentSlug: 'reuse', myUserId: 'owner', connected: true, splitGroups: groups, splitGroupsProjectSlug: 'reuse',
    paneSessionId: 1, activeSessionId: 1, sessionOriginId: 'origin-1', wsPath: '/p/reuse/ws?pane=1&session=1', paneRichDrafts: {} });
  context.initPaneActivation();
  function receive(type, binding, extra) {
    var message = Object.assign({ type: type, paneActivation: binding }, extra);
    if (context.filterPaneActivation(message)) return false;
    if (type === 'session_switched') { context.store.set({ activeSessionId: binding.sessionId, sessionOriginId: binding.sessionOriginId }); input.value = ''; }
    if (type === 'history_done') { messages.dataset.controlSessionId = String(binding.sessionId); messages.dataset.controlSessionOrigin = binding.sessionOriginId; }
    return true;
  }
  function complete(binding) {
    receive('session_switched', binding); receive('history_done', binding); receive('pane_activation_snapshot_done', binding);
    while (paints.length) paints.shift()();
  }
  return { context: context, store: context.store, sent: sent, input: input, app: app, sessions: sessions, groups: groups,
    receive: receive, complete: complete, frame: frame, events: events, listeners: listeners, socket: socket };
}

test('rapid A/B/C rejects stale histories before replay and binds readiness/pin/reconnect to C', function () {
  var f = fixture();
  assert.equal(f.context.activatePaneSession(1), true); var a = f.sent[0].paneActivation; f.complete(a);
  assert.equal(f.context.activatePaneSession(3), true); var b = f.sent[1].paneActivation;
  assert.equal(f.context.activatePaneSession(5), true); var c = f.sent[2].paneActivation;
  ['session_switched', 'history_meta', 'delta', 'history_done', 'pane_activation_snapshot_done'].forEach(function (type) {
    assert.equal(f.receive(type, a), false); assert.equal(f.receive(type, b), false);
  });
  assert.equal(f.store.get('paneReady'), false); assert.equal(f.app.inert, true);
  f.complete(c);
  assert.equal(f.store.get('paneReady'), true); assert.equal(f.store.get('activeSessionId'), 5);
  assert.equal(f.store.get('paneSessionId'), 5); assert.equal(f.store.get('wsPath'), '/p/reuse/ws?pane=1&session=5');
  assert.equal(f.app.inert, false); assert.equal(JSON.stringify(f.frame.clayPane.identity().binding), JSON.stringify(c));
});

test('rich composer draft uses production handoff and survives retarget/return with selection and schedule', function () {
  var f = fixture(); f.context.activatePaneSession(1); f.complete(f.sent[0].paneActivation);
  f.context.activatePaneSession(3); f.complete(f.sent[1].paneActivation);
  f.input.value = 'Draft B'; f.context.pendingFiles = [{ path: 'b-file' }];
  f.context.activatePaneSession(1); f.complete(f.sent[2].paneActivation);
  assert.equal(f.input.value, 'Draft A'); assert.equal(f.input.selectionStart, 2); assert.equal(f.input.selectionEnd, 5);
  assert.equal(f.input.selectionDirection, 'backward'); assert.equal(f.context.scheduleDelayMs, 120000);
  assert.equal(f.context.pendingImages[0].data, 'image'); assert.equal(f.context.pendingPastes[0].text, 'paste'); assert.equal(f.context.pendingFiles[0].path, 'file');
  f.context.activatePaneSession(3); f.complete(f.sent[3].paneActivation);
  assert.equal(f.input.value, 'Draft B'); assert.equal(f.context.pendingFiles[0].path, 'b-file');
});

test('pending upload or recording refuses departure without clearing the draft', function () {
  var f = fixture(); f.context.uploadingCount = 1;
  assert.equal(f.context.activatePaneSession(3), false); assert.equal(f.input.value, 'Draft A'); assert.equal(f.sent.length, 0);
  f.context.uploadingCount = 0; f.store.set({ speechActive: true });
  assert.equal(f.context.activatePaneSession(3), false); assert.equal(f.sent.length, 0);
});

test('Stop and reviews retain exact binding and hidden shells cannot forward actions', function () {
  var f = fixture(); f.context.activatePaneSession(1); var a = f.sent[0].paneActivation; f.complete(a);
  var review = { paneBinding: a, isConnected: true };
  assert.equal(f.context.currentPaneReview(review), true);
  f.context.activatePaneSession(3); var b = f.sent[1].paneActivation;
  assert.equal(f.context.paneOutgoing(JSON.stringify({ type: 'stop' })), null);
  assert.equal(f.context.currentPaneReview(review), false);
  f.complete(b);
  assert.equal(f.context.paneOutgoing(JSON.stringify({ type: 'stop', paneBinding: a })), null);
  assert.equal(f.context.paneOutgoing(JSON.stringify({ type: 'stop' })), null, 'an unbound callback has no action authority');
  f.store.set({ paneCallbackBinding: b });
  assert.equal(JSON.parse(f.context.paneOutgoing(JSON.stringify({ type: 'stop' }))).paneBinding.sessionId, 3);
  f.frame.clayPane.suspend();
  assert.equal(f.context.paneOutgoing(JSON.stringify({ type: 'permission_response', requestId: 'old' })), null);
  assert.equal(f.frame.clayPane.identity().ready, false);
});

test('actual promise callbacks capture their creation binding; pending actions and held keys cannot migrate', async function () {
  var f = fixture(); f.context.activatePaneSession(1); var a = f.sent[0].paneActivation; f.complete(a);
  var release, effects = [];
  var old = new Promise(function (resolve) { release = resolve; }).then(f.context.sessionCallback(function () {
    effects.push('old callback ran'); f.input.value = 'Wrong destination';
  }));
  var rawRelease, outgoing;
  var raw = new Promise(function (resolve) { rawRelease = resolve; }).then(function () {
    outgoing = f.context.paneOutgoing(JSON.stringify({ type: 'set_model', model: 'old' }));
  });
  f.context.activatePaneSession(3); var b = f.sent[1].paneActivation;
  ['set_model', 'set_effort', 'rename_session', 'set_permission_mode', 'user_message', 'input_sync', 'user_dialog_response'].forEach(function (type) {
    assert.equal(f.context.paneOutgoing(JSON.stringify({ type: type })), null, type + ' refused during pending replay');
  });
  f.complete(b); f.input.value = 'Destination draft'; release(); rawRelease(); await Promise.all([old, raw]);
  assert.deepEqual(effects, []); assert.equal(outgoing, null); assert.equal(f.input.value, 'Destination draft');
  var current;
  await Promise.resolve().then(f.context.sessionCallback(function () { current = f.context.paneOutgoing(JSON.stringify({ type: 'set_model', model: 'current' })); }));
  assert.equal(JSON.parse(current).paneBinding.sessionId, 3, 'a current captured callback still works');
  f.store.set({ paneHeldKeys: { Space: a } });
  var prevented = false;
  f.listeners.keyup({ code: 'Space', eventPhase: 1, preventDefault: function () { prevented = true; }, stopImmediatePropagation: function () {} });
  assert.equal(prevented, true, 'keyup begun on A cannot activate a button on B');
});

test('rejection, group replacement and disconnect cannot publish false readiness', function () {
  var f = fixture(); f.context.activatePaneSession(3); var binding = f.sent[0].paneActivation;
  f.receive('pane_activation_rejected', null, { requestId: binding.requestId });
  assert.equal(f.store.get('panePendingBinding'), null); assert.equal(f.store.get('paneReady'), false);
  assert.ok(f.events.includes('clay-pane-activation-failed'));
  f.context.activatePaneSession(3); binding = f.sent[1].paneActivation;
  f.groups[1].members = [3, 2]; f.complete(binding);
  assert.equal(f.store.get('paneReady'), false);
  f.store.set({ connected: false }); assert.equal(f.store.get('paneCommittedBinding'), null);
  assert.equal(f.store.get('paneSessionId'), 3, 'reconnect retains the latest requested target');
});

test('native standalone and native pair anchor switches preserve the complete composer draft', function () {
  var f = fixture();
  var source = fs.readFileSync('lib/public/modules/session-rich-drafts.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, f.context);
  f.context.saveSessionRichDraft();
  assert.equal(f.input.value, 'Draft A', 'saving does not disrupt the outgoing composer');
  f.store.set({ activeSessionId: 5, sessionOriginId: 'origin-5' });
  f.input.value = 'Standalone draft'; f.context.pendingImages = []; f.context.pendingFiles = [{ path: 'native-file' }];
  f.context.saveSessionRichDraft();
  f.store.set({ activeSessionId: 1, sessionOriginId: 'origin-1' }); f.context.restoreSessionRichDraft();
  assert.equal(f.input.value, 'Draft A'); assert.equal(f.input.selectionDirection, 'backward');
  assert.equal(f.context.pendingImages[0].data, 'image'); assert.equal(f.context.scheduleDelayMs, 120000);
  f.store.set({ activeSessionId: 5, sessionOriginId: 'origin-5' }); f.context.restoreSessionRichDraft();
  assert.equal(f.input.value, 'Standalone draft'); assert.equal(f.context.pendingFiles[0].path, 'native-file');
});

test('a fresh pane document restores the latest parent pin rather than its original iframe URL', function () {
  var f = fixture({ projectSlug: 'reuse', sessionId: '3', sessionOriginId: 'origin-3' });
  assert.equal(f.store.get('paneSessionId'), 3);
  assert.equal(f.store.get('wsPath'), '/p/reuse/ws?pane=1&session=3');
  assert.equal(f.context.activatePaneSession(3), true); f.complete(f.sent[0].paneActivation);
  assert.equal(f.frame.clayPane.identity().sessionId, 3);
  var replaced = fixture({ projectSlug: 'reuse', sessionId: '3', sessionOriginId: 'removed-origin' });
  assert.equal(replaced.context.activatePaneSession(3), false, 'a replacement origin cannot silently inherit the old pane');
});


test('initial ordinary pins wait for identity and group metadata without a legacy switch', function () {
  var f = fixture();
  f.store.set({ paneSessionId: 2, panePinPending: true, activeSessionId: null, sessionOriginId: null,
    authIdentityLoaded: false, splitGroupsProjectSlug: null });
  assert.equal(f.context.primePaneSession(), true);
  assert.equal(f.sent.length, 0);
  f.store.set({ authIdentityLoaded: true });
  assert.equal(f.context.primePaneSession(), true);
  assert.equal(f.sent.length, 0, 'identity alone is insufficient');
  f.store.set({ splitGroupsProjectSlug: 'reuse' });
  assert.equal(f.context.primePaneSession(), true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].paneActivation.role, 'worker');
  assert.equal(f.sent[0].paneActivation.sessionId, 2);
  assert.equal(f.store.get('panePinPending'), false);
  assert.equal(f.context.primePaneSession(), true);
  assert.equal(f.sent.length, 1, 'repeated metadata does not replay the pin');
  f.complete(f.sent[0].paneActivation);
  assert.equal(f.store.get('paneReady'), true);
});

test('initial TUI and private Mate panes keep their existing cold fallback', function () {
  var f = fixture();
  f.sessions[0].mode = 'tui';
  assert.equal(f.context.primePaneSession(), false);
  f.sessions[0].mode = 'gui';
  f.store.set({ activeProjectMateId: 'private-mate' });
  assert.equal(f.context.primePaneSession(), false);
  assert.equal(f.sent.length, 0);
});
