var sessionProvenance = require("./session-provenance");

function attachAutonomousRunScheduler(ctx) {
  var scheduler = ctx.scheduler;
  var type = "autonomous-wake:" + ctx.projectId;
  var unregister = null;
  function isMultiUser() { return typeof ctx.isMultiUser === "function" ? ctx.isMultiUser() : !!ctx.isMultiUser; }

  function origin(session) {
    var existing = session.sessionOriginId;
    var value = sessionProvenance.ensureOrigin(session);
    if (!existing) ctx.sm.saveSessionFile(session);
    return value;
  }
  function owner(session) {
    if (isMultiUser()) {
      if (!session.ownerId) throw new Error("Until complete requires an explicit session owner.");
      return session.ownerId;
    }
    return "local-user";
  }
  function matching(job, session, run, kind) {
    return job.type === type && job.projectId === ctx.projectId && job.target.id === origin(session) &&
      job.payload.runId === run.id && (!kind || job.payload.kind === kind);
  }
  function queued(session, run, kind) {
    var jobs = scheduler.listJobs();
    for (var i = jobs.length - 1; i >= 0; i--) if (jobs[i].state === "queued" && matching(jobs[i], session, run, kind)) return jobs[i];
    return null;
  }
  function schedule(session, run, kind, runAt) {
    var sessionOrigin = origin(session);
    run.wakeSequence = Math.max(0, Math.floor(Number(run.wakeSequence) || 0)) + 1;
    if (ctx.sm && typeof ctx.sm.saveSessionFile === "function") ctx.sm.saveSessionFile(session);
    var spec = {
      type: type,
      idempotencyKey: "autonomous:" + sessionOrigin + ":" + run.id + ":" + kind + ":" + run.cancellationEpoch + ":" + run.wakeSequence,
      ownerId: owner(session),
      projectId: ctx.projectId,
      target: { kind: "project-session-origin", id: sessionOrigin },
      payload: { kind: kind, runId: run.id, epoch: run.cancellationEpoch, wakeSequence: run.wakeSequence, sessionOrigin: sessionOrigin, cliSessionId: session.cliSessionId || null },
      runAt: Number(runAt),
    };
    var current = queued(session, run, kind);
    return current ? scheduler.replaceQueued(current.id, spec) : scheduler.enqueue(spec);
  }
  function cancel(session, run, kinds) {
    if (!run) return;
    var jobs = scheduler.listJobs();
    for (var i = 0; i < jobs.length; i++) {
      if (jobs[i].state !== "queued" || !matching(jobs[i], session, run)) continue;
      if (kinds && kinds.indexOf(jobs[i].payload.kind) === -1) continue;
      scheduler.cancel(jobs[i].id, "autonomous_run_cancelled_or_replaced");
    }
  }
  function findSession(job) {
    var found = null;
    ctx.sm.sessions.forEach(function (session) {
      if (!found && session.sessionOriginId === job.target.id) found = session;
    });
    return found;
  }
  function exact(job) {
    var session = findSession(job);
    var run = session && session.autonomousRun;
    if (!session || !run || run.id !== job.payload.runId) return null;
    if (job.payload.kind !== "deadline" && owner(session) !== job.ownerId) return null;
    if (Number(run.cancellationEpoch || 0) !== Number(job.payload.epoch)) return null;
    if (run.state === "armed" || run.state === "paused" || ["completed", "stopped", "limit", "error"].indexOf(run.state) !== -1) return null;
    if (job.payload.kind !== "deadline" && ctx.authorize && !ctx.authorize(session)) return null;
    return { session: session, run: run };
  }
  function canRun(job) {
    var current;
    try { current = exact(job); } catch (error) { return true; }
    if (!current) return true;
    return job.payload.kind !== "continuation" || (!current.session.isProcessing && !current.session._queryStarting);
  }
  function dispatch(job, execution) {
    var current = exact(job);
    if (!current) throw new Error("The Until complete wake no longer belongs to an authorized active run.");
    execution.recordMetadata({ projectId: ctx.projectId, runId: current.run.id, kind: job.payload.kind, sessionOrigin: job.target.id, epoch: job.payload.epoch });
    execution.recordReceipt({ state: "dispatching", runId: current.run.id, kind: job.payload.kind, sessionOrigin: job.target.id, recordedAt: Date.now() });
    return ctx.onWake(job.payload.kind, current.session, current.run);
  }
  function start() {
    if (!unregister) unregister = scheduler.registerHandler(type, dispatch, { canRun: canRun });
  }
  return { schedule: schedule, cancel: cancel, start: start, shutdown: function () { if (unregister) { unregister(); unregister = null; } } };
}

module.exports = { attachAutonomousRunScheduler: attachAutonomousRunScheduler };
