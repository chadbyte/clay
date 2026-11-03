var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');

function harness() {
  var state = { connected: true, currentSlug: 'project', projectStartPicker: { scope: 'current', query: '', pending: null } };
  var sent = [], opened = [], timers = [];
  var context = vm.createContext({
    store: { get: function (key) { return state[key]; }, set: function (patch) { Object.assign(state, patch); }, subscribe: function () {} },
    currentLayoutScope: function (scope) { return scope === 'current'; },
    createOptions: function () { return { vendors: [{ id: 'codex', installed: true }] }; },
    startNewSession: function (vendor, options) { sent.push({ vendor: vendor, options: options }); return state.connected; },
    switchToStandalone: function (id) { opened.push(id); },
    setTimeout: function (callback) { timers.push(callback); },
    document: { getElementById: function () { return null; } }
  });
  vm.runInContext(fs.readFileSync('lib/public/modules/project-empty-canvas.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  return { context: context, state: state, sent: sent, opened: opened, timers: timers };
}

test('project picker creates once without activating before its matching acknowledgement', function () {
  var h = harness();
  h.context.createSession('missing'); assert.equal(h.sent.length, 0);
  h.context.createSession('codex'); h.context.createSession('codex');
  assert.equal(h.sent.length, 1);
  var request = h.sent[0].options;
  assert.equal(request.activate, false); assert.equal(request.slug, 'project');
  assert.match(request.requestId, /^project-start-/);
  assert.equal(h.context.handleEmptyCanvasNewSessionResult({ requestId: 'other', ok: true, sessionId: 8 }), false);
  assert.equal(h.opened.length, 0);
  assert.equal(h.context.handleEmptyCanvasNewSessionResult({ requestId: request.requestId, ok: true, sessionId: 8 }), true);
  assert.deepEqual(h.opened, [8]);
  assert.equal(h.state.projectStartPicker.pending, null);
});

test('dismissed or changed workspaces never activate a late creation', function () {
  ['dismissed', 'scope'].forEach(function (field) {
    var h = harness(); h.context.createSession('codex');
    h.state.projectStartPicker[field] = field === 'dismissed' ? true : 'stale';
    h.context.handleEmptyCanvasNewSessionResult({ requestId: h.sent[0].options.requestId, ok: true, sessionId: 8 });
    assert.equal(h.opened.length, 0);
  });
});

test('failed and uncertain creation remain actionable without automatic retries', function () {
  var h = harness(); h.context.createSession('codex');
  h.context.handleEmptyCanvasNewSessionResult({ requestId: h.sent[0].options.requestId, ok: false, error: 'Provider unavailable' });
  assert.equal(h.state.projectStartPicker.error, 'Provider unavailable');
  h.context.createSession('codex'); h.timers[1]();
  assert.equal(h.state.projectStartPicker.pending, null);
  assert.match(h.state.projectStartPicker.error, /Check the sidebar/);
  assert.equal(h.sent.length, 2);
});

test('project picker shares session filtering without hiding existing view members', function () {
  var sessions = [
    { id: 1, sessionOriginId: 'a', ownerId: 'owner', title: 'Alpha', lastActivity: 1 },
    { id: 2, sessionOriginId: 'b', ownerId: 'owner', title: 'Beta', lastActivity: 2 },
    { id: 3, sessionOriginId: 'c', ownerId: 'other' },
    { id: 4, sessionOriginId: 'd', ownerId: 'owner', sessionRole: 'worker' },
    { id: 5, sessionOriginId: 'e', ownerId: 'owner', hidden: true }
  ];
  var context = vm.createContext({ store: { get: function () { return 'owner'; } }, getCachedSessions: function () { return sessions; }, activeSavedView: function () { return { sessions: [{ sessionOriginId: 'a' }] }; } });
  vm.runInContext(fs.readFileSync('lib/public/modules/split-view-picker-render.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  function ids(query, project) { return Array.from(context.pickerCandidates(query, project), function (item) { return item.id; }); }
  assert.deepEqual(ids('', true), [2, 1]);
  assert.deepEqual(ids('alpha', true), [1]);
  assert.deepEqual(ids('', false), [2]);
});

test('leaving an empty workspace clears shell styling even if another renderer removed the picker', function () {
  var h = harness(), removed = [];
  h.context.document.getElementById = function (id) {
    return id === 'split-host' ? { classList: { remove: function (name) { removed.push(name); } } } : null;
  };
  h.context.clearProjectEmptyCanvas();
  assert.deepEqual(removed, ['project-start-visible']);
  assert.equal(h.state.projectStartPicker, null);
});
