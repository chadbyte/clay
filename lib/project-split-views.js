var layout = require("./split-view-layout");
var names = require("./project-split-view-names");
var sessionProvenance = require("./session-provenance");
var validDocument = require("./project-split-view-document").validDocument;
var createSplitViewsStore = require("./project-view-store").createSplitViewsStore;
var workspace = require("./project-view-workspace");
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function attachProjectSplitViews(ctx) {
  var store = createSplitViewsStore({ sessionsDir: ctx.sm.sessionsDir, slug: ctx.slug, persist: ctx.persist });
  var users = ctx.usersModule;
  function actor(ws) {
    if (ctx.isMate || !ws || ws.readyState !== 1 || !ctx.clients.has(ws) || ws._clayPaneActivation || !ctx.canAccessProject(ws)) return null;
    if (users.isMultiUser()) {
      var user = ws._clayUser && users.findUserById(ws._clayUser.id);
      if (!user || !ctx.canAccessProject(ws)) return null;
      if (ctx.osUsers && (!user.linuxUser || !ctx.getOsUserInfoForWs({ _clayUser: user }))) return null;
      return { id: user.id, linuxUser: ctx.osUsers ? user.linuxUser : null };
    }
    var current = ws._clayUser && users.findUserById(ws._clayUser.id);
    if (ctx.osUsers && (!current || !current.linuxUser || !ctx.getOsUserInfoForWs({ _clayUser: current }))) return null;
    return { id: current && current.id || null, linuxUser: ctx.osUsers && current ? current.linuxUser : null };
  }
  function resolveOrigin(ws, originId) {
    if (!layout.validOrigin(originId)) return null;
    var found = null, ambiguous = false;
    ctx.sm.sessions.forEach(function (session) {
      if (session.sessionOriginId !== originId) return;
      if (found && found !== session) { ambiguous = true; return; }
      found = session;
    });
    if (!found || ambiguous || ctx.sm.sessions.get(found.localId) !== found || sessionProvenance.isWorker(found) || !ctx.canAccessSession(ws, found)) return null;
    var linuxUser = ctx.osUsers ? ctx.getLinuxUserForSession(found) : null;
    if (ctx.osUsers && !linuxUser) return null;
    return { session: found, ref: { originId: found.sessionOriginId, ownerId: found.ownerId || null, linuxUser: linuxUser || null } };
  }
  function resolvedRefs(ws, origins) {
    if (!Array.isArray(origins)) return { error: "View session origins must be an array", code: "invalid" };
    if (origins.length > layout.MAX_SESSIONS) return { error: "A Split view can contain at most eight sessions", code: "limit" };
    if (new Set(origins).size !== origins.length || origins.some(function (origin) { return !layout.validOrigin(origin); })) return { error: "Split view session origins must be unique valid values", code: "invalid" };
    var refs = [], sessions = [];
    for (var i = 0; i < origins.length; i++) {
      var resolved = resolveOrigin(ws, origins[i]);
      if (!resolved) return { error: "One or more exact project sessions are unavailable", code: "session" };
      refs.push(resolved.ref); sessions.push(resolved.session);
    }
    return { refs: refs, sessions: sessions };
  }
  function verifyStoredView(ws, owner, id) {
    var state = store.state(owner.id, owner.linuxUser);
    if (!state.ok) return { error: state.error, code: state.code };
    var view = state.views.find(function (item) { return item.id === id; });
    if (!view) return { error: "Split view not found", code: "not_found" };
    for (var i = 0; i < view.sessionRefs.length; i++) {
      var stored = view.sessionRefs[i], current = resolveOrigin(ws, stored.originId);
      if (!current || (current.ref.ownerId || null) !== (stored.ownerId || null) ||
          (current.ref.linuxUser || null) !== (stored.linuxUser || null)) {
        return { error: "A referenced session was deleted, replaced, or is no longer accessible", code: "session" };
      }
    }
    return { ok: true };
  }
  function visibleView(ws, view) {
    var refs = [];
    for (var i = 0; i < view.sessionRefs.length; i++) {
      var stored = view.sessionRefs[i], resolved = resolveOrigin(ws, stored.originId);
      if (!resolved || (resolved.ref.ownerId || null) !== (stored.ownerId || null) ||
          (resolved.ref.linuxUser || null) !== (stored.linuxUser || null)) return null;
      refs.push({ id: resolved.session.localId, sessionOriginId: resolved.session.sessionOriginId, title: resolved.session.title || "" });
    }
    var projected = names.project(view, refs); projected.tree = clone(view.tree); projected.workspace = workspace.normalized(view).workspace; return projected;
  }
  function folderIds(ownerId) {
    var accountId = users.isMultiUser() ? ownerId : 'default';
    return typeof users.getSessionFolders === 'function' ? users.getSessionFolders(accountId, ctx.slug).folders.map(function (folder) { return folder.id; }) : [];
  }
  function destinationFolder(ownerId, view, origin) {
    var state = typeof users.getSessionFolders === 'function' ? users.getSessionFolders(users.isMultiUser() ? ownerId : 'default', ctx.slug) : null;
    if (!state) return null;
    // Singleton Views still appear as session rows and use session placement.
    var id = view && view.sessionRefs.length !== 1 ? view.folderId : (state.assignments || {})[view ? view.sessionRefs[0].originId : origin];
    return state.folders.some(function (folder) { return folder.id === id; }) ? id : null;
  }
  function stateFor(ws) {
    var current = actor(ws);
    if (!current) return null;
    var state = store.reconcileFolders(current.id, current.linuxUser, folderIds(current.id));
    if (!state.ok) return { owner: current, revision: state.revision, views: [], error: state.error };
    var views = state.views.map(function (view) { return visibleView(ws, view); }).filter(Boolean);
    return { owner: current, revision: state.revision, activeViewId: state.activeViewId || null, views: views };
  }
  function sendState(ws) {
    var state = stateFor(ws);
    if (!state) return false;
    ctx.sendTo(ws, { type: "project_split_views", projectSlug: ctx.slug, revision: state.revision, activeViewId: state.activeViewId || null, views: state.views, error: state.error || null });
    return true;
  }
  function broadcastOwner(ownerId) {
    ctx.clients.forEach(function (ws) {
      if (ws.readyState !== 1) return;
      var current = actor(ws);
      if (current && current.id === ownerId) sendState(ws);
    });
  }
  function sendOwnerError(ownerId, error) {
    ctx.clients.forEach(function (ws) {
      if (ws.readyState !== 1) return;
      var current = actor(ws);
      if (!current || current.id !== ownerId) return;
      var state = stateFor(ws);
      if (state) ctx.sendTo(ws, { type: "project_split_views", projectSlug: ctx.slug, revision: state.revision,
        views: state.views, error: error });
    });
  }
  function serviceForConnection(ws) {
    var original = actor(ws);
    if (!original) return null;
    function currentActor() {
      var latest = actor(ws);
      if (!latest || latest.id !== original.id || latest.linuxUser !== original.linuxUser) return null;
      return latest;
    }
    function state() {
      if (!currentActor()) return { ok: false, error: "Split view access is no longer permitted", code: "forbidden", views: [] };
      return stateFor(ws);
    }
    function execute(action, input) {
      var current = currentActor(), result;
      if (!current) return { ok: false, error: "Split view access is no longer permitted", code: "forbidden" };
      input = Object.assign({}, input || {});
      var identity = require("./project-view-input").check(input, ctx.slug, current.id, input.workspace !== undefined);
      if (!identity.ok) return identity;
      var currentState = store.state(current.id, current.linuxUser);
      if (!currentState.ok) return currentState;
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== currentState.revision) {
        return { ok: false, error: "Split view state changed. Reload and try again.", code: "conflict", revision: currentState.revision };
      }
      var targetId = action === "move" ? input.sourceViewId : input.id;
      var target = currentState.views.find(function (view) { return view.id === targetId; });
      if (target && input.expectedViewRevision !== undefined && target.revision !== input.expectedViewRevision) return { ok: false, code: "conflict", error: "View revision changed. Reload and try again." };
      if (action === "create" || action === "update") {
        var refs = resolvedRefs(ws, input.sessionOrigins);
        if (!refs.refs) return refs;
        if (input.workspace && !require('./project-view-pair').authorized(ctx, ws, input.workspace.linkedPair)) return { ok: false, code: 'pair', error: 'The exact linked Worker pair is unavailable.' };
        input.liveSessions = refs.sessions;
        if (action === "update") {
          var exact = verifyStoredView(ws, current, input.id);
          var inheritedFolder = target && target.sessionRefs.length === 1 && input.sessionOrigins.length > 1 ? destinationFolder(current.id, target) : undefined;
          return exact.ok ? store.update(current.id, current.linuxUser, input, refs.refs, inheritedFolder) : exact;
        }
        input.nameMode = "automatic";
        return store.create(current.id, current.linuxUser, input, refs.refs, destinationFolder(current.id, null, input.activeSessionOriginId));
      }
      if (action === "move") {
        var sourceState = store.state(current.id, current.linuxUser);
        if (!sourceState.ok) return sourceState;
        var sourceView = sourceState.views.find(function (view) { return view.id === input.sourceViewId; });
        var sourceCheck = verifyStoredView(ws, current, input.sourceViewId);
        if (!sourceCheck.ok || !sourceView) return sourceCheck.ok ? { error: "Source Split view not found", code: "not_found" } : sourceCheck;
        var sourceResolved = resolvedRefs(ws, sourceView.sessionRefs.map(function (ref) { return ref.originId; }));
        if (!sourceResolved.refs) return sourceResolved;
        input.sourceLiveSessions = sourceResolved.sessions;
        if (input.targetViewId) {
          var targetCheck = verifyStoredView(ws, current, input.targetViewId);
          if (!targetCheck.ok) return targetCheck;
        }
        var targetResolved = resolvedRefs(ws, input.targetSessionOrigins);
        if (!targetResolved.refs) return targetResolved;
        if (input.targetWorkspace && !require('./project-view-pair').authorized(ctx, ws, input.targetWorkspace.linkedPair)) return { ok: false, code: 'pair', error: 'The exact linked Worker pair is unavailable.' };
        input.liveSessions = targetResolved.sessions;
        var destination = sourceState.views.find(function (view) { return view.id === input.targetViewId; });
        return store.move(current.id, current.linuxUser, input, sourceResolved.refs, targetResolved.refs, destinationFolder(current.id, destination, input.targetSessionOriginId));
      }
      if (action === 'organize' && (input.projectSlug !== ctx.slug || input.folderId !== null && folderIds(current.id).indexOf(input.folderId) < 0)) return { ok: false, code: 'folder', error: 'That project folder is no longer available.' };
      var exactView = verifyStoredView(ws, current, input.id);
      return exactView.ok ? store[action](current.id, current.linuxUser, input) : exactView;
    }
    return { publish: function () { var current = currentActor(); if (!current) throw new Error("Split view access changed"); broadcastOwner(current.id); }, state: state, folders: function () { var current = currentActor(); if (!current) throw new Error("Split view access changed"); return users.getSessionFolders ? users.getSessionFolders(users.isMultiUser() ? current.id : "default", ctx.slug).folders : []; }, create: function (input) { return execute("create", input); },
      update: function (input) { return execute("update", input); },
      organize: function (input) { return execute('organize', input); },
      rename: function (input) { return execute("rename", input); },
      separate: function (input) { return execute("separate", input); },
      move: function (input) { return execute("move", input); } };
  }
  function onSessionDeleted(localId, session) {
    if (!session || !layout.validOrigin(session.sessionOriginId)) return;
    var result = store.removeOrigin(session.sessionOriginId);
    result.owners.forEach(broadcastOwner);
    result.failures.forEach(function (failure) {
      sendOwnerError(failure.ownerId, "A deleted session's Split view cleanup could not be persisted; affected layouts are unavailable until repaired.");
    });
  }
  function handleMessage(ws, msg) {
    var action = msg.type === "project_split_view_create" ? "create" : msg.type === "project_split_view_update" ? "update" :
      msg.type === "project_split_view_rename" ? "rename" : msg.type === "project_split_view_separate" ? "separate" :
      msg.type === "project_split_view_move" ? "move" : msg.type === "project_split_view_organize" ? "organize" : null;
    if (msg.type === "project_split_views_request") { sendState(ws); return true; }
    if (!action) return false;
    var service = serviceForConnection(ws), result = service ? service[action](msg) : { ok: false, error: "Split view access is not permitted", code: "forbidden" };
    ctx.sendTo(ws, { type: "project_split_view_result", action: action, requestId: typeof msg.requestId === "string" ? msg.requestId : null,
      ok: !!result.ok, error: result.error || null, code: result.code || null, revision: result.revision,
      view: result.ok && result.view ? visibleView(ws, result.view) : null });
    var current = actor(ws);
    if (result.ok && current) broadcastOwner(current.id);
    return true;
  }
  if (ctx.sm && typeof ctx.sm.addOnSessionDeleted === "function") ctx.sm.addOnSessionDeleted(onSessionDeleted);
  return { onFoldersChanged: function (accountId) { if (users.isMultiUser()) broadcastOwner(accountId); else ctx.clients.forEach(function (ws) { if (ws.readyState === 1) sendState(ws); }); }, handleMessage: handleMessage, sendConnectionState: sendState, forConnection: serviceForConnection, store: store };
}
module.exports = { createSplitViewsStore: createSplitViewsStore, attachProjectSplitViews: attachProjectSplitViews, validDocument: validDocument };
