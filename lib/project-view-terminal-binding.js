// Saved descriptors are UI state, never authority to attach a terminal.
function attachSaved(ctx, ws, message) {
  var binding = message.savedBinding;
  if (!binding) return false;
  var terminal = ctx.tm.inspect(message.id), user = ws._clayUser;
  var osUser = ctx.getOsUserInfoForWs ? ctx.getOsUserInfoForWs(ws) : null;
  var osIdentity = osUser ? JSON.stringify([osUser.user, osUser.uid, osUser.gid, osUser.home]) : null;
  var allowed = terminal && !terminal.exited && terminal.kind !== 'tui-session' &&
    binding.identity === terminal.identity && binding.runtimeId === require('./clay-control-target-projection').runtime(ctx.sm) &&
    terminal.ownerId === (user ? user.id : null) && (terminal.osIdentity || null) === osIdentity;
  if (user && !ctx.usersModule.getEffectivePermissions(user, ctx.osUsers).terminal) allowed = false;
  if (!allowed) { ctx.sendTo(ws, { type: 'term_error', id: message.id, error: 'The exact saved terminal is unavailable or access changed.' }); return true; }
  ctx.tm.attach(message.id, ws);
  return true;
}
module.exports = { attachSaved: attachSaved };
