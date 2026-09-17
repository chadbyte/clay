var pairUsage = require("./project-pair-usage");
var workerProposalControl = require("./worker-proposal-control");
var continuationPair = require("./driver-continuation-pair");

var PRESSURE_RATIO = 0.8;
var MIN_JUSTIFICATION_CHARS = 12;
var ACTIVE_RUN_STATES = ["armed", "running", "reviewing", "waiting-worker", "waiting-user", "paused"];

function hasEntries(value) {
  return !!(value && Object.keys(value).length > 0);
}

function historicalProposal(session) {
  var history = session && session.history || [];
  for (var i = 0; i < history.length; i++) {
    if (history[i] && history[i].type === "driver_continuation_proposal") return history[i];
  }
  return null;
}

function unsafeReason(session, ctx) {
  if (session._queryStarting) return "Wait for the current Driver connection to finish starting.";
  if (ctx.pendingMessageQueue && ctx.pendingMessageQueue.hasActive(session)) {
    return "Pending human messages must be handled before proposing continuation.";
  }
  if (session.scheduledMessage || session.rateLimitAutoContinuePending) return "A scheduled callback is still attached to this session.";
  if (session.autonomousRun && ACTIVE_RUN_STATES.indexOf(session.autonomousRun.state) !== -1) {
    return "Until complete is still active in this session.";
  }
  if (hasEntries(session.pendingPermissions) || hasEntries(session.pendingAskUser) ||
      hasEntries(session.pendingElicitations) || hasEntries(session.pendingUserDialogs)) {
    return "This session is waiting for a permission or user-input response.";
  }
  if (workerProposalControl.pendingProposal(session)) return "A Split Worker proposal is still waiting for a decision.";
  var pair = continuationPair.inspect(session, ctx);
  if (!pair.ok) return pair.error;
  if (!pair.group && (session._pairDelegation || continuationPair.activeFollowups(session))) {
    return "Split Worker work or follow-ups are still pending.";
  }
  if (session.pendingPush && session.pendingPush.length) return "Messages are still waiting for delivery in this session.";
  if (session.taskStopRequested || session.destroying || session._runtimeRefreshRequested) {
    return "This session is changing state; retry when it is idle.";
  }
  return "";
}

function measuredEvidence(session) {
  var status = pairUsage.contextStatus(session);
  var current = status.current || {};
  if (current.scope === "current_context" && current.usedRatio !== null &&
      current.usedRatio >= PRESSURE_RATIO && current.usedTokens >= 0 && current.windowTokens > 0) {
    return { status: status, evidence: {
      kind: "current_context_pressure",
      source: current.source,
      usedTokens: current.usedTokens,
      windowTokens: current.windowTokens,
      usedRatio: current.usedRatio,
      thresholdRatio: PRESSURE_RATIO,
    } };
  }
  var compactions = status.compactions || {};
  if (compactions.observedCount > 0 && compactions.active === false) {
    return { status: status, evidence: {
      kind: "recorded_compaction",
      observedCount: compactions.observedCount,
      lastObservedAt: compactions.lastObservedAt || null,
      source: compactions.scope,
    } };
  }
  return { status: status, error: "Continuation needs measured current-context pressure or a completed compaction recorded by Clay." };
}

function unsupportedSavings(value) {
  return /guarantee(?:d|s)?\s+(token|context|cost|time|efficien|saving)|will\s+save\s+\d|save\s+\d+\s*%/i.test(value || "");
}

function evaluate(session, ctx, fields) {
  var previous = historicalProposal(session);
  if (previous) return { error: "This source session has already posted its one proactive continuation proposal.", previous: previous };
  if (session.driverContinuationDecline) return { error: "The user chose to stay in this source session. Do not propose continuation again." };
  var unsafe = unsafeReason(session, ctx);
  if (unsafe) return { error: unsafe };
  if (!fields.reason || fields.reason.length < MIN_JUSTIFICATION_CHARS) {
    return { error: "Explain why moving now is useful with a concrete reason." };
  }
  if (!fields.milestone || fields.milestone.length < MIN_JUSTIFICATION_CHARS) {
    return { error: "Describe the completed milestone or safe boundary before proposing continuation." };
  }
  if (!fields.benefit || fields.benefit.length < MIN_JUSTIFICATION_CHARS) {
    return { error: "Describe the concrete continuity benefit of moving now." };
  }
  if (!fields.nextAction || fields.nextAction.length < MIN_JUSTIFICATION_CHARS) {
    return { error: "Provide a prepared, concrete next action for the successor." };
  }
  if (unsupportedSavings(fields.reason + "\n" + fields.benefit)) {
    return { error: "Do not claim guaranteed or quantified savings without measured evidence." };
  }
  return measuredEvidence(session);
}

function prompt(session) {
  var observed = measuredEvidence(session);
  var evidence = observed.evidence ? JSON.stringify(observed.evidence) : "not currently eligible";
  return "A proactive Driver continuation is rare and may be proposed at most once for this source session. " +
    "The server currently reports: " + evidence + ". Propose only after a concrete milestone at a safe boundary, with a specific reason to move now, a continuity benefit, and a prepared next action. " +
    "Clay validates current-context pressure or a completed recorded compaction; cumulative spend, unknown status, conversation length, and model-supplied evidence do not qualify. Never promise token, time, cost, or efficiency savings. Stay here permanently suppresses proactive continuation for this source. Human acceptance is always required.";
}

module.exports = { PRESSURE_RATIO: PRESSURE_RATIO, historicalProposal: historicalProposal,
  measuredEvidence: measuredEvidence, evaluate: evaluate, prompt: prompt };
