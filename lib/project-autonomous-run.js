var crypto = require("crypto");
var driverEligibility = require("./session-driver-eligibility");

var DEFAULT_CONTINUATIONS = 10;
var DEFAULT_MINUTES = 60;
var ACTIVE_STATES = ["armed", "running", "reviewing", "waiting-worker", "waiting-user", "paused"];
var TERMINAL_STATES = ["completed", "stopped", "limit", "error"];

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().substring(0, max) : "";
}

function boundedInt(value, fallback, max) {
  var number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(max, Math.floor(number))) : fallback;
}

function cleanCriteria(value) {
  var criteria = Array.isArray(value) ? value : [];
  return criteria.slice(0, 10).map(function (item) { return cleanText(item, 1000); }).filter(Boolean);
}

function project(run) {
  if (!run) return null;
  return {
    id: run.id, state: run.state, objective: run.objective || "",
    successCriteria: run.successCriteria || [], continuationCount: run.continuationCount || 0,
    maxContinuations: run.maxContinuations, startedAt: run.startedAt || null,
    deadlineAt: run.deadlineAt || null, maxMinutes: run.maxMinutes,
    waitingReason: run.waitingReason || "", terminalReason: run.terminalReason || "",
    outcome: run.outcome || null, pausedAfterRestart: !!run.pausedAfterRestart,
    armToken: run.state === "armed" ? run.armToken : undefined,
  };
}

function restoreStoredRun(value) {
  if (!value || typeof value !== "object" || ACTIVE_STATES.concat(TERMINAL_STATES).indexOf(value.state) === -1) return null;
  var criteria = cleanCriteria(value.successCriteria);
  var evidence = value.outcome && Array.isArray(value.outcome.evidence) ? value.outcome.evidence.slice(0, 20).map(function (item) { return cleanText(item, 2000); }).filter(Boolean) : [];
  var assessments = value.outcome && Array.isArray(value.outcome.criteria) ? value.outcome.criteria.slice(0, 10).map(function (item) {
    return item && { criterion: cleanText(item.criterion, 1000), met: item.met === true, evidence: cleanText(item.evidence, 2000) };
  }).filter(function (item) { return item && item.criterion && item.evidence; }) : [];
  var snapshot = value.permissionSnapshot && typeof value.permissionSnapshot === "object" ? value.permissionSnapshot : {};
  var run = {
    version: 1, id: cleanText(value.id, 200) || crypto.randomUUID(), state: value.state,
    objective: cleanText(value.objective, 20000), successCriteria: criteria,
    continuationCount: Math.max(0, Math.min(100, Math.floor(Number(value.continuationCount) || 0))),
    maxContinuations: boundedInt(value.maxContinuations, DEFAULT_CONTINUATIONS, 100),
    maxMinutes: boundedInt(value.maxMinutes, DEFAULT_MINUTES, 1440),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    startedAt: Number.isFinite(value.startedAt) ? value.startedAt : null,
    deadlineAt: Number.isFinite(value.deadlineAt) ? value.deadlineAt : null,
    finishedAt: Number.isFinite(value.finishedAt) ? value.finishedAt : null,
    waitingReason: cleanText(value.waitingReason, 2000), terminalReason: cleanText(value.terminalReason, 2000),
    pausedAfterRestart: !!value.pausedAfterRestart, cancellationEpoch: Math.max(0, Math.floor(Number(value.cancellationEpoch) || 0)),
    rateLimitUntil: Number.isFinite(value.rateLimitUntil) ? value.rateLimitUntil : null,
    continuationPending: false, completionRequested: !!value.completionRequested,
    permissionSnapshot: { permissionMode: cleanText(snapshot.permissionMode, 100) || null,
      permissionModeBeforeFullAccess: cleanText(snapshot.permissionModeBeforeFullAccess, 100) || null, enabled: snapshot.enabled === true },
  };
  if (value.state === "armed") run.armToken = cleanText(value.armToken, 200) || crypto.randomUUID();
  if (value.outcome && typeof value.outcome === "object") run.outcome = { assessment: cleanText(value.outcome.assessment, 40),
    summary: cleanText(value.outcome.summary, 4000), evidence: evidence, criteria: assessments,
    reportedAt: Number.isFinite(value.outcome.reportedAt) ? value.outcome.reportedAt : null };
  return run;
}

function attachAutonomousRun(ctx) {
  var sm = ctx.sm;
  var sendTo = ctx.sendTo;
  var fullAccess = ctx.fullAccess;
  var timers = new Map();
  var actions = new Map();

  function serialize(session, action) {
    if (!session) return Promise.reject(new Error("No session was bound to this request."));
    var prior = actions.get(session.localId) || Promise.resolve();
    var next = prior.catch(function () {}).then(action);
    actions.set(session.localId, next);
    return next.finally(function () { if (actions.get(session.localId) === next) actions.delete(session.localId); });
  }

  function broadcast(session) {
    sm.sendToSession(session, { type: "autonomous_run_state", sessionId: session.localId, run: project(session.autonomousRun) });
    sm.broadcastSessionList();
  }

  function persist(session) { sm.saveSessionFile(session); broadcast(session); }
  function clearTimer(session) {
    var timer = timers.get(session.localId);
    if (timer) clearTimeout(timer);
    timers.delete(session.localId);
  }

  function scheduleLimit(session) {
    clearTimer(session);
    var run = session.autonomousRun;
    if (!run || TERMINAL_STATES.indexOf(run.state) !== -1 || run.state === "paused" || !run.deadlineAt) return;
    var remaining = run.deadlineAt - Date.now();
    if (remaining <= 0) { finish(session, "limit", "The wall-clock limit was reached."); return; }
    timers.set(session.localId, setTimeout(function () { finish(session, "limit", "The wall-clock limit was reached."); }, Math.min(remaining, 2147483647)));
  }

  function eligible(session) {
    return !ctx.isMate && !!session && (session.runtimeMode || session.mode) === "gui" && driverEligibility.isEligibleDriverSession(session);
  }

  function owns(ws, session, msg) {
    if (!session || !msg || Number(msg.sessionId) !== Number(session.localId)) return false;
    return !ctx.canAccess || ctx.canAccess(ws, session);
  }

  function ownsRun(session, msg) {
    return !!(session && session.autonomousRun && cleanText(msg && msg.runId, 200) === session.autonomousRun.id);
  }

  function removeRunOwnedPending(session, runId) {
    if (!Array.isArray(session.pendingPush)) return;
    session.pendingPush = session.pendingPush.filter(function (item) { return item.autonomousRunId !== runId; });
  }

  async function finishNow(session, state, reason, outcome) {
    var run = session && session.autonomousRun;
    if (!run || TERMINAL_STATES.indexOf(run.state) !== -1) return false;
    run.cancellationEpoch = (run.cancellationEpoch || 0) + 1;
    run.continuationPending = false;
    run.completionRequested = false;
    run.state = state;
    run.terminalReason = cleanText(reason, 2000);
    run.finishedAt = Date.now();
    if (outcome) run.outcome = outcome;
    clearTimer(session);
    removeRunOwnedPending(session, run.id);
    if (typeof ctx.stopPair === "function") ctx.stopPair(session);
    if (state !== "completed" && (session.isProcessing || session._queryStarting)) {
      session.taskStopRequested = true;
      if (session.abortController) session.abortController.abort();
    }
    try {
      await fullAccess.restore(session, run.permissionSnapshot);
    } catch (error) {
      run.permissionRestoreError = cleanText(error.message || String(error), 1000);
      run.state = "error";
      run.terminalReason = "The run ended, but Skip Permissions could not be restored: " + run.permissionRestoreError;
    }
    persist(session);
    return true;
  }

  function finish(session, state, reason, outcome) {
    return serialize(session, function () { return finishNow(session, state, reason, outcome); });
  }

  function finishOwned(session, runId, state, reason, outcome) {
    return serialize(session, function () {
      if (!session.autonomousRun || session.autonomousRun.id !== runId) return false;
      return finishNow(session, state, reason, outcome);
    });
  }

  async function armNow(ws, session, msg, options) {
    if (!owns(ws, session, msg)) throw new Error("The requested session is not authorized.");
    if (!eligible(session)) throw new Error("Until complete is only available in a project GUI Driver session.");
    if (session.isProcessing || session._queryStarting) throw new Error("Wait for the current task to finish before selecting Until complete.");
    var existing = session.autonomousRun;
    if (existing && ACTIVE_STATES.indexOf(existing.state) !== -1) throw new Error("This session already has an active Until complete run.");
    var permissionSnapshot = fullAccess.snapshot(session);
    await fullAccess.setEnabled(session, true);
    try {
      var run = {
        version: 1, id: crypto.randomUUID(), armToken: crypto.randomUUID(), state: "armed",
        objective: "", successCriteria: cleanCriteria(msg.successCriteria), continuationCount: 0,
        maxContinuations: boundedInt(msg.maxContinuations, DEFAULT_CONTINUATIONS, 100),
        maxMinutes: boundedInt(msg.maxMinutes, DEFAULT_MINUTES, 1440),
        permissionSnapshot: permissionSnapshot, createdAt: Date.now(), cancellationEpoch: 0,
        continuationPending: false,
      };
      if (run.successCriteria.length === 0) run.successCriteria = ["The requested outcome is implemented and meaningfully verified."];
      session.autonomousRun = run;
      persist(session);
      if (!options || !options.deferResult) sendTo(ws, { type: "autonomous_run_arm_result", ok: true, sessionId: session.localId, requestId: cleanText(msg.requestId, 200), runId: run.id, armToken: run.armToken, run: project(run) });
    } catch (error) {
      session.autonomousRun = null;
      await fullAccess.restore(session, permissionSnapshot);
      throw error;
    }
  }

  async function disarmNow(ws, session, msg) {
    if (!owns(ws, session, msg)) throw new Error("The requested session is not authorized.");
    var run = session.autonomousRun;
    if (!run || run.state !== "armed") throw new Error("There is no armed Until complete task to deselect.");
    run.cancellationEpoch = (run.cancellationEpoch || 0) + 1;
    await fullAccess.restore(session, run.permissionSnapshot);
    session.autonomousRun = null;
    persist(session);
  }

  function consume(session, msg) {
    var run = session && session.autonomousRun;
    if (!run || session._autonomousLifecyclePending || !eligible(session) || run.state !== "armed" || msg.autonomousRunToken !== run.armToken) return false;
    run.state = "running";
    run.objective = cleanText(msg.text, 20000) || "Complete the submitted task.";
    if (run.successCriteria.length === 0) run.successCriteria = ["The requested outcome is implemented and meaningfully verified."];
    run.startedAt = Date.now();
    run.deadlineAt = run.startedAt + run.maxMinutes * 60000;
    delete run.armToken;
    persist(session);
    scheduleLimit(session);
    return true;
  }

  function startApprovedBrief(ws, session, brief, requestId, isStillApproved) {
    return serialize(session, async function () {
      if (!owns(ws, session, { sessionId: session && session.localId }) || !eligible(session)) throw new Error("The requested session is not authorized.");
      if (session.loopInterviewHandoff && session.loopInterviewHandoff.requestId === cleanText(requestId, 200) && session.autonomousRun) {
        sendTo(ws, { type: "loop_interview_start_run_result", ok: true, duplicate: true, sessionId: session.localId, requestId: cleanText(requestId, 200), run: project(session.autonomousRun) });
        return true;
      }
      if (session.isProcessing || session._queryStarting) throw new Error("Wait for the current task to finish before starting the Loop run.");
      if (session.autonomousRun && ACTIVE_STATES.indexOf(session.autonomousRun.state) !== -1) throw new Error("This session already has an active Until complete run.");
      session.loopInterviewHandoff = { version: 1, proposalId: brief.id, proposalVersion: brief.version, requestId: cleanText(requestId, 200), state: "starting", createdAt: Date.now() };
      sm.saveSessionFile(session);
      try {
        await armNow(ws, session, { sessionId: session.localId, requestId: requestId, successCriteria: brief.successCriteria, maxContinuations: brief.maxContinuations, maxMinutes: brief.maxMinutes }, { deferResult: true });
        if (!owns(ws, session, { sessionId: session.localId }) || !eligible(session) || session.isProcessing || session._queryStarting) throw new Error("The session changed while permissions were being prepared.");
        if (typeof isStillApproved === "function" && !isStillApproved()) throw new Error("This Loop brief was changed or cancelled while permissions were being prepared.");
        var run = session.autonomousRun;
        if (!run || !run.armToken || !consume(session, { text: brief.objective, autonomousRunToken: run.armToken })) throw new Error("The approved Loop brief could not be consumed.");
        var entry = { type: "user_message", text: "[Approved Loop run started]\n\n" + brief.objective, source: "loop_interview_run", proposalId: brief.id, proposalVersion: brief.version, _ts: Date.now() };
        session.history.push(entry);
        sm.appendToSessionFile(session, entry);
        sm.sendToSession(session, entry);
        session.isProcessing = true;
        ctx.onProcessingChanged();
        sm.sendToSession(session, { type: "status", status: "processing" });
        var sdk = ctx.getSdk();
        session.loopInterviewHandoff.state = "running";
        sm.saveSessionFile(session);
        var started;
        try { started = sdk.startQuery(session, brief.objective, null, ctx.ensureProjectAccessForSession(session)); }
        catch (error) {
          session.isProcessing = false;
          session._queryStarting = false;
          ctx.onProcessingChanged();
          sm.sendToSession(session, { type: "status", status: "idle" });
          await finishNow(session, "error", "The approved Loop run could not start: " + (error.message || error));
          session.loopInterviewHandoff = null;
          sm.saveSessionFile(session);
          sendTo(ws, { type: "loop_interview_start_run_result", ok: false, sessionId: session.localId, requestId: cleanText(requestId, 200), error: "The approved Loop run could not start: " + (error.message || error) });
          return false;
        }
        sendTo(ws, { type: "loop_interview_start_run_result", ok: true, sessionId: session.localId, requestId: cleanText(requestId, 200), run: project(session.autonomousRun) });
        var approvedRunId = session.autonomousRun.id;
        Promise.resolve(started).catch(function (error) {
          if (session.autonomousRun && session.autonomousRun.id === approvedRunId && TERMINAL_STATES.indexOf(session.autonomousRun.state) === -1) {
            session.isProcessing = false;
            session._queryStarting = false;
            ctx.onProcessingChanged();
            sm.sendToSession(session, { type: "status", status: "idle" });
            finishOwned(session, approvedRunId, "error", "The approved Loop run could not start: " + (error.message || error));
          }
        });
        return true;
      } catch (error) {
        if (session.autonomousRun && ACTIVE_STATES.indexOf(session.autonomousRun.state) !== -1) await finishNow(session, "stopped", "The approved Loop handoff failed before execution could start.");
        session.loopInterviewHandoff = null;
        sm.saveSessionFile(session);
        sendTo(ws, { type: "loop_interview_start_run_result", ok: false, sessionId: session.localId, requestId: cleanText(requestId, 200), error: error.message || String(error) });
        return false;
      }
    });
  }

  function onHumanMessage(session) {
    var run = session && session.autonomousRun;
    if (!run || run.state === "armed" || run.state === "paused" || TERMINAL_STATES.indexOf(run.state) !== -1) return;
    run.completionRequested = false;
    run.outcome = null;
    run.state = "running";
    run.waitingReason = "";
    persist(session);
  }

  function continuationPrompt(run) {
    return "[Until complete continuation: " + run.id + "]\nContinue the single active task. Review the objective and success criteria, inspect actual evidence, and do the next useful work. Do not claim independent verification merely from your own prose. Before ending this turn, call report_until_complete_outcome with this runId and a structured status, summary, and concrete evidence. If a Worker or human response is required, report the corresponding waiting status and do not spin.";
  }

  function dispatchContinuation(session, runId, epoch) {
    var run = session.autonomousRun;
    if (!run || run.id !== runId || run.cancellationEpoch !== epoch || !run.continuationPending || TERMINAL_STATES.indexOf(run.state) !== -1) return;
    if (Date.now() >= run.deadlineAt) { finish(session, "limit", "The wall-clock limit was reached."); return; }
    if (run.rateLimitUntil && run.rateLimitUntil > Date.now()) { scheduleRateLimitWake(session, run); return; }
    if (typeof ctx.stopBarrier === "function" && ctx.stopBarrier(session)) { finish(session, "stopped", "A cancellation barrier prevented a stale continuation."); return; }
    if (session.isProcessing || session._queryStarting) {
      run.continuationPending = false;
      run.state = "reviewing";
      persist(session);
      return;
    }
    run.continuationPending = false;
    run.continuationCount += 1;
    run.state = "running";
    session.isProcessing = true;
    session.taskStopRequested = false;
    ctx.onProcessingChanged();
    sm.sendToSession(session, { type: "status", status: "processing" });
    var text = continuationPrompt(run);
    var sdk = ctx.getSdk();
    try {
      if (!sdk.pushMessage(session, text, null, { autonomousRunId: run.id })) {
        Promise.resolve(sdk.startQuery(session, text, null, ctx.ensureProjectAccessForSession(session))).catch(function (error) {
          finish(session, "error", "Failed to continue the run: " + (error.message || error));
        });
      }
    } catch (error) {
      finish(session, "error", "Failed to continue the run: " + (error.message || error));
      return;
    }
    persist(session);
  }

  function scheduleRateLimitWake(session, run) {
    clearTimer(session);
    var wakeAt = Math.min(run.rateLimitUntil, run.deadlineAt);
    var runId = run.id;
    var epoch = run.cancellationEpoch;
    timers.set(session.localId, setTimeout(function () {
      var current = session.autonomousRun;
      if (!current || current.id !== runId || current.cancellationEpoch !== epoch || TERMINAL_STATES.indexOf(current.state) !== -1) return;
      if (Date.now() >= current.deadlineAt) { finish(session, "limit", "The wall-clock limit was reached."); return; }
      current.rateLimitUntil = null;
      current.waitingReason = "";
      scheduleLimit(session);
      continueRun(session, current);
    }, Math.max(0, wakeAt - Date.now())));
  }

  function continueRun(session, run) {
    if (run.continuationPending || session.isProcessing || session._queryStarting) return;
    if (Date.now() >= run.deadlineAt) { finish(session, "limit", "The wall-clock limit was reached."); return; }
    if (run.rateLimitUntil && run.rateLimitUntil > Date.now()) { scheduleRateLimitWake(session, run); return; }
    if (run.continuationCount >= run.maxContinuations) { finish(session, "limit", "The automatic continuation limit was reached."); return; }
    run.continuationPending = true;
    run.state = "reviewing";
    var epoch = run.cancellationEpoch;
    persist(session);
    setTimeout(function () { dispatchContinuation(session, run.id, epoch); }, 0);
  }

  function onTurnDone(session) {
    var run = session && session.autonomousRun;
    if (!run || run.state === "armed" || run.state === "paused" || TERMINAL_STATES.indexOf(run.state) !== -1) return;
    if (run.completionRequested) { finish(session, "completed", "The Driver assessed the success criteria as complete.", run.outcome); return; }
    if (run.state === "waiting-user" || run.state === "waiting-worker") return;
    continueRun(session, run);
  }

  function report(args, session) {
    var run = session && session.autonomousRun;
    if (!session || sm.sessions.get(session.localId) !== session || !run || args.runId !== run.id || run.state === "armed" || run.state === "paused" || TERMINAL_STATES.indexOf(run.state) !== -1) return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "rejected", reason: "This callback does not belong to a running active run." }) }] });
    var statuses = ["completed", "continue", "waiting_user", "waiting_worker", "error"];
    if (statuses.indexOf(args.status) === -1) return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "rejected", reason: "Invalid outcome status." }) }] });
    var evidence = Array.isArray(args.evidence) ? args.evidence.slice(0, 20).map(function (item) { return cleanText(item, 2000); }).filter(Boolean) : [];
    var criteria = Array.isArray(args.criteria) ? args.criteria.slice(0, 10).map(function (item) {
      if (!item || typeof item !== "object") return null;
      return { criterion: cleanText(item.criterion, 1000), met: item.met === true, evidence: cleanText(item.evidence, 2000) };
    }).filter(function (item) { return item && item.criterion && item.evidence; }) : [];
    var outcome = { assessment: args.status, summary: cleanText(args.summary, 4000), evidence: evidence, criteria: criteria, reportedAt: Date.now() };
    var criteriaComplete = (run.successCriteria || []).every(function (criterion) {
      return criteria.some(function (item) { return item.met && item.criterion === criterion; });
    });
    if (args.status === "completed" && (!outcome.summary || evidence.length === 0 || !run.successCriteria || run.successCriteria.length === 0 || !criteriaComplete)) return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "rejected", reason: "Completion requires a summary, concrete evidence, and a met assessment for every success criterion." }) }] });
    run.completionRequested = false;
    run.outcome = outcome;
    if (args.status === "completed") { run.completionRequested = true; run.state = "reviewing"; persist(session); }
    else if (args.status === "error") finish(session, "error", outcome.summary || "The Driver reported an error.", outcome);
    else if (args.status === "waiting_user") { run.state = "waiting-user"; run.waitingReason = outcome.summary || "Waiting for human input."; persist(session); }
    else if (args.status === "waiting_worker") { run.state = "waiting-worker"; run.waitingReason = outcome.summary || "Waiting for the Split Worker."; persist(session); }
    else { run.state = "reviewing"; run.waitingReason = ""; persist(session); }
    return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "recorded", run: project(run) }) }] });
  }

  function getToolDefs(session) {
    var run = session && session.autonomousRun;
    if (!run || run.state === "armed" || run.state === "paused" || TERMINAL_STATES.indexOf(run.state) !== -1) return [];
    return [{ name: "report_until_complete_outcome", description: "Report the Driver's structured assessment for the exact active Until complete run.", inputSchema: { type: "object", properties: { runId: { type: "string" }, status: { type: "string", enum: ["completed", "continue", "waiting_user", "waiting_worker", "error"] }, summary: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, criteria: { type: "array", items: { type: "object", properties: { criterion: { type: "string" }, met: { type: "boolean" }, evidence: { type: "string" } }, required: ["criterion", "met", "evidence"], additionalProperties: false } } }, required: ["runId", "status", "summary", "evidence", "criteria"], additionalProperties: false }, handler: function (args) { return report(args || {}, session); } }];
  }

  function getSystemPrompt(session) {
    var run = session && session.autonomousRun;
    if (!run || run.state === "armed" || TERMINAL_STATES.indexOf(run.state) !== -1) return "";
    return "An Until complete run is active. Run ID: " + run.id + ". Objective: " + run.objective + ". Success criteria: " + run.successCriteria.join("; ") + ". You are the Driver and may use a Split Worker when useful. Base completion only on inspected evidence, not your own prose. Before ending every turn, call report_until_complete_outcome with a criterion-by-criterion assessment. Report waiting_user or waiting_worker when blocked and wait rather than spinning.";
  }

  function stopForPermissionChange(session) { return finish(session, "stopped", "Skip Permissions was turned off."); }

  function handleMessage(ws, msg) {
    if (msg.type !== "autonomous_run_arm" && msg.type !== "autonomous_run_disarm" && msg.type !== "autonomous_run_stop" && msg.type !== "autonomous_run_resume") return false;
    var session = ctx.getSessionForWs(ws);
    var requestId = cleanText(msg.requestId, 200);
    var runId = cleanText(msg.runId, 200) || (session && session.autonomousRun && session.autonomousRun.id) || "";
    if (!session) {
      sendTo(ws, { type: msg.type === "autonomous_run_arm" ? "autonomous_run_arm_result" : "autonomous_run_action_result", ok: false, sessionId: null, requestId: requestId, runId: runId, error: "No session was bound to this request." });
      return true;
    }
    var lifecycle = null;
    if (msg.type !== "autonomous_run_arm" && owns(ws, session, msg) && ownsRun(session, msg)) {
      lifecycle = { id: crypto.randomUUID(), type: msg.type, runId: runId };
      session._autonomousLifecyclePending = lifecycle;
    }
    serialize(session, async function () {
      try {
        if (msg.type === "autonomous_run_arm") await armNow(ws, session, msg);
        else if (!owns(ws, session, msg) || !ownsRun(session, msg)) throw new Error("The requested run is stale or is not authorized.");
        else if (msg.type === "autonomous_run_disarm") await disarmNow(ws, session, msg);
        else if (msg.type === "autonomous_run_stop") await finishNow(session, "stopped", "Stopped by the user.");
        else {
          var run = session.autonomousRun;
          if (!run || run.state !== "paused") throw new Error("There is no paused run to resume.");
          if (Date.now() >= run.deadlineAt) { await finishNow(session, "limit", "The wall-clock limit was reached."); return; }
          await fullAccess.setEnabled(session, true);
          run.state = "reviewing";
          run.pausedAfterRestart = false;
          run.waitingReason = "";
          persist(session);
          scheduleLimit(session);
          continueRun(session, run);
        }
        if (msg.type !== "autonomous_run_arm") sendTo(ws, { type: "autonomous_run_action_result", ok: true, action: msg.type, sessionId: session.localId, requestId: requestId, runId: runId });
      } catch (error) {
        sendTo(ws, { type: msg.type === "autonomous_run_arm" ? "autonomous_run_arm_result" : "autonomous_run_action_result", ok: false, action: msg.type, sessionId: session.localId, requestId: requestId, runId: runId, error: error.message || String(error) });
      }
    }).catch(function () {}).finally(function () {
      if (lifecycle && session._autonomousLifecyclePending === lifecycle) delete session._autonomousLifecyclePending;
    });
    return true;
  }

  function recover() {
    sm.sessions.forEach(function (session) {
      var run = session.autonomousRun;
      if (!run || TERMINAL_STATES.indexOf(run.state) !== -1) return;
      if (run.state === "armed") {
        serialize(session, function () {
          return fullAccess.restore(session, run.permissionSnapshot).then(function () { session.autonomousRun = null; session.loopInterviewHandoff = null; persist(session); }, function (error) {
            run.state = "error"; run.terminalReason = "Skip Permissions could not be restored after restart: " + cleanText(error.message || String(error), 1000); persist(session);
          });
        }).catch(function () {});
        return;
      }
      run.state = "paused";
      run.pausedAfterRestart = true;
      run.waitingReason = "Paused after daemon restart. Resume explicitly to continue.";
      run.continuationPending = false;
      run.cancellationEpoch = (run.cancellationEpoch || 0) + 1;
      serialize(session, function () {
        return fullAccess.restore(session, run.permissionSnapshot).catch(function (error) {
          run.permissionRestoreError = cleanText(error.message || String(error), 1000);
          run.state = "error"; run.terminalReason = "Skip Permissions could not be restored after restart: " + run.permissionRestoreError;
        }).then(function () { persist(session); });
      }).catch(function () {});
    });
  }

  function onPartnerResult(session) {
    var run = session && session.autonomousRun;
    if (!run || run.state !== "waiting-worker") return;
    run.completionRequested = false; run.outcome = null;
    run.state = "running"; run.waitingReason = ""; persist(session);
  }

  function onUserAnswer(session) {
    var run = session && session.autonomousRun;
    if (!run || run.state !== "waiting-user") return;
    run.completionRequested = false; run.outcome = null;
    run.state = "running"; run.waitingReason = ""; persist(session);
  }

  function onRateLimit(session, resetsAt) {
    var run = session && session.autonomousRun;
    if (!run || TERMINAL_STATES.indexOf(run.state) !== -1 || run.state === "armed" || run.state === "paused") return;
    run.cancellationEpoch = (run.cancellationEpoch || 0) + 1;
    run.continuationPending = false;
    run.rateLimitUntil = Math.max(Date.now(), Math.min(Number(resetsAt) || Date.now(), run.deadlineAt));
    run.state = "reviewing";
    run.waitingReason = "Waiting for the rate limit to reset.";
    persist(session);
    scheduleRateLimitWake(session, run);
  }

  recover();
  return { consume: consume, finish: finish, startApprovedBrief: startApprovedBrief, getSystemPrompt: getSystemPrompt, getToolDefs: getToolDefs, handleMessage: handleMessage, onHumanMessage: onHumanMessage, onPartnerResult: onPartnerResult, onRateLimit: onRateLimit, onTurnDone: onTurnDone, onUserAnswer: onUserAnswer, project: project, stopForPermissionChange: stopForPermissionChange };
}

module.exports = { attachAutonomousRun: attachAutonomousRun, projectAutonomousRun: project, restoreStoredRun: restoreStoredRun };
