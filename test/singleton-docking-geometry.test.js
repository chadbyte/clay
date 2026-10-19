var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(baseline) {
  var messages = [], callbacks = [], events = {}, resizeCallback;
  var session = { id: 1, sessionOriginId: 'origin', ownerId: 'owner', sessionRole: 'driver' };
  var transcript = { scrollTop: 173, isConnected: true, addEventListener: function () {} };
  var doc = { getElementById: function () { return transcript; }, draft: 'unsent draft' };
  var contentWindow = { postMessage: function (message) { messages.push(message); } };
  var binding = { projectSlug: 'p', viewerId: 'owner', ownerId: 'owner', sessionId: 1, sessionOriginId: 'origin', role: 'driver', workerGeneration: null,
    parentSessionOriginId: null, groupStamp: null, generation: 3, requestId: 'request' };
  var live = { ready: true, ownerId: 'owner', projectSlug: 'p', sessionId: 1, binding: binding };
  var frame = { dataset: { sessionId: '1', sessionOriginId: 'origin' }, isConnected: true, contentDocument: doc, contentWindow: contentWindow,
    clayPane: { source: contentWindow, document: doc, identity: function () { return live; } } };
  var pane = { hidden: false, style: { width: '953px' }, dataset: {}, querySelector: function (selector) { return selector === '.split-pane-frame' ? frame : null; } };
  var classes = new Set(['visible', 'split-view-canvas']);
  var host = { hidden: false, isConnected: true, clientWidth: 953, clientHeight: 753, dataset: { singlePane: 'true' },
    classList: { contains: function (name) { return classes.has(name); } }, querySelectorAll: function (selector) {
      if (selector === ':scope > .split-pane > .split-pane-frame') return [frame];
      if (selector === ':scope > .split-pane') return [pane]; return [];
    } };
  var context = vm.createContext({ getCachedSessions: function () { return [session]; }, getWs: function () {},
    document: { activeElement: null, getElementById: function () { return null; }, addEventListener: function () {} },
    window: { location: { origin: 'http://fixture' }, getComputedStyle: function () { return {}; }, addEventListener: function (name, callback) { events[name] = callback; }, requestAnimationFrame: function (callback) { callbacks.push(callback); } },
    ResizeObserver: function (callback) { resizeCallback = callback; this.observe = function () {}; } });
  ['store', 'split-view-singleton', 'pane-binding', 'split-view-layout-client', 'split-view-presentation-renderer'].forEach(function (name) {
    var source = fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export \{.*$/gm, '').replace(/^export /gm, '');
    if (baseline && name === 'split-view-presentation-renderer') source = source.replace(/function renderCurrentGeometry\(\) \{[\s\S]*?\n\}\n\nfunction applyGeometry/, 'function renderCurrentGeometry() { var view = currentView(), tree = activeTree(); if (view && tree) applyGeometry(view, tree); }\n\nfunction applyGeometry');
    vm.runInContext(source, context);
  });
  context.ensureArrangeMenu = function () {}; context.ensureArrangeTrigger = function () {}; context.ensureDropPreview = function () {};
  var saved = [{ id: 'saved', tree: { axis: 'horizontal', ratio: 0.31, left: { id: 'other' }, right: { id: 'third' } } }];
  context.createStore({ currentSlug: 'p', activeProjectSlug: 'p', sessionListProjectSlug: 'p', myUserId: 'owner', currentProjectOwnerId: 'owner',
    connected: true, authIdentityLoaded: true, projectSplitViewSocketGeneration: 2, projectSplitViewContextKey: 'p|owner|owner|2',
    activeSessionId: 1, paneBindingSessions: [session], projectSplitViews: saved, projectSplitViewActiveId: null, projectSplitViewSingletonOrigin: 'origin' });
  context.initPresentationRenderer(host);
  return { context: context, host: host, pane: pane, frame: frame, doc: doc, transcript: transcript, live: live, session: session, messages: messages, saved: saved,
    observer: function () { resizeCallback(); }, resize: function () { events.resize(); }, flush: function () { callbacks.splice(0).forEach(function (fn) { fn(); }); } };
}
test('reproduces old singleton resize omission and fixes 1024/1280 docking/close geometry without remount', function () {
  var old = fixture(true); old.host.clientWidth = 500; old.observer(); assert.equal(old.pane.style.width, '953px');
  [1024, 1280].forEach(function (viewport) {
    var f = fixture(), frame = f.frame, doc = f.doc, binding = f.live.binding, saved = JSON.stringify(f.saved);
    [viewport - 327, viewport - 327 - 400, viewport - 327, viewport - 327 - 300, viewport - 327].forEach(function (width, index) {
      f.host.clientWidth = width; if (index % 2) f.resize(); else f.observer(); f.flush();
      assert.equal(f.pane.style.width, width + 'px'); assert.equal(f.pane.style.height, '753px');
      assert.equal(f.frame, frame); assert.equal(f.frame.contentDocument, doc); assert.equal(f.live.binding, binding);
      assert.equal(doc.draft, 'unsent draft'); assert.equal(f.transcript.scrollTop, 173);
      assert.equal(JSON.stringify(f.context.store.get('projectSplitViews')), saved);
      assert.equal(f.context.store.get('projectSplitViewActiveId'), null);
    });
    assert.equal(f.messages.length, 10);
    for (var i = 0; i < f.messages.length; i += 2) {
      assert.equal(f.messages[i].phase, 'begin'); assert.equal(f.messages[i + 1].phase, 'end');
      assert.equal(f.messages[i].token, f.messages[i + 1].token); assert.equal(f.messages[i].paneBinding, binding);
    }
  });
});
test('singleton resize refuses hidden, legacy, DM, stale context, foreign frame and replaced source', function () {
  var changes = [function (f) { f.host.hidden = true; }, function (f) { f.pane.hidden = true; },
    function (f) { f.context.store.set({ dmMode: true }); }, function (f) { f.context.store.set({ splitPanes: {} }); },
    function (f) { f.context.store.set({ projectSplitViewContextKey: 'stale' }); }, function (f) { f.context.store.set({ activeSessionId: 2 }); },
    function (f) { f.frame.dataset.sessionOriginId = 'foreign'; }, function (f) { f.live.ownerId = 'foreign'; },
    function (f) { f.frame.clayPane.source = {}; }, function (f) { f.context.store.set({ connected: false }); }];
  changes.forEach(function (change) { var f = fixture(); change(f); f.host.clientWidth = 500; f.observer(); f.flush(); assert.equal(f.pane.style.width, '953px'); assert.equal(f.messages.length, 0); });
});
test('queued singleton resize completion rejects changed binding and active context', function () {
  [function (f) { f.context.store.set({ activeSessionId: 2 }); }, function (f) { f.live.binding = Object.assign({}, f.live.binding, { generation: 4 }); }].forEach(function (change) {
    var f = fixture(); f.host.clientWidth = 500; f.observer(); assert.equal(f.messages.length, 1); change(f); f.flush(); assert.equal(f.messages.length, 1);
  });
});
