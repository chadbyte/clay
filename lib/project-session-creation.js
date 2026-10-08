// Inline session creation for the project sidebar. The draft row's provider
// dropdown lists every registered provider the server knows, flagging which are
// installed and authorized for the caller; only those can be created. The model
// and effort stay whatever the provider's existing defaults produce. This module
// serves that list together with the project-scoped default provider, and saves
// that default on request.
//
// The default is stored per project (daemon config, see new-session-default.js)
// and holds a provider id only. It is never a per-user or global preference.

var MAX_REQUEST_ID = 200;

function cleanRequestId(value) {
  return typeof value === "string" ? value.substring(0, MAX_REQUEST_ID) : null;
}

function attachSessionCreation(ctx) {
  var slug = ctx.slug;
  var usersModule = ctx.usersModule;
  var opts = ctx.opts || {};
  var sendTo = ctx.sendTo;

  function actor(ws) {
    if (!usersModule.isMultiUser()) return { ok: true, user: null };
    var user = ws && ws._clayUser && usersModule.findUserById(ws._clayUser.id);
    return user ? { ok: true, user: user } : { ok: false, user: null };
  }

  // Single-user installs own their projects. Otherwise project settings
  // permission plus project ownership (or admin) is required, like the other
  // project-wide defaults. Mate projects never get one; worktrees read their
  // parent's default and cannot set their own.
  function defaultPermission(ws) {
    if (ctx.isMate === true) return { ok: false, error: "Not supported" };
    var who = actor(ws);
    if (!who.ok) return { ok: false, error: "Your account is no longer available." };
    var access = ctx.getProjectAccess ? ctx.getProjectAccess() : null;
    if (access && access.isWorktree === true) return { ok: false, error: "Worktrees use the default of their parent project." };
    if (!usersModule.isMultiUser()) return { ok: true };
    var permissions = usersModule.getEffectivePermissions ? usersModule.getEffectivePermissions(who.user, ctx.osUsers) : {};
    var isOwner = !!(access && access.ownerId && access.ownerId === who.user.id);
    var isAdmin = who.user.role === "admin";
    if (!permissions.projectSettings || (!isOwner && !isAdmin)) return { ok: false, error: "Project settings access is not permitted" };
    return { ok: true };
  }

  function readProjectDefault() {
    if (typeof opts.onGetProjectNewSessionDefault !== "function") return null;
    var stored = opts.onGetProjectNewSessionDefault(slug);
    var value = stored && stored.preference;
    return value && typeof value.vendor === "string" && value.vendor ? value.vendor : null;
  }

  function installed(ws) {
    return (ctx.getVendorAvailability(ws) || []).filter(function (item) { return item.installed; });
  }

  function optionsMessage(ws, requestId) {
    return {
      type: "new_session_options", slug: slug, requestId: requestId,
      vendors: (ctx.getVendorAvailability(ws) || []).map(function (item) { return { id: item.id, displayName: item.displayName, installed: item.installed === true }; }),
      projectDefault: readProjectDefault(),
      canSetProjectDefault: defaultPermission(ws).ok,
    };
  }

  function wrongProject(ws, msg, type, requestId) {
    if (msg.slug === undefined || msg.slug === slug) return false;
    sendTo(ws, { type: type, slug: slug, requestId: requestId, ok: false, error: "This request belongs to a different project." });
    return true;
  }

  function setDefault(ws, msg) {
    var requestId = cleanRequestId(msg.requestId);
    function reply(extra) { sendTo(ws, Object.assign({ type: "new_session_default_result", slug: slug, requestId: requestId }, extra)); }
    if (wrongProject(ws, msg, "new_session_default_result", requestId)) return;
    var permission = defaultPermission(ws);
    if (!permission.ok) return reply({ ok: false, error: permission.error });
    if (typeof opts.onSetProjectNewSessionDefault !== "function") return reply({ ok: false, error: "Not supported" });
    var vendor = typeof msg.vendor === "string" ? msg.vendor : "";
    if (!vendor || !installed(ws).some(function (item) { return item.id === vendor; })) return reply({ ok: false, error: "That provider is not installed or authorized." });
    var result = opts.onSetProjectNewSessionDefault(slug, { vendor: vendor });
    if (!result || result.ok !== true) return reply({ ok: false, error: result && result.error || "The project default could not be saved." });
    reply({ ok: true, projectDefault: vendor });
    if (typeof ctx.send === "function") ctx.send({ type: "new_session_project_default", slug: slug, projectDefault: vendor });
  }

  function handleMessage(ws, msg) {
    if (msg.type === "new_session_options_get") {
      var requestId = cleanRequestId(msg.requestId);
      if (wrongProject(ws, msg, "new_session_options", requestId)) return true;
      sendTo(ws, optionsMessage(ws, requestId));
      return true;
    }
    if (msg.type === "new_session_default_set") { setDefault(ws, msg); return true; }
    return false;
  }

  return { handleMessage: handleMessage, isInstalled: function (ws, vendor) { return isInstalledFor(ctx, ws, vendor); } };
}

function isInstalledFor(ctx, ws, vendor) {
  if (typeof ctx.getVendorAvailability !== "function") return true;
  return (ctx.getVendorAvailability(ws) || []).some(function (item) { return item.id === vendor && item.installed; });
}

module.exports = { attachSessionCreation: attachSessionCreation };
