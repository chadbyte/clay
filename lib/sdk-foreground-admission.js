// One next-message admission window, bound to the exact live provider query.
// This is not turn completion: processing and pending terminal counts survive.
function available(session) {
  var credit = session && session._foregroundAdmission;
  return !!(credit && session.queryInstance === credit.query
    && Number(session._sdkQueryGeneration || 0) === credit.generation
    && !session.taskStopRequested && !session._pendingMessageDrainPaused
    && !(session.abortController && session.abortController.signal.aborted));
}
function offer(session) {
  if (!session.queryInstance || session.taskStopRequested || session.abortController && session.abortController.signal.aborted) return false;
  session._foregroundAdmission = { query: session.queryInstance, generation: Number(session._sdkQueryGeneration || 0) };
  return true;
}
function take(session) { delete session._foregroundAdmission; }
module.exports = { available: available, offer: offer, take: take };
