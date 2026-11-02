import { WORKBENCH_PANELS, setWorkbenchExpanded } from './workbench-panels.js';
import { store } from './store.js';
import { activeSavedView, workspaceKey, paneOwner, workspaceChanged } from './view-workspace-state.js';

export function presentation(value) { return value.presentation || { focusedSessionOriginId: null, expandedPaneId: null }; }
export function capturePresentation(value) {
  var focus = store.get('projectSplitViewFocusedOrigin') || null;
  var owner = store.get('savedViewExpandedOwner');
  var pane = value.panes.find(function (p) { return p.open && p.kind !== 'session' && paneOwner(p) === owner; });
  value.presentation = { focusedSessionOriginId: value.panes.some(function (p) { return p.kind === 'session' && p.resource.originId === focus; }) ? focus : null, expandedPaneId: pane ? pane.instanceId : null };
}
export function recordToolExpansion(owner, enabled) {
  if (store.get('savedWorkspaceApplying') || !enabled && store.get('savedViewExpandedOwner') !== owner) return;
  store.set({ savedViewExpandedOwner: enabled ? owner : null });
  workspaceChanged();
}
export async function restoreViewPresentation(view, key) {
  var apis = await Promise.all([import('./terminal.js'), import('./shared-browser.js'), import('./file-pane-instances.js'), import('./split-view-presentations.js')]);
  var current = activeSavedView();
  if (!store.get('connected') || store.get('savedWorkspaceLeaving') || workspaceKey(current) !== key || current.revision !== view.revision) return false;
  var run = store.get('savedWorkspaceRuntime');
  if (run && run.key === key) run.presentationApplied = true;
  var state = presentation(view.workspace), pane = view.workspace.panes.find(function (p) { return p.instanceId === state.expandedPaneId && p.open; });
  // An expanded tool that failed to restore must not stay fullscreen over the sessions.
  if (pane && run && run.key === key && run.unavailable && run.unavailable[paneOwner(pane)]) pane = null;
  store.set({ savedWorkspaceApplying: true });
  try {
    store.set({ projectSplitViewFocusedOrigin: state.focusedSessionOriginId, savedViewExpandedOwner: pane ? paneOwner(pane) : null });
    apis[0].setTerminalExpanded(!!pane && pane.kind === 'terminal');
    apis[1].setBrowserExpanded(!!pane && pane.kind === 'browser');
    Object.keys(apis[2].filePaneStates()).forEach(function (id) {
      if (!apis[2].filePaneState(id)) return;
      apis[2].updateFilePaneState(id, { expanded: !!pane && pane.instanceId === id }); apis[2].repaintFilePane(id);
    });
    Object.keys(WORKBENCH_PANELS).forEach(function (name) { setWorkbenchExpanded(name, !!pane && pane.kind === 'workbench' && pane.resource.name === name); });
    apis[3].renderPresentationSplitView();
  } finally { store.set({ savedWorkspaceApplying: false }); }
  return true;
}
