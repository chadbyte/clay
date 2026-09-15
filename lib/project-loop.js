var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var { execFileSync } = require("child_process");
var { createLoopRegistry } = require("./scheduler");
var loopGuidance = require("./loop-guidance");
var validateCron = require("./schedule-validation").validateCron;
var validateScheduleRule = require("./schedule-rule").validateScheduleRule;
var attachLoopDurableSchedule = require("./loop-durable-schedule").attachLoopDurableSchedule;

/**
 * Attach loop engine to a project context.
 *
 * ctx fields:
 *   cwd, slug, sm, sdk, send, sendTo, sendToSession, pushModule,
 *   getHubSchedules, getLinuxUserForSession, onProcessingChanged,
 *   hydrateImageRefs
 */
function attachLoop(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var sm = ctx.sm;
  var sdk = ctx.sdk;
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var sendToSession = ctx.sendToSession;
  var pushModule = ctx.pushModule;
  var notificationsModule = ctx.notificationsModule;
  var getHubSchedules = ctx.getHubSchedules;
  var getLinuxUserForSession = ctx.getLinuxUserForSession;
  var onProcessingChanged = ctx.onProcessingChanged;
  var hydrateImageRefs = ctx.hydrateImageRefs;

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
    loopFilesId: null,
  };

  function loopDir() {
    var id = loopState.loopFilesId || loopState.loopId;
    if (!id) return null;
    return path.join(cwd, ".claude", "loops", id);
  }

  function generateLoopId() {
    return "loop_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
  }

  // Loop state persistence
  var _loopConfig = require("./config");
  var _loopUtils = require("./utils");
  var _loopDir = path.join(_loopConfig.CONFIG_DIR, "loops");
  var _loopEncodedCwd = _loopUtils.resolveEncodedFile(_loopDir, cwd, ".json");
  var _loopStatePath = ctx.loopStatePath || path.join(_loopDir, _loopEncodedCwd + ".json");

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
        loopFilesId: loopState.loopFilesId || null,
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
      loopState.loopFilesId = data.loopFilesId || null;
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
    // Recover orphaned loops: if idle but completed loop files exist in .claude/loops/
    if (loopState.phase === "idle") {
      var _loopsBase = path.join(cwd, ".claude", "loops");
      try {
        var _loopDirs = fs.readdirSync(_loopsBase).filter(function (d) {
          return d.indexOf("loop_") === 0;
        });
        for (var _li = 0; _li < _loopDirs.length; _li++) {
          var _ld = path.join(_loopsBase, _loopDirs[_li]);
          try {
            fs.accessSync(path.join(_ld, "PROMPT.md"));
            fs.accessSync(path.join(_ld, "LOOP.json"));
            var _loopCfg = JSON.parse(fs.readFileSync(path.join(_ld, "LOOP.json"), "utf8"));
            var _isSimple = _loopCfg.loopMode === "simple";
            if (!_isSimple) fs.accessSync(path.join(_ld, "JUDGE.md"));
            // Found a completed loop — recover to approval phase
            loopState.loopId = _loopDirs[_li];
            loopState.phase = "approval";
            loopState.maxIterations = _loopCfg.maxIterations || 20;
            if (!loopState.wizardData) loopState.wizardData = {};
            loopState.wizardData.loopMode = _loopCfg.loopMode || "judge";
            saveLoopState();
            console.log("[ralph-loop] Recovered orphaned loop: " + _loopDirs[_li]);
            break;
          } catch (e) {}
        }
      } catch (e) {}
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
    loopState.loopFilesId = null;
    saveLoopState();
  }

  function checkLoopFilesExist() {
    var dir = loopDir();
    if (!dir) return false;
    var hasPrompt = false;
    var hasJudge = false;
    try { fs.accessSync(path.join(dir, "PROMPT.md")); hasPrompt = true; } catch (e) {}
    try { fs.accessSync(path.join(dir, "JUDGE.md")); hasJudge = true; } catch (e) {}
    var isSimple = loopState.wizardData && loopState.wizardData.loopMode === "simple";
    return isSimple ? hasPrompt : (hasPrompt && hasJudge);
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
    var isSimple = loopState.wizardData && loopState.wizardData.loopMode === "simple";
    var bothReady = isSimple ? hasPrompt : (hasPrompt && hasJudge);
    send({
      type: "ralph_files_status",
      promptReady: hasPrompt,
      judgeReady: hasJudge,
      loopJsonReady: hasLoopJson,
      bothReady: bothReady,
      taskId: loopState.loopId,
    });
    // Auto-transition to approval phase when files are ready
    if (bothReady && loopState.phase === "crafting") {
      loopState.phase = "approval";
      saveLoopState();

      // Parse recommended title from crafting session conversation
      if (loopState.craftingSessionId && loopState.loopId) {
        var craftSess = sm.sessions.get(loopState.craftingSessionId);
        if (craftSess && craftSess.history) {
          for (var hi = craftSess.history.length - 1; hi >= 0; hi--) {
            var entry = craftSess.history[hi];
            var entryText = entry.text || "";
            var titleMatch = entryText.match(/\[\[LOOP_TITLE:\s*(.+?)\]\]/);
            if (titleMatch) {
              var suggestedTitle = titleMatch[1].trim();
              if (suggestedTitle) {
                loopRegistry.updateRecord(loopState.loopId, { name: suggestedTitle });
              }
              break;
            }
          }
        }
      }
    }
  }

  // Load persisted state on startup
  loadLoopState();

  // --- Loop Registry (unified one-off + scheduled) ---
  var activeRegistryId = null; // track which registry record triggered current loop
  var durableSchedule = null;
  function isMultiUser() { return typeof ctx.isMultiUser === "function" ? ctx.isMultiUser() : !!ctx.isMultiUser; }

  function legacyRuntimeFor(session) {
    var record = loopRegistry.getById(loopState.loopId);
    var linuxUser = getLinuxUserForSession(session);
    if (!isMultiUser()) return { ok: true, linuxUser: linuxUser };
    if (!record || !record.ownerId || session.ownerId !== record.ownerId) return { ok: false, error: "The scheduled Loop owner changed before execution." };
    if (ctx.authorizeScheduledRun && !ctx.authorizeScheduledRun(record)) return { ok: false, error: "The scheduled Loop owner is no longer authorized for this project." };
    if (ctx.requiresLinuxUser && ctx.requiresLinuxUser() && !linuxUser) return { ok: false, error: "The scheduled Loop owner no longer has a valid OS identity." };
    return { ok: true, linuxUser: linuxUser };
  }

  function rejectLegacyRuntime(session, error) {
    var message = error || "The scheduled Loop execution identity is no longer valid.";
    var entry = { type: "error", text: message };
    session.isProcessing = false; session.singleTurn = false; if (session.loop) session.loop.active = false;
    session.history.push(entry); sm.appendToSessionFile(session, entry); sm.saveSessionFile(session);
    sendToSession(session.localId, entry); sendToSession(session.localId, { type: "status", status: "idle" }); send({ type: "loop_error", text: message }); finishLoop("error");
  }

  function triggerFromQueue(record) {
    if (record.createdViaScheduledTasks && ctx.authorizeScheduledRun && !ctx.authorizeScheduledRun(record)) {
      console.error("[loop-registry] Scheduled task owner is no longer authorized: " + record.name);
      return;
    }
    // Linked calendar schedules use their task's files. Standalone Scheduled Tasks own theirs.
    var loopFilesId = record.id;
    if (record.source === "schedule") {
      var standaloneScheduledTask = record.createdViaScheduledTasks && record.mode === "simple" && !record.linkedTaskId;
      if (!record.linkedTaskId && !standaloneScheduledTask) {
        failScheduledDispatch("Schedule has no linked task: " + record.name);
      }
      if (record.linkedTaskId) {
        loopFilesId = record.linkedTaskId;
        console.log("[loop-registry] Schedule triggered: " + record.name + " -> linked task " + loopFilesId);
      }
    }

    // Verify the loop directory and PROMPT.md exist
    var recDir = path.join(cwd, ".claude", "loops", loopFilesId);
    try {
      fs.accessSync(path.join(recDir, "PROMPT.md"));
    } catch (e) {
      failScheduledDispatch("PROMPT.md is missing for " + loopFilesId + ".");
    }
    // Set the loopId to the schedule's own id (not the linked task) so sidebar groups correctly
    loopState.loopId = record.id;
    loopState.loopFilesId = loopFilesId;
    // Restore loopMode from LOOP.json so simple loops work correctly on trigger
    var _triggerCfg = {};
    try { _triggerCfg = JSON.parse(fs.readFileSync(path.join(recDir, "LOOP.json"), "utf8")); } catch (e) {}
    loopState.wizardData = { loopMode: _triggerCfg.loopMode || "judge" };
    activeRegistryId = record.id;
    console.log("[loop-registry] Auto-starting loop: " + record.name + " (" + loopState.loopId + ")");
    send({ type: "schedule_run_started", recordId: record.id });
    startLoop({ maxIterations: record.maxIterations, name: record.name });
  }

  function failScheduledDispatch(message) {
    console.error("[loop-registry] " + message);
    send({ type: "loop_error", text: message });
    var error = new Error(message); error.code = "SCHEDULE_DISPATCH_FAILED"; throw error;
  }

  function usesPairExecution(record) { return !!(record && (record.createdViaScheduledTasks === true || record.source === "schedule")); }

  var loopRegistry = createLoopRegistry({
    cwd: cwd,
    registryPath: ctx.loopRegistryPath,
    canTrigger: function (record) {
      if (!usesPairExecution(record)) return true;
      return ctx.canExecuteScheduledTask ? ctx.canExecuteScheduledTask(record) : false;
    },
    prepareTrigger: function (record) {
      if (!usesPairExecution(record)) return null;
      return ctx.prepareScheduledTask ? ctx.prepareScheduledTask(record, "schedule") : { ok: false };
    },
    onTrigger: function (record, prepared) {
      if (usesPairExecution(record)) {
        if (prepared && (prepared.skipped || prepared.queued)) return;
        var scheduledResult = ctx.executeScheduledTask && ctx.executeScheduledTask(record, "schedule", prepared);
        if (!scheduledResult || !scheduledResult.ok) failScheduledDispatch("Pair execution did not start: " + (scheduledResult && scheduledResult.error || record.name));
        return;
      }
      // A busy non-skipping occurrence remains queued in the durable scheduler.
      if (loopState.active || loopState.phase === "executing") {
        if (record.skipIfRunning !== false) {
          console.log("[loop-registry] Skipping trigger for " + record.name + " — loop already active (skipIfRunning)");
          return;
        }
        return;
      }

      triggerFromQueue(record);
    },
    onChange: function () {
      if (durableSchedule) durableSchedule.sync();
      send({ type: "loop_registry_updated", records: getHubSchedules() });
    },
    onRunTerminal: ctx.onScheduledRunTerminal,
  });
  loopRegistry.load();
  if (ctx.durableScheduler) {
    durableSchedule = attachLoopDurableSchedule({
      scheduler: ctx.durableScheduler,
      registry: loopRegistry,
      projectId: slug,
      isMultiUser: ctx.isMultiUser,
      authorize: function (record) {
        if (!isMultiUser() && !usesPairExecution(record)) return true;
        return !ctx.authorizeScheduledRun || ctx.authorizeScheduledRun(record);
      },
      canRun: function (record) {
        if (usesPairExecution(record)) return ctx.canExecuteScheduledTask ? ctx.canExecuteScheduledTask(record) : false;
        return !(record.skipIfRunning === false && (loopState.active || loopState.phase === "executing"));
      },
    });
  } else loopRegistry.startTimer();

  // Wire loop info resolution for session list broadcasts
  sm.setResolveLoopInfo(function (loopId) {
    var rec = loopRegistry.getById(loopId);
    if (!rec) return null;
    return { name: rec.name || null, source: rec.source || null };
  });

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
      judgeText = null;
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

    var isSimple = loopState.wizardData && loopState.wizardData.loopMode === "simple";
    loopState.active = true;
    loopState.phase = "executing";
    loopState.promptText = promptText;
    loopState.judgeText = isSimple ? null : judgeText;
    loopState.iteration = 0;
    if (isSimple) {
      loopState.maxIterations = (loopOpts.maxIterations >= 1 ? loopOpts.maxIterations : null) || loopConfig.maxIterations || 5;
    } else {
      loopState.maxIterations = judgeText ? ((loopOpts.maxIterations >= 1 ? loopOpts.maxIterations : null) || loopConfig.maxIterations || 20) : 1;
    }
    loopState.baseCommit = baseCommit;
    loopState.currentSessionId = null;
    loopState.judgeSessionId = null;
    loopState.results = [];
    loopState.stopping = false;
    loopState.name = loopOpts.name || null;
    loopState.settings = loopConfig.settings || null;
    loopState.startedAt = Date.now();
    saveLoopState();

    stopClaudeDirWatch();

    send({ type: "loop_started", maxIterations: loopState.maxIterations, name: loopState.name });
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

    var loopSource = loopRegistry.getById(loopState.loopId);
    var session = sm.createSession({ ownerId: loopSource && loopSource.ownerId || null });
    var loopName = (loopState.wizardData && loopState.wizardData.name) || (loopSource && loopSource.name) || "";
    var loopSourceTag = (loopSource && loopSource.source) || null;
    var isRalphLoop = loopSourceTag === "ralph";
    session.loop = { active: true, iteration: loopState.iteration, role: "coder", loopId: loopState.loopId, name: loopName, source: loopSourceTag, startedAt: loopState.startedAt };
    session.title = (isRalphLoop ? "Ralph" : "Task") + (loopName ? " " + loopName : "") + " #" + loopState.iteration;
    sm.saveSessionFile(session);
    sm.broadcastSessionList();

    loopState.currentSessionId = session.localId;

    send({
      type: "loop_iteration",
      iteration: loopState.iteration,
      maxIterations: loopState.maxIterations,
      sessionId: session.localId,
    });
    var coderRuntime = legacyRuntimeFor(session);
    if (!coderRuntime.ok) { rejectLegacyRuntime(session, coderRuntime.error); return; }

    var coderCompleted = false;
    session.onQueryComplete = function(completedSession) {
      if (coderCompleted) return;
      coderCompleted = true;
      if (coderWatchdog) { clearTimeout(coderWatchdog); coderWatchdog = null; }
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
      var _isSimple = loopState.wizardData && loopState.wizardData.loopMode === "simple";
      if (_isSimple) {
        // Simple mode: no judge, proceed to next iteration or finish
        if (loopState.iteration >= loopState.maxIterations) {
          finishLoop("complete");
        } else {
          setTimeout(function() { runNextIteration(); }, 1000);
        }
      } else if (loopState.judgeText && loopState.maxIterations > 1) {
        runJudge();
      } else {
        finishLoop("pass");
      }
    };

    // Watchdog: if onQueryComplete hasn't fired after 10 minutes, force error and retry
    var coderWatchdog = setTimeout(function() {
      if (!coderCompleted && loopState.active && !loopState.stopping) {
        console.error("[ralph-loop] Coder #" + loopState.iteration + " watchdog triggered — onQueryComplete never fired");
        coderCompleted = true;
        loopState.results.push({
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Coder session timed out (no completion signal)",
        });
        send({
          type: "loop_verdict",
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Coder session timed out, retrying...",
        });
        setTimeout(function() { runNextIteration(); }, 2000);
      }
    }, 10 * 60 * 1000);

    var userMsg = { type: "user_message", text: loopState.promptText };
    session.history.push(userMsg);
    sm.appendToSessionFile(session, userMsg);

    session.isProcessing = true;
    onProcessingChanged();
    session.sentToolResults = {};
    sendToSession(session.localId, { type: "status", status: "processing" });
    session.acceptEditsAfterStart = true;
    session.singleTurn = true;
    if (loopState.settings) session.loopSettings = loopState.settings;
    sdk.startQuery(session, loopState.promptText, undefined, coderRuntime.linuxUser);
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

    var gitLog = "";
    try {
      gitLog = execFileSync("git", ["log", "--oneline", loopState.baseCommit + "..HEAD"], {
        cwd: cwd, encoding: "utf8", timeout: 10000,
      }).trim();
    } catch (e) {}

    var judgePrompt = "You are a judge evaluating whether a coding task has been completed.\n\n" +
      "## Original Task (PROMPT.md)\n\n" + loopState.promptText + "\n\n" +
      "## Evaluation Criteria (JUDGE.md)\n\n" + loopState.judgeText + "\n\n" +
      "## Commit History\n\n```\n" + (gitLog || "(no commits yet)") + "\n```\n\n" +
      "## Changes Made (git diff)\n\n```diff\n" + diff + "\n```\n\n" +
      "Based on the evaluation criteria, has the task been completed successfully?\n\n" +
      "IMPORTANT: The git diff above may not show everything. If criteria involve checking whether " +
      "specific files, classes, or features exist, use tools (Read, Glob, Grep, Bash) to verify " +
      "directly in the codebase. Do NOT assume something is missing just because it is not in the diff.\n\n" +
      "After your evaluation, respond with exactly one of:\n" +
      "- PASS: [brief explanation]\n" +
      "- FAIL: [brief explanation of what is still missing]";

    var judgeSource = loopRegistry.getById(loopState.loopId);
    var judgeSession = sm.createSession({ ownerId: judgeSource && judgeSource.ownerId || null });
    var judgeName = (loopState.wizardData && loopState.wizardData.name) || (judgeSource && judgeSource.name) || "";
    var judgeSourceTag = (judgeSource && judgeSource.source) || null;
    var isRalphJudge = judgeSourceTag === "ralph";
    judgeSession.loop = { active: true, iteration: loopState.iteration, role: "judge", loopId: loopState.loopId, name: judgeName, source: judgeSourceTag, startedAt: loopState.startedAt };
    judgeSession.title = (isRalphJudge ? "Ralph" : "Task") + (judgeName ? " " + judgeName : "") + " Judge #" + loopState.iteration;
    sm.saveSessionFile(judgeSession);
    sm.broadcastSessionList();
    loopState.judgeSessionId = judgeSession.localId;

    send({
      type: "loop_judging",
      iteration: loopState.iteration,
      sessionId: judgeSession.localId,
    });
    var judgeRuntime = legacyRuntimeFor(judgeSession);
    if (!judgeRuntime.ok) { rejectLegacyRuntime(judgeSession, judgeRuntime.error); return; }

    var judgeCompleted = false;
    judgeSession.onQueryComplete = function(completedSession) {
      if (judgeCompleted) return;
      judgeCompleted = true;
      if (judgeWatchdog) { clearTimeout(judgeWatchdog); judgeWatchdog = null; }
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

    // Watchdog: judge may use tools to verify, so allow more time
    var judgeWatchdog = setTimeout(function() {
      if (!judgeCompleted && loopState.active && !loopState.stopping) {
        console.error("[ralph-loop] Judge #" + loopState.iteration + " watchdog triggered — onQueryComplete never fired");
        judgeCompleted = true;
        loopState.results.push({
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Judge session timed out (no completion signal)",
        });
        send({
          type: "loop_verdict",
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Judge session timed out, retrying...",
        });
        setTimeout(function() { runNextIteration(); }, 2000);
      }
    }, 10 * 60 * 1000);

    var userMsg = { type: "user_message", text: judgePrompt };
    judgeSession.history.push(userMsg);
    sm.appendToSessionFile(judgeSession, userMsg);

    judgeSession.isProcessing = true;
    onProcessingChanged();
    judgeSession.sentToolResults = {};
    judgeSession.acceptEditsAfterStart = true;
    judgeSession.singleTurn = true;
    if (loopState.settings) judgeSession.loopSettings = loopState.settings;
    sdk.startQuery(judgeSession, judgePrompt, undefined, judgeRuntime.linuxUser);
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

    // Unlock the last coder session so users can continue interacting with it
    if (loopState.currentSessionId) {
      var lastCoderSession = sm.sessions.get(loopState.currentSessionId);
      if (lastCoderSession) {
        lastCoderSession.singleTurn = false;
        lastCoderSession.loop.active = false;
      }
    }

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

    // Record result in loop registry
    if (loopState.loopId) {
      loopRegistry.recordRun(loopState.loopId, {
        reason: reason,
        startedAt: loopState.startedAt,
        iterations: loopState.iteration,
      });
    }
    if (activeRegistryId) {
      send({ type: "schedule_run_finished", recordId: activeRegistryId, reason: reason, iterations: loopState.iteration });
      activeRegistryId = null;
    }

    if (pushModule) {
      var _finishBody = reason === "pass" || reason === "complete"
        ? "Completed after " + loopState.iteration + " iteration(s)"
        : reason === "max_iterations"
          ? "Reached max iterations (" + loopState.maxIterations + ")"
          : reason === "stopped" ? "Stopped by user" : "Ended due to error";
      pushModule.sendPush({
        type: "done", slug: slug, title: "Loop Complete", body: _finishBody, tag: "ralph-loop-done",
      });
    }

    if (notificationsModule) {
      notificationsModule.notify("loop_complete", {
        reason: reason,
        name: loopState.name,
        iterations: loopState.iteration,
        maxIterations: loopState.maxIterations,
        sessionId: loopState.currentSessionId,
      });
    }

    if (durableSchedule) durableSchedule.wake();
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
    var _isSimpleResume = loopState.wizardData && loopState.wizardData.loopMode === "simple";
    if (!_isSimpleResume) {
      try {
        loopState.judgeText = fs.readFileSync(path.join(dir, "JUDGE.md"), "utf8");
      } catch (e) {
        console.error("[ralph-loop] Cannot resume: missing JUDGE.md");
        loopState.active = false;
        loopState.phase = "idle";
        saveLoopState();
        return;
      }
    } else {
      loopState.judgeText = null;
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

  // --- Message handler for loop-related messages ---
  function handleLoopMessage(ws, msg) {
    if (msg.type === "loop_start") {
      // If this loop has a cron schedule, don't run immediately
      if (loopState.wizardData && loopState.wizardData.cron) {
        loopState.active = false;
        loopState.phase = "done";
        saveLoopState();
        send({ type: "loop_finished", reason: "scheduled", iterations: 0, results: [] });
        send({ type: "ralph_phase", phase: "idle", wizardData: null });
        send({ type: "loop_scheduled", recordId: loopState.loopId, cron: loopState.wizardData.cron });
        return true;
      }
      // Save per-loop settings to LOOP.json if provided
      if (msg.settings && Object.keys(msg.settings).length > 0) {
        var lDir3 = loopDir();
        if (lDir3) {
          var ljPath = path.join(lDir3, "LOOP.json");
          var lj = {};
          try { lj = JSON.parse(fs.readFileSync(ljPath, "utf8")); } catch (e) {}
          lj.settings = msg.settings;
          fs.writeFileSync(ljPath, JSON.stringify(lj, null, 2), "utf8");
        }
      }
      startLoop({ maxIterations: msg.maxIterations });
      return true;
    }

    if (msg.type === "loop_stop") {
      stopLoop();
      return true;
    }

    if (msg.type === "ralph_wizard_complete") {
      var wData = msg.data || {};
      var maxIter = wData.maxIterations || null;
      var wizardCron = wData.cron || null;
      var newLoopId = generateLoopId();
      loopState.loopId = newLoopId;
      var recordSource = wData.source === "task" ? null : "ralph";
      loopState.wizardData = {
        name: wData.name || wData.task || "Untitled",
        task: wData.task || "",
        maxIterations: maxIter,
        cron: wizardCron,
        loopMode: wData.loopMode || "judge",
        promptAuthor: wData.promptAuthor || "clay",
        judgeAuthor: wData.judgeAuthor || null,
        source: recordSource,
      };
      loopState.phase = "crafting";
      loopState.startedAt = Date.now();
      saveLoopState();

      // Register in loop registry
      loopRegistry.register({
        id: newLoopId,
        name: loopState.wizardData.name,
        task: wData.task || "",
        cron: wizardCron,
        enabled: wizardCron ? true : false,
        maxIterations: maxIter,
        source: recordSource,
      });

      // Create loop directory and write LOOP.json
      var lDir = loopDir();
      try { fs.mkdirSync(lDir, { recursive: true }); } catch (e) {}
      var loopJsonPath = path.join(lDir, "LOOP.json");
      var tmpLoopJson = loopJsonPath + ".tmp";
      fs.writeFileSync(tmpLoopJson, JSON.stringify({ maxIterations: maxIter, loopMode: wData.loopMode || "judge" }, null, 2));
      fs.renameSync(tmpLoopJson, loopJsonPath);

      var craftName = (loopState.wizardData && loopState.wizardData.name) || "";
      var isRalphCraft = recordSource === "ralph";

      // User provided their own PROMPT.md (and optionally JUDGE.md)
      if (wData.mode === "own" && wData.promptText) {
        // Write PROMPT.md
        var promptPath = path.join(lDir, "PROMPT.md");
        var tmpPrompt = promptPath + ".tmp";
        fs.writeFileSync(tmpPrompt, wData.promptText);
        fs.renameSync(tmpPrompt, promptPath);

        if (wData.judgeText) {
          // Both provided: write JUDGE.md too
          var judgePath = path.join(lDir, "JUDGE.md");
          var tmpJudge = judgePath + ".tmp";
          fs.writeFileSync(tmpJudge, wData.judgeText);
          fs.renameSync(tmpJudge, judgePath);
        } else if (wData.loopMode === "simple" || !recordSource) {
          // Simple loop or scheduled task with no judge: go straight to approval
          loopState.phase = "approval";
          saveLoopState();
          send({ type: "ralph_phase", phase: "approval", source: recordSource, wizardData: loopState.wizardData });
          send({ type: "ralph_files_status", promptReady: true, judgeReady: false, bothReady: true });
          return true;
        } else {
          // Ralph with judge mode but no judge provided: start a crafting session to create JUDGE.md
          loopState.phase = "crafting";
          saveLoopState();

          var judgeCraftPrompt = loopGuidance.legacyCraftPrompt({ judgeOnly: true, task: wData.task, directory: lDir });

          var judgeCraftSession = sm.createSession();
          judgeCraftSession.title = (isRalphCraft ? "Ralph" : "Task") + (craftName ? " " + craftName : "") + " Crafting";
          judgeCraftSession.ralphCraftingMode = true;
          judgeCraftSession.loop = { active: true, iteration: 0, role: "crafting", loopId: newLoopId, name: craftName, source: recordSource, startedAt: loopState.startedAt };
          sm.saveSessionFile(judgeCraftSession);
          sm.switchSession(judgeCraftSession.localId, null, hydrateImageRefs);
          loopState.craftingSessionId = judgeCraftSession.localId;

          loopRegistry.updateRecord(newLoopId, { craftingSessionId: judgeCraftSession.localId });

          startClaudeDirWatch();

          judgeCraftSession.history.push({ type: "user_message", text: judgeCraftPrompt });
          sm.appendToSessionFile(judgeCraftSession, { type: "user_message", text: judgeCraftPrompt });
          sendToSession(judgeCraftSession.localId, { type: "user_message", text: judgeCraftPrompt });
          judgeCraftSession.isProcessing = true;
          onProcessingChanged();
          judgeCraftSession.sentToolResults = {};
          sendToSession(judgeCraftSession.localId, { type: "status", status: "processing" });
          sdk.startQuery(judgeCraftSession, judgeCraftPrompt, undefined, getLinuxUserForSession(judgeCraftSession));

          send({ type: "ralph_crafting_started", sessionId: judgeCraftSession.localId, taskId: newLoopId, source: recordSource });
          send({ type: "ralph_phase", phase: "crafting", wizardData: loopState.wizardData, craftingSessionId: judgeCraftSession.localId });
          send({ type: "ralph_files_status", promptReady: true, judgeReady: false, bothReady: false });
          return true;
        }

        // Both prompt and judge provided: go straight to approval
        loopState.phase = "approval";
        saveLoopState();
        send({ type: "ralph_phase", phase: "approval", source: recordSource, wizardData: loopState.wizardData });
        send({ type: "ralph_files_status", promptReady: true, judgeReady: true, bothReady: true });
        return true;
      }

      // Default: "draft" mode — Clay crafts legacy PROMPT.md/JUDGE.md files
      var _draftIsSimple = wData.loopMode === "simple";
      var craftingPrompt = loopGuidance.legacyCraftPrompt({ simple: _draftIsSimple, userJudge: wData.judgeAuthor === "me", task: wData.task, directory: lDir });

      // Pre-write user-provided files before crafting starts
      if (wData.judgeText && wData.judgeAuthor === "me") {
        var _judgePathDraft = path.join(lDir, "JUDGE.md");
        var _tmpJudgeDraft = _judgePathDraft + ".tmp";
        fs.writeFileSync(_tmpJudgeDraft, wData.judgeText);
        fs.renameSync(_tmpJudgeDraft, _judgePathDraft);
      }

      // Create a new session for crafting
      var craftingSession = sm.createSession();
      craftingSession.title = (isRalphCraft ? "Ralph" : "Task") + (craftName ? " " + craftName : "") + " Crafting";
      craftingSession.ralphCraftingMode = true;
      craftingSession.loop = { active: true, iteration: 0, role: "crafting", loopId: newLoopId, name: craftName, source: recordSource, startedAt: loopState.startedAt };
      sm.saveSessionFile(craftingSession);
      sm.switchSession(craftingSession.localId, null, hydrateImageRefs);
      loopState.craftingSessionId = craftingSession.localId;

      // Store crafting session ID in the registry record
      loopRegistry.updateRecord(newLoopId, { craftingSessionId: craftingSession.localId });

      // Start .claude/ directory watcher
      startClaudeDirWatch();

      // Send crafting prompt and start the conversation with Claude.
      craftingSession.history.push({ type: "user_message", text: craftingPrompt });
      sm.appendToSessionFile(craftingSession, { type: "user_message", text: craftingPrompt });
      sendToSession(craftingSession.localId, { type: "user_message", text: craftingPrompt });
      craftingSession.isProcessing = true;
      onProcessingChanged();
      craftingSession.sentToolResults = {};
      sendToSession(craftingSession.localId, { type: "status", status: "processing" });
      sdk.startQuery(craftingSession, craftingPrompt, undefined, getLinuxUserForSession(craftingSession));

      send({ type: "ralph_crafting_started", sessionId: craftingSession.localId, taskId: newLoopId, source: recordSource });
      send({ type: "ralph_phase", phase: "crafting", wizardData: loopState.wizardData, craftingSessionId: craftingSession.localId });
      return true;
    }

    if (msg.type === "loop_registry_files") {
      var recId = msg.id;
      var lDir = path.join(cwd, ".claude", "loops", recId);
      var promptContent = "";
      var judgeContent = "";
      var loopSettings = null;
      try { promptContent = fs.readFileSync(path.join(lDir, "PROMPT.md"), "utf8"); } catch (e) {}
      try { judgeContent = fs.readFileSync(path.join(lDir, "JUDGE.md"), "utf8"); } catch (e) {}
      try {
        var loopJson = JSON.parse(fs.readFileSync(path.join(lDir, "LOOP.json"), "utf8"));
        loopSettings = loopJson.settings || null;
      } catch (e) {}
      send({
        type: "loop_registry_files_content",
        id: recId,
        prompt: promptContent,
        judge: judgeContent,
        settings: loopSettings,
      });
      return true;
    }

    if (msg.type === "loop_registry_save_files") {
      var recId2 = msg.id;
      var lDir2 = path.join(cwd, ".claude", "loops", recId2);
      try {
        fs.mkdirSync(lDir2, { recursive: true });
        if (msg.prompt !== undefined) {
          fs.writeFileSync(path.join(lDir2, "PROMPT.md"), msg.prompt, "utf8");
        }
        if (msg.judge !== undefined) {
          fs.writeFileSync(path.join(lDir2, "JUDGE.md"), msg.judge, "utf8");
        }
        if (msg.settings !== undefined) {
          var loopJsonPath2 = path.join(lDir2, "LOOP.json");
          var loopJson2 = {};
          try { loopJson2 = JSON.parse(fs.readFileSync(loopJsonPath2, "utf8")); } catch (e) {}
          loopJson2.settings = msg.settings;
          fs.writeFileSync(loopJsonPath2, JSON.stringify(loopJson2, null, 2), "utf8");
        }
        send({ type: "loop_registry_save_files_result", id: recId2, ok: true });
        // Re-send updated content so the UI refreshes
        var updatedPrompt = "";
        var updatedJudge = "";
        var updatedSettings = null;
        try { updatedPrompt = fs.readFileSync(path.join(lDir2, "PROMPT.md"), "utf8"); } catch (e) {}
        try { updatedJudge = fs.readFileSync(path.join(lDir2, "JUDGE.md"), "utf8"); } catch (e) {}
        try {
          var uj = JSON.parse(fs.readFileSync(path.join(lDir2, "LOOP.json"), "utf8"));
          updatedSettings = uj.settings || null;
        } catch (e) {}
        send({ type: "loop_registry_files_content", id: recId2, prompt: updatedPrompt, judge: updatedJudge, settings: updatedSettings });
      } catch (e) {
        send({ type: "loop_registry_save_files_result", id: recId2, ok: false, error: e.message });
      }
      return true;
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
      return true;
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
      return true;
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
      return true;
    }

    // --- Schedule create (from calendar click) ---
    if (msg.type === "schedule_create") {
      var sData = msg.data || {};
      var scheduleActor = ctx.getScheduleActor ? ctx.getScheduleActor(ws) : { ownerId: null, ownerName: null, sessionId: null };
      if (!scheduleActor) {
        sendTo(ws, { type: "loop_registry_error", text: "The schedule owner could not be verified." });
        return true;
      }
      if (sData.cron) {
        var scheduleCreateCron = validateCron(sData.cron);
        if (!scheduleCreateCron.ok) {
          sendTo(ws, { type: "loop_registry_error", text: scheduleCreateCron.error });
          return true;
        }
        sData.cron = scheduleCreateCron.cron;
      }
      if (sData.scheduleRule) {
        var scheduleCreateRule = validateScheduleRule(sData.scheduleRule);
        if (!scheduleCreateRule.ok) {
          sendTo(ws, { type: "loop_registry_error", text: scheduleCreateRule.error });
          return true;
        }
        sData.scheduleRule = scheduleCreateRule.value;
      }
      loopRegistry.register({
        name: sData.name || "Untitled",
        task: sData.name || "",
        description: sData.description || "",
        date: sData.date || null,
        time: sData.time || null,
        allDay: sData.allDay !== undefined ? sData.allDay : true,
        linkedTaskId: sData.taskId || null,
        cron: sData.cron || null,
        enabled: sData.cron ? (sData.enabled !== false) : false,
        maxIterations: sData.maxIterations || 3,
        source: "schedule",
        color: sData.color || null,
        recurrenceEnd: sData.recurrenceEnd || null,
        skipIfRunning: sData.skipIfRunning !== undefined ? sData.skipIfRunning : true,
        intervalEnd: sData.intervalEnd || null,
        scheduleRule: sData.scheduleRule || null,
        ownerId: scheduleActor.ownerId,
        ownerName: scheduleActor.ownerName,
        sessionId: scheduleActor.sessionId,
        createdViaScheduledTasks: true,
      });
      return true;
    }

    // --- Hub: cross-project schedule aggregation ---
    if (msg.type === "hub_schedules_list") {
      sendTo(ws, { type: "hub_schedules", schedules: getHubSchedules() });
      return true;
    }

    // --- Loop Registry messages ---
    if (msg.type === "loop_registry_list") {
      sendTo(ws, { type: "loop_registry_updated", records: getHubSchedules() });
      return true;
    }

    if (msg.type === "loop_registry_update") {
      if (msg.data && msg.data.cron !== undefined && msg.data.cron !== null) {
        var scheduleUpdateCron = validateCron(msg.data.cron);
        if (!scheduleUpdateCron.ok) {
          sendTo(ws, { type: "loop_registry_error", text: scheduleUpdateCron.error });
          return true;
        }
        msg.data.cron = scheduleUpdateCron.cron;
      }
      if (msg.data && msg.data.scheduleRule) {
        var scheduleUpdateRule = validateScheduleRule(msg.data.scheduleRule);
        if (!scheduleUpdateRule.ok) {
          sendTo(ws, { type: "loop_registry_error", text: scheduleUpdateRule.error });
          return true;
        }
        msg.data.scheduleRule = scheduleUpdateRule.value;
      }
      var registryUpdateData = Object.assign({}, msg.data || {});
      delete registryUpdateData.ownerId;
      delete registryUpdateData.ownerName;
      delete registryUpdateData.sessionId;
      delete registryUpdateData.createdViaScheduledTasks;
      var updatedRec = loopRegistry.update(msg.id, registryUpdateData);
      if (!updatedRec) {
        sendTo(ws, { type: "loop_registry_error", text: "Record not found" });
      }
      return true;
    }

    if (msg.type === "loop_registry_rename") {
      if (msg.id && msg.name) {
        loopRegistry.updateRecord(msg.id, { name: String(msg.name).substring(0, 100) });
        sm.broadcastSessionList();
      }
      return true;
    }

    if (msg.type === "loop_registry_remove") {
      var removedRec = loopRegistry.remove(msg.id);
      if (!removedRec) {
        sendTo(ws, { type: "loop_registry_error", text: "Record not found" });
      }
      return true;
    }

    if (msg.type === "loop_registry_convert") {
      // Convert ralph source to regular task (remove source tag)
      if (msg.id) {
        loopRegistry.updateRecord(msg.id, { source: null });
        sm.broadcastSessionList();
      }
      return true;
    }

    if (msg.type === "delete_loop_group") {
      // Delete all sessions belonging to this loopId, then remove registry record
      var loopIdToDel = msg.loopId;
      if (!loopIdToDel) return true;
      var sessionIds = [];
      sm.sessions.forEach(function (s, lid) {
        if (s.loop && s.loop.loopId === loopIdToDel) sessionIds.push(lid);
      });
      for (var di = 0; di < sessionIds.length; di++) {
        sm.deleteSessionQuiet(sessionIds[di]);
      }
      loopRegistry.remove(loopIdToDel);
      sm.broadcastSessionList();
      return true;
    }

    if (msg.type === "loop_registry_toggle") {
      var toggledRec = loopRegistry.toggleEnabled(msg.id);
      if (!toggledRec) {
        sendTo(ws, { type: "loop_registry_error", text: "Record not found or not scheduled" });
      }
      return true;
    }

    if (msg.type === "loop_registry_rerun") {
      // Re-run an existing job (one-off from library)
      var rerunRec = loopRegistry.getById(msg.id);
      if (!rerunRec) {
        sendTo(ws, { type: "loop_registry_error", text: "Record not found" });
        return true;
      }
      if (usesPairExecution(rerunRec)) {
        var pairRun = ctx.executeScheduledTask && ctx.executeScheduledTask(rerunRec, "manual");
        if (!pairRun || !pairRun.ok) sendTo(ws, { type: "loop_registry_error", text: pairRun && pairRun.error || "The scheduled pair could not start." });
        return true;
      }
      if (loopState.active || loopState.phase === "executing") {
        sendTo(ws, { type: "loop_registry_error", text: "A loop is already running" });
        return true;
      }
      var rerunDir = path.join(cwd, ".claude", "loops", rerunRec.id);
      try {
        fs.accessSync(path.join(rerunDir, "PROMPT.md"));
      } catch (e) {
        sendTo(ws, { type: "loop_registry_error", text: "PROMPT.md missing for " + rerunRec.id });
        return true;
      }
      loopState.loopId = rerunRec.id;
      loopState.loopFilesId = null;
      activeRegistryId = null; // not a scheduled trigger
      send({ type: "loop_rerun_started", recordId: rerunRec.id });
      startLoop();
      return true;
    }

    return false; // not handled
  }

  // --- Connection state: send loop state to newly connected client ---
  function sendConnectionState(ws) {
    // Ralph Loop availability
    var _connIsSimple = loopState.wizardData && loopState.wizardData.loopMode === "simple";
    var hasLoopFiles = false;
    try {
      fs.accessSync(path.join(cwd, ".claude", "PROMPT.md"));
      if (!_connIsSimple) fs.accessSync(path.join(cwd, ".claude", "JUDGE.md"));
      hasLoopFiles = true;
    } catch (e) {}
    // Also check loop directory files
    if (!hasLoopFiles && loopState.loopId) {
      var _avDir = loopDir();
      if (_avDir) {
        try {
          fs.accessSync(path.join(_avDir, "PROMPT.md"));
          if (!_connIsSimple) fs.accessSync(path.join(_avDir, "JUDGE.md"));
          hasLoopFiles = true;
        } catch (e) {}
      }
    }
    sendTo(ws, {
      type: "loop_available",
      available: hasLoopFiles,
      active: loopState.active,
      iteration: loopState.iteration,
      maxIterations: loopState.maxIterations,
      name: loopState.name || null,
    });

    // Ralph phase state
    // Derive source from wizardData for reconnect (so client can distinguish ralph vs task)
    var _connSource = loopState.wizardData ? (loopState.wizardData.source || null) : null;
    sendTo(ws, {
      type: "ralph_phase",
      phase: loopState.phase,
      wizardData: loopState.wizardData,
      craftingSessionId: loopState.craftingSessionId || null,
      source: _connSource,
    });
    if (loopState.phase === "crafting" || loopState.phase === "approval") {
      var _hasPrompt = false;
      var _hasJudge = false;
      var _lDir = loopDir();
      if (_lDir) {
        try { fs.accessSync(path.join(_lDir, "PROMPT.md")); _hasPrompt = true; } catch (e) {}
        try { fs.accessSync(path.join(_lDir, "JUDGE.md")); _hasJudge = true; } catch (e) {}
      }
      var _connBothReady = _connIsSimple ? _hasPrompt : (_hasPrompt && _hasJudge);
      sendTo(ws, {
        type: "ralph_files_status",
        promptReady: _hasPrompt,
        judgeReady: _hasJudge,
        bothReady: _connBothReady,
        taskId: loopState.loopId,
      });
    }
  }

  // --- Public API ---
  return {
    loopState: loopState,
    loopRegistry: loopRegistry,
    loopDir: loopDir,
    startLoop: startLoop,
    stopLoop: stopLoop,
    resumeLoop: resumeLoop,
    handleLoopMessage: handleLoopMessage,
    sendConnectionState: sendConnectionState,
    stopClaudeDirWatch: stopClaudeDirWatch,
    getSchedules: function () { return loopRegistry.getAll(); },
    importSchedule: function (data) { return loopRegistry.register(data); },
    removeSchedule: function (id) { return loopRegistry.remove(id); },
    stopTimer: function () { if (durableSchedule) durableSchedule.shutdown(); else loopRegistry.stopTimer(); },
  };
}

module.exports = { attachLoop: attachLoop };
