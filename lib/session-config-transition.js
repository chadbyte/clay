// Guarded configuration commit shared by SDK setters and permission transitions.
// Provider acknowledgement is distinct from local persistence. Once a request
// has crossed that boundary, failures never imply the provider was rolled back.
async function applySessionConfig(ctx) {
  var session = ctx.session, sm = ctx.sm, handle = session.queryInstance;
  var generation = Number(session._sdkQueryGeneration || 0), owner = session.ownerId;
  var paused = !!session._pendingMessageDrainPaused, signal = session.abortController && session.abortController.signal;
  var attempted = false, acknowledged = false, persisted = false, previous = {};
  function current() {
    ctx.revalidate();
    if (sm.sessions.get(session.localId) !== session || session.ownerId !== owner || session.queryInstance !== handle ||
        Number(session._sdkQueryGeneration || 0) !== generation || session.taskStopRequested ||
        !!session._pendingMessageDrainPaused !== paused || signal && signal.aborted) throw new Error("Target ownership, runtime, or Stop state changed during the configuration request.");
  }
  try {
    current();
    if (handle) {
      if (typeof handle[ctx.method] !== "function") throw new Error("This provider cannot apply this configuration to the active runtime.");
      attempted = true;
      var reply = await handle[ctx.method](ctx.nativeValue);
      if (reply === false || reply && reply.ok === false) throw new Error(reply && reply.error || "The provider refused the configuration change.");
      acknowledged = true;
      current();
    }
    var changes = typeof ctx.changes === "function" ? ctx.changes() : ctx.changes;
    Object.keys(changes).forEach(function (key) { previous[key] = { present: Object.prototype.hasOwnProperty.call(session, key), value: session[key] }; });
    Object.assign(session, changes);
    try {
      if (sm.saveSessionFile(session) !== true) throw new Error("Could not persist the configuration change.");
      persisted = true;
    } catch (error) {
      Object.keys(previous).forEach(function (key) { if (previous[key].present) session[key] = previous[key].value; else delete session[key]; });
      throw error;
    }
    // There is no await between the last authorization check, disk commit and
    // publication. Never broadcast a desired value before its save succeeds.
    ctx.publish();
    return Object.assign({ ok: true, status: "completed", persisted: true, runtimeEffect: acknowledged ? "applied" : "none" }, changes);
  } catch (error) {
    return { ok: false, status: "failed", outcome: persisted ? "partial" : attempted ? "uncertain" : "failed", persisted: persisted,
      runtimeEffect: acknowledged ? "applied" : attempted ? "unknown" : "none", retrySafe: !attempted && !persisted,
      error: (persisted ? "The configuration was saved, but publication did not complete. " : "") + (attempted ? "The provider may retain the requested change; no external rollback was attempted. " : "") + (error.message || String(error)) };
  }
}
module.exports = { applySessionConfig: applySessionConfig };
