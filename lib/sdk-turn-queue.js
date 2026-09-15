// Results report queued sends, which can merge into fewer model turns.
function pendingSends(session, event) {
  if (Number.isInteger(event.queuedTurnCount) && event.queuedTurnCount >= 0) {
    var query = session.queryInstance;
    var current = query && typeof query.getSubmittedMessageCount === "function" ? query.getSubmittedMessageCount() : event.submittedMessageCount;
    var later = Number.isInteger(current) && Number.isInteger(event.submittedMessageCount)
      ? Math.max(0, current - event.submittedMessageCount) : 0;
    return event.queuedTurnCount + later;
  }
  var answered = Number.isInteger(event.answeredUserMessageCount) && event.answeredUserMessageCount > 0 ? event.answeredUserMessageCount : 1;
  return Math.max(0, (session._queuedTurnCount || 0) - answered + 1);
}

module.exports = { pendingSends: pendingSends };
