function stopAutonomousWork(session, roles, turnControl, taskControl, workerPermission) {
  if (!roles) return false;
  var runId = session.autonomousRun && session.autonomousRun.id;
  var workers = roles.workers || [roles.worker];
  var cancelled = 0, owned = [];
  for (var wi = 0; wi < workers.length; wi++) {
    cancelled += taskControl.cancelAll(workers[wi], runId);
    if (workers[wi]._pairDelegation && workers[wi]._pairDelegation.autonomousRunId === runId) owned.push(workers[wi]);
  }
  if (!owned.length && !cancelled) return true;
  turnControl.markHumanStop(session);
  if (!owned.length) return true;
  for (var oi = 0; oi < owned.length; oi++) {
    taskControl.markInterruption(owned[oi], "user", "The Until complete run was stopped.");
    workerPermission.cancelForSession(owned[oi], "The Until complete run was stopped.");
    owned[oi].taskStopRequested = true;
    if (owned[oi].abortController) owned[oi].abortController.abort();
  }
  return true;
}

module.exports = { stopAutonomousWork: stopAutonomousWork };
