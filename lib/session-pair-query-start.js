function beginPairQuery(ctx, session, text) {
  session._queryStartTs = Date.now();
  var promise = ctx.sdk.startQuery(session, text, undefined, ctx.linuxUser);
  var owner = {
    session: session,
    generation: Number(session._queryGeneration || 0),
  };
  session._pairResumeQuery = owner;
  Promise.resolve(promise).catch(function (error) {
    var current = ctx.sm.sessions.get(session.localId);
    var ownsCurrent = current === session && session._pairResumeQuery === owner &&
      Number(session._queryGeneration || 0) === owner.generation;
    if (!ownsCurrent) return;
    delete session._pairResumeQuery;
    session.isProcessing = false;
    ctx.sm.sendAndRecord(session, { type: "error", text: error.message || String(error) });
    ctx.onProcessingChanged();
  });
  return owner;
}

module.exports = { beginPairQuery: beginPairQuery };
