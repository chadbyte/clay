var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var { createSessionManager } = require("./sessions");
var { createSDKBridge } = require("./sdk-bridge");
var { createTerminalManager } = require("./terminal-manager");
var { createNotesManager } = require("./notes");
var { fetchLatestVersion, isNewer } = require("./updater");
var { execFileSync, spawn } = require("child_process");

var MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

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
  var icon = opts.icon || null;
  var pushModule = opts.pushModule || null;
  var debug = opts.debug || false;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var currentVersion = opts.currentVersion;
  var lanHost = opts.lanHost || null;
  var getProjectCount = opts.getProjectCount || function () { return 1; };
  var getProjectList = opts.getProjectList || function () { return []; };
  var onProcessingChanged = opts.onProcessingChanged || function () {};
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
  var _projMode = typeof opts.onGetProjectDefaultMode === "function" ? opts.onGetProjectDefaultMode(slug) : null;
  var _srvMode = typeof opts.onGetServerDefaultMode === "function" ? opts.onGetServerDefaultMode() : null;
  sm.currentPermissionMode = (_projMode && _projMode.mode) || (_srvMode && _srvMode.mode) || "default";

  var _projEffort = typeof opts.onGetProjectDefaultEffort === "function" ? opts.onGetProjectDefaultEffort(slug) : null;
  var _srvEffort = typeof opts.onGetServerDefaultEffort === "function" ? opts.onGetServerDefaultEffort() : null;
  sm.currentEffort = (_projEffort && _projEffort.effort) || (_srvEffort && _srvEffort.effort) || "medium";

  var _projModel = typeof opts.onGetProjectDefaultModel === "function" ? opts.onGetProjectDefaultModel(slug) : null;
  var _srvModel = typeof opts.onGetServerDefaultModel === "function" ? opts.onGetServerDefaultModel() : null;
  sm._savedDefaultModel = (_projModel && _projModel.model) || (_srvModel && _srvModel.model) || null;

  // --- SDK bridge ---
  var sdk = createSDKBridge({
    cwd: cwd,
    slug: slug,
    sessionManager: sm,
    send: send,
    pushModule: pushModule,
    getSDK: getSDK,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    onProcessingChanged: onProcessingChanged,
  });

  // --- Ralph Loop state ---
  var loopState = {
    active: false,
    phase: "idle", // idle | crafting | approval | executing | done
    promptText: "",
    judgeText: "",
    iteration: 0,
    maxIterations: 20,
    baseCommit: null,
    currentSessionId: null,
    judgeSessionId: null,
    results: [],
    stopping: false,
    wizardData: null,
    craftingSessionId: null,
    startedAt: null,
    loopId: null,
  };

  function loopDir() {
    if (!loopState.loopId) return null;
    return path.join(cwd, ".claude", "loops", loopState.loopId);
  }

  function generateLoopId() {
    return "loop_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
  }

  // Loop state persistence
  var _loopConfig = require("./config");
  var _loopUtils = require("./utils");
  var _loopEncodedCwd = _loopUtils.encodeCwd(cwd);
  var _loopDir = path.join(_loopConfig.CONFIG_DIR, "loops");
  var _loopStatePath = path.join(_loopDir, _loopEncodedCwd + ".json");

  function saveLoopState() {
    try {
      fs.mkdirSync(_loopDir, { recursive: true });
      var data = {
        phase: loopState.phase,
        active: loopState.active,
        iteration: loopState.iteration,
        maxIterations: loopState.maxIterations,
        baseCommit: loopState.baseCommit,
        results: loopState.results,
        wizardData: loopState.wizardData,
        startedAt: loopState.startedAt,
        loopId: loopState.loopId,
      };
      var tmpPath = _loopStatePath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
      fs.renameSync(tmpPath, _loopStatePath);
    } catch (e) {
      console.error("[ralph-loop] Failed to save state:", e.message);
    }
  }

  function loadLoopState() {
    try {
      var raw = fs.readFileSync(_loopStatePath, "utf8");
      var data = JSON.parse(raw);
      loopState.phase = data.phase || "idle";
      loopState.active = data.active || false;
      loopState.iteration = data.iteration || 0;
      loopState.maxIterations = data.maxIterations || 20;
      loopState.baseCommit = data.baseCommit || null;
      loopState.results = data.results || [];
      loopState.wizardData = data.wizardData || null;
      loopState.startedAt = data.startedAt || null;
      loopState.loopId = data.loopId || null;
      // SDK sessions cannot survive daemon restart
      loopState.currentSessionId = null;
      loopState.judgeSessionId = null;
      loopState.craftingSessionId = null;
      loopState.stopping = false;
      // If was executing, schedule resume after SDK is ready
      if (loopState.phase === "executing" && loopState.active) {
        loopState._needsResume = true;
      }
      // If was crafting, check if files exist and move to approval
      if (loopState.phase === "crafting") {
        var hasFiles = checkLoopFilesExist();
        if (hasFiles) {
          loopState.phase = "approval";
          saveLoopState();
        } else {
          loopState.phase = "idle";
          saveLoopState();
        }
      }
    } catch (e) {
      // No saved state, use defaults
    }
  }

  function clearLoopState() {
    loopState.active = false;
    loopState.phase = "idle";
    loopState.promptText = "";
    loopState.judgeText = "";
    loopState.iteration = 0;
    loopState.maxIterations = 20;
    loopState.baseCommit = null;
    loopState.currentSessionId = null;
    loopState.judgeSessionId = null;
    loopState.results = [];
    loopState.stopping = false;
    loopState.wizardData = null;
    loopState.craftingSessionId = null;
    loopState.startedAt = null;
    loopState.loopId = null;
    saveLoopState();
  }

  function checkLoopFilesExist() {
    var dir = loopDir();
    if (!dir) return false;
    var hasPrompt = false;
    var hasJudge = false;
    try { fs.accessSync(path.join(dir, "PROMPT.md")); hasPrompt = true; } catch (e) {}
    try { fs.accessSync(path.join(dir, "JUDGE.md")); hasJudge = true; } catch (e) {}
    return hasPrompt && hasJudge;
  }

  // .claude/ directory watcher for PROMPT.md / JUDGE.md
  var claudeDirWatcher = null;
  var claudeDirDebounce = null;

  function startClaudeDirWatch() {
    if (claudeDirWatcher) return;
    var watchDir = loopDir();
    if (!watchDir) return;
    try { fs.mkdirSync(watchDir, { recursive: true }); } catch (e) {}
    try {
      claudeDirWatcher = fs.watch(watchDir, function () {
        if (claudeDirDebounce) clearTimeout(claudeDirDebounce);
        claudeDirDebounce = setTimeout(function () {
          broadcastLoopFilesStatus();
        }, 300);
      });
      claudeDirWatcher.on("error", function () {});
    } catch (e) {
      console.error("[ralph-loop] Failed to watch .claude/:", e.message);
    }
  }

  function stopClaudeDirWatch() {
    if (claudeDirWatcher) {
      claudeDirWatcher.close();
      claudeDirWatcher = null;
    }
    if (claudeDirDebounce) {
      clearTimeout(claudeDirDebounce);
      claudeDirDebounce = null;
    }
  }

  function broadcastLoopFilesStatus() {
    var dir = loopDir();
    var hasPrompt = false;
    var hasJudge = false;
    var hasLoopJson = false;
    if (dir) {
      try { fs.accessSync(path.join(dir, "PROMPT.md")); hasPrompt = true; } catch (e) {}
      try { fs.accessSync(path.join(dir, "JUDGE.md")); hasJudge = true; } catch (e) {}
      try { fs.accessSync(path.join(dir, "LOOP.json")); hasLoopJson = true; } catch (e) {}
    }
    send({
      type: "ralph_files_status",
      promptReady: hasPrompt,
      judgeReady: hasJudge,
      loopJsonReady: hasLoopJson,
      bothReady: hasPrompt && hasJudge,
    });
    // Auto-transition to approval phase when both files appear
    if (hasPrompt && hasJudge && loopState.phase === "crafting") {
      loopState.phase = "approval";
      saveLoopState();
    }
  }

  // Load persisted state on startup
  loadLoopState();

  function startLoop(opts) {
    var loopOpts = opts || {};
    var dir = loopDir();
    if (!dir) {
      send({ type: "loop_error", text: "No loop directory. Run the wizard first." });
      return;
    }
    var promptPath = path.join(dir, "PROMPT.md");
    var judgePath = path.join(dir, "JUDGE.md");
    var promptText, judgeText;
    try {
      promptText = fs.readFileSync(promptPath, "utf8");
    } catch (e) {
      send({ type: "loop_error", text: "Missing PROMPT.md in " + dir });
      return;
    }
    try {
      judgeText = fs.readFileSync(judgePath, "utf8");
    } catch (e) {
      send({ type: "loop_error", text: "Missing JUDGE.md in " + dir });
      return;
    }

    var baseCommit;
    try {
      baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: cwd, encoding: "utf8", timeout: 5000,
      }).trim();
    } catch (e) {
      send({ type: "loop_error", text: "Failed to get git HEAD: " + e.message });
      return;
    }

    // Read loop config from LOOP.json in loop directory
    var loopConfig = {};
    try {
      loopConfig = JSON.parse(fs.readFileSync(path.join(dir, "LOOP.json"), "utf8"));
    } catch (e) {}

    loopState.active = true;
    loopState.phase = "executing";
    loopState.promptText = promptText;
    loopState.judgeText = judgeText;
    loopState.iteration = 0;
    loopState.maxIterations = loopConfig.maxIterations || loopOpts.maxIterations || 20;
    loopState.baseCommit = baseCommit;
    loopState.currentSessionId = null;
    loopState.judgeSessionId = null;
    loopState.results = [];
    loopState.stopping = false;
    loopState.startedAt = Date.now();
    saveLoopState();

    stopClaudeDirWatch();

    send({ type: "loop_started", maxIterations: loopState.maxIterations });
    runNextIteration();
  }

  function runNextIteration() {
    console.log("[ralph-loop] runNextIteration called, iteration: " + loopState.iteration + ", active: " + loopState.active + ", stopping: " + loopState.stopping);
    if (!loopState.active || loopState.stopping) {
      finishLoop("stopped");
      return;
    }

    loopState.iteration++;
    if (loopState.iteration > loopState.maxIterations) {
      finishLoop("max_iterations");
      return;
    }

    var session = sm.createSession();
    session.loop = { active: true, iteration: loopState.iteration, role: "coder" };
    var loopName = (loopState.wizardData && loopState.wizardData.name) || "";
    session.title = "Ralph" + (loopName ? " " + loopName : "") + " #" + loopState.iteration;
    sm.saveSessionFile(session);
    sm.broadcastSessionList();

    loopState.currentSessionId = session.localId;

    send({
      type: "loop_iteration",
      iteration: loopState.iteration,
      maxIterations: loopState.maxIterations,
      sessionId: session.localId,
    });

    session.onQueryComplete = function(completedSession) {
      console.log("[ralph-loop] Coder #" + loopState.iteration + " onQueryComplete fired, history length: " + completedSession.history.length);
      if (!loopState.active) { console.log("[ralph-loop] Coder: loopState.active is false, skipping"); return; }
      // Check if session ended with error
      var lastItems = completedSession.history.slice(-3);
      var hadError = false;
      for (var i = 0; i < lastItems.length; i++) {
        if (lastItems[i].type === "error" || (lastItems[i].type === "done" && lastItems[i].code === 1)) {
          hadError = true;
          break;
        }
      }
      if (hadError) {
        loopState.results.push({
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Iteration ended with error",
        });
        send({
          type: "loop_verdict",
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Iteration ended with error, retrying...",
        });
        setTimeout(function() { runNextIteration(); }, 2000);
        return;
      }
      runJudge();
    };

    var userMsg = { type: "user_message", text: loopState.promptText };
    session.history.push(userMsg);
    sm.appendToSessionFile(session, userMsg);

    session.isProcessing = true;
    onProcessingChanged();
    session.sentToolResults = {};
    send({ type: "status", status: "processing" });
    session.acceptEditsAfterStart = true;
    session.singleTurn = true;
    sdk.startQuery(session, loopState.promptText);
  }

  function runJudge() {
    if (!loopState.active || loopState.stopping) {
      finishLoop("stopped");
      return;
    }

    var diff;
    try {
      diff = execFileSync("git", ["diff", loopState.baseCommit], {
        cwd: cwd, encoding: "utf8", timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (e) {
      send({ type: "loop_error", text: "Failed to generate git diff: " + e.message });
      finishLoop("error");
      return;
    }

    var judgePrompt = "You are a judge evaluating whether a coding task has been completed.\n\n" +
      "## Original Task (PROMPT.md)\n\n" + loopState.promptText + "\n\n" +
      "## Evaluation Criteria (JUDGE.md)\n\n" + loopState.judgeText + "\n\n" +
      "## Changes Made (git diff)\n\n```diff\n" + diff + "\n```\n\n" +
      "Based on the evaluation criteria, has the task been completed successfully?\n\n" +
      "Respond with exactly one of:\n" +
      "- PASS: [brief explanation]\n" +
      "- FAIL: [brief explanation of what is still missing]\n\n" +
      "Do NOT use any tools. Just analyze and respond.";

    var judgeSession = sm.createSession();
    judgeSession.loop = { active: true, iteration: loopState.iteration, role: "judge" };
    var judgeName = (loopState.wizardData && loopState.wizardData.name) || "";
    judgeSession.title = "Ralph" + (judgeName ? " " + judgeName : "") + " Judge #" + loopState.iteration;
    sm.saveSessionFile(judgeSession);
    sm.broadcastSessionList();
    loopState.judgeSessionId = judgeSession.localId;

    send({
      type: "loop_judging",
      iteration: loopState.iteration,
      sessionId: judgeSession.localId,
    });

    judgeSession.onQueryComplete = function(completedSession) {
      console.log("[ralph-loop] Judge #" + loopState.iteration + " onQueryComplete fired, history length: " + completedSession.history.length);
      var verdict = parseJudgeVerdict(completedSession);
      console.log("[ralph-loop] Judge verdict: " + (verdict.pass ? "PASS" : "FAIL") + " - " + verdict.explanation);

      loopState.results.push({
        iteration: loopState.iteration,
        verdict: verdict.pass ? "pass" : "fail",
        summary: verdict.explanation,
      });

      send({
        type: "loop_verdict",
        iteration: loopState.iteration,
        verdict: verdict.pass ? "pass" : "fail",
        summary: verdict.explanation,
      });

      if (verdict.pass) {
        finishLoop("pass");
      } else {
        setTimeout(function() { runNextIteration(); }, 1000);
      }
    };

    var userMsg = { type: "user_message", text: judgePrompt };
    judgeSession.history.push(userMsg);
    sm.appendToSessionFile(judgeSession, userMsg);

    judgeSession.isProcessing = true;
    onProcessingChanged();
    judgeSession.sentToolResults = {};
    judgeSession.acceptEditsAfterStart = true;
    judgeSession.singleTurn = true;
    sdk.startQuery(judgeSession, judgePrompt);
  }

  function parseJudgeVerdict(session) {
    var text = "";
    for (var i = 0; i < session.history.length; i++) {
      var h = session.history[i];
      if (h.type === "delta" && h.text) text += h.text;
      if (h.type === "text" && h.text) text += h.text;
    }
    console.log("[ralph-loop] Judge raw text (last 500 chars): " + text.slice(-500));
    var upper = text.toUpperCase();
    var passIdx = upper.indexOf("PASS");
    var failIdx = upper.indexOf("FAIL");
    if (passIdx !== -1 && (failIdx === -1 || passIdx < failIdx)) {
      var explanation = text.substring(passIdx + 4).replace(/^[\s:]+/, "").split("\n")[0].trim();
      return { pass: true, explanation: explanation || "Task completed" };
    }
    if (failIdx !== -1) {
      var explanation = text.substring(failIdx + 4).replace(/^[\s:]+/, "").split("\n")[0].trim();
      return { pass: false, explanation: explanation || "Task not yet complete" };
    }
    return { pass: false, explanation: "Could not parse judge verdict" };
  }

  function finishLoop(reason) {
    console.log("[ralph-loop] finishLoop called, reason: " + reason + ", iteration: " + loopState.iteration);
    loopState.active = false;
    loopState.phase = "done";
    loopState.stopping = false;
    loopState.currentSessionId = null;
    loopState.judgeSessionId = null;
    saveLoopState();

    send({
      type: "loop_finished",
      reason: reason,
      iterations: loopState.iteration,
      results: loopState.results,
    });

    if (pushModule) {
      var body = reason === "pass"
        ? "Task completed after " + loopState.iteration + " iteration(s)"
        : reason === "max_iterations"
          ? "Reached max iterations (" + loopState.maxIterations + ")"
          : reason === "stopped"
            ? "Loop stopped by user"
            : "Loop ended due to error";
      pushModule.sendPush({
        type: "done",
        slug: slug,
        title: "Ralph Loop Complete",
        body: body,
        tag: "ralph-loop-done",
      });
    }
  }

  function resumeLoop() {
    var dir = loopDir();
    if (!dir) {
      console.error("[ralph-loop] Cannot resume: no loop directory");
      loopState.active = false;
      loopState.phase = "idle";
      saveLoopState();
      return;
    }
    try {
      loopState.promptText = fs.readFileSync(path.join(dir, "PROMPT.md"), "utf8");
    } catch (e) {
      console.error("[ralph-loop] Cannot resume: missing PROMPT.md");
      loopState.active = false;
      loopState.phase = "idle";
      saveLoopState();
      return;
    }
    try {
      loopState.judgeText = fs.readFileSync(path.join(dir, "JUDGE.md"), "utf8");
    } catch (e) {
      console.error("[ralph-loop] Cannot resume: missing JUDGE.md");
      loopState.active = false;
      loopState.phase = "idle";
      saveLoopState();
      return;
    }
    // Retry the interrupted iteration (runNextIteration will increment)
    if (loopState.iteration > 0) {
      loopState.iteration--;
    }
    console.log("[ralph-loop] Resuming loop, next iteration will be " + (loopState.iteration + 1) + "/" + loopState.maxIterations);
    send({ type: "loop_started", maxIterations: loopState.maxIterations });
    runNextIteration();
  }

  function stopLoop() {
    if (!loopState.active) return;
    console.log("[ralph-loop] stopLoop called");
    loopState.stopping = true;

    // Abort all loop-related sessions (coder + judge)
    var sessionIds = [loopState.currentSessionId, loopState.judgeSessionId];
    for (var i = 0; i < sessionIds.length; i++) {
      if (sessionIds[i] == null) continue;
      var s = sm.sessions.get(sessionIds[i]);
      if (!s) continue;
      // End message queue so SDK exits prompt wait
      if (s.messageQueue) { try { s.messageQueue.end(); } catch (e) {} }
      // Abort active API call
      if (s.abortController) { try { s.abortController.abort(); } catch (e) {} }
    }

    send({ type: "loop_stopping" });

    // Fallback: force finish if onQueryComplete hasn't fired after 5s
    setTimeout(function() {
      if (loopState.active && loopState.stopping) {
        console.log("[ralph-loop] Stop fallback triggered — forcing finishLoop");
        finishLoop("stopped");
      }
    }, 5000);
  }

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

    // Resume loop if server restarted mid-execution (deferred so client gets initial state first)
    if (loopState._needsResume) {
      delete loopState._needsResume;
      setTimeout(function() { resumeLoop(); }, 500);
    }

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
    sendTo(ws, { type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
    sendTo(ws, { type: "term_list", terminals: tm.list() });
    sendTo(ws, { type: "notes_list", notes: nm.list() });

    // Ralph Loop availability
    var hasLoopFiles = false;
    try {
      fs.accessSync(path.join(cwd, ".claude", "PROMPT.md"));
      fs.accessSync(path.join(cwd, ".claude", "JUDGE.md"));
      hasLoopFiles = true;
    } catch (e) {}
    sendTo(ws, {
      type: "loop_available",
      available: hasLoopFiles,
      active: loopState.active,
      iteration: loopState.iteration,
      maxIterations: loopState.maxIterations,
    });

    // Ralph phase state
    sendTo(ws, {
      type: "ralph_phase",
      phase: loopState.phase,
      wizardData: loopState.wizardData,
      craftingSessionId: loopState.craftingSessionId || null,
    });
    if (loopState.phase === "crafting" || loopState.phase === "approval") {
      var _hasPrompt = false;
      var _hasJudge = false;
      var _lDir = loopDir();
      if (_lDir) {
        try { fs.accessSync(path.join(_lDir, "PROMPT.md")); _hasPrompt = true; } catch (e) {}
        try { fs.accessSync(path.join(_lDir, "JUDGE.md")); _hasJudge = true; } catch (e) {}
      }
      sendTo(ws, {
        type: "ralph_files_status",
        promptReady: _hasPrompt,
        judgeReady: _hasJudge,
        bothReady: _hasPrompt && _hasJudge,
      });
    }

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

    if (msg.type === "set_server_default_model" && msg.model) {
      if (typeof opts.onSetServerDefaultModel === "function") {
        opts.onSetServerDefaultModel(msg.model);
      }
      var session = sm.getActiveSession();
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return;
    }

    if (msg.type === "set_project_default_model" && msg.model) {
      if (typeof opts.onSetProjectDefaultModel === "function") {
        opts.onSetProjectDefaultModel(slug, msg.model);
      }
      var session = sm.getActiveSession();
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return;
    }

    if (msg.type === "set_permission_mode" && msg.mode) {
      // When dangerouslySkipPermissions is active, don't allow UI to change mode
      if (dangerouslySkipPermissions) {
        send({ type: "config_state", model: sm.currentModel || "", mode: "bypassPermissions", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
        return;
      }
      sm.currentPermissionMode = msg.mode;
      var session = sm.getActiveSession();
      if (session) {
        sdk.setPermissionMode(session, msg.mode);
      }
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return;
    }

    if (msg.type === "set_server_default_mode" && msg.mode) {
      if (typeof opts.onSetServerDefaultMode === "function") {
        opts.onSetServerDefaultMode(msg.mode);
      }
      if (!dangerouslySkipPermissions) {
        sm.currentPermissionMode = msg.mode;
        var session = sm.getActiveSession();
        if (session) {
          sdk.setPermissionMode(session, msg.mode);
        }
        send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      }
      return;
    }

    if (msg.type === "set_project_default_mode" && msg.mode) {
      if (typeof opts.onSetProjectDefaultMode === "function") {
        opts.onSetProjectDefaultMode(slug, msg.mode);
      }
      if (!dangerouslySkipPermissions) {
        sm.currentPermissionMode = msg.mode;
        var session = sm.getActiveSession();
        if (session) {
          sdk.setPermissionMode(session, msg.mode);
        }
        send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      }
      return;
    }

    if (msg.type === "set_effort" && msg.effort) {
      sm.currentEffort = msg.effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
      return;
    }

    if (msg.type === "set_server_default_effort" && msg.effort) {
      if (typeof opts.onSetServerDefaultEffort === "function") {
        opts.onSetServerDefaultEffort(msg.effort);
      }
      sm.currentEffort = msg.effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
      return;
    }

    if (msg.type === "set_project_default_effort" && msg.effort) {
      if (typeof opts.onSetProjectDefaultEffort === "function") {
        opts.onSetProjectDefaultEffort(slug, msg.effort);
      }
      sm.currentEffort = msg.effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
      return;
    }

    if (msg.type === "set_betas") {
      sm.currentBetas = msg.betas || [];
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas });
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
          onProcessingChanged();

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
        send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });
        return;
      }

      // --- Plan approval: "allow_clear_context" — new session + plan as first message + acceptEdits ---
      if (decision === "allow_clear_context") {
        // Deny current plan to end the turn
        pending.resolve({ behavior: "deny", message: "User chose to clear context and restart" });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });

        // Abort the old session's query — but defer to next tick so the SDK's
        // deny write (scheduled as microtask by pending.resolve) completes first.
        // Aborting synchronously would kill the subprocess before the write,
        // causing an "Operation aborted" crash in the SDK.
        session.isProcessing = false;
        onProcessingChanged();
        session.pendingPermissions = {};
        session.pendingAskUser = {};
        sm.broadcastSessionList();
        setImmediate(function () {
          if (session.abortController) {
            session.abortController.abort();
          }
        });

        // Update permission mode for the new session
        sm.currentPermissionMode = "acceptEdits";
        send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });

        // Build prompt from plan content (sent from client) or plan file path
        var clientPlanContent = msg.planContent || "";
        var planPrompt;
        if (clientPlanContent) {
          planPrompt = "Execute the following plan. Do NOT re-enter plan mode — just implement it step by step.\n\n" + clientPlanContent;
        } else {
          var planFilePath = (pending.toolInput && pending.toolInput.planFilePath) || "";
          planPrompt = "Execute the plan in " + planFilePath + ". Do NOT re-enter plan mode — read the plan file and implement it step by step.";
        }

        // Wait for old query stream to fully terminate, then create new session + send plan
        var oldStreamPromise = session.streamPromise || Promise.resolve();
        Promise.race([
          oldStreamPromise,
          new Promise(function (resolve) { setTimeout(resolve, 3000); }),
        ]).then(function () {
          try {
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
            onProcessingChanged();
            newSession.sentToolResults = {};
            send({ type: "status", status: "processing" });
            newSession.acceptEditsAfterStart = true;
            sdk.startQuery(newSession, planPrompt);
          } catch (e) {
            console.error("[project] Error starting plan execution:", e);
            send({ type: "error", text: "Failed to start plan execution: " + (e.message || e) });
          }
        });
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
              onProcessingChanged();
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

    // --- Reorder projects ---
    if (msg.type === "reorder_projects") {
      var slugs = msg.slugs;
      if (!Array.isArray(slugs) || slugs.length === 0) {
        sendTo(ws, { type: "reorder_projects_result", ok: false, error: "Missing slugs" });
        return;
      }
      if (typeof opts.onReorderProjects === "function") {
        var reorderResult = opts.onReorderProjects(slugs);
        sendTo(ws, { type: "reorder_projects_result", ok: reorderResult.ok, error: reorderResult.error });
      } else {
        sendTo(ws, { type: "reorder_projects_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Set project title (rename) ---
    if (msg.type === "set_project_title") {
      if (!msg.slug) {
        sendTo(ws, { type: "set_project_title_result", ok: false, error: "Missing slug" });
        return;
      }
      if (typeof opts.onSetProjectTitle === "function") {
        var titleResult = opts.onSetProjectTitle(msg.slug, msg.title || null);
        sendTo(ws, { type: "set_project_title_result", ok: titleResult.ok, slug: msg.slug, error: titleResult.error });
      } else {
        sendTo(ws, { type: "set_project_title_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Set project icon (emoji) ---
    if (msg.type === "set_project_icon") {
      if (!msg.slug) {
        sendTo(ws, { type: "set_project_icon_result", ok: false, error: "Missing slug" });
        return;
      }
      if (typeof opts.onSetProjectIcon === "function") {
        var iconResult = opts.onSetProjectIcon(msg.slug, msg.icon || null);
        sendTo(ws, { type: "set_project_icon_result", ok: iconResult.ok, slug: msg.slug, error: iconResult.error });
      } else {
        sendTo(ws, { type: "set_project_icon_result", ok: false, error: "Not supported" });
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

    if (msg.type === "restart_server") {
      if (typeof opts.onRestart === "function") {
        sendTo(ws, { type: "restart_server_result", ok: true });
        send({ type: "toast", level: "info", message: "Server is restarting..." });
        // Small delay so the response has time to reach clients
        setTimeout(function () {
          opts.onRestart();
        }, 500);
      } else {
        sendTo(ws, { type: "restart_server_result", ok: false, error: "Restart not supported" });
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

    // --- File write ---
    if (msg.type === "fs_write") {
      var fsWriteFile = safePath(cwd, msg.path);
      if (!fsWriteFile) {
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: false, error: "Access denied" });
        return;
      }
      try {
        fs.writeFileSync(fsWriteFile, msg.content || "", "utf8");
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: true });
      } catch (e) {
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: false, error: e.message });
      }
      return;
    }

    // --- Project environment variables ---
    if (msg.type === "get_project_env") {
      var envrc = "";
      var hasEnvrc = false;
      if (typeof opts.onGetProjectEnv === "function") {
        var envResult = opts.onGetProjectEnv(msg.slug);
        envrc = envResult.envrc || "";
      }
      try {
        var envrcPath = path.join(cwd, ".envrc");
        hasEnvrc = fs.existsSync(envrcPath);
      } catch (e) {}
      sendTo(ws, { type: "project_env_result", slug: msg.slug, envrc: envrc, hasEnvrc: hasEnvrc });
      return;
    }

    if (msg.type === "set_project_env") {
      if (typeof opts.onSetProjectEnv === "function") {
        var setResult = opts.onSetProjectEnv(msg.slug, msg.envrc || "");
        sendTo(ws, { type: "set_project_env_result", ok: setResult.ok, slug: msg.slug, error: setResult.error });
      } else {
        sendTo(ws, { type: "set_project_env_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Global CLAUDE.md ---
    if (msg.type === "read_global_claude_md") {
      var os = require("os");
      var globalMdPath = path.join(os.homedir(), ".claude", "CLAUDE.md");
      try {
        var globalMdContent = fs.readFileSync(globalMdPath, "utf8");
        sendTo(ws, { type: "global_claude_md_result", content: globalMdContent });
      } catch (e) {
        sendTo(ws, { type: "global_claude_md_result", error: e.message });
      }
      return;
    }

    if (msg.type === "write_global_claude_md") {
      var os2 = require("os");
      var globalMdDir = path.join(os2.homedir(), ".claude");
      var globalMdWritePath = path.join(globalMdDir, "CLAUDE.md");
      try {
        if (!fs.existsSync(globalMdDir)) {
          fs.mkdirSync(globalMdDir, { recursive: true });
        }
        fs.writeFileSync(globalMdWritePath, msg.content || "", "utf8");
        sendTo(ws, { type: "write_global_claude_md_result", ok: true });
      } catch (e) {
        sendTo(ws, { type: "write_global_claude_md_result", ok: false, error: e.message });
      }
      return;
    }

    // --- Shared environment variables ---
    if (msg.type === "get_shared_env") {
      var sharedEnvrc = "";
      if (typeof opts.onGetSharedEnv === "function") {
        var sharedResult = opts.onGetSharedEnv();
        sharedEnvrc = sharedResult.envrc || "";
      }
      sendTo(ws, { type: "shared_env_result", envrc: sharedEnvrc });
      return;
    }

    if (msg.type === "set_shared_env") {
      if (typeof opts.onSetSharedEnv === "function") {
        var sharedSetResult = opts.onSetSharedEnv(msg.envrc || "");
        sendTo(ws, { type: "set_shared_env_result", ok: sharedSetResult.ok, error: sharedSetResult.error });
      } else {
        sendTo(ws, { type: "set_shared_env_result", ok: false, error: "Not supported" });
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

    if (msg.type === "loop_start") {
      startLoop();
      return;
    }

    if (msg.type === "loop_stop") {
      stopLoop();
      return;
    }

    if (msg.type === "ralph_wizard_complete") {
      var wData = msg.data || {};
      var maxIter = wData.maxIterations || 25;
      var newLoopId = generateLoopId();
      loopState.loopId = newLoopId;
      loopState.wizardData = {
        name: (wData.name || "").replace(/[^a-zA-Z0-9_-]/g, "") || "ralph",
        task: wData.task || "",
        maxIterations: maxIter,
      };
      loopState.phase = "crafting";
      loopState.startedAt = Date.now();
      saveLoopState();

      // Create loop directory and write LOOP.json
      var lDir = loopDir();
      try { fs.mkdirSync(lDir, { recursive: true }); } catch (e) {}
      var loopJsonPath = path.join(lDir, "LOOP.json");
      var tmpLoopJson = loopJsonPath + ".tmp";
      fs.writeFileSync(tmpLoopJson, JSON.stringify({ maxIterations: maxIter }, null, 2));
      fs.renameSync(tmpLoopJson, loopJsonPath);

      // Assemble prompt for clay-ralph skill (include loop dir path so skill knows where to write)
      var craftingPrompt = "/clay-ralph\n## Task\n" + (wData.task || "") +
        "\n## Loop Directory\n" + lDir;

      // Create a new session for crafting
      var craftingSession = sm.createSession();
      var craftName = (loopState.wizardData && loopState.wizardData.name) || "";
      craftingSession.title = "Ralph" + (craftName ? " " + craftName : "") + " Crafting";
      craftingSession.ralphCraftingMode = true;
      sm.saveSessionFile(craftingSession);
      sm.switchSession(craftingSession.localId);
      sm.broadcastSessionList();
      loopState.craftingSessionId = craftingSession.localId;

      // Start .claude/ directory watcher
      startClaudeDirWatch();

      // Start query
      craftingSession.history.push({ type: "user_message", text: craftingPrompt });
      sm.appendToSessionFile(craftingSession, { type: "user_message", text: craftingPrompt });
      send({ type: "user_message", text: craftingPrompt });
      craftingSession.isProcessing = true;
      onProcessingChanged();
      craftingSession.sentToolResults = {};
      send({ type: "status", status: "processing" });
      sdk.startQuery(craftingSession, craftingPrompt);

      send({ type: "ralph_crafting_started", sessionId: craftingSession.localId });
      send({ type: "ralph_phase", phase: "crafting", wizardData: loopState.wizardData, craftingSessionId: craftingSession.localId });
      return;
    }

    if (msg.type === "ralph_preview_files") {
      var promptContent = "";
      var judgeContent = "";
      var previewDir = loopDir();
      if (previewDir) {
        try { promptContent = fs.readFileSync(path.join(previewDir, "PROMPT.md"), "utf8"); } catch (e) {}
        try { judgeContent = fs.readFileSync(path.join(previewDir, "JUDGE.md"), "utf8"); } catch (e) {}
      }
      sendTo(ws, {
        type: "ralph_files_content",
        prompt: promptContent,
        judge: judgeContent,
      });
      return;
    }

    if (msg.type === "ralph_wizard_cancel") {
      stopClaudeDirWatch();
      // Clean up loop directory
      var cancelDir = loopDir();
      if (cancelDir) {
        try { fs.rmSync(cancelDir, { recursive: true, force: true }); } catch (e) {}
      }
      clearLoopState();
      send({ type: "ralph_phase", phase: "idle", wizardData: null });
      return;
    }

    if (msg.type === "ralph_cancel_crafting") {
      // Abort the crafting session if running
      if (loopState.craftingSessionId != null) {
        var craftSession = sm.sessions.get(loopState.craftingSessionId) || null;
        if (craftSession && craftSession.abortController) {
          craftSession.abortController.abort();
        }
      }
      stopClaudeDirWatch();
      // Clean up loop directory
      var craftCancelDir = loopDir();
      if (craftCancelDir) {
        try { fs.rmSync(craftCancelDir, { recursive: true, force: true }); } catch (e) {}
      }
      clearLoopState();
      send({ type: "ralph_phase", phase: "idle", wizardData: null });
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
      onProcessingChanged();
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
    // File upload
    if (req.method === "POST" && urlPath === "/api/upload") {
      parseJsonBody(req).then(function (body) {
        var fileName = body.name;
        var fileData = body.data; // base64
        if (!fileName || !fileData) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing name or data"}');
          return;
        }
        // Sanitize filename — strip path separators
        var safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._\-\(\)\[\] ]/g, "_");
        if (!safeName) safeName = "upload";

        // Check size
        var estimatedBytes = fileData.length * 0.75;
        if (estimatedBytes > MAX_UPLOAD_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end('{"error":"file too large (max 50MB)"}');
          return;
        }

        // Create tmp dir: os.tmpdir()/clay-{hash}/
        var cwdHash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 12);
        var tmpDir = path.join(os.tmpdir(), "clay-" + cwdHash);
        try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}

        // Add timestamp prefix to avoid collisions
        var ts = Date.now();
        var destName = ts + "-" + safeName;
        var destPath = path.join(tmpDir, destName);

        try {
          var buf = Buffer.from(fileData, "base64");
          fs.writeFileSync(destPath, buf);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ path: destPath, name: safeName }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "failed to save: " + (e.message || e) }));
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

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

    // Install a skill (background spawn)
    if (req.method === "POST" && urlPath === "/api/install-skill") {
      parseJsonBody(req).then(function (body) {
        var url = body.url;
        var skill = body.skill;
        var scope = body.scope; // "global" or "project"
        if (!url || !skill || !scope) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing url, skill, or scope"}');
          return;
        }
        var spawnCwd = scope === "global" ? os.homedir() : cwd;
        var child = spawn("npx", ["skills", "add", url, "--skill", skill], {
          cwd: spawnCwd,
          stdio: "ignore",
          detached: false,
        });
        child.on("close", function (code) {
          var success = code === 0;
          send({
            type: "skill_installed",
            skill: skill,
            scope: scope,
            success: success,
            error: success ? null : "Process exited with code " + code,
          });
        });
        child.on("error", function (err) {
          send({
            type: "skill_installed",
            skill: skill,
            scope: scope,
            success: false,
            error: err.message,
          });
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Uninstall a skill (remove directory)
    if (req.method === "POST" && urlPath === "/api/uninstall-skill") {
      parseJsonBody(req).then(function (body) {
        var skill = body.skill;
        var scope = body.scope; // "global" or "project"
        if (!skill || !scope) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing skill or scope"}');
          return;
        }
        var baseDir = scope === "global" ? os.homedir() : cwd;
        var skillDir = path.join(baseDir, ".claude", "skills", skill);
        // Safety: ensure skillDir is inside the expected .claude/skills directory
        var expectedParent = path.join(baseDir, ".claude", "skills");
        var resolved = path.resolve(skillDir);
        if (!resolved.startsWith(expectedParent + path.sep)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill path"}');
          return;
        }
        try {
          fs.rmSync(resolved, { recursive: true, force: true });
          send({
            type: "skill_uninstalled",
            skill: skill,
            scope: scope,
            success: true,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (err) {
          send({
            type: "skill_uninstalled",
            skill: skill,
            scope: scope,
            success: false,
            error: err.message,
          });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Installed skills (global + project)
    if (req.method === "GET" && urlPath === "/api/installed-skills") {
      var installed = {};
      var globalDir = path.join(os.homedir(), ".claude", "skills");
      var projectDir = path.join(cwd, ".claude", "skills");
      var scanDirs = [
        { dir: globalDir, scope: "global" },
        { dir: projectDir, scope: "project" },
      ];
      for (var sd = 0; sd < scanDirs.length; sd++) {
        var entries;
        try { entries = fs.readdirSync(scanDirs[sd].dir, { withFileTypes: true }); } catch (e) { continue; }
        for (var si = 0; si < entries.length; si++) {
          var ent = entries[si];
          if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
          var mdPath = path.join(scanDirs[sd].dir, ent.name, "SKILL.md");
          try {
            var mdContent = fs.readFileSync(mdPath, "utf8");
            var desc = "";
            // Parse YAML frontmatter for description
            if (mdContent.startsWith("---")) {
              var endIdx = mdContent.indexOf("---", 3);
              if (endIdx !== -1) {
                var frontmatter = mdContent.substring(3, endIdx);
                var descMatch = frontmatter.match(/^description:\s*(.+)/m);
                if (descMatch) desc = descMatch[1].trim();
              }
            }
            if (!installed[ent.name]) {
              installed[ent.name] = { scope: scanDirs[sd].scope, description: desc, path: path.join(scanDirs[sd].dir, ent.name) };
            } else {
              // project-level adds to existing global entry
              installed[ent.name].scope = "both";
              if (desc && !installed[ent.name].description) installed[ent.name].description = desc;
            }
          } catch (e) {}
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ installed: installed }));
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
    // Cleanup tmp upload directory
    try {
      var cwdHash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 12);
      var tmpDir = path.join(os.tmpdir(), "clay-" + cwdHash);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
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
      icon: icon,
      clients: clients.size,
      sessions: sessionCount,
      isProcessing: hasProcessing,
    };
  }

  function setTitle(newTitle) {
    title = newTitle || null;
    send({ type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, lanHost: lanHost, projectCount: getProjectCount(), projects: getProjectList() });
  }

  function setIcon(newIcon) {
    icon = newIcon || null;
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
    setIcon: setIcon,
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
