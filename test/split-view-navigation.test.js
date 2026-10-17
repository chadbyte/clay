var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

// Run the actual store, sidebar capture handler, pane renderer and reconciler.
// Browser frames are inert DOM objects: no storage, socket transport or provider starts.
function fixture() {
  var nodes = [], frames = [], listeners = {}, sent = [], sourceAssignments = 0;
  function element(tag) {
    var node = { tagName: tag, className: '', dataset: {}, style: {}, children: [], parentNode: null,
      listeners: {}, addEventListener: function (name, fn) { this.listeners[name] = fn; }, setAttribute: function () {},
      dispatchEvent: function (event) { if (this.listeners[event.type]) this.listeners[event.type](event); },
      removeEventListener: function (type) { delete this.listeners[type]; },
      appendChild: function (child) { if (child.parentNode) child.remove(); this.children.push(child); child.parentNode = this; return child; },
      insertBefore: function (child, anchor) {
        if (child.parentNode) child.remove();
        var index = this.children.indexOf(anchor);
        this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this;
      },
      remove: function () { if (!this.parentNode) return; var siblings = this.parentNode.children; siblings.splice(siblings.indexOf(this), 1); this.parentNode = null; },
      querySelectorAll: function (selector) {
        var result = [];
        this.children.forEach(function walk(child) {
          if (child.className.split(' ').indexOf(selector.slice(1)) >= 0) result.push(child);
          child.children.forEach(walk);
        });
        return result;
      },
      querySelector: function (selector) { return this.querySelectorAll(selector)[0] || null; },
    };
    node.classList = {
      add: function (name) { if (node.className.split(' ').indexOf(name) < 0) node.className += ' ' + name; },
      remove: function (name) { node.className = node.className.split(' ').filter(function (value) { return value !== name; }).join(' '); },
      toggle: function (name, enabled) { if (enabled) this.add(name); else this.remove(name); },
    };
    Object.defineProperty(node, 'innerHTML', { set: function () { node.children.forEach(function (child) { child.parentNode = null; }); node.children = []; } });
    if (tag === 'iframe') {
      var src = '';
      node.contentWindow = { socket: {}, draft: 'Unsent draft', pendingQuestion: {}, stop: function () { sent.push({ type: 'stop' }); } };
      node.contentDocument = {};
      Object.defineProperty(node, 'src', { get: function () { return src; }, set: function (value) { sourceAssignments++; src = value; } });
      frames.push(node);
    }
    nodes.push(node); return node;
  }
  var main = element('main'); main.id = 'main-panels';
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
    Event: function (type) { this.type = type; },
    document: { createElement: element, getElementById: function (id) { return nodes.find(function (node) { return node.id === id; }) || null; },
      addEventListener: function (name, fn) { listeners[name] = fn; } },
    window: { addEventListener: function () {} },
    getWs: function () { return socket; }, getCachedSessions: function () { return sessions; },
    detachTuiView: function () {}, refreshIcons: function () {}, syncPairChrome: function () {}, iconHtml: function () { return ''; },
    checkComposerDeparture: function () {}, showToast: function () {},
    VENDOR_AVATARS: { claude: '/fixture.svg' }, VENDOR_NAMES: { claude: 'Claude' },
    createPermissionControl: function (className) { var button = element('button'); button.className = className; return button; },
    bindPermissionControl: function () {}, renderPermissionControl: function () {},
  });
  ['store', 'pane-binding', 'project-activation', 'split-session-boundary', 'split-group-helpers', 'split-pane-reconciler', 'split-pane-renderer', 'split-group-restore', 'split-view'].forEach(function (name) {
    var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/' + name + '.js'), 'utf8')
      .replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context, { filename: name + '.js' });
  });
  context.createStore({ myUserId: 'owner', currentSlug: 'clay', activeProjectSlug: 'clay', connected: true, activeSessionId: 121,
    paneBindingSessions: sessions,
    wsPath: '/p/clay/ws', socketPath: '/p/clay/ws', sessionActivatedProjectSlug: 'clay',
    sessionListProjectSlug: 'clay', splitGroupsProjectSlug: 'clay', splitGroups: groups, splitPanes: null });
  context.initSplitView(); context.openGroup(groups[0]); sent.length = 0;
  function click(id, control) {
    var row = { dataset: { sessionId: String(id) } };
    listeners.click({ button: 0, target: { closest: function (selector) { return selector.indexOf('.session-close-btn') >= 0 ? (control ? row : null) : row; } },
      preventDefault: function () {}, stopImmediatePropagation: function () {} });
  }
  return { context: context, store: context.store, sessions: sessions, groups: groups, socket: socket, sent: sent, frames: frames,
    click: click, assignments: function () { return sourceAssignments; },
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

test('different Driver and Worker pairs reconcile directly and anchor to the exact Driver', function () {
  [200, 201].forEach(function (id) {
    var f = fixture(); f.click(id);
    assert.equal(f.store.get('splitPanes').groupId, 'pair-b');
    assert.deepEqual(f.mounted().map(function (frame) { return Number(frame.dataset.sessionId); }), [200, 201]);
    assert.equal(f.frames.length, 4); assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].type, 'switch_session'); assert.equal(f.sent[0].id, 200);
  });
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

test('warm different pairs retain two exact frame documents and update committed header targets after activation', function () {
  var f = fixture(); f.warm(); var frames = f.mounted(), documents = frames.map(function (frame) { return frame.contentDocument; });
  f.click(200);
  assert.equal(f.frames.length, 2); assert.equal(f.assignments(), 2, 'no iframe src reload');
  assert.equal(frames[0].dataset.sessionId, '121', 'old committed identity remains until ready');
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

test('a header click begun before activation cannot close or change the newly selected session', function () {
  var f = fixture(); f.warm(); var frames = f.mounted();
  var header = f.context.host.querySelectorAll('.split-pane-header')[0];
  header.listeners.pointerdown(); f.click(200); frames.forEach(function (frame) { frame.complete(); });
  var stopped = false;
  header.listeners.click({ detail: 1, preventDefault: function () {}, stopImmediatePropagation: function () { stopped = true; } });
  assert.equal(stopped, true);
});
