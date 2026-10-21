var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
var element = require('./fixtures/popup-tool-dom.cjs').element;
var HELP_TEXT = 'Search conversations across all vendors.\nAsk Clay to find past work, reviews, decisions, and unfinished sessions.';
function fixture(options) {
  options = options || {};
  var handlers = {}, now = 0, timers = new Map(), sequence = 0, asked = [], selected = [], retried = 0, fetched = [];
  var document = { hidden: !!options.hidden, activeElement: null,
    addEventListener: function (name, fn) { (handlers[name] || (handlers[name] = new Set())).add(fn); },
    removeEventListener: function (name, fn) { if (handlers[name]) handlers[name].delete(fn); } };
  function emit(name, event) { Array.from(handlers[name] || []).forEach(function (fn) { fn(event || {}); }); }
  function descendants(node) { return node.children.reduce(function (all, child) { return all.concat(child, descendants(child)); }, []); }
  function enhance(node) {
    if (!node || node.enhanced) return node;
    Object.defineProperty(node, 'title', { get: function () { return node.getAttribute('title') || ''; }, set: function (value) { node.setAttribute('title', value); } });
    node.enhanced = true; node.value = ''; node.selectionStart = 0; node.selectionEnd = 0;
    var query = node.querySelectorAll;
    node.querySelectorAll = function (selector) {
      var found = selector[0] === '#' ? descendants(node).filter(function (child) { return child.getAttribute('id') === selector.slice(1); }) : query.call(node, selector);
      return found.map(enhance);
    };
    node.querySelector = function (selector) { return node.querySelectorAll(selector)[0] || null; };
    node.matches = function () { return !!node.hovered; };
    node.removeEventListener = function (name, fn) { node.listeners[name] = (node.listeners[name] || []).filter(function (item) { return item !== fn; }); };
    node.focus = function () { var old = document.activeElement; document.activeElement = node; if (old) emit('focusout', { target: old, relatedTarget: node }); emit('focusin', { target: node }); };
    node.scrollIntoView = function () {};
    if (node.getAttribute('data-index') !== null) node.dataset.index = node.getAttribute('data-index');
    return node;
  }
  document.createElement = function (tag) { return enhance(element(tag)); };
  document.body = document.createElement('body');
  document.getElementById = function (id) { return document.body.querySelector('#' + id); };
  document.querySelectorAll = function (selector) { return document.body.querySelectorAll(selector); };
  var trigger = document.createElement('button'); trigger.setAttribute('id', 'cmd-palette-btn'); trigger.setAttribute('aria-label', 'Search or ask Clay');
  trigger.setAttribute('title', 'Stale first question'); trigger.setAttribute('data-tip', HELP_TEXT); trigger.setAttribute('data-tip-suppress-when-open', '.cmd-palette');
  trigger.innerHTML = '<span class="cmd-palette-searchbar-text"></span><kbd class="cmd-palette-searchbar-kbd"></kbd>'; document.body.appendChild(trigger);
  var window = {}; window.top = options.child ? {} : window;
  var context = vm.createContext({ document: document, window: window, navigator: { platform: 'Mac' }, AbortController: AbortController,
    setTimeout: function (fn, delay) { var id = ++sequence; timers.set(id, { fn: fn, at: now + delay }); return id; }, clearTimeout: function (id) { timers.delete(id); },
    refreshIcons: function () {}, escapeHtml: function (s) { return s; }, mateAvatarUrl: function () { return ''; }, getWs: function () { throw new Error('Unexpected WebSocket action'); },
    startSearchClayChat: function (query) { asked.push(query); return true; }, retrySearchClayAsk: function () { retried++; return true; },
    fetch: function (url) { fetched.push(url); return Promise.resolve({ json: function () { return Promise.resolve({ results: options.results || [] }); } }); } });
  ['store', 'search-hints', 'palette-render-helpers', 'command-palette'].forEach(function (name) {
    var source = fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{.*\};$/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context, { filename: name + '.js' });
  });
  context.createStore({ paneMode: !!options.pane, myUserId: 'owner', currentSlug: 'alpha', activeSessionId: 1 });
  var setup = { currentSlug: function () { return 'alpha'; }, selectSession: function (id) { selected.push(id); }, switchProject: function () {}, matesList: function () { return []; } };
  context.initCommandPalette(setup);
  function tick(ms) {
    var end = now + ms;
    while (true) {
      var next = Array.from(timers.entries()).filter(function (item) { return item[1].at <= end; }).sort(function (a, b) { return a[1].at - b[1].at; })[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  function event(node, name, details) { (node.listeners[name] || []).forEach(function (fn) { fn(Object.assign({ preventDefault: function () {}, stopPropagation: function () {} }, details)); }); }
  return { api: context, input: context.inputEl, trigger: trigger, label: trigger.querySelector('.cmd-palette-searchbar-text'), timers: timers, handlers: handlers, setup: setup,
    document: document, tick: tick, emit: emit, event: event, asked: asked, selected: selected, fetched: fetched, retried: function () { return retried; },
    blur: function () { var old = document.activeElement; document.activeElement = document.body; emit('focusout', { target: old, relatedTarget: document.body }); } };
}
test('twelve quiet hints share one index without changing input, selection, results or accessible names', function () {
  var f = fixture();
  assert.equal(f.api.SEARCH_HINT_QUESTIONS.length, 12); assert.equal(new Set(f.api.SEARCH_HINT_QUESTIONS).size, 12);
  assert.equal(f.label.textContent, 'Search or ask Clay, like “What was I working on recently?”');
  f.input.value = 'my editable question'; f.input.selectionStart = 2; f.input.selectionEnd = 5; f.api.activeIndex = 3;
  var rows = f.api.resultsEl.children.slice();
  f.tick(179999); assert.equal(f.api.store.get('searchHintIndex'), 0);
  f.tick(1); assert.equal(f.api.store.get('searchHintIndex'), 1); assert.equal(f.label.textContent, f.input.placeholder); assert.equal(f.trigger.getAttribute('title'), null); assert.equal(f.trigger.getAttribute('data-tip'), HELP_TEXT);
  assert.equal(f.input.value, 'my editable question'); assert.equal(f.input.selectionStart, 2); assert.equal(f.input.selectionEnd, 5); assert.equal(f.api.activeIndex, 3);
  assert.deepEqual(f.api.resultsEl.children, rows); assert.deepEqual(f.asked, []); assert.deepEqual(f.fetched, []);
  assert.equal(f.trigger.getAttribute('aria-label'), 'Search or ask Clay'); assert.equal(f.input.getAttribute('aria-label'), 'Search or ask Clay');
  assert.equal(f.label.getAttribute('aria-live'), null);
  for (var i = 1; i < 12; i++) f.tick(180000);
  assert.equal(f.api.store.get('searchHintIndex'), 0); assert.equal(f.timers.size, 1);
  assert.equal(f.trigger.getAttribute('title'), null); assert.equal(f.trigger.getAttribute('data-tip'), HELP_TEXT);
});
test('open, hover, focus and hidden pause without catch-up and resume only after a full interval', function () {
  for (var reason of ['open', 'hover', 'trigger-focus', 'input-focus', 'hidden']) {
    var f = fixture(); f.tick(170000);
    if (reason === 'open') f.api.openCommandPalette();
    if (reason === 'hover') f.event(f.trigger, 'mouseenter');
    if (reason === 'trigger-focus') f.trigger.focus();
    if (reason === 'input-focus') f.input.focus();
    if (reason === 'hidden') { f.document.hidden = true; f.emit('visibilitychange'); }
    assert.equal(f.timers.size, 0, reason); f.tick(900000); assert.equal(f.api.store.get('searchHintIndex'), 0);
    if (reason === 'open') f.api.closeCommandPalette();
    if (reason === 'hover') f.event(f.trigger, 'mouseleave');
    if (reason.indexOf('focus') >= 0 || reason === 'open') f.blur();
    if (reason === 'hidden') { f.document.hidden = false; f.emit('visibilitychange'); }
    f.tick(179999); assert.equal(f.api.store.get('searchHintIndex'), 0, reason);
    f.tick(1); assert.equal(f.api.store.get('searchHintIndex'), 1, reason);
  }
});
test('repeated initialization and cleanup bound timers/listeners; panes and child documents never schedule', function () {
  var f = fixture(); f.tick(90000);
  f.api.initCommandPalette(f.setup); f.api.initSearchHints(f.trigger, f.input);
  assert.equal(f.timers.size, 1); assert.equal(f.handlers.focusin.size, 1); assert.equal(f.trigger.listeners.mouseenter.length, 1);
  f.tick(90000); assert.equal(f.api.store.get('searchHintIndex'), 1);
  f.api.store.set({ paneMode: true }); assert.equal(f.timers.size, 0);
  f.api.store.set({ paneMode: false }); assert.equal(f.timers.size, 1);
  f.api.disposeSearchHints(); assert.equal(f.timers.size, 0); assert.equal(f.handlers.focusin.size, 0); assert.equal(f.trigger.listeners.mouseenter.length, 0);
  for (var opts of [{ pane: true }, { child: true }, { hidden: true }]) { var other = fixture(opts); assert.equal(other.timers.size, 0); other.tick(900000); assert.equal(other.api.store.get('searchHintIndex'), 0); }
});
test('production palette retains recent/results/retry, CmdK/arrows/Escape and explicit exact-query Ask', async function () {
  var f = fixture({ results: [{ projectSlug: 'alpha', sessionId: 2, sessionTitle: 'Recent review', projectTitle: 'Alpha' }] });
  f.emit('keydown', { metaKey: true, key: 'k', preventDefault: function () {} });
  for (var turn = 0; turn < 5; turn++) await Promise.resolve();
  assert.equal(f.api.items.length, 1); assert.equal(f.api.items[0].type, 'session'); assert.deepEqual(f.asked, []);
  f.event(f.input, 'keydown', { key: 'ArrowDown' }); assert.equal(f.api.activeIndex, 0);
  f.event(f.input, 'keydown', { key: 'Enter' }); assert.deepEqual(f.selected, [2]);
  f.api.openCommandPalette(); f.input.value = 'What are my Workers doing? edited'; f.event(f.input, 'input');
  assert.equal(f.api.items.length, 1); assert.equal(f.api.items[0].type, 'ask-clay');
  var placeholder = f.input.placeholder; f.tick(180000); assert.equal(f.input.placeholder, placeholder); assert.deepEqual(f.asked, []);
  f.event(f.input, 'keydown', { key: 'Enter' }); assert.deepEqual(f.asked, ['What are my Workers doing? edited']);
  f.api.store.set({ contextualSearchAsk: { ownerId: 'owner', status: 'error', text: 'Retained question' } });
  f.api.searchQuery = ''; f.api.searchResults = []; f.api.openCommandPalette();
  assert.equal(f.api.items[0].type, 'retry-clay-ask'); f.event(f.input, 'keydown', { key: 'ArrowDown' }); f.event(f.input, 'keydown', { key: 'Enter' }); assert.equal(f.retried(), 1);
  f.api.openCommandPalette(); f.event(f.input, 'keydown', { key: 'Escape' }); assert.equal(f.api.isCommandPaletteOpen(), false);
  assert.equal(f.document.body.querySelectorAll('.cmd-palette').length, 1);
  assert.equal(f.document.body.textContent.includes('Try asking Clay'), false);
});

test('custom capability tooltip survives a full hint cycle, reinitialization and open search without native title', function () {
  var f = fixture();
  function check() {
    assert.equal(f.trigger.getAttribute('title'), null); assert.equal(f.trigger.title, '');
    assert.equal(f.trigger.getAttribute('data-tip'), HELP_TEXT);
    assert.equal(f.trigger.getAttribute('data-tip-suppress-when-open'), '.cmd-palette');
    assert.equal(f.trigger.getAttribute('aria-label'), 'Search or ask Clay');
    assert.equal(f.input.getAttribute('aria-label'), 'Search or ask Clay');
  }
  check();
  for (var i = 0; i < 12; i++) { f.tick(180000); check(); }
  f.trigger.title = 'Stale reinitialized question'; f.api.initSearchHints(f.trigger, f.input); check();
  f.api.openCommandPalette(); f.tick(540000); check();
  f.api.closeCommandPalette(); f.blur(); f.tick(180000); check();
  f.api.disposeSearchHints(); f.trigger.title = 'Stale remounted question'; f.api.initSearchHints(f.trigger, f.input); check();
});
