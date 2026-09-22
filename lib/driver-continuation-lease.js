function closeTarget(target) {
  if (!target || !target.queryInstance) return;
  try { target.queryInstance.close(); }
  catch (error) {}
}

function begin(source, target, proposalId) {
  var lease = {
    proposalId: proposalId,
    target: target,
    cancelled: false,
    error: null,
    waitingLateStartup: false,
  };
  lease.cancel = function (reason) {
    if (!lease.cancelled) {
      lease.cancelled = true;
      lease.error = reason || "The source received new work during continuation startup.";
      closeTarget(target);
    }
    if (typeof lease.onCancel === "function") return lease.onCancel(lease.error);
  };
  source._driverContinuationLease = lease;
  return lease;
}

function guard(lease, validate) {
  if (!lease || lease.cancelled) return false;
  try {
    var error = validate();
    if (!error) return true;
    lease.cancel(error);
  } catch (error) {
    lease.cancel(error.message || String(error));
  }
  return false;
}

function cancelForHumanMessage(session) {
  var lease = session && session._driverContinuationLease;
  if (!lease || typeof lease.cancel !== "function") return false;
  lease.cancel("New source work arrived during continuation startup.");
  return true;
}

function end(source, lease) {
  if (!source || source._driverContinuationLease !== lease) return false;
  delete source._driverContinuationLease;
  return true;
}

module.exports = { begin: begin, guard: guard, cancelForHumanMessage: cancelForHumanMessage, end: end };
