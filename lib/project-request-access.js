// Shared authorization for project requests and long-lived file subscriptions.
function attachRequestAccess(ctx) {
  var users = ctx.usersModule;
  var opts = ctx.opts || {};

  function isMultiUser() {
    return !!(users && users.isMultiUser && users.isMultiUser());
  }

  function userFor(ws) {
    var user = ws && ws._clayUser;
    if (user && users.findUserById) return users.findUserById(user.id);
    return user || null;
  }

  function canAccessProject(ws, slug) {
    if (!isMultiUser()) return true;
    var user = userFor(ws);
    if (!user || typeof slug !== "string" || !slug) return false;
    try {
      return typeof opts.canAccessProjectSlug === "function" && opts.canAccessProjectSlug(user.id, slug) === true;
    } catch (e) { return false; }
  }

  function permitMessage(ws, msg) {
    if (canAccessProject(ws, ctx.slug) && (!msg.targetSlug || canAccessProject(ws, msg.targetSlug))) return true;
    ctx.sendTo(ws, { type: "error", text: "Project access is not permitted" });
    return false;
  }

  function hasPermission(ws, permission) {
    var user = userFor(ws);
    if (!user) return !isMultiUser();
    return users.getEffectivePermissions(user, ctx.osUsers)[permission] === true;
  }

  function canUseFiles(ws) {
    return canAccessProject(ws, ctx.slug) && hasPermission(ws, "fileBrowser");
  }

  function isAdmin(ws) {
    if (!isMultiUser() && !(ws && ws._clayUser)) return true;
    var user = userFor(ws);
    return !!(user && user.role === "admin");
  }

  function canReadSession(ws, session) {
    if (!isMultiUser()) return true;
    var user = userFor(ws);
    return !!(user && canAccessProject(ws, ctx.slug) && users.canAccessSession(user.id, session, { visibility: "public" }));
  }

  function osIdentity(ws) {
    if (!ctx.osUsers) return null;
    var user = userFor(ws);
    if (!user || !user.linuxUser) throw new Error("OS user identity is unavailable");
    var info = ctx.getOsUserInfoForWs({ _clayUser: user });
    if (!info) throw new Error("OS user identity is unavailable");
    return info;
  }

  return { permitMessage: permitMessage, canAccessProject: canAccessProject, hasPermission: hasPermission,
    canUseFiles: canUseFiles, isAdmin: isAdmin, canReadSession: canReadSession, osIdentity: osIdentity };
}

module.exports = { attachRequestAccess: attachRequestAccess };
