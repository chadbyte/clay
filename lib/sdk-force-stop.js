// Retire one exact query and invoke only its declared YOKE force operation.
function createForceStop(ctx) {
  return async function forceStop(session) {
    if (ctx.sm.sessions.get(session.localId) !== session) throw new Error('Session was deleted or replaced.');
    if (session._queryStarting) throw new Error('Force termination is unavailable while this runtime is starting');
    var terminate = require("./yoke/force-termination").operation(ctx.provider(session), session.queryInstance);
    var undelivered = session.pendingPush || [];
    session._forceStopRevision = (session._forceStopRevision || 0) + 1;
    session._sdkQueryGeneration = Number(session._sdkQueryGeneration || 0) + 1;
    session._queryGeneration = (session._queryGeneration || 0) + 1;
    session.taskStopRequested = true;
    session._pendingMessageDrainPaused = true;
    session.queryInstance = null;
    session.abortController = null;
    session.messageQueue = null;
    session._queryStarting = false;
    session._responseRecoveryStopPending = null;
    session.isProcessing = false;
    session._awaitingTurnResult = false;
    session._queuedTurnCount = 0;
    session.pendingPush = [];
    delete session._foregroundAdmission;
    delete session._providerRecoveryWaiting;
    session._lastTurnInterrupted = true;
    var probe = session._continuationStartupProbe;
    if (probe && probe.timer) clearTimeout(probe.timer);
    delete session._continuationStartupProbe;
    if (probe && typeof probe.resolve === 'function') probe.resolve({ accepted: false, reason: 'Force stopped.' });
    var permissions = session.pendingPermissions || {};
    Object.keys(permissions).forEach(function (id) {
      if (typeof permissions[id].resolve === 'function') permissions[id].resolve({ behavior: 'deny', message: 'Force stopped.' });
      if (ctx.sm.permissionRequestIndex) delete ctx.sm.permissionRequestIndex[id];
    });
    var questions = session.pendingAskUser || {};
    Object.keys(questions).forEach(function (id) {
      var respond = questions[id] && questions[id].respond;
      if (respond && typeof respond.cancel === 'function') respond.cancel('Force stopped.');
    });
    session.pendingPermissions = {};
    session.pendingAskUser = {};
    var dialogs = session.pendingUserDialogs || {};
    Object.keys(dialogs).forEach(function (id) { if (typeof dialogs[id].resolve === 'function') dialogs[id].resolve({ behavior: 'cancelled' }); });
    var elicitations = session.pendingElicitations || {};
    Object.keys(elicitations).forEach(function (id) { if (typeof elicitations[id].resolve === 'function') elicitations[id].resolve({ action: 'cancel' }); });
    session.pendingUserDialogs = {};
    session.pendingElicitations = {};
    var revision = session._forceStopRevision, generation = session._sdkQueryGeneration, owner = session.ownerId, vendor = session.vendor;
    ctx.changed(); ctx.sm.broadcastSessionList();
    var outcome;
    try { outcome = await terminate(); }
    catch (error) { outcome = { status: 'unconfirmed', externalEffects: 'unconfirmed' }; }
    if (ctx.sm.sessions.get(session.localId) !== session || session._forceStopRevision !== revision || session._sdkQueryGeneration !== generation || session.ownerId !== owner || session.vendor !== vendor || session.queryInstance || session._queryStarting) return { status: 'failed', runtimeEffect: 'connection_retired', providerStop: outcome.status, externalEffects: 'unconfirmed', queuePaused: true, detail: 'Session was replaced during termination.' };
    ctx.changed();
    if (undelivered.length) ctx.record(session, { type: 'error', text: 'Buffered messages were not replayed after force stop. Review them before sending again.', recoveryAdmission: { state: 'not_sent', messages: undelivered.map(function (item) { return { text: item.text, images: item.images || null }; }) } });
    ctx.record(session, { type: 'thinking_stop' });
    ctx.record(session, { type: 'info', text: (outcome.status === 'terminated' ? 'The query runtime exited.' : 'Query runtime termination could not be confirmed.') + ' Queued messages are paused. Commands or external requests already sent may still be running; inspect their outcome before continuing.' });
    ctx.record(session, { type: 'done', code: outcome.status === 'terminated' ? 0 : 1 });
    ctx.sm.broadcastSessionList();
    return { status: outcome.status === 'terminated' ? 'completed' : 'failed', runtimeEffect: 'connection_retired', providerStop: outcome.status, externalEffects: 'unconfirmed', queuePaused: true };
  };
}
module.exports = { createForceStop: createForceStop };
