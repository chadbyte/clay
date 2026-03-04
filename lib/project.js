var fs = require("fs");
var path = require("path");
var { createSessionManager } = require("./sessions");
var { createSDKBridge } = require("./sdk-bridge");
var { createTerminalManager } = require("./terminal-manager");
var { createNotesManager } = require("./notes");
var { fetchLatestVersion, isNewer } = require("./updater");
var { execFileSync } = require("child_process");

// SDK loaded dynamically (ESM module)
var sdkModule = null;
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
}

// --- Shared constants ---
var IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "__pycache__", ".cache", "dist", "build", ".clay", ".claude-relay"]);
var BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".pyc", ".o", ".a", ".class",
]);
var IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
var FS_MAX_SIZE = 512 * 1024;
var MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function safePath(base, requested) {
  var resolved = path.resolve(base, requested);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  try {
    var real = fs.realpathSync(resolved);
    if (real !== base && !real.startsWith(base + path.sep)) return null;
    return real;
  } catch (e) {
    return null;
  }
}

/**
 * Create a project context — per-project state and handlers.
 * opts: { cwd, slug, title, pushModule, debug, dangerouslySkipPermissions, currentVersion }
 */
function createProjectContext(opts) {
  var cwd = opts.cwd;
  var slug = opts.slug;
  var project = path.basename(cwd);
  var title = opts.title || null;
  var pushModule = opts.pushModule || null;
  var debug = opts.debug || false;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var currentVersion = opts.currentVersion;
  var lanHost = opts.lanHost || null;
  var getProjectCount = opts.getProjectCount || function () { return 1; };
  var getProjectList = opts.getProjectList || function () { return []; };
  var latestVersion = null;

  // --- Per-project clients ---
  var clients = new Set();

  function send(obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  function sendTo(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function broadcastClientCount() {
    send({ type: "client_count", count: clients.size });
  }

  function sendToOthers(sender, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws !== sender && ws.readyState === 1) ws.send(data);
    }
  }

  // --- File watcher ---
  var fileWatcher = null;
  var watchedPath = null;
  var watchDebounce = null;

  function startFileWatch(relPath) {
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    if (watchedPath === relPath) return;
    stopFileWatch();
    watchedPath = relPath;
    try {
      fileWatcher = fs.watch(absPath, function () {
        clearTimeout(watchDebounce);
        watchDebounce = setTimeout(function () {
          try {
            var stat = fs.statSync(absPath);
            var ext = path.extname(absPath).toLowerCase();
            if (stat.size > FS_MAX_SIZE || BINARY_EXTS.has(ext)) return;
            var content = fs.readFileSync(absPath, "utf8");
            send({ type: "fs_file_changed", path: relPath, content: content, size: stat.size });
          } catch (e) {
            stopFileWatch();
          }
        }, 200);
      });
      fileWatcher.on("error", function () { stopFileWatch(); });
    } catch (e) {
      watchedPath = null;
    }
  }

  function stopFileWatch() {
    if (fileWatcher) {
      try { fileWatcher.close(); } catch (e) {}
      fileWatcher = null;
    }
    clearTimeout(watchDebounce);
    watchDebounce = null;
    watchedPath = null;
  }

  // --- Directory watcher ---
  var dirWatchers = {};  // relPath -> { watcher, debounce }

  function startDirWatch(relPath) {
    if (dirWatchers[relPath]) return;
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    try {
      var debounce = null;
      var watcher = fs.watch(absPath, function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          // Re-read directory and broadcast to all clients
          try {
            var items = fs.readdirSync(absPath, { withFileTypes: true });
            var entries = [];
            for (var i = 0; i < items.length; i++) {
              if (items[i].isDirectory() && IGNORED_DIRS.has(items[i].name)) continue;
              entries.push({
                name: items[i].name,
                type: items[i].isDirectory() ? "dir" : "file",
                path: path.relative(cwd, path.join(absPath, items[i].name)).split(path.sep).join("/"),
              });
            }
            send({ type: "fs_dir_changed", path: relPath, entries: entries });
          } catch (e) {
            stopDirWatch(relPath);
          }
        }, 300);
      });
      watcher.on("error", function () { stopDirWatch(relPath); });
      dirWatchers[relPath] = { watcher: watcher, debounce: debounce };
    } catch (e) {}
  }

  function stopDirWatch(relPath) {
    var entry = dirWatchers[relPath];
    if (entry) {
      clearTimeout(entry.debounce);
      try { entry.watcher.close(); } catch (e) {}
      delete dirWatchers[relPath];
    }
  }

  function stopAllDirWatches() {
    var paths = Object.keys(dirWatchers);
    for (var i = 0; i < paths.length; i++) {
      stopDirWatch(paths[i]);
    }
  }

  // --- Session manager ---
  var sm = createSessionManager({ cwd: cwd, send: send });
  sm.currentPermissionMode = "default";
  sm.currentEffort = "high";

  // --- SDK bridge ---
  var sdk = createSDKBridge({
    cwd: cwd,
    slug: slug,
    sessionManager: sm,
    send: send,
    pushModule: pushModule,
    getSDK: getSDK,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
  });

  // --- Terminal manager ---
  var tm = createTerminalManager({ cwd: cwd, send: send, sendTo: sendTo });
  var nm = createNotesManager({ cwd: cwd, send: send, sendTo: sendTo });

  // Check for updates in background
  fetchLatestVersion().then(function (v) {
    if (v && isNewer(v, currentVersion)) {
      latestVersion = v;
      send({ type: "update_available", version: v });
    }
  });

  // --- WS connection handler ---
  function handleConnection(ws) {
    clients.add(ws);
    broadcastClientCount();

    // Send cached state
    sendTo(ws, { type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, dangerouslySkipPermissions: dangerouslySkipPermissions, lanHost: lanHost, projectCount: getProjectCount(), projects: getProjectList() });
    if (latestVersion) {
      sendTo(ws, { type: "update_available", version: latestVersion });
    }
    if (sm.slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: sm.slashCommands });
    }
    if (sm.currentModel) {
      sendTo(ws, { type: "model_info", model: sm.currentModel, models: sm.availableModels || [] });
    }
    sendTo(ws, { type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "high" });
    sendTo(ws, { type: "term_list", terminals: tm.list() });
    sendTo(ws, { type: "notes_list", notes: nm.list() });

    // Session list
    sendTo(ws, {
      type: "session_list",
      sessions: [].concat(Array.from(sm.sessions.values())).map(function (s) {
        return {
          id: s.localId,
          cliSessionId: s.cliSessionId || null,
          title: s.title || "New Session",
          active: s.localId === sm.activeSessionId,
          isProcessing: s.isProcessing,
          lastActivity: s.lastActivity || s.createdAt || 0,
        };
      }),
    });

    // Restore active session for this client
    var active = sm.getActiveSession();
    if (active) {
      sendTo(ws, { type: "session_switched", id: active.localId, cliSessionId: active.cliSessionId || null });

      var total = active.history.length;
      var fromIndex = 0;
      if (total > sm.HISTORY_PAGE_SIZE) {
        fromIndex = sm.findTurnBoundary(active.history, Math.max(0, total - sm.HISTORY_PAGE_SIZE));
      }
      sendTo(ws, { type: "history_meta", total: total, from: fromIndex });
      for (var i = fromIndex; i < total; i++) {
        sendTo(ws, active.history[i]);
      }
      sendTo(ws, { type: "history_done" });

      if (active.isProcessing) {
        sendTo(ws, { type: "status", status: "processing" });
      }
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
        });
      }
    }

    ws.on("message", function (raw) {
      var msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      handleMessage(ws, msg);
    });

    ws.on("close", function () {
      handleDisconnection(ws);
    });
  }

  // --- WS message handler ---
  function handleMessage(ws, msg) {
    if (msg.type === "push_subscribe") {
      if (pushModule && msg.subscription) pushModule.addSubscription(msg.subscription, msg.replaceEndpoint);
      return;
    }

    if (msg.type === "load_more_history") {
      var session = sm.getActiveSession();
      if (!session || typeof msg.before !== "number") return;
      var before = msg.before;
      var from = sm.findTurnBoundary(session.history, Math.max(0, before - sm.HISTORY_PAGE_SIZE));
      var to = before;
      var items = session.history.slice(from, to);
      sendTo(ws, {
        type: "history_prepend",
        items: items,
        meta: { from: from, to: to, hasMore: from > 0 },
      });
      return;
    }

    if (msg.type === "new_session") {
      sm.createSession();
      return;
    }

    if (msg.type === "resume_session") {
      if (!msg.cliSessionId) return;
      var cliSess = require("./cli-sessions");
      cliSess.readCliSessionHistory(cwd, msg.cliSessionId).then(function (history) {
        var title = "Resumed session";
        for (var i = 0; i < history.length; i++) {
          if (history[i].type === "user_message" && history[i].text) {
            title = history[i].text.substring(0, 50);
            break;
          }
        }
        sm.resumeSession(msg.cliSessionId, { history: history, title: title });
      }).catch(function () {
        sm.resumeSession(msg.cliSessionId);
      });
      return;
    }

    if (msg.type === "list_cli_sessions") {
      var cliSessions = require("./cli-sessions");
      var _fs = require("fs");
      var _path = require("path");
      // Collect session IDs already in relay (in-memory + persisted on disk)
      var relayIds = {};
      sm.sessions.forEach(function (s) {
        if (s.cliSessionId) relayIds[s.cliSessionId] = true;
      });
      try {
        var sessDir = sm.sessionsDir;
        var diskFiles = _fs.readdirSync(sessDir);
        for (var fi = 0; fi < diskFiles.length; fi++) {
          if (diskFiles[fi].endsWith(".jsonl")) {
            relayIds[diskFiles[fi].replace(".jsonl", "")] = true;
          }
        }
      } catch (e) {}
      cliSessions.listCliSessions(cwd).then(function (sessions) {
        var filtered = sessions.filter(function (s) {
          return !relayIds[s.sessionId];
        });
        sendTo(ws, { type: "cli_session_list", sessions: filtered });
      }).catch(function () {
        sendTo(ws, { type: "cli_session_list", sessions: [] });
      });
      return;
    }


    if (msg.type === "switch_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        sm.switchSession(msg.id);
      }
      return;
    }

    if (msg.type === "delete_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        sm.deleteSession(msg.id);
      }
      return;
    }

    if (msg.type === "rename_session") {
      if (msg.id && sm.sessions.has(msg.id) && msg.title) {
        var s = sm.sessions.get(msg.id);
        s.title = String(msg.title).substring(0, 100);
        sm.saveSessionFile(s);
        sm.broadcastSessionList();
      }
      return;
    }

    if (msg.type === "search_sessions") {
      var results = sm.searchSessions(msg.query || "");
      sendTo(ws, { type: "search_results", query: msg.query || "", results: results });
      return;
    }

    if (msg.type === "check_update") {
      fetchLatestVersion().then(function (v) {
        if (v && isNewer(v, currentVersion)) {
          latestVersion = v;
          sendTo(ws, { type: "update_available", version: v });
        }
      }).catch(function () {});
      return;
    }

    if (msg.type === "update_now") {
      send({ type: "update_started", version: latestVersion || "" });
      var _ipc = require("./ipc");
      var _config = require("./config");
      _ipc.sendIPCCommand(_config.socketPath(), { cmd: "update" });
      return;
    }

    if (msg.type === "process_stats") {
      var sessionCount = sm.sessions.size;
      var processingCount = 0;
      sm.sessions.forEach(function (s) {
        if (s.isProcessing) processingCount++;
      });
      var mem = process.memoryUsage();
      sendTo(ws, {
        type: "process_stats",
        pid: process.pid,
        uptime: process.uptime(),
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
        },
        sessions: sessionCount,
        processing: processingCount,
        clients: clients.size,
        terminals: tm.list().length,
      });
      return;
    }

    if (msg.type === "stop") {
      var session = sm.getActiveSession();
      if (session && session.abortController && session.isProcessing) {
        session.abortController.abort();
      }
      return;
    }


    if (msg.type === "stop_task") {
      if (msg.taskId) {
        sdk.stopTask(msg.taskId);
      }
      return;
    }

    if (msg.type === "kill_process") {
      var pid = msg.pid;
      if (!pid || typeof pid !== "number") return;
      // Verify target is actually a claude process before killing
      if (!sdk.isClaudeProcess(pid)) {
        console.error("[project] Refused to kill PID " + pid + ": not a claude process");
        send({ type: "error", text: "Process " + pid + " is not a Claude process." });
        return;
      }
      try {
        process.kill(pid, "SIGTERM");
        console.log("[project] Sent SIGTERM to conflicting Claude process PID " + pid);
        send({ type: "process_killed", pid: pid });
      } catch (e) {
        console.error("[project] Failed to kill PID " + pid + ":", e.message);
        send({ type: "error", text: "Failed to kill process " + pid + ": " + (e.message || e) });
      }
      return;
    }

    if (msg.type === "set_model" && msg.model) {
      var session = sm.getActiveSession();
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return;
    }

    if (msg.type === "set_permission_mode" && msg.mode) {
      sm.currentPermissionMode = msg.mode;
      var session = sm.getActiveSession();
      if (session) {
        sdk.setPermissionMode(session, msg.mode);
      }
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "high" });
      return;
    }

    if (msg.type === "set_effort" && msg.effort) {
      sm.currentEffort = msg.effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort });
      return;
    }

    if (msg.type === "rewind_preview") {
      var session = sm.getActiveSession();
      if (!session || !session.cliSessionId || !msg.uuid) return;

      (async function () {
        var result;
        try {
          result = await sdk.getOrCreateRewindQuery(session);
          var preview = await result.query.rewindFiles(msg.uuid, { dryRun: true });
          var diffs = {};
          var changedFiles = preview.filesChanged || [];
          for (var f = 0; f < changedFiles.length; f++) {
            try {
              diffs[changedFiles[f]] = execFileSync(
                "git", ["diff", "HEAD", "--", changedFiles[f]],
                { cwd: cwd, encoding: "utf8", timeout: 5000 }
              ) || "";
            } catch (e) { diffs[changedFiles[f]] = ""; }
          }
          sendTo(ws, { type: "rewind_preview_result", preview: preview, diffs: diffs, uuid: msg.uuid });
        } catch (err) {
          sendTo(ws, { type: "rewind_error", text: "Failed to preview rewind: " + err.message });
        } finally {
          if (result && result.isTemp) result.cleanup();
        }
      })();
      return;
    }

    if (msg.type === "rewind_execute") {
      var session = sm.getActiveSession();
      if (!session || !session.cliSessionId || !msg.uuid) return;
      var mode = msg.mode || "both";

      (async function () {
        var result;
        try {
          // File restoration (skip for chat-only mode)
          if (mode !== "chat") {
            result = await sdk.getOrCreateRewindQuery(session);
            await result.query.rewindFiles(msg.uuid, { dryRun: false });
          }

          // Conversation rollback (skip for files-only mode)
          if (mode !== "files") {
            var targetIdx = -1;
            for (var i = 0; i < session.messageUUIDs.length; i++) {
              if (session.messageUUIDs[i].uuid === msg.uuid) {
                targetIdx = i;
                break;
              }
            }

            if (targetIdx >= 0) {
              var trimTo = session.messageUUIDs[targetIdx].historyIndex;
              for (var k = trimTo - 1; k >= 0; k--) {
                if (session.history[k].type === "user_message") {
                  trimTo = k;
                  break;
                }
              }
              session.history = session.history.slice(0, trimTo);
              session.messageUUIDs = session.messageUUIDs.slice(0, targetIdx);
            }

            session.lastRewindUuid = msg.uuid;
          }

          if (session.abortController) {
            try { session.abortController.abort(); } catch (e) {}
          }
          if (session.messageQueue) {
            try { session.messageQueue.end(); } catch (e) {}
          }
          session.queryInstance = null;
          session.messageQueue = null;
          session.abortController = null;
          session.blocks = {};
          session.sentToolResults = {};
          session.pendingPermissions = {};
          session.pendingAskUser = {};
          session.isProcessing = false;

          sm.saveSessionFile(session);
          sm.switchSession(session.localId);
          sm.sendAndRecord(session, { type: "rewind_complete", mode: mode });
          sm.broadcastSessionList();
        } catch (err) {
          send({ type: "rewind_error", text: "Rewind failed: " + err.message });
        } finally {
          if (result && result.isTemp) result.cleanup();
        }
      })();
      return;
    }

    if (msg.type === "ask_user_response") {
      var session = sm.getActiveSession();
      if (!session) return;
      var toolId = msg.toolId;
      var answers = msg.answers || {};
      var pending = session.pendingAskUser[toolId];
      if (!pending) return;
      delete session.pendingAskUser[toolId];
      sm.sendAndRecord(session, { type: "ask_user_answered", toolId: toolId });
      pending.resolve({
        behavior: "allow",
        updatedInput: Object.assign({}, pending.input, { answers: answers }),
      });
      return;
    }

    if (msg.type === "input_sync") {
      sendToOthers(ws, msg);
      return;
    }

    if (msg.type === "permission_response") {
      var session = sm.getActiveSession();
      if (!session) return;
      var requestId = msg.requestId;
      var decision = msg.decision;
      var pending = session.pendingPermissions[requestId];
      if (!pending) return;
      delete session.pendingPermissions[requestId];

      // --- Plan approval: "allow_accept_edits" — approve + switch to acceptEdits mode ---
      if (decision === "allow_accept_edits") {
        sdk.setPermissionMode(session, "acceptEdits");
        sm.currentPermissionMode = "acceptEdits";
        send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "high" });
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });
        return;
      }

      // --- Plan approval: "allow_clear_context" — new session + plan as first message + acceptEdits ---
      if (decision === "allow_clear_context") {
        // Deny current plan to end the turn
        pending.resolve({ behavior: "deny", message: "User chose to clear context and restart" });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });

        // Build prompt from plan content (sent from client) or plan file path
        var clientPlanContent = msg.planContent || "";
        var planPrompt;
        if (clientPlanContent) {
          planPrompt = "Execute the following plan. Do NOT re-enter plan mode — just implement it step by step.\n\n" + clientPlanContent;
        } else {
          var planFilePath = (pending.toolInput && pending.toolInput.planFilePath) || "";
          planPrompt = "Execute the plan in " + planFilePath + ". Do NOT re-enter plan mode — read the plan file and implement it step by step.";
        }

        // Wait a tick for the deny to propagate, then create new session + send plan
        setTimeout(function () {
          var newSession = sm.createSession();
          // Send the plan as the first user message (with planContent for UI rendering)
          var userMsg = { type: "user_message", text: planPrompt, planContent: clientPlanContent || null };
          newSession.history.push(userMsg);
          sm.appendToSessionFile(newSession, userMsg);
          newSession.title = "Plan execution (cleared context)";
          sm.saveSessionFile(newSession);
          sm.broadcastSessionList();
          send(userMsg);

          newSession.isProcessing = true;
          newSession.sentToolResults = {};
          send({ type: "status", status: "processing" });
          newSession.acceptEditsAfterStart = true;
          sdk.startQuery(newSession, planPrompt);
        }, 200);
        return;
      }

      // --- Plan approval: "deny_with_feedback" — deny + send feedback as follow-up message ---
      if (decision === "deny_with_feedback") {
        var feedback = msg.feedback || "";
        pending.resolve({ behavior: "deny", message: feedback || "User provided feedback" });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });

        // Send feedback as next user message if there's text
        if (feedback) {
          setTimeout(function () {
            var userMsg = { type: "user_message", text: feedback };
            session.history.push(userMsg);
            sm.appendToSessionFile(session, userMsg);
            send(userMsg);

            if (!session.isProcessing) {
              session.isProcessing = true;
              session.sentToolResults = {};
              send({ type: "status", status: "processing" });
              if (!session.queryInstance) {
                sdk.startQuery(session, feedback);
              } else {
                sdk.pushMessage(session, feedback);
              }
            } else {
              sdk.pushMessage(session, feedback);
            }
          }, 200);
        }
        return;
      }

      if (decision === "allow" || decision === "allow_always") {
        if (decision === "allow_always") {
          if (!session.allowedTools) session.allowedTools = {};
          session.allowedTools[pending.toolName] = true;
        }
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
      } else {
        pending.resolve({ behavior: "deny", message: "User denied permission" });
      }

      sm.sendAndRecord(session, {
        type: "permission_resolved",
        requestId: requestId,
        decision: decision,
      });
      return;
    }

    // --- Browse directories (for add-project autocomplete) ---
    if (msg.type === "browse_dir") {
      var rawPath = (msg.path || "").replace(/^~/, process.env.HOME || "/");
      var absTarget = path.resolve(rawPath);
      var parentDir, prefix;
      try {
        var stat = fs.statSync(absTarget);
        if (stat.isDirectory()) {
          // Input is an existing directory — list its children
          parentDir = absTarget;
          prefix = "";
        } else {
          parentDir = path.dirname(absTarget);
          prefix = path.basename(absTarget).toLowerCase();
        }
      } catch (e) {
        // Path doesn't exist — list parent and filter by typed prefix
        parentDir = path.dirname(absTarget);
        prefix = path.basename(absTarget).toLowerCase();
      }
      try {
        var dirItems = fs.readdirSync(parentDir, { withFileTypes: true });
        var dirEntries = [];
        for (var di = 0; di < dirItems.length; di++) {
          var d = dirItems[di];
          if (!d.isDirectory()) continue;
          if (d.name.charAt(0) === ".") continue;
          if (IGNORED_DIRS.has(d.name)) continue;
          if (prefix && !d.name.toLowerCase().startsWith(prefix)) continue;
          dirEntries.push({ name: d.name, path: path.join(parentDir, d.name) });
        }
        dirEntries.sort(function (a, b) { return a.name.localeCompare(b.name); });
        sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: dirEntries });
      } catch (e) {
        sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: [], error: e.message });
      }
      return;
    }

    // --- Add project from web UI ---
    if (msg.type === "add_project") {
      var addPath = (msg.path || "").replace(/^~/, process.env.HOME || "/");
      var addAbs = path.resolve(addPath);
      try {
        var addStat = fs.statSync(addAbs);
        if (!addStat.isDirectory()) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "Not a directory" });
          return;
        }
      } catch (e) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Directory not found" });
        return;
      }
      if (typeof opts.onAddProject === "function") {
        var result = opts.onAddProject(addAbs);
        sendTo(ws, { type: "add_project_result", ok: result.ok, slug: result.slug, error: result.error, existing: result.existing });
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Remove project from web UI ---
    if (msg.type === "remove_project") {
      var removeSlug = msg.slug;
      if (!removeSlug) {
        sendTo(ws, { type: "remove_project_result", ok: false, error: "Missing slug" });
        return;
      }
      if (typeof opts.onRemoveProject === "function") {
        var removeResult = opts.onRemoveProject(removeSlug);
        sendTo(ws, { type: "remove_project_result", ok: removeResult.ok, slug: removeSlug, error: removeResult.error });
      } else {
        sendTo(ws, { type: "remove_project_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Daemon config (server settings) ---
    if (msg.type === "get_daemon_config") {
      if (typeof opts.onGetDaemonConfig === "function") {
        var daemonConfig = opts.onGetDaemonConfig();
        sendTo(ws, { type: "daemon_config", config: daemonConfig });
      }
      return;
    }

    if (msg.type === "set_pin") {
      if (typeof opts.onSetPin === "function") {
        var pinResult = opts.onSetPin(msg.pin || null);
        sendTo(ws, { type: "set_pin_result", ok: pinResult.ok, pinEnabled: pinResult.pinEnabled });
      }
      return;
    }

    if (msg.type === "set_keep_awake") {
      if (typeof opts.onSetKeepAwake === "function") {
        var kaResult = opts.onSetKeepAwake(msg.value);
        sendTo(ws, { type: "set_keep_awake_result", ok: kaResult.ok, keepAwake: kaResult.keepAwake });
        send({ type: "keep_awake_changed", keepAwake: kaResult.keepAwake });
      }
      return;
    }

    if (msg.type === "shutdown_server") {
      if (typeof opts.onShutdown === "function") {
        sendTo(ws, { type: "shutdown_server_result", ok: true });
        send({ type: "toast", level: "warn", message: "Server is shutting down..." });
        // Small delay so the response has time to reach clients
        setTimeout(function () {
          opts.onShutdown();
        }, 500);
      } else {
        sendTo(ws, { type: "shutdown_server_result", ok: false, error: "Shutdown not supported" });
      }
      return;
    }

    // --- File browser ---
    if (msg.type === "fs_list") {
      var fsDir = safePath(cwd, msg.path || ".");
      if (!fsDir) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: "Access denied" });
        return;
      }
      try {
        var items = fs.readdirSync(fsDir, { withFileTypes: true });
        var entries = [];
        for (var fi = 0; fi < items.length; fi++) {
          var item = items[fi];
          if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
          entries.push({
            name: item.name,
            type: item.isDirectory() ? "dir" : "file",
            path: path.relative(cwd, path.join(fsDir, item.name)).split(path.sep).join("/"),
          });
        }
        sendTo(ws, { type: "fs_list_result", path: msg.path || ".", entries: entries });
        // Auto-watch the directory for changes
        startDirWatch(msg.path || ".");
      } catch (e) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: e.message });
      }
      return;
    }

    if (msg.type === "fs_read") {
      var fsFile = safePath(cwd, msg.path);
      if (!fsFile) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: "Access denied" });
        return;
      }
      try {
        var stat = fs.statSync(fsFile);
        var ext = path.extname(fsFile).toLowerCase();
        if (stat.size > FS_MAX_SIZE) {
          sendTo(ws, { type: "fs_read_result", path: msg.path, binary: true, size: stat.size, error: "File too large (" + (stat.size / 1024 / 1024).toFixed(1) + " MB)" });
          return;
        }
        if (BINARY_EXTS.has(ext)) {
          var result = { type: "fs_read_result", path: msg.path, binary: true, size: stat.size };
          if (IMAGE_EXTS.has(ext)) result.imageUrl = "api/file?path=" + encodeURIComponent(msg.path);
          sendTo(ws, result);
          return;
        }
        var content = fs.readFileSync(fsFile, "utf8");
        sendTo(ws, { type: "fs_read_result", path: msg.path, content: content, size: stat.size });
      } catch (e) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: e.message });
      }
      return;
    }

    // --- File watcher ---
    if (msg.type === "fs_watch") {
      if (msg.path) startFileWatch(msg.path);
      return;
    }

    if (msg.type === "fs_unwatch") {
      stopFileWatch();
      return;
    }

    // --- File edit history ---
    if (msg.type === "fs_file_history") {
      var histPath = msg.path;
      if (!histPath) {
        sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: [] });
        return;
      }
      var absHistPath = path.resolve(cwd, histPath);
      var entries = [];

      // Collect session edits
      sm.sessions.forEach(function (session) {
        var sessionLocalId = session.localId;
        var sessionTitle = session.title || "Untitled";
        var histLen = session.history.length || 1;

        for (var hi = 0; hi < session.history.length; hi++) {
          var entry = session.history[hi];
          if (entry.type !== "tool_executing") continue;
          if (entry.name !== "Edit" && entry.name !== "Write") continue;
          if (!entry.input || !entry.input.file_path) continue;
          if (entry.input.file_path !== absHistPath) continue;

          // Find parent assistant UUID + message snippet by scanning backwards
          var assistantUuid = null;
          var uuidIndex = -1;
          for (var hj = hi - 1; hj >= 0; hj--) {
            if (session.history[hj].type === "message_uuid" && session.history[hj].messageType === "assistant") {
              assistantUuid = session.history[hj].uuid;
              uuidIndex = hj;
              break;
            }
          }

          // Find user prompt by scanning backwards from the assistant uuid
          var messageSnippet = "";
          var searchFrom = uuidIndex >= 0 ? uuidIndex : hi;
          for (var hk = searchFrom - 1; hk >= 0; hk--) {
            if (session.history[hk].type === "user_message" && session.history[hk].text) {
              messageSnippet = session.history[hk].text.trim().substring(0, 100);
              break;
            }
          }

          // Collect Claude's explanation: scan backwards from tool_executing
          // to find the nearest delta text block (skipping tool_start).
          // If no delta found immediately before this tool, scan past
          // intervening tool blocks to find the last delta text within
          // the same assistant turn.
          var assistantSnippet = "";
          var deltaChunks = [];
          for (var hd = hi - 1; hd >= 0; hd--) {
            var hEntry = session.history[hd];
            if (hEntry.type === "tool_start") continue;
            if (hEntry.type === "delta" && hEntry.text) {
              deltaChunks.unshift(hEntry.text);
            } else {
              break;
            }
          }
          if (deltaChunks.length === 0) {
            // No delta immediately before; scan past tool blocks
            // to find the nearest preceding delta in the same turn
            for (var hd2 = hi - 1; hd2 >= 0; hd2--) {
              var hEntry2 = session.history[hd2];
              if (hEntry2.type === "tool_start" || hEntry2.type === "tool_executing" || hEntry2.type === "tool_result") continue;
              if (hEntry2.type === "delta" && hEntry2.text) {
                // Found a delta before an earlier tool in the same turn.
                // Collect this contiguous block of deltas.
                for (var hd3 = hd2; hd3 >= 0; hd3--) {
                  var hEntry3 = session.history[hd3];
                  if (hEntry3.type === "tool_start") continue;
                  if (hEntry3.type === "delta" && hEntry3.text) {
                    deltaChunks.unshift(hEntry3.text);
                  } else {
                    break;
                  }
                }
                break;
              } else {
                // Hit message_uuid, user_message, etc. Stop.
                break;
              }
            }
          }
          assistantSnippet = deltaChunks.join("").trim().substring(0, 150);

          // Approximate timestamp: interpolate between session creation and last activity
          var tStart = session.createdAt || 0;
          var tEnd = session.lastActivity || tStart;
          var ts = tStart + Math.floor((hi / histLen) * (tEnd - tStart));

          var editRecord = {
            source: "session",
            timestamp: ts,
            sessionLocalId: sessionLocalId,
            sessionTitle: sessionTitle,
            assistantUuid: assistantUuid,
            toolId: entry.id,
            messageSnippet: messageSnippet,
            assistantSnippet: assistantSnippet,
            toolName: entry.name,
          };

          if (entry.name === "Edit") {
            editRecord.old_string = entry.input.old_string || "";
            editRecord.new_string = entry.input.new_string || "";
          } else {
            editRecord.isFullWrite = true;
          }

          entries.push(editRecord);
        }
      });

      // Collect git commits
      try {
        var gitLog = execFileSync(
          "git", ["log", "--format=%H|%at|%an|%s", "--follow", "--", histPath],
          { cwd: cwd, encoding: "utf8", timeout: 5000 }
        );
        var gitLines = gitLog.trim().split("\n");
        for (var gi = 0; gi < gitLines.length; gi++) {
          if (!gitLines[gi]) continue;
          var parts = gitLines[gi].split("|");
          if (parts.length < 4) continue;
          entries.push({
            source: "git",
            hash: parts[0],
            timestamp: parseInt(parts[1], 10) * 1000,
            author: parts[2],
            message: parts.slice(3).join("|"),
          });
        }
      } catch (e) {
        // Not a git repo or file not tracked, that's fine
      }

      // Sort by timestamp descending (newest first)
      entries.sort(function (a, b) { return b.timestamp - a.timestamp; });

      sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: entries });
      return;
    }

    // --- Git diff for file history ---
    if (msg.type === "fs_git_diff") {
      var diffPath = msg.path;
      var hash = msg.hash;
      var hash2 = msg.hash2 || null;
      if (!diffPath || !hash) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, path: diffPath, diff: "", error: "Missing params" });
        return;
      }
      try {
        var diff;
        if (hash2) {
          diff = execFileSync("git", ["diff", hash, hash2, "--", diffPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        } else {
          diff = execFileSync("git", ["show", hash, "--format=", "--", diffPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        }
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: diff || "" });
      } catch (e) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: "", error: e.message });
      }
      return;
    }

    // --- File content at a git commit ---
    if (msg.type === "fs_file_at") {
      var atPath = msg.path;
      var atHash = msg.hash;
      if (!atPath || !atHash) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: "Missing params" });
        return;
      }
      try {
        // Convert to repo-relative path (git show requires hash:relative/path)
        var atAbsPath = path.resolve(cwd, atPath);
        var atRelPath = path.relative(cwd, atAbsPath);
        var content = execFileSync("git", ["show", atHash + ":" + atRelPath],
          { cwd: cwd, encoding: "utf8", timeout: 5000 });
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: content });
      } catch (e) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: e.message });
      }
      return;
    }

    // --- Sticky notes ---
    if (msg.type === "note_create") {
      var note = nm.create(msg);
      if (note) send({ type: "note_created", note: note });
      return;
    }

    if (msg.type === "note_update") {
      if (!msg.id) return;
      var updated = nm.update(msg.id, msg);
      if (updated) send({ type: "note_updated", note: updated });
      return;
    }

    if (msg.type === "note_delete") {
      if (!msg.id) return;
      if (nm.remove(msg.id)) send({ type: "note_deleted", id: msg.id });
      return;
    }

    if (msg.type === "note_bring_front") {
      if (!msg.id) return;
      var front = nm.bringToFront(msg.id);
      if (front) send({ type: "note_updated", note: front });
      return;
    }

    // --- Web terminal ---
    if (msg.type === "term_create") {
      var t = tm.create(msg.cols || 80, msg.rows || 24);
      if (!t) {
        sendTo(ws, { type: "term_error", error: "Cannot create terminal (node-pty not available or limit reached)" });
        return;
      }
      tm.attach(t.id, ws);
      send({ type: "term_list", terminals: tm.list() });
      sendTo(ws, { type: "term_created", id: t.id });
      return;
    }

    if (msg.type === "term_attach") {
      if (msg.id) tm.attach(msg.id, ws);
      return;
    }

    if (msg.type === "term_detach") {
      if (msg.id) tm.detach(msg.id, ws);
      return;
    }

    if (msg.type === "term_input") {
      if (msg.id) tm.write(msg.id, msg.data);
      return;
    }

    if (msg.type === "term_resize") {
      if (msg.id && msg.cols > 0 && msg.rows > 0) {
        tm.resize(msg.id, msg.cols, msg.rows);
      }
      return;
    }

    if (msg.type === "term_close") {
      if (msg.id) {
        tm.close(msg.id);
        send({ type: "term_list", terminals: tm.list() });
      }
      return;
    }

    if (msg.type === "term_rename") {
      if (msg.id && msg.title) {
        tm.rename(msg.id, msg.title);
        send({ type: "term_list", terminals: tm.list() });
      }
      return;
    }

    if (msg.type !== "message") return;
    if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.pastes || msg.pastes.length === 0)) return;

    var session = sm.getActiveSession();
    if (!session) return;

    var userMsg = { type: "user_message", text: msg.text || "" };
    if (msg.images && msg.images.length > 0) {
      userMsg.imageCount = msg.images.length;
    }
    if (msg.pastes && msg.pastes.length > 0) {
      userMsg.pastes = msg.pastes;
    }
    session.history.push(userMsg);
    sm.appendToSessionFile(session, userMsg);
    sendToOthers(ws, userMsg);

    if (!session.title) {
      session.title = (msg.text || "Image").substring(0, 50);
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
    }

    var fullText = msg.text || "";
    if (msg.pastes && msg.pastes.length > 0) {
      for (var pi = 0; pi < msg.pastes.length; pi++) {
        if (fullText) fullText += "\n\n";
        fullText += msg.pastes[pi];
      }
    }

    if (!session.isProcessing) {
      session.isProcessing = true;
      session.sentToolResults = {};
      send({ type: "status", status: "processing" });
      if (!session.queryInstance) {
        sdk.startQuery(session, fullText, msg.images);
      } else {
        sdk.pushMessage(session, fullText, msg.images);
      }
    } else {
      sdk.pushMessage(session, fullText, msg.images);
    }
    sm.broadcastSessionList();
  }

  // --- WS disconnection handler ---
  function handleDisconnection(ws) {
    tm.detachAll(ws);
    clients.delete(ws);
    if (clients.size === 0) {
      stopFileWatch();
      stopAllDirWatches();
    }
    broadcastClientCount();
  }

  // --- Handle project-scoped HTTP requests ---
  function handleHTTP(req, res, urlPath) {
    // Push subscribe
    if (req.method === "POST" && urlPath === "/api/push-subscribe") {
      parseJsonBody(req).then(function (body) {
        var sub = body.subscription || body;
        if (pushModule) pushModule.addSubscription(sub, body.replaceEndpoint);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Permission response from push notification
    if (req.method === "POST" && urlPath === "/api/permission-response") {
      parseJsonBody(req).then(function (data) {
        var requestId = data.requestId;
        var decision = data.decision;
        if (!requestId || !decision) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing requestId or decision"}');
          return;
        }
        var found = false;
        sm.sessions.forEach(function (session) {
          var pending = session.pendingPermissions[requestId];
          if (!pending) return;
          found = true;
          delete session.pendingPermissions[requestId];
          if (decision === "allow") {
            pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
          } else {
            pending.resolve({ behavior: "deny", message: "Denied via push notification" });
          }
          sm.sendAndRecord(session, {
            type: "permission_resolved",
            requestId: requestId,
            decision: decision,
          });
        });
        if (found) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"permission request not found"}');
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // VAPID public key
    if (req.method === "GET" && urlPath === "/api/vapid-public-key") {
      if (pushModule) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" });
        res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"push not available"}');
      }
      return true;
    }

    // File browser: serve project images
    if (req.method === "GET" && urlPath.startsWith("/api/file?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var reqFilePath = params.get("path");
      if (!reqFilePath) { res.writeHead(400); res.end("Missing path"); return true; }
      var absFile = safePath(cwd, reqFilePath);
      if (!absFile) { res.writeHead(403); res.end("Access denied"); return true; }
      var fileExt = path.extname(absFile).toLowerCase();
      if (!IMAGE_EXTS.has(fileExt)) { res.writeHead(403); res.end("Only image files"); return true; }
      try {
        var fileContent = fs.readFileSync(absFile);
        var fileMime = MIME_TYPES[fileExt] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": fileMime, "Cache-Control": "no-cache" });
        res.end(fileContent);
      } catch (e) {
        res.writeHead(404); res.end("Not found");
      }
      return true;
    }

    // Info endpoint
    if (req.method === "GET" && urlPath === "/info") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ cwd: cwd, project: project, slug: slug }));
      return true;
    }

    return false; // not handled
  }

  // --- Destroy ---
  function destroy() {
    stopFileWatch();
    stopAllDirWatches();
    // Abort all active sessions
    sm.sessions.forEach(function (session) {
      if (session.abortController) {
        try { session.abortController.abort(); } catch (e) {}
      }
      if (session.messageQueue) {
        try { session.messageQueue.end(); } catch (e) {}
      }
    });
    // Kill all terminals
    tm.destroyAll();
    for (var ws of clients) {
      try { ws.close(); } catch (e) {}
    }
    clients.clear();
  }

  // --- Status info ---
  function getStatus() {
    var sessionCount = sm.sessions.size;
    var hasProcessing = false;
    sm.sessions.forEach(function (s) {
      if (s.isProcessing) hasProcessing = true;
    });
    return {
      slug: slug,
      path: cwd,
      project: project,
      title: title,
      clients: clients.size,
      sessions: sessionCount,
      isProcessing: hasProcessing,
    };
  }

  function setTitle(newTitle) {
    title = newTitle || null;
    send({ type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, lanHost: lanHost, projectCount: getProjectCount(), projects: getProjectList() });
  }

  return {
    cwd: cwd,
    slug: slug,
    project: project,
    clients: clients,
    sm: sm,
    sdk: sdk,
    send: send,
    sendTo: sendTo,
    handleConnection: handleConnection,
    handleMessage: handleMessage,
    handleDisconnection: handleDisconnection,
    handleHTTP: handleHTTP,
    getStatus: getStatus,
    setTitle: setTitle,
    warmup: function () { sdk.warmup(); },
    destroy: destroy,
  };
}

function parseJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var body = "";
    req.on("data", function (chunk) { body += chunk; });
    req.on("end", function () {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
  });
}

module.exports = { createProjectContext: createProjectContext };
