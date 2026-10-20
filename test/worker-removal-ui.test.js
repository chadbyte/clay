var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), vm = require('node:vm');
var element = require('./fixtures/popup-tool-dom.cjs').element;
function fixture() {
  var target = { projectSlug: 'fixture', ownerId: 'owner', driverId: 1, driverOriginId: 'driver', workerId: 2, workerOriginId: 'worker', generation: 3 };
  var values = { connected: true, currentSlug: 'fixture', myUserId: 'owner' }, subscribers = [], sent = [], particles = [], errors = [], handlers = {}, focused = 0, modal = null, timers = [], cleared = [];
  var container = element('section'); container.isConnected = true;
  var pill = element('span'); pill.getBoundingClientRect = function () { return { left: 10, top: 20, width: 100, height: 20 }; }; container.appendChild(pill);
  var viewer = element('button'); viewer.className = 'split-view-worker-chip'; viewer.focus = function () { focused++; }; pill.appendChild(viewer);
  var socket = { readyState: 1, send: function (text) { sent.push(JSON.parse(text)); } };
  var store = { get: function (key) { return values[key]; }, set: function (patch) { var previous = Object.assign({}, values); Object.assign(values, patch); subscribers.forEach(function (fn) { fn(values, previous); }); }, subscribe: function (fn) { subscribers.push(fn); } };
  var api = vm.createContext({ getCachedSessions: function () { return [{ sessionOriginId: 'worker' }]; }, store: store, getWs: function () { return socket; },
    document: { createElement: function (tag) { var node = element(tag); node.isConnected = true; node.focus = function () { focused++; }; return node; }, getElementById: function () { return { focus: function () { focused++; } }; }, addEventListener: function (type, handler) { handlers[type] = handler; } },
    workerRemovalTarget: function () { return container.hidden || container.inert ? null : target; },
    iconHtml: function (name) { return '<i></i>'; }, refreshIcons: function () {}, crypto: { randomUUID: function () { return 'unique'; } },
    setTimeout: function (callback) { timers.push(callback); return timers.length; }, clearTimeout: function (id) { cleared.push(id); },
    showConfirm: function (text, confirm, label, destructive, cancel) { modal = { text: text, confirm: confirm, cancel: cancel }; },
    hideConfirm: function () { var old = modal; modal = null; if (old) old.cancel(); },
    showToast: function (text) { errors.push(text); }, spawnDustParticles: function (x, y) { particles.push([x, y]); }
  });
  vm.runInContext(fs.readFileSync('lib/public/modules/split-view-worker-removal.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), api);
  api.appendWorkerRemoval(pill, viewer, container, { sessionOriginId: 'driver' }, { sessionOriginId: 'worker', workerGeneration: 3 });
  var remove = pill.children[1];
  function result(status, extra) { api.handleWorkerRemovalResult(Object.assign({ requestId: 'remove_unique', projectSlug: 'fixture', workerOriginId: 'worker', generation: 3, status: status }, extra || {})); }
  return { api: api, store: store, sent: sent, remove: remove, pill: pill, container: container, particles: particles, errors: errors, handlers: handlers,
    timers: timers, cleared: cleared, result: result, modal: function () { return modal; }, focus: function () { return focused; }, retarget: function () { target = Object.assign({}, target, { generation: 4 }); } };
}
test('first click only arms; second sends exact session deletion; only observed deletion produces particles', function () {
  var f = fixture(); f.remove.click();
  assert.equal(f.sent.length, 0); assert.equal(f.remove.getAttribute('aria-pressed'), 'true');
  f.remove.click(); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].workerId, 2); assert.equal(f.sent[0].generation, 3);
  assert.equal(f.remove.disabled, true); assert.equal(f.particles.length, 0);
  f.result('removed'); assert.equal(f.particles.length, 1); assert.ok(f.focus() > 0);
  f.result('removed'); assert.equal(f.particles.length, 1);
});
test('active-at-confirmation dialog cancel preserves Worker; confirm sends only server-issued token', function () {
  for (var choice of ['cancel', 'confirm']) {
    var f = fixture(); f.remove.click(); f.remove.click();
    f.result('confirmation_required', { token: 'server-review' });
    assert.match(f.modal().text, /Stop and remove Worker/); assert.equal(f.sent.length, 1);
    f.modal()[choice]();
    assert.equal(f.sent[1].action, choice);
    if (choice === 'confirm') assert.equal(f.sent[1].token, 'server-review');
    assert.equal(f.particles.length, 0);
  }
});
test('Escape, outside click, source revision and disconnect disarm without removal', function () {
  for (var action of ['escape', 'outside', 'revision', 'disconnect']) {
    var f = fixture(); f.remove.click();
    if (action === 'escape') f.handlers.keydown({ key: 'Escape', preventDefault: function () {}, stopImmediatePropagation: function () {} });
    if (action === 'outside') f.handlers.click({ target: element('div') });
    if (action === 'revision') f.store.set({ projectSplitViewRevision: 2 });
    if (action === 'disconnect') f.store.set({ connected: false });
    assert.equal(f.store.get('splitViewWorkerRemoval'), null); assert.equal(f.sent.length, 0);
  }
});
test('stale generation, hidden source and detached controls cannot confirm; failed outcomes never animate', function () {
  for (var change of ['generation', 'hidden', 'detached']) {
    var f = fixture(); f.remove.click();
    if (change === 'generation') f.retarget();
    if (change === 'hidden') f.container.hidden = true;
    if (change === 'detached') f.remove.isConnected = false;
    f.remove.click(); assert.equal(f.sent.length, 0, change);
  }
  var failed = fixture(); failed.remove.click(); failed.remove.click(); failed.result('failed', { error: 'Stop failed' });
  assert.equal(failed.particles.length, 0); assert.deepEqual(failed.errors, ['Stop failed']);
});
test('foreign result is ignored and pending removal is cancelled on disconnect without replay', function () {
  var f = fixture(); f.remove.click(); f.remove.click();
  f.result('removed', { generation: 9 }); assert.equal(f.particles.length, 0);
  f.store.set({ connected: false }); assert.equal(f.sent[1].action, 'cancel');
  f.store.set({ connected: true }); assert.equal(f.sent.length, 2);
  f.result('removed'); assert.equal(f.particles.length, 0);
});
test('semantic pill has sibling viewer and removal buttons; existing dust helper honors reduced motion', function () {
  var source = fs.readFileSync('lib/public/modules/split-view-workers.js', 'utf8');
  assert.match(source, /pill.appendChild\(button\); root.appendChild\(pill\)/);
  assert.match(source, /appendWorkerRemoval\(pill, button, container, driver, worker\)/);
  var sidebar = fs.readFileSync('lib/public/modules/sidebar.js', 'utf8');
  var dust = sidebar.slice(sidebar.indexOf('export function spawnDustParticles')).replace(/^export /, '');
  var sandbox = vm.createContext({ window: { matchMedia: function () { return { matches: true }; } } });
  vm.runInContext(dust, sandbox); assert.equal(sandbox.spawnDustParticles(1, 2), null);
});

test('routine list/status refresh preserves pending Stop while changed generation cancels it', function () {
  var f = fixture(); f.remove.click(); f.remove.click();
  f.store.set({ paneBindingSessions: [{ id: 2, isProcessing: false }] });
  assert.equal(f.store.get('splitViewWorkerRemoval').phase, 'pending'); assert.equal(f.sent.length, 1);
  f.retarget(); f.store.set({ paneBindingSessions: [{ id: 2, workerGeneration: 4 }] });
  assert.equal(f.store.get('splitViewWorkerRemoval'), null); assert.equal(f.sent[1].action, 'cancel');
});

function assertDataOnly(record) {
  assert.deepEqual(Object.keys(record).sort(), (record.phase === 'armed' ? ['phase', 'target'] : ['center', 'phase', 'requestId', 'target']).sort());
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(record))), JSON.stringify(record));
}
test('removal store stays data-only through arm, pending, review and confirmation', function () {
  var f = fixture(); f.remove.click(); assertDataOnly(f.store.get('splitViewWorkerRemoval'));
  f.remove.click(); assertDataOnly(f.store.get('splitViewWorkerRemoval'));
  f.result('confirmation_required', { token: 'review-token' });
  assertDataOnly(f.store.get('splitViewWorkerRemoval')); assert.deepEqual(f.cleared, [1]);
  f.modal().confirm(); assertDataOnly(f.store.get('splitViewWorkerRemoval'));
  f.result('removed'); assert.equal(f.store.get('splitViewWorkerRemoval'), null);
  assert.deepEqual(f.cleared, [1, 2]); assert.equal(f.particles.length, 1);
});
test('rerender rebinds resources without replacing pending receipt and timeout cancels exactly once', function () {
  var f = fixture(); f.remove.click(); f.remove.click();
  var pending = f.store.get('splitViewWorkerRemoval');
  f.remove.isConnected = false;
  f.api.appendWorkerRemoval(f.pill, f.pill.children[0], f.container, { sessionOriginId: 'driver' }, { sessionOriginId: 'worker', workerGeneration: 3 });
  var replacement = f.pill.children[2];
  assert.equal(f.store.get('splitViewWorkerRemoval'), pending); assert.equal(replacement.disabled, true);
  f.timers[0](); assert.equal(f.store.get('splitViewWorkerRemoval'), null);
  assert.equal(replacement.disabled, false); assert.equal(f.sent.length, 2); assert.equal(f.sent[1].action, 'cancel');
  f.timers[0](); f.result('removed'); assert.equal(f.sent.length, 2); assert.equal(f.particles.length, 0);
});
