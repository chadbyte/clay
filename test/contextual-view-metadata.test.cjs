var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  var sessions = [{ id: 2, title: 'Driver', sessionOriginId: 'driver' }, { id: 3, title: 'Worker', sessionOriginId: 'worker' }];
  var context = vm.createContext({ getCachedSessions: function () { return sessions; } });
  ['store', 'contextual-view-metadata'].forEach(function (name) { vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context); });
  context.store.set({ currentSlug: 'alpha', activeProjectSlug: 'alpha', sessionActivatedProjectSlug: 'alpha', activeSessionId: 2,
    projectSplitViewActiveId: 'view-a', projectSplitViewFocusedOrigin: 'worker', projectSplitViews: [{ id: 'view-a', name: 'Implementation', sessions: sessions }],
    rightWorkbenchDockedOwners: ['browser'], rightWorkbenchOwner: 'linear' });
  return context;
}
test('current View metadata distinguishes selected and focused sessions and includes both workbench placements', function () {
  var f = fixture(), result = JSON.parse(JSON.stringify(f.contextualViewMetadata()));
  assert.deepEqual(result, { name: 'Implementation', sessions: [{ sessionId: 2, title: 'Driver', selected: true, focused: false }, { sessionId: 3, title: 'Worker', selected: false, focused: true }], workbenches: ['browser', 'linear'] });
  f.store.set({ projectSplitViewActiveId: null, rightWorkbenchOwner: 'browser' });
  assert.equal(f.contextualViewMetadata().sessions.length, 1); assert.equal(f.contextualViewMetadata().workbenches.length, 1);
});
test('navigation, private shell surfaces and history replay do not expose stale project labels', function () {
  for (var state of [{ homeShellVisible: true }, { projectsHubVisible: true }, { dmMode: true }, { paneMode: true }, { replayingHistory: true }, { activeProjectSlug: 'beta' }, { sessionActivatedProjectSlug: 'beta' }]) {
    var f = fixture(); f.store.set(state); assert.equal(f.contextualViewMetadata(), null);
  }
  var f = fixture(); f.store.set({ projectSplitViews: [{ id: 'view-a', name: 'View', sessions: [{ id: 2, sessionOriginId: 'replaced' }] }] });
  assert.equal(f.contextualViewMetadata().sessions.length, 0);
});
