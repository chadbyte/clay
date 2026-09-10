var buildShape = require("./session-spawn-mcp-server").buildShape;

function findProposal(session, proposalId) {
  var history = (session && session.history) || [];
  for (var i = history.length - 1; i >= 0; i--) {
    if (history[i] && history[i].type === "worker_proposal" && history[i].proposalId === proposalId) return history[i];
  }
  return null;
}

function pendingProposal(session) {
  var history = (session && session.history) || [];
  for (var i = history.length - 1; i >= 0; i--) {
    var item = history[i];
    if (!item || item.type !== "worker_proposal") continue;
    if (item.status === "pending" || item.status === "starting") return item;
  }
  return null;
}

function projection(proposal) {
  if (!proposal) return { status: "none", proposal: null };
  return {
    status: proposal.status,
    proposal: {
      proposalId: proposal.proposalId,
      action: proposal.action === "replace" ? "replace" : "create",
      summary: proposal.summary || "",
      recommendedVendor: proposal.recommendedVendor || null,
      recommendedModel: proposal.recommendedModel || null,
      recommendedEffort: proposal.recommendedEffort || null,
      status: proposal.status,
      pending: proposal.status === "pending",
      decisionRequired: proposal.status === "pending",
      transactionId: proposal.transactionId || null,
      sourceWorkerId: proposal.sourceWorkerId || null,
      createdAt: proposal.createdAt || null,
      updatedAt: proposal.updatedAt || null,
    },
  };
}

function getToolDefs(handlers) {
  return [{
    name: "inspect_worker_proposal",
    description: "Inspect the exact unresolved Split Worker configuration proposal for this Driver. Returns none when no user decision is pending.",
    inputSchema: buildShape({}),
    handler: function () { return handlers.inspect(); },
  }, {
    name: "cancel_worker_proposal",
    description: "Cancel one exact pending Split Worker configuration proposal. A proposal that is already accepted, starting, superseded, declined, or otherwise resolved cannot be cancelled.",
    inputSchema: buildShape({
      proposalId: { type: "string", description: "Exact proposal id returned by propose_worker, replace_partner, or inspect_worker_proposal." },
    }, ["proposalId"]),
    handler: function (args) { return handlers.cancel(args || {}); },
  }, {
    name: "worker_runtime_catalog",
    description: "List server-observed executable Split Worker vendor, model, and effort combinations, including approval mode and temporary unavailability reasons.",
    inputSchema: buildShape({}),
    handler: function () { return handlers.catalog(); },
  }];
}

module.exports = {
  findProposal: findProposal,
  getToolDefs: getToolDefs,
  pendingProposal: pendingProposal,
  projection: projection,
};
