var isWorker = require("./session-provenance").isWorker;

function hasEntries(value) {
  return !!(value && Object.keys(value).length > 0);
}

function unsafeReason(session, isPaired, options) {
  var opts = options || {}, update = opts.assignmentUpdate === true;
  if (!session || session.hidden) return "Target session is unavailable.";
  if (isWorker(session) || session.sessionRole === "worker") return "Project follow-ups must target the Driver, not a Worker.";
  if (!session.cliSessionId) return "Target session must have a durable session reference.";
  if (session.sessionVisibility !== "private") return "Target session must be private.";
  if (!opts.allowBusy && (session.isProcessing || session._queryStarting || session._awaitingTurnResult)) return "Target session must be idle.";
  if (hasEntries(session.pendingPermissions) || hasEntries(session.pendingAskUser) || hasEntries(session.pendingElicitations) || hasEntries(session.pendingUserDialogs)) return "Target session is waiting for user input.";
  if ((session.mode && session.mode !== "gui") || (session.runtimeMode && session.runtimeMode !== "gui") || session.terminalId != null || session.runtimeTerminalId != null || session.tuiSuspended) return "Terminal sessions cannot receive project follow-ups.";
  if (session.homeDebatePlanning || session.homeDebatePhase || session.debateSetupMode || session.debateState || session._debate) return "Debate sessions cannot receive project follow-ups.";
  if (session.loop || session.spawn || session.handoff || (!update && (session.assignment || session.singleTurn)) || session._pairDelegation || (isPaired && !(opts.allowBusy && !isWorker(session)))) return "Orchestrated sessions cannot receive project follow-ups.";
  if (session.dangerouslySkipPermissions || session.permissionMode === "bypassPermissions") return "Full-access sessions cannot receive project follow-ups.";
  if (session.destroying || (session.abortController && session.abortController.signal.aborted) || session.scheduledMessage || session.rateLimitAutoContinuePending || session.taskStopRequested || session._lastTurnInterrupted || session._pendingMessageDrainPaused || session._runtimeRefreshRequested || session.pendingPush && session.pendingPush.length) return "Target session is not safely resumable right now.";
  return "";
}

function attachDelegatedFollowUp(ctx) {
  var sm = ctx.sm;

  function inspect(principal, targetSessionRef, options) {
    if (!principal || typeof targetSessionRef !== "string" || targetSessionRef.indexOf("session:") !== 0) {
      throw new Error("A durable opaque targetSessionRef is required.");
    }
    var session = null;
    sm.sessions.forEach(function (candidate) {
      if (!session && ctx.sessionRef(candidate) === targetSessionRef) session = candidate;
    });
    if (!session) throw new Error("Target session was not found in this project.");
    if (ctx.isMultiUser()) {
      if (!principal.userId || session.ownerId !== principal.userId) throw new Error("Target session access denied.");
    } else if (session.ownerId) {
      throw new Error("Target session access denied.");
    }
    var paired = !!(ctx.isPairedSession && ctx.isPairedSession(session));
    var assignment = session.assignment, opts = options || {};
    var assignmentUpdate = !!(assignment && opts.parentAssignmentId && assignment.assignmentId === opts.parentAssignmentId &&
      assignment.sourceMateId === principal.sourceMateId && assignment.sourceProjectSlug === principal.sourceProjectSlug &&
      assignment.sourceSessionRef === principal.sourceSessionRef);
    var reason = unsafeReason(session, paired, { allowBusy: opts.allowBusy === true, assignmentUpdate: assignmentUpdate });
    if (reason) throw new Error(reason);
    if (ctx.isPendingQueuePaused && ctx.isPendingQueuePaused(session)) throw new Error("The Driver queue is stopped; explicit owner resume is required.");
    if (!ctx.canResumeVendor(session.vendor)) throw new Error("Target session provider cannot safely resume this conversation.");
    return { session: session, sessionRef: targetSessionRef, title: session.title || "Existing session", linuxUser: ctx.getLinuxUserForSession(session) || null };
  }

  async function dispatch(principal, targetSessionRef, task, metadata, onReady) {
    var resolved = inspect(principal, targetSessionRef, { allowBusy: true, parentAssignmentId: metadata.parentAssignmentId });
    if (resolved.session.isProcessing || resolved.session._queryStarting || resolved.session._awaitingTurnResult) throw new Error("Driver is still busy; the reviewed follow-up must remain queued.");
    var session = resolved.session;
    var sdk = ctx.getSdk();
    if (!sdk || typeof sdk.pushMessage !== "function" || typeof sdk.startQuery !== "function") {
      throw new Error("Target project runtime is unavailable.");
    }
    if (typeof onReady === "function") onReady(session);
    sm.sendAndRecord(session, {
      type: "delegated_follow_up",
      text: task,
      assignmentId: metadata.assignmentId,
      sourceMateId: metadata.sourceMateId,
      sourceProjectSlug: metadata.sourceProjectSlug,
      sourceSessionRef: metadata.sourceSessionRef,
    });
    session.isProcessing = true;
    session.lastActivity = Date.now();
    session.sentToolResults = {};
    if (ctx.onProcessingChanged) ctx.onProcessingChanged();
    sm.broadcastSessionList();
    try {
      var delivered = sdk.pushMessage(session, task);
      if (!delivered && await sdk.startQuery(session, task, undefined, resolved.linuxUser) === false) throw new Error("Driver runtime did not accept the follow-up.");
    } catch (error) {
      session.isProcessing = false;
      sm.sendAndRecord(session, {
        type: "error",
        text: "Delegated follow-up could not start: " + (error.message || String(error)),
        assignmentId: metadata.assignmentId,
      });
      if (ctx.onProcessingChanged) ctx.onProcessingChanged();
      sm.broadcastSessionList();
      throw error;
    }
    return session;
  }

  return { inspectDelegatedFollowUp: inspect, dispatchDelegatedFollowUp: dispatch };
}

module.exports = { attachDelegatedFollowUp: attachDelegatedFollowUp, unsafeReason: unsafeReason };
