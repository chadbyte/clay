// Shared authorization for project requests and long-lived file subscriptions.
var fileFailure = require("./project-file-path").failure;
function attachRequestAccess(ctx) {
  var users = ctx.usersModule;
  var opts = ctx.opts || {};

  function isMultiUser() {
    return !!(users && users.isMultiUser && users.isMultiUser());
  }

  function userFor(ws) {
    var user = ws && ws._clayUser;
    if (user && users && users.findUserById) return users.findUserById(user.id);
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
    if (!user || !user.linuxUser) throw fileFailure("OS_IDENTITY", "OS user identity is unavailable");
    var info = ctx.getOsUserInfoForWs({ _clayUser: user });
    if (!info) throw fileFailure("OS_IDENTITY", "OS user identity is unavailable");
    return info;
  }

  function isSoleAccount(ws) {
    if (!users || typeof users.getAllUsers !== "function") return false;
    try {
      var accounts = users.getAllUsers();
      var user = userFor(ws);
      return !!(user && user.id && Array.isArray(accounts) && accounts.length === 1 &&
        accounts[0] && accounts[0].id === user.id);
    } catch (e) { return false; }
  }

  function fileScope(ws) {
    if (!canUseFiles(ws)) throw fileFailure("FILE_FORBIDDEN", "File browser access is not permitted");
    var identity = osIdentity(ws);
    // Recheck the account roster so adding another user restores the boundary
    // for shared installations without OS isolation, including active watches.
    return { identity: identity, projectBound: !identity && isMultiUser() && !isSoleAccount(ws) };
  }

  return { permitMessage: permitMessage, canAccessProject: canAccessProject, hasPermission: hasPermission,
    canUseFiles: canUseFiles, isAdmin: isAdmin, canReadSession: canReadSession, osIdentity: osIdentity, fileScope: fileScope };
}

module.exports = { attachRequestAccess: attachRequestAccess };
