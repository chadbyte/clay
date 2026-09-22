function stopAllWorkers(session, roles, ctx) {
  if (!roles) return false;
  for (var i = 0; i < roles.workers.length; i++) {
    var worker = roles.workers[i];
    if (worker._pairDelegation && worker._pairDelegation.outboxKey && ctx.resultOutbox) {
      ctx.resultOutbox.markBlocked(worker._pairDelegation.outboxKey, "The human stopped this Split Worker turn.", "human_stop");
    }
    ctx.taskControl.markInterruption(worker, "user", "The human stopped this Split Worker turn.");
    ctx.workerPermission.cancelForSession(worker, "The human stopped this Split Worker turn.");
    worker.taskStopRequested = true;
    if (worker.abortController) {
      try { worker.abortController.abort(); } catch (e) {}
    }
  }
  return true;
}

module.exports = { stopAllWorkers: stopAllWorkers };
