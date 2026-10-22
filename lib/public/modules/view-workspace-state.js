import { store } from './store.js';
import { listIds } from './split-view-layout-client.js';

export function activeSavedView() { return (store.get('projectSplitViews') || []).find(function (view) { return view.id === store.get('projectSplitViewActiveId'); }) || null; }
export function workspaceKey(view) {
  return view && JSON.stringify([store.get('myUserId') || null, store.get('currentSlug'), store.get('currentProjectOwnerId'), store.get('projectSplitViewSocketGeneration'), view.id]);
}
export function copy(value) { return JSON.parse(JSON.stringify(value)); }
export function mapWorkspaceTree(tree, mapping) {
  if (!tree) return null;
  if (tree.id) return mapping[tree.id] ? { id: mapping[tree.id] } : null;
  var left = mapWorkspaceTree(tree.left, mapping), right = mapWorkspaceTree(tree.right, mapping);
  return !left ? right : !right ? left : { axis: tree.axis, ratio: tree.ratio, left: left, right: right };
}
export function paneOwner(pane) { return pane.kind === 'workbench' ? pane.resource.name : pane.kind === 'file' ? 'file-' + pane.instanceId : pane.kind; }
export function displayTree(value) {
  var mapping = Object.create(null);
  value.panes.forEach(function (pane) { mapping[pane.instanceId] = pane.kind === 'session' ? pane.resource.originId : 'tool-' + paneOwner(pane); });
  return mapWorkspaceTree(value.tree, mapping);
}
export function sessionTree(value) {
  var mapping = Object.create(null);
  value.panes.forEach(function (pane) { if (pane.kind === 'session') mapping[pane.instanceId] = pane.resource.originId; });
  return mapWorkspaceTree(value.tree, mapping);
}
export function fromDisplayTree(value, tree) {
  var mapping = Object.create(null);
  value.panes.forEach(function (pane) { mapping[pane.kind === 'session' ? pane.resource.originId : 'tool-' + paneOwner(pane)] = pane.instanceId; });
  return mapWorkspaceTree(tree, mapping);
}
export function replacePaneIdentity(value, pane) {
  var previous = pane.instanceId, next = freshInstance(), mapping = Object.create(null);
  value.panes.forEach(function(item) { mapping[item.instanceId] = item.instanceId === previous ? next : item.instanceId; });
  value.tree = mapWorkspaceTree(value.tree, mapping);
  if (value.activePaneId === previous) value.activePaneId = next;
  pane.instanceId = next;
}
export function freshInstance() { return 'pane-' + crypto.randomUUID(); }
// Keep tool branches and their ratios while replacing the session layout.
export function recomposeWorkspace(previous, tree, activeOrigin) {
  var next = copy(previous || { version: 1, panes: [], tree: null, activePaneId: null }), origins = listIds(tree), oldTree = displayTree(next);
  next.panes = next.panes.filter(function (pane) { return pane.kind !== 'session' || origins.indexOf(pane.resource.originId) >= 0; });
  origins.forEach(function (origin) {
    if (!next.panes.some(function (pane) { return pane.kind === 'session' && pane.resource.originId === origin; })) next.panes.push({ instanceId: freshInstance(), kind: 'session', open: true, placement: 'docked', resource: { originId: origin } });
  });
  if (next.linkedPair && (origins.indexOf(next.linkedPair.driverOriginId) < 0 || origins.length + next.linkedPair.workerOrigins.length > 8)) delete next.linkedPair;
  var placements = [];
  function collect(node) {
    if (!node || node.id) return;
    if (node.left.id && node.left.id.indexOf('tool-') === 0) placements.push({ id: node.left.id, target: listIds(node.right)[0], axis: node.axis, ratio: node.ratio, before: true });
    else if (node.right.id && node.right.id.indexOf('tool-') === 0) placements.push({ id: node.right.id, target: listIds(node.left)[0], axis: node.axis, ratio: node.ratio, before: false });
    collect(node.left); collect(node.right);
  }
  collect(oldTree);
  var result = tree;
  function insert(node, placement) {
    if (!node) return node;
    if (node.id) return node.id === placement.target ? { axis: placement.axis, ratio: placement.ratio,
      left: placement.before ? { id: placement.id } : node, right: placement.before ? node : { id: placement.id } } : node;
    return { axis: node.axis, ratio: node.ratio, left: insert(node.left, placement), right: insert(node.right, placement) };
  }
  placements.reverse().forEach(function (placement) { result = insert(result, placement); });
  next.panes.filter(function (pane) { return pane.kind !== 'session' && pane.open && pane.placement === 'docked'; }).forEach(function (pane) {
    var id = 'tool-' + paneOwner(pane);
    if (listIds(result).indexOf(id) < 0) result = result ? { axis: 'horizontal', ratio: .66, left: result, right: { id: id } } : { id: id };
  });
  next.tree = fromDisplayTree(next, result);
  var selected = next.panes.find(function (pane) { return pane.kind === 'session' && pane.resource.originId === activeOrigin; }) || next.panes.find(function (pane) { return pane.open; });
  next.activePaneId = selected ? selected.instanceId : null;
  if (next.presentation) {
    if (origins.indexOf(next.presentation.focusedSessionOriginId) < 0) next.presentation.focusedSessionOriginId = null;
    if (!next.panes.some(function (p) { return p.open && p.instanceId === next.presentation.expandedPaneId; })) next.presentation.expandedPaneId = null;
  }
  return next;
}
export function prepareViewMutation(type, message) {
  var state = store.snap(), views = state.projectSplitViews || [];
  var view = views.find(function (item) { return item.id === (message.id || message.sourceViewId); });
  message.accountId = state.myUserId || null; message.projectSlug = state.currentSlug;
  if (view) message.expectedViewRevision = view.revision;
  if (type === 'project_split_view_create' || type === 'project_split_view_update') {
    if (!message.workspace) message.workspace = recomposeWorkspace(view && view.workspace, message.tree, message.activeSessionOriginId);
    message.tree = sessionTree(message.workspace);
    message.active = message.active !== false;
  }
  if (type === 'project_split_view_move') {
    var target = views.find(function (item) { return item.id === message.targetViewId; });
    message.expectedTargetViewRevision = target && target.revision;
    message.targetWorkspace = recomposeWorkspace(target && target.workspace, message.tree, message.activeSessionOriginId);
    var moved = view && view.workspace.panes.find(function (pane) { return pane.kind === 'session' && pane.resource.originId === message.sourceSessionOriginId; });
    var destination = message.targetWorkspace.panes.find(function (pane) { return pane.kind === 'session' && pane.resource.originId === message.sourceSessionOriginId; });
    if (moved && destination) {
      var mapping = Object.create(null); message.targetWorkspace.panes.forEach(function (pane) { mapping[pane.instanceId] = pane === destination ? moved.instanceId : pane.instanceId; });
      message.targetWorkspace.tree = mapWorkspaceTree(message.targetWorkspace.tree, mapping);
      if (message.targetWorkspace.activePaneId === destination.instanceId) message.targetWorkspace.activePaneId = moved.instanceId;
      destination.instanceId = moved.instanceId;
    }
    message.tree = sessionTree(message.targetWorkspace);
    message.active = true;
  }
  return message;
}
export function workspaceChanged() { document.dispatchEvent(new CustomEvent('clay-workspace-changed')); }
