// An accepted execution record is not an unanswered configuration decision.
// Execution interruption and replacement safety belong to the pair lifecycle.
var pendingProposal = require("./worker-proposal-control").pendingProposal;

function hasPendingProposal(session) { return !!pendingProposal(session); }

module.exports = { hasPendingProposal: hasPendingProposal };
