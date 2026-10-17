// Shared Home/Mate delivery. Canonical callers supply an exact live guard and
// persist delegated provenance before any provider input is admitted.
async function deliver(ctx, session, text, options) {
  options = options || {};
  var guarded = typeof options.revalidate === 'function';
  function current() {
    if (ctx.sm.sessions.get(session.localId) !== session) throw new Error('The conversation was deleted or replaced.');
    if (guarded) {
      options.revalidate();
      if (session.taskStopRequested || session._pendingMessageDrainPaused || session._responseRecoveryStopPending || session.abortController && session.abortController.signal.aborted) throw new Error('The conversation is stopped; explicit owner resumption is required.');
    }
    return true;
  }
  if (guarded) current.exactProductDelivery = true;
  current();
  var event = options.event || { type: 'user_message', text: text };
  if (guarded) {
    if (ctx.sm.saveSessionFile(session) !== true) throw new Error('The conversation could not be saved; no provider delivery was attempted.');
    if (ctx.sm.sendAndRecordDurably(session, event) !== true) throw new Error('The delegated message could not be saved; no provider delivery was attempted.');
    session._mcpForeignInput = true;
  } else ctx.sm.sendAndRecord(session, event);
  var attempted = false;
  try {
    current();
    var active = !!session.isProcessing;
    session.isProcessing = true;
    if (!active) session.sentToolResults = {};
    if (options.onRecorded) options.onRecorded(session);
    var queryText = options.queryText || text;
    attempted = true;
    if (session.queryInstance || session.worker && session.messageQueue === 'worker' || active) {
      if (ctx.sdk.pushMessage(session, queryText, null) === true) return { status: 'queued', persisted: true, delivery: 'accepted', completion: 'pending' };
      if (active) return { status: 'failed', persisted: true, delivery: 'rejected', retrySafe: false, error: 'The active provider did not accept the message. Inspect before another request.' };
    }
    var accepted = await ctx.sdk.startQuery(session, queryText, null, ctx.linuxUser || null, guarded ? current : undefined);
    return { status: accepted === true ? 'started' : 'failed', persisted: true, delivery: accepted === true ? 'accepted' : 'not_confirmed', completion: 'pending', retrySafe: false };
  } catch (error) {
    if (!attempted) session.isProcessing = false;
    error.productControlResult = { persisted: true, delivery: attempted ? 'unknown' : 'not_attempted', retrySafe: false };
    throw error;
  }
}
module.exports = { deliver: deliver };
