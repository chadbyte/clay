import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { isCurrentProjectSessionReady } from './split-session-boundary.js';
import { splitPanesMatchProject, reconcileRestoredSplit } from './project-activation.js';
import { splitGroupMemberIds } from './split-group-helpers.js';
import { splitPaneForSession } from './split-pane-reconciler.js';
import { clearProjectSplitState } from './split-session-boundary.js';

export function reconcileSplitIdentity(state, previous, host) {
  var ownerChanged = (previous.authIdentityLoaded === true || state.splitIdentityHydrated) && state.myUserId !== previous.myUserId;
  if (state.authIdentityLoaded && !state.splitIdentityHydrated) store.set({ splitIdentityHydrated: true });
  if (state.currentSlug === previous.currentSlug && state.myUserId === previous.myUserId) return false;
  Array.from(host.querySelectorAll('.split-pane-frame')).forEach(function (frame) {
    if (frame.clayPane) frame.clayPane.suspend();
  });
  host.innerHTML = '';
  if (ownerChanged) {
    // This socket was authenticated as the previous owner. Fresh metadata on
    // that connection cannot establish the replacement owner's pane boundary.
    store.set({ splitIdentityBlockedSocket: getWs(), paneBindingSessions: [] });
    clearProjectSplitState();
  } else if (state.splitPanes) store.set({ splitPanes: null });
  return true;
}

// The initial owner response can arrive after history and split metadata.
// Wait for it so identity cleanup cannot discard panes we just restored.
export function restoreSplitGroup(openGroup) {
  var state = store.snap();
  if (state.authIdentityLoaded === false || state.isMultiUserMode && !state.myUserId) return;
  if (!isCurrentProjectSessionReady(state, getWs())) return;
  var split = state.splitPanes;
  if (split && !splitPanesMatchProject(split, state.currentSlug)) {
    store.set({ splitPanes: null });
    return;
  }
  if (state.paneMode) return;
  if (split) {
    var reconciliation = reconcileRestoredSplit(split, state.splitGroups);
    if (reconciliation.action === "clear") {
      store.set({ splitPanes: null });
      return;
    }
    if (reconciliation.action === "rebuild") {
      var rebuilt = reconciliation.group;
      if (rebuilt.members.some(function (id) { return !getCachedSessions().some(function (session) { return session.id === id; }); })) {
        store.set({ splitPanes: null });
        return;
      }
      store.set({ splitPanes: {
        groupId: rebuilt.id,
        panes: splitGroupMemberIds(rebuilt).map(function (id) { return splitPaneForSession(id, state.currentSlug, getCachedSessions()); }),
      } });
    }
    return;
  }
  var activeId = store.get('activeSessionId');
  if (!activeId) return;
  var groups = store.get('splitGroups') || [];
  for (var i = 0; i < groups.length; i++) {
    var members = groups[i].members || [];
    if (members.indexOf(activeId) !== -1) {
      openGroup(groups[i]);
      return;
    }
  }
}
