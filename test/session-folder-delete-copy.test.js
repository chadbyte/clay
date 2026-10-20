var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
function fixture() {
  var socket = {}, root = path.join(__dirname, '../lib/public/modules');
  var context = vm.createContext({ getWs: function () { return socket; }, clearDustParticles: function () {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'store.js'), 'utf8').replace(/^export \{.*$/gm, ''), context);
  context.createStore({ connected: true, authIdentityLoaded: true, currentSlug: 'alpha', activeProjectSlug: 'alpha', myUserId: 'alice',
    projectSplitViewHydrated: true, projectSplitViewRequestSlug: 'alpha', projectSplitViewRequestSocket: socket,
    projectSplitViewRequestOwnerId: 'alice', projectSplitViewRequestGeneration: 2, projectSplitViewSocketGeneration: 2,
    projectSplitViews: [{ id: 'view', folderId: 'folder', favorite: true }] });
  vm.runInContext(fs.readFileSync(path.join(root, 'session-folder-delete.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), context);
  return { api: context, store: context.store, replaceSocket: function () { socket = {}; } };
}
function current(count) { return { folderId: 'folder', label: 'Work', preview: { sessionCount: count, workerCount: 0, totalCount: count, token: 'server-token' }, mode: 'unfiled' }; }

test('view-only folder description is truthful without changing authoritative empty-session behavior', function () {
  var f = fixture(), state = current(0), before = JSON.stringify(state);
  var text = f.api.describe(state);
  assert.doesNotMatch(text, /is empty/); assert.match(text, /contains saved Split views/);
  assert.match(text, /move to Unfiled/); assert.match(text, /keep their Favorites status/); assert.match(text, /No sessions will be deleted/);
  assert.equal(f.api.canSubmit(state), true); assert.equal(f.api.primaryLabel(state), 'Delete folder');
  assert.equal(JSON.stringify(state), before); assert.equal(f.store.get('projectSplitViews')[0].favorite, true);
});

test('mixed folder retains exact server session/Worker counts and explains independent view handling', function () {
  var f = fixture(), state = current(2); state.preview.workerCount = 3;
  var text = f.api.describe(state);
  assert.match(text, /contains 2 sessions/); assert.match(text, /3 Split Worker sessions/);
  assert.match(text, /Saved Split views will move to Unfiled/); assert.match(text, /individually filed sessions/);
  assert.match(text, /deleting member sessions also removes them/); assert.doesNotMatch(text, /is empty/);
});

test('truly empty and ordinary session folders retain the old copy', function () {
  var f = fixture(); f.store.set({ projectSplitViews: [{ folderId: 'other' }] });
  assert.equal(f.api.describe(current(0)), 'The folder "Work" is empty. Deleting it does not affect any sessions.');
  assert.equal(f.api.describe(current(1)), 'The folder "Work" contains 1 session.');
});

test('stale project, owner, generation, socket and unavailable hydration cannot supply view display metadata', function () {
  [{ currentSlug: 'beta', activeProjectSlug: 'beta' }, { projectSplitViewRequestSlug: 'foreign' }, { myUserId: 'bob' },
    { projectSplitViewSocketGeneration: 3 }, { projectSplitViewHydrated: false }, { projectSplitViewError: 'unavailable' },
    { connected: false }, { dmMode: true }].forEach(function (patch) {
    var f = fixture(); f.store.set(patch); assert.doesNotMatch(f.api.describe(current(0)), /saved Split views|Favorites/);
  });
  var f = fixture(); f.replaceSocket(); assert.doesNotMatch(f.api.describe(current(0)), /saved Split views|Favorites/);
});

test('live metadata revisions refresh dialog description without new previews or effects', function () {
  var f = fixture(), paints = [];
  f.api.paint = function () { paints.push(f.api.describe(current(0))); };
  f.store.set({ sessionFolderDelete: current(0) });
  f.store.set({ projectSplitViews: [] });
  assert.match(paints[0], /saved Split views/); assert.match(paints[1], /is empty/);
  f.store.set({ projectSplitViews: [{ folderId: 'folder' }] }); assert.match(paints[2], /saved Split views/);
});
