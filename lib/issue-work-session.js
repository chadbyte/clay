// Exact revision guard for opening a Driver linked to an Issue.

function resolveIssueWorkSession(bound, args) {
  if (!bound || !args || !Number.isInteger(args.expectedRevision)) throw new Error("expectedRevision is required.");
  var entry = bound.readIssue({ ref: args.ref });
  if (entry.revision !== args.expectedRevision) throw new Error("Issue revision conflict.");
  return bound.resolveWorkSession(args);
}

module.exports = { resolveIssueWorkSession: resolveIssueWorkSession };
