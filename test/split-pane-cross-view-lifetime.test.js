var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), vm = require('node:vm');
// Production reconciler, retention policy and binding guards; no transports.
function fixture(retain) {
  var socket = {}, mounted = [], created = [], removed = [], appends = 0;
  var sessions = Array.from({ length: 24 }, function (_, i) { return { id: i + 1, sessionOriginId: 'origin-' + (i + 1), sessionRole: 'driver', ownerId: 'owner', vendor: i % 2 ? 'codex' : 'claude' }; });
  var host = { querySelectorAll: function (selector) { return mounted.filter(function (node) { return selector.includes('split-pane-cached') || node.classList.contains('split-pane'); }); },
    appendChild: function (pane) { assert.equal(pane.parentNode, undefined, 'never reparent an iframe section'); appends++; mounted.push(pane); pane.parentNode = host; } };
  var context = vm.createContext({ Event: function (type) { this.type = type; }, getCachedSessions: function () { return sessions; }, getWs: function () { return socket; }, window: { addEventListener: function () {} } });
  ['store', 'pane-binding', 'split-pane-reconciler', 'split-pane-retention'].forEach(function (name) {
    vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, ''), context);
  });
  context.store.set({ connected: true, authIdentityLoaded: true, currentSlug: 'project', activeProjectSlug: 'project', sessionListProjectSlug: 'project',
    currentProjectOwnerId: 'owner', myUserId: 'owner', controlRuntimeId: 'runtime', cwd: '/project', projectSplitViewSocketGeneration: 1, paneBindingSessions: sessions });
  function render(ids, ready) {
    var retention = retain === false ? null : context.paneRetention(host);
    context.reconcileSplitPanes(host, ids.map(function (id) { return { slug: 'project', sessionId: id }; }), function () {
      var classes = new Set(['split-pane']), live = null;
      var header = { inert: false, events: [], dispatchEvent: function (event) { this.events.push(event.type); } };
      var frame = { dataset: { projectSlug: 'project' }, contentWindow: {}, contentDocument: {}, srcAssignments: 1, dispatchEvent: function () {},
        closest: function (selector) { return selector === '.split-pane-cached' && classes.has('split-pane-cached') ? pane : null; } };
      var pane = { dataset: {}, style: {}, frame: frame, header: header,
        classList: { add: function (name) { classes.add(name); }, remove: function (name) { classes.delete(name); }, contains: function (name) { return classes.has(name); } },
        querySelector: function (selector) { return selector === '.split-pane-frame' ? frame : header; }, remove: function () {
          if (mounted.includes(pane)) mounted.splice(mounted.indexOf(pane), 1); pane.parentNode = null; removed.push(pane);
        } };
      frame.clayPane = ready === false ? null : { source: frame.contentWindow, document: frame.contentDocument,
        identity: function () { return live; }, suspend: function () { if (live) live.ready = false; },
        activate: function (model) { live = { ready: true, sessionId: model.sessionId, ownerId: 'owner', projectSlug: 'project', binding: Object.assign(context.paneTarget(context.store.snap(), sessions, model.sessionId), { generation: (live && live.binding.generation || 0) + 1 }) }; } };
      created.push(pane); return pane;
    }, function (pane, model) {
      pane.dataset.sessionId = model.sessionId; pane.frame.dataset.sessionId = String(model.sessionId); pane.frame.dataset.sessionOriginId = 'origin-' + model.sessionId;
      if (pane.frame.clayPane) pane.frame.clayPane.activate(model);
    }, retention);
    return mounted.filter(function (node) { return node.classList.contains('split-pane'); });
  }
  return { render: render, mounted: mounted, created: created, removed: removed, host: host, sessions: sessions, context: context, replaceSocket: function () { socket = {}; context.store.set({}); }, appends: function () { return appends; } };
}
test('eight to singleton to eight retains all contexts attached to the same host', function () {
  var f = fixture(), first = f.render([1,2,3,4,5,6,7,8]), docs = first.map(function (node) { return node.frame.contentDocument; });
  assert.equal(f.render([9]).length, 1); assert.equal(f.mounted.length, 8); assert.equal(f.removed.length, 0);
  assert.equal(f.mounted.filter(function (node) { return node.hidden && node.inert && node.style.display === 'none' && node.header.inert; }).length, 7);
  assert.ok(f.mounted.filter(function (node) { return node.hidden; }).every(function (node) { return !node.frame.clayPane.identity().ready; }));
  var back = f.render([1,2,3,4,5,6,7,8]);
  assert.equal(back.length, 8); assert.equal(f.created.length, 8); assert.equal(f.appends(), 8); assert.equal(f.removed.length, 0);
  assert.deepEqual(f.mounted.map(function (node) { return node.frame.contentDocument; }), docs);
  assert.ok(f.mounted.every(function (node) { return node.frame.srcAssignments === 1 && !node.hidden && !node.inert; }));
});
test('exact matches are reserved before same-project retargeting and reorder does not move DOM', function () {
  var f = fixture(), first = f.render([1,2,3,4]); f.render([9]); f.render([4,2,1,3]);
  assert.equal(f.created.length, 4); assert.equal(f.mounted[1], first[1]); assert.equal(f.mounted[1].dataset.sessionId, 2);
  assert.equal(f.mounted[3].dataset.sessionId, 4); assert.equal(f.appends(), 4);
});
test('legacy reconciliation still destroys excess and never retargets cold frames', function () {
  var f = fixture(false); f.render([1,2,3,4,5,6,7,8]); f.render([9]); assert.equal(f.removed.length, 7);
  var cold = fixture(); cold.render([1,2,3,4], false); cold.render([5,6,7,8]); assert.equal(cold.created.length, 8); assert.equal(cold.removed.length, 4);
});
test('pool never exceeds eight; eviction is unused LRU, never a desired active context', function () {
  var f = fixture(); f.render([1,2,3,4,5,6,7,8]); f.render([1]);
  // Simulate unusable child APIs: these cannot be retargeted or retained.
  f.mounted.slice(1).forEach(function (node) { node.frame.clayPane = null; });
  var protectedNode = f.mounted[0]; f.render([1,9,10,11,12,13,14,15]);
  assert.equal(f.mounted.length, 8); assert.ok(f.mounted.includes(protectedNode)); assert.equal(f.created.length, 15);
  assert.equal(f.removed[0].dataset.sessionId, 2);
});
test('account/project/runtime/directory and mode changes evict managed contexts', function () {
  [{ myUserId: 'foreign' }, { currentProjectOwnerId: 'foreign' }, { currentSlug: 'other' }, { controlRuntimeId: 'new' }, { cwd: '/other' },
    { isOsUsers: true }, { paneOsIdentity: 'other' }, { dmMode: true }, { activeProjectMateId: 'mate' }].forEach(function (change) {
    var f = fixture(); f.render([1,2,3]); f.render([1]); f.context.store.set(change); assert.equal(f.mounted.length, 0, JSON.stringify(change));
  });
});
test('deleted, foreign, hidden, replaced and changed-role cached sessions are evicted', function () {
  [function (s) { s.hidden = true; }, function (s) { s.ownerId = 'foreign'; }, function (s) { s.sessionOriginId = 'replacement'; }, function (s) { s.sessionRole = 'worker'; }, function (s) { s.mode = 'tui'; }].forEach(function (change) {
    var f = fixture(); f.render([1,2]); f.render([1]); change(f.sessions[1]); f.context.store.set({ paneBindingSessions: f.sessions.slice() });
    assert.equal(f.mounted.length, 1); assert.equal(f.mounted[0].dataset.sessionId, 1);
  });
  var f = fixture(); f.render([1,2]); f.render([1]); f.sessions.splice(1,1); f.context.store.set({ paneBindingSessions: f.sessions.slice() }); assert.equal(f.mounted.length,1);
});
test('cached frames cannot pass live binding even if a stale child reports ready; teardown removes them', function () {
  var f = fixture(); f.render([1,2]); f.render([1]); var cached = f.mounted.find(function (node) { return node.hidden; });
  cached.frame.clayPane.identity().ready = true;
  f.context.store.set({ projectSplitViewSingletonOrigin: 'origin-2' }); assert.equal(f.context.livePaneBinding(cached.frame), false);
  f.context.clearRetainedPanes(f.host); assert.equal(f.mounted.length,0);
});

test('socket replacement clears cached contexts and invalidates warm receipts; removing a view clears cached entries', function () {
  var f = fixture(); f.render([1,2]); f.render([1]); f.replaceSocket(); assert.equal(f.mounted.length, 1);
  assert.equal(f.context.paneRetention(f.host).retain(f.mounted[0]), false, 'changed transport invalidates warm reuse');
  var other = fixture(); other.context.store.set({ projectSplitViews: [{ id: 'saved' }] }); other.render([1,2]); other.render([1]);
  other.context.store.set({ projectSplitViews: [] }); assert.equal(other.mounted.length, 1); assert.equal(other.mounted[0].dataset.sessionId, 1);
});


test('entering legacy mode releases active nodes but evicts hidden pool entries', function () {
  var f = fixture(); f.render([1,2,3]); f.render([1,2]);
  var active = f.mounted.slice(0,2), cached = f.mounted[2];
  f.context.store.set({ splitPanes: { panes: [{ sessionId: 1 }, { sessionId: 2 }] } });
  assert.equal(f.mounted.length, 2); assert.ok(f.removed.includes(cached));
  assert.equal(f.context.paneRetention(f.host), null);
  assert.equal(f.mounted[0], active[0]); assert.equal(f.mounted[1], active[1]);
  f.context.clearRetainedPanes(f.host); assert.equal(f.mounted.length, 2, 'released legacy nodes are not owned by the pool');
});


test('parent disconnect and generation invalidate parent reuse while the independent visible child retains its source', function () {
  [{ connected: false }, { projectSplitViewSocketGeneration: 2 }].forEach(function (change) {
    var f = fixture(); f.render([1,2]); f.render([1]); var active = f.mounted[0], old = active.frame.clayPane.identity().binding.generation;
    f.context.store.set(change);
    assert.equal(f.mounted.length, 1); assert.equal(f.mounted[0], active);
    assert.equal(active.frame.clayPane.identity().ready, true, 'child socket remains authenticated independently'); assert.equal(active.header.inert, true);
    assert.equal(f.context.livePaneBinding(active.frame), false);
    f.context.store.set({ connected: true });
    assert.equal(active.frame.clayPane.identity().ready, true, 'source authority was never transferred');
    assert.equal(f.context.paneRetention(f.host).retain(active), false, 'reconnect alone cannot revive the parent warm receipt');
    f.render([1]);
    assert.ok(active.frame.clayPane.identity().binding.generation > old);
    assert.equal(active.frame.clayPane.identity().ready, true);
  });
});

test('parent reconnect retains exact visible child authority but discards cached contexts', function () {
  var f = fixture(); f.render([1,2]);
  var live = f.render([1])[0], doc = live.frame.contentDocument;
  f.context.store.set({ projectSplitViewHydrated: true });
  assert.equal(f.context.preserveReconnectingPresentation(f.host), false);
  f.context.store.set({ connected: false });
  assert.equal(f.mounted.length, 1, 'cached child was discarded at the transport boundary');
  assert.equal(f.context.preserveReconnectingPresentation(f.host), true);
  assert.equal(live.frame.clayPane.identity().ready, true, 'independent authenticated child socket keeps Stop available');
  f.context.store.set({ activeProjectSlug: null, sessionListProjectSlug: null, projectSplitViewHydrated: false, projectSplitViewSocketGeneration: 2 });
  f.replaceSocket();
  f.context.store.set({ connected: true });
  assert.equal(f.context.preserveReconnectingPresentation(f.host), true, 'wait for authoritative parent hydration without destroying the draft');
  assert.equal(live.frame.contentDocument, doc);
  f.context.store.set({ activeProjectSlug: 'project', sessionListProjectSlug: 'project', projectSplitViewHydrated: true });
  assert.equal(f.context.preserveReconnectingPresentation(f.host), false);
  f.context.store.set({ myUserId: 'replacement' });
  assert.equal(f.mounted.length, 0, 'identity replacement still tears down the old document');
  assert.equal(f.context.preserveReconnectingPresentation(f.host), false);
});

test('reconnect preservation refuses an unbound child document', function () {
  var f = fixture(); f.render([1], false);
  f.context.store.set({ connected: false });
  assert.equal(f.context.preserveReconnectingPresentation(f.host), false);
});

test('ordinary View members retain exact bindings alongside a live linked Worker presentation', function () {
  var f = fixture(), frame = f.render([3])[0].frame;
  var view = { id: 'view', sessions: [{ id: 1, sessionOriginId: 'origin-1' }, { id: 3, sessionOriginId: 'origin-3' }], workspace: { linkedPair: { groupId: 'pair', driverOriginId: 'origin-1' } } };
  f.context.store.set({ projectSplitViewActiveId: 'view', projectSplitViews: [view], splitPanes: { groupId: 'pair', panes: [{ slug: 'project', sessionId: 1 }, { slug: 'project', sessionId: 2 }] }, splitGroups: [{ id: 'pair', members: [1, 2], pair: { driverId: 1, workerId: 2 } }] });
  assert.equal(!!f.context.livePaneBinding(frame), true);
  f.context.store.set({ splitPanes: { groupId: 'foreign', panes: [] } }); assert.equal(!!f.context.livePaneBinding(frame), false);
  f.context.store.set({ splitPanes: { groupId: 'pair', panes: [] }, splitGroups: [{ id: 'pair', members: [2, 4], pair: { driverId: 4, workerId: 2 } }] }); assert.equal(!!f.context.livePaneBinding(frame), false);
  f.context.store.set({ splitGroups: [{ id: 'pair', members: [1, 2], pair: { driverId: 1, workerId: 2 } }], projectSplitViewActiveId: 'other' }); assert.equal(!!f.context.livePaneBinding(frame), false);
});
