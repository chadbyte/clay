import { store } from './store.js';
import { listIds } from './split-view-layout-client.js';

export function viewForOrigin(origin) {
  var views = store.get('projectSplitViews') || [];
  for (var i = 0; i < views.length; i++) if (views[i].sessions.some(function (session) { return session.sessionOriginId === origin; })) return views[i];
  return null;
}

export function viewIdForOrigin(origin) {
  var view = viewForOrigin(origin);
  return view && view.id || null;
}

export function exactDriverForOrigin(origin, sessions) {
  for (var i = 0; i < (sessions || []).length; i++) {
    var session = sessions[i];
    if (session.sessionOriginId === origin && session.sessionRole !== "worker" && session.isMate !== true && session.isTui !== true) return session;
  }
  return null;
}

export function restorablePresentation(state, views, sessions) {
  if (!state || state.paneMode || state.dmMode || state.splitPanes || !state.connected || !state.authIdentityLoaded ||
      !state.currentSlug || state.activeProjectSlug !== state.currentSlug || state.sessionActivatedProjectSlug !== state.currentSlug ||
      state.sessionListProjectSlug !== state.currentSlug || !state.sessionOriginId) return null;
  var selected = exactDriverForOrigin(state.sessionOriginId, sessions);
  if (!selected || selected.id !== state.activeSessionId || (selected.ownerId || null) !== (state.myUserId || null)) return null;
  var matches = (views || []).filter(function (view) {
    return view.sessions.some(function (ref) { return ref.id === selected.id && ref.sessionOriginId === selected.sessionOriginId; });
  });
  if (matches.length !== 1 || !matches[0].sessions.every(function (ref) {
    var session = exactDriverForOrigin(ref.sessionOriginId, sessions);
    return session && session.id === ref.id && (session.ownerId || null) === (state.myUserId || null);
  })) return null;
  return matches[0];
}

export function updateActiveSession(view, origin, submit) {
  var tree = store.get('projectSplitViewPreviewTree') || view.tree;
  submit("project_split_view_update", { id: view.id, sessionOrigins: listIds(tree), tree: tree,
    layout: view.layout, activeSessionOriginId: origin });
}
