// Resolve rendered Mate session and Project Log references through an exact
// owner-bound source session.

function attachHomeClaySessionLinks(ctx) {
  function source(ws, msg, routedProjectSlug) {
    var tap = msg.surface === "search" ? ws._searchClayTap : ws._homeChatTap;
    if (!tap && routedProjectSlug) {
      var routedProject = ctx.projects.get(routedProjectSlug);
      var routedManager = routedProject && routedProject.getSessionManager ? routedProject.getSessionManager() : null;
      var routedSession = routedManager && ws._clayActiveSession ? routedManager.sessions.get(ws._clayActiveSession) : null;
      return { tap: { mateSlug: routedProjectSlug, sessionId: ws._clayActiveSession }, project: routedProject, session: routedSession };
    }
    var sourceProject = tap && tap.mateSlug ? ctx.projects.get(tap.mateSlug) : null;
    var sourceManager = sourceProject && sourceProject.getSessionManager ? sourceProject.getSessionManager() : null;
    var sourceSession = sourceManager && tap ? sourceManager.sessions.get(tap.sessionId) : null;
    return { tap: tap, project: sourceProject, session: sourceSession };
  }

  function resolve(ws, msg, routedProjectSlug) {
    var selected = source(ws, msg, routedProjectSlug);
    var payload = { type: "home_clay_session_target", requestId: msg.requestId || null, sessionRef: msg.sessionRef || null, status: "error" };
    try {
      var binding = selected.session ? { projectSlug: selected.tap.mateSlug, session: selected.session } : null;
      if (binding && ws && ws._clayUser) binding.viewerId = ws._clayUser.id;
      var bound = ctx.workspaceQueryService && binding
        ? ctx.workspaceQueryService.bindProjectSession(binding)
        : null;
      if (!bound) throw new Error("The source conversation is no longer available.");
      payload.target = bound.resolveSessionNavigation({ sessionRef: msg.sessionRef, entryIndex: msg.entryIndex });
      payload.status = "ready";
    } catch (error) {
      payload.error = error.message || "Session not available.";
    }
    ctx.sendMessage(ws, payload);
  }

  function resolveLog(ws, msg, routedProjectSlug) {
    var selected = source(ws, msg, routedProjectSlug);
    var status = selected.project && selected.project.getStatus ? selected.project.getStatus() : null;
    var bound = ctx.projectLogsService && selected.session && status
      ? ctx.projectLogsService.bindMate({
        projectSlug: selected.tap.mateSlug,
        projectOwnerId: status.projectOwnerId || null,
        isMate: true,
        mateId: selected.tap.mateId,
        session: selected.session,
      })
      : null;
    var payload = { type: "home_clay_log_target", requestId: msg.requestId || null, ref: msg.ref || null, status: "error" };
    try {
      if (!bound) throw new Error("The source conversation is no longer available.");
      payload.target = bound.resolveLogNavigation({ ref: msg.ref });
      payload.status = "ready";
    } catch (error) {
      payload.error = error.message || "Log not available.";
    }
    ctx.sendMessage(ws, payload);
  }

  return { resolve: resolve, resolveLog: resolveLog };
}

module.exports = { attachHomeClaySessionLinks: attachHomeClaySessionLinks };
