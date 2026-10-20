var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

// Run the actual store, sidebar capture handler, pane renderer and reconciler.
// Browser frames are inert DOM objects: no storage, socket transport or provider starts.
function fixture() {
  var nodes = [], frames = [], listeners = {}, sent = [], sourceAssignments = 0, scheduled = [], resizeObservers = new Set(), windowListeners = new Set(), liveSubscriptions = 0;
  function element(tag) {
    var node = { tagName: tag, className: '', dataset: {}, style: { removeProperty: function (key) { delete this[key]; }, setProperty: function (key, value) { this[key] = value; } }, children: [], parentNode: null,
      listeners: {}, attributes: {}, addEventListener: function (name, fn) {
        var callbacks = this.listeners[name] && this.listeners[name].callbacks || []; callbacks.push(fn);
        var invoke = function (event) { callbacks.slice().forEach(function (listener) { listener(event); }); }; invoke.callbacks = callbacks; this.listeners[name] = invoke;
      }, setAttribute: function (name, value) { this.attributes[name] = String(value); }, getAttribute: function (name) { return this.attributes[name] || null; },
      focusCount: 0, focus: function () { this.focusCount++; }, select: function () {}, isConnected: true, getBoundingClientRect: function () { return tag === 'header' ? { top: 10, bottom: 43 } : { top: 10, bottom: 700 }; },
      closest: function (selector) { var item = this; while (item) { if (selector.charAt(0) === '.' && item.className.split(' ').indexOf(selector.slice(1)) >= 0) return item; item = item.parentNode; } return null; },
      dispatchEvent: function (event) { if (this.listeners[event.type]) this.listeners[event.type](event); },
      removeEventListener: function (type, fn) { var callbacks = this.listeners[type] && this.listeners[type].callbacks; if (!callbacks) return; var index = callbacks.indexOf(fn); if (index >= 0) callbacks.splice(index, 1); if (!callbacks.length) delete this.listeners[type]; },
      appendChild: function (child) { if (child.parentNode) child.remove(); this.children.push(child); child.parentNode = this; return child; },
      insertBefore: function (child, anchor) {
        if (child.parentNode) child.remove();
        var index = this.children.indexOf(anchor);
        this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this;
      },
      prepend: function (child) { this.insertBefore(child, this.children[0] || null); },
      remove: function () { if (!this.parentNode) return; var siblings = this.parentNode.children; siblings.splice(siblings.indexOf(this), 1); this.parentNode = null; },
      querySelectorAll: function (selector) {
        var result = [];
        this.children.forEach(function walk(child) {
          if (selector.split(',').some(function (part) { return child.className.split(' ').indexOf(part.trim().slice(1)) >= 0; })) result.push(child);
          child.children.forEach(walk);
        });
        return result;
      },
      querySelector: function (selector) { return this.querySelectorAll(selector)[0] || null; },
    };
    node.classList = {
      add: function (name) { if (node.className.split(' ').indexOf(name) < 0) node.className += ' ' + name; },
      remove: function () { var names = Array.from(arguments); node.className = node.className.split(' ').filter(function (value) { return names.indexOf(value) < 0; }).join(' '); },
      contains: function (name) { return node.className.split(' ').indexOf(name) >= 0; },
      toggle: function (name, enabled) { var next = arguments.length > 1 ? !!enabled : !this.contains(name); if (next) this.add(name); else this.remove(name); return next; },
    };
    Object.defineProperty(node, 'innerHTML', { set: function () { node.children.forEach(function (child) { child.parentNode = null; }); node.children = []; } });
    if (tag === 'iframe') {
      var src = '';
      node.contentWindow = { socket: {}, draft: 'Unsent draft', pendingQuestion: {}, stop: function () { sent.push({ type: 'stop' }); }, postMessage: function (message) { sent.push({ type: 'pane-search', frame: node, message: message }); } };
      node.contentDocument = {};
      Object.defineProperty(node, 'src', { get: function () { return src; }, set: function (value) { sourceAssignments++; src = value; } });
      frames.push(node);
    }
    nodes.push(node); return node;
  }
  var main = element('main'); main.id = 'main-panels';
  var topBarPills = element('div'); topBarPills.className = 'top-bar-left-pills';
  var layout = element('div'); layout.id = 'layout';
  var app = element('div'); app.id = 'app'; main.appendChild(app);
  var groups = [
    { id: 'pair-a', members: [121, 135], pair: { version: 2, driverId: 121, workerIds: [135] } },
    { id: 'pair-b', members: [200, 201], pair: { driverId: 200, workerId: 201 } },
  ];
  var sessions = [
    { id: 121, sessionRole: 'driver' }, { id: 135, sessionRole: 'worker', parentAvailable: true, parentSessionId: 121 },
    { id: 200, sessionRole: 'driver' }, { id: 201, sessionRole: 'worker', parentAvailable: true, parentSessionId: 200 },
    { id: 300, sessionRole: 'driver' },
  ];
  sessions.forEach(function (session) { session.ownerId = 'owner'; session.sessionOriginId = 'origin-' + session.id; if (session.sessionRole === 'worker') session.workerGeneration = 1; });
  var socket = { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } };
  var context = vm.createContext({
    Event: function (type) { this.type = type; }, queueMicrotask: function () {}, setTimeout: setTimeout, clearTimeout: clearTimeout,
    document: { createElement: element, querySelector: function (selector) { return selector === '#top-bar .top-bar-left-pills' ? topBarPills : null; },
      querySelectorAll: function (selector) { return selector.indexOf('sidebar-shell-expand-btn') >= 0 ? nodes.filter(function (node) { return node.id === 'sidebar-shell-expand-btn'; }) : []; },
      getElementById: function (id) { return nodes.find(function (node) { return node.id === id; }) || (id === 'layout' ? layout : null); },
      addEventListener: function (name, fn) { listeners[name] = fn; } },
    window: { addEventListener: function (name, fn) { windowListeners.add(fn); }, removeEventListener: function (name, fn) { windowListeners.delete(fn); }, matchMedia: function () { return { matches: true }; }, location: { origin: 'http://clay.test' } },
    ResizeObserver: function () { var observer = this; this.observe = function () { resizeObservers.add(observer); }; this.disconnect = function () { resizeObservers.delete(observer); }; },
    setTimeout: function (fn) { var timer = { fn: fn, cancelled: false }; scheduled.push(timer); return timer; },
    clearTimeout: function (timer) { if (timer) timer.cancelled = true; },
    getWs: function () { return socket; }, getCachedSessions: function () { return sessions; },
    initSplitViewPresentations: function () {}, renderPresentationSplitView: function () {},
    currentSingletonPresentation: function () { return null; },
    renderPaneWorkers: function () {},
    detachTuiView: function () {}, refreshIcons: function () {}, syncPairChrome: function () {}, clearPanePairChrome: function () {}, iconHtml: function () { return ''; },
    checkComposerDeparture: function () {}, showToast: function () {},
    VENDOR_AVATARS: { claude: '/fixture.svg' }, VENDOR_NAMES: { claude: 'Claude' },
    createPermissionControl: function (className) { var button = element('button'); button.className = className; return button; },
    bindPermissionControl: function () {}, renderPermissionControl: function () {},
  });
  ['store', 'pane-binding', 'project-activation', 'split-session-boundary', 'split-group-helpers', 'split-pane-reconciler', 'split-pane-retention', 'split-pane-header-state', 'split-pane-renderer', 'split-group-restore', 'split-view-worker-controls', 'sidebar', 'split-view-shell-controls', 'split-view', 'split-view-presentation-renderer'].forEach(function (name) {
    var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/' + name + '.js'), 'utf8')
      .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context, { filename: name + '.js' });
  });
  var chrome = fs.readFileSync(path.join(__dirname, '../lib/public/modules/split-pair-ui.js'), 'utf8');
  vm.runInContext(chrome.slice(chrome.indexOf('export function clearPanePairChrome')).replace(/^export /gm, ''), context);
  context.createStore({ myUserId: 'owner', currentSlug: 'clay', activeProjectSlug: 'clay', connected: true, activeSessionId: 121,
    paneBindingSessions: sessions,
    wsPath: '/p/clay/ws', socketPath: '/p/clay/ws', sessionActivatedProjectSlug: 'clay',
    sessionListProjectSlug: 'clay', splitGroupsProjectSlug: 'clay', splitGroups: groups, splitPanes: null });
  var baseSubscribe = context.store.subscribe;
  context.store.subscribe = function (listener) {
    liveSubscriptions++;
    var unsubscribe = baseSubscribe(listener);
    return function () { liveSubscriptions--; unsubscribe(); };
  };
  context.initSplitView();
  var initialLifecycle = { observers: resizeObservers.size, windowListeners: windowListeners.size, subscriptions: liveSubscriptions };
  context.openGroup(groups[0]); sent.length = 0;
  function click(id, control) {
    var row = { dataset: { sessionId: String(id) } };
    listeners.click({ button: 0, target: { closest: function (selector) { return selector.indexOf('.session-close-btn') >= 0 ? (control ? row : null) : row; } },
      preventDefault: function () {}, stopImmediatePropagation: function () {} });
  }
  return { context: context, store: context.store, sessions: sessions, groups: groups, socket: socket, sent: sent, frames: frames, topBarPills: topBarPills, layout: layout,
    lifecycleCounts: function () { return { observers: resizeObservers.size, windowListeners: windowListeners.size, subscriptions: liveSubscriptions }; },
    initialLifecycle: initialLifecycle,
    replaceSocket: function () { socket = { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } }; context.getWs = function () { return socket; }; },
    click: click, element: element, assignments: function () { return sourceAssignments; },
    scheduled: scheduled,
    mounted: function () { return context.host.querySelectorAll('.split-pane-frame'); },
    warm: function () {
      frames.forEach(function (frame) {
        var id = Number(frame.dataset.sessionId), requested = id, ready = true;
        function identity() { return { ownerId: 'owner', projectSlug: 'clay', sessionId: id, ready: ready, binding: context.paneTarget(context.store.snap(), sessions, id) }; }
        frame.clayPane = { source: frame.contentWindow, document: frame.contentDocument, identity: identity, checkDraft: function () {},
          activate: function (next) { requested = next; ready = false; return true; }, suspend: function () { ready = false; } };
        frame.complete = function () { id = requested; ready = true; frame.listeners['clay-pane-ready'](); };
      });
    } };
}

test('active Driver and Worker selections retain exact frames, sockets, drafts, questions and frame controls', function () {
  var f = fixture(); var original = f.mounted(); var socket = original[0].contentWindow.socket;
  var question = original[0].contentWindow.pendingQuestion;
  f.click(121); f.click(121); f.click(135);
  assert.equal(f.mounted()[0], original[0]); assert.equal(f.mounted()[1], original[1]);
  assert.equal(f.assignments(), 2, 'no iframe src assignment or new document');
  assert.equal(f.frames.length, 2); assert.equal(f.sent.length, 0, 'no anchor switch or replay request');
  assert.equal(f.mounted()[0].contentWindow.socket, socket);
  assert.equal(f.mounted()[0].contentWindow.draft, 'Unsent draft');
  assert.equal(f.mounted()[0].contentWindow.pendingQuestion, question);
  f.mounted()[0].contentWindow.stop(); assert.equal(f.sent[0].type, 'stop', 'existing frame control remains callable');
});

test('selecting another Driver returns to its single surface while Worker navigation can open its exact pair', function () {
  var driver = fixture(); driver.click(200);
  assert.equal(driver.store.get('splitPanes'), null);
  assert.equal(driver.mounted().length, 0);
  assert.equal(driver.sent.length, 1); assert.equal(driver.sent[0].type, 'switch_session'); assert.equal(driver.sent[0].id, 200);

  var worker = fixture(); worker.click(201);
  assert.equal(worker.store.get('splitPanes').groupId, 'pair-b');
  assert.deepEqual(worker.mounted().map(function (frame) { return Number(frame.dataset.sessionId); }), [200, 201]);
  assert.equal(worker.frames.length, 4); assert.equal(worker.sent.length, 1);
  assert.equal(worker.sent[0].type, 'switch_session'); assert.equal(worker.sent[0].id, 200);
});

test('ungrouped Driver keeps the native fallback', function () {
  var f = fixture(); f.click(300);
  assert.equal(f.store.get('splitPanes'), null); assert.equal(f.mounted().length, 0);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].id, 300);
});

test('missing group/member and stale role/parent contracts cannot reuse a Driver pair', function () {
  [function (f) { f.groups.splice(0, 1); },
    function (f) { f.sessions.splice(1, 1); },
    function (f) { f.sessions[1].parentSessionId = 200; },
    function (f) { f.sessions[1].parentAvailable = false; },
    function (f) { f.sessions[1].sessionRole = 'driver'; },
    function (f) { f.sessions[0].sessionRole = 'unknown'; },
    function (f) { f.groups[0].pair.driverId = 200; },
    function (f) { f.groups[0].id = ''; },
  ].forEach(function (invalidate) {
    var f = fixture(); invalidate(f); f.click(121);
    assert.equal(f.store.get('splitPanes'), null); assert.equal(f.mounted().length, 0);
    assert.equal(f.frames.length, 2, 'invalid group never creates a new pane');
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].id, 121, 'only native fallback selects the clicked Driver');
  });
});

test('project/socket hydration boundaries reject foreign cached groups', function () {
  ['splitGroupsProjectSlug', 'sessionListProjectSlug', 'activeProjectSlug', 'sessionActivatedProjectSlug', 'socketPath'].forEach(function (key) {
    var f = fixture(); var update = {}; update[key] = 'foreign'; f.store.set(update); f.click(121);
    assert.equal(f.store.get('splitPanes'), null); assert.equal(f.sent.length, 0);
  });
  var f = fixture(); f.socket.readyState = 0; f.click(121); assert.equal(f.sent.length, 0);
});

test('sidebar controls retain their existing native handling', function () {
  var f = fixture(); var before = f.mounted(); f.click(121, true);
  assert.equal(f.mounted()[0], before[0]); assert.equal(f.sent.length, 0);
});

test('changed membership retains only the exact common Driver frame', function () {
  var f = fixture(); var driverFrame = f.mounted()[0]; var oldWorker = f.mounted()[1];
  f.groups[0].members = [121, 201]; f.groups[0].pair.workerIds = [201]; f.sessions[3].parentSessionId = 121;
  f.click(121);
  assert.equal(f.mounted()[0], driverFrame); assert.notEqual(f.mounted()[1], oldWorker);
  assert.equal(f.mounted()[1].dataset.sessionId, '201'); assert.equal(f.frames.length, 3);
  assert.equal(f.sent.length, 0);
});

test('equal numeric session IDs in another hydrated project never reuse old project frames', function () {
  var f = fixture(); var old = f.mounted();
  f.store.set({ currentSlug: 'other', activeProjectSlug: 'other', wsPath: '/p/other/ws', socketPath: '/p/other/ws',
    sessionActivatedProjectSlug: 'other', sessionListProjectSlug: 'other', splitGroupsProjectSlug: 'other' });
  assert.equal(f.store.get('splitPanes'), null, 'project departure tears down the old shell');
  f.context.openGroup(f.groups[0]);
  assert.notEqual(f.mounted()[0], old[0]); assert.notEqual(f.mounted()[1], old[1]);
  assert.equal(f.mounted()[0].dataset.projectSlug, 'other'); assert.equal(f.frames.length, 4);
});

test('warm Worker navigation switches pairs in two exact frame documents without reloading them', function () {
  var f = fixture(); f.warm(); var frames = f.mounted(), documents = frames.map(function (frame) { return frame.contentDocument; });
  f.click(121);
  assert.equal(f.frames.length, 2); assert.equal(f.assignments(), 2, 'no iframe src reload');
  assert.equal(frames[0].dataset.sessionId, '121', 'old committed identity remains until ready');
  f.click(201);
  frames.forEach(function (frame) { frame.complete(); });
  assert.deepEqual(f.mounted().map(function (frame) { return Number(frame.dataset.sessionId); }), [200, 201]);
  f.click(121); frames.forEach(function (frame) { frame.complete(); });
  assert.equal(f.assignments(), 2); assert.equal(f.frames.length, 2);
  assert.equal(f.mounted()[0].contentDocument, documents[0]); assert.equal(f.mounted()[1].contentDocument, documents[1]);
});

test('warm pair to standalone to pair retains bounded suspended shells and blocks stale parent bridges', function () {
  var f = fixture(); f.warm(); var frames = f.mounted();
  f.click(300);
  assert.equal(f.store.get('splitPanes'), null); assert.equal(f.frames.length, 2);
  assert.equal(frames[0].clayPane.identity().ready, false);
  assert.equal(f.context.livePaneBinding(frames[0]), false);
  f.context.openGroup(f.groups[1]); frames.forEach(function (frame) { frame.complete(); });
  assert.equal(f.frames.length, 2); assert.equal(f.assignments(), 2);
  assert.equal(f.mounted()[0], frames[0]); assert.equal(f.mounted()[1], frames[1]);
});

test('renderSplit legacy clear disposes pane search resources while same-project warm frames remain reusable', function () {
  var f = fixture(), retainedFrames = f.mounted(); f.warm();
  var warmCounts = f.lifecycleCounts();
  f.context.renderSplit(null);
  assert.equal(f.context.host.children.length, 2, 'valid same-project frames remained in the host');
  assert.deepEqual(f.lifecycleCounts(), warmCounts, 'warm suspended frames retained their search resources');
  assert.equal(retainedFrames[0].clayPane.identity().ready, false, 'retained child was suspended');

  var legacy = f.context.createSplitPane({ slug: 'clay', sessionId: 300, title: 'Legacy session' }, function () {});
  f.context.host.appendChild(legacy);
  var legacyFrame = legacy.querySelector('.split-pane-frame');
  legacyFrame.dataset.projectSlug = 'foreign';
  var beforeClear = f.lifecycleCounts();
  f.context.renderSplit(null);
  assert.equal(f.context.host.children.length, 0, 'invalid legacy source was removed from the host');
  assert.deepEqual(f.lifecycleCounts(), f.initialLifecycle, 'clear path released subscriptions, resize handlers, and observers for every direct pane');
  assert.ok(beforeClear.subscriptions > f.initialLifecycle.subscriptions, 'fixture acquired per-pane store subscriptions');
  assert.ok(beforeClear.windowListeners > f.initialLifecycle.windowListeners, 'fixture acquired per-pane resize handlers');
  assert.ok(beforeClear.observers > f.initialLifecycle.observers, 'fixture acquired per-pane resize observers');
});

test('a header click begun before activation cannot close or change the newly selected session', function () {
  var f = fixture(); f.warm(); var frames = f.mounted();
  var header = f.context.host.querySelectorAll('.split-pane-header')[0];
  header.listeners.pointerdown(); f.click(200); frames.forEach(function (frame) { frame.complete(); });
  var stopped = false;
  header.listeners.click({ detail: 1, preventDefault: function () {}, stopImmediatePropagation: function () { stopped = true; } });
  assert.equal(stopped, true);
});

test('legacy native drag cannot claim a cancelled gesture or a presentation canvas', function () {
  var f = fixture(); f.store.set({ splitPanes: null });
  var inspected = 0, target = { closest: function () { inspected++; return null; } };
  f.context.handleSessionDragStart({ defaultPrevented: true, target: target });
  f.store.set({ projectSplitViewSingletonOrigin: 'origin-300' });
  f.context.handleSessionDragStart({ target: target });
  f.store.set({ projectSplitViewSingletonOrigin: null, projectSplitViewActiveId: 'saved-view' });
  f.context.handleSessionDragStart({ target: target });
  f.store.set({ projectSplitViewActiveId: null, projectSplitViewDrag: { sessionId: 300 } });
  f.context.handleSessionDragStart({ target: target });
  assert.equal(inspected, 0);
});

test('presentation drag cancels native default and stops legacy folder and overlay handlers', function () {
  var f = fixture(), prevented = 0, stopped = 0;
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/split-view-presentation-drag.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function ');
  vm.runInContext(source, f.context);
  var event = { preventDefault: function () { prevented++; }, stopImmediatePropagation: function () { stopped++; } };
  f.context.onNativeDragStart(event);
  assert.equal(prevented, 0); assert.equal(stopped, 0);
  f.store.set({ projectSplitViewDrag: { sessionId: 300 } });
  f.context.onNativeDragStart(event);
  assert.equal(prevented, 1); assert.equal(stopped, 1);
});


test('presentation to legacy Worker pair and back reuses exact nodes and clears Worker runtime metadata', function () {
  var f = fixture(); f.warm();
  f.store.set({ authIdentityLoaded: true, currentProjectOwnerId: 'owner', controlRuntimeId: 'runtime', cwd: '/clay' });
  function presentation(ids) {
    f.store.set({ splitPanes: null });
    f.context.reconcileSplitPanes(f.context.host, ids.map(function (id) { return { slug: 'clay', sessionId: id, title: 'Session ' + id }; }),
      function (pane) { return f.context.createSplitPane(pane, function () {}); }, f.context.updateSplitPaneMetadata, f.context.paneRetention(f.context.host));
    f.frames.forEach(function (frame) { if (frame.complete) frame.complete(); });
    f.warm();
  }
  presentation([121, 300]);
  var driverFrame = f.mounted().find(function (frame) { return Number(frame.dataset.sessionId) === 121; });
  f.context.openGroup(f.groups[0]);
  f.frames.forEach(function (frame) { if (frame.complete) frame.complete(); }); f.warm();
  var workerFrame = f.mounted().find(function (frame) { return Number(frame.dataset.sessionId) === 135; });
  assert.ok(workerFrame); assert.ok(f.mounted().includes(driverFrame));
  var workerPane = workerFrame.parentNode, workerDoc = workerFrame.contentDocument, assignments = f.assignments();
  var badge = f.element('span'); badge.className = 'split-pair-role'; workerPane.appendChild(badge);
  var runtime = f.element('span'); runtime.className = 'split-worker-runtime'; workerPane.appendChild(runtime);
  workerPane.classList.add('split-pane-role-worker');
  workerPane.querySelector('.split-pane-header').classList.add('has-worker-runtime');
  f.store.set({ splitPanes: null });
  var policy = f.context.paneRetention(f.context.host);
  assert.equal(policy.retain(workerPane), false, 'legacy Worker is never a hidden pool candidate');
  assert.equal(policy.canRetarget(workerPane), true, 'validated attached Worker document can change target');
  workerFrame.contentDocument = {};
  assert.equal(policy.canRetarget(workerPane), false, 'replaced document cannot inherit legacy reuse');
  workerFrame.contentDocument = workerDoc;
  f.sessions.find(function (session) { return session.id === 300; }).model = 'Destination model';
  presentation([121, 300]);
  assert.ok(f.mounted().includes(workerFrame)); assert.equal(workerFrame.parentNode, workerPane);
  assert.equal(workerFrame.contentDocument, workerDoc); assert.equal(f.assignments(), assignments);
  assert.equal(Number(workerPane.dataset.sessionId), 300); assert.equal(workerFrame.dataset.sessionOriginId, 'origin-300');
  assert.equal(workerPane.classList.contains('split-pane-role-worker'), false);
  assert.equal(workerPane.querySelector('.split-pair-role'), null); assert.equal(workerPane.querySelector('.split-worker-runtime'), null);
  assert.equal(workerPane.querySelector('.split-pane-header').classList.contains('has-worker-runtime'), false);
  assert.equal(workerPane.querySelector('.split-view-model').textContent, 'Destination model');
});

test('parent pane search actions retain the binding captured at open across retargets', function () {
  var f = fixture(); f.warm();
  var frame = f.mounted()[0], pane = frame.parentNode, button = pane.querySelector('.split-pane-search');
  function bindSession(id, generation) {
    var session = f.sessions.find(function (item) { return item.id === id; });
    var binding = Object.assign({}, f.context.paneTarget(f.store.snap(), f.sessions, id), { requestId: 'search-' + generation, generation: generation });
    frame.dataset.sessionId = String(id); frame.dataset.sessionOriginId = session.sessionOriginId; pane.dataset.sessionId = String(id);
    frame.clayPane.identity = function () { return { ownerId: 'owner', projectSlug: 'clay', sessionId: id, ready: true, binding: binding }; };
  }
  bindSession(121, 1);
  button.listeners.click({ stopPropagation: function () {} });
  var firstReceipt = pane.querySelector('.split-pane-search-popover').getPaneSearchReceipt();
  assert.equal(pane.style['--split-pane-search-top'], '33px', 'search popover did not align to the measured header edge');
  var input = pane.querySelector('.split-pane-search-input');
  var nextButton = pane.querySelectorAll('.split-pane-search-action')[1];
  nextButton.listeners.pointerdown({ type: 'pointerdown' });
  frame.listeners['clay-pane-retarget']();
  bindSession(135, 2);
  button.listeners.click({ stopPropagation: function () {} });
  var beforeStalePointerClick = f.sent.filter(function (item) { return item.type === 'pane-search'; }).length;
  nextButton.listeners.click({ detail: 1 });
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeStalePointerClick,
    'a pointer gesture started on the previous binding navigated the new session');
  frame.listeners['clay-pane-retarget']();
  bindSession(121, 3);
  button.listeners.click({ stopPropagation: function () {} });
  nextButton.listeners.keydown({ key: 'Enter' });
  frame.listeners['clay-pane-retarget']();
  bindSession(135, 4);
  button.listeners.click({ stopPropagation: function () {} });
  var beforeStaleKeyClick = f.sent.filter(function (item) { return item.type === 'pane-search'; }).length;
  nextButton.listeners.click({ detail: 0 });
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeStaleKeyClick,
    'a key gesture started on the previous binding navigated the new session');
  frame.listeners['clay-pane-retarget']();
  bindSession(121, 5);
  button.listeners.click({ stopPropagation: function () {} });
  input.value = 'old query'; input.listeners.input();
  var staleTimer = f.scheduled[f.scheduled.length - 1];
  var oldCommandCount = f.sent.filter(function (item) { return item.type === 'pane-search'; }).length;
  frame.listeners['clay-pane-retarget']();
  bindSession(135, 2);
  button.listeners.click({ stopPropagation: function () {} });
  var currentCount = f.sent.filter(function (item) { return item.type === 'pane-search'; }).length;
  assert.equal(f.context.handlePaneSearchMessage({ source: frame.contentWindow, data: { type: 'clay-pane-search-status', paneBinding: firstReceipt.binding, query: '', status: '', open: false } }, f.context.host), false,
    'late close from the first binding was accepted after retarget');
  assert.equal(pane.querySelector('.split-pane-search-popover').hidden, false, 'late close hid the new Worker search');
  staleTimer.fn();
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, currentCount,
    'an old debounced query was sent to the newly activated Worker');
  assert.ok(currentCount > oldCommandCount);
  pane.querySelectorAll('.split-pane-search-action')[1].listeners.click({});
  assert.equal(f.sent[f.sent.length - 1].message.action, 'next');
  assert.equal(f.sent[f.sent.length - 1].message.paneBinding.sessionId, 135);
  var currentReceipt = pane.querySelector('.split-pane-search-popover').getPaneSearchReceipt();
  var focusBeforeChildClose = button.focusCount;
  assert.equal(f.context.handlePaneSearchMessage({ source: frame.contentWindow, data: { type: 'clay-pane-search-status', paneBinding: currentReceipt.binding, query: '', status: '', open: false } }, f.context.host), true);
  assert.equal(pane.querySelector('.split-pane-search-popover').hidden, true, 'child Escape close status did not dismiss the parent popover');
  assert.equal(button.focusCount, focusBeforeChildClose + 1, 'child Escape did not restore focus to the current pane search trigger');
  frame.dispatchEvent({ type: 'clay-pane-suspend' });
  bindSession(135, 7);
  var beforeResumeOpen = f.sent.filter(function (item) { return item.type === 'pane-search'; }).length;
  button.listeners.click({ stopPropagation: function () {} });
  assert.equal(f.sent[f.sent.length - 1].message.action, 'open', 'a retained pane could not start a fresh search after resume');
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeResumeOpen + 1,
    'a resumed pane did not issue a fresh open command');
  pane.querySelector('.split-pane-search-popover').closePaneSearch(false, false);
  button.listeners.click({ stopPropagation: function () {} });
  var beforeRefusals = f.sent.filter(function (item) { return item.type === 'pane-search'; }).length;
  pane.hidden = true; pane.querySelectorAll('.split-pane-search-action')[1].listeners.click({}); pane.hidden = false;
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeRefusals, 'hidden pane accepted search navigation');
  pane.classList.add('split-pane-cached'); pane.querySelectorAll('.split-pane-search-action')[1].listeners.click({}); pane.classList.remove('split-pane-cached');
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeRefusals, 'cached pane accepted search navigation');
  f.context.handlePaneMessage({ origin: 'https://forged.invalid', source: frame.contentWindow, data: { type: 'clay-pane-search-status', paneBinding: currentReceipt.binding, query: '', status: '', open: false } });
  assert.equal(pane.querySelector('.split-pane-search-popover').hidden, false, 'forged-origin status dismissed the active search');
  f.store.set({ currentSlug: 'other-project' }); pane.querySelectorAll('.split-pane-search-action')[1].listeners.click({});
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeRefusals, 'changed project context accepted search navigation');
  f.store.set({ currentSlug: 'clay' }); button.listeners.click({ stopPropagation: function () {} });
  var savedOrigin = frame.dataset.sessionOriginId; frame.dataset.sessionOriginId = 'forged-origin';
  pane.querySelectorAll('.split-pane-search-action')[1].listeners.click({}); frame.dataset.sessionOriginId = savedOrigin;
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeRefusals, 'forged origin accepted search navigation');
  f.store.set({ myUserId: 'foreign-owner' });
  pane.querySelectorAll('.split-pane-search-action')[1].listeners.click({});
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeRefusals, 'changed owner accepted search navigation');
  f.store.set({ myUserId: 'owner' }); button.listeners.click({ stopPropagation: function () {} });
  var beforeSocketChange = f.sent.filter(function (item) { return item.type === 'pane-search'; }).length;
  f.replaceSocket(); pane.querySelectorAll('.split-pane-search-action')[1].listeners.click({});
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeSocketChange, 'replacement socket reused an old search receipt');
  button.listeners.click({ stopPropagation: function () {} });
  bindSession(121, 3);
  frame.listeners['clay-pane-retarget']();
  button.listeners.click({ stopPropagation: function () {} });
  staleTimer.fn();
  assert.notEqual(f.sent[f.sent.length - 1].message.query, 'old query', 'an old receipt survived an A to B to A retarget');
});

test('pane search listeners and observers are released on pool eviction and legacy removal', function () {
  var f = fixture();
  var host = f.context.host;
  f.store.set({ authIdentityLoaded: true, currentProjectOwnerId: 'owner', controlRuntimeId: 'runtime', cwd: '/clay',
    activeProjectSlug: 'clay', sessionListProjectSlug: 'clay', splitPanes: null });
  var baseline = f.lifecycleCounts();
  var retention = f.context.paneRetention(host);
  assert.ok(retention, 'fixture did not initialize the retained-pane lifecycle');
  for (var i = 0; i < 80; i++) {
    var pane = f.context.createSplitPane({ slug: 'clay', sessionId: 121, title: 'Session 121' }, function () {});
    host.appendChild(pane);
    var input = pane.querySelector('.split-pane-search-input');
    input.value = 'stale query'; input.listeners.input();
    var pending = f.scheduled[f.scheduled.length - 1];
    retention.evict(pane);
    var beforeLateCallback = f.sent.filter(function (item) { return item.type === 'pane-search'; }).length;
    pending.fn();
    assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeLateCallback,
      'an evicted pane debounce sent a search command');
    assert.deepEqual(f.lifecycleCounts(), baseline, 'repeated pool eviction retained per-pane lifecycle resources');
  }
  assert.ok(baseline.observers <= 8 && baseline.windowListeners <= 8 && baseline.subscriptions <= 8,
    'live pane search resources exceeded the eight-pane retention cap');
  for (var j = 0; j < 9; j++) {
    var capped = f.context.createSplitPane({ slug: 'clay', sessionId: 121, title: 'Session 121' }, function () {});
    capped.dataset.splitPaneKey = 'clay#121'; host.appendChild(capped);
  }
  f.context.reconcileSplitPanes(host, [{ slug: 'clay', sessionId: 300, title: 'Session 300' }],
    function (model) { return f.context.createSplitPane(model, function () {}); }, f.context.updateSplitPaneMetadata, retention);
  assert.deepEqual(f.lifecycleCounts(), { observers: baseline.observers + 1, windowListeners: baseline.windowListeners + 1,
    subscriptions: baseline.subscriptions + 1 }, 'pool-cap reconciliation retained resources for evicted panes beyond the two warm panes and the new active pane');
  var afterCap = f.lifecycleCounts();
  var cappedPane = host.querySelectorAll('.split-pane')[0];
  retention.evict(cappedPane);
  assert.equal(f.lifecycleCounts().observers, afterCap.observers - 1, 'explicit cached eviction did not disconnect its ResizeObserver');
  assert.equal(f.lifecycleCounts().windowListeners, afterCap.windowListeners - 1, 'explicit cached eviction retained a window resize handler');
  assert.equal(f.lifecycleCounts().subscriptions, afterCap.subscriptions - 1, 'explicit cached eviction retained a store subscription');
  var beforeLegacy = f.lifecycleCounts();
  var legacy = f.context.createSplitPane({ slug: 'clay', sessionId: 121, title: 'Legacy' }, function () {});
  host.appendChild(legacy);
  assert.notDeepEqual(f.lifecycleCounts(), beforeLegacy, 'legacy pane did not acquire its live search resources');
  f.context.reconcileSplitPanes(host, [], function () {}, f.context.updateSplitPaneMetadata, null);
  assert.deepEqual(f.lifecycleCounts(), beforeLegacy, 'legacy reconciliation retained search resources after removal');
});

test('legacy pane removal cancels an open search and makes its delayed query inert', function () {
  var f = fixture(); f.warm();
  var baseline = f.lifecycleCounts(), frame = f.mounted()[0], pane = frame.parentNode;
  var trigger = pane.querySelector('.split-pane-search'), input = pane.querySelector('.split-pane-search-input');
  trigger.listeners.click({ stopPropagation: function () {} });
  input.value = 'pending query'; input.listeners.input();
  var pending = f.scheduled[f.scheduled.length - 1];
  var beforeRemoval = f.sent.filter(function (item) { return item.type === 'pane-search'; }).length;
  f.context.reconcileSplitPanes(f.context.host, [], function () {}, f.context.updateSplitPaneMetadata, null);
  pending.fn();
  assert.equal(f.sent.filter(function (item) { return item.type === 'pane-search'; }).length, beforeRemoval,
    'legacy removal allowed a delayed search command to escape');
  assert.deepEqual(f.lifecycleCounts(), { observers: baseline.observers - 2, windowListeners: baseline.windowListeners - 2,
    subscriptions: baseline.subscriptions - 2 }, 'legacy removal did not release every pane search resource');
});

test('failed search popover construction releases resources acquired before the failure', function () {
  var f = fixture(), baseline = f.lifecycleCounts();
  f.context.ResizeObserver = function () { throw new Error('fixture observer failure'); };
  assert.throws(function () { f.context.createSplitPane({ slug: 'clay', sessionId: 121, title: 'Failed' }, function () {}); }, /fixture observer failure/);
  assert.deepEqual(f.lifecycleCounts(), baseline, 'failed construction leaked its store or window subscriptions');
});

test('global sidebar reopen stays outside the app and expands through the existing sidebar service', function () {
  var f = fixture(), button = f.context.document.getElementById('sidebar-shell-expand-btn');
  assert.ok(button); assert.equal(button.parentNode, f.topBarPills);
  assert.notEqual(button.parentNode, f.context.document.getElementById('app'));
  assert.equal(button.getAttribute('aria-controls'), 'sidebar-column');
  f.context.syncSidebarReopenButton(button, true);
  assert.equal(button.hidden, true, 'expanded sidebar should hide the shell reopen button');
  f.context.toggleSidebarCollapse();
  assert.equal(f.layout.classList.contains('sidebar-collapsed'), true);
  f.context.syncSidebarReopenButton(button, true);
  assert.equal(button.hidden, false, 'collapsed singleton surface should expose shell reopen');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.listeners.click({});
  assert.equal(f.layout.classList.contains('sidebar-collapsed'), false, 'reopen control did not call the sidebar service');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  f.context.toggleSidebarCollapse();
  f.context.syncSidebarReopenButton(button, true);
  assert.equal(button.hidden, false, 'saved multi-pane surface also needs the parent-owned reopen control');
});

test('pane header native actions stay disabled until an exact ready binding commits', function () {
  var f = fixture(), panes = f.context.host.querySelectorAll('.split-pane');
  var globalReopen = f.context.document.getElementById('sidebar-shell-expand-btn');
  panes.forEach(function (pane) {
    var header = pane.querySelector('.split-pane-header');
    f.context.ensureArrangeTrigger(header);
    assert.equal(header.getAttribute('aria-busy'), 'true');
    assert.equal(header.dataset.paneLoading, 'true');
    assert.equal(header.inert, true);
    assert.equal(pane.querySelector('.split-pane-title').getAttribute('aria-disabled'), 'true');
    ['.split-pane-close', '.split-pane-info', '.split-pane-search', '.split-pane-context', '.split-pane-sidebar', '.split-view-arrange-trigger'].forEach(function (selector) {
      var action = pane.querySelector(selector);
      assert.ok(action, 'expected header control ' + selector);
      assert.equal(action.disabled, true, selector + ' must be natively disabled during cold create');
    });
  });
  assert.notEqual(globalReopen.parentNode, f.context.document.getElementById('app'));
  assert.notEqual(globalReopen.disabled, true, 'global sidebar reopen must remain usable while panes load');
  var sends = f.sent.length;
  panes[0].querySelector('.split-pane-close').listeners.click();
  panes[0].querySelector('.split-pane-context').listeners.click();
  panes[0].querySelector('.split-pane-info').listeners.click({ stopPropagation: function () {} });
  panes[0].querySelector('.split-pane-sidebar').listeners.click({ stopPropagation: function () {} });
  panes[0].querySelector('.split-pane-search').listeners.click({ stopPropagation: function () {} });
  assert.equal(f.sent.length, sends, 'cold actions must not dispatch pane mutations');

  f.warm();
  f.mounted().forEach(function (frame) { frame.listeners['clay-pane-ready'](); });
  panes.forEach(function (pane) {
    var header = pane.querySelector('.split-pane-header');
    assert.equal(header.getAttribute('aria-busy'), 'false');
    assert.equal(header.dataset.paneLoading, 'false');
    assert.equal(header.inert, false);
    ['.split-pane-close', '.split-pane-info', '.split-pane-search', '.split-pane-context', '.split-pane-sidebar', '.split-view-arrange-trigger'].forEach(function (selector) {
      assert.equal(pane.querySelector(selector).disabled, false, selector + ' should be restored after exact ready');
    });
  });
  var permission = panes[0].querySelector('.split-pane-full-access');
  permission.disabled = true;
  f.context.syncPaneHeaderState(panes[0]);
  assert.equal(permission.disabled, true, 'header readiness must not override permission-control pending/unsupported state');

  var frame = f.mounted()[0], pane = frame.parentNode, original = frame.clayPane.identity;
  f.click(200);
  assert.equal(pane.querySelector('.split-pane-header').getAttribute('aria-busy'), 'true', 'retarget must synchronously disable controls');
  assert.equal(pane.querySelector('.split-pane-info').disabled, true);
  frame.clayPane.identity = function () {
    var live = original();
    live.sessionId = 200;
    live.binding = Object.assign({}, live.binding, { sessionId: 200, sessionOriginId: 'foreign-origin' });
    return live;
  };
  frame.listeners['clay-pane-ready']();
  assert.equal(pane.querySelector('.split-pane-header').getAttribute('aria-busy'), 'true', 'foreign ready must not unlock the header');
  assert.equal(pane.querySelector('.split-pane-info').disabled, true);
  frame.clayPane.identity = original;
  f.store.set({ connected: false });
  assert.equal(pane.querySelector('.split-pane-header').getAttribute('aria-busy'), 'true', 'disconnect must keep pending controls disabled');
  f.store.set({ connected: true });
  assert.equal(pane.querySelector('.split-pane-header').getAttribute('aria-busy'), 'true', 'reconnection without a fresh committed ready receipt must remain disabled');
  assert.equal(pane.querySelector('.split-pane-info').disabled, true);

  var singleton = fixture(); singleton.warm();
  singleton.mounted().forEach(function (candidate) { candidate.listeners['clay-pane-ready'](); });
  var onlyPane = singleton.context.host.querySelectorAll('.split-pane')[0];
  singleton.context.host.querySelectorAll('.split-pane')[1].remove();
  singleton.context.host.dataset.singlePane = 'true';
  singleton.context.syncPaneHeaderState(onlyPane);
  assert.equal(onlyPane.querySelector('.split-pane-close').hidden, true, 'singleton close visibility should remain hidden');
  assert.equal(onlyPane.querySelector('.split-pane-close').disabled, true, 'singleton close should remain disabled after readiness');

  var failed = fixture(); failed.warm();
  var failedFrame = failed.mounted()[0];
  failedFrame.clayPane.identity = function () {
    var live = failed.context.paneTarget(failed.store.snap(), failed.sessions, Number(failedFrame.dataset.sessionId));
    return { ownerId: 'owner', projectSlug: 'clay', sessionId: Number(failedFrame.dataset.sessionId), ready: false, binding: live };
  };
  failedFrame.dispatchEvent({ type: 'clay-pane-activation-failed' });
  assert.equal(failedFrame.parentNode.querySelector('.split-pane-header').getAttribute('aria-busy'), 'true', 'activation fallback must remain visibly disabled until a fresh ready binding');
  failedFrame.dispatchEvent({ type: 'clay-pane-suspend' });
  assert.equal(failedFrame.parentNode.querySelector('.split-pane-info').disabled, true, 'suspended panes must stay disabled');
});

test('an exact ready binding restores title actions after a forged origin is rejected', function () {
  var f = fixture(); f.warm();
  var frame = f.mounted()[0], pane = frame.parentNode, title = pane.querySelector('.split-pane-title');
  frame.listeners['clay-pane-ready']();
  var originalOrigin = frame.dataset.sessionOriginId;
  frame.dataset.sessionOriginId = 'origin-300';
  pane.querySelector('.split-pane-info').listeners.click({ stopPropagation: function () {} });
  assert.equal(pane.querySelector('.split-pane-header').getAttribute('aria-busy'), 'true', 'forged origin disabled the header');
  assert.equal(title.getAttribute('aria-disabled'), 'true', 'forged origin marked Rename unavailable');
  assert.equal(pane.querySelector('.split-pane-info').disabled, true, 'forged origin disabled Info');

  frame.dataset.sessionOriginId = originalOrigin;
  frame.listeners['clay-pane-ready']();
  assert.equal(pane.querySelector('.split-pane-header').getAttribute('aria-busy'), 'false', 'validated ready event restored header state');
  assert.equal(title.getAttribute('aria-disabled'), 'false', 'validated ready event restored Rename state');
  assert.equal(pane.querySelector('.split-pane-info').disabled, false, 'validated ready event restored Info');
  title.listeners.click();
  assert.ok(pane.querySelector('.split-pane-rename-input'), 'Rename worked after exact readiness was restored');
});

test('retarget disables header controls before activate and restores them after exact metadata commit', function () {
  var f = fixture(); f.warm();
  var frame = f.mounted()[0], pane = frame.parentNode;
  frame.listeners['clay-pane-ready']();
  var header = pane.querySelector('.split-pane-header');
  f.context.ensureArrangeTrigger(header);
  var arrange = header.querySelector('.split-view-arrange-trigger');
  assert.equal(header.getAttribute('aria-busy'), 'false', 'fixture begins with the old exact binding ready');
  var originalActivate = frame.clayPane.activate;
  var observedInsideActivate = false;
  frame.clayPane.activate = function () {
    observedInsideActivate = true;
    assert.equal(frame.dataset.requestedSessionId, '135', 'destination is published before activation starts');
    assert.equal(header.getAttribute('aria-busy'), 'true', 'busy state is visible before activation callback');
    assert.equal(pane.querySelector('.split-pane-info').disabled, true, 'Info is natively disabled before activation callback');
    assert.equal(pane.querySelector('.split-pane-close').disabled, true, 'Close is natively disabled before activation callback');
    assert.equal(arrange.disabled, true, 'Arrange is natively disabled before activation callback');
    return originalActivate.apply(this, arguments);
  };
  f.context.updateSplitPaneMetadata(pane, { slug: 'clay', sessionId: 135, title: 'Worker 135' });
  assert.equal(observedInsideActivate, true);
  assert.equal(header.getAttribute('aria-busy'), 'true', 'accepted asynchronous activation remains pending');

  frame.complete();
  assert.equal(Number(pane.dataset.sessionId), 135, 'ready metadata commits the destination identity');
  assert.equal(header.getAttribute('aria-busy'), 'false', 'exact committed metadata restores the header');
  assert.equal(pane.querySelector('.split-pane-info').disabled, false);
  assert.equal(pane.querySelector('.split-pane-close').disabled, false);
  assert.equal(arrange.disabled, false);
});

test('same-target bootstrap metadata waits for a controller without a committed identity', function () {
  var f = fixture(); f.warm();
  var frame = f.mounted()[0], pane = frame.closest('.split-pane'), assignments = f.assignments();
  frame.clayPane.identity = function () { return null; };
  frame.clayPane.activate = function () { return false; };
  for (var i = 0; i < 5; i++) f.context.updateSplitPaneMetadata(pane, { slug: 'clay', sessionId: 121, title: 'Driver' });
  assert.equal(f.assignments(), assignments, 'metadata never restarts the same initial document');
  assert.equal(pane.querySelector('.split-pane-header').inert, true, 'actions remain gated until readiness');
  frame.listeners['clay-pane-activation-failed']();
  assert.equal(f.assignments(), assignments + 1, 'an observed activation failure retains the cold fallback');
});
