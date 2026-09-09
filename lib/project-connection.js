var fs = require("fs");
var path = require("path");
var usersModule = require("./users");
var userPresence = require("./user-presence");
var emailAccounts = require("./email-accounts");
var { getCodexConfig } = require("./codex-defaults");
var yoke = require("./yoke");

function dispatchMessageSafely(handleMessage, sendTo, slug, ws, msg) {
  try {
    handleMessage(ws, msg);
    return true;
  } catch (err) {
    var detail = err && err.stack ? err.stack : (err && err.message ? err.message : String(err));
    console.error("[project-connection] Message handler failed for " + slug + "/" + (msg.type || "unknown") + ":", detail);
    try {
      sendTo(ws, { type: "error", text: "The request could not be completed. Check the server logs for details." });
    } catch (sendErr) {
      console.error("[project-connection] Failed to send message error for " + slug + ":", sendErr && sendErr.message ? sendErr.message : sendErr);
    }
    return false;
  }
}

function buildInitialModelInfo(sm, initialVendor, initialModel, initialModels, sessionId) {
  var model = initialModel || "";
  var models = initialModels || [];
  if (model && models.length > 0) {
    var found = false;
    for (var i = 0; i < models.length; i++) {
      var entry = models[i];
      if (typeof entry === "string" ? entry === model : (entry.value === model || entry.id === model || entry.resolvedModel === model)) found = true;
    }
    if (!found) model = typeof models[0] === "string" ? models[0] : (models[0].value || models[0].id || "");
  }
  return {
    type: "model_info",
    model: model,
    models: models,
    vendor: initialVendor,
    sessionId: sessionId || null,
    availableVendors: sm.availableVendors || [],
    installedVendors: sm.installedVendors || [],
  };
}

/**
 * Attach connection/disconnection handlers to a project context.
 *
 * ctx fields:
 *   cwd, slug, isMate, osUsers, debug, dangerouslySkipPermissions,
 *   currentVersion, lanHost, sm, tm, nm, clients, send, sendTo,
 *   opts, loopState, loopRegistry, _loop, pushModule,
 *   hydrateImageRefs, broadcastClientCount, broadcastPresence,
 *   getProjectList, getHubSchedules, loadContextSources,
 *   restoreDebateState, handleMessage, handleDisconnection,
 *   stopFileWatch, stopAllDirWatches,
 *   getProjectOwnerId, setProjectOwnerId, getLatestVersion,
 *   getTitle, getProject
 */
function attachConnection(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var isMate = ctx.isMate;
  var osUsers = ctx.osUsers;
  var debug = ctx.debug;
  var dangerouslySkipPermissions = ctx.dangerouslySkipPermissions;
  var currentVersion = ctx.currentVersion;
  var lanHost = ctx.lanHost;
  var sm = ctx.sm;
  var tm = ctx.tm;
  var nm = ctx.nm;
  var clients = ctx.clients;
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var opts = ctx.opts;
  var _loop = ctx._loop;
  var _mcp = ctx._mcp;
  var _notifications = ctx._notifications;
  var _splitGroups = ctx._splitGroups;
  var _vendorLogin = ctx._vendorLogin;
  var hydrateImageRefs = ctx.hydrateImageRefs;
  var resolveSessionForView = ctx.resolveSessionForView;
  var broadcastClientCount = ctx.broadcastClientCount;
  var broadcastPresence = ctx.broadcastPresence;
  var getProjectList = ctx.getProjectList;
  var getHubSchedules = ctx.getHubSchedules;
  var loadContextSources = ctx.loadContextSources;
  var restoreDebateState = ctx.restoreDebateState;
  var stopFileWatch = ctx.stopFileWatch;
  var stopAllDirWatches = ctx.stopAllDirWatches;
  var getProjectOwnerId = ctx.getProjectOwnerId;
  var setProjectOwnerId = ctx.setProjectOwnerId;
  var getLatestVersion = ctx.getLatestVersion;
  var getTitle = ctx.getTitle;
  var getProject = ctx.getProject;
  var warmup = ctx.warmup;

  // Adapters are initialized lazily: the first websocket connection into
  // this project triggers warmup. Without this guard we would either keep
  // the old eager behavior (30+ Codex processes at daemon start) or run
  // warmup once per reconnect.
  var _warmedUp = false;

  function findRestoredActiveSession(ws, wsUser, allSessions) {
    var active = null;
    var presenceKey = wsUser ? wsUser.id : "_default";
    var storedPresence = userPresence.getPresence(slug, presenceKey);
    if (storedPresence && storedPresence.sessionId) {
      active = userPresence.findSession(sm.sessions, storedPresence.sessionId);
      if (active && usersModule.isMultiUser() && wsUser) {
        if (!usersModule.canAccessSession(wsUser.id, active, { visibility: "public" })) active = null;
      } else if (active && !usersModule.isMultiUser() && active.ownerId) {
        active = null;
      }
    }
    if (!active && allSessions.length > 0) {
      active = allSessions[0];
      for (var fi = 1; fi < allSessions.length; fi++) {
        if ((allSessions[fi].lastActivity || 0) > (active.lastActivity || 0)) {
          active = allSessions[fi];
        }
      }
    }
    return { active: active, storedPresence: storedPresence };
  }

  function handleConnection(ws, wsUser, handleMessage, handleDisconnection) {
    ws._clayUser = wsUser || null;
    clients.add(ws);
    broadcastClientCount();

    if (!_warmedUp) {
      _warmedUp = true;
      if (typeof warmup === "function") {
        try { warmup(wsUser && wsUser.linuxUser ? wsUser.linuxUser : null); }
        catch (e) { console.error("[project-connection] warmup failed for " + slug + ":", e && e.message ? e.message : e); }
      }
    }

    var loopState = _loop.loopState;

    // Resume loop if server restarted mid-execution (deferred so client gets initial state first)
    if (loopState._needsResume) {
      delete loopState._needsResume;
      setTimeout(function() { _loop.resumeLoop(); }, 500);
    }

    var projectOwnerId = getProjectOwnerId();

    // Send cached state
    var _userId = ws._clayUser ? ws._clayUser.id : null;
    var _filteredProjects = getProjectList(_userId);
    var title = getTitle();
    var project = getProject();
    var ownerLocked = !!(osUsers && osUsers.length > 0 && /^\/home\/[^/]+\//.test(cwd));
    var allSessions = [].concat(Array.from(sm.sessions.values())).filter(function (s) { return !s.hidden; });
    if (usersModule.isMultiUser() && wsUser) {
      allSessions = allSessions.filter(function (s) {
        return usersModule.canAccessSession(wsUser.id, s, { visibility: "public" });
      });
    } else if (!usersModule.isMultiUser()) {
      allSessions = allSessions.filter(function (s) { return !s.ownerId; });
    }
    var restoredState = ws._clayPane
      ? { active: null, storedPresence: null }
      : findRestoredActiveSession(ws, wsUser, allSessions);
    var restoredActive = restoredState.active;
    var initialVendor = (restoredActive && restoredActive.vendor) || sm.defaultVendor || "claude";
    var initialEffort = (restoredActive && restoredActive.effort) || yoke.clampEffort(
      initialVendor,
      (sm.currentEffortByVendor && sm.currentEffortByVendor[initialVendor]) || sm.currentEffort || "medium"
    ) || null;
    if (restoredActive && !restoredActive.effort && initialEffort) {
      restoredActive.effort = initialEffort;
      sm.saveSessionFile(restoredActive);
    }
    var initialModels = (sm.modelsByVendor && sm.modelsByVendor[initialVendor]) || sm.availableModels || [];
    sendTo(ws, { type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, dangerouslySkipPermissions: dangerouslySkipPermissions, osUsers: osUsers, lanHost: lanHost, projectCount: _filteredProjects.length, projects: _filteredProjects, projectOwnerId: projectOwnerId, ownerLocked: ownerLocked, vendors: yoke.VENDOR_REGISTRY });
    // Update notifications are pushed on a scheduled interval (see
    // scheduleUpdateBroadcast). We no longer push on connect to avoid
    // re-triggering the banner on every page refresh.
    if (sm.slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: sm.slashCommands });
    }
    var initialModel = (restoredActive && restoredActive.model) || ((sm.defaultModelByVendor || {})[initialVendor]) || "";
    // Vendor installation state is needed even before a new project has a
    // model. Always send it so reconnects cannot fall back to "Not installed."
    var initialModelInfo = buildInitialModelInfo(sm, initialVendor, initialModel, initialModels, restoredActive ? restoredActive.localId : null);
    sendTo(ws, initialModelInfo);
    sendTo(ws, { type: "config_state", model: initialModelInfo.model, vendor: initialVendor, sessionId: restoredActive ? restoredActive.localId : null, mode: sm.currentPermissionMode || "default", effort: initialEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
    sendTo(ws, { type: "last_vendor", vendor: sm.lastVendor || "" });
    sendTo(ws, Object.assign({ type: "codex_config" }, getCodexConfig(sm)));
    sendTo(ws, { type: "term_list", terminals: tm.list() });
    // Any login flow already running in this project, so a reconnecting client
    // re-attaches to the existing login terminal instead of starting another.
    if (_vendorLogin) _vendorLogin.sendStateTo(ws);
    // Context sources sent after session is resolved (per-session storage)
    // Send email accounts list for context sources picker
    var emailUserId = (wsUser && wsUser.id) || "default";
    var emailAccountsList = emailAccounts.listAccounts(emailUserId);
    sendTo(ws, { type: "email_accounts_list", accounts: emailAccountsList, providers: emailAccounts.PROVIDER_PRESETS });
    sendTo(ws, { type: "notes_list", notes: nm.list() });
    sendTo(ws, { type: "loop_registry_updated", records: getHubSchedules() });
    // Initial per-user preference: how to render Claude sessions.
    if (usersModule && typeof usersModule.getClaudeOpenMode === "function") {
      var _comUid = (wsUser && wsUser.id) || null;
      var _comVal = _comUid ? usersModule.getClaudeOpenMode(_comUid) : "gui";
      sendTo(ws, { type: "claude_open_mode_changed", claudeOpenMode: _comVal || "gui" });
    }

    // What's New: push the full entries list (for the home-page feed)
    // plus the subset of unseen ids (for the auto-pop carousel). Content
    // lives in lib/whats-new-content.js so adding an entry doesn't touch
    // this file.
    try {
      var _wn = require("./whats-new");
      var _wnUid = (wsUser && wsUser.id) || null;
      var _wnState = _wnUid ? _wn.getStateForUser(_wnUid) : { entries: _wn.listEntries(), unseenIds: [] };
      if (_wnState.entries.length > 0) {
        sendTo(ws, { type: "whats_new_state", entries: _wnState.entries, unseenIds: _wnState.unseenIds });
      }
    } catch (e) {
      if (debug) console.error("[project] whats_new send failed:", e && e.message);
    }
    _loop.sendConnectionState(ws);
    if (_mcp) _mcp.sendConnectionState(ws);
    if (_notifications) _notifications.sendConnectionState(ws, sendTo);

    // Session list (filtered for access control). Uses the same mapper as
    // broadcastSessionList: a hand-rolled copy here silently drifts and
    // drops fields (the connect-time list was missing vendor/spawn/mode,
    // so vendor badges showed Claude until the next broadcast).
    sendTo(ws, {
      type: "session_list",
      sessions: sm.mapSessionsForClient(allSessions),
    });
    if (_splitGroups) _splitGroups.sendConnectionState(ws);

    // Restore active session for this client from server-side presence
    var active = restoredState.active;
    var presenceKey = wsUser ? wsUser.id : "_default";
    var storedPresence = restoredState.storedPresence;
    var autoCreated = false;
    if (!active && !ws._clayPane) {
      var autoOpts = {};
      if (wsUser && usersModule.isMultiUser()) autoOpts.ownerId = wsUser.id;
      active = sm.createSession(autoOpts, ws);
      autoCreated = true;
    }
    if (active && !autoCreated) {
      if (!active.ownerId && wsUser && usersModule.isMultiUser()) {
        active.ownerId = wsUser.id;
        sm.saveSessionFile(active);
      }
      ws._clayActiveSession = active.localId;
      // Resolve the lazy-resume view (runtimeMode / runtimeTerminalId /
      // tuiSuspended + transcript hydration) the same way switch_session does,
      // so a born-TUI session restored on (re)connect shows the read-only
      // history + Resume bar instead of an editable composer. No PTY spawn.
      if (typeof resolveSessionForView === "function") {
        try { resolveSessionForView(active, ws); } catch (e) {}
      }
      var _vendorCaps = (sm.capabilitiesByVendor && sm.capabilitiesByVendor[active.vendor || sm.defaultVendor || "claude"]) || {};
      sendTo(ws, { type: "session_switched", id: active.localId, cliSessionId: active.cliSessionId || null, loop: active.loop || null, vendor: active.vendor || null, model: active.model || null, effort: active.effort || initialEffort || null, hasHistory: (active.history && active.history.length > 0), capabilities: _vendorCaps, mode: active.mode || "gui", terminalId: typeof active.terminalId === "number" ? active.terminalId : null, runtimeMode: active.runtimeMode || null, runtimeTerminalId: typeof active.runtimeTerminalId === "number" ? active.runtimeTerminalId : null, tuiSuspended: !!active.tuiSuspended });
      // Send per-session context sources
      var sessionSources = loadContextSources(slug, active.localId);
      sendTo(ws, { type: "context_sources_state", active: sessionSources });

      var total = active.history.length;
      var fromIndex = 0;
      if (total > sm.HISTORY_PAGE_SIZE) {
        fromIndex = sm.findTurnBoundary(active.history, Math.max(0, total - sm.HISTORY_PAGE_SIZE));
      }
      sendTo(ws, { type: "history_meta", total: total, from: fromIndex });
      for (var i = fromIndex; i < total; i++) {
        sendTo(ws, hydrateImageRefs(active.history[i]));
      }
      var _lastUsage = null, _lastModelUsage = null, _lastCost = null, _lastStreamInputTokens = null;
      for (var _ri = total - 1; _ri >= 0; _ri--) {
        if (active.history[_ri].type === "result") {
          var _r = active.history[_ri];
          _lastUsage = _r.usage || null;
          _lastModelUsage = _r.modelUsage || null;
          _lastCost = _r.cost != null ? _r.cost : null;
          _lastStreamInputTokens = _r.lastStreamInputTokens || null;
          break;
        }
      }
      sendTo(ws, { type: "history_done", lastUsage: _lastUsage, lastModelUsage: _lastModelUsage, lastCost: _lastCost, lastStreamInputTokens: _lastStreamInputTokens, contextUsage: active.lastContextUsage || null });

      if (active.isProcessing) {
        sendTo(ws, { type: "status", status: "processing" });
      }
      sendTo(ws, { type: "active_background_tasks", tasks: active.activeBackgroundTasks || [] });
      var pendingIds = Object.keys(active.pendingPermissions);
      for (var pi = 0; pi < pendingIds.length; pi++) {
        var p = active.pendingPermissions[pendingIds[pi]];
        sendTo(ws, {
          type: "permission_request_pending",
          requestId: p.requestId,
          toolName: p.toolName,
          toolInput: p.toolInput,
          toolUseId: p.toolUseId,
          decisionReason: p.decisionReason,
          mateId: p.mateId || undefined,
        });
      }
    }

    if (active && !ws._clayPane) {
      userPresence.setPresence(slug, presenceKey, userPresence.sessionIdForPersistence(active), storedPresence ? storedPresence.mateDm : null);
      if (autoCreated) {
        sendTo(ws, { type: "context_sources_state", active: [] });
      }
    }
    if (storedPresence && storedPresence.mateDm && !isMate) {
      sendTo(ws, { type: "restore_mate_dm", mateId: storedPresence.mateDm });
    }

    broadcastPresence();
    restoreDebateState(ws);

    ws.on("message", function (raw) {
      var msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      dispatchMessageSafely(handleMessage, sendTo, slug, ws, msg);
    });

    ws.on("close", function () {
      handleDisconnection(ws);
    });
  }

  function handleDisconnection(ws) {
    if (ws._clayActiveSession && !ws._clayPane) {
      var dcPresKey = ws._clayUser ? ws._clayUser.id : "_default";
      var dcExisting = userPresence.getPresence(slug, dcPresKey);
      var dcSession = sm.sessions.get(ws._clayActiveSession);
      userPresence.setPresence(slug, dcPresKey, userPresence.sessionIdForPersistence(dcSession), dcExisting ? dcExisting.mateDm : null);
    }
    tm.detachAll(ws);
    clients.delete(ws);
    stopFileWatch(ws);
    stopAllDirWatches(ws);
    if (clients.size === 0) {
      stopFileWatch();
      stopAllDirWatches();
    }
    broadcastClientCount();
    broadcastPresence();
  }

  // Keep-alive for the project socket, mirroring the `/ws` global handler.
  //
  // A reverse proxy resets its upstream read timeout on data flowing back from
  // the server, so a client ping is only useful if the server answers it. This
  // reads nothing, mutates nothing, and reveals nothing about the connection:
  // it is a fixed reply on a fixed message type.
  function handleKeepaliveMessage(ws, msg) {
    if (!msg || typeof msg !== "object" || msg.type !== "ping") return false;
    sendTo(ws, { type: "pong" });
    return true;
  }

  return {
    handleConnection: handleConnection,
    handleDisconnection: handleDisconnection,
    handleKeepaliveMessage: handleKeepaliveMessage,
  };
}

module.exports = {
  attachConnection: attachConnection,
  buildInitialModelInfo: buildInitialModelInfo,
  dispatchMessageSafely: dispatchMessageSafely,
};
