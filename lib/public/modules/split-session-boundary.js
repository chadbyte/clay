import { store } from './store.js';
import { isProjectSessionReady } from './project-activation.js';

export function isCurrentProjectSessionReady(state, socket) {
  return isProjectSessionReady(state, socket);
}

export function clearProjectSplitState() {
  store.set({
    splitPanes: null,
    splitGroups: [],
    splitDelegations: {},
    splitGroupsProjectSlug: null,
    sessionListProjectSlug: null,
    activeSessionId: null,
    sessionActivatedProjectSlug: null,
  });
}

export function markProjectSessionListHydrated() {
  var slug = store.get('activeProjectSlug');
  if (slug) store.set({ sessionListProjectSlug: slug });
}

export function applyProjectSplitGroups(groups) {
  var slug = store.get('activeProjectSlug');
  store.set({ splitGroups: groups || [], splitGroupsProjectSlug: slug || null });
}
