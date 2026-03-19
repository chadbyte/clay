var fs = require("fs");
var path = require("path");
var config = require("./config");
var utils = require("./utils");
var users = require("./users");

function createSessionManager(opts) {
  var cwd = opts.cwd;
  var send = opts.send;          // function(obj) - broadcast to all clients
  var sendTo = opts.sendTo || null; // function(ws, obj) - send to specific client
  var sendEach = opts.sendEach || null; // function(fn) - call fn(ws) for each connected client
  var sendAndRecord = null;      // set after init via setSendAndRecord
  var onSessionDone = opts.onSessionDone || function () {};

  // --- Multi-session state ---
  var nextLocalId = 1;
  var sessions = new Map();     // localId -> session object
  var activeSessionId = null;   // currently active local ID
  var slashCommands = null;     // shared across sessions
  var skillNames = null;        // Claude-only skills to filter from slash menu
  var singleUserUnread = {};    // sessionLocalId -> unread count (single-user mode)

  // --- Session persistence (centralized in ~/.clay/sessions/{encoded-cwd}/) ---
  var sessionsBase = path.join(config.CONFIG_DIR, "sessions");
  var encodedCwd = utils.resolveEncodedDir(sessionsBase, cwd);
  var sessionsDir = path.join(sessionsBase, encodedCwd);
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Auto-migrate sessions from legacy locations:
  //   v1: {cwd}/.claude-relay/sessions/
  //   v2: ~/.claude-relay/sessions/{encoded-cwd}/  (if config.js rename didn't cover it)
  var legacySessionDirs = [
    path.join(cwd, ".claude-relay", "sessions"),
    path.join(require("os").homedir(), ".claude-relay", "sessions", encodedCwd),
  ];
  for (var li = 0; li < legacySessionDirs.length; li++) {
    var oldSessionsDir = legacySessionDirs[li];
    try {
      var oldFiles = fs.readdirSync(oldSessionsDir);
      var migrated = 0;
      for (var mi = 0; mi < oldFiles.length; mi++) {
        if (!oldFiles[mi].endsWith(".jsonl")) continue;
        var oldFilePath = path.join(oldSessionsDir, oldFiles[mi]);
        var newFilePath = path.join(sessionsDir, oldFiles[mi]);
        if (fs.existsSync(newFilePath)) continue;
        try {
          fs.renameSync(oldFilePath, newFilePath);
          migrated++;
        } catch (renameErr) {
          try {
            fs.copyFileSync(oldFilePath, newFilePath);
            fs.unlinkSync(oldFilePath);
            migrated++;
          } catch (copyErr) {}
        }
      }
      if (migrated > 0) {
        console.log("[sessions] Migrated " + migrated + " session(s) from " + oldSessionsDir);
      }
      // Clean up old directory if empty
      try {
        if (fs.readdirSync(oldSessionsDir).length === 0) {
          fs.rmdirSync(oldSessionsDir);
          var parentDir = path.dirname(oldSessionsDir);
          if (fs.readdirSync(parentDir).length === 0) fs.rmdirSync(parentDir);
        }
      } catch (e) {}
    } catch (e) {
      // Old directory doesn't exist — that's fine
    }
  }

  function sessionFilePath(cliSessionId) {
    return path.join(sessionsDir, cliSessionId + ".jsonl");
  }

  function saveSessionFile(session) {
    if (!session.cliSessionId) return;
    session.lastActivity = Date.now();
    try {
      var metaObj = {
        type: "meta",
        localId: session.localId,
        cliSessionId: session.cliSessionId,
        title: session.title,
        createdAt: session.createdAt,
      };
      if (session.ownerId) metaObj.ownerId = session.ownerId;
      if (session.sessionVisibility) metaObj.sessionVisibility = session.sessionVisibility;
      if (session.lastRewindUuid) metaObj.lastRewindUuid = session.lastRewindUuid;
      if (session.loop) metaObj.loop = session.loop;
      var meta = JSON.stringify(metaObj);
      var lines = [meta];
      for (var i = 0; i < session.history.length; i++) {
        lines.push(JSON.stringify(session.history[i]));
      }
      var sfPath = sessionFilePath(session.cliSessionId);
      fs.writeFileSync(sfPath, lines.join("\n") + "\n");
      if (process.platform !== "win32") {
        try { fs.chmodSync(sfPath, 0o600); } catch (chmodErr) {}
      }
    } catch(e) {
      console.error("[session] Failed to save session file:", e.message);
    }
  }

  function appendToSessionFile(session, obj) {
    if (!session.cliSessionId) return;
    session.lastActivity = Date.now();
    try {
      var afPath = sessionFilePath(session.cliSessionId);
      fs.appendFileSync(afPath, JSON.stringify(obj) + "\n");
      if (process.platform !== "win32") {
        try { fs.chmodSync(afPath, 0o600); } catch (chmodErr) {}
      }
    } catch(e) {
      console.error("[session] Failed to append to session file:", e.message);
    }
  }

  function loadSessions() {
    var files;
    try { files = fs.readdirSync(sessionsDir); } catch { return; }

    var loaded = [];
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith(".jsonl")) continue;
      var content;
      try { content = fs.readFileSync(path.join(sessionsDir, files[i]), "utf8"); } catch { continue; }
      var lines = content.trim().split("\n");
      if (lines.length === 0) continue;

      var meta;
      try { meta = JSON.parse(lines[0]); } catch { continue; }
      if (meta.type !== "meta" || !meta.cliSessionId) continue;

      var history = [];
      for (var j = 1; j < lines.length; j++) {
        try { history.push(JSON.parse(lines[j])); } catch {}
      }

      var fileMtime = 0;
      try { fileMtime = fs.statSync(path.join(sessionsDir, files[i])).mtimeMs; } catch {}
      loaded.push({ meta: meta, history: history, mtime: fileMtime });
    }

    loaded.sort(function(a, b) { return a.meta.createdAt - b.meta.createdAt; });

    for (var i = 0; i < loaded.length; i++) {
      var m = loaded[i].meta;
      var localId = nextLocalId++;
      // Reconstruct messageUUIDs from history
      var messageUUIDs = [];
      for (var k = 0; k < loaded[i].history.length; k++) {
        if (loaded[i].history[k].type === "message_uuid") {
          messageUUIDs.push({ uuid: loaded[i].history[k].uuid, type: loaded[i].history[k].messageType, historyIndex: k });
        }
      }
      var session = {
        localId: localId,
        queryInstance: null,
        messageQueue: null,
        cliSessionId: m.cliSessionId,
        blocks: {},
        sentToolResults: {},
        pendingPermissions: {},
        pendingAskUser: {},
        isProcessing: false,
        title: m.title || "",
        createdAt: m.createdAt || Date.now(),
        lastActivity: loaded[i].mtime || m.createdAt || Date.now(),
        history: loaded[i].history,
        messageUUIDs: messageUUIDs,
        lastRewindUuid: m.lastRewindUuid || null,
      };
      if (m.loop) session.loop = m.loop;
      if (m.ownerId) session.ownerId = m.ownerId;
      session.sessionVisibility = m.sessionVisibility || "shared";
      sessions.set(localId, session);
    }
  }

  // Load persisted sessions from disk
  loadSessions();

  function getActiveSession() {
    return sessions.get(activeSessionId) || null;
  }

  var resolveLoopInfo = null; // optional callback: (loopId) => { name, source } or null

  function setResolveLoopInfo(fn) {
    resolveLoopInfo = fn;
  }

  function mapSessionForClient(s, clientActiveId, wsUnread) {
    var loop = s.loop ? Object.assign({}, s.loop) : null;
    if (loop && loop.loopId && resolveLoopInfo) {
      var info = resolveLoopInfo(loop.loopId);
      if (info) {
        if (info.name) loop.name = info.name;
        if (info.source) loop.source = info.source;
      }
    }
    var isActive = (typeof clientActiveId === "number") ? s.localId === clientActiveId : s.localId === activeSessionId;
    var unreadMap = wsUnread || singleUserUnread;
    return {
      id: s.localId,
      cliSessionId: s.cliSessionId || null,
      title: s.title || "New Session",
      active: isActive,
      isProcessing: s.isProcessing,
      lastActivity: s.lastActivity || s.createdAt || 0,
      loop: loop,
      ownerId: s.ownerId || null,
      sessionVisibility: s.sessionVisibility || "shared",
      unread: unreadMap[s.localId] || 0,
    };
  }

  function getVisibleSessions() {
    var multiUser = users.isMultiUser();
    return [...sessions.values()].filter(function (s) {
      if (s.hidden) return false;
      if (!multiUser) {
        // Single-user mode: only show sessions without ownerId
        return !s.ownerId;
      }
      // Multi-user mode: include all sessions (per-user filtering done by canAccessSession)
      return true;
    });
  }

  function broadcastSessionList() {
    var allVisible = getVisibleSessions();
    if (sendEach) {
      // Per-client filtering (multi-user mode)
      sendEach(function (ws, filterFn) {
        var filtered = filterFn ? allVisible.filter(filterFn) : allVisible;
        var clientActiveId = ws._clayActiveSession;
        var wsUnread = ws._clayUnread || {};
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "session_list",
            sessions: filtered.map(function (s) { return mapSessionForClient(s, clientActiveId, wsUnread); }),
          }));
        }
      });
    } else {
      send({
        type: "session_list",
        sessions: allVisible.map(function (s) { return mapSessionForClient(s); }),
      });
    }
  }

  function createSession(sessionOpts, targetWs) {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: "",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      history: [],
      messageUUIDs: [],
      ownerId: (sessionOpts && sessionOpts.ownerId) || null,
      sessionVisibility: (sessionOpts && sessionOpts.sessionVisibility) || "shared",
    };
    sessions.set(localId, session);
    switchSession(localId, targetWs);
    return session;
  }

  // Create a session without switching to it (used for mate/background sessions)
  function createSessionRaw(sessionOpts) {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: "",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      history: [],
      messageUUIDs: [],
      ownerId: (sessionOpts && sessionOpts.ownerId) || null,
      sessionVisibility: (sessionOpts && sessionOpts.sessionVisibility) || "shared",
    };
    sessions.set(localId, session);
    return session;
  }

  var HISTORY_PAGE_SIZE = 200;

  function findTurnBoundary(history, targetIndex) {
    for (var i = targetIndex; i >= 0; i--) {
      if (history[i].type === "user_message") return i;
    }
    return 0;
  }

  function replayHistory(session, fromIndex, targetWs) {
    var _send = (targetWs && sendTo) ? function (obj) { sendTo(targetWs, obj); } : send;
    var total = session.history.length;
    if (typeof fromIndex !== "number") {
      if (total <= HISTORY_PAGE_SIZE) {
        fromIndex = 0;
      } else {
        fromIndex = findTurnBoundary(session.history, Math.max(0, total - HISTORY_PAGE_SIZE));
      }
    }

    _send({ type: "history_meta", total: total, from: fromIndex });

    for (var i = fromIndex; i < total; i++) {
      _send(session.history[i]);
    }

    // Find the last result message in the full history for accurate context data
    var lastUsage = null;
    var lastModelUsage = null;
    var lastCost = null;
    var lastStreamInputTokens = null;
    for (var j = total - 1; j >= 0; j--) {
      if (session.history[j].type === "result") {
        var r = session.history[j];
        lastUsage = r.usage || null;
        lastModelUsage = r.modelUsage || null;
        lastCost = r.cost != null ? r.cost : null;
        lastStreamInputTokens = r.lastStreamInputTokens || null;
        break;
      }
    }

    _send({ type: "history_done", lastUsage: lastUsage, lastModelUsage: lastModelUsage, lastCost: lastCost, lastStreamInputTokens: lastStreamInputTokens });
  }

  function switchSession(localId, targetWs) {
    var session = sessions.get(localId);
    if (!session) return;

    activeSessionId = localId;
    if (targetWs) {
      targetWs._clayActiveSession = localId;
      // Clear unread for this session (multi-user)
      if (targetWs._clayUnread) targetWs._clayUnread[localId] = 0;
    }
    // Clear unread for single-user mode
    singleUserUnread[localId] = 0;

    // In multi-user mode with a specific client, only send to that client
    var _send = (targetWs && sendTo) ? function (obj) { sendTo(targetWs, obj); } : send;

    _send({ type: "session_switched", id: localId, cliSessionId: session.cliSessionId || null, loop: session.loop || null });
    broadcastSessionList();
    replayHistory(session, undefined, targetWs);

    if (session.isProcessing) {
      _send({ type: "status", status: "processing" });
    }

    // Re-send any pending permission requests
    var pendingIds = Object.keys(session.pendingPermissions);
    for (var i = 0; i < pendingIds.length; i++) {
      var p = session.pendingPermissions[pendingIds[i]];
      _send({
        type: "permission_request_pending",
        requestId: p.requestId,
        toolName: p.toolName,
        toolInput: p.toolInput,
        toolUseId: p.toolUseId,
        decisionReason: p.decisionReason,
      });
    }
  }

  function deleteSession(localId, targetWs) {
    var session = sessions.get(localId);
    if (!session) return;

    // Clean up unread tracking
    delete singleUserUnread[localId];

    if (session.abortController) {
      try { session.abortController.abort(); } catch(e) {}
    }
    if (session.messageQueue) {
      try { session.messageQueue.end(); } catch(e) {}
    }

    if (session.cliSessionId) {
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }

    sessions.delete(localId);

    if (activeSessionId === localId) {
      var remaining = [...sessions.keys()];
      if (remaining.length > 0) {
        switchSession(remaining[remaining.length - 1], targetWs);
      } else {
        createSession(null, targetWs);
      }
    } else {
      broadcastSessionList();
    }
  }

  function deleteSessionQuiet(localId) {
    var session = sessions.get(localId);
    if (!session) return;
    delete singleUserUnread[localId];
    if (session.abortController) {
      try { session.abortController.abort(); } catch(e) {}
    }
    if (session.messageQueue) {
      try { session.messageQueue.end(); } catch(e) {}
    }
    if (session.cliSessionId) {
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }
    sessions.delete(localId);
  }

  function doSendAndRecord(session, obj) {
    session.history.push(obj);
    appendToSessionFile(session, obj);
    if (sendEach) {
      // Multi-user: send to clients whose active session matches this one
      var data = JSON.stringify(obj);
      var ioData = null;
      sendEach(function (ws) {
        if (ws._clayActiveSession === session.localId) {
          if (ws.readyState === 1) ws.send(data);
        } else if (session.isProcessing && !session._ioThrottle) {
          if (!ioData) ioData = JSON.stringify({ type: "session_io", id: session.localId });
          if (ws.readyState === 1) ws.send(ioData);
        }
        // Track unread: increment on "done" for clients not viewing this session
        if (obj.type === "done" && ws._clayActiveSession !== session.localId) {
          if (!ws._clayUnread) ws._clayUnread = {};
          ws._clayUnread[session.localId] = (ws._clayUnread[session.localId] || 0) + 1;
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "session_unread", id: session.localId, count: ws._clayUnread[session.localId] }));
          }
        }
      });
      if (session.isProcessing && !session._ioThrottle && ioData) {
        session._ioThrottle = true;
        setTimeout(function () { session._ioThrottle = false; }, 80);
      }
    } else if (session.localId === activeSessionId) {
      send(obj);
    } else {
      // Track unread for single-user mode on "done"
      if (obj.type === "done") {
        singleUserUnread[session.localId] = (singleUserUnread[session.localId] || 0) + 1;
        send({ type: "session_unread", id: session.localId, count: singleUserUnread[session.localId] });
      }
      if (session.isProcessing && !session._ioThrottle) {
        session._ioThrottle = true;
        send({ type: "session_io", id: session.localId });
        setTimeout(function () { session._ioThrottle = false; }, 80);
      }
    }
    // Notify server for cross-project unread tracking
    if (obj.type === "done") onSessionDone();
  }

  function resumeSession(cliSessionId, opts, targetWs) {
    // If a session with this cliSessionId already exists, just switch to it
    var existing = null;
    sessions.forEach(function (s) {
      if (s.cliSessionId === cliSessionId) existing = s;
    });
    if (existing) {
      existing.lastActivity = Date.now();
      switchSession(existing.localId, targetWs);
      return existing;
    }

    var cliHistory = (opts && opts.history) || [];
    var title = (opts && opts.title) || "Resumed session";
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: cliSessionId,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: title,
      createdAt: Date.now(),
      history: cliHistory,
      messageUUIDs: [],
    };
    sessions.set(localId, session);
    saveSessionFile(session);
    switchSession(localId, targetWs);
    return session;
  }

  // --- Spawn initial session only if no persisted sessions ---
  if (sessions.size === 0) {
    createSession();
  } else {
    // Activate the most recently used session
    var allSessions = [...sessions.values()];
    var mostRecent = allSessions[0];
    for (var i = 1; i < allSessions.length; i++) {
      if ((allSessions[i].lastActivity || 0) > (mostRecent.lastActivity || 0)) {
        mostRecent = allSessions[i];
      }
    }
    activeSessionId = mostRecent.localId;
  }

  function searchSessions(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var results = [];
    sessions.forEach(function (session) {
      var titleMatch = (session.title || "New Session").toLowerCase().indexOf(q) !== -1;
      var contentMatch = false;
      for (var i = 0; i < session.history.length; i++) {
        var entry = session.history[i];
        if ((entry.type === "delta" || entry.type === "user_message") && entry.text) {
          if (entry.text.toLowerCase().indexOf(q) !== -1) {
            contentMatch = true;
            break;
          }
        }
      }
      if (titleMatch || contentMatch) {
        results.push({
          id: session.localId,
          cliSessionId: session.cliSessionId || null,
          title: session.title || "New Session",
          active: session.localId === activeSessionId,
          isProcessing: session.isProcessing,
          lastActivity: session.lastActivity || session.createdAt || 0,
          matchType: titleMatch && contentMatch ? "both" : titleMatch ? "title" : "content",
        });
      }
    });
    return results;
  }

  function searchSessionContent(localId, query) {
    if (!query) return { hits: [], total: 0 };
    var session = sessions.get(localId);
    if (!session) return { hits: [], total: 0 };
    var q = query.toLowerCase();
    var history = session.history;
    var hits = [];
    var lastAssistantHitTurn = -1; // track current assistant turn to deduplicate delta hits
    var currentTurnStart = -1;
    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      if (entry.type === "user_message") {
        currentTurnStart = i;
        lastAssistantHitTurn = -1;
      }
      if ((entry.type === "delta" || entry.type === "user_message") && entry.text) {
        // Skip duplicate delta hits within the same assistant turn
        if (entry.type === "delta" && currentTurnStart === lastAssistantHitTurn) continue;
        var text = entry.text;
        var lowerText = text.toLowerCase();
        var idx = lowerText.indexOf(q);
        if (idx === -1) continue;
        var start = Math.max(0, idx - 15);
        var end = Math.min(text.length, idx + query.length + 15);
        var snippet = (start > 0 ? "\u2026" : "") + text.substring(start, end) + (end < text.length ? "\u2026" : "");
        if (entry.type === "delta") lastAssistantHitTurn = currentTurnStart;
        hits.push({
          historyIndex: i,
          snippet: snippet,
          role: entry.type === "user_message" ? "user" : "assistant",
        });
      }
    }
    return { hits: hits, total: history.length };
  }

  function migrateSessionTitles(getSDK, migrateCwd) {
    var toMigrate = [];
    sessions.forEach(function(s) {
      if (s.cliSessionId && s.title && s.title !== "New Session" && s.title !== "Resumed session") {
        toMigrate.push({ cliSessionId: s.cliSessionId, title: s.title });
      }
    });
    if (toMigrate.length === 0) return;
    getSDK().then(function(sdkMod) {
      var chain = Promise.resolve();
      for (var i = 0; i < toMigrate.length; i++) {
        (function(item) {
          chain = chain.then(function() {
            return sdkMod.renameSession(item.cliSessionId, item.title, { dir: migrateCwd }).catch(function(e) {
              console.error("[session] Migration failed for " + item.cliSessionId + ":", e.message);
            });
          });
        })(toMigrate[i]);
      }
      chain.then(function() {
        console.log("[session] Migrated " + toMigrate.length + " session title(s) to SDK format");
      });
    }).catch(function() {});
  }

  return {
    get activeSessionId() { return activeSessionId; },
    get nextLocalId() { return nextLocalId; },
    get slashCommands() { return slashCommands; },
    set slashCommands(v) { slashCommands = v; },
    get skillNames() { return skillNames; },
    set skillNames(v) { skillNames = v; },
    sessions: sessions,
    sessionsDir: sessionsDir,
    HISTORY_PAGE_SIZE: HISTORY_PAGE_SIZE,
    getActiveSession: getActiveSession,
    createSession: createSession,
    createSessionRaw: createSessionRaw,
    switchSession: switchSession,
    deleteSession: deleteSession,
    deleteSessionQuiet: deleteSessionQuiet,
    resumeSession: resumeSession,
    broadcastSessionList: broadcastSessionList,
    getTotalUnread: function (ws) {
      var unreadMap = ws && ws._clayUnread ? ws._clayUnread : singleUserUnread;
      var total = 0;
      var keys = Object.keys(unreadMap);
      for (var i = 0; i < keys.length; i++) {
        total += unreadMap[keys[i]] || 0;
      }
      return total;
    },
    saveSessionFile: saveSessionFile,
    appendToSessionFile: appendToSessionFile,
    sendAndRecord: doSendAndRecord,
    findTurnBoundary: findTurnBoundary,
    replayHistory: replayHistory,
    searchSessions: searchSessions,
    searchSessionContent: searchSessionContent,
    setResolveLoopInfo: setResolveLoopInfo,
    migrateSessionTitles: migrateSessionTitles,
    setSessionVisibility: function (localId, visibility) {
      var session = sessions.get(localId);
      if (!session) return { error: "Session not found" };
      session.sessionVisibility = visibility;
      saveSessionFile(session);
      broadcastSessionList();
      return { ok: true };
    },
    setSessionOwner: function (localId, ownerId) {
      var session = sessions.get(localId);
      if (!session) return { error: "Session not found" };
      session.ownerId = ownerId;
      saveSessionFile(session);
      return { ok: true };
    },
  };
}

module.exports = { createSessionManager };
