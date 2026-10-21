import { capturePresentation, restoreViewPresentation } from './view-presentation-state.js';
import { boundLegacyCoordinates, legacyCoordinatesReady } from './view-legacy-coordinates.js';
import { currentViewPair, pairBase, pairDisplayTree } from './view-pair-presentation.js';
import { filePaneStates, mountFilePane, resetFilePanes } from './file-pane-instances.js';
import { listIds } from './split-view-layout-client.js';
import { store } from './store.js';
import { mutation } from './view-mutations.js';
import { activeSavedView, workspaceKey, copy, paneOwner, freshInstance, replacePaneIdentity, displayTree, fromDisplayTree, sessionTree } from './view-workspace-state.js';
import { workspaceWindowTree } from './tool-pane-tree.js';

function current(key) { return !store.get('savedWorkspaceLeaving') && store.get('connected') && store.get('projectSplitViewHydrated') && workspaceKey(activeSavedView()) === key; }
function runtime() { return store.get('savedWorkspaceRuntime'); }
function applying(fn) { store.set({ savedWorkspaceApplying: true }); try { return fn(); } finally { store.set({ savedWorkspaceApplying: false }); } }
function descriptor(name) {
  if (name === 'terminal') return store.get('savedViewTerminalResource');
  if (name === 'browser') {
    var browser = store.get('sharedBrowser');
    return browser && store.get('sessionOriginId') && { id: browser.id, runtimeId: store.get('controlRuntimeId'), sessionOriginId: store.get('sessionOriginId') };
  }
  var file = store.get('clayControlFileView');
  return file && file.projectSlug === store.get('currentSlug') && { path: file.path, mode: 'follow', rendered: true };
}
function capture() {
  var view = activeSavedView(), run = runtime();
  if (!view || !run || run.restoring || !current(run.key) || store.get('paneMode') || store.get('savedWorkspaceApplying')) return;
  var value = copy(run.desired || run.inflight || view.workspace), docked = store.get('rightWorkbenchDockedOwners') || [], owner = store.get('rightWorkbenchOwner');
  ['terminal', 'browser'].forEach(function (name) {
    var pane = value.panes.find(function (item) { return paneOwner(item) === name; });
    var open = owner === name || docked.indexOf(name) >= 0;
    if (!open && !run.restored[name] && !run.cancelled[name]) return;
    var resource = descriptor(name);
    if (!pane && open && resource) { pane = { instanceId: freshInstance(), kind: name === 'file-viewer' ? 'file' : name, open: true, placement: 'overlay', resource: resource }; value.panes.push(pane); }
    if (!pane) return;
    if (open) run.restored[name] = true;
    if (open && run.cancelled[name]) { run.cancelled[name] = false; run.unavailable[name] = false; run.restored[name] = true; }
    if (!open) run.cancelled[name] = true;
    pane.open = open; pane.placement = open && docked.indexOf(name) >= 0 ? 'docked' : 'overlay';
    if (open && resource && !run.unavailable[name]) {
      if (pane.kind === 'file') resource.mode = pane.resource.mode;
      if (pane.kind !== 'file' && JSON.stringify(pane.resource) !== JSON.stringify(resource)) replacePaneIdentity(value, pane);
      pane.resource = resource;
    }
  });
  var files = filePaneStates();
  Object.keys(files).forEach(function (id) {
    var file = files[id], name = 'file-' + id;
    var pane = value.panes.find(function (item) { return item.instanceId === id; });
    if (!pane && file.open) { pane = { instanceId: id, kind: 'file', resource: file.resource }; value.panes.push(pane); }
    if (!pane) return;
    pane.open = file.open; pane.resource = Object.assign({}, file.resource);
    pane.placement = docked.indexOf(name) >= 0 ? 'docked' : 'overlay';
    run.restored[name] = true; run.cancelled[name] = !file.open;
  });
  // Closed file panes have no running resource and need not consume the limit.
  value.panes = value.panes.filter(function (pane) { return pane.kind !== 'file' || pane.open; });
  var tools = value.panes.filter(function (pane) { return pane.kind !== 'session' && pane.open && pane.placement === 'docked'; }).map(paneOwner);
  var legacy = store.get('savedWorkspaceLegacyLayout');
  var base = value.linkedPair ? pairBase(value.linkedPair, view.tree) : view.tree;
  var tree = workspaceWindowTree(base, legacy && legacy.key === run.key ? boundLegacyCoordinates(legacy.record, value) : { base: base, tree: pairDisplayTree(value) }, tools);
  if (value.linkedPair) value.linkedPair.tree = copy(tree);
  value.tree = fromDisplayTree(value, tree);
  var active = value.panes.find(function (pane) { return pane.open && paneOwner(pane) === owner; }) || value.panes.find(function (pane) { return pane.open && pane.instanceId === value.activePaneId; }) || value.panes.find(function (pane) { return pane.open; });
  value.activePaneId = active ? active.instanceId : null;
  if (run.presentationApplied) capturePresentation(value);
  store.set({ savedWorkspaceRuntime: Object.assign({}, run, { desired: value, desiredBase: JSON.stringify(run.inflight || view.workspace) }) });
  queue();
}
export function persistWorkspace(value) {
  var view = activeSavedView(), run = runtime();
  if (!view || !run || !current(run.key)) return false;
  store.set({ savedWorkspaceLegacyLayout: null });
  run.migrated = true;
  store.set({ savedWorkspaceRuntime: Object.assign({}, run, { desired: copy(value), desiredBase: JSON.stringify(run.inflight || view.workspace) }) });
  flush(); return true;
}
function flush() {
  var view = activeSavedView(), run = runtime();
  if (!view || !run || !current(run.key) || run.restoring || run.presentationApplying || !run.desired || store.get('projectSplitViewPending') || store.get('projectSplitViewError')) return;
  if (view.workspace.panes.some(function(pane) { var name = paneOwner(pane); return pane.kind !== 'session' && pane.open && !run.restored[name] && !run.cancelled[name]; })) return;
  if (run.desiredBase !== undefined && run.desiredBase !== JSON.stringify(view.workspace)) {
    store.set({ savedWorkspaceRuntime: Object.assign({}, run, { desired: null, inflight: null }), projectSplitViewError: 'The saved workspace changed while this edit was pending. Reload before trying again.' }); return;
  }
  if (JSON.stringify(run.desired) === JSON.stringify(view.workspace) && store.get('projectSplitViewSavedActiveId') === view.id) { store.set({ savedWorkspaceRuntime: Object.assign({}, run, { desired: null }) }); return; }
  var tree = sessionTree(run.desired), origins = view.sessions.map(function (session) { return session.sessionOriginId; });
  var sent = run.desired;
  store.set({ savedWorkspaceRuntime: Object.assign({}, run, { desired: null, inflight: copy(sent) }) });
  if (!mutation('project_split_view_update', { id: view.id, sessionOrigins: origins, tree: tree, layout: view.layout,
    activeSessionOriginId: view.activeSessionOriginId, workspace: sent })) store.set({ savedWorkspaceRuntime: Object.assign({}, runtime(), { desired: sent, inflight: null }) });
}
function restoreCurrent(view, run) {
  if (!current(run.key)) return false;
  if (activeSavedView().revision === view.revision) return true;
  store.set({ savedWorkspaceRuntime: Object.assign({}, runtime(), { restoring: false }), projectSplitViewError: 'The View changed during restoration. Reload to restore its latest state.' });
  return false;
}
async function restore(view, run) {
  var workbench = await import('./right-workbench.js');
  if (!restoreCurrent(view, run) || runtime() !== run) return;
  store.set({ savedViewExpandedOwner: null });
  applying(function () { resetFilePanes(); workbench.resetRightWorkbench(); });
  for (var i = 0; i < view.workspace.panes.length; i++) {
    var pane = view.workspace.panes[i], name = paneOwner(pane);
    if (pane.kind === 'session' || !pane.open) continue;
    var api = await import(pane.kind === 'terminal' ? './terminal.js' : pane.kind === 'browser' ? './shared-browser.js' : './filebrowser.js');
    if (!restoreCurrent(view, run) || !runtime() || runtime().key !== run.key) return;
    if (runtime().cancelled[name]) continue;
    var result = applying(function () {
      if (pane.kind === 'terminal') return api.restoreExistingTerminal(pane.resource);
      if (pane.kind === 'browser') return api.restoreExistingBrowser(pane.resource);
      return mountFilePane(pane);
    });
    if (result === 'pending') continue;
    run = runtime(); run.restored[name] = true; run.unavailable[name] = result === 'unavailable';
    if (pane.placement === 'docked') applying(function () { workbench.restoreWorkbenchDock(name); });
  }
  if (!current(run.key)) return;
  store.set({ savedWorkspaceRuntime: Object.assign({}, runtime(), { restoring: false }) });
  queue();
}
async function retryPending(view, run, name) {
  var pane = view.workspace.panes.find(function (item) { return item.kind === name && item.open; });
  var ready = store.get(name === 'terminal' ? 'savedViewTerminalListReady' : 'savedViewBrowserListReady');
  if (!pane || run.restored[name] || run.cancelled[name] || !ready) return;
  var api = await import(name === 'terminal' ? './terminal.js' : './shared-browser.js'), workbench = await import('./right-workbench.js');
  if (!restoreCurrent(view, run) || runtime().cancelled[name] || runtime().restored[name]) return;
  var result = applying(function () { return name === 'terminal' ? api.restoreExistingTerminal(pane.resource) : api.restoreExistingBrowser(pane.resource); });
  if (result === 'pending') return;
  runtime().restored[name] = true; runtime().unavailable[name] = result === 'unavailable';
  if (pane.placement === 'docked') applying(function () { workbench.restoreWorkbenchDock(name); });
  queue();
}
function migrateCoordinates(view, run) {
  var preference = store.get('workbenchLayoutPreference');
  if (run.migrated || !preference || !preference.ready || run.restoring || store.get('projectSplitViewPending')) return;
  // Legacy coordinate records are read once; subsequent writes target the View.
  if (!run.legacyEligible) { run.migrated = true; return; }
  var pair = view.workspace.linkedPair;
  var scopes = [view.id].concat(pair ? ['legacy-' + pair.groupId] : []).concat(view.sessions.length === 1 ? [view.sessions[0].sessionOriginId] : []), record;
  scopes.some(function (scope) { record = (preference.layouts || {})[JSON.stringify([store.get('currentSlug'), store.get('currentProjectOwnerId') || null, scope])]; return !!record; });
  if (!record) { run.migrated = true; return; }
  // Coordinates alone cannot authorize opening tools or invent their bindings.
  store.set({ savedWorkspaceLegacyLayout: { key: run.key, record: copy(record) } });
  var owners = store.get('rightWorkbenchDockedOwners') || [];
  var waiting = listIds(record.tree).filter(function (id) { return id.indexOf('tool-') === 0; });
  if (waiting.indexOf('tool-file-viewer') >= 0 && !legacyCoordinatesReady(record, view.workspace)) return;
  if (!waiting.filter(function (id) { return id !== 'tool-file-viewer'; }).every(function (id) { return owners.indexOf(id.slice(5)) >= 0 && (id === 'tool-terminal' ? descriptor('terminal') : id === 'tool-browser' ? descriptor('browser') : true); })) return;
  run.migrated = true; capture();
}
function tick() {
  if (store.get('paneMode') || store.get('splitPanes') && !currentViewPair()) return;
  var view = activeSavedView();
  if (store.get('splitPanes') && (!view || !view.workspace.linkedPair || store.get('projectSplitViewPending'))) return;
  if (!view || !store.get('connected') || !store.get('projectSplitViewHydrated')) return;
  if (view.sessions.length && (store.get('sessionOriginId') !== view.activeSessionOriginId || store.get('sessionActivatedProjectSlug') !== store.get('currentSlug'))) return;
  var key = workspaceKey(view), run = runtime();
  if (!run || run.key !== key) {
    run = { key: key, appliedWorkspace: JSON.stringify(view.workspace), restoring: true, restored: {}, cancelled: {}, unavailable: {}, desired: null, migrated: false, legacyEligible: !view.workspace.panes.some(function (pane) { return pane.kind !== 'session'; }) };
    store.set({ savedWorkspaceRuntime: run, savedWorkspaceLegacyLayout: null });
    restore(view, run); return;
  }
  var savedWorkspace = JSON.stringify(view.workspace);
  if (!run.restoring && run.appliedWorkspace && run.appliedWorkspace !== savedWorkspace && !store.get('projectSplitViewPending')) {
    if (run.inflight && JSON.stringify(run.inflight) === savedWorkspace) run.appliedWorkspace = savedWorkspace;
    else if (run.desired || run.inflight) {
      store.set({ projectSplitViewError: 'The saved workspace changed while a local edit was pending. Reload before trying again.' }); return;
    } else {
      run = { key: key, appliedWorkspace: savedWorkspace, restoring: true, restored: {}, cancelled: {}, unavailable: {}, desired: null, migrated: true, legacyEligible: false };
      store.set({ savedWorkspaceRuntime: run, savedWorkspaceLegacyLayout: null }); restore(view, run); return;
    }
  }
  var legacy = store.get('savedWorkspaceLegacyLayout');
  if (legacy && run.migrated && legacyCoordinatesReady(legacy.record, view.workspace)) store.set({ savedWorkspaceLegacyLayout: null });
  if (!run.restoring) {
    if (!run.presentationApplied && !run.presentationApplying && !view.workspace.panes.some(function (p) { return p.kind !== 'session' && p.open && !run.restored[paneOwner(p)] && !run.cancelled[paneOwner(p)]; })) {
      run.presentationApplying = true;
      restoreViewPresentation(view, run.key).then(function (applied) { if (runtime() && runtime().key === run.key && runtime().appliedWorkspace === run.appliedWorkspace) { runtime().presentationApplied = applied; runtime().presentationApplying = false; queue(); } });
    }
    retryPending(view, run, 'terminal'); retryPending(view, run, 'browser'); migrateCoordinates(view, run);
    if (!store.get('projectSplitViewPending')) run.inflight = null;
    if (!run.desired && store.get('projectSplitViewSavedActiveId') !== view.id) { run.desired = copy(view.workspace); run.desiredBase = JSON.stringify(view.workspace); }
    flush();
  }
}
function queue() {
  if (store.get('savedWorkspaceTickQueued')) return;
  store.set({ savedWorkspaceTickQueued: true });
  queueMicrotask(function () { store.set({ savedWorkspaceTickQueued: false }); tick(); });
}
export function initSavedWorkspace() {
  if (store.get('savedWorkspaceInitialized')) return;
  store.set({ savedWorkspaceInitialized: true });
  window.addEventListener('beforeunload', function () { store.set({ savedWorkspaceLeaving: true }); });
  window.addEventListener('pagehide', function () { store.set({ savedWorkspaceLeaving: true }); });
  document.addEventListener('clay-workspace-changed', capture);
  store.subscribe(function (state, previous) {
    if (previous.savedViewBrowserListReady && !state.savedViewBrowserListReady && runtime()) runtime().restored.browser = false;
    if ((state.savedViewTerminalResource !== previous.savedViewTerminalResource && state.savedViewTerminalResource || state.clayControlFileView !== previous.clayControlFileView && state.clayControlFileView || state.sharedBrowser !== previous.sharedBrowser && state.sharedBrowser) && !state.savedWorkspaceApplying) capture();
    if (state.splitPanes !== previous.splitPanes || state.rightWorkbenchDockedOwners !== previous.rightWorkbenchDockedOwners || state.savedViewTerminalResource !== previous.savedViewTerminalResource || state.projectSplitViews !== previous.projectSplitViews || state.projectSplitViewActiveId !== previous.projectSplitViewActiveId ||
        state.projectSplitViewPending !== previous.projectSplitViewPending || state.connected !== previous.connected ||
        state.controlRuntimeId !== previous.controlRuntimeId || state.sharedBrowsers !== previous.sharedBrowsers ||
        state.sessionOriginId !== previous.sessionOriginId || state.sessionActivatedProjectSlug !== previous.sessionActivatedProjectSlug || state.savedViewBrowserListReady !== previous.savedViewBrowserListReady || state.savedViewTerminalListReady !== previous.savedViewTerminalListReady || state.workbenchLayoutPreference !== previous.workbenchLayoutPreference) queue();
  });
  queue();
}
