var fs = require("fs");
var path = require("path");
var readyCreation = require("./mate-ready-creation");

function attachMates(ctx) {
  var users = ctx.users;
  var mates = ctx.mates;
  var projects = ctx.projects;
  var addProject = ctx.addProject;
  var removeProject = ctx.removeProject;
  var onGetProjectAccess = ctx.onGetProjectAccess;

  // --- Team section enforcement ---

  function refreshTeamSections(mateCtx) {
    try {
      var allMates = mates.getAllMates(mateCtx);
      // Collect non-mate projects accessible to this user
      var userId = mateCtx.userId || null;
      var projList = [];
      projects.forEach(function (pCtx, pSlug) {
        var st = pCtx.getStatus();
        if (st.isMate) return;
        // Filter by user access in multi-user mode
        if (users.isMultiUser() && onGetProjectAccess) {
          if (!userId) return;
          var access = onGetProjectAccess(pSlug);
          if (!access || access.error || !users.canAccessProject(userId, access)) return;
        }
        projList.push(st);
      });
      for (var ri = 0; ri < allMates.length; ri++) {
        var mDir = mates.getMateDir(mateCtx, allMates[ri].id);
        var claudePath = path.join(mDir, "CLAUDE.md");
        try {
          mates.enforceAllSections(claudePath, { ctx: mateCtx, mateId: allMates[ri].id, projects: projList });
        } catch (e) {}
      }
    } catch (e) {
      console.error("[mates] refreshTeamSections failed:", e.message);
    }
  }

  // Debounced project registry refresh for all mates
  var _registryRefreshTimer = null;
  function scheduleRegistryRefresh() {
    if (_registryRefreshTimer) clearTimeout(_registryRefreshTimer);
    _registryRefreshTimer = setTimeout(function () {
      _registryRefreshTimer = null;
      // Refresh for all known user contexts
      try {
        var allCtxs = {};
        projects.forEach(function (pCtx) {
          var st = pCtx.getStatus();
          if (st.projectOwnerId && !allCtxs[st.projectOwnerId]) {
            allCtxs[st.projectOwnerId] = mates.buildMateCtx(st.projectOwnerId);
          }
        });
        var ctxKeys = Object.keys(allCtxs);
        for (var ci = 0; ci < ctxKeys.length; ci++) {
          refreshTeamSections(allCtxs[ctxKeys[ci]]);
        }
      } catch (e) {}
    }, 2000);
  }

  function createReadyMateFromInterview(ws, userId, definition) {
    var effectiveUserId = users.isMultiUser() ? userId : "default";
    var mateCtx = mates.buildMateCtx(effectiveUserId);
    var mate = readyCreation.createReadyMate(mates, mateCtx, definition);
    var mateDir = mates.getMateDir(mateCtx, mate.id);
    var mateSlug = "mate-" + mate.id;
    var mateName = (mate.profile && mate.profile.displayName) || mate.name || "Mate";
    var registered = false;
    var favorites;
    try {
      registered = addProject(mateDir, mateSlug, mateName, null, mate.createdBy || effectiveUserId, null, { isMate: true, mateDisplayName: mateName }) !== false;
      if (!registered) throw new Error("The Mate project could not be registered.");
      favorites = users.addDmFavorite(effectiveUserId, mate.id);
    } catch (error) {
      if (registered) try { removeProject(mateSlug); } catch (removeError) {}
      try { mates.deleteMate(mateCtx, mate.id); } catch (deleteError) {}
      throw error;
    }
    var message = { type: "mate_created", mate: mate, projectSlug: mateSlug, dmFavorites: favorites, interviewComplete: true };
    if (ws && ws.readyState === 1) try { ws.send(JSON.stringify(message)); } catch (sendError) {}
    projects.forEach(function (project) {
      project.forEachClient(function (otherWs) {
        if (!otherWs || otherWs === ws || otherWs.readyState !== 1) return;
        if (users.isMultiUser() && (!otherWs._clayUser || otherWs._clayUser.id !== effectiveUserId)) return;
        try { otherWs.send(JSON.stringify(message)); } catch (sendError) {}
      });
    });
    refreshTeamSections(mateCtx);
    return mate;
  }

  // --- Mate message handlers ---

  function handleMessage(ws, msg) {
    var userId;
    if (users.isMultiUser()) {
      if (!ws._clayUser) return false;
      userId = ws._clayUser.id;
    } else {
      userId = "default";
    }

    if (msg.type === "mate_create") {
      if (!msg.seedData) return true;
      try {
        var mateCtx4 = mates.buildMateCtx(userId);
        var mate = mates.createMate(mateCtx4, msg.seedData);
        // Register mate as a project
        var mateDir = mates.getMateDir(mateCtx4, mate.id);
        var mateSlug = "mate-" + mate.id;
        var mateName = (mate.profile && mate.profile.displayName) || mate.name || "New Mate";
        addProject(mateDir, mateSlug, mateName, null, mate.createdBy, null, { isMate: true, mateDisplayName: mateName });
        // Auto-add to favorites so it shows in sidebar
        users.addDmFavorite(userId, mate.id);
        ws.send(JSON.stringify({ type: "mate_created", mate: mate, projectSlug: mateSlug }));
      } catch (e) {
        ws.send(JSON.stringify({ type: "mate_error", error: "Failed to create mate: " + e.message }));
      }
      return true;
    }

    if (msg.type === "mate_list") {
      var mateCtx5 = mates.buildMateCtx(userId);
      // Backfill built-in mates for existing users
      try {
        var deletedKeys = users.getDeletedBuiltinKeys(userId);
        var newBuiltins = mates.ensureBuiltinMates(mateCtx5, deletedKeys);
        for (var bi = 0; bi < newBuiltins.length; bi++) {
          var nb = newBuiltins[bi];
          var nbSlug = "mate-" + nb.id;
          var nbDir = mates.getMateDir(mateCtx5, nb.id);
          var nbName = (nb.profile && nb.profile.displayName) || nb.name || "New Mate";
          var nbDef = nb.builtinKey ? require("./builtin-mates").getBuiltinByKey(nb.builtinKey) : null;
          var nbIsHost = !!(nbDef && nbDef.hostAgent);
          addProject(nbDir, nbSlug, nbName, null, nb.createdBy || userId, null, { isMate: true, mateDisplayName: nbName, isHostAgent: nbIsHost });
          users.addDmFavorite(userId, nb.id);
        }
      } catch (e) {
        console.error("[server] Failed to ensure built-in mates:", e.message);
      }
      // Auto-sync primary mates (Ally) with latest definition
      try { mates.syncPrimaryMates(mateCtx5); } catch (e) {}
      // Auto-archive Ally and any other archived built-ins for existing users
      try { mates.syncArchivedBuiltinMates(mateCtx5); } catch (e) {}
      // Ensure core built-in mates are in favorites (unless user explicitly removed them)
      // Clay is reachable via Home, not via the mate sidebar, so it is
      // intentionally NOT in this list.
      var coreMateKeys = ["arch", "buzz"];
      var mateList = mates.getAllMates(mateCtx5);
      var currentFavs = users.getDmFavorites(userId);
      var hiddenIds = users.getDmHidden(userId);
      for (var bfi = 0; bfi < mateList.length; bfi++) {
        if (mateList[bfi].builtinKey && coreMateKeys.indexOf(mateList[bfi].builtinKey) !== -1 && currentFavs.indexOf(mateList[bfi].id) === -1 && hiddenIds.indexOf(mateList[bfi].id) === -1) {
          users.addDmFavorite(userId, mateList[bfi].id);
        }
      }
      // Ensure all mate projects are registered (survives server restarts)
      for (var mi = 0; mi < mateList.length; mi++) {
        var m = mateList[mi];
        var mSlug = "mate-" + m.id;
        if (!projects.has(mSlug)) {
          var mDir = mates.getMateDir(mateCtx5, m.id);
          fs.mkdirSync(mDir, { recursive: true });
          var mName = (m.profile && m.profile.displayName) || m.name || "New Mate";
          var mDef = m.builtinKey ? require("./builtin-mates").getBuiltinByKey(m.builtinKey) : null;
          var mIsHost = !!(mDef && mDef.hostAgent);
          addProject(mDir, mSlug, mName, null, m.createdBy || userId, null, { isMate: true, mateDisplayName: mName, isHostAgent: mIsHost });
        }
      }
      // Include deleted built-in mates for re-add UI
      var builtinDefs2 = require("./builtin-mates");
      var missingKeys2 = mates.getMissingBuiltinKeys(mateCtx5);
      var availableBuiltins2 = [];
      for (var abk2 = 0; abk2 < missingKeys2.length; abk2++) {
        var bDef2 = builtinDefs2.getBuiltinByKey(missingKeys2[abk2]);
        if (bDef2) {
          availableBuiltins2.push({
            key: bDef2.key,
            displayName: bDef2.displayName,
            bio: bDef2.bio,
            avatarCustom: bDef2.avatarCustom || "",
            avatarStyle: bDef2.avatarStyle || "imprint",
            avatarColor: bDef2.avatarColor || "",
          });
        }
      }
      ws.send(JSON.stringify({ type: "mate_list", mates: mateList, availableBuiltins: availableBuiltins2 }));
      return true;
    }

    if (msg.type === "mate_delete") {
      if (!msg.mateId) return true;
      var mateCtx6 = mates.buildMateCtx(userId);
      // Track deleted built-in mate key so it doesn't auto-recreate
      var mateToDelete = mates.getMate(mateCtx6, msg.mateId);
      if (mateToDelete && mateToDelete.builtinKey) {
        users.addDeletedBuiltinKey(userId, mateToDelete.builtinKey);
      }
      var result = mates.deleteMate(mateCtx6, msg.mateId);
      if (result.error) {
        ws.send(JSON.stringify({ type: "mate_error", error: result.error }));
      } else {
        removeProject("mate-" + msg.mateId);
        // Build updated available builtins list
        var builtinDefs3 = require("./builtin-mates");
        var missingKeys3 = mates.getMissingBuiltinKeys(mateCtx6);
        var availableBuiltins3 = [];
        for (var abk3 = 0; abk3 < missingKeys3.length; abk3++) {
          var bDef3 = builtinDefs3.getBuiltinByKey(missingKeys3[abk3]);
          if (bDef3) {
            availableBuiltins3.push({
              key: bDef3.key,
              displayName: bDef3.displayName,
              bio: bDef3.bio,
              avatarCustom: bDef3.avatarCustom || "",
              avatarStyle: bDef3.avatarStyle || "imprint",
              avatarColor: bDef3.avatarColor || "",
            });
          }
        }
        ws.send(JSON.stringify({ type: "mate_deleted", mateId: msg.mateId, availableBuiltins: availableBuiltins3 }));
        // Broadcast to all clients so strips update
        projects.forEach(function (pCtx) {
          pCtx.forEachClient(function (otherWs) {
            if (otherWs === ws) return;
            if (otherWs.readyState !== 1) return;
            otherWs.send(JSON.stringify({ type: "mate_deleted", mateId: msg.mateId, availableBuiltins: availableBuiltins3 }));
          });
        });
      }
      return true;
    }

    if (msg.type === "mate_readd_builtin") {
      if (!msg.builtinKey) return true;
      try {
        var mateCtxR = mates.buildMateCtx(userId);
        var missingKeys = mates.getMissingBuiltinKeys(mateCtxR);
        if (missingKeys.indexOf(msg.builtinKey) === -1) {
          ws.send(JSON.stringify({ type: "mate_error", error: "This built-in mate already exists" }));
          return true;
        }
        var newMate = mates.createBuiltinMate(mateCtxR, msg.builtinKey);
        users.removeDeletedBuiltinKey(userId, msg.builtinKey);
        var updatedFavsR = users.addDmFavorite(userId, newMate.id);
        var readdSlug = "mate-" + newMate.id;
        var readdDir = mates.getMateDir(mateCtxR, newMate.id);
        var readdName = (newMate.profile && newMate.profile.displayName) || newMate.name || "New Mate";
        addProject(readdDir, readdSlug, readdName, null, newMate.createdBy || userId, null, { isMate: true, mateDisplayName: readdName });
        // Build updated available builtins
        var builtinDefsR = require("./builtin-mates");
        var missingKeysR = mates.getMissingBuiltinKeys(mateCtxR);
        var availableBuiltinsR = [];
        for (var abkR = 0; abkR < missingKeysR.length; abkR++) {
          var bDefR = builtinDefsR.getBuiltinByKey(missingKeysR[abkR]);
          if (bDefR) {
            availableBuiltinsR.push({ key: bDefR.key, displayName: bDefR.displayName, bio: bDefR.bio, avatarCustom: bDefR.avatarCustom || "", avatarStyle: bDefR.avatarStyle || "imprint", avatarColor: bDefR.avatarColor || "" });
          }
        }
        ws.send(JSON.stringify({ type: "mate_created", mate: newMate, projectSlug: readdSlug, availableBuiltins: availableBuiltinsR, dmFavorites: updatedFavsR }));
      } catch (e) {
        ws.send(JSON.stringify({ type: "mate_error", error: "Failed to re-add built-in mate: " + e.message }));
      }
      return true;
    }

    if (msg.type === "mate_list_available_builtins") {
      var mateCtxAB = mates.buildMateCtx(userId);
      var missingBuiltinKeys = mates.getMissingBuiltinKeys(mateCtxAB);
      var builtinDefs = require("./builtin-mates");
      var availableBuiltins = [];
      for (var abk = 0; abk < missingBuiltinKeys.length; abk++) {
        var bDef = builtinDefs.getBuiltinByKey(missingBuiltinKeys[abk]);
        if (bDef) {
          availableBuiltins.push({
            key: bDef.key,
            displayName: bDef.displayName,
            bio: bDef.bio,
            avatarColor: bDef.avatarColor,
            avatarStyle: bDef.avatarStyle,
            avatarCustom: bDef.avatarCustom || "",
          });
        }
      }
      ws.send(JSON.stringify({ type: "mate_available_builtins", builtins: availableBuiltins }));
      return true;
    }

    if (msg.type === "mate_update") {
      if (!msg.mateId || !msg.updates) return true;
      if (Object.prototype.hasOwnProperty.call(msg.updates, "model")) {
        ws.send(JSON.stringify({ type: "mate_error", error: "Use the Mate model selector to change this setting." }));
        return true;
      }
      var mateCtx7 = mates.buildMateCtx(userId);
      var updated = mates.updateMate(mateCtx7, msg.mateId, msg.updates);
      if (updated) {
        ws.send(JSON.stringify({ type: "mate_updated", mate: updated }));
        // Broadcast update
        projects.forEach(function (pCtx) {
          pCtx.forEachClient(function (otherWs) {
            if (otherWs === ws) return;
            if (otherWs.readyState !== 1) return;
            otherWs.send(JSON.stringify({ type: "mate_updated", mate: updated }));
          });
        });
        // Re-enforce team sections across all mate projects so roster stays current
        refreshTeamSections(mateCtx7);
      } else {
        ws.send(JSON.stringify({ type: "mate_error", error: "Mate not found" }));
      }
      return true;
    }

    return false;
  }

  return {
    handleMessage: handleMessage,
    scheduleRegistryRefresh: scheduleRegistryRefresh,
    createReadyMateFromInterview: createReadyMateFromInterview,
  };
}

module.exports = { attachMates: attachMates };
