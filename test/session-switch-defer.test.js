var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  var busy = true, tasks = [], delivered = [], status = null, socket = {};
  var context = vm.createContext({ getWs: function () { return socket; }, composerDepartureReason: function () { return busy ? 'Upload pending' : ''; },
    processMessage: function (message) { delivered.push(message); }, queueMicrotask: function (callback) { tasks.push(callback); },
    document: { getElementById: function (id) { return id === 'session-switch-wait' ? status : { prepend: function (element) { status = element; } }; },
      createElement: function () { return { setAttribute: function () {}, remove: function () { status = null; } }; } },
  });
  ['store', 'session-switch-defer'].forEach(function (name) {
    vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  });
  context.createStore({ connected: true, currentSlug: 'alpha', myUserId: 'owner', activeSessionId: 1, sessionOriginId: 'source', processing: true, composerUploadingCount: 1 });
  return { context: context, delivered: delivered, status: function () { return status; }, settle: function () { busy = false; context.store.set({ composerUploadingCount: 0 }); while (tasks.length) tasks.shift()(); } };
}
test('a deferred deleted or replaced destination stays blocked until a fresh exact authoritative selection', function () {
  var f = fixture(), receive = f.context.deferSessionSwitch;
  receive({ type: 'session_switched', id: 2, sessionOriginId: 'old' });
  receive({ type: 'history_done', sessionId: 2 });
  receive({ type: 'session_list', sessions: [{ id: 2, sessionOriginId: 'replacement' }] });
  f.settle();
  assert.equal(f.delivered.length, 0);
  assert.ok(f.context.store.get('deferredSessionSwitch'));
  assert.match(f.status().textContent, /conversation changed/);
  receive({ type: 'session_switched', id: 3, sessionOriginId: 'fresh' });
  receive({ type: 'session_list', sessions: [{ id: 3, sessionOriginId: 'fresh' }] });
  f.settle();
  assert.equal(f.context.store.get('deferredSessionSwitch'), null);
  assert.equal(f.delivered.at(-2).sessionOriginId, 'fresh');
});
test('revocation bypasses the deferred queue and never restores its old transcript', function () {
  var f = fixture();
  f.context.deferSessionSwitch({ type: 'session_switched', id: 2, sessionOriginId: 'target' });
  assert.equal(f.context.deferSessionSwitch({ type: 'project_access_revoked' }), false);
  f.settle(); assert.equal(f.delivered.length, 0); assert.equal(f.status(), null);
});
