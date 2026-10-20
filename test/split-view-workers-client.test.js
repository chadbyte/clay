var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

function fixture(subscribeWorker) {
  var root = path.join(__dirname, '../lib/public/modules/');
  var popoverElement = { removed: false, remove: function () { this.removed = true; } };
  var driver = { id: 1, sessionOriginId: 'driver-origin', sessionRole: 'driver', ownerId: 'owner-a' };
  var worker = { id: 2, sessionOriginId: 'worker-origin', sessionRole: 'worker', ownerId: 'owner-a', parentSessionId: 1, parentAvailable: true, workerGeneration: 2 };
  var document = { addEventListener: function () {}, getElementById: function (id) { return id === 'split-view-worker-popover' && !popoverElement.removed ? popoverElement : null; },
    querySelector: function (selector) { return selector.indexOf('split-pane[data-session-origin=') >= 0 ? { hidden: false } : null; } };
  var timers = new Map(), nextTimer = 0;
  var context = vm.createContext({ document: document, window: { addEventListener: function () {} }, CSS: { escape: function (value) { return value; } },
    getWs: function () { return context.socket; }, getCachedSessions: function () { return [driver, worker]; }, iconHtml: function () { return ''; }, refreshIcons: function () {},
    setTimeout: function (callback) { var id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout: function (id) { timers.delete(id); }, splitGroupRoles: function () { return null; }, Set: Set, Map: Map, console: console });
  var storeSource = fs.readFileSync(path.join(root, 'store.js'), 'utf8').replace(/^export \{[^}]+\};?$/gm, '');
  vm.runInContext(storeSource, context, { filename: 'store.js' });
  if (subscribeWorker === false) context.store.subscribe = function () { return function () {}; };
  vm.runInContext(fs.readFileSync(path.join(root, 'split-view-worker-scroll.js'), 'utf8').replace(/^export function /gm, 'function '), context);
  var workerSource = fs.readFileSync(path.join(root, 'split-view-workers.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function ');
  vm.runInContext(workerSource, context, { filename: 'split-view-workers.js' });
  context.socket = { readyState: 1 };
  context.createStore({ connected: true, currentSlug: 'project-a', myUserId: 'owner-a', projectSplitViewSocketGeneration: 7,
    splitViewWorkerConversation: { requestId: 'request-a', socket: context.socket, projectSlug: 'project-a', ownerId: 'owner-a', socketGeneration: 7,
      driverOriginId: 'driver-origin', workerOriginId: 'worker-origin', generation: 2, status: 'loading', messages: [] } });
  context.testPopover = popoverElement; context.testTimers = timers;
  return context;
}

test('Worker conversation closes synchronously when owner, project, or socket generation changes', function () {
  ['myUserId', 'currentSlug', 'projectSplitViewSocketGeneration'].forEach(function (field, index) {
    var api = fixture();
    var change = {};
    change[field] = ['owner-b', 'project-b', 8][index];
    api.store.set(change);
    assert.equal(api.store.get('splitViewWorkerConversation'), null, field + ' transition must clear conversation state in the same store update');
    assert.equal(api.testPopover.removed, true, field + ' transition must remove the old DOM popover immediately');
  });
});

test('queued Worker reply cannot replace disconnect error while the request socket still matches', function () {
  var api = fixture(false);
  api.store.set({ connected: false, splitViewWorkerConversation: Object.assign({}, api.store.get('splitViewWorkerConversation'),
    { status: 'error', error: 'Worker conversation connection was lost.' }) });
  var before = api.store.get('splitViewWorkerConversation');
  var accepted = api.handleSplitWorkerConversation({ type: 'split_worker_conversation', requestId: before.requestId,
    parentSessionOriginId: before.driverOriginId, workerSessionOriginId: before.workerOriginId, generation: before.generation,
    messages: [{ role: 'assistant', text: 'late reply' }] });
  assert.equal(accepted, false);
  assert.equal(api.store.get('splitViewWorkerConversation').status, 'error');
  assert.equal(api.store.get('splitViewWorkerConversation').error, 'Worker conversation connection was lost.');
});


test('actual Worker page handler rejects repeated/wrong-cursor replies and keeps messages on page error', function () {
  var api = fixture(false), rendered = 0, sent = [];
  api.presentationSource = function () { return { live: { binding: { generation: 2 } } }; };
  api.samePaneBinding = function () { return true; };
  api.renderContent = function () { rendered++; };
  api.ensurePopover = function () { return {}; };
  api.socket.send = function (raw) { sent.push(JSON.parse(raw)); };
  var current = api.store.get('splitViewWorkerConversation');
  api.store.set({ splitViewWorkerConversation: Object.assign({}, current, { sourceBinding: { generation: 2 }, status: 'ready', inFlight: false,
    messages: [{ role: 'assistant', text: 'latest' }], hasMore: true, nextBefore: { index: 120, offset: 0 } }) });
  api.requestPage(api.store.get('splitViewWorkerConversation'), { index: 120, offset: 0 }, true);
  api.requestPage(api.store.get('splitViewWorkerConversation'), { index: 120, offset: 0 }, true);
  assert.equal(sent.length, 1);
  var pending = api.store.get('splitViewWorkerConversation');
  var reply = { type: 'split_worker_conversation', requestId: pending.requestId, parentSessionOriginId: 'driver-origin', workerSessionOriginId: 'worker-origin', generation: 2,
    pageBefore: { index: 120, offset: 0 }, messages: [{ role: 'user', text: 'older' }], hasMore: true, nextBefore: { index: 10, offset: 0 } };
  assert.equal(api.handleSplitWorkerConversation(Object.assign({}, reply, { pageBefore: { index: 119, offset: 0 } })), false);
  assert.equal(api.handleSplitWorkerConversation(reply), true);
  assert.equal(api.handleSplitWorkerConversation(reply), false);
  assert.equal(api.store.get('splitViewWorkerConversation').messages.length, 2);
  api.requestPage(api.store.get('splitViewWorkerConversation'), { index: 10, offset: 0 }, true);
  pending = api.store.get('splitViewWorkerConversation');
  assert.equal(api.handleSplitWorkerConversation(Object.assign({}, reply, { requestId: pending.requestId, pageBefore: pending.requestedBefore, nextBefore: pending.requestedBefore })), true);
  assert.equal(api.store.get('splitViewWorkerConversation').status, 'error');
  assert.equal(api.store.get('splitViewWorkerConversation').messages.length, 2);
  assert.equal(api.store.get('splitViewWorkerConversation').nextBefore.index, 10);
});

test('short-page fill is deferred, sequential, stops on error, and close cancels timers', function () {
  var api = fixture(false), sent = [];
  api.ensurePopover = function () { return {}; }; api.renderContent = function () {};
  api.socket.send = function (raw) { sent.push(JSON.parse(raw)); };
  var body = { scrollTop: 0, scrollHeight: 100, clientHeight: 200, isConnected: true };
  api.store.set({ splitViewWorkerConversation: Object.assign({}, api.store.get('splitViewWorkerConversation'), {
    inFlight: false, status: 'ready', hasMore: true, nextBefore: { index: 20, offset: 0 }, messages: [{ text: 'latest' }] }) });
  api.scheduleWorkerFill(body); var first = api.store.get('splitViewWorkerConversation').fillTimer;
  api.scheduleWorkerFill(body); assert.equal(api.testTimers.size, 1); assert.equal(sent.length, 0);
  var fill = api.testTimers.get(first); api.testTimers.delete(first); fill();
  assert.equal(sent.length, 1); assert.equal(api.store.get('splitViewWorkerConversation').inFlight, true);
  api.scheduleWorkerFill(body); assert.equal(api.testTimers.size, 1);
  var timeout = api.store.get('splitViewWorkerConversation').requestTimer;
  api.testTimers.get(timeout)(); api.testTimers.delete(timeout);
  assert.equal(api.store.get('splitViewWorkerConversation').status, 'error');
  api.scheduleWorkerFill(body); assert.equal(api.testTimers.size, 0);
  api.loadEarlier(body, true); assert.equal(sent.length, 2);
  api.close(false); assert.equal(api.testTimers.size, 0); assert.equal(api.store.get('splitViewWorkerConversation'), null);
  fill(); assert.equal(sent.length, 2);
});
