// Folder deletion with a choice for the folder's sessions: move them to
// Unfiled, move them to another folder, or delete them with the folder.
//
// The flow is two requests so a confirmation always describes what will happen:
//   session_folders_delete_preview  -> the server's authoritative membership
//                                      count and an opaque snapshot token
//   session_folders_delete          -> the chosen mode plus that token
// The token is a keyed digest of the folder, its current members and the full
// deletion scope. If the contents changed in between (a session was filed into
// the folder, moved out, or gained a Worker) the request is refused untouched
// and a fresh preview is sent. Membership always comes from the caller's stored
// state, never from what a filtered sidebar happens to render, and no origin
// key ever leaves the server.

var crypto = require("crypto");
var folders = require("./session-folders");

var SECRET = crypto.randomBytes(32);
var MODES = ["unfiled", "move", "delete"];

function attachFolderDelete(ctx) {
  var slug = ctx.slug;
  var sendTo = ctx.sendTo;

  // The live members of a folder: every existing session the caller filed
  // there, whatever the sidebar search currently shows. Keys whose session is
  // gone are skipped (they are pruned when the folder state is saved).
  function snapshot(userId, env, state, folderId, ws) {
    var members = [];
    Object.keys(state.assignments).forEach(function (key) {
      if (state.assignments[key] === folderId && env.exists(key)) members.push(env.byKey[key]);
    });
    members.sort(function (a, b) { return a.localId - b.localId; });
    var plan = ctx.sessionDelete.planDeletion(ws, members, ctx.getProjectAccess());
    var scopeIds = plan.ok ? plan.ids.slice().sort(function (a, b) { return a - b; }) : [];
    var workerIds = plan.ok ? plan.cascadedIds.slice().sort(function (a, b) { return a - b; }) : [];
    var memberIds = members.map(function (s) { return s.localId; });
    var digest = crypto.createHmac("sha256", SECRET)
      .update(JSON.stringify([userId, slug, folderId, memberIds, scopeIds, plan.ok]))
      .digest("hex").slice(0, 32);
    return {
      members: members, plan: plan, memberCount: memberIds.length,
      workerCount: workerIds.length, totalCount: plan.ok ? scopeIds.length : memberIds.length,
      token: digest,
    };
  }

  function previewMessage(folderId, requestId, snap, hasPermission) {
    return {
      type: "session_folders_delete_preview_result", slug: slug, requestId: requestId || null, folderId: folderId,
      sessionCount: snap.memberCount, workerCount: snap.workerCount, totalCount: snap.totalCount, token: snap.token,
      canDeleteSessions: hasPermission && snap.plan.ok,
      deleteBlockedReason: !hasPermission ? "You do not have permission to delete sessions" : (snap.plan.ok ? null : snap.plan.error),
    };
  }

  // Persisting can throw (the multi-user store writes a file); that must come
  // back as a correlated refusal, never as an acknowledgement or an exception.
  function saveState(userId, nextState) {
    try {
      var saved = ctx.usersModule.setSessionFolders(userId, slug, nextState);
      return saved && saved.error ? { error: saved.error } : { state: saved && saved.state ? saved.state : nextState };
    } catch (e) {
      console.error("[folders] saving folder state failed:", e && e.message);
      return { error: "Could not save the folders" };
    }
  }

  function reload(userId, env, fallback) {
    try { return ctx.loadState(userId, env); } catch (e) { return fallback; }
  }

  function knownFolder(state, folderId) {
    if (typeof folderId !== "string" || folderId === folders.FAVORITES_ID || folderId === folders.UNFILED_ID) return false;
    return state.folders.some(function (f) { return f.id === folderId; });
  }

  function preview(ws, msg) {
    var userId = ctx.userIdFor(ws);
    if (!userId) return;
    var rid = ctx.cleanRequestId(msg.requestId);
    if (ctx.wrongProject(ws, msg.slug, rid)) return;
    var env = ctx.buildEnv(userId);
    var state = ctx.loadState(userId, env);
    if (!knownFolder(state, msg.folderId)) {
      sendTo(ws, ctx.stateMessage(state, env, { error: "Folder not found", requestId: rid }));
      return;
    }
    var snap = snapshot(userId, env, state, msg.folderId, ws);
    sendTo(ws, previewMessage(msg.folderId, rid, snap, ctx.sessionDelete.hasDeletePermission(ws)));
  }

  function refuse(ws, userId, env, state, rid, text, snapForRefresh, folderId) {
    sendTo(ws, ctx.stateMessage(state, env, { error: text, requestId: rid, stale: !!snapForRefresh }));
    if (snapForRefresh) sendTo(ws, previewMessage(folderId, rid, snapForRefresh, ctx.sessionDelete.hasDeletePermission(ws)));
  }

  function run(ws, msg) {
    var userId = ctx.userIdFor(ws);
    if (!userId) return;
    var rid = ctx.cleanRequestId(msg.requestId);
    if (ctx.wrongProject(ws, msg.slug, rid)) return;
    var env = ctx.buildEnv(userId);
    var state = ctx.loadState(userId, env);
    var folderId = msg.folderId;
    var mode = msg.mode;

    // Everything below is validated before the first mutation.
    if (!knownFolder(state, folderId)) return refuse(ws, userId, env, state, rid, "Folder not found");
    if (MODES.indexOf(mode) === -1) return refuse(ws, userId, env, state, rid, "Choose what happens to the sessions");
    if (mode === "move") {
      var dest = msg.destinationId;
      if (typeof dest !== "string" || dest === folderId || dest === folders.UNFILED_ID ||
          (dest !== folders.FAVORITES_ID && !knownFolder(state, dest))) {
        return refuse(ws, userId, env, state, rid, "Choose another folder for these sessions");
      }
    }
    var snap = snapshot(userId, env, state, folderId, ws);
    if (typeof msg.token !== "string" || msg.token !== snap.token) {
      return refuse(ws, userId, env, state, rid, "This folder changed while you were deciding. Review it and try again.", snap, folderId);
    }
    if (mode === "delete" && msg.confirmDelete !== true) {
      return refuse(ws, userId, env, state, rid, "Confirm that you want to delete these sessions");
    }
    if (mode === "delete" && !snap.plan.ok) {
      return refuse(ws, userId, env, state, rid, snap.plan.error);
    }

    if (mode === "delete" && snap.members.length) {
      try {
        ctx.sessionDelete.executeDeletion(ws, snap.plan);
      } catch (e) {
        // The folder is left in place; whatever was already removed is pruned
        // from it on the next state load.
        console.error("[folders] session deletion failed:", e && e.message);
        // Removal is not transactional: some sessions may already be gone.
        var after = ctx.buildEnv(userId);
        return refuse(ws, userId, after, reload(userId, after, state), rid,
          "Deleting stopped part way. Some of these sessions may already have been deleted, and the folder was kept. Review the folder and try again.");
      }
      env = ctx.buildEnv(userId);
    }

    var op = mode === "move"
      ? { op: "delete_folder", folderId: folderId, mode: "move", destinationId: msg.destinationId }
      : { op: "delete_folder", folderId: folderId, mode: "unfiled" };
    var result = folders.applyOperation(state, op, env);
    if (result.error) return refuse(ws, userId, env, state, rid, result.error);
    var saved = saveState(userId, result.state);
    if (saved.error) {
      var current = mode === "delete" ? reload(userId, env, state) : state;
      return refuse(ws, userId, env, current, rid, mode === "delete"
        ? "The sessions were deleted but the folder could not be removed. Try deleting it again."
        : "The folder could not be updated, so nothing was changed. " + saved.error + ".");
    }
    ctx.pushToUser(userId, saved.state, env);
    sendTo(ws, ctx.stateMessage(saved.state, env, { requestId: rid, folderDeleted: folderId }));
  }

  function handleMessage(ws, msg) {
    if (msg.type === "session_folders_delete_preview") { preview(ws, msg); return true; }
    if (msg.type === "session_folders_delete") { run(ws, msg); return true; }
    return false;
  }

  return { handleMessage: handleMessage };
}

module.exports = { attachFolderDelete: attachFolderDelete };
