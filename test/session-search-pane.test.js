var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

function createSearchHarness() {
  var messages = [], handlers = {}, elements = {};
  var state = { paneMode: true, activeSessionId: 121, paneReady: true, paneSuspended: false, paneCommittedBinding: null, paneSearchOpen: false };
  function element() {
    return { value: '', textContent: '', classList: { values: [], add: function (name) { this.values.push(name); }, remove: function (name) { this.values = this.values.filter(function (item) { return item !== name; }); }, contains: function (name) { return this.values.indexOf(name) >= 0; } },
      addEventListener: function (name, fn) { this['on' + name] = fn; }, focus: function () {}, select: function () {}, parentElement: null,
      insertBefore: function () {}, appendChild: function () {}, querySelectorAll: function () { return []; } };
  }
  elements['find-in-session-input'] = element();
  elements['find-in-session-count'] = element();
  elements['find-in-session-prev'] = element();
  elements['find-in-session-next'] = element();
  elements['find-in-session-close'] = element();
  var app = element();
  var messagesEl = element(); messagesEl.parentElement = app;
  var binding = { requestId: 'pane-search-test', generation: 3, projectSlug: 'clay', viewerId: 'owner', ownerId: 'owner', sessionId: 121, sessionOriginId: 'origin-121', role: 'driver', workerGeneration: null, groupStamp: null, parentSessionOriginId: null };
  state.paneCommittedBinding = binding;
  var context = vm.createContext({
    document: { createElement: element, getElementById: function (id) { return elements[id] || null; }, addEventListener: function (name, fn) { handlers[name] = fn; } },
    window: { location: { origin: 'http://clay.test' }, parent: { postMessage: function (message) { messages.push(message); } } },
    store: { get: function (key) { return state[key]; }, snap: function () { return state; }, set: function (partial) { Object.assign(state, partial); }, subscribe: function () { return function () {}; } },
    paneMessageBinding: function () { return state.paneReady && !state.paneSuspended ? state.paneCommittedBinding : null; },
    samePaneBinding: function (a, b) { return !!a && !!b && a.requestId === b.requestId && a.generation === b.generation && a.sessionId === b.sessionId; },
    escapeHtml: function (value) { return value; }, iconHtml: function () { return ''; }, refreshIcons: function () {},
    setTimeout: function (fn) { fn(); return 1; }, clearTimeout: function () {}, ctx: null,
  });
  var paneStateSource = fs.readFileSync(path.join(__dirname, '../lib/public/modules/session-search-pane-state.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '');
  vm.runInContext(paneStateSource, context, { filename: 'session-search-pane-state.js' });
  var receiptSource = fs.readFileSync(path.join(__dirname, '../lib/public/modules/pane-search-receipt.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '');
  vm.runInContext(receiptSource, context, { filename: 'pane-search-receipt.js' });
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/session-search.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function ').replace(/^export \{[^}]+\};?$/gm, '');
  vm.runInContext(source, context, { filename: 'session-search.js' });
  context.initSessionSearch({ messagesEl: messagesEl, ws: { readyState: 1, send: function (value) { messages.push(JSON.parse(value)); } } });
  return { context: context, messages: messages, handlers: handlers, input: elements['find-in-session-input'], state: state };
}

test('pane search commands keep the existing controller and report Escape close to the parent', function () {
  var harness = createSearchHarness();
  assert.equal(harness.context.controlPaneSearch('open', 'needle'), true);
  assert.equal(harness.context.isSearchOpen(), true);
  assert.equal(harness.input.value, 'needle');
  assert.equal(harness.context.controlPaneSearch('next'), true);
  var beforeStaleResults = harness.messages.filter(function (message) { return message.type === 'clay-pane-search-status'; }).length;
  harness.context.handleFindInSessionResults({ sessionId: 999, query: 'needle', hits: [{ snippet: 'foreign result' }], total: 1 });
  assert.equal(harness.messages.filter(function (message) { return message.type === 'clay-pane-search-status'; }).length, beforeStaleResults,
    'late results from the previous session updated the active pane search');
  var receipt = harness.state.paneSearchReceipt;
  harness.state.paneSearchEpoch++;
  harness.context.handleFindInSessionResults({ sessionId: 121, query: 'needle', hits: [{ snippet: 'stale epoch' }], total: 1 });
  assert.equal(harness.messages.filter(function (message) { return message.type === 'clay-pane-search-status'; }).length, beforeStaleResults,
    'results from a superseded search epoch updated the active search');
  harness.state.paneSearchEpoch = receipt.epoch;
  harness.state.paneCommittedBinding = Object.assign({}, harness.state.paneCommittedBinding, { generation: 4 });
  harness.context.handleFindInSessionResults({ sessionId: 121, query: 'needle', hits: [{ snippet: 'stale binding' }], total: 1 });
  assert.equal(harness.messages.filter(function (message) { return message.type === 'clay-pane-search-status'; }).length, beforeStaleResults,
    'results from a superseded committed binding updated the active search');
  harness.state.paneCommittedBinding = receipt.binding;
  harness.context.handleFindInSessionResults({ sessionId: 121, query: 'needle', hits: [], total: 0 });
  assert.ok(harness.messages.some(function (message) { return message.type === 'clay-pane-search-status' && message.status === 'No results'; }));
  harness.handlers.keydown({ key: 'Escape', preventDefault: function () {} });
  assert.equal(harness.context.isSearchOpen(), false);
  var closeStatus = harness.messages.filter(function (message) { return message.type === 'clay-pane-search-status' && message.open === false; }).pop();
  assert.ok(closeStatus, 'child Escape did not emit a closed status to the parent');
  assert.equal(closeStatus.paneBinding.requestId, 'pane-search-test');
  assert.equal(harness.context.controlPaneSearch('next'), false, 'closed child search accepted a navigation command');
});
