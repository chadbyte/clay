import { store } from './store.js';
import { isProjectSessionReady } from './project-activation.js';

export function isCurrentProjectSessionReady(state, socket) {
  return socket !== state.splitIdentityBlockedSocket && isProjectSessionReady(state, socket);
}

export function clearProjectSplitState() {
  store.set({
    splitPanes: null,
    splitGroups: [],
    splitDelegations: {},
    splitGroupsProjectSlug: null,
    projectSplitViews: [],
    projectSplitViewRevision: 0,
    projectSplitViewContextKey: null,
    projectSplitViewHydrated: false,
    projectSplitViewPending: null,
    projectSplitViewError: "",
    projectSplitViewActiveId: null,
    projectSplitViewFocusedOrigin: null,
    projectSplitViewPreviewTree: null,
    projectSplitViewDrag: null,
    projectSplitViewDividerDrag: null,
    projectSplitViewTranscriptScroll: {},
    paneLayoutScrollLock: null,
    paneLastUserScrollTop: null,
    paneUserScrollIntent: null,
    paneUserScrollRevision: 0,
    projectSplitViewRequestSocket: null,
    projectSplitViewRequestGeneration: null,
    projectSplitViewRequestOwnerId: null,
    projectSplitViewRequestSlug: null,
    projectSplitViewSuppressClick: null,
    sessionListProjectSlug: null,
    activeSessionId: null,
    sessionActivatedProjectSlug: null,
  });
}

export function markProjectSessionListHydrated() {
  var slug = store.get('activeProjectSlug');
  if (slug) store.set({ sessionListProjectSlug: slug });
}

// Returns whether anything changed so callers can skip a sidebar rebuild for
// a repeated, identical broadcast (a rebuild drops the hovered row's :hover).
export function applyProjectSplitGroups(groups) {
  var slug = store.get('activeProjectSlug');
  var next = groups || [];
  var nextSlug = slug || null;
  if (store.get('splitGroupsProjectSlug') === nextSlug) {
    try {
      if (JSON.stringify(store.get('splitGroups') || []) === JSON.stringify(next)) return false;
    } catch (e) {}
  }
  store.set({ splitGroups: next, splitGroupsProjectSlug: nextSlug });
  return true;
}
