function normalize(value) {
  return value === "shared" ? "shared" : "private";
}

function restore(meta) {
  // Older releases persisted the shared default without recording intent.
  return meta.sessionVisibilityExplicit === true ? normalize(meta.sessionVisibility) : "private";
}

function defaultForProject(access) {
  return access && access.sessionVisibilityDefault === "shared" ? "shared" : "private";
}

function resolveNewSessionVisibility(access, msg, isMate) {
  if (isMate === true) return { visibility: "private" };
  if (!msg || !Object.prototype.hasOwnProperty.call(msg, "sessionVisibility")) {
    return { visibility: defaultForProject(access) };
  }
  if (msg.sessionVisibility === "private" || msg.sessionVisibility === "shared") {
    return { visibility: msg.sessionVisibility };
  }
  return { error: "Session visibility must be private or shared." };
}

function defaultChangeResult(ctx, ws, msg, result) {
  var requestedSlug = typeof msg.slug === "string" && msg.slug.length > 0 && msg.slug.length <= 200 ? msg.slug : ctx.slug;
  ctx.sendTo(ws, Object.assign({
    type: "set_project_session_visibility_default_result",
    slug: requestedSlug,
    requestId: typeof msg.requestId === "string" ? msg.requestId.substring(0, 200) : null,
  }, result));
}

function handleDefaultChange(ctx, ws, msg) {
  if (!msg || (msg.visibility !== "shared" && msg.visibility !== "private")) {
    defaultChangeResult(ctx, ws, msg || {}, { ok: false, error: "Session visibility default must be private or shared." });
    return true;
  }
  if (msg.slug && msg.slug !== ctx.slug) {
    defaultChangeResult(ctx, ws, msg, { ok: false, error: "Project settings access is not permitted" });
    return true;
  }
  if (ctx.isMate === true || !ctx.usersModule || !ctx.usersModule.isMultiUser || !ctx.usersModule.isMultiUser()) {
    defaultChangeResult(ctx, ws, msg, { ok: false, error: "Not supported" });
    return true;
  }
  var user = ws && ws._clayUser && ctx.usersModule.findUserById(ws._clayUser.id);
  var access = ctx.getProjectAccess ? ctx.getProjectAccess() : null;
  if (access && access.isWorktree === true) {
    defaultChangeResult(ctx, ws, msg, { ok: false, error: "Worktrees inherit this setting from their parent project." });
    return true;
  }
  var permissions = user && ctx.usersModule.getEffectivePermissions
    ? ctx.usersModule.getEffectivePermissions(user, ctx.osUsers) : {};
  var isOwner = !!(user && access && access.ownerId && access.ownerId === user.id);
  var isAdmin = !!(user && user.role === "admin");
  if (!user || !permissions.projectSettings || (!isOwner && !isAdmin)) {
    defaultChangeResult(ctx, ws, msg, { ok: false, error: "Project settings access is not permitted" });
    return true;
  }
  if (typeof ctx.opts.onSetProjectSessionVisibilityDefault !== "function") {
    defaultChangeResult(ctx, ws, msg, { ok: false, error: "Not supported" });
    return true;
  }
  var result = ctx.opts.onSetProjectSessionVisibilityDefault(ctx.slug, msg.visibility);
  defaultChangeResult(ctx, ws, msg, { ok: !!(result && result.ok), visibility: result && result.visibility, error: result && result.error });
  return true;
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
    var project = ctx.getProjectAccess ? ctx.getProjectAccess() : null;
    ctx.clients.forEach(function(client) {
      if (client._clayActiveSession !== session.localId) return;
      var userId = client._clayUser && client._clayUser.id;
      if (userId && ctx.usersModule.canAccessSession(userId, session, project)) return;
      // Clear the server-side selection before reconnecting so no further
      // session events or input can cross the revoked access boundary.
      client._clayActiveSession = null;
      if (client.readyState === 1) client.close(1008, "Session access changed");
    });
  }
}

module.exports = { normalize: normalize, restore: restore, defaultForProject: defaultForProject, resolveNewSessionVisibility: resolveNewSessionVisibility,
  handleChange: handleChange, handleDefaultChange: handleDefaultChange, revokeViewers: revokeViewers };
