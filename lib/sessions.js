var fs = require("fs");
var path = require("path");
var config = require("./config");
var utils = require("./utils");
var users = require("./users");
var { CODEX_DEFAULTS } = require("./codex-defaults");
var hygiene = require("./session-hygiene");
var backgroundTaskTiming = require("./background-task-timing");
var sessionProvenance = require("./session-provenance");
var sessionVisibility = require("./session-visibility");

function createSessionManager(opts) {
  var cwd = opts.cwd;
  var send = opts.send;          // function(obj) - broadcast to all clients
  var sendTo = opts.sendTo || null; // function(ws, obj) - send to specific client
  var sendEach = opts.sendEach || null; // function(fn) - call fn(ws) for each connected client
  var sendAndRecord = null;      // set after init via setSendAndRecord
  var onSessionDone = opts.onSessionDone || function () {};
  var onSessionDeleted = opts.onSessionDeleted || function () {};
  var onSessionRenamed = opts.onSessionRenamed || function () {};
  var onSessionIdentityAssigned = opts.onSessionIdentityAssigned || function () {};

  // --- Multi-session state ---
  var nextLocalId = 1;
  var sessions = new Map();     // localId -> session object
  var activeSessionId = null;   // currently active local ID
  var slashCommands = null;     // shared across sessions (deprecated, use slashCommandsByVendor)
  var slashCommandsByVendor = {}; // vendor -> array of slash commands
  var skillNames = null;        // Claude-only skills to filter from slash menu
  var singleUserUnread = {};    // sessionLocalId -> unread count (single-user mode)
  var permissionRequestIndex = {}; // requestId -> sessionLocalId (O(1) lookup)
  var capabilitiesByVendor = null; // set by sdk-bridge after adapter init
  var defaultVendor = null;        // set by sdk-bridge
  var codexApproval = CODEX_DEFAULTS.approval;
  var codexSandbox = CODEX_DEFAULTS.sandbox;
  var codexWebSearch = CODEX_DEFAULTS.webSearch;

  // --- Session persistence (centralized in ~/.clay/sessions/{encoded-cwd}/) ---
  var sessionsBase = opts.sessionsBase || path.join(config.CONFIG_DIR, "sessions");
  var encodedCwd = utils.resolveEncodedDir(sessionsBase, cwd);
  var sessionsDir = path.join(sessionsBase, encodedCwd);
  fs.mkdirSync(sessionsDir, { recursive: true });
  var cliSessionsDir = opts.cliSessionsDir || path.join(config.REAL_HOME, ".claude", "projects", utils.encodeCwd(cwd));
  var deletedCliSessionsPath = path.join(sessionsDir, "deleted-cli-sessions.json");
  var deletedCliSessionIds = new Set();
  try {
    var deletedCliData = JSON.parse(fs.readFileSync(deletedCliSessionsPath, "utf8"));
    var deletedCliIds = Array.isArray(deletedCliData) ? deletedCliData : deletedCliData.sessionIds;
    if (Array.isArray(deletedCliIds)) {
      for (var dci = 0; dci < deletedCliIds.length; dci++) {
        if (typeof deletedCliIds[dci] === "string") deletedCliSessionIds.add(deletedCliIds[dci]);
      }
    }
  } catch (e) {}

  function rememberDeletedCliSession(cliSessionId) {
    if (!cliSessionId || deletedCliSessionIds.has(cliSessionId)) return;
    deletedCliSessionIds.add(cliSessionId);
    try {
      var data = JSON.stringify({ version: 1, sessionIds: Array.from(deletedCliSessionIds) }, null, 2) + "\n";
      var tmpPath = deletedCliSessionsPath + ".tmp." + process.pid;
      fs.writeFileSync(tmpPath, data);
      if (process.platform !== "win32") {
        try { fs.chmodSync(tmpPath, 0o600); } catch (chmodErr) {}
      }
      fs.renameSync(tmpPath, deletedCliSessionsPath);
    } catch (e) {
      console.error("[session] Failed to remember deleted CLI session:", e.message);
    }
  }

  function readCliTranscriptHead(filePath) {
    var MAX_READ = 64 * 1024;
    try {
      var stat = fs.statSync(filePath);
      var fd = fs.openSync(filePath, "r");
      var bytesToRead = Math.min(stat.size, MAX_READ);
      var buf = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buf, 0, bytesToRead, 0);
      fs.closeSync(fd);
      var lines = buf.toString("utf8").split("\n");
      var events = [];
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        try {
          var event = JSON.parse(lines[i]);
          if (event && typeof event === "object") events.push(event);
        } catch (e) {}
      }
      return events;
    } catch (e) {
      return null;
    }
  }

  // Auto-migrate sessions from legacy locations:
  //   v1: {cwd}/.claude-relay/sessions/
  //   v2: ~/.claude-relay/sessions/{encoded-cwd}/  (if config.js rename didn't cover it)
  var legacySessionDirs = [
    path.join(cwd, ".claude-relay", "sessions"),
    path.join(require("./config").REAL_HOME, ".claude-relay", "sessions", encodedCwd),
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
    try {
      var metaObj = {
        type: "meta",
        localId: session.localId,
        cliSessionId: session.cliSessionId,
        title: session.title,
        createdAt: session.createdAt,
      };
      if (session.ownerId) metaObj.ownerId = session.ownerId;
      if (session.vendor) metaObj.vendor = session.vendor;
      if (session.model) metaObj.model = session.model;
      if (session.effort) metaObj.effort = session.effort;
      // Persist the session's "born" mode so TUI sessions reappear after a
      // daemon restart. terminalId/runtimeMode/runtimeTerminalId are
      // transient (PTY ids don't survive restart), so they aren't stored;
      // the click handler will respawn the PTY via `claude --resume` when
      // the user reopens the session.
      if (session.mode === "tui") metaObj.mode = "tui";
      if (session.adopted) metaObj.adopted = true;
      // Born-TUI sessions launched in bypass-permissions mode persist the flag
      // so lazy-resume (`claude --resume`) re-spawns with the same flag.
      if (session.dangerouslySkipPermissions) metaObj.dangerouslySkipPermissions = true;
      if (session.permissionMode) metaObj.permissionMode = session.permissionMode;
      if (session.permissionModeBeforeFullAccess) metaObj.permissionModeBeforeFullAccess = session.permissionModeBeforeFullAccess;
      metaObj.sessionVisibility = sessionVisibility.normalize(session.sessionVisibility);
      if (session.sessionVisibilityExplicit) metaObj.sessionVisibilityExplicit = true;
      if (session.bookmarked) metaObj.bookmarked = true;
      if (typeof session.favoriteOrder === "number") metaObj.favoriteOrder = session.favoriteOrder;
      if (session.lastRewindUuid) metaObj.lastRewindUuid = session.lastRewindUuid;
      if (session.loop) metaObj.loop = session.loop;
      if (session.spawn) metaObj.spawn = session.spawn;
      if (session.assignment) metaObj.assignment = session.assignment;
      if (session.handoff) metaObj.handoff = session.handoff;
      if (session.debateState) metaObj.debateState = session.debateState;
      if (session.debateSetupMode) metaObj.debateSetupMode = true;
      if (session.homeDebatePlanning) metaObj.homeDebatePlanning = true;
      if (session.homeDebatePhase) metaObj.homeDebatePhase = session.homeDebatePhase;
      if (session.homeDebateInitialTopic) metaObj.homeDebateInitialTopic = session.homeDebateInitialTopic;
      if (session.homeClayEntryRequestId) metaObj.homeClayEntryRequestId = session.homeClayEntryRequestId;
      if (session.homeClayEntryMode) metaObj.homeClayEntryMode = session.homeClayEntryMode;
      var provenanceMeta = sessionProvenance.metadata(session);
      metaObj.sessionOriginId = provenanceMeta.sessionOriginId;
      if (provenanceMeta.sessionProvenance) metaObj.sessionProvenance = provenanceMeta.sessionProvenance;
      var meta = JSON.stringify(metaObj);
      var lines = [meta];
      for (var i = 0; i < session.history.length; i++) {
        lines.push(JSON.stringify(session.history[i]));
      }
      var sfPath = sessionFilePath(session.cliSessionId);
      // Atomic write: write to temp file then rename, so a crash mid-write
      // cannot leave a truncated/corrupted session file.
      var tmpPath = sfPath + ".tmp." + process.pid;
      fs.writeFileSync(tmpPath, lines.join("\n") + "\n");
      if (process.platform !== "win32") {
        try { fs.chmodSync(tmpPath, 0o600); } catch (chmodErr) {}
      }
      fs.renameSync(tmpPath, sfPath);
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

  function deriveSessionModel(history) {
    for (var i = history.length - 1; i >= 0; i--) {
      var modelUsage = history[i] && history[i].modelUsage;
      if (!modelUsage || typeof modelUsage !== "object") continue;
      var models = Object.keys(modelUsage);
      if (models.length > 0) return models[0];
    }
    return null;
  }

  function loadSessions() {
    var files;
    try { files = fs.readdirSync(sessionsDir); } catch { return; }

    // Clean up stale temp files from interrupted atomic writes
    for (var ti = 0; ti < files.length; ti++) {
      if (files[ti].indexOf(".tmp.") !== -1) {
        try { fs.unlinkSync(path.join(sessionsDir, files[ti])); } catch (e) {}
      }
    }

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
      if (m.vendor) session.vendor = m.vendor;
      session.model = m.model || deriveSessionModel(loaded[i].history);
      session.effort = m.effort || null;
      if (m.loop) session.loop = m.loop;
      if (m.spawn) session.spawn = m.spawn;
      if (m.assignment) session.assignment = m.assignment;
      if (m.handoff) session.handoff = m.handoff;
      if (m.debateState) session.debateState = m.debateState;
      if (m.debateSetupMode) session.debateSetupMode = true;
      if (m.homeDebatePlanning) session.homeDebatePlanning = true;
      if (m.homeDebatePhase) session.homeDebatePhase = m.homeDebatePhase;
      if (m.homeDebateInitialTopic) session.homeDebateInitialTopic = m.homeDebateInitialTopic;
      if (m.homeClayEntryRequestId) session.homeClayEntryRequestId = m.homeClayEntryRequestId;
      if (m.homeClayEntryMode) session.homeClayEntryMode = m.homeClayEntryMode;
      if (m.ownerId) session.ownerId = m.ownerId;
      session.sessionOriginId = m.sessionOriginId || null;
      session._provenanceMigrationNeeded = sessionProvenance.restore(m, session);
      // Born-TUI session: PTY is gone after restart, but the cliSessionId
      // is still resumable via `claude --resume <id>`. We mark the mode
      // here so it shows up in the sidebar with the right icon; the
      // switch_session handler respawns the PTY on click.
      session.mode = (m.mode === "tui") ? "tui" : "gui";
      if (m.adopted) session.adopted = true;
      // The dangerous CLI flag belongs to born-TUI sessions only. Migrate any
      // GUI metadata written by the short-lived full-access implementation to
      // Clay's own per-session permission mode.
      session.dangerouslySkipPermissions = session.mode === "tui" && !!m.dangerouslySkipPermissions;
      session.permissionMode = m.permissionMode || (session.mode === "gui" && m.dangerouslySkipPermissions ? "bypassPermissions" : null);
      session.permissionModeBeforeFullAccess = m.permissionModeBeforeFullAccess || null;
      session.terminalId = null;
      session.runtimeMode = null;
      session.runtimeTerminalId = null;
      session.sessionVisibility = sessionVisibility.restore(m);
      session.sessionVisibilityExplicit = m.sessionVisibilityExplicit === true;
      session.bookmarked = !!m.bookmarked;
      session.favoriteOrder = typeof m.favoriteOrder === "number" ? m.favoriteOrder : null;
      sessions.set(localId, session);
    }

    // Versionless legacy records are safe top-level Drivers. Assigning an
    // opaque origin ID is the only migration: no title, slug or active split
    // state is used to invent historical parentage.
    sessions.forEach(function (session) {
      if (!session.cliSessionId || !session._provenanceMigrationNeeded) return;
      var activityTime = session.lastActivity;
      saveSessionFile(session);
      try {
        var preservedTime = new Date(activityTime);
        fs.utimesSync(sessionFilePath(session.cliSessionId), preservedTime, preservedTime);
      } catch (e) {}
      delete session._provenanceMigrationNeeded;
    });
  }

  // Adopt orphaned CLI sessions from ~/.claude/projects/<encoded-cwd>/ as
  // Clay session records. After this runs the sidebar shows a single
  // unified list of sessions regardless of whether they were born inside
  // Clay or via the `claude` CLI directly. The user's claudeOpenMode pref
  // decides how each click renders (TUI respawn vs GUI hydration) - both
  // paths already exist for born-TUI sessions.
  //
  // Adopted records are saved with mode='tui' because they originated in
  // the CLI, not via the SDK. The cross-mode click logic in
  // project-sessions.js (prepareTuiSessionForGuiView + respawn) handles
  // rendering them in either mode without further special-casing.
  //
  // Strict skip rules:
  //   - cliSessionId already known to Clay  (avoids duplicate records)
  //   - File has zero user messages         (incomplete / corrupted file)
  //   - Warmup shape: 1 real "hi" prompt, optional automatic interruption,
  //     and 0 assistant messages (covered by daemon cleanup but defensive)
  function adoptOrphanedCliSessions() {
    var files;
    try { files = fs.readdirSync(cliSessionsDir); } catch (e) { return; }

    // Build set of cliSessionIds Clay already tracks
    var knownCliIds = new Set();
    sessions.forEach(function (s) {
      if (s.cliSessionId) knownCliIds.add(s.cliSessionId);
    });

    var adopted = 0;

    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith(".jsonl")) continue;
      var cliSid = files[i].slice(0, -".jsonl".length);
      if (knownCliIds.has(cliSid)) continue;
      if (deletedCliSessionIds.has(cliSid)) continue;

      var fp = path.join(cliSessionsDir, files[i]);
      var events = readCliTranscriptHead(fp);
      if (!events) continue;
      var userCount = 0;
      var firstUserText = null;
      var createdAtIso = null;
      for (var li = 0; li < events.length; li++) {
        var ev = events[li];
        if (ev.type === "user" && ev.message && ev.message.role === "user") {
          userCount++;
          if (firstUserText == null) {
            var c = ev.message.content;
            if (typeof c === "string") {
              firstUserText = c;
            } else if (Array.isArray(c)) {
              var parts = [];
              for (var ci = 0; ci < c.length; ci++) {
                if (c[ci] && c[ci].type === "text" && typeof c[ci].text === "string") parts.push(c[ci].text);
              }
              firstUserText = parts.join("");
            }
            if (ev.timestamp && !createdAtIso) createdAtIso = ev.timestamp;
          }
        }
      }

      if (userCount === 0) continue;
      // Defensive warmup skip (daemon also cleans these)
      if (hygiene.isClaudeWarmupTranscript(events)) continue;

      // Title: first user message trimmed/truncated. Fall back to a
      // neutral label so the sidebar entry is identifiable.
      var title = (firstUserText || "").trim().replace(/\s+/g, " ");
      if (title.length > 60) title = title.slice(0, 57) + "...";
      if (!title) title = "Imported CLI session";

      var createdAt = Date.now();
      if (createdAtIso) {
        var t = Date.parse(createdAtIso);
        if (!isNaN(t)) createdAt = t;
      }
      var lastActivity = createdAt;
      try { lastActivity = fs.statSync(fp).mtimeMs; } catch (e) {}

      var localId = nextLocalId++;
      var session = {
        localId: localId,
        queryInstance: null,
        messageQueue: null,
        cliSessionId: cliSid,
        blocks: {},
        sentToolResults: {},
        pendingPermissions: {},
        pendingAskUser: {},
        isProcessing: false,
        title: title,
        createdAt: createdAt,
        lastActivity: lastActivity,
        history: [],
        messageUUIDs: [],
        lastRewindUuid: null,
        vendor: "claude",
        mode: "tui",
        // Adopted from an external `claude` run in this cwd, not started by
        // Clay. Notification emitters must stay silent for these until the
        // user actually opens them in Clay (a PTY gets attached).
        adopted: true,
        terminalId: null,
        runtimeMode: null,
        runtimeTerminalId: null,
        sessionVisibility: "private",
        bookmarked: false,
        favoriteOrder: null,
      };
      sessions.set(localId, session);
      try { saveSessionFile(session); } catch (e) {}
      knownCliIds.add(cliSid);
      adopted++;
    }

    if (adopted > 0) {
      console.log("[sessions] Adopted " + adopted + " CLI session(s) for " + cwd);
    }
  }

  // Remove rows created by older Clay versions that misclassified an SDK
  // warmup transcript as a real external session. Deletion is tombstoned, so
  // the preserved Claude file cannot be adopted again on the next restart.
  function sweepAdoptedWarmupSessions() {
    var stale = [];
    sessions.forEach(function (session) {
      if (!session.adopted || !session.cliSessionId) return;
      var transcriptPath = path.join(cliSessionsDir, session.cliSessionId + ".jsonl");
      var events = readCliTranscriptHead(transcriptPath);
      var missingEmptySource = !fs.existsSync(transcriptPath) && (!session.history || session.history.length === 0);
      if (missingEmptySource || (events && hygiene.isClaudeWarmupTranscript(events))) stale.push(session.localId);
    });
    for (var i = 0; i < stale.length; i++) deleteSessionQuiet(stale[i]);
    if (stale.length > 0) {
      console.log("[sessions] Removed " + stale.length + " adopted SDK warmup session(s) for " + cwd);
    }
  }

  // Delete blank sessions (never used, nothing attached) that have sat
  // untouched past the grace period. Runs at startup and on new_session.
  function sweepBlankSessions() {
    var stale = hygiene.collectStaleBlankSessions(sessions, activeSessionId, Date.now());
    for (var i = 0; i < stale.length; i++) deleteSessionQuiet(stale[i]);
    if (stale.length > 0) {
      console.log("[sessions] Swept " + stale.length + " stale blank session(s) for " + cwd);
      broadcastSessionList();
    }
    return stale.length;
  }

  function findReusableBlankSession(opts) {
    return hygiene.findReusableBlankSession(sessions, opts);
  }

  // Load persisted sessions from disk, then adopt any orphan CLI sessions
  loadSessions();
  sweepAdoptedWarmupSessions();
  adoptOrphanedCliSessions();
  sweepBlankSessions();

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
      // Sidebar badge: user work only. Ambient housekeeping is surfaced in the
      // composer's expanded list, never as a count demanding attention.
      backgroundTaskCount: backgroundTaskTiming.countUserTasks(s.activeBackgroundTasks),
      lastActivity: s.lastActivity || s.createdAt || 0,
      loop: loop,
      spawn: s.spawn || null,
      ownerId: s.ownerId || null,
      sessionVisibility: sessionVisibility.normalize(s.sessionVisibility),
      bookmarked: !!s.bookmarked,
      favoriteOrder: typeof s.favoriteOrder === "number" ? s.favoriteOrder : null,
      unread: unreadMap[s.localId] || 0,
      vendor: s.vendor || null,
      model: s.model || null,
      effort: s.effort || null,
      mode: s.mode || "gui",
      terminalId: typeof s.terminalId === "number" ? s.terminalId : null,
      runtimeMode: s.runtimeMode || null,
      runtimeTerminalId: typeof s.runtimeTerminalId === "number" ? s.runtimeTerminalId : null,
      dangerouslySkipPermissions: !!s.dangerouslySkipPermissions,
      permissionMode: s.permissionMode || null,
    };
  }

  function mapSessionsForClient(source, clientActiveId, wsUnread) {
    var hierarchy = sessionProvenance.hierarchyFor(source);
    return source.map(function (session) {
      var mapped = mapSessionForClient(session, clientActiveId, wsUnread);
      var node = hierarchy[session.localId];
      mapped.sessionRole = node.role;
      mapped.parentSessionId = node.parentSessionId;
      mapped.parentAvailable = node.parentAvailable;
      mapped.workerGeneration = node.generation;
      return mapped;
    });
  }

  function getVisibleSessions() {
    var multiUser = users.isMultiUser();
    return [...sessions.values()].filter(function (s) {
      if (s.hidden) return false;
      if (!multiUser) {
        return !s.ownerId;
      }
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
            sessions: mapSessionsForClient(filtered, clientActiveId, wsUnread),
          }));
        }
      });
    } else {
      send({
        type: "session_list",
        sessions: mapSessionsForClient(allVisible),
      });
    }
  }

  function createSession(sessionOpts, targetWs) {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: (sessionOpts && sessionOpts.cliSessionId) || null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: "",
      titleAutoGenerated: false,
      turnCount: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      history: [],
      messageUUIDs: [],
      ownerId: (sessionOpts && sessionOpts.ownerId) || null,
      sessionVisibility: sessionVisibility.normalize(sessionOpts && sessionOpts.sessionVisibility),
      sessionVisibilityExplicit: !!(sessionOpts && sessionOpts.sessionVisibility === "shared"),
      bookmarked: false,
      favoriteOrder: null,
      vendor: (sessionOpts && sessionOpts.vendor) || null,
      model: (sessionOpts && sessionOpts.model) || null,
      effort: (sessionOpts && sessionOpts.effort) || null,
      mode: (sessionOpts && sessionOpts.mode === "tui") ? "tui" : "gui",
      dangerouslySkipPermissions: !!(sessionOpts && sessionOpts.mode === "tui" && sessionOpts.dangerouslySkipPermissions),
      permissionMode: (sessionOpts && sessionOpts.permissionMode) || null,
      permissionModeBeforeFullAccess: null,
      terminalId: null,
      sessionOriginId: null,
    };
    sessionProvenance.ensureOrigin(session);
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
      cliSessionId: (sessionOpts && sessionOpts.cliSessionId) || null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: "",
      titleAutoGenerated: false,
      turnCount: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      history: [],
      messageUUIDs: [],
      ownerId: (sessionOpts && sessionOpts.ownerId) || null,
      sessionVisibility: sessionVisibility.normalize(sessionOpts && sessionOpts.sessionVisibility),
      sessionVisibilityExplicit: !!(sessionOpts && sessionOpts.sessionVisibility === "shared"),
      bookmarked: false,
      favoriteOrder: null,
      vendor: (sessionOpts && sessionOpts.vendor) || null,
      model: (sessionOpts && sessionOpts.model) || null,
      effort: (sessionOpts && sessionOpts.effort) || null,
      mode: (sessionOpts && sessionOpts.mode === "tui") ? "tui" : "gui",
      dangerouslySkipPermissions: !!(sessionOpts && sessionOpts.mode === "tui" && sessionOpts.dangerouslySkipPermissions),
      permissionMode: (sessionOpts && sessionOpts.permissionMode) || null,
      permissionModeBeforeFullAccess: null,
      terminalId: null,
      sessionOriginId: null,
    };
    sessionProvenance.ensureOrigin(session);
    sessions.set(localId, session);
    return session;
  }

  // Initial replay payload size. Lowered from 200 to reduce client-side
  // layout work on resume — older items are loaded progressively on
  // scroll-up via the existing pagination path.
  var HISTORY_PAGE_SIZE = 100;

  function findTurnBoundary(history, targetIndex) {
    for (var i = targetIndex; i >= 0; i--) {
      if (history[i] && history[i].type === "user_message") return i;
    }
    return 0;
  }

  function replayHistory(session, fromIndex, targetWs, transform) {
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
      var _item = session.history[i];
      // Skip internal bookkeeping entries not meant for the UI
      if (_item && _item.type === "digest_checkpoint") continue;
      if (_item && (_item.type === "mention_user" || _item.type === "mention_response")) {
        console.log("[DEBUG replayHistory] sending mention at index=" + i + " from=" + fromIndex + " total=" + total + " type=" + _item.type + " mate=" + (_item.mateName || ""));
      }
      _send(transform ? transform(_item) : _item);
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

    _send({ type: "history_done", lastUsage: lastUsage, lastModelUsage: lastModelUsage, lastCost: lastCost, lastStreamInputTokens: lastStreamInputTokens, contextUsage: session.lastContextUsage || null });
  }

  function switchSession(localId, targetWs, transform) {
    var session = sessions.get(localId);
    if (!session) return;

    // Pane sockets (split-view iframes) pin their session via switch_session
    // but must not move the project-global active pointer: reloads and
    // session_list "active" flags would otherwise follow whichever pane
    // pinned last instead of what the user is actually looking at.
    if (!(targetWs && targetWs._clayPane)) activeSessionId = localId;
    if (targetWs) {
      targetWs._clayActiveSession = localId;
      // Clear unread for this session (multi-user)
      if (targetWs._clayUnread) targetWs._clayUnread[localId] = 0;
    } else if (sendEach) {
      // No specific target: update all connected clients (server-initiated switch)
      sendEach(function (ws) {
        ws._clayActiveSession = localId;
      });
    }
    // Clear unread for single-user mode
    singleUserUnread[localId] = 0;

    // In multi-user mode with a specific client, only send to that client
    var _send = (targetWs && sendTo) ? function (obj) { sendTo(targetWs, obj); } : send;

    var _capsByVendor = capabilitiesByVendor || {};
    var _sessionVendor = session.vendor || defaultVendor || "claude";
    var _vendorCaps = _capsByVendor[_sessionVendor] || {};
    _send({ type: "session_switched", id: localId, cliSessionId: session.cliSessionId || null, loop: session.loop || null, vendor: session.vendor || null, model: session.model || null, effort: session.effort || null, hasHistory: (session.history && session.history.length > 0), capabilities: _vendorCaps, isProcessing: !!session.isProcessing, mode: session.mode || "gui", terminalId: typeof session.terminalId === "number" ? session.terminalId : null, runtimeMode: session.runtimeMode || null, runtimeTerminalId: typeof session.runtimeTerminalId === "number" ? session.runtimeTerminalId : null, tuiSuspended: !!session.tuiSuspended, dangerouslySkipPermissions: !!session.dangerouslySkipPermissions, permissionMode: session.permissionMode || null });
    // Send vendor-specific slash commands
    var _vendorCmds = slashCommandsByVendor[_sessionVendor] || slashCommands || [];
    _send({ type: "slash_commands", commands: _vendorCmds, vendor: _sessionVendor });
    broadcastSessionList();
    replayHistory(session, undefined, targetWs, transform);

    if (session.isProcessing) {
      _send({ type: "status", status: "processing" });
    }
    _send({ type: "active_background_tasks", tasks: session.activeBackgroundTasks || [] });

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

    // Re-send active mention indicator so returning clients restore the mate avatar state
    if (session._mentionInProgress && session._mentionActiveMateId) {
      _send({ type: "mention_processing", mateId: session._mentionActiveMateId, active: true });
    }
  }

  function cleanupMentionSessions(session) {
    if (session._mentionSessions) {
      var mateIds = Object.keys(session._mentionSessions);
      for (var mi = 0; mi < mateIds.length; mi++) {
        try { session._mentionSessions[mateIds[mi]].close(); } catch (e) {}
      }
      session._mentionSessions = {};
    }
  }

  function deleteSession(localId, targetWs) {
    var session = sessions.get(localId);
    if (!session) return;

    // Clean up unread tracking
    delete singleUserUnread[localId];

    cleanupMentionSessions(session);

    if (session.abortController) {
      try { session.abortController.abort(); } catch(e) {}
    }
    // Close SDK query to terminate the underlying claude child process
    if (session.queryInstance && typeof session.queryInstance.close === "function") {
      try { session.queryInstance.close(); } catch(e) {}
    }
    session.queryInstance = null;
    if (session.messageQueue) {
      try { session.messageQueue.end(); } catch(e) {}
    }
    if (session.worker) {
      try { session.worker.kill(); } catch(e) {}
      session.worker = null;
    }

    if (session.cliSessionId) {
      rememberDeletedCliSession(session.cliSessionId);
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }

    sessions.delete(localId);
    try { onSessionDeleted(localId); } catch (e) {
      console.error("[session] Session deletion hook failed:", e.message || e);
    }

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
    cleanupMentionSessions(session);
    if (session.abortController) {
      try { session.abortController.abort(); } catch(e) {}
    }
    // Close SDK query to terminate the underlying claude child process
    if (session.queryInstance && typeof session.queryInstance.close === "function") {
      try { session.queryInstance.close(); } catch(e) {}
    }
    session.queryInstance = null;
    if (session.messageQueue) {
      try { session.messageQueue.end(); } catch(e) {}
    }
    if (session.worker) {
      try { session.worker.kill(); } catch(e) {}
      session.worker = null;
    }
    if (session.cliSessionId) {
      rememberDeletedCliSession(session.cliSessionId);
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }
    sessions.delete(localId);
    try { onSessionDeleted(localId); } catch (e) {
      console.error("[session] Session deletion hook failed:", e.message || e);
    }
  }

  function deleteSessionsBulk(localIds, targetWs) {
    if (!Array.isArray(localIds) || localIds.length === 0) return;

    var seen = {};
    var ids = [];
    for (var i = 0; i < localIds.length; i++) {
      var id = localIds[i];
      if (typeof id !== "number" || seen[id] || !sessions.has(id)) continue;
      seen[id] = true;
      ids.push(id);
    }
    if (ids.length === 0) return;

    var deletedActive = false;
    for (var j = 0; j < ids.length; j++) {
      if (ids[j] === activeSessionId) deletedActive = true;
      deleteSessionQuiet(ids[j]);
    }

    if (sessions.size === 0) {
      createSession(null, targetWs);
      return;
    }

    if (deletedActive) {
      var remaining = [...sessions.keys()];
      switchSession(remaining[remaining.length - 1], targetWs);
    } else {
      broadcastSessionList();
    }
  }

  function doSendToSession(session, obj) {
    // Send to active clients without recording to history/disk (ephemeral data)
    if (sendEach) {
      var data = JSON.stringify(obj);
      sendEach(function (ws, filterFn) {
        if (filterFn && !filterFn(session)) return;
        if (session.homeDebatePlanning === true) return;
        if (ws._clayActiveSession === session.localId && ws.readyState === 1) {
          ws.send(data);
        }
      });
    } else if (session.localId === activeSessionId) {
      send(obj);
    }
  }

  function doSendAndRecord(session, obj, clientObj) {
    // Stamp every recorded message so history replay preserves original times
    if (!obj._ts) obj._ts = Date.now();
    var outgoingObj = clientObj || obj;
    if (!outgoingObj._ts) outgoingObj._ts = obj._ts;
    session.history.push(obj);
    appendToSessionFile(session, obj);
    // Per-session out-of-band subscribers mirror mate session events into
    // a parallel UI without joining the project's
    // ws clients set). Subscribers receive the same obj that goes to ws
    // clients; they are responsible for any transform + dispatch.
    if (session._subscribers && session._subscribers.size > 0) {
      for (var sub of session._subscribers) {
        try { sub(outgoingObj); } catch (e) { /* swallow — subscriber is optional */ }
      }
    }
    if (sendEach) {
      // Multi-user: send to clients whose active session matches this one
      var data = JSON.stringify(outgoingObj);
      var ioData = null;
      sendEach(function (ws, filterFn) {
        if (filterFn && !filterFn(session)) return;
        if (session.homeDebatePlanning === true) return;
        if (ws._clayActiveSession === session.localId) {
          if (ws.readyState === 1) ws.send(data);
        } else if (session.isProcessing && !session._ioThrottle) {
          if (!ioData) ioData = JSON.stringify({ type: "session_io", id: session.localId });
          if (ws.readyState === 1) ws.send(ioData);
        }
        // Track unread: increment on "done" for clients not viewing this session
        // Only count if session has no owner (my session) or owner matches this client
        if (outgoingObj.type === "done" && ws._clayActiveSession !== session.localId) {
          var _isMySession = !session.ownerId || (ws._clayUser && ws._clayUser.id === session.ownerId);
          if (_isMySession) {
            if (!ws._clayUnread) ws._clayUnread = {};
            ws._clayUnread[session.localId] = (ws._clayUnread[session.localId] || 0) + 1;
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "session_unread", id: session.localId, count: ws._clayUnread[session.localId] }));
            }
          }
        }
      });
      if (session.isProcessing && !session._ioThrottle && ioData) {
        session._ioThrottle = true;
        setTimeout(function () { session._ioThrottle = false; }, 80);
      }
    } else if (session.localId === activeSessionId) {
      send(outgoingObj);
    } else {
      // Track unread for single-user mode on "done"
      if (outgoingObj.type === "done") {
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
    if (obj.type === "done") onSessionDone(session);
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
      lastActivity: Date.now(),
      history: cliHistory,
      messageUUIDs: [],
      bookmarked: false,
      favoriteOrder: null,
    };
    if (opts && opts.vendor) session.vendor = opts.vendor;
    if (opts && opts.ownerId) session.ownerId = opts.ownerId;
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

  function searchSessions(query, canInclude) {
    if (!query) return [];
    var q = query.toLowerCase();
    var results = [];
    sessions.forEach(function (session) {
      if (typeof canInclude === "function" && !canInclude(session)) return;
      var titleMatch = (session.title || "New Session").toLowerCase().indexOf(q) !== -1;
      var contentMatch = false;
      for (var i = 0; i < session.history.length; i++) {
        var entry = session.history[i];
        if ((entry.type === "delta" || entry.type === "user_message" || entry.type === "mention_user" || entry.type === "mention_response" || entry.type === "debate_turn_done" || entry.type === "debate_comment_injected") && entry.text) {
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
    var qLen = query.length;
    var history = session.history;
    var hits = [];

    // Assistant turns can consist of many streaming deltas (especially Codex,
    // where agentMessage/delta fragments arrive in small chunks). We accumulate
    // delta text per turn, scan for ALL occurrences of the query across the
    // accumulated buffer, then map each occurrence back to the historyIndex of
    // the delta that contains its starting offset. This catches multiple
    // matches within a single turn and also matches that straddle delta
    // boundaries.
    var turnBuffer = "";
    var turnSegments = []; // [{ start, end, historyIndex, ts }]

    function pushScalarHits(text, historyIndex, role, ts) {
      if (!text) return;
      var lower = text.toLowerCase();
      var from = 0;
      while (true) {
        var idx = lower.indexOf(q, from);
        if (idx === -1) break;
        var s = Math.max(0, idx - 15);
        var e = Math.min(text.length, idx + qLen + 15);
        var snippet = (s > 0 ? "\u2026" : "") + text.substring(s, e) + (e < text.length ? "\u2026" : "");
        hits.push({ historyIndex: historyIndex, snippet: snippet, role: role, ts: ts });
        from = idx + qLen;
      }
    }

    function flushTurn() {
      if (!turnBuffer || turnSegments.length === 0) {
        turnBuffer = "";
        turnSegments = [];
        return;
      }
      var lowerBuf = turnBuffer.toLowerCase();
      var from = 0;
      var segCursor = 0;
      while (true) {
        var idx = lowerBuf.indexOf(q, from);
        if (idx === -1) break;
        // Advance segCursor to the segment containing idx.
        while (segCursor < turnSegments.length - 1 && turnSegments[segCursor].end <= idx) {
          segCursor++;
        }
        var seg = turnSegments[segCursor];
        var s = Math.max(0, idx - 15);
        var e = Math.min(turnBuffer.length, idx + qLen + 15);
        var snippet = (s > 0 ? "\u2026" : "") + turnBuffer.substring(s, e) + (e < turnBuffer.length ? "\u2026" : "");
        hits.push({ historyIndex: seg.historyIndex, snippet: snippet, role: "assistant", ts: seg.ts });
        from = idx + qLen;
      }
      turnBuffer = "";
      turnSegments = [];
    }

    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      var t = entry.type;
      if (t === "user_message" || t === "mention_user") {
        flushTurn();
        pushScalarHits(entry.text, i, t === "user_message" ? "user" : "assistant", entry._ts || null);
      } else if (t === "delta" && entry.text) {
        turnSegments.push({
          start: turnBuffer.length,
          end: turnBuffer.length + entry.text.length,
          historyIndex: i,
          ts: entry._ts || null,
        });
        turnBuffer += entry.text;
      } else if ((t === "mention_response" || t === "debate_turn_done" || t === "debate_comment_injected") && entry.text) {
        flushTurn();
        pushScalarHits(entry.text, i, "assistant", entry._ts || null);
      }
    }
    flushTurn();
    return { hits: hits, total: history.length };
  }

  var _migrationFailedIds = {};
  function migrateSessionTitles(adapter, migrateCwd) {
    var candidates = [];
    sessions.forEach(function(s) {
      if (s.cliSessionId && s.title && s.title !== "New Session" && s.title !== "Resumed session"
          && !_migrationFailedIds[s.cliSessionId]) {
        candidates.push({ cliSessionId: s.cliSessionId, title: s.title });
      }
    });
    if (candidates.length === 0) return;
    adapter.listSessions({ dir: migrateCwd }).then(function(sdkSessions) {
      var sdkTitles = {};
      for (var i = 0; i < sdkSessions.length; i++) {
        if (sdkSessions[i].customTitle) {
          sdkTitles[sdkSessions[i].sessionId] = sdkSessions[i].customTitle;
        }
      }
      var toMigrate = candidates.filter(function(item) {
        var relayTitle = (item.title || "").trim();
        var sdkTitle = (sdkTitles[item.cliSessionId] || "").trim();
        return sdkTitle !== relayTitle;
      });
      if (toMigrate.length === 0) return;
      var migrated = 0;
      var failed = 0;
      var chain = Promise.resolve();
      for (var j = 0; j < toMigrate.length; j++) {
        (function(item) {
          chain = chain.then(function() {
            return adapter.renameSession(item.cliSessionId, item.title.trim(), { dir: migrateCwd }).then(function() {
              migrated++;
            }).catch(function(e) {
              failed++;
              _migrationFailedIds[item.cliSessionId] = true;
            });
          });
        })(toMigrate[j]);
      }
      chain.then(function() {
        if (migrated > 0) {
          console.log("[session] Migrated " + migrated + " session title(s) to SDK format");
        }
        if (failed > 0) {
          console.log("[session] Skipped " + failed + " session(s) (CLI session not found for current user)");
        }
      }).catch(function(e) {
        console.error("[session] Migration chain failed:", e.message || e);
      });
    }).catch(function() {});
  }

  return {
    get activeSessionId() { return activeSessionId; },
    get nextLocalId() { return nextLocalId; },
    get slashCommands() { return slashCommands; },
    set slashCommands(v) { slashCommands = v; },
    get slashCommandsByVendor() { return slashCommandsByVendor; },
    setSlashCommandsForVendor: function(vendor, cmds) {
      slashCommandsByVendor[vendor] = cmds || [];
    },
    getSlashCommandsForVendor: function(vendor) {
      return slashCommandsByVendor[vendor] || [];
    },
    get skillNames() { return skillNames; },
    set skillNames(v) { skillNames = v; },
    get capabilitiesByVendor() { return capabilitiesByVendor; },
    set capabilitiesByVendor(v) { capabilitiesByVendor = v; },
    get defaultVendor() { return defaultVendor; },
    set defaultVendor(v) { defaultVendor = v; },
    get codexApproval() { return codexApproval; },
    set codexApproval(v) { codexApproval = v; },
    get codexSandbox() { return codexSandbox; },
    set codexSandbox(v) { codexSandbox = v; },
    get codexWebSearch() { return codexWebSearch; },
    set codexWebSearch(v) { codexWebSearch = v; },
    sessions: sessions,
    sessionsDir: sessionsDir,
    setOnSessionDeleted: function (fn) { onSessionDeleted = fn || function () {}; },
    setOnSessionRenamed: function (fn) { onSessionRenamed = fn || function () {}; },
    setOnSessionIdentityAssigned: function (fn) { onSessionIdentityAssigned = fn || function () {}; },
    notifySessionRenamed: function (localId) { onSessionRenamed(localId); },
    notifySessionIdentityAssigned: function (localId) { onSessionIdentityAssigned(localId); },
    HISTORY_PAGE_SIZE: HISTORY_PAGE_SIZE,
    getActiveSession: getActiveSession,
    createSession: createSession,
    createSessionRaw: createSessionRaw,
    switchSession: switchSession,
    deleteSession: deleteSession,
    deleteSessionQuiet: deleteSessionQuiet,
    deleteSessionsBulk: deleteSessionsBulk,
    sweepBlankSessions: sweepBlankSessions,
    findReusableBlankSession: findReusableBlankSession,
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
    subscribeSession: function (localId, cb) {
      var session = sessions.get(localId);
      if (!session) return null;
      if (!session._subscribers) session._subscribers = new Set();
      session._subscribers.add(cb);
      return function unsubscribe() {
        if (session._subscribers) session._subscribers.delete(cb);
      };
    },
    sendToSession: doSendToSession,
    findTurnBoundary: findTurnBoundary,
    replayHistory: replayHistory,
    searchSessions: searchSessions,
    searchSessionContent: searchSessionContent,
    setResolveLoopInfo: setResolveLoopInfo,
    mapSessionForClient: mapSessionForClient,
    mapSessionsForClient: mapSessionsForClient,
    migrateSessionTitles: migrateSessionTitles,
    setSessionVisibility: function (localId, visibility) {
      var session = sessions.get(localId);
      if (!session) return { error: "Session not found" };
      if (visibility !== "shared" && visibility !== "private") return { error: "Invalid session visibility" };
      session.sessionVisibility = visibility;
      session.sessionVisibilityExplicit = true;
      saveSessionFile(session);
      broadcastSessionList();
      return { ok: true };
    },
    setSessionBookmarked: function (localId, bookmarked) {
      var session = sessions.get(localId);
      if (!session) return { error: "Session not found" };
      session.bookmarked = !!bookmarked;
      if (session.bookmarked) {
        var maxOrder = -1;
        sessions.forEach(function (s) {
          if (s.bookmarked && typeof s.favoriteOrder === "number" && s.favoriteOrder > maxOrder) {
            maxOrder = s.favoriteOrder;
          }
        });
        session.favoriteOrder = maxOrder + 1;
      } else {
        session.favoriteOrder = null;
      }
      saveSessionFile(session);
      broadcastSessionList();
      return { ok: true };
    },
    reorderBookmarkedSessions: function (sourceId, targetId, insertBefore) {
      var source = sessions.get(sourceId);
      var target = sessions.get(targetId);
      if (!source || !target) return { error: "Session not found" };
      if (!source.bookmarked || !target.bookmarked) return { error: "Only favorites can be reordered" };

      var favorites = [];
      sessions.forEach(function (s) {
        if (s.bookmarked) favorites.push(s);
      });
      favorites.sort(function (a, b) {
        var ao = typeof a.favoriteOrder === "number" ? a.favoriteOrder : Number.MAX_SAFE_INTEGER;
        var bo = typeof b.favoriteOrder === "number" ? b.favoriteOrder : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return (b.lastActivity || 0) - (a.lastActivity || 0);
      });

      var reordered = [];
      for (var i = 0; i < favorites.length; i++) {
        if (favorites[i].localId !== sourceId) reordered.push(favorites[i]);
      }

      var targetIdx = -1;
      for (var j = 0; j < reordered.length; j++) {
        if (reordered[j].localId === targetId) {
          targetIdx = j;
          break;
        }
      }
      if (targetIdx === -1) return { error: "Target favorite not found" };
      if (!insertBefore) targetIdx++;
      reordered.splice(targetIdx, 0, source);

      for (var k = 0; k < reordered.length; k++) {
        reordered[k].favoriteOrder = k;
        saveSessionFile(reordered[k]);
      }
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
    permissionRequestIndex: permissionRequestIndex,
  };
}

module.exports = { createSessionManager };
