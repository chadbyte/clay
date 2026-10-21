import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { livePaneBinding, samePaneBinding } from './pane-binding.js';
import { insertWindow } from './tool-pane-tree.js';
import { resize } from './split-view-layout-client.js';
import { repaintToolPanes, saveToolPaneTree, toolPaneContext } from './tool-pane-layout.js';

function receiptCurrent(drag) {
  var current = store.get('toolPaneWindowGeometry');
  return current && current.key === toolPaneContext() && store.get('connected') && current.key === drag.receipt.key && current.socket === getWs() && current.socket === drag.receipt.socket &&
    current.scope === drag.receipt.scope && current.scope === JSON.stringify([store.get('myUserId'), store.get('currentSlug'), store.get('currentProjectOwnerId'), store.get('projectSplitViewSocketGeneration')]) && current.revision === drag.receipt.revision &&
    JSON.stringify(current.windows.map(function (entry) { return entry.id; }).sort()) === JSON.stringify(drag.windows.map(function (entry) { return entry.id; }).sort()) && JSON.stringify(current.base) === JSON.stringify(drag.receipt.base) &&
    current.host.clientWidth === drag.width && current.host.clientHeight === drag.height &&
    drag.windows.every(function (entry) {
      if (!entry.element.isConnected || entry.element.classList.contains('hidden')) return false;
      if (!entry.frame) return entry.element.dataset.toolWindowId === entry.id;
      var live = entry.frame.clayPane && entry.frame.clayPane.identity();
      return entry.frame.contentDocument === entry.document && entry.frame.contentWindow === entry.window &&
        live && samePaneBinding(live.binding, entry.binding) && livePaneBinding(entry.frame);
    });
}
function capture(event, source, divider) {
  var receipt = store.get('toolPaneWindowGeometry'), preference = store.get('workbenchLayoutPreference') || {};
  if (!receipt || (!store.get('projectSplitViewActiveId') && (!preference.ready || preference.loading || preference.saving)) || store.get('projectSplitViewDrag') || store.get('projectSplitViewPending')) return null;
  var drag = { pointerId: event.pointerId, receipt: receipt, source: source, divider: divider, startX: event.clientX, startY: event.clientY,
    width: receipt.host.clientWidth, height: receipt.host.clientHeight, tree: receipt.tree, moved: false, windows: receipt.windows.map(function (item) {
      var live = item.frame && item.frame.clayPane && item.frame.clayPane.identity();
      return Object.assign({}, item, { rect: item.element.getBoundingClientRect(), document: item.frame && item.frame.contentDocument,
        window: item.frame && item.frame.contentWindow, binding: live && live.binding, pointerEvents: item.frame && item.frame.style.pointerEvents });
    }) };
  return receiptCurrent(drag) ? drag : null;
}
function begin(drag) {
  drag.moved = true;
  drag.windows.forEach(function (item) { if (item.frame) item.frame.style.pointerEvents = 'none'; });
  if (drag.source) drag.source.element.classList.add('tool-pane-drag-source');
  document.body.classList.add('tool-pane-dragging'); drag.receipt.host.classList.add('split-view-drag-preview');
  try { document.documentElement.setPointerCapture(drag.pointerId); } catch (error) {}
}
function pointerDown(event) {
  if (event.button !== 0 || event.isPrimary === false || store.get('toolPaneDrag')) return;
  var header = event.target.closest && event.target.closest('.tool-pane-window > .tool-pane-header, #split-host > .split-pane > .split-pane-header');
  if (!header || event.target.closest('button, input, a, .tool-pane-title, .tool-pane-kind, .split-pane-title, .split-view-runtime, .split-worker-runtime')) return;
  var receipt = store.get('toolPaneWindowGeometry');
  if (!receipt || !receipt.windows.some(function (item) { return !!item.tool; })) return;
  var source = receipt.windows.find(function (item) { return item.element === header.parentNode; });
  var drag = source && capture(event, source);
  if (!drag) return;
  store.set({ toolPaneDrag: drag }); event.preventDefault(); event.stopImmediatePropagation();
}
function preview(drag, tree) {
  drag.tree = tree;
  store.set({ toolPaneLayoutPreview: { key: drag.receipt.key, base: drag.receipt.base, tree: tree, socket: drag.receipt.socket } });
  repaintToolPanes();
}
function move(event) {
  var drag = store.get('toolPaneDrag');
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!receiptCurrent(drag)) { finish(false); return; }
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
  if (!drag.moved) begin(drag);
  event.preventDefault();
  if (drag.divider) {
    var entry = drag.divider, horizontal = entry.axis === 'horizontal';
    var delta = horizontal ? event.clientX - drag.startX : event.clientY - drag.startY;
    var next = resize(drag.receipt.tree, entry.path, Math.max(.05, Math.min(.95, entry.ratio + delta / Math.max(1, entry.available))));
    if (next) preview(drag, next);
    return;
  }
  var target = drag.windows.find(function (entry) { var r = entry.rect; return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom; });
  var nextTree = drag.receipt.tree;
  if (target && target.id !== drag.source.id) {
    var r = target.rect, x = (event.clientX - r.left) / r.width, y = (event.clientY - r.top) / r.height;
    var edge = Math.min(x, 1 - x, y, 1 - y), side = 'center';
    if (edge < .25) side = edge === x ? 'left' : edge === 1 - x ? 'right' : edge === y ? 'top' : 'bottom';
    nextTree = insertWindow(drag.receipt.tree, drag.source.id, target.id, side);
  }
  preview(drag, nextTree);
  var ghost = document.getElementById('tool-pane-drag-ghost');
  if (!ghost) { ghost = document.createElement('div'); ghost.id = 'tool-pane-drag-ghost'; ghost.className = 'split-view-drag-ghost'; document.body.appendChild(ghost); }
  ghost.textContent = drag.source.element.querySelector('.tool-pane-title, .split-pane-title').textContent;
  ghost.style.left = event.clientX + 12 + 'px'; ghost.style.top = event.clientY + 12 + 'px'; ghost.hidden = false;
}
async function finish(commit) {
  var drag = store.get('toolPaneDrag');
  if (!drag) return;
  var allowed = commit && drag.moved && receiptCurrent(drag) && JSON.stringify(drag.tree) !== JSON.stringify(drag.receipt.tree);
  store.set({ toolPaneDrag: null });
  drag.windows.forEach(function (entry) { if (entry.frame && entry.frame.isConnected) entry.frame.style.pointerEvents = entry.pointerEvents; });
  if (drag.source) drag.source.element.classList.remove('tool-pane-drag-source');
  document.body.classList.remove('tool-pane-dragging');
  var ghost = document.getElementById('tool-pane-drag-ghost'); if (ghost) ghost.hidden = true;
  try { if (document.documentElement.hasPointerCapture(drag.pointerId)) document.documentElement.releasePointerCapture(drag.pointerId); } catch (error) {}
  var saved = allowed ? await saveToolPaneTree(drag.receipt, drag.tree) : false;
  if (!store.get('toolPaneDrag')) { store.set({ toolPaneLayoutPreview: null }); repaintToolPanes(); }
  setTimeout(function () { if (!store.get('toolPaneDrag')) drag.receipt.host.classList.remove('split-view-drag-preview'); }, 320);
  return saved;
}
function up(event) {
  var drag = store.get('toolPaneDrag');
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (drag.moved) move(event);
  finish(true);
}
export function bindToolPaneDivider(divider, entry, tree) {
  divider.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || store.get('toolPaneDrag')) return;
    var drag = capture(event, null, entry);
    if (!drag) return;
    store.set({ toolPaneDrag: drag }); begin(drag); event.preventDefault(); event.stopImmediatePropagation();
  });
  divider.addEventListener('keydown', function (event) {
    var direction = ['ArrowLeft', 'ArrowUp'].indexOf(event.key) >= 0 ? -1 : ['ArrowRight', 'ArrowDown'].indexOf(event.key) >= 0 ? 1 : 0;
    if (!direction) return;
    var receipt = store.get('toolPaneWindowGeometry'), next = resize(tree, entry.path, Math.max(.05, Math.min(.95, entry.ratio + direction * .03)));
    if (receipt && next) { event.preventDefault(); saveToolPaneTree(receipt, next); }
  });
}
export function initToolPaneDrag() {
  if (store.get('toolPaneDragInitialized')) return;
  store.set({ toolPaneDragInitialized: true });
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', function () { finish(false); }, true);
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && store.get('toolPaneDrag')) { event.preventDefault(); finish(false); } }, true);
  window.addEventListener('blur', function () { finish(false); });
}

store.subscribe(function (state, previous) {
  if (state.toolPaneDrag && (state.myUserId !== previous.myUserId || state.currentSlug !== previous.currentSlug ||
      state.currentProjectOwnerId !== previous.currentProjectOwnerId || state.splitPanes !== previous.splitPanes ||
      state.connected !== previous.connected || state.projectSplitViewActiveId !== previous.projectSplitViewActiveId ||
      state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration)) finish(false);
});
