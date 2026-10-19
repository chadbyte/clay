var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
// Actual store, retention, binding and Worker popover paths; inert DOM and no transport.
function fixture() {
  var socket = { readyState: 1, send: function () { sent++; } }, sent = 0, all = [], timer = 0, events = [];
  function element(tag) {
    var text = '', node = { tagName: tag, className: '', dataset: {}, style: {}, children: [], attrs: {}, hidden: false,
      listeners: {}, addEventListener: function (name, fn) { this.listeners[name] = fn; }, dispatchEvent: function () {}, CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
      setAttribute: function (key, value) { this.attrs[key] = value; },
      appendChild: function (child) { this.children.push(child); child.parentNode = this; return child; },
      insertBefore: function (child) { return this.appendChild(child); },
      remove: function () { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; },
      contains: function (child) { return child === this || this.children.some(function (item) { return item.contains(child); }); },
      focus: function () { document.activeElement = this; }, getBoundingClientRect: function () { return { left: 0, bottom: 20 }; },
      closest: function (selector) { return matches(this, selector) ? this : this.parentNode && this.parentNode.closest(selector); },
      querySelectorAll: function (selector) { return all.filter(function (item) { return item !== node && node.contains(item) && selector.split(',').some(function (part) { return matches(item, part.trim()); }); }); },
      querySelector: function (selector) { return this.querySelectorAll(selector)[0] || null; } };
    function matches(item, selector) {
      if (selector[0] === '.') return item.className.split(' ').includes(selector.slice(1));
      if (selector[0] === '[') return item.attrs['aria-label'] === 'Close Worker conversation';
      return item.tagName === selector;
    }
    node.classList = { contains: function (name) { return node.className.split(' ').includes(name); },
      add: function (name) { node.className += ' ' + name; }, remove: function (name) { node.className = node.className.split(' ').filter(function (entry) { return entry !== name; }).join(' '); } };
    Object.defineProperty(node, 'textContent', { get: function () { return text + node.children.map(function (child) { return child.textContent; }).join(''); }, set: function (value) { text = value; node.children.forEach(function (child) { child.parentNode = null; }); node.children = []; } });
    Object.defineProperty(node, 'isConnected', { get: function () { return node === document.body || !!node.parentNode && node.parentNode.isConnected; } });
    all.push(node); return node;
  }
  var document = { dispatchEvent: function (event) { events.push(event); }, addEventListener: function () {}, createElement: element, activeElement: null,
    getElementById: function (id) { return all.find(function (node) { return node.id === id && node.isConnected; }) || null; },
    querySelector: function (selector) { return selector.includes('split-pane[data-session-origin=') ? pane : null; } };
  document.body = element('body'); var host = element('div'); document.body.appendChild(host);
  var driver = { id: 1, sessionRole: 'driver', ownerId: 'owner', sessionOriginId: 'driver' };
  var workers = [2,3].map(function (id) { return { id: id, sessionRole: 'worker', ownerId: 'owner', sessionOriginId: 'worker-' + id, parentSessionId: 1, parentAvailable: true, workerGeneration: id }; });
  var sessions = [driver].concat(workers, [{ id: 4, sessionRole: 'driver', ownerId: 'owner', sessionOriginId: 'cached' }, { id: 5, sessionRole: 'worker', ownerId: 'owner', sessionOriginId: 'cached-worker', parentSessionId: 4, parentAvailable: true, workerGeneration: 1 }]);
  var context = vm.createContext({ document: document, window: { addEventListener: function () {}, innerWidth: 1000, innerHeight: 800 }, Event: function () {}, CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
    getWs: function () { return socket; }, getCachedSessions: function () { return sessions; }, CSS: { escape: function (value) { return value; } },
    setTimeout: function () { return ++timer; }, clearTimeout: function () {}, iconHtml: function () { return ''; }, refreshIcons: function () {},
    workerTranscriptRows: function () { return []; }, VENDOR_AVATARS: {}, VENDOR_NAMES: {} });
  ['store', 'pane-binding', 'split-pane-retention', 'split-group-helpers', 'split-view-worker-scroll', 'split-view-workers'].forEach(function (name) {
    vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, ''), context);
  });
  context.createStore({ connected: true, authIdentityLoaded: true, currentSlug: 'p', activeProjectSlug: 'p', sessionListProjectSlug: 'p', myUserId: 'owner', currentProjectOwnerId: 'owner',
    projectSplitViewSocketGeneration: 1, paneBindingSessions: sessions, projectSplitViewActiveId: 'view', projectSplitViews: [{ id: 'view', sessions: [driver] }],
    splitGroups: [{ id: 'pair', members: [1,2], pair: { version: 2, driverId: 1, workerIds: [2] } }, { id: 'cached-pair', members: [4,5], pair: { version: 2, driverId: 4, workerIds: [5] } }] });
  function makePane(session) {
    var node = element('section'); node.className = 'split-pane'; var header = element('header'); header.className = 'split-pane-header'; node.appendChild(header);
    var frame = element('iframe'); frame.className = 'split-pane-frame'; frame.dataset = { projectSlug: 'p', sessionId: String(session.id), sessionOriginId: session.sessionOriginId };
    frame.contentWindow = {}; frame.contentDocument = {}; var ready = true;
    var binding = Object.assign(context.paneTarget(context.store.snap(), sessions, session.id), { generation: 1, requestId: 'initial' });
    frame.clayPane = { source: frame.contentWindow, document: frame.contentDocument, identity: function () { return { ready: ready, binding: binding, sessionId: session.id, ownerId: 'owner', projectSlug: 'p' }; }, suspend: function () { ready = false; } };
    node.appendChild(frame); host.appendChild(node); return node;
  }
  var pane = makePane(driver), cached = makePane(sessions[3]), policy = context.paneRetention(host);
  policy.remember(pane, { sessionId: 1 }); policy.remember(cached, { sessionId: 4 }); policy.park(cached);
  context.renderPaneWorkers(pane, driver);
  return { context: context, pane: pane, cached: cached, host: host, document: document, policy: policy, events: events, sessions: sessions,
    socket: function (next) { socket = next; }, sends: function () { return sent; },
    throwing: { readyState: 1, send: function () { sent++; throw new Error('fixture send failed'); } },
    click: function (index) { pane.querySelectorAll('.split-view-worker-chip')[index].listeners.click(); } };
}
[0,1].forEach(function (index) {
  test('retained current/archive Worker chip ' + index + ' preserves missing and throwing transport feedback', function () {
    var f = fixture(); f.socket(null); f.click(index);
    assert.match(f.document.getElementById('split-view-worker-popover').textContent, /disconnected/);
    assert.equal(f.pane.isConnected, true); assert.equal(f.cached.isConnected, false);
    assert.equal(f.policy.retain(f.pane), false, 'transport change invalidates warm receipt');
    f.context.close(false); f.socket(f.throwing); f.click(index);
    assert.match(f.document.getElementById('split-view-worker-popover').textContent, /could not be sent/); assert.equal(f.sends(), 1);
  });
});
test('actual disconnect keeps the read-only error, suspends child authority and rejects queued replies and retry sends', function () {
  var f = fixture(); f.click(0); var pending = f.context.store.get('splitViewWorkerConversation');
  f.context.store.set({ connected: false });
  assert.match(f.document.getElementById('split-view-worker-popover').textContent, /connection was lost/);
  assert.equal(f.cached.isConnected, false); assert.equal(f.pane.isConnected, true);
  f.pane.querySelector('.split-pane-frame').clayPane.identity = function () { return null; };
  f.context.renderContent();
  f.context.renderPaneWorkers(f.pane, f.context.exactDriver('driver'));
  assert.match(f.document.getElementById('split-view-worker-popover').textContent, /connection was lost/, 'child disconnect may clear its committed binding');
  assert.equal(f.context.livePaneBinding(f.pane.querySelector('.split-pane-frame')), false);
  assert.equal(f.context.presentationSource(f.pane, { id: 1, sessionOriginId: 'driver' }), null);
  f.context.requestPage(f.context.store.get('splitViewWorkerConversation'), undefined, false);
  assert.equal(f.sends(), 1, 'retry while disconnected sends nothing beyond the initial request');
  assert.equal(f.context.handleSplitWorkerConversation({ type: 'split_worker_conversation', requestId: pending.requestId }), false);
  f.context.store.set({ connected: true });
  assert.equal(!!f.context.livePaneBinding(f.pane.querySelector('.split-pane-frame')), false, 'fresh connection alone cannot revive old binding');
});


test('revoking and restoring pair metadata preserves active Driver identity while invalidating cache and stale Controls', function () {
  var f = fixture(), pane = f.pane, frame = pane.querySelector('.split-pane-frame'), doc = frame.contentDocument;
  var controls = pane.querySelector('.split-view-worker-controls'), groups = f.context.store.get('splitGroups');
  assert.ok(controls);
  var event = { preventDefault: function () {}, stopPropagation: function () {} };
  f.context.store.set({ splitGroups: [] });
  controls.listeners.click(event);
  assert.equal(f.events.length, 0, 'captured Controls must refuse the revoked execution group');
  assert.equal(f.cached.isConnected, false, 'hidden Driver with changed group metadata is evicted');
  assert.equal(pane.isConnected, true); assert.equal(frame.contentDocument, doc);
  assert.equal(!!f.context.livePaneBinding(frame), false, 'old execution stamp grants no current parent authority');
  assert.equal(f.policy.retain(pane), false);
  f.context.store.set({ splitGroups: groups });
  assert.equal(f.pane, pane); assert.equal(pane.querySelector('.split-pane-frame'), frame); assert.equal(frame.contentDocument, doc);
  var restored = pane.querySelector('.split-view-worker-controls');
  assert.ok(restored); restored.listeners.click(event);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].type, 'clay-split-view-open-worker-controls');
  assert.equal(f.events[0].detail.driverOriginId, 'driver'); assert.equal(f.events[0].detail.groupId, 'pair');
  assert.equal(f.policy.retain(pane), false, 'metadata restoration does not silently renew warm eligibility');
});

[function (f) { f.sessions[0].ownerId = 'foreign'; }, function (f) { f.sessions[0].sessionOriginId = 'replacement'; },
  function (f) { f.sessions[0].sessionRole = 'worker'; }, function (f) { f.sessions[0].hidden = true; },
  function (f) { f.sessions.shift(); }].forEach(function (change, index) {
  test('active conversation security change ' + index + ' still evicts and refuses captured Controls', function () {
    var f = fixture(), controls = f.pane.querySelector('.split-view-worker-controls'); change(f);
    f.context.store.set({ paneBindingSessions: f.sessions.slice() });
    assert.equal(f.pane.isConnected, false);
    controls.listeners.click({ preventDefault: function () {}, stopPropagation: function () {} });
    assert.equal(f.events.length, 0);
  });
});

['hidden', 'owner', 'membership'].forEach(function (boundary) {
  test('pending Worker read and captured Controls refuse ' + boundary + ' transition with retention present', function () {
    var f = fixture(), controls = f.pane.querySelector('.split-view-worker-controls');
    f.click(0); var pending = f.context.store.get('splitViewWorkerConversation');
    if (boundary === 'owner') f.context.store.set({ myUserId: 'replacement-owner' });
    else {
      if (boundary === 'hidden') f.policy.park(f.pane);
      f.context.store.set({ projectSplitViewActiveId: null, projectSplitViewSingletonOrigin: 'cached' });
    }
    assert.equal(f.context.store.get('splitViewWorkerConversation'), null);
    assert.equal(f.document.getElementById('split-view-worker-popover'), null);
    var late = { type: 'split_worker_conversation', requestId: pending.requestId,
      parentSessionOriginId: pending.driverOriginId, workerSessionOriginId: pending.workerOriginId, generation: pending.generation,
      messages: [{ role: 'assistant', text: 'late source reply' }] };
    assert.equal(f.context.handleSplitWorkerConversation(late), false);
    controls.listeners.click({ preventDefault: function () {}, stopPropagation: function () {} });
    assert.equal(f.events.length, 0);
    if (boundary === 'owner') assert.equal(f.pane.isConnected, false);
  });
});
