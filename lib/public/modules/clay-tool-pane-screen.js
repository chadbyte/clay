import { TOOL_PANES } from './tool-pane-tree.js';
import { store } from './store.js';
import { visible } from './clay-navigation-render.js';
import { paneOwner } from './view-workspace-state.js';
import { filePaneState } from './file-pane-instances.js';
export function toolPaneScreen(view, hidden) {
  if (!view || !view.workspace) return [];
  var run = store.get('savedWorkspaceRuntime');
  return view.workspace.panes.filter(function (pane) { return pane.kind !== 'session'; }).slice(0, 16).map(function (pane) {
    var name = paneOwner(pane), panel = document.getElementById(pane.kind === 'file' ? name : TOOL_PANES[name] && TOOL_PANES[name].id);
    var file = pane.kind === 'file' ? filePaneState(pane.instanceId) : null;
    var unavailable = !!(run && run.unavailable[name] || file && file.error);
    var exact = false;
    if (pane.kind === 'workbench') exact = !!(panel && !panel.classList.contains('hidden') && (store.get('rightWorkbenchOwner') === name || (store.get('rightWorkbenchDockedOwners') || []).indexOf(name) >= 0));
    else if (pane.kind === 'file') exact = !!(file && file.resource && file.resource.path === pane.resource.path && file.resource.mode === pane.resource.mode && file.resource.rendered === pane.resource.rendered && (file.content != null || file.binary));
    else if (pane.kind === 'terminal') {
      var terminal = store.get('savedViewTerminalResource');
      exact = !!(terminal && terminal.id === pane.resource.id && terminal.identity === pane.resource.identity && terminal.runtimeId === pane.resource.runtimeId && (store.get('clayControlTerminalViews') || []).some(function (item) { return item.id === terminal.id && item.identity === terminal.identity && !item.exited; }));
    } else {
      var browser = store.get('sharedBrowser');
      exact = !!(browser && browser.id === pane.resource.id && browser.phase !== 'ended' && store.get('controlRuntimeId') === pane.resource.runtimeId && store.get('sessionOriginId') === pane.resource.sessionOriginId);
    }
    var ready = !!(pane.open && panel && !unavailable && exact);
    var shown = !!(!hidden && pane.open && panel && visible(panel));
    var rect = shown ? panel.getBoundingClientRect() : null;
    function pixel(value) { return Math.max(-100000, Math.min(100000, Math.round(value))); }
    return { instanceId: pane.instanceId, kind: pane.kind, placement: panel && panel.dataset && ['docked', 'overlay'].indexOf(panel.dataset.workbenchPlacement) >= 0 ? panel.dataset.workbenchPlacement : null, expanded: !!(pane.open && panel && panel.classList && panel.classList.contains('panel-fullscreen')), visible: shown, ready: ready, unavailable: unavailable,
      geometry: rect ? { x: pixel(rect.x), y: pixel(rect.y), width: Math.max(0, pixel(rect.width)), height: Math.max(0, pixel(rect.height)) } : null };
  });
}
export function toolPaneRendering(snapshot, view) {
  var expected = view.workspace ? view.workspace.panes.filter(function (pane) { return pane.kind !== 'session' && pane.open && (!snapshot.focusOrigin || snapshot.expandedPaneId || pane.placement === 'overlay') && (!view.workspace.presentation || !view.workspace.presentation.expandedPaneId || view.workspace.presentation.expandedPaneId === pane.instanceId); }) : [];
  var tools = snapshot.tools || [];
  return expected.every(function (pane) { return tools.some(function (tool) { return tool.instanceId === pane.instanceId && tool.kind === pane.kind && tool.placement === pane.placement && !!tool.expanded === !!(view.workspace.presentation && view.workspace.presentation.expandedPaneId === pane.instanceId) && tool.visible && tool.ready && !tool.unavailable; }); }) && tools.filter(function (tool) { return tool.visible; }).length === expected.length;
}
