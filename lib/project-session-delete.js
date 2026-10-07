var sessionProvenance = require("./session-provenance");

// Explicit human deletion of a Driver also removes every Split Worker
// generation it durably owns. Ownership comes only from the provenance
// hierarchy: a unique parent origin, the same owner, and a parent that is not
// itself a Worker. Ambiguous or cross-owner links are never expanded. Close,
// dissolve, and replacement do not come through here and keep history, and
// deleting a Worker never removes its Driver or siblings.

function resolveDeletionScope(sessions, requested, canDelete) {
  var workersByDriver = sessionProvenance.ownedWorkersByDriver(Array.from(sessions.values()));
  var ids = [];
  var cascadedIds = [];
  var seen = {};
  function add(session, cascaded) {
    if (seen[session.localId]) return;
    seen[session.localId] = true;
    ids.push(session.localId);
    if (cascaded) cascadedIds.push(session.localId);
  }
  for (var j = 0; j < requested.length; j++) {
    var target = requested[j];
    add(target, false);
    if (sessionProvenance.isWorker(target)) continue;
    var owned = workersByDriver[target.localId] || [];
    for (var k = 0; k < owned.length; k++) {
      // The whole scope is authorized before anything is removed.
      if (!canDelete(owned[k])) {
        return { ok: false, error: "You cannot delete this Driver because one of its Split Worker sessions is not accessible to you" };
      }
      add(owned[k], true);
    }
  }
  return { ok: true, ids: ids, cascadedIds: cascadedIds };
}

function attachSessionDelete(ctx) {
  var sm = ctx.sm;
  var usersModule = ctx.usersModule;
  var getProjectAccess = ctx.getProjectAccess || function () { return { visibility: "public" }; };

  function hasDeletePermission(ws) {
    if (!ws._clayUser) return true;
    return !!usersModule.getEffectivePermissions(ws._clayUser, ctx.osUsers).sessionDelete;
  }
  function accessCheck(ws, access) {
    return function (session) {
      if (!usersModule.isMultiUser()) return true;
      return !!(ws._clayUser && usersModule.canAccessSession(ws._clayUser.id, session, access));
    };
  }
  function releaseRuntime(ids) {
    for (var i = 0; i < ids.length; i++) {
      var session = sm.sessions.get(ids[i]);
      if (!session) continue;
      // TUI sessions: reap the PTY and stop title watchers before the
      // records are wiped so no `claude` process is left orphaned.
      if (ctx.tm && session.mode === "tui" && typeof session.terminalId === "number") {
        try { ctx.tm.close(session.terminalId); } catch (e) {}
      }
      ctx.stopTitleWatcher(session);
    }
  }
  function refuse(ws, text) {
    ctx.sendTo(ws, { type: "error", text: text });
  }

  function deleteSession(ws, msg) {
    if (!hasDeletePermission(ws)) return refuse(ws, "You do not have permission to delete sessions");
    if (!msg.id || !sm.sessions.has(msg.id)) return;
    var target = sm.sessions.get(msg.id);
    var canDelete = accessCheck(ws, getProjectAccess());
    if (!canDelete(target)) return;
    var scope = resolveDeletionScope(sm.sessions, [target], canDelete);
    if (!scope.ok) return refuse(ws, scope.error);
    releaseRuntime(scope.ids);
    if (scope.ids.length === 1) sm.deleteSession(target.localId, ws);
    else sm.deleteSessionsBulk(scope.ids, ws);
  }

  // Authorizes a whole deletion before anything is removed: permission, access
  // to every requested session, and access to every Split Worker a Driver owns
  // (hidden sessions and previous generations included).
  function planDeletion(ws, targets, access) {
    if (!hasDeletePermission(ws)) return { ok: false, error: "You do not have permission to delete sessions" };
    var canDelete = accessCheck(ws, access);
    for (var i = 0; i < targets.length; i++) {
      if (!canDelete(targets[i])) return { ok: false, error: "You cannot delete one of these sessions" };
    }
    return resolveDeletionScope(sm.sessions, targets, canDelete);
  }

  // Removes an authorized plan: runtimes are released first, then the records.
  function executeDeletion(ws, plan) {
    if (!plan || !plan.ok || plan.ids.length === 0) return;
    releaseRuntime(plan.ids);
    sm.deleteSessionsBulk(plan.ids, ws);
  }

  function bulkDeleteSessions(ws, msg) {
    if (!Array.isArray(msg.sessionIds) || msg.sessionIds.length === 0) return;
    if (!hasDeletePermission(ws)) return refuse(ws, "You do not have permission to delete sessions");
    var canDelete = accessCheck(ws, { visibility: "public" });
    var requested = [];
    for (var i = 0; i < msg.sessionIds.length; i++) {
      var id = msg.sessionIds[i];
      var target = typeof id === "number" ? sm.sessions.get(id) : null;
      if (target && canDelete(target)) requested.push(target);
    }
    if (requested.length === 0) return;
    var scope = resolveDeletionScope(sm.sessions, requested, canDelete);
    if (!scope.ok) return refuse(ws, scope.error);
    executeDeletion(ws, scope);
  }

  return { deleteSession: deleteSession, bulkDeleteSessions: bulkDeleteSessions, planDeletion: planDeletion, executeDeletion: executeDeletion, hasDeletePermission: hasDeletePermission };
}

module.exports = { attachSessionDelete: attachSessionDelete, resolveDeletionScope: resolveDeletionScope };
