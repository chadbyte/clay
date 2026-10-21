import { ensureArrangeTrigger } from './split-view-presentation-renderer.js';
import { pairBase } from './view-pair-presentation.js';
import { activeSavedView } from './view-workspace-state.js';
// Legacy Driver/Worker pairs use the same display-only window geometry.
import { store } from './store.js';
import { rectangles } from './split-view-layout-client.js';
import { toolPaneLayoutTree, paintToolPaneWindows, bindWorkspaceDivider, dockedToolPanes } from './tool-pane-layout.js';

export function clearToolPaneWindows() {
  document.querySelectorAll('.tool-pane-window').forEach(function (panel) {
    panel.classList.remove('tool-pane-window'); delete panel.dataset.toolWindowId;
    ['left', 'top', 'width', 'height', 'right', 'maxHeight'].forEach(function (field) { panel.style[field] = ''; });
  });
  var main = document.getElementById('main-panels');
  if (main) main.classList.remove('has-tool-pane-windows');
  store.set({ toolPaneWindowGeometry: null });
}
export function paintLegacyToolPanes(host) {
  var split = store.get('splitPanes');
  if (!host || !split || !split.panes || split.panes.length < 2) return false;
  var panes = Array.from(host.querySelectorAll(':scope > .split-pane:not(.split-pane-cached)'));
  var ids = panes.map(function (pane) {
    var frame = pane.querySelector('.split-pane-frame');
    if (frame && !frame.dataset.toolPaneGeometryReadyBound) {
      frame.dataset.toolPaneGeometryReadyBound = 'true';
      frame.addEventListener('clay-pane-ready', function () { queueMicrotask(function () { if (frame.isConnected) paintLegacyToolPanes(host); }); });
    }
    return frame && frame.dataset.sessionOriginId;
  });
  if (ids.length < split.panes.length || ids.some(function (id) { return !id; }) || new Set(ids).size !== ids.length) return false;
  var base = { id: ids[0] };
  ids.slice(1).forEach(function (id) { base = { axis: 'horizontal', ratio: .5, left: base, right: { id: id } }; });
  var view = activeSavedView() || { id: 'legacy-' + (split.groupId || ids.join('-')), activeSessionOriginId: ids[0] };
  if (view.workspace && view.workspace.linkedPair) base = pairBase(view.workspace.linkedPair, view.tree);
  host.classList.add('split-view-canvas'); host.dataset.positioned = 'true'; delete host.dataset.singlePane;
  var style = getComputedStyle(host), left = parseFloat(style.paddingLeft) || 0, top = parseFloat(style.paddingTop) || 0;
  var width = host.clientWidth - left - (parseFloat(style.paddingRight) || 0), height = host.clientHeight - top - (parseFloat(style.paddingBottom) || 0);
  var tree = toolPaneLayoutTree(view, base), geometry = rectangles(tree, Math.max(0, width), Math.max(0, height), 7);
  paintToolPaneWindows(host, view, base, tree, geometry, { left: left, top: top });
  var focused = store.get('projectSplitViewFocusedOrigin');
  panes.forEach(function (pane, index) {
    var rect = geometry.panes[ids[index]];
    pane.hidden = !!focused && ids[index] !== focused; pane.style.display = pane.hidden ? 'none' : '';
    if (focused === ids[index]) rect = { x: 0, y: 0, width: width, height: height };
    if (!rect) return;
    if (view.sessions && view.sessions.some(function (s) { return s.sessionOriginId === ids[index]; })) ensureArrangeTrigger(pane.querySelector('.split-pane-header'));
    pane.style.left = left + rect.x + 'px'; pane.style.top = top + rect.y + 'px';
    pane.style.width = rect.width + 'px'; pane.style.height = rect.height + 'px';
  });
  host.querySelectorAll(':scope > .split-view-divider').forEach(function (divider) { divider.remove(); });
  (focused ? [] : geometry.dividers).forEach(function (entry) {
    var divider = document.createElement('div'); divider.className = 'split-view-divider'; divider.dataset.axis = entry.axis;
    divider.setAttribute('role', 'separator'); divider.setAttribute('tabindex', '0'); divider.setAttribute('aria-label', 'Resize pane windows');
    divider.setAttribute('aria-orientation', entry.axis === 'horizontal' ? 'vertical' : 'horizontal');
    divider.style.left = left + entry.rect.x + 'px'; divider.style.top = top + entry.rect.y + 'px';
    divider.style.width = entry.rect.width + 'px'; divider.style.height = entry.rect.height + 'px';
    bindWorkspaceDivider(divider, entry, tree); host.appendChild(divider);
  });
  return true;
}
