import { boundLegacyCoordinates } from './view-legacy-coordinates.js';
import { pairDisplayTree, pairBase } from './view-pair-presentation.js';
import { activeSavedView, displayTree, fromDisplayTree, copy, workspaceKey } from './view-workspace-state.js';
import { persistWorkspace } from './view-workspace-controller.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { TOOL_PANES, toolWindowId, workspaceWindowTree } from './tool-pane-tree.js';
import { renderPresentationSplitView } from './split-view-presentations.js';
import { ensureWorkbenchLayoutPreference, saveWorkbenchWindowLayout } from './workbench-layout-preference.js';
import { showToast } from './utils.js';
import { initToolPaneDrag, bindToolPaneDivider } from './tool-pane-drag.js';

export function toolPaneContext() {
  var state = store.snap(), view = (state.projectSplitViews || []).find(function (item) { return item.id === state.projectSplitViewActiveId; });
  var split = state.splitPanes;
  var origin = view ? view.id : split && split.panes ? 'legacy-' + (split.groupId || split.panes.map(function (pane) { return pane.sessionId; }).join('-')) : state.projectSplitViewSingletonOrigin;
  return origin && state.currentSlug && JSON.stringify([state.currentSlug, state.currentProjectOwnerId || null, origin]);
}
export function dockedToolPanes() {
  if (window.innerWidth < 1024 || store.get('paneMode')) return [];
  return (store.get('rightWorkbenchDockedOwners') || []).filter(function (name) {
    var definition = TOOL_PANES[name], panel = definition && document.getElementById(definition.id);
    return panel && !panel.classList.contains('hidden') && !panel.classList.contains('panel-fullscreen');
  });
}
export function toolPaneLayoutTree(view, base) {
  initToolPaneDrag();
  var owners = dockedToolPanes(), key = toolPaneContext(), preference = store.get('workbenchLayoutPreference') || {};
  var draft = store.get('toolPaneLayoutPreview'), saved = preference.layouts && preference.layouts[key];
  if (view && view.workspace) {
    var legacy = store.get('savedWorkspaceLegacyLayout');
    saved = legacy && legacy.key === workspaceKey(view) ? boundLegacyCoordinates(legacy.record, view.workspace) : { base: view.workspace.linkedPair ? pairBase(view.workspace.linkedPair, view.tree) : view.tree, tree: pairDisplayTree(view.workspace) };
  }
  if (draft && draft.key === key && JSON.stringify(draft.base) === JSON.stringify(base) && draft.socket === getWs()) return draft.tree;
  return owners.length || saved ? workspaceWindowTree(base, saved, owners) : base;
}
export function paintToolPaneWindows(host, view, base, tree, geometry, inset) {
  var owners = dockedToolPanes(), key = toolPaneContext(), main = document.getElementById('main-panels');
  if (!main) return;
  main.classList.toggle('view-session-focused', !!store.get('projectSplitViewFocusedOrigin'));
  var hostRect = host.getBoundingClientRect(), mainRect = main.getBoundingClientRect();
  var windows = Array.from(host.querySelectorAll(':scope > .split-pane:not(.split-pane-cached)')).map(function (pane) {
    var frame = pane.querySelector('.split-pane-frame'); return { id: frame && frame.dataset.sessionOriginId, element: pane, frame: frame };
  });
  Object.keys(TOOL_PANES).forEach(function (name) {
    var panel = document.getElementById(TOOL_PANES[name].id), rect = geometry.panes[toolWindowId(name)];
    if (!panel) return;
    if (!panel.dataset.toolPaneFullscreenObserved) {
      panel.dataset.toolPaneFullscreenObserved = 'true';
      var observer = new MutationObserver(function (records) {
        if (records.some(function (record) { return (String(record.oldValue || '').split(/\s+/).indexOf('panel-fullscreen') >= 0) !== panel.classList.contains('panel-fullscreen'); })) requestAnimationFrame(repaintToolPanes);
      });
      observer.observe(panel, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
      panel.addEventListener('clay-tool-pane-dispose', function () { observer.disconnect(); }, { once: true });
    }
    var mounted = owners.indexOf(name) >= 0 && !!rect;
    var wasMounted = panel.classList.contains('tool-pane-window');
    panel.classList.toggle('tool-pane-window', mounted);
    if (!mounted) {
      if (wasMounted) ['left', 'top', 'width', 'height', 'right', 'maxHeight'].forEach(function (field) { panel.style[field] = ''; });
      delete panel.dataset.toolWindowId; return;
    }
    panel.dataset.toolWindowId = toolWindowId(name);
    panel.style.left = hostRect.left - mainRect.left + inset.left + rect.x + 'px';
    panel.style.top = hostRect.top - mainRect.top + inset.top + rect.y + 'px';
    panel.style.width = rect.width + 'px'; panel.style.height = rect.height + 'px'; panel.style.right = 'auto'; panel.style.maxHeight = 'none';
    windows.push({ id: toolWindowId(name), element: panel, tool: name });
  });
  main.classList.toggle('has-tool-pane-windows', owners.length > 0);
  if (Math.abs(host.clientWidth - hostRect.width) > 1) requestAnimationFrame(repaintToolPanes);
  store.set({ toolPaneWindowGeometry: { key: key, base: base, tree: tree, view: view, windows: windows,
    host: host, socket: getWs(), revision: view && view.workspace ? view.revision : (store.get('workbenchLayoutPreference') || {}).revision,
    scope: JSON.stringify([store.get('myUserId'), store.get('currentSlug'), store.get('currentProjectOwnerId'), store.get('projectSplitViewSocketGeneration')]) } });
}
export function bindWorkspaceDivider(divider, entry, tree) { bindToolPaneDivider(divider, entry, tree); }
export function repaintToolPanes() { renderPresentationSplitView(); }
export async function saveToolPaneTree(receipt, tree) {
  var live = store.get('toolPaneWindowGeometry');
  if (!live || live.key !== toolPaneContext() || live.key !== receipt.key || live.socket !== receipt.socket || live.scope !== receipt.scope || live.revision !== receipt.revision || !store.get('connected')) return false;
  var view = activeSavedView();
  if (view) { var value = copy(view.workspace); value.tree = fromDisplayTree(value, tree); if (value.linkedPair) value.linkedPair.tree = copy(tree); return persistWorkspace(value); }
  var saved = await saveWorkbenchWindowLayout(receipt.key, tree, receipt.base);
  if (!saved) showToast((store.get('workbenchLayoutPreference') || {}).error || 'Pane positions could not be saved. Try again.', 'warn');
  return saved;
}
store.subscribe(function (state, previous) {
  if (state.paneMode) return;
  var changed = state.rightWorkbenchDockedOwners !== previous.rightWorkbenchDockedOwners || state.workbenchLayoutPreference !== previous.workbenchLayoutPreference ||
    state.toolPaneLayoutPreview !== previous.toolPaneLayoutPreview;
  if (!changed) return;
  if (!state.toolPaneRepaintQueued) {
    store.set({ toolPaneRepaintQueued: true });
    requestAnimationFrame(function () { store.set({ toolPaneRepaintQueued: false }); renderPresentationSplitView(); });
  }
  if ((state.rightWorkbenchDockedOwners || []).some(function (name) { return !!TOOL_PANES[name]; }) && !(state.workbenchLayoutPreference || {}).ready && !(state.workbenchLayoutPreference || {}).loading && !(state.workbenchLayoutPreference || {}).saving && !(state.workbenchLayoutPreference || {}).error) ensureWorkbenchLayoutPreference();
});
