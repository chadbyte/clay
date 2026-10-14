import { store } from './store.js';

// Hard navigation destroys detached panels, cached transcripts and sockets.
// Clear the rendered document first so revoked content cannot linger while the
// replacement page is loading or when that request fails.
export function leaveRevokedProject(url) {
  store.set({ activeSessionId: null, activeProjectSlug: null, sessionActivatedProjectSlug: null, sessions: [], splitPanes: null });
  document.body.replaceChildren();
  window.location.replace(url || "/");
}

export function reconnectDestination(info, slug) {
  if (!slug || !info || !Array.isArray(info.projects)) return null;
  var project = info.projects.find(function (item) { return item.slug === slug; });
  if (!project) return "/";
  return project.contentAccess === false ? "/p/" + encodeURIComponent(slug) + "/" : null;
}
