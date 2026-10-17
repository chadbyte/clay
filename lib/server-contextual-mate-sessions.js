// Presentation-only session operations share Home's authoritative permissions,
// model policy, saved-session projection and session manager. No transcript tap.
function attachContextualMateSessions(ctx) {
  var receipts = new Map();
  var lifetime = 30 * 60 * 1000;
  function stamp(mate) { return JSON.stringify([mate.id, mate.createdBy || null, mate.createdAt || null, mate.builtinKey || null]); }
  function live(ws, userId, msg, original) {
    if (!ctx.isActorLive(ws, userId)) throw new Error('Your account is no longer available.');
    var found = ctx.findMateProject(userId, msg.mateId, true);
    if (!found || found.mate.archived || found.mate.lifecycleDeletion || found.mate.createdBy && found.mate.createdBy !== userId || stamp(found.mate) !== msg.mateStamp) throw new Error('This Mate is no longer available.');
    var status = found.ctx.getStatus();
    if (!status || !status.isMate || status.mateId !== found.mate.id || userId && status.projectOwnerId !== userId) throw new Error('This private Mate workspace is unavailable.');
    found.contextualManager = found.ctx.getSessionManager();
    found.contextualRevision = JSON.stringify([status.path, status.projectOwnerId, status.mateId, stamp(found.mate)]);
    if (original && (found.ctx !== original.ctx || found.contextualRevision !== original.contextualRevision || found.contextualManager !== original.contextualManager)) throw new Error('This Mate conversation changed.');
    return found;
  }
  function reply(ws, msg, data) { ctx.sendMessage(ws, Object.assign({ type: 'contextual_mate_sessions_result', requestId: msg.requestId, mateId: msg.mateId, mateStamp: msg.mateStamp }, data)); }
  async function perform(ws, userId, msg) {
    try {
      if (typeof msg.requestId !== 'string' || !/^mate-conversations-[a-z0-9-]{36}$/.test(msg.requestId)) throw new Error('Invalid conversation request.');
      var found = live(ws, userId, msg), manager = found.ctx.getSessionManager();
      if (!manager) throw new Error('Conversation history is unavailable.');
      if (msg.type === 'home_mate_sessions_list') {
        var list = ctx.listHomeSessions(found, userId);
        reply(ws, msg, { ok: true, sessions: list.slice(0, 500), truncated: list.length > 500 }); return;
      }
      var session;
      if (msg.type === 'home_mate_session_open') {
        session = ctx.resolveHomeSession(found, userId, msg.sessionId);
        if (!session || typeof msg.sessionOriginId !== 'string' || msg.sessionOriginId !== session.sessionOriginId) throw new Error('This conversation is no longer available.');
      } else {
        var now = Date.now();
        receipts.forEach(function (entry, key) { if (now - entry.at > lifetime) receipts.delete(key); });
        var key = JSON.stringify([userId, msg.mateId, msg.requestId]);
        var receipt = receipts.get(key);
        manager.sessions.forEach(function (candidate) { if (candidate.contextualCreationRequestId === msg.requestId && ctx.ownsSession(candidate, userId)) session = candidate; });
        if (session && session.contextualCreationMateStamp !== msg.mateStamp) throw new Error('This request belongs to a replaced Mate.');
        if (receipt && (!session || receipt.origin !== session.sessionOriginId || receipt.stamp !== msg.mateStamp)) throw new Error('The previously created conversation is no longer available.');
        if (!session && msg.lookupOnly) throw new Error('Creation was not confirmed. Start a new chat explicitly if you still want one.');
        if (!session) {
          if (receipts.size >= 1024) throw new Error('Please try starting a conversation later.');
          var resolved = await ctx.homeModels.resolveMateModel(ws, found, userId);
          found = live(ws, userId, msg, found);
          // Recheck after model resolution: concurrent retries select one exact session.
          manager.sessions.forEach(function (candidate) { if (candidate.contextualCreationRequestId === msg.requestId && ctx.ownsSession(candidate, userId)) session = candidate; });
          receipt = receipts.get(key);
          if (receipt && (!session || receipt.origin !== session.sessionOriginId || receipt.stamp !== msg.mateStamp)) throw new Error('The previously created conversation is no longer available.');
          if (session && session.contextualCreationMateStamp !== msg.mateStamp) throw new Error('This request belongs to a replaced Mate.');
          if (!session) {
            if (receipts.size >= 1024) throw new Error('Please try starting a conversation later.');
            session = manager.createSessionRaw({ ownerId: userId, vendor: resolved.vendor, model: resolved.model, effort: resolved.effort || null });
            session.contextualCreationRequestId = msg.requestId;
            session.contextualCreationMateStamp = msg.mateStamp;
            manager.saveSessionFile(session);
          }
        }
        if (!ctx.ownsSession(session, userId)) throw new Error('This conversation is no longer available.');
        receipts.set(key, { at: now, origin: session.sessionOriginId, stamp: msg.mateStamp });
      }
      live(ws, userId, msg, found);
      reply(ws, msg, { ok: true, sessionId: session.localId, sessionOriginId: session.sessionOriginId });
    } catch (error) { reply(ws, msg, { ok: false, error: error.message || 'Conversation unavailable.' }); }
  }
  return { handle: function (ws, userId, msg) {
    if (msg.presentation !== 'contextual' || !/^home_mate_(sessions_list|session_open|new_session)$/.test(msg.type)) return false;
    perform(ws, userId, msg); return true;
  } };
}
module.exports = { attachContextualMateSessions: attachContextualMateSessions };
