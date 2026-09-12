function stopAutonomousWork(session, roles, turnControl, taskControl, workerPermission) {
  if (!roles) return false;
  var runId = session.autonomousRun && session.autonomousRun.id;
  var cancelled = taskControl.cancelAll(roles.worker, runId);
  var owned = roles.worker._pairDelegation && roles.worker._pairDelegation.autonomousRunId === runId;
  if (!owned && !cancelled) return true;
  turnControl.markHumanStop(session);
  if (!owned) return true;
  taskControl.markInterruption(roles.worker, "user", "The Until complete run was stopped.");
  workerPermission.cancelForSession(roles.worker, "The Until complete run was stopped.");
  roles.worker.taskStopRequested = true;
  if (roles.worker.abortController) roles.worker.abortController.abort();
  return true;
}

module.exports = { stopAutonomousWork: stopAutonomousWork };
