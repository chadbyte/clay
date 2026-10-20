function count(value) { return value && typeof value === 'object' ? Object.keys(value).length : 0; }
function sessionActivity(session) {
  if (session.isProcessing) return 'processing';
  if (count(session.pendingPermissions)) return 'waiting_for_approval';
  return 'idle';
}
function currentState(session) {
  var approvals = count(session.pendingPermissions);
  var input = count(session.pendingAskUser) + count(session.pendingUserDialogs) + count(session.pendingElicitations);
  var processing = session.isProcessing === true, starting = session._queryStarting === true;
  var recoveryStopPending = !!session._responseRecoveryStopPending;
  var questions = count(session.pendingAskUser), dialogs = count(session.pendingUserDialogs), elicitations = count(session.pendingElicitations);
  var stopRequested = session.taskStopRequested === true, queuePaused = session._pendingMessageDrainPaused === true;
  // Review requests are a subset of pending questions, never an approval result.
  var reviews = Object.values(session.pendingAskUser || {}).filter(function (pending) { return pending && pending.request && ['product-control', 'mcp-import', 'mate-schedule'].indexOf(pending.request.source) >= 0; }).length;
  var state = 'unknown';
  if (stopRequested || queuePaused) state = processing || starting || recoveryStopPending ? 'stopping' : 'stopped';
  else if (approvals || reviews) state = 'awaiting_approval';
  else if (input) state = 'awaiting_input';
  else if (recoveryStopPending) state = 'recovering';
  else if (processing || starting) state = 'working';
  else if (session.isProcessing === false) state = 'idle';
  return { state: state, observedAt: Date.now(), recoveryStopPending: recoveryStopPending, queryGeneration: Number.isInteger(session._sdkQueryGeneration) ? session._sdkQueryGeneration : null,
    pendingReviewCount: reviews, pendingQuestionCount: questions, pendingDialogCount: dialogs, pendingElicitationCount: elicitations, processing: processing, starting: starting, stopRequested: stopRequested, queuePaused: queuePaused,
    pendingApprovalCount: approvals, pendingInputCount: input, providerConnection: 'unknown',
    evidence: 'Live server session flags and pending request registries; idle does not establish task completion.' };
}
module.exports = { sessionActivity: sessionActivity, currentState: currentState };
