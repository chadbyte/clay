// Keeps Capsule LLM selection and execution bound to one live project actor.

function attachProjectToolLlmRuntime(ctx) {
  function currentPrincipal(ws) {
    if (!ctx.users.isMultiUser() && !ctx.osUsers) return { userId: "default", linuxUser: null };
    var claimedId = ws && ws._clayUser && ws._clayUser.id;
    var user = claimedId ? ctx.users.findUserById(claimedId) : null;
    if (!user) throw new Error("Authenticated user identity is required for this AI request.");
    var access = ctx.getProjectAccess();
    if (!ctx.users.canAccessProject(user.id, access)) throw new Error("Project access is no longer available for this AI request.");
    var linuxUser = ctx.osUsers ? user.linuxUser || null : null;
    if (ctx.osUsers && !linuxUser) throw new Error("An OS user identity is required for this AI request.");
    return { userId: user.id, linuxUser: linuxUser };
  }

  function revalidatePrincipal(ws, expected) {
    var current = currentPrincipal(ws);
    if (current.userId !== expected.userId || current.linuxUser !== expected.linuxUser) {
      throw new Error("The authenticated runtime identity changed while the AI request was loading.");
    }
    return current;
  }

  async function getConfiguration(ws, alias) {
    var principal = currentPrincipal(ws);
    var selection = await ctx.resolveModel(ws, alias);
    revalidatePrincipal(ws, principal);
    return selection;
  }

  async function complete(ws, args) {
    var principal = currentPrincipal(ws);
    var selection = await ctx.resolveModel(ws, args.model);
    var live = revalidatePrincipal(ws, principal);
    return ctx.complete({
      adapters: ctx.adapters,
      cwd: ctx.cwd,
      linuxUser: live.linuxUser,
      args: args,
      selection: selection,
      timeoutMs: 60000,
    });
  }

  return { getConfiguration: getConfiguration, complete: complete };
}

module.exports = { attachProjectToolLlmRuntime: attachProjectToolLlmRuntime };
