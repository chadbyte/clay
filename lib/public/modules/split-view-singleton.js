// Build the transient one-Driver pane model without creating saved view state.
export function singletonPresentation(state, sessions) {
  if (!state || state.splitPanes) return null;
  var target = state.projectSplitViewStandaloneTarget;
  var validTarget = target && target.previousSessionId === state.activeSessionId && target.contextKey === state.projectSplitViewContextKey;
  var candidate = (sessions || []).find(function (session) {
    return validTarget ? session.id === target.id && session.sessionOriginId === target.origin && (session.ownerId || null) === (state.myUserId || null) : session.id === state.activeSessionId;
  });
  if (!candidate || !candidate.sessionOriginId || candidate.sessionRole === "worker" || candidate.isMate === true || candidate.isTui === true ||
      (candidate.runtimeMode || candidate.mode || "gui") !== "gui") return null;
  return { origin: candidate.sessionOriginId, view: { id: "single:" + candidate.sessionOriginId,
    sessions: [candidate], activeSessionOriginId: candidate.sessionOriginId }, session: candidate };
}

export function currentSingletonPresentation(state, sessions) {
  if (!state || state.paneMode || state.dmMode || !state.currentSlug || state.activeProjectSlug !== state.currentSlug ||
      state.sessionListProjectSlug !== state.currentSlug || !state.authIdentityLoaded || !state.connected ||
      state.projectSplitViewContextKey !== [state.currentSlug || "", state.currentProjectOwnerId || "", state.myUserId || "", state.projectSplitViewSocketGeneration || 0].join("|")) return null;
  return singletonPresentation(state, sessions);
}
