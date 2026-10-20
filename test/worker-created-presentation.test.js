var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(extra) {
  var state = Object.assign({ currentSlug: 'p', sessionListProjectSlug: 'p', myUserId: 'owner', activeSessionId: 1, connected: true, projectSplitViewSocketGeneration: 2 }, extra), subscribers = [], calls = [], sessions = [];
  var api = vm.createContext({ showCreatedWorkerViewer: function () {}, store: { snap: function () { return state; }, get: function (key) { return state[key]; },
    set: function (change) { var previous = Object.assign({}, state); Object.assign(state, change); subscribers.forEach(function (fn) { fn(state, previous); }); },
    subscribe: function (fn) { subscribers.push(fn); } },
    getWs: function () { return { readyState: 1 }; }, getCachedSessions: function () { return sessions; },
    splitGroupRoles: function (group) { return group.pair; },
    setActiveView: function (id, origin) { calls.push(['view', id, origin]); return true; },
    switchToStandalone: function (id) { calls.push(['single', id]); return true; } });
  vm.runInContext(fs.readFileSync('lib/public/modules/worker-created-presentation.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), api);
  return { api: api, calls: calls, state: state, sessions: sessions, group: { pair: { driverId: 1, workerIds: [2] } },
    ready: function () { sessions.push({ id: 1, ownerId: 'owner', sessionOriginId: 'driver', sessionRole: 'driver' }); api.store.set({ paneBindingSessions: sessions.slice() }); } };
}
test('new Worker keeps its selected Driver in the current singleton or saved view', function () {
  [{}, { projectSplitViewActiveId: 'view-a' }].forEach(function (extra) {
    var f = fixture(extra); f.ready(); assert.equal(f.api.showCreatedWorkerPresentation(f.group), true); assert.deepEqual(f.calls, []);
  });
});
test('creation waits for exact Driver metadata, then uses the current saved view', function () {
  var f = fixture({ activeSessionId: 3, projectSplitViews: [{ id: 'view-a', sessions: [{ id: 1, sessionOriginId: 'driver' }] }] });
  assert.equal(f.api.showCreatedWorkerPresentation(f.group), false); f.ready();
  assert.deepEqual(f.calls, [['view', 'view-a', 'driver']]); assert.equal(f.state.createdWorkerPresentation, null);
});
test('late creation metadata cannot navigate after owner/project changes', function () {
  ['currentSlug', 'myUserId', 'projectSplitViewSocketGeneration'].forEach(function (field) {
    var f = fixture(); f.api.showCreatedWorkerPresentation(f.group); var change = {}; change[field] = 'changed'; f.api.store.set(change); f.ready();
    assert.deepEqual(f.calls, []); assert.equal(f.state.createdWorkerPresentation, null);
  });
});
