var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(mode) {
  var state = { currentSlug: 'project', myUserId: 'owner', workbenchLayoutPreference: { mode: mode || 'docked', ready: true } }, observers = [], closed = [];
  var store = { get: function (key) { return state[key]; }, subscribe: function (fn) { observers.push(fn); }, set: function (patch) {
    var previous = state; state = Object.assign({}, state, patch); observers.forEach(function (fn) { fn(state, previous); });
  } };
  var api = { store: store };
  vm.runInNewContext(fs.readFileSync('lib/public/modules/right-workbench.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''), api);
  ['terminal', 'browser', 'file-viewer'].forEach(function (name) { api.registerRightWorkbench(name, function () { closed.push(name); api.releaseRightWorkbench(name); }); });
  return { api: api, store: store, closed: closed, docks: function () { return Array.from(store.get('rightWorkbenchDockedOwners')); } };
}
test('docked terminal survives Browser overlay, which is replaced by Files; closing reveals the dock', function () {
  var f = fixture(), terminalRevision = f.api.claimRightWorkbench('terminal');
  assert.deepEqual(f.docks(), ['terminal']); f.closed.length = 0;
  var browserRevision = f.api.claimRightWorkbench('browser');
  assert.equal(f.closed.includes('terminal'), false);
  assert.equal(f.api.isRightWorkbenchCurrent('terminal', terminalRevision), true);
  f.closed.length = 0; f.api.claimRightWorkbench('file-viewer');
  assert.deepEqual(f.closed, ['browser']);
  assert.equal(f.api.isRightWorkbenchCurrent('browser', browserRevision), false);
  f.api.releaseRightWorkbench('file-viewer');
  assert.equal(f.store.get('rightWorkbenchOwner'), 'terminal');
  assert.equal(f.api.isRightWorkbenchCurrent('terminal', terminalRevision), true);
});
test('dock a second tool without destroying either background pane', function () {
  var f = fixture(); f.api.claimRightWorkbench('terminal'); f.api.claimRightWorkbench('browser'); f.api.setDocked('browser', true);
  assert.deepEqual(f.docks(), ['terminal', 'browser']);
  f.closed.length = 0; f.api.claimRightWorkbench('file-viewer'); assert.deepEqual(f.closed, []);
  f.api.releaseRightWorkbench('browser'); assert.deepEqual(f.docks(), ['terminal']);
  assert.equal(f.store.get('rightWorkbenchOwner'), 'file-viewer');
});
test('async file receipts remain exact while Files is docked behind Browser', function () {
  var f = fixture(), revision = f.api.claimRightWorkbench('file-viewer'); f.api.claimRightWorkbench('browser');
  assert.equal(f.api.rightWorkbenchRevisionFor('file-viewer'), revision);
  assert.equal(f.api.isRightWorkbenchCurrent('file-viewer', revision), true);
  f.api.claimRightWorkbench('file-viewer');
  assert.equal(f.store.get('rightWorkbenchOwner'), 'browser', 'updating a background file does not dismiss the overlay');
  assert.equal(f.api.isRightWorkbenchCurrent('file-viewer', revision), false, 'old content cannot overwrite a newer file request');
  f.api.releaseRightWorkbench('file-viewer'); assert.equal(f.api.isRightWorkbenchCurrent('file-viewer', revision), false);
});
test('floating a dock becomes the single overlay while preserving other docks', function () {
  var f = fixture(); f.api.claimRightWorkbench('terminal'); f.api.claimRightWorkbench('browser'); f.api.setDocked('browser', true);
  f.api.claimRightWorkbench('file-viewer'); f.closed.length = 0; f.api.setDocked('terminal', false);
  assert.deepEqual(f.docks(), ['browser']); assert.deepEqual(f.closed, ['file-viewer']);
  assert.equal(f.store.get('rightWorkbenchOwner'), 'terminal');
});
test('ordinary overlays keep existing exclusive behavior', function () {
  var f = fixture('overlay'), first = f.api.claimRightWorkbench('terminal'); f.closed.length = 0;
  f.api.claimRightWorkbench('browser'); assert.ok(f.closed.includes('terminal')); assert.deepEqual(f.docks(), []);
  assert.equal(f.api.isRightWorkbenchCurrent('terminal', first), false);
});
['currentSlug', 'myUserId'].forEach(function (field) {
  test('context change closes docks and overlays and invalidates old receipts: ' + field, function () {
    var f = fixture(), revision = f.api.claimRightWorkbench('terminal'); f.api.claimRightWorkbench('browser');
    var patch = {}; patch[field] = 'replacement'; f.store.set(patch);
    assert.deepEqual(f.docks(), []); assert.equal(f.store.get('rightWorkbenchOwner'), null);
    assert.equal(f.api.isRightWorkbenchCurrent('terminal', revision), false);
  });
});
