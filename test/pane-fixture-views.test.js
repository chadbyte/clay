var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
var createStore = require('../lib/project-split-views').createSplitViewsStore;
function fixture(t) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-fixture-view-contract-'));
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var sessions = new Map(), sequence = 0;
  function create(title) { var session = { localId: ++sequence, sessionOriginId: 'origin-' + sequence, ownerId: 'owner', title: title }; sessions.set(sequence, session); return session; }
  return { viewStore: createStore({ slug: 'reuse', sessionsDir: directory }), create: create, sm: { sessions: sessions }, require: function (name) { assert.equal(name, '../../lib/split-view-layout'); return require('../lib/split-view-layout'); } };
}
test('appearance fixture seeds a valid two-session view without presenting its linked Worker as a pane', function (t) {
  var f = fixture(t); f.driver = f.create('Driver'); f.worker = f.create('Worker');
  var source = fs.readFileSync(path.join(__dirname, 'fixtures/appearance-pane-server.cjs'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf("var companion = create('Companion')"), source.indexOf("var original = relay.server.listeners('request')")), f);
  var state = f.viewStore.state('owner', null);
  assert.equal(state.views.length, 1); assert.deepEqual(state.views[0].sessionRefs.map(function (ref) { return ref.originId; }), [f.driver.sessionOriginId, f.companion.sessionOriginId]);
  assert.equal(state.views[0].sessionRefs.some(function (ref) { return ref.originId === f.worker.sessionOriginId; }), false);
});
test('restore fixture exposes exact saved-view members while preserving the linked Worker identity', function (t) {
  var f = fixture(t); var driver = f.create('Driver'), worker = f.create('Worker');
  f.groups = [{ pair: { driverId: driver.localId, workerId: worker.localId } }]; f.process = { env: { CLAY_PANE_PRESENTATION: '1' } };
  var source = fs.readFileSync(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('var restoreView = null;'), source.indexOf("var original = relay.server.listeners('request')")), f);
  assert.equal(f.restoreView.workerId, worker.localId); assert.equal(f.restoreView.members.length, 2); assert.equal(f.restoreView.members.includes(worker.localId), false);
  assert.equal(f.viewStore.state('owner', null).views[0].id, f.restoreView.id);
});
