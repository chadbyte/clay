function normalize(value) {
  return value === "shared" ? "shared" : "private";
}

function restore(meta) {
  // Older releases persisted the shared default without recording intent.
  return meta.sessionVisibilityExplicit === true ? normalize(meta.sessionVisibility) : "private";
}

function handleChange(ctx, ws, msg) {
  if (typeof msg.sessionId !== "number" || (msg.visibility !== "shared" && msg.visibility !== "private")) return;
  var session = ctx.sm.sessions.get(msg.sessionId);
  if (!session) return;
  if (ctx.usersModule.isMultiUser()) {
    var user = ws._clayUser;
    var project = ctx.getProjectAccess ? ctx.getProjectAccess() : { visibility: "public" };
    if (!user || !session.ownerId || session.ownerId !== user.id ||
        !ctx.usersModule.canAccessSession(user.id, session, project)) return;
  } else if (session.ownerId) {
    return;
  }
  ctx.sm.setSessionVisibility(msg.sessionId, msg.visibility);
  revokeViewers(ctx, session);
}

function revokeViewers(ctx, session) {
  if (ctx.usersModule.isMultiUser() && session.sessionVisibility === "private") {
    ctx.clients.forEach(function(client) {
      if (client._clayActiveSession !== session.localId) return;
      if (client._clayUser && client._clayUser.id === session.ownerId) return;
      // Clear the server-side selection before reconnecting so no further
      // session events or input can cross the revoked access boundary.
      client._clayActiveSession = null;
      if (client.readyState === 1) client.close(1008, "Session access changed");
    });
  }
}

module.exports = { normalize: normalize, restore: restore, handleChange: handleChange, revokeViewers: revokeViewers };
