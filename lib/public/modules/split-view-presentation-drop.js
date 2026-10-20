import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { exactDriverForOrigin } from './split-view-presentation-lookup.js';
import { checkComposerDeparture } from './session-rich-drafts.js';
import { showToast } from './utils.js';
import { listIds, place, swap, pairTree } from './split-view-layout-client.js';

export function applyPresentationDrop(drag, target, mutation, checkMountedPaneDrafts) {
  var views = store.get('projectSplitViews') || [], sourceView = views.find(function (view) { return view.id === drag.sourceViewId; }), targetView = views.find(function (view) { return view.id === target.viewId; });
  var sessions = getCachedSessions() || [], sourceSession = exactDriverForOrigin(drag.origin, sessions), targetSession = exactDriverForOrigin(target.origin, sessions);
  if (!sourceSession || !targetSession || sourceSession.id !== drag.sessionId) return;
  var sameView = sourceView && targetView && sourceView.id === targetView.id;
  if (target.sidebar && sameView) return;
  var side = target.side === "center" ? (sameView ? "center" : "right") : target.side;
  function checkDeparture() {
    try {
      if (sourceView && sourceView.id === store.get('projectSplitViewActiveId')) checkMountedPaneDrafts();
      else if (!store.get('projectSplitViewActiveId') && !store.get('splitPanes')) checkComposerDeparture();
      return true;
    } catch (error) { showToast(error.message, "warn"); return false; }
  }
  if (!targetView) {
    if (sourceView) {
      if (!checkDeparture()) return;
      var newTree = pairTree(target.origin, drag.origin, side);
      mutation("project_split_view_move", { sourceViewId: sourceView.id, sourceSessionOriginId: drag.origin,
        targetSessionOriginId: target.origin, targetSessionOrigins: listIds(newTree), tree: newTree, layout: "balanced",
        activeSessionOriginId: target.origin, name: "Split view" }, { activateCreatedView: true });
    } else {
      if (!checkDeparture()) return;
      var createdTree = pairTree(target.origin, drag.origin, side);
      mutation("project_split_view_create", { name: "Split view", sessionOrigins: listIds(createdTree), tree: createdTree,
        layout: "balanced", activeSessionOriginId: target.origin }, { activateCreatedView: true });
    }
    return;
  }
  if (sourceView && targetView.id !== sourceView.id) {
    if (targetView.sessions.length >= 8) { showToast("Eight sessions are already open. Close a pane to add another.", "warn"); return; }
    var movedTree = place(targetView.tree, drag.origin, target.origin, side, 0.5);
    if (!movedTree.ok) return;
    mutation("project_split_view_move", { sourceViewId: sourceView.id, sourceSessionOriginId: drag.origin,
      targetViewId: targetView.id, targetSessionOrigins: listIds(movedTree.tree), tree: movedTree.tree,
      layout: targetView.layout, activeSessionOriginId: targetView.activeSessionOriginId }, target.sidebar ? { activateCreatedView: true, createdViewId: targetView.id } : null);
    return;
  }
  var nextTree;
  if (side === "center" && sourceView) nextTree = swap(targetView.tree, drag.origin, target.origin).tree;
  else {
    var placed = place(targetView.tree, drag.origin, target.origin, side, 0.5);
    if (!placed.ok) return;
    nextTree = placed.tree;
  }
  var origins = listIds(nextTree);
  if (origins.length > 8) { showToast("Eight sessions are already open. Close a pane to add another.", "warn"); return; }
  mutation("project_split_view_update", { id: targetView.id, sessionOrigins: origins, tree: nextTree,
    layout: targetView.layout, activeSessionOriginId: targetView.activeSessionOriginId }, target.sidebar ? { activateCreatedView: true, createdViewId: targetView.id } : null);
}
