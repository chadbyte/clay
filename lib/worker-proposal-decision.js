// An accepted execution record is not an unanswered configuration decision.
// Execution interruption and replacement safety belong to the pair lifecycle.
function hasPendingProposal(session) {
  var history = (session && session.history) || [];
  for (var i = history.length - 1; i >= 0; i--) {
    var item = history[i];
    if (!item || item.type !== "worker_proposal") continue;
    return item.status === "pending" || item.status === "starting";
  }
  return false;
}

module.exports = { hasPendingProposal: hasPendingProposal };
