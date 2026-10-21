// Linked Workers are a read-only presentation of the existing pair registry.
// They never enter the saved View's ordinary session membership.
import { showToast } from './utils.js';
import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { splitGroupRoles } from './split-group-helpers.js';
import { splitPaneForSession } from './split-pane-reconciler.js';
import { mutation } from './view-mutations.js';
import { activeSavedView, copy, displayTree, mapWorkspaceTree } from './view-workspace-state.js';

export function currentViewPair() {
  var state = store.snap(), split = state.splitPanes;
  if (!split || !state.projectSplitViewHydrated || state.paneMode || !state.connected || !state.authIdentityLoaded ||
      state.currentSlug !== state.sessionListProjectSlug || state.currentSlug !== state.activeProjectSlug) return null;
  var group = (state.splitGroups || []).find(function (item) { return item.id === split.groupId; }), roles = splitGroupRoles(group);
  if (!roles || roles.orderedIds.length > 8 || split.panes.length !== roles.orderedIds.length || split.panes.some(function (pane) { return pane.slug !== state.currentSlug || roles.orderedIds.indexOf(pane.sessionId) < 0; })) return null;
  var sessions = getCachedSessions(), driver = sessions.find(function (s) { return s.id === roles.driverId && s.sessionRole !== 'worker' && (s.ownerId || null) === (state.myUserId || null); });
  var workers = roles.workerIds.map(function (id) { return sessions.find(function (s) { return s.id === id && s.sessionRole === 'worker' && s.parentSessionId === roles.driverId && s.parentAvailable && (s.ownerId || null) === (state.myUserId || null); }); });
  if (!driver || !driver.sessionOriginId || workers.some(function (s) { return !s || !s.sessionOriginId; })) return null;
  return { groupId: group.id, driverOriginId: driver.sessionOriginId, workerOrigins: workers.map(function (s) { return s.sessionOriginId; }) };
}
export function pairDisplayTree(value) { return value.linkedPair ? value.linkedPair.tree : displayTree(value); }
export function pairBase(pair, base) {
  var tree = { id: pair.driverOriginId };
  pair.workerOrigins.forEach(function (origin) { tree = { axis: 'horizontal', ratio: .5, left: tree, right: { id: origin } }; });
  function expand(node) { if (!node) return tree; if (node.id) return node.id === pair.driverOriginId ? tree : node; return { axis: node.axis, ratio: node.ratio, left: expand(node.left), right: expand(node.right) }; }
  return base ? expand(base) : tree;
}
export function syncPairView() {
  var pair = currentViewPair(); if (!pair) return false;
  var state = store.snap(), view = activeSavedView();
  if (!view || !view.sessions.some(function (s) { return s.sessionOriginId === pair.driverOriginId; })) {
    view = (state.projectSplitViews || []).find(function (v) { return v.sessions.some(function (s) { return s.sessionOriginId === pair.driverOriginId; }); });
    if (view) { store.set({ projectSplitViewActiveId: view.id }); return true; }
    if (!state.projectSplitViewPending && !state.projectSplitViewError) mutation('project_split_view_create', {
      name: 'View', sessionOrigins: [pair.driverOriginId], tree: { id: pair.driverOriginId }, layout: 'balanced', activeSessionOriginId: pair.driverOriginId
    });
    return true;
  }
  if (!view.workspace.linkedPair || view.workspace.linkedPair.groupId !== pair.groupId || JSON.stringify(view.workspace.linkedPair.workerOrigins) !== JSON.stringify(pair.workerOrigins)) {
    if (state.projectSplitViewPending || state.projectSplitViewError) return true;
    if (view.sessions.length + pair.workerOrigins.length > 8) return false;
    var value = copy(view.workspace), mapping = {};
    value.panes.forEach(function (p) { mapping[p.kind === 'session' ? p.resource.originId : 'tool-' + (p.kind === 'workbench' ? p.resource.name : p.kind === 'file' ? 'file-' + p.instanceId : p.kind)] = p.kind === 'session' ? p.resource.originId : 'tool-' + (p.kind === 'workbench' ? p.resource.name : p.kind === 'file' ? 'file-' + p.instanceId : p.kind); });
    function expand(node) { if (!node) return null; if (node.id) return node.id === pair.driverOriginId ? pairBase(pair) : node; return { axis: node.axis, ratio: node.ratio, left: expand(node.left), right: expand(node.right) }; }
    value.linkedPair = Object.assign({}, pair, { tree: expand(mapWorkspaceTree(displayTree(value), mapping)) });
    mutation('project_split_view_update', { id: view.id, sessionOrigins: view.sessions.map(function (s) { return s.sessionOriginId; }), tree: view.tree, layout: view.layout, activeSessionOriginId: pair.driverOriginId, workspace: value });
  }
  return true;
}
export function restoreViewPair(view) {
  var pair = view && view.workspace.linkedPair;
  if (!pair || store.get('splitPanes')) return false;
  var group = (store.get('splitGroups') || []).find(function (item) { return item.id === pair.groupId; }), roles = splitGroupRoles(group), sessions = getCachedSessions();
  if (!roles || roles.orderedIds.length > 8) return false;
  var members = roles.orderedIds.map(function (id) { return sessions.find(function (s) { return s.id === id; }); });
  if (members.some(function (s, index) { return !s || (s.ownerId || null) !== (store.get('myUserId') || null) || index > 0 && (s.sessionRole !== 'worker' || !s.parentAvailable || s.parentSessionId !== roles.driverId); }) || members[0].sessionOriginId !== pair.driverOriginId || JSON.stringify(members.slice(1).map(function (s) { return s.sessionOriginId; })) !== JSON.stringify(pair.workerOrigins)) return false;
  store.set({ splitPanes: { groupId: group.id, panes: roles.orderedIds.map(function (id) { return splitPaneForSession(id, store.get('currentSlug'), sessions); }) } });
  return true;
}

export function pairPresentationPanes(panes) {
  var view = activeSavedView();
  return !view ? panes : panes.concat(view.sessions.filter(function (s) { return !panes.some(function (p) { return p.sessionId === s.id; }); }).map(function (s) { return splitPaneForSession(s.id, store.get('currentSlug'), getCachedSessions()); }));
}

export function pairViewCapacity(group) {
  var roles = splitGroupRoles(group);
  if (!roles) return true;
  var view = (store.get('projectSplitViews') || []).find(function (v) { return v.sessions.some(function (s) { return s.id === roles.driverId; }); });
  if ((view ? view.sessions.length : 1) + roles.workerIds.length <= 8) return true;
  showToast('This View has no room for the linked Worker panes. Move a session to another View first.', 'warn');
  return false;
}
