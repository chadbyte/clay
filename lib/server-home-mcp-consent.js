// Home transcript responses retain the project's server-owned consent request.
function attachHomeMcpConsent(ctx) {
  function respond(ws, userId, msg) {
    var found = ctx.findMateProject(userId, msg.mateId || null, false);
    var session = found && ctx.resolveHomeSession(found, userId, msg.sessionId);
    var tap = ctx.messageTap(ws, msg), pending = session && session.pendingAskUser && session.pendingAskUser[msg.toolId];
    if (!ctx.isActorLive(ws, userId) || !found || !session || !tap || tap.mateSlug !== found.slug || tap.sessionId !== session.localId || (tap.requestId || null) !== (msg.requestId || null) || !pending || !pending.request || pending.request.source !== 'mcp-import') {
      ctx.sendError(ws, found && found.mate.id, 'This owner import consent is unavailable or expired.', msg.requestId || null, msg.sessionId || null, 'question_expired', { toolId: msg.toolId }); return;
    }
    if (!found.ctx.handleHomeAskUserResponse({ type: 'ask_user_response', toolId: msg.toolId, answers: msg.answers || {} }, session, ws)) ctx.sendError(ws, found.mate.id, 'This import consent could not be submitted. No import was authorized.', msg.requestId || null, msg.sessionId, 'question_refused', { toolId: msg.toolId });
  }
  return { respond: respond };
}
module.exports = { attachHomeMcpConsent: attachHomeMcpConsent };
