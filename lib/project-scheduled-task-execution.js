var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var sessionProvenance = require("./session-provenance");
var sessionToolTransport = require("./yoke/session-tool-transport");
var ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

function toolResult(value) { return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] }); }
function clean(value, max) { var text = typeof value === "string" ? value.trim() : ""; return text.slice(0, max); }

function validRuntime(runtime) {
  return !!(runtime && runtime.driver && runtime.worker && runtime.driver.vendor && runtime.worker.vendor);
}

function attachScheduledTaskExecution(ctx) {
  var registry = ctx.registry;
  var sm = ctx.sm;
  var pair = ctx.sessionPair;

  function promptFor(record) {
    var filesId = record.linkedTaskId || record.id;
    if (!ID_PATTERN.test(record.id || "") || !ID_PATTERN.test(filesId || "")) throw new Error("Task storage identity is invalid.");
    var promptPath = path.join(ctx.cwd, ".claude", "loops", filesId, "PROMPT.md");
    return fs.readFileSync(promptPath, "utf8").trim();
  }

  function runnable(record) {
    if (!record || (record.createdViaScheduledTasks !== true && record.source !== "schedule")) return { ok: false, legacy: true };
    if (!validRuntime(record.execution)) return { ok: false, error: "Choose Driver and Split Worker runtimes before this task can run." };
    if (!ctx.authorize(record)) return { ok: false, error: "The scheduled task owner is no longer authorized for this project." };
    if (!sessionToolTransport.capability(record.execution.driver.vendor).supported) return { ok: false, error: "The Driver runtime cannot receive scheduled outcome tools." };
    if (!sessionToolTransport.capability(record.execution.worker.vendor).supported) return { ok: false, error: "The Split Worker runtime cannot receive pair tools." };
    try {
      pair.preflightRuntime(record.execution.driver, null, true);
      pair.preflightRuntime(record.execution.worker, null, true);
    } catch (error) { return { ok: false, error: error.message || String(error) }; }
    return { ok: true };
  }

  function rollbackPair(created) {
    if (!created) return;
    if (pair.removeOwnedPair && pair.removeOwnedPair(created.driver.ownerId || null, created)) return;
    try { sm.deleteSessionQuiet(created.worker.localId); } catch (e) {}
    try { sm.deleteSessionQuiet(created.driver.localId); } catch (e) {}
  }

  function finish(recordId, runId, outcome, reason, drain) {
    var record = registry.getById(recordId);
    if (!record || !record.activeRun || record.activeRun.runId !== runId) return false;
    var active = record.activeRun;
    var driver = sm.sessions.get(active.driverSessionId);
    var worker = sm.sessions.get(active.workerSessionId);
    var finalSummary = clean(reason, 1000) || null;
    var saved = registry.completeRun(recordId, runId, {
      outcome: outcome, summary: finalSummary, reason: finalSummary,
      driverProviderSessionId: driver && driver.cliSessionId || active.driverProviderSessionId || null,
      workerProviderSessionId: worker && worker.cliSessionId || active.workerProviderSessionId || null,
    });
    if (!saved) return false;
    if (driver && driver.scheduledTaskRun && driver.scheduledTaskRun.runId === runId) driver.scheduledTaskRun.status = outcome;
    if (worker && worker.scheduledTaskRun && worker.scheduledTaskRun.runId === runId) worker.scheduledTaskRun.status = outcome;
    if (driver) sm.saveSessionFile(driver);
    if (worker) sm.saveSessionFile(worker);
    var current = registry.getById(recordId);
    if (drain && current && current.pendingRun && !current.activeRun) trigger(current, "queued");
    return true;
  }

  function recordTerminal(record, run, attempt) {
    if (!record || !run || !run.runId || !run.outcome || typeof ctx.recordResult !== "function") return false;
    try {
      ctx.recordResult({
        scheduleId: record.id, runId: run.runId, name: record.name || "Scheduled task",
        ownerId: record.ownerId || null, outcome: run.outcome,
        summary: run.summary || run.reason || null, startedAt: run.startedAt || null,
        finishedAt: run.finishedAt || Date.now(), driverOriginId: run.driverOriginId || null,
        workerOriginId: run.workerOriginId || null,
        driverProviderSessionId: run.driverProviderSessionId || null,
        workerProviderSessionId: run.workerProviderSessionId || null,
      });
      return true;
    } catch (error) {
      console.error("[scheduled-task] Failed to record result for " + run.runId + ":", error.message || error);
      if (Number(attempt || 0) < 2) setTimeout(function () { recordTerminal(record, run, Number(attempt || 0) + 1); }, 1000);
      return false;
    }
  }

  function syncTerminalResults() {
    var records = registry.getAll ? registry.getAll() : [];
    for (var i = 0; i < records.length; i++) {
      if (records[i].createdViaScheduledTasks !== true && records[i].source !== "schedule") continue;
      var runs = Array.isArray(records[i].runs) ? records[i].runs : [];
      for (var j = 0; j < runs.length; j++) {
        if (runs[j] && runs[j].runId && runs[j].outcome) recordTerminal(records[i], runs[j]);
      }
    }
  }

  function failStart(recordId, runId, created, error, preDispatch) {
    if (preDispatch) rollbackPair(created);
    else if (created) {
      created.driver.scheduledTaskRun.revoked = true;
      created.worker.scheduledTaskRun.revoked = true;
      pair.stopOwnedPair(created.driver, "The scheduled run failed after dispatch.");
    }
    finish(recordId, runId, "failed", error && (error.message || String(error)) || "Scheduled execution could not start.", false);
  }

  function newRun(record, source) {
    return { runId: "srun_" + crypto.randomUUID(), scheduleId: record.id, source: source || "schedule", status: "starting", startedAt: Date.now() };
  }

  function prepare(record, source) {
    var check = runnable(record);
    if (!check.ok) return { ok: false, legacy: check.legacy, error: check.error || null };
    if (record.activeRun) {
      if (record.skipIfRunning !== false) return { ok: true, skipped: true, skippedRun: { runId: "skip_" + crypto.randomUUID(), scheduleId: record.id, source: source || "schedule", outcome: "skipped-busy", reason: "A prior occurrence was still active.", startedAt: Date.now(), finishedAt: Date.now() } };
      return { ok: true, queued: true, pendingRun: record.pendingRun || { scheduleId: record.id, source: source || "schedule", queuedAt: Date.now(), dueAt: record.nextRunAt } };
    }
    return { ok: true, activeRun: newRun(record, source) };
  }

  function trigger(record, source, prepared) {
    var check = runnable(record);
    if (!check.ok) return { ok: false, legacy: check.legacy, error: check.error || null };
    var run = prepared && prepared.activeRun;
    if (run) {
      if (!record.activeRun || record.activeRun.runId !== run.runId) return { ok: false, error: "The scheduled run reservation is no longer current." };
    } else {
      if (record.activeRun) return { ok: false, busy: true, skipped: record.skipIfRunning !== false, error: "This scheduled task already has an active run." };
      run = newRun(record, source);
      if (!registry.beginRun(record.id, run)) return { ok: false, error: "The scheduled run could not be reserved." };
    }
    var runId = run.runId;
    var created = null;
    var dispatched = false;
    try {
      var instructions = promptFor(record);
      if (!instructions) throw new Error("Task instructions are empty.");
      created = pair.createOwnedPair(record.ownerId || null, {
        name: record.name || "Scheduled task",
        driver: record.execution.driver,
        worker: record.execution.worker,
        hidden: true,
      });
      var runState = {
        status: "running", groupId: created.group.id,
        driverSessionId: created.driver.localId, workerSessionId: created.worker.localId,
        driverOriginId: sessionProvenance.ensureOrigin(created.driver), workerOriginId: sessionProvenance.ensureOrigin(created.worker),
      };
      if (!registry.updateRun(record.id, runId, runState)) throw new Error("The scheduled pair could not be recorded before execution.");
      created.driver.scheduledTaskRun = Object.assign({}, runState, { runId: runId, scheduleId: record.id, role: "driver" });
      created.worker.scheduledTaskRun = Object.assign({}, runState, { runId: runId, scheduleId: record.id, role: "worker" });
      sm.saveSessionFile(created.driver); sm.saveSessionFile(created.worker);
      var liveRecord = registry.getById(record.id);
      var liveCheck = runnable(liveRecord);
      if (!liveCheck.ok || !liveRecord.activeRun || liveRecord.activeRun.runId !== runId || liveRecord.ownerId !== created.driver.ownerId || liveRecord.ownerId !== created.worker.ownerId) {
        throw new Error(liveCheck.error || "The scheduled task owner or run changed before execution.");
      }
      var linuxUser = ctx.getLinuxUserForSession(created.driver);
      if (ctx.requiresLinuxUser && ctx.requiresLinuxUser() && !linuxUser) throw new Error("The scheduled task owner no longer has a valid OS identity.");
      var prompt = "Run the scheduled task below with your visible Split Worker. Use the existing pair tools to delegate meaningful work, review the Worker's result, and decide whether the scheduled occurrence completed. Before ending, call report_scheduled_task_outcome with this exact run id. Report needs-input when ordinary permission or user input prevents completion.\n\nRun id: " + runId + "\nTask: " + (record.name || "Scheduled task") + "\n\n" + instructions;
      sm.sendAndRecord(created.driver, { type: "user_message", text: prompt, scheduledTaskRunId: runId, scheduledTaskId: record.id });
      created.driver.isProcessing = true;
      ctx.onProcessingChanged();
      sm.sendToSession(created.driver, { type: "status", status: "processing" });
      var query = ctx.getSdk().startQuery(created.driver, prompt, undefined, linuxUser);
      dispatched = true;
      var generation = Number(created.driver._sdkQueryGeneration || 0);
      created.driver.scheduledTaskRun.initialQueryGeneration = generation;
      if (!registry.updateRun(record.id, runId, { initialQueryGeneration: generation })) throw new Error("The scheduled query identity could not be stored before acknowledgement.");
      sm.saveSessionFile(created.driver);
      Promise.resolve(query).catch(function (error) {
        if (!created.driver.scheduledTaskRun || created.driver.scheduledTaskRun.runId !== runId || Number(created.driver._sdkQueryGeneration || 0) !== generation) return;
        created.driver.isProcessing = false;
        failStart(record.id, runId, created, error, false);
        ctx.onProcessingChanged();
      });
      sm.broadcastSessionList();
      return { ok: true, runId: runId, groupId: created.group.id, driverSessionId: created.driver.localId, workerSessionId: created.worker.localId };
    } catch (error) {
      failStart(record.id, runId, created, error, !dispatched);
      return { ok: false, error: error.message || String(error) };
    }
  }

  function exactRun(session, skipAuthorization) {
    var marker = session && session.scheduledTaskRun;
    if (!marker || marker.revoked || marker.role !== "driver" || sm.sessions.get(session.localId) !== session) return null;
    var record = registry.getById(marker.scheduleId);
    if (!record || !record.activeRun || record.activeRun.runId !== marker.runId || record.activeRun.driverOriginId !== session.sessionOriginId || (!skipAuthorization && !ctx.authorize(record))) return null;
    var roles = pair.rolesFor(session);
    if (!roles || roles.driver !== session || roles.group.id !== record.activeRun.groupId || roles.worker.sessionOriginId !== record.activeRun.workerOriginId || roles.worker.ownerId !== record.ownerId) return null;
    return { marker: marker, record: record, roles: roles };
  }

  function revokeAndStop(current, reason) {
    current.roles.driver.scheduledTaskRun.revoked = true;
    if (current.roles.worker.scheduledTaskRun) current.roles.worker.scheduledTaskRun.revoked = true;
    return pair.stopOwnedPair(current.roles.driver, reason);
  }

  function getToolDefs(session) {
    var exact = exactRun(session);
    if (!exact) return [];
    var runId = exact.marker.runId;
    var queryGeneration = Number(session._sdkQueryGeneration || 0);
    return [{
      name: "report_scheduled_task_outcome", queryBound: true,
      description: "Record the authoritative outcome of this exact scheduled run. Completed is accepted only after all Worker and queued pair work is idle. Use needs-input when ordinary permission or user input is required.",
      inputSchema: { type: "object", properties: { runId: { type: "string" }, outcome: { type: "string", enum: ["completed", "failed", "needs-input"] }, summary: { type: "string" } }, required: ["runId", "outcome"], additionalProperties: false },
      handler: function (args) {
        args = args && typeof args === "object" ? args : {};
        var keys = Object.keys(args);
        if (keys.some(function (key) { return ["runId", "outcome", "summary"].indexOf(key) === -1; }) || typeof args.runId !== "string" || ["completed", "failed", "needs-input"].indexOf(args.outcome) === -1 || (args.summary !== undefined && typeof args.summary !== "string")) return toolResult({ status: "rejected", reason: "The scheduled outcome arguments are invalid." });
        var current = exactRun(session);
        if (!current || args.runId !== runId || Number(session._sdkQueryGeneration || 0) !== queryGeneration) return toolResult({ status: "rejected", reason: "This outcome tool belongs to a different query or finished scheduled run." });
        var worker = current.roles.worker;
        var queued = worker && Array.isArray(worker._pairFollowups) && worker._pairFollowups.some(function (item) { return item.status === "queued" || item.status === "waiting_for_interrupt" || item.status === "starting"; });
        if (args.outcome === "completed" && worker && (worker.isProcessing || worker._queryStarting || worker._pairDelegation || queued)) return toolResult({ status: "rejected", reason: "The Split Worker or queued pair work is still active." });
        if (args.outcome === "completed" && (!worker || !worker._lastPairOutcome || worker._lastPairOutcome.completedAt < current.record.activeRun.startedAt)) return toolResult({ status: "rejected", reason: "The Driver must delegate this occurrence to its Split Worker before reporting completion." });
        if (args.outcome === "needs-input") {
          if (!registry.updateRun(current.record.id, runId, { status: "needs-input", summary: clean(args.summary, 1000) || null, driverProviderSessionId: session.cliSessionId || null, workerProviderSessionId: worker && worker.cliSessionId || null })) return toolResult({ status: "rejected", reason: "The needs-input state could not be stored." });
          session.scheduledTaskRun.status = "needs-input";
          return toolResult({ status: "recorded", runId: runId, outcome: "needs-input" });
        }
        if (args.outcome === "failed") revokeAndStop(current, clean(args.summary, 1000) || "The scheduled Driver reported that this run failed.");
        if (!finish(current.record.id, runId, args.outcome, args.summary, true)) return toolResult({ status: "rejected", reason: "The outcome could not be stored." });
        return toolResult({ status: "recorded", runId: runId, outcome: args.outcome });
      },
    }];
  }

  function onTurnDone(session) {
    var current = exactRun(session);
    if (!current) return false;
    if (session._lastTurnInterrupted || session.taskStopRequested) return finish(current.record.id, current.marker.runId, "interrupted", "The scheduled Driver was stopped.", false);
    var worker = current.roles.worker;
    if (worker.isProcessing || worker._queryStarting || worker._pairDelegation) return registry.updateRun(current.record.id, current.marker.runId, { status: "waiting-worker" });
    if (current.record.activeRun.status === "running" || current.record.activeRun.status === "reviewing") return registry.updateRun(current.record.id, current.marker.runId, { status: "needs-input", reason: "The Driver turn ended without reporting a final scheduled outcome." });
    return false;
  }

  function onPartnerResult(driver) {
    var current = exactRun(driver, true);
    if (current && !ctx.authorize(current.record)) return stopForSession(driver, "The scheduled task owner is no longer authorized for this project.");
    return current ? registry.updateRun(current.record.id, current.marker.runId, { status: "reviewing" }) : false;
  }

  function stopForSession(session, reason) {
    var roles = pair.rolesFor(session);
    var driver = roles && roles.driver || session;
    var current = exactRun(driver, true);
    if (!current) return false;
    revokeAndStop(current, reason || "The scheduled run was stopped.");
    return finish(current.record.id, current.marker.runId, "interrupted", reason || "The scheduled run was stopped.", false);
  }

  function stopRecord(record, reason) {
    if (!record || !record.activeRun) return false;
    var driver = sm.sessions.get(record.activeRun.driverSessionId);
    return driver ? stopForSession(driver, reason) : finish(record.id, record.activeRun.runId, "interrupted", reason, false);
  }

  return { getToolDefs: getToolDefs, onPartnerResult: onPartnerResult, onTurnDone: onTurnDone, prepare: prepare, recordTerminal: recordTerminal, runnable: runnable, stopForSession: stopForSession, stopRecord: stopRecord, syncTerminalResults: syncTerminalResults, trigger: trigger };
}

module.exports = { attachScheduledTaskExecution: attachScheduledTaskExecution, validRuntime: validRuntime };
