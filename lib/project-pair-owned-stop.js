function stopOwnedPair(session, roles, turnControl, taskControl, workerPermission, reason) {
  if (!roles) return false;
  turnControl.markHumanStop(session);
  var workers = roles.workers || [roles.worker];
  for (var wi = 0; wi < workers.length; wi++) {
    taskControl.cancelAll(workers[wi]);
    taskControl.markInterruption(workers[wi], "user", reason || "The human stopped this scheduled run.");
    workerPermission.cancelForSession(workers[wi], reason || "The human stopped this scheduled run.");
  }
  var members = [roles.driver].concat(workers);
  for (var i = 0; i < members.length; i++) {
    members[i].taskStopRequested = true;
    if (members[i].queryInstance && typeof members[i].queryInstance.close === "function") {
      try { members[i].queryInstance.close(); } catch (e) {}
    }
    if (members[i].abortController) { try { members[i].abortController.abort(); } catch (e) {} }
  }
  return true;
}

module.exports = { stopOwnedPair: stopOwnedPair };
