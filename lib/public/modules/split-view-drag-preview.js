import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { livePaneBinding, samePaneBinding } from './pane-binding.js';
import { layoutScope, currentLayoutScope } from './split-view-layout-scope.js';
import { presentationDropTree } from './split-view-presentation-drop.js';
import { rectangles } from './split-view-layout-client.js';

function activeView() {
  return (store.get('projectSplitViews') || []).find(function (view) { return view.id === store.get('projectSplitViewActiveId'); });
}
function reducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
export function captureDragPreview(drag, host) {
  var settling = store.get('projectSplitViewDragSettling');
  if (settling && settling.timer) clearTimeout(settling.timer);
  store.set({ projectSplitViewDragSettling: null });
  var view = activeView();
  drag.preview = { host: host, socket: getWs(), slug: store.get('currentSlug'), owner: store.get('myUserId'), projectOwner: store.get('currentProjectOwnerId'),
    scope: view && layoutScope(view), width: host.clientWidth, height: host.clientHeight, tree: null,
    panes: Array.from(host.querySelectorAll(':scope > .split-pane:not(.split-pane-cached)')).filter(function (pane) {
      return !pane.hidden && pane.getBoundingClientRect().width > 0;
    }).map(function (pane) {
      var frame = pane.querySelector('.split-pane-frame'), live = frame && frame.clayPane && frame.clayPane.identity();
      return { pane: pane, frame: frame, document: frame && frame.contentDocument, window: frame && frame.contentWindow,
        binding: live && live.binding, rect: pane.getBoundingClientRect() };
    }) };
}
export function dragPreviewCurrent(drag) {
  var preview = drag.preview;
  return !!preview && preview.socket === getWs() && preview.slug === store.get('currentSlug') && preview.owner === store.get('myUserId') &&
    preview.projectOwner === store.get('currentProjectOwnerId') && store.get('connected') && !store.get('projectSplitViewDividerDrag') && (!preview.scope || currentLayoutScope(preview.scope)) &&
    preview.width === preview.host.clientWidth && preview.height === preview.host.clientHeight && preview.panes.every(function (entry) {
      var live = entry.frame && entry.frame.clayPane && entry.frame.clayPane.identity();
      return entry.pane.isConnected && entry.frame.contentDocument === entry.document && entry.frame.contentWindow === entry.window &&
        live && samePaneBinding(live.binding, entry.binding) && livePaneBinding(entry.frame);
    });
}
// Hit-test the starting layout, never panes that are travelling under the hand.
export function dragPreviewPaneAt(drag, x, y) {
  var entries = drag && drag.preview && drag.preview.panes || [];
  return entries.find(function (entry) {
    var r = entry.rect; return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
}
export function renderDragPreview(drag, target) {
  var preview = drag.preview, view = activeView();
  if (!preview || !view || !dragPreviewCurrent(drag)) return null;
  var sourceView = (store.get('projectSplitViews') || []).find(function (item) { return item.id === drag.sourceViewId; });
  var tree = target && !target.sidebar && target.viewId === view.id && sourceView && sourceView.id === view.id && !store.get('projectSplitViewFocusedOrigin') ?
    presentationDropTree(drag, target, sourceView, view) : null;
  if (JSON.stringify(tree) === JSON.stringify(preview.tree)) return preview.dropRect || null;
  preview.tree = tree;
  preview.host.classList.add('split-view-drag-preview');
  store.set({ projectSplitViewPreviewTree: tree, projectSplitViewPreviewScope: preview.scope });
  preview.dropRect = null;
  if (tree) {
    var style = window.getComputedStyle(preview.host), left = parseFloat(style.paddingLeft) || 0, top = parseFloat(style.paddingTop) || 0;
    var geometry = rectangles(tree, preview.width - left - (parseFloat(style.paddingRight) || 0), preview.height - top - (parseFloat(style.paddingBottom) || 0), 7);
    var rect = geometry.panes[drag.origin];
    if (rect) preview.dropRect = { left: left + rect.x, top: top + rect.y, width: rect.width, height: rect.height };
  }
  return preview.dropRect;
}
function settleMotion() {
  var settling = store.get('projectSplitViewDragSettling');
  if (!settling || settling.timer || store.get('projectSplitViewDrag') || store.get('projectSplitViewPending')) return;
  settling.timer = setTimeout(function () {
    if (store.get('projectSplitViewDragSettling') !== settling) return;
    settling.host.classList.remove('split-view-drag-preview');
    store.set({ projectSplitViewDragSettling: null });
  }, reducedMotion() ? 0 : 320);
}
export function restoreDragPreview(drag, keep) {
  var preview = drag && drag.preview;
  if (!preview) return;
  if (!keep && preview.tree && store.get('projectSplitViewPreviewTree') === preview.tree) {
    store.set({ projectSplitViewPreviewTree: null, projectSplitViewPreviewScope: null });
  }
  var previous = store.get('projectSplitViewDragSettling');
  if (previous && previous.timer) clearTimeout(previous.timer);
  store.set({ projectSplitViewDragSettling: { host: preview.host, timer: null } });
  settleMotion();
}
// Preserve transcript anchors until animated width/height changes have settled.
export function afterPaneMotion(host, callback) {
  window.requestAnimationFrame(function () {
    if (host.classList.contains('split-view-drag-preview') && !reducedMotion()) setTimeout(callback, 300);
    else callback();
  });
}
store.subscribe(function () { settleMotion(); });
