// WebSocket surface for sidebar session folders. Everything is scoped to the
// authenticated user and this project: the caller's identity comes from the
// socket, never from the message, and a session key is only accepted when it
// names a session that user can see and may organize.

var folders = require("./session-folders");
var sessionProvenance = require("./session-provenance");
var folderDeleteModule = require("./project-session-folder-delete");

function attachSessionFolders(ctx) {
  var sm = ctx.sm;
  var usersModule = ctx.usersModule;
  var slug = ctx.slug;
  var clients = ctx.clients;
  var sendTo = ctx.sendTo;
  var getProjectAccess = ctx.getProjectAccess || function () { return { visibility: "public" }; };

  function userIdFor(ws) {
    if (!usersModule.isMultiUser()) return "default";
    return ws && ws._clayUser ? ws._clayUser.id : null;
  }

  function sessionsByKey() {
    var map = Object.create(null);
    sm.sessions.forEach(function (session) {
      var key = sessionProvenance.ensureOrigin(session);
      if (key) map[key] = session;
    });
    return map;
  }

  function visibleTo(userId, session) {
    if (session.hidden) return false;
    if (!usersModule.isMultiUser()) return !session.ownerId;
    return !!usersModule.canAccessSession(userId, session, getProjectAccess());
  }

  // A movable unit is a standalone session or a Driver root. Workers travel
  // with their Driver and loop runs stay grouped, so neither is accepted.
  function organizable(userId, session) {
    if (!session || !visibleTo(userId, session)) return false;
    if (sessionProvenance.isWorker(session)) return false;
    if (session.loop && session.loop.loopId) return false;
    return true;
  }

  function buildEnv(userId) {
    var byKey = sessionsByKey();
    return {
      canOrganize: function (key) { return organizable(userId, byKey[key]); },
      exists: function (key) { return !!byKey[key]; },
      byKey: byKey,
    };
  }

  // Clients address sessions by their local id; durable origin keys never
  // leave the server. Anything that does not resolve to a session this user
  // may organize is dropped from outgoing state and rejected on the way in.
  function toClientState(state, env) {
    var out = { folders: state.folders, collapsed: state.collapsed, view: state.view, assignments: {}, favorites: [], orders: {} };
    function idOf(key) { return env.canOrganize(key) ? env.byKey[key].localId : null; }
    // Favorites are tags: ids in curated order. A favorite also keeps its
    // assignment below, so it appears in both places.
    out.favorites = state.favorites.map(idOf).filter(function (id) { return id !== null; });
    Object.keys(state.assignments).forEach(function (key) {
      var id = idOf(key);
      if (id !== null) out.assignments[id] = state.assignments[key];
    });
    Object.keys(state.orders).forEach(function (container) {
      out.orders[container] = state.orders[container].map(idOf).filter(function (id) { return id !== null; });
    });
    return out;
  }

  function keyOfId(env, id) {
    if (typeof id !== "number") return null;
    var session = sm.sessions.get(id);
    return session && env.canOrganize(sessionProvenance.ensureOrigin(session)) ? sessionProvenance.ensureOrigin(session) : null;
  }

  function idsOf(env, keys) {
    return keys.filter(function (k) { return env.canOrganize(k); }).map(function (k) { return env.byKey[k].localId; });
  }

  // Rewrites a client operation from local ids to origin keys.
  function translateOp(op, env) {
    if (!op || typeof op !== "object") return { error: "Invalid folder request" };
    var out = Object.assign({}, op);
    if (op.sessionId !== undefined) {
      out.sessionKey = keyOfId(env, op.sessionId);
      delete out.sessionId;
      if (!out.sessionKey) return { error: "Session not found" };
    } else {
      delete out.sessionKey;
    }
    if (op.order !== undefined) {
      if (!Array.isArray(op.order)) return { error: "Invalid order" };
      var keys = [];
      for (var i = 0; i < op.order.length; i++) {
        var key = keyOfId(env, op.order[i]);
        if (!key) return { error: "Session not found" };
        keys.push(key);
      }
      out.order = keys;
    }
    return { op: out };
  }

  function legacyFavoriteKeys(userId, env) {
    var list = [];
    sm.sessions.forEach(function (session) {
      if (!session.bookmarked) return;
      var key = sessionProvenance.ensureOrigin(session);
      if (!key || !env.canOrganize(key)) return;
      if (session.ownerId && session.ownerId !== userId) return;
      list.push({ key: key, order: typeof session.favoriteOrder === "number" ? session.favoriteOrder : Number.MAX_SAFE_INTEGER, activity: session.lastActivity || 0 });
    });
    list.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return b.activity - a.activity;
    });
    return list.map(function (entry) { return entry.key; });
  }

  // Loads the caller's state, applying the one-time legacy favorites seed.
  function loadState(userId, env) {
    var state = usersModule.getSessionFolders(userId, slug);
    if (!state.legacyFavoritesMigrated) {
      state = folders.seedLegacyFavorites(state, legacyFavoriteKeys(userId, env));
      var saved = usersModule.setSessionFolders(userId, slug, state);
      if (saved.state) state = saved.state;
    }
    return state;
  }

  function stateMessage(state, env, extra) {
    return Object.assign({ type: "session_folders_state", slug: slug, state: toClientState(state, env) }, extra || {});
  }

  function pushToUser(userId, state, env) {
    clients.forEach(function (other) {
      if (userIdFor(other) !== userId) return;
      sendTo(other, stateMessage(state, env));
    });
  }

  function sendStateTo(ws) {
    var userId = userIdFor(ws);
    if (!userId) return;
    var env = buildEnv(userId);
    sendTo(ws, stateMessage(loadState(userId, env), env));
  }

  // True only when the operation was accepted and saved.
  function apply(ws, rawOp, requestId) {
    var userId = userIdFor(ws);
    if (!userId) return false;
    var env = buildEnv(userId);
    var current = loadState(userId, env);
    var rid = requestId || null;
    var translated = translateOp(rawOp, env);
    if (translated.error) {
      sendTo(ws, stateMessage(current, env, { error: translated.error, requestId: rid }));
      return false;
    }
    var result = folders.applyOperation(current, translated.op, env);
    if (result.error) {
      sendTo(ws, stateMessage(current, env, { error: result.error, requestId: rid }));
      return false;
    }
    var saved = usersModule.setSessionFolders(userId, slug, result.state);
    if (saved.error) {
      sendTo(ws, stateMessage(current, env, { error: saved.error, requestId: rid }));
      return false;
    }
    pushToUser(userId, saved.state, env);
    if (rid) sendTo(ws, stateMessage(saved.state, env, { requestId: rid, folderId: result.folderId || null }));
    return true;
  }

  // Older clients still send the original favorite messages; they now edit the
  // same personal state instead of the shared session flag.
  function legacyBookmark(ws, msg) {
    var userId = userIdFor(ws);
    if (!userId || typeof msg.sessionId !== "number") return;
    var env = buildEnv(userId);
    var key = keyOfId(env, msg.sessionId);
    if (!key) { apply(ws, { op: "set_favorite", sessionId: msg.sessionId, favorite: false }); return; }
    // The bookmark is the Favorites tag; the session's folder is not touched.
    apply(ws, { op: "set_favorite", sessionId: msg.sessionId, favorite: msg.bookmarked === true });
  }

  function legacyReorder(ws, msg) {
    var userId = userIdFor(ws);
    if (!userId) return;
    var env = buildEnv(userId);
    var sourceKey = keyOfId(env, msg.sourceId);
    var targetKey = keyOfId(env, msg.targetId);
    if (!sourceKey || !targetKey) return;
    var current = loadState(userId, env);
    var order = current.favorites.filter(function (k) { return k !== sourceKey; });
    var at = order.indexOf(targetKey);
    if (at === -1 || current.favorites.indexOf(sourceKey) === -1) return;
    order.splice(msg.insertBefore === false ? at + 1 : at, 0, sourceKey);
    apply(ws, { op: "set_order", containerKey: folders.FAVORITES_ID, order: idsOf(env, order) });
  }

  // A request carries the project it was built for; a stale dialog or a
  // reconnect to another project must never mutate this project's folders.
  function wrongProject(ws, claimedSlug, requestId) {
    if (claimedSlug === slug) return false;
    var userId = userIdFor(ws);
    if (userId) {
      var env = buildEnv(userId);
      sendTo(ws, stateMessage(loadState(userId, env), env, { error: "These folders belong to a different project", requestId: requestId || null }));
    }
    return true;
  }

  // Files a session that was just created from a folder menu. The session
  // exists either way; a refused placement only reports the error.
  function placeNewSession(ws, session, folderId, claimedSlug) {
    if (wrongProject(ws, claimedSlug, null)) return false;
    return apply(ws, { op: "place_session", sessionId: session.localId, folderId: folderId });
  }

  // Checked before a session is created for a folder, so a folder that was
  // deleted (or never existed for this user) refuses the request instead of
  // silently filing the session somewhere else. Unfiled needs no folder.
  function checkNewSessionFolder(ws, folderId, claimedSlug) {
    if (folderId === undefined) return { ok: true };
    if (claimedSlug !== slug) return { ok: false, error: "These folders belong to a different project" };
    var userId = userIdFor(ws);
    if (!userId) return { ok: false, error: "Your account is no longer available." };
    if (folderId === folders.FAVORITES_ID) return { ok: false, error: "Favorites is a tag. Create the session in a folder or Unfiled." };
    if (folderId === null || folderId === folders.UNFILED_ID) return { ok: true };
    var state = loadState(userId, buildEnv(userId));
    for (var i = 0; i < state.folders.length; i++) if (state.folders[i].id === folderId) return { ok: true };
    return { ok: false, error: "That folder no longer exists. Pick another folder and try again." };
  }

  function cleanRequestId(value) {
    return typeof value === "string" && value.length <= 64 ? value : null;
  }

  // Choosing what happens to a folder's sessions lives in its own module; it
  // reuses this module's authenticated state helpers and the shared session
  // deletion service.
  var folderDelete = folderDeleteModule.attachFolderDelete({
    sm: sm, slug: slug, sendTo: sendTo, usersModule: usersModule, sessionDelete: ctx.sessionDelete,
    getProjectAccess: getProjectAccess, userIdFor: userIdFor, buildEnv: buildEnv, loadState: loadState,
    stateMessage: stateMessage, pushToUser: pushToUser, wrongProject: wrongProject, cleanRequestId: cleanRequestId,
  });

  function handleMessage(ws, msg) {
    if (folderDelete.handleMessage(ws, msg)) return true;
    if (msg.type === "session_folders_get") { sendStateTo(ws); return true; }
    if (msg.type === "session_folders_op") {
      var rid = typeof msg.requestId === "string" && msg.requestId.length <= 64 ? msg.requestId : null;
      if (wrongProject(ws, msg.slug, rid)) return true;
      apply(ws, msg.op, typeof msg.requestId === "string" && msg.requestId.length <= 64 ? msg.requestId : null);
      return true;
    }
    if (msg.type === "set_session_bookmark") { legacyBookmark(ws, msg); return true; }
    if (msg.type === "reorder_session_bookmarks") { legacyReorder(ws, msg); return true; }
    return false;
  }

  return { handleMessage: handleMessage, sendStateTo: sendStateTo, placeNewSession: placeNewSession, checkNewSessionFolder: checkNewSessionFolder };
}

module.exports = { attachSessionFolders: attachSessionFolders };
