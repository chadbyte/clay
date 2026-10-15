// Project push payloads carry session content and use the same live authority
// as HTTP and WebSocket snapshots. Unscoped account/system pushes stay separate.
function scopedPush(push, ctx) {
  if (!push) return null;
  function permitted(userId, payload) {
    var data = payload.data || payload;
    var slug = data.slug || ctx.slug;
    var project = ctx.getProject(slug);
    if (!project || !data.sessionId || !ctx.canAccessProject(userId, slug)) return false;
    var session = project.getSessionManager().sessions.get(data.sessionId);
    var status = project.getStatus();
    var access = status.isMate ? { isMate: true, visibility: "private", ownerId: status.projectOwnerId } : ctx.getAccess(slug);
    return !!session && ctx.users.canAccessSession(userId, session, access);
  }
  return Object.assign({}, push, {
    sendPush: function (payload) {
      if (!ctx.users.isMultiUser()) return push.sendPush(payload);
      if (!push.sendPushToUser) return;
      ctx.users.getAllUsers().forEach(function (user) {
        if (permitted(user.id, payload)) push.sendPushToUser(user.id, payload);
      });
    },
    sendPushToUser: function (userId, payload) {
      if ((!ctx.users.isMultiUser() || permitted(userId, payload)) && push.sendPushToUser) push.sendPushToUser(userId, payload);
    },
  });
}
module.exports = { scopedPush: scopedPush };
