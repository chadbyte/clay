// Validation and bounded projections for Issues.

var TYPES = ["bug", "feature", "plan"];
var PRIORITIES = ["normal", "important", "urgent"];
var STATUSES = ["open", "in_progress", "resolved", "closed"];

function text(value, name, max, required) {
  if (typeof value !== "string") {
    throw new Error(name + " must be a string.");
  }
  var result = value.trim();
  if (required && !result) throw new Error(name + " is required.");
  if (result.length > max) throw new Error(name + " exceeds " + max + " characters.");
  return result;
}

function choice(value, name, allowed, fallback) {
  var result = value === undefined ? fallback : value;
  if (typeof result !== "string" || allowed.indexOf(result) === -1) {
    throw new Error("Invalid " + name + ".");
  }
  return result;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeVerifiedCommit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid verified commit evidence.");
  var sha = text(value.sha, "verified commit SHA", 64, true).toLowerCase();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("Verified commit evidence requires a full SHA.");
  return {
    sha: sha,
    subject: text(value.subject, "verified commit subject", 400, true),
    verifiedAt: Number(value.verifiedAt) || Date.now(),
    repository: text(value.repository, "verified commit repository", 120, true),
  };
}

function normalizeContext(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid issue context.");
  var result = {};
  if (value.kind !== undefined) result.kind = text(value.kind, "context.kind", 32, true);
  if (value.changeSetId !== undefined) result.changeSetId = text(value.changeSetId, "context.changeSetId", 120, true);
  if (value.branch != null) result.branch = text(value.branch, "context.branch", 200, false) || null;
  if (value.baseCommit != null) result.baseCommit = text(value.baseCommit, "context.baseCommit", 64, false) || null;
  if (value.headCommit != null) result.headCommit = text(value.headCommit, "context.headCommit", 64, false) || null;
  return Object.keys(result).length ? result : null;
}

function normalizeSessions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 40) throw new Error("linked work sessions must be an array of at most 40 items.");
  var out = [];
  for (var i = 0; i < value.length; i++) {
    if (!value[i] || typeof value[i] !== "object") throw new Error("Invalid linked work session.");
    var session = {
      sessionId: text(value[i].sessionId, "linked work session id", 120, true),
      role: text(value[i].role, "linked work session role", 32, true),
    };
    if (value[i].issueRevision !== undefined) {
      if (!Number.isInteger(value[i].issueRevision) || value[i].issueRevision < 1) throw new Error("Invalid linked issue revision.");
      session.issueRevision = value[i].issueRevision;
    }
    if (value[i].requestId !== undefined) session.requestId = text(value[i].requestId, "linked work request id", 200, true);
    out.push(session);
  }
  return out;
}

function snapshot(input, current) {
  var data = input || {};
  var base = current || {};
  var allowed = { title: true, summary: true, body: true, resolutionSummary: true, type: true, priority: true, status: true,
    context: true, linkedWorkSessions: true, resolutionHistory: true, verifiedCommit: true, closeReason: true };
  var keys = Object.keys(data);
  for (var ki = 0; ki < keys.length; ki++) if (!Object.prototype.hasOwnProperty.call(allowed, keys[ki])) throw new Error("Unknown issue field: " + keys[ki] + ".");
  var result = {
    title: data.title === undefined ? base.title || "" : text(data.title, "title", 200, true),
    summary: data.summary === undefined ? base.summary || "" : text(data.summary, "summary", 400, false),
    body: data.body === undefined ? base.body || "" : text(data.body, "body", 20000, false),
    resolutionSummary: data.resolutionSummary === undefined ? base.resolutionSummary || "" : text(data.resolutionSummary, "resolutionSummary", 400, false),
    type: data.type === undefined ? base.type || "bug" : choice(data.type, "type", TYPES),
    priority: data.priority === undefined ? base.priority || "normal" : choice(data.priority, "priority", PRIORITIES),
    status: data.status === undefined ? base.status || "open" : choice(data.status, "status", STATUSES),
    context: data.context === undefined ? clone(base.context || null) : normalizeContext(data.context),
    linkedWorkSessions: data.linkedWorkSessions === undefined ? clone(base.linkedWorkSessions || []) : normalizeSessions(data.linkedWorkSessions),
    resolutionHistory: clone(base.resolutionHistory || []),
  };
  if (!result.title) throw new Error("title is required.");
  if (data.verifiedCommit !== undefined) result.verifiedCommit = normalizeVerifiedCommit(data.verifiedCommit);
  else if (base.verifiedCommit) result.verifiedCommit = normalizeVerifiedCommit(base.verifiedCommit);
  if (result.status === "resolved" && (!result.resolutionSummary || !result.verifiedCommit)) {
    throw new Error("resolved issues require a resolutionSummary and verified commit evidence.");
  }
  if (result.status !== "resolved" && result.status !== "closed") delete result.verifiedCommit;
  if (result.status !== "resolved" && result.status !== "closed") delete result.resolutionSummary;
  if (result.status === "closed") {
    var reason = data.closeReason === undefined ? base.closeReason : data.closeReason;
    result.closeReason = choice(reason, "close reason", ["declined", "duplicate", "non_code_decision"]);
  } else if (data.closeReason !== undefined) {
    throw new Error("closeReason is only valid when closing an issue.");
  }
  return result;
}

module.exports = {
  TYPES: TYPES,
  PRIORITIES: PRIORITIES,
  STATUSES: STATUSES,
  clone: clone,
  normalizeContext: normalizeContext,
  normalizeSessions: normalizeSessions,
  normalizeVerifiedCommit: normalizeVerifiedCommit,
  snapshot: snapshot,
  text: text,
};
