var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), vm = require('node:vm');
var element = require('./fixtures/popup-tool-dom.cjs').element;
function load(context, name) {
  vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
}
function makeStore(values) {
  var subscriptions = [];
  return { get: function (key) { return values[key]; }, snap: function () { return values; },
    set: function (patch) { var previous = Object.assign({}, values); Object.assign(values, patch); subscriptions.slice().forEach(function (fn) { fn(values, previous); }); },
    subscribe: function (fn) { subscriptions.push(fn); } };
}
function fixture() {
  var observers = [], queue = [], callbacks = 0, readyEvents = 0, focus = 0;
  function mutation(node, name) {
    observers.forEach(function (observer) {
      if (observer.targets.some(function (target) { return target.node === node && target.options.attributeFilter.indexOf(name) >= 0; }) && queue.indexOf(observer) < 0) queue.push(observer);
    });
  }
  function reflected(node, name) {
    var value = node[name];
    Object.defineProperty(node, name, { get: function () { return value; }, set: function (next) {
      value = next; mutation(node, name); // Same-value attribute writes also enqueue delivery.
    } });
  }
  function Observer(callback) { this.callback = callback; this.targets = []; observers.push(this); }
  Observer.prototype.observe = function (node, options) { this.targets.push({ node: node, options: options }); };
  function drain() {
    var count = 0;
    while (queue.length) {
      assert.ok(++count <= 12, 'parent/child observer delivery must settle, not loop');
      var observer = queue.shift(); callbacks++; observer.callback([]);
    }
    return count;
  }
  var surface = element('section'), frame = element('iframe'), body = element('body'), trigger = element('button');
  var widgets = {};
  surface.querySelector = function (selector) { return widgets[selector] || (widgets[selector] = element('div')); };
  surface.querySelectorAll = function (selector) { return selector === 'iframe' ? [frame] : []; };
  surface.dispatchEvent = function (event) {
    if (event.type === 'contextual-clay-ready') readyEvents++;
    (surface.listeners[event.type] || []).forEach(function (fn) { fn(event); });
  };
  surface.appendChild(frame); frame.dataset = { mateId: 'mate', ownerId: 'owner', canonical: 'true' };
  frame.hidden = false; reflected(frame, 'hidden'); reflected(frame, 'inert');
  surface.dataset = new Proxy({}, { set: function (target, key, value) { target[key] = value; mutation(surface, 'data-' + key); return true; } });
  var mounted = false;
  var parentDocument = { body: { appendChild: function () { mounted = true; } },
    createElement: function () { return surface; }, getElementById: function () { return mounted ? surface : null; },
    querySelector: function () { return trigger; }, activeElement: trigger };
  var parentStore = makeStore({ contextualClay: { mode: 'popover', mateId: 'mate' }, myUserId: 'owner', projectsHubList: [] });
  var parent = vm.createContext({ document: parentDocument, store: parentStore, window: { matchMedia: function () { return { matches: false }; } },
    contextualFrame: function () { return frame; }, contextualMate: function () { return null; }, contextualTrigger: function () { return trigger; },
    getCachedSessions: function () { return []; }, updateMateContext: function () {}, positionContextualClay: function () {}, renderContextualWorkspaceBack: function () {},
    mateLoadingMarkup: function () { return ''; }, iconHtml: function () { return ''; }, refreshIcons: function () {},
    attachContextualConversations: function () {}, attachContextualSessionCitations: function () {}, attachContextualGeometry: function () {}, syncContextualNativeOrigin: function () {} });
  load(parent, 'contextual-clay'); parent.ensureSurface(); surface.appendChild(frame); parent.render();
  var childNodes = {}, childDocument = { body: body, createElement: element, querySelectorAll: function (selector) { return body.querySelectorAll(selector); },
    addEventListener: function () {}, getElementById: function (id) { return childNodes[id] || null; } };
  ['input', 'input-wrapper', 'input-area', 'input-textarea-wrap'].forEach(function (id) { childNodes[id] = element('div'); });
  childNodes.input.focus = function () { focus++; };
  frame.contentDocument = childDocument;
  var childStore = makeStore({ paneMode: true, connected: true, myUserId: 'owner', sessionOriginId: 'origin', activeSessionId: 7, paneSessionId: 7,
    activeProjectMateId: 'mate', contextualSessionReceived: true, wsPath: '/fixture', sessionDrafts: {} });
  var child = vm.createContext({ document: childDocument, store: childStore, location: { search: '?contextual=1' }, URLSearchParams: URLSearchParams, URL: URL,
    window: { frameElement: frame, parent: { document: parentDocument, CustomEvent: function (type) { this.type = type; } } },
    MutationObserver: Observer, ResizeObserver: function () { this.observe = function () {}; },
    autoResize: function () {}, initContextualComposer: function () {}, takeComposerDraft: function () {}, restoreComposerDraft: function () {},
    submitContextualAsk: function () {}, pauseContextualAsk: function () {}, stopContextualAsk: function () {}, withdrawPaneControlActivity: function () {},
    resolveProjectAssistantIdentity: function () { return { kind: 'mate', mateId: 'mate' }; }, applyProjectAssistantIdentity: function () {},
    iconHtml: function () { return '<i></i>'; }, refreshIcons: function () {}, escapeHtml: function (value) { return value || ''; },
    stopThinkingSegment: function () {}, openFile: function () {}, isDiffContent: function () { return false; } });
  ['clay-tool-presentation', 'clay-tool-activity', 'popup-chat-rendering', 'tools', 'contextual-clay-session'].forEach(function (name) { load(child, name); if (name === 'popup-chat-rendering') child.syncPopupGroups = child.syncPopupChatToolGroups; });
  child.initTools({ messagesEl: body, finalizeAssistantBlock: function () {}, addToMessages: function (node) { body.appendChild(node); }, setActivity: function () {}, scrollToBottom: function () {} });
  child.initContextualSession(); drain();
  return { child: child, parent: parent, frame: frame, surface: surface, body: body, store: childStore, parentStore: parentStore, drain: drain,
    ready: function () { return readyEvents; }, callbacks: function () { return callbacks; }, focus: function () { return focus; } };
}
test('production parent/child visibility observers settle across readiness, same-value writes, expand and Back', function (t) {
  var f = fixture();
  for (var i = 0; i < 4; i++) f.child.createToolItem(String(i), 'Bash');
  assert.equal(f.body.classList.contains('popup-chat-rendering'), false);
  f.surface.dataset.focusEntry = 'true';
  f.child.handleContextualSessionMessage({ type: 'history_done' });
  assert.ok(f.drain() <= 2); assert.equal(f.focus(), 1);
  assert.equal(f.frame.dataset.sessionId, '7'); assert.equal(f.parentStore.get('contextualClay').sessionId, 7);
  assert.equal(f.body.classList.contains('popup-chat-rendering'), true);
  assert.equal(f.child.currentToolGroup.el.classList.contains('popup-chat-activity'), true);
  assert.equal(f.child.tools['0'].el.hidden, true); assert.equal(f.child.tools['2'].el.hidden, false);
  var ready = f.ready();
  f.frame.hidden = f.frame.hidden; f.frame.inert = f.frame.inert; f.surface.dataset.mode = f.surface.dataset.mode;
  assert.equal(f.drain(), 1); assert.equal(f.ready(), ready, 'visibility callbacks never send ready notifications');
  f.parent.render(); assert.equal(f.drain(), 0, 'unchanged parent render does not write observed attributes');
  f.frame.inert = true; assert.equal(f.drain(), 1); assert.equal(f.body.classList.contains('popup-chat-rendering'), false);
  f.frame.inert = false; assert.equal(f.drain(), 1); assert.equal(f.body.classList.contains('popup-chat-rendering'), true);
  f.frame.hidden = true; assert.equal(f.drain(), 1); assert.equal(f.body.classList.contains('popup-chat-rendering'), false);
  f.frame.hidden = false; assert.equal(f.drain(), 1); assert.equal(f.body.classList.contains('popup-chat-rendering'), true);
  for (var mode of ['workspace', 'popover', 'closed', 'popover']) {
    f.parentStore.set({ contextualClay: { mode: mode, mateId: 'mate', sessionId: 7 } }); f.parent.render();
    assert.equal(f.drain(), 1); assert.equal(f.body.classList.contains('popup-chat-rendering'), mode === 'popover');
  }
  assert.equal(f.ready(), ready); assert.ok(f.callbacks() <= 12);
  t.diagnostic('Settled lifecycle: ' + f.callbacks() + ' observer callbacks; ' + ready + ' readiness events; same-value batch: 1 callback; unchanged parent render: 0 callbacks.');
  f.frame.dataset.expectedSessionOrigin = 'foreign'; f.frame.hidden = false; f.drain();
  assert.equal(f.body.classList.contains('popup-chat-rendering'), false);
});
