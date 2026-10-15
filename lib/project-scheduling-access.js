function attachSchedulingAccess(ctx) {
  function ownerIdentity(session) {
    if (!ctx.osUsers) return null;
    var username = ctx.getLinuxUser(session), identity = username && ctx.resolveLinuxUser(username);
    if (!identity) throw new Error('The schedule owner no longer has a valid mapped OS identity.');
    return identity;
  }
  return { ownerIdentity: ownerIdentity };
}
module.exports = { attachSchedulingAccess: attachSchedulingAccess };
