function attachDelegatedSession(ctx) {
  var sm = ctx.sm;

  async function createDelegatedSession(principal, task, metadata, onCreated) {
    if (!principal || !task) throw new Error("A bound owner and task are required.");
    var selection = await ctx.resolveModel(principal);
    if (!selection || selection.status !== "ready" || !selection.vendor || !selection.model) {
      throw new Error(selection && selection.error ? selection.error : "No configured model is available in the target project.");
    }
    var sdk = ctx.getSdk();
    if (!sdk || typeof sdk.startQuery !== "function") throw new Error("Target project runtime is unavailable.");
    var create = typeof sm.createSessionRaw === "function" ? sm.createSessionRaw : sm.createSession;
    var session = create.call(sm, {
      ownerId: principal.userId || null,
      sessionVisibility: "private",
      vendor: selection.vendor,
      model: selection.model,
      effort: selection.effort || null,
    });
    session.title = metadata.title;
    session.assignment = {
      assignmentId: metadata.assignmentId,
      sourceMateId: metadata.sourceMateId,
      sourceProjectSlug: metadata.sourceProjectSlug,
      sourceSessionRef: metadata.sourceSessionRef,
      delegated: true,
    };
    session.singleTurn = true;
    if (typeof onCreated === "function") onCreated(session);
    sm.sendAndRecord(session, {
      type: "delegated_work",
      text: task,
      assignmentId: metadata.assignmentId,
      sourceMateId: metadata.sourceMateId,
      sourceProjectSlug: metadata.sourceProjectSlug,
      sourceSessionRef: metadata.sourceSessionRef,
    });
    session.isProcessing = true;
    session.lastActivity = Date.now();
    session.sentToolResults = {};
    sm.broadcastSessionList();
    try {
      await Promise.resolve(sdk.startQuery(session, task, undefined, ctx.getLinuxUserForSession(session)));
    } catch (error) {
      session.isProcessing = false;
      sm.sendAndRecord(session, { type: "error", text: error.message || String(error) });
    }
    return session;
  }

  return { createDelegatedSession: createDelegatedSession };
}

module.exports = { attachDelegatedSession: attachDelegatedSession };
