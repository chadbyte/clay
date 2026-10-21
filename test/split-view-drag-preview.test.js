var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  var socket = {}, timers = [], reduced = false, classes = new Set();
  var binding = { requestId: 'pane-1', generation: 1, sessionId: 1, sessionOriginId: 'one' };
  var frame = { contentWindow: {}, contentDocument: {}, clayPane: { identity: function () { return { binding: binding }; } } };
  var pane = { isConnected: true, hidden: false, querySelector: function () { return frame; },
    getBoundingClientRect: function () { return { left: 0, top: 0, right: 500, bottom: 700, width: 500, height: 700 }; } };
  var host = { clientWidth: 1000, clientHeight: 700, querySelectorAll: function () { return [pane]; },
    classList: { add: function (key) { classes.add(key); }, remove: function (key) { classes.delete(key); }, contains: function (key) { return classes.has(key); } } };
  var api = vm.createContext({ getWs: function () { return socket; }, livePaneBinding: function () { return true; },
    samePaneBinding: function (a, b) { return JSON.stringify(a) === JSON.stringify(b); },
    setTimeout: function (fn, delay) { var timer = { fn: fn, delay: delay }; timers.push(timer); return timer; }, clearTimeout: function (timer) { timer.cancelled = true; },
    window: { requestAnimationFrame: function (fn) { fn(); }, getComputedStyle: function () { return {}; }, matchMedia: function () { return { matches: reduced }; } } });
  ['store', 'split-view-layout-client', 'split-view-layout-scope', 'split-view-presentation-drop', 'split-view-drag-preview'].forEach(function (name) {
    vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{.*$/gm, '').replace(/^export /gm, ''), api);
  });
  var view = { id: 'view', revision: 1, tree: api.preset(['one', 'two', 'three'], 'columns'),
    sessions: [{ id: 1, sessionOriginId: 'one' }, { id: 2, sessionOriginId: 'two' }, { id: 3, sessionOriginId: 'three' }] };
  api.store.set({ currentSlug: 'p', myUserId: 'owner', currentProjectOwnerId: 'owner', connected: true,
    projectSplitViewActiveId: view.id, projectSplitViews: [view] });
  var drag = { origin: 'one', sessionId: 1, sourceViewId: view.id };
  api.captureDragPreview(drag, host); api.store.set({ projectSplitViewDrag: drag });
  return { api: api, frame: frame, pane: pane, host: host, drag: drag, view: view, classes: classes, timers: timers,
    binding: binding, target: { origin: 'two', sessionId: 2, viewId: view.id, side: 'center' },
    reduced: function () { reduced = true; }, replaceBinding: function () { binding = Object.assign({}, binding, { generation: 2 }); } };
}
['center', 'left', 'right', 'top', 'bottom'].forEach(function (side) {
  test('preview uses the exact persisted drop tree for ' + side + ' placement', function () {
    var f = fixture(), target = Object.assign({}, f.target, { side: side });
    var box = f.api.renderDragPreview(f.drag, target);
    assert.ok(box && box.width > 0 && box.height > 0);
    assert.equal(f.api.store.get('projectSplitViewPreviewTree'), f.drag.preview.tree);
    assert.deepEqual(f.drag.preview.tree, f.api.presentationDropTree(f.drag, target, f.view, f.view));
    assert.equal(f.api.store.get('projectSplitViewPending'), undefined, 'hover creates no persisted mutation');
    f.pane.getBoundingClientRect = function () { return { left: 900, top: 900 }; };
    assert.equal(f.api.dragPreviewPaneAt(f.drag, 250, 300).pane, f.pane, 'hit testing retains the initial layout');
  });
});
['disconnect', 'owner', 'project', 'window', 'document', 'binding', 'revision', 'view', 'resize'].forEach(function (change) {
  test('preview refuses changed ' + change + ' context', function () {
    var f = fixture();
    if (change === 'disconnect') f.api.store.set({ connected: false });
    if (change === 'owner') f.api.store.set({ myUserId: 'foreign' });
    if (change === 'project') f.api.store.set({ currentSlug: 'foreign' });
    if (change === 'window') f.frame.contentWindow = {};
    if (change === 'document') f.frame.contentDocument = {};
    if (change === 'binding') f.replaceBinding();
    if (change === 'revision') f.api.store.set({ projectSplitViews: [Object.assign({}, f.view, { revision: 2 })] });
    if (change === 'view') f.api.store.set({ projectSplitViewActiveId: 'elsewhere' });
    if (change === 'resize') f.host.clientWidth = 1200;
    assert.equal(f.api.dragPreviewCurrent(f.drag), false);
    assert.equal(f.api.renderDragPreview(f.drag, f.target), null);
    assert.equal(f.api.store.get('projectSplitViewPreviewTree'), undefined);
  });
});
test('cancellation restores the saved layout and rapid restart cancels old motion cleanup', function () {
  var f = fixture(); f.api.renderDragPreview(f.drag, f.target);
  f.api.restoreDragPreview(f.drag, false); f.api.store.set({ projectSplitViewDrag: null });
  assert.equal(f.api.store.get('projectSplitViewPreviewTree'), null);
  assert.equal(f.view.tree, f.api.store.get('projectSplitViews')[0].tree);
  assert.equal(f.timers[0].delay, 320);
  f.api.captureDragPreview({}, f.host);
  assert.equal(f.timers[0].cancelled, true);
});
test('a queued drop retains its preview until the existing persistence receipt settles', function () {
  var f = fixture(); f.api.renderDragPreview(f.drag, f.target);
  f.api.store.set({ projectSplitViewPending: { requestId: 'save' } });
  f.api.restoreDragPreview(f.drag, true); f.api.store.set({ projectSplitViewDrag: null });
  assert.equal(f.api.store.get('projectSplitViewPreviewTree'), f.drag.preview.tree); assert.equal(f.timers.length, 0);
  f.api.store.set({ projectSplitViewPending: null, projectSplitViewPreviewTree: null });
  assert.equal(f.timers.length, 1);
});
test('scroll-lock completion waits for pane motion and honors reduced motion', function () {
  var f = fixture(), completed = 0; f.classes.add('split-view-drag-preview');
  f.api.afterPaneMotion(f.host, function () { completed++; });
  assert.equal(completed, 0); assert.equal(f.timers[0].delay, 300); f.timers[0].fn(); assert.equal(completed, 1);
  f.reduced(); f.api.afterPaneMotion(f.host, function () { completed++; }); assert.equal(completed, 2);
});
