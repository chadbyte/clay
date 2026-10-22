import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';

function label(value) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160) : null; }

// Display labels only. Conversation access remains bound to the authenticated
// selected session; this snapshot never grants access to another pane or tool.
export function contextualViewMetadata() {
  var state = store.snap();
  if (state.paneMode || state.homeShellVisible || state.projectsHubVisible || state.dmMode ||
      state.activeProjectSlug !== state.currentSlug || state.sessionActivatedProjectSlug !== state.currentSlug || state.replayingHistory) return null;
  var view = (state.projectSplitViews || []).find(function (item) { return item.id === state.projectSplitViewActiveId; });
  var sessions = getCachedSessions() || [];
  var refs = view ? view.sessions || [] : sessions.filter(function (item) { return item.id === state.activeSessionId; });
  var owners = (state.rightWorkbenchDockedOwners || []).concat(state.rightWorkbenchOwner || []).filter(function (name, index, all) { return all.indexOf(name) === index; });
  return { name: label(view && view.name),
    sessions: refs.slice(0, 32).map(function (ref) {
      var session = sessions.find(function (item) { return item.id === ref.id && (!ref.sessionOriginId || item.sessionOriginId === ref.sessionOriginId); });
      return session ? { sessionId: session.id, title: label(session.title), selected: session.id === state.activeSessionId,
        focused: !!state.projectSplitViewFocusedOrigin && session.sessionOriginId === state.projectSplitViewFocusedOrigin } : null;
    }).filter(Boolean),
    workbenches: owners.slice(0, 16).map(label) };
}
