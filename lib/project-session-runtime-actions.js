// Legacy terminal recovery only. New terminal presentation has been retired.
function attachSessionRuntimeActions(ctx) {
  function inspect(session) {
    return JSON.stringify([session.terminalId, session.runtimeTerminalId, session.tuiSuspended, [session.terminalId, session.runtimeTerminalId].map(function (id) { return typeof id === "number" && ctx.tm ? ctx.tm.identity(id) : null; })]);
  }
  async function change(session, mode, revalidate) {
    revalidate();
    if (mode !== "gui") throw new Error("New terminal presentation has been removed. Only return to GUI chat is supported; provider threads cannot migrate across vendors.");
    if (session.isProcessing || session._queryStarting || session.queryInstance || Object.keys(session.pendingPermissions || {}).length || Object.keys(session.pendingAskUser || {}).length) throw new Error("Runtime changes require an idle session without an active provider handle or pending approvals.");
    if (session.taskStopRequested || session._pendingMessageDrainPaused || ctx.isPendingQueuePaused && ctx.isPendingQueuePaused(session)) throw new Error("A stopped session cannot be resumed by a runtime change.");
    var vendor = session.vendor || ctx.sm.defaultVendor || "claude";
    var ids = Array.from(new Set([session.terminalId, session.runtimeTerminalId].filter(function (id) { return typeof id === "number"; })));
    if (!ids.length && (session.runtimeMode || session.mode || "gui") === "gui") return { status: "completed", runtimeMode: "gui", runtimeEffect: "none", threadPreserved: true };
    if (vendor !== "claude" || !session.cliSessionId) throw new Error("Only a legacy Claude terminal thread can return to GUI chat.");
    var closed = 0, persisted = false;
    var fields = ['terminalId', 'runtimeTerminalId'];
    var originalFields = fields.map(function (field) { return session[field]; });
    var targets = ids.map(function (id) { return { id: id, identity: ctx.tm && ctx.tm.identity(id), closed: false }; });
    var suspended = session.tuiSuspended;
    function exactTerminals() {
      if (session.tuiSuspended !== suspended) throw new Error("Terminal presentation changed during shutdown.");
      targets.forEach(function (target) {
        var current = ctx.tm && ctx.tm.identity(target.id);
        if (!target.identity || (target.closed ? current !== null : current !== target.identity)) throw new Error("A terminal runtime was replaced during shutdown.");
      });
      fields.forEach(function (field, index) {
        var original = originalFields[index], current = session[field];
        if (current === original || current == null && original == null) return;
        var target = targets.find(function (item) { return item.id === original; });
        if (current == null && target && target.closed) return;
        throw new Error("A new or replacement terminal was attached during shutdown.");
      });
    }
    try {
      for (var target of targets) {
        revalidate();
        exactTerminals();
        if (!ctx.tm || typeof ctx.tm.closeAndWait !== "function") throw new Error("Completion-aware terminal shutdown is unavailable.");
        ctx.tm.markReclaimed(target.id);
        await ctx.tm.closeAndWait(target.id); target.closed = true; closed++;
        revalidate();
        exactTerminals();
      }
      revalidate();
      exactTerminals();
      session.terminalId = null; session.runtimeTerminalId = null;
      ctx.prepareGui(session, { deferSave: true });
      exactTerminals();
      session.runtimeMode = "gui"; session.tuiSuspended = false;
      if (ctx.sm.saveSessionFile(session) !== true) throw new Error("GUI presentation could not be saved after terminal shutdown.");
      persisted = true;
      ctx.sm.broadcastSessionList();
      ctx.publishGui(session);
      return { status: "completed", runtimeMode: "gui", runtimeEffect: closed ? "terminal_closed" : "none", persisted: true, threadPreserved: true, executionStarted: false };
    } catch (error) {
      error.productControlResult = { status: "failed", outcome: "partial", persisted: persisted, runtimeEffect: closed ? "terminal_closed" : "closure_unconfirmed", retrySafe: false, executionStarted: false };
      throw error;
    }
  }
  function inspectLifecycle() { return ctx.tm.list().map(function (terminal) { return Object.assign({}, terminal, { identity: ctx.tm.identity(terminal.id) }); }); }
  return { change: change, inspect: inspect, inspectLifecycle: inspectLifecycle };
}
module.exports = { attachSessionRuntimeActions: attachSessionRuntimeActions };
