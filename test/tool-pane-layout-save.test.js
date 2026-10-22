var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(savedView) {
  var socket = {}, base = { id: 'session-origin' }, receipt = { key: JSON.stringify(['project', 'owner', 'session-origin']), base: base, socket: socket, scope: 'owner-scope', revision: 4 };
  var state = { currentSlug: 'project', currentProjectOwnerId: 'owner', projectSplitViewSingletonOrigin: 'session-origin', connected: true, toolPaneWindowGeometry: receipt, workbenchLayoutPreference: { revision: 4 } };
  var saved = [], notices = [], api = vm.createContext({
    store: { get: function (key) { return state[key]; }, snap: function () { return state; }, subscribe: function () {} },
    getWs: function () { return socket; }, activeSavedView: function () { return savedView; }, copy: function (value) { return JSON.parse(JSON.stringify(value)); },
    fromDisplayTree: function (workspace, tree) { return tree; }, persistWorkspace: function (value) { saved.push(value); return true; },
    saveWorkbenchWindowLayout: async function (key, tree, layoutBase) { saved.push({ key: key, tree: tree, base: layoutBase }); return true; },
    showToast: function (message) { notices.push(message); }
  });
  vm.runInContext(fs.readFileSync('lib/public/modules/tool-pane-layout.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), api);
  return { api: api, state: state, saved: saved, notices: notices, receipt: receipt };
}
test('single-session pane drops persist through the authenticated layout preference service', async function () {
  var f = fixture(), tree = { axis: 'horizontal', ratio: .5, left: { id: 'tool-browser' }, right: f.receipt.base };
  assert.equal(await f.api.saveToolPaneTree(f.receipt, tree), true);
  assert.deepEqual(f.saved, [{ key: f.receipt.key, tree: tree, base: f.receipt.base }]);
  assert.deepEqual(f.notices, []);
});
test('stale pane context or revision cannot persist a tool drop', async function () {
  var f = fixture(); f.state.currentSlug = 'other';
  assert.equal(await f.api.saveToolPaneTree(f.receipt, { id: 'tool-browser' }), false);
  f.state.currentSlug = 'project'; f.state.toolPaneWindowGeometry = Object.assign({}, f.receipt, { revision: 5 });
  assert.equal(await f.api.saveToolPaneTree(f.receipt, { id: 'tool-browser' }), false);
  assert.equal(f.saved.length, 0);
});
test('layout save failures retain a useful error and saved Views use workspace persistence', async function () {
  var f = fixture(); f.api.saveWorkbenchWindowLayout = async function () { return false; }; f.state.workbenchLayoutPreference.error = 'Connection changed.';
  assert.equal(await f.api.saveToolPaneTree(f.receipt, {}), false); assert.equal(f.notices[0], 'Connection changed.');
  f = fixture({ workspace: { panes: [] } });
  var tree = { id: 'tool-browser' }; assert.equal(await f.api.saveToolPaneTree(f.receipt, tree), true);
  assert.deepEqual(f.saved, [{ panes: [], tree: tree }]);
});
