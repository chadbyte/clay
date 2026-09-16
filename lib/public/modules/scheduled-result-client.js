// Pure Scheduled Tasks result-news decisions. The production controller owns
// store, WebSocket, DOM, and peer-module calls directly.

export function scheduledResultStateTransition(state, msg) {
  var patch = { scheduledResultUnread: Number(msg.unreadCount) || 0 };
  var openRef = null;
  if (msg.autoFocus && msg.newestUnreadRef && !state.scheduledResultAutoFocusHandled) {
    patch.scheduledResultAutoFocusHandled = true;
    patch.scheduledResultFocusRef = msg.newestUnreadRef;
    openRef = msg.newestUnreadRef;
  }
  return { patch: patch, openRef: openRef };
}

export function scheduledResultCreatedTransition(state, msg) {
  if (!msg || !msg.ref || (state.scheduledResultSeenRefs || {})[msg.ref]) return null;
  var seen = Object.assign({}, state.scheduledResultSeenRefs || {});
  seen[msg.ref] = true;
  return { scheduledResultSeenRefs: seen, scheduledResultUnread: (state.scheduledResultUnread || 0) + 1 };
}

export function shouldAcknowledgeScheduledResult(entry, state, visibilityState) {
  return !!(entry && entry.scheduledResult && visibilityState !== "hidden" && state.projectLogsOpen && state.projectLogsView === "detail" && state.projectLogsSelectedRef === entry.ref);
}

export function shouldFocusScheduledResult(entry, state) {
  return !!(entry && state.scheduledResultFocusRef === entry.ref);
}

export function scheduledResultSessionId(state, msg) {
  if (msg.requestId && msg.requestId !== state.scheduledResultSessionRequestId) return null;
  return typeof msg.sessionId === "number" ? msg.sessionId : null;
}
