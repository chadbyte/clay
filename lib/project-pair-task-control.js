var crypto = require("crypto");
var buildShape = require("./session-spawn-mcp-server").buildShape;

var OUTCOMES = ["completed", "partial", "failed", "interrupted"];
var MAX_QUEUE = 20;
var MAX_ITEMS = 50;
var MAX_TEXT = 1000;

function result(value) { return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] }); }
function cleanText(value, max) {
  var text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? text.slice(0, max) : text;
}
function cleanId(value, prefix) {
  if (value === undefined || value === null || value === "") return prefix + crypto.randomUUID();
  if (typeof value !== "string") return null;
  var id = value.trim();
  return id && id.length <= 120 && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null;
}
function cleanStrings(values) {
  if (!Array.isArray(values)) return null;
  return values.slice(0, MAX_ITEMS).map(function (value) { return cleanText(value, MAX_TEXT); }).filter(Boolean);
}
function cleanVerifications(values) {
  if (!Array.isArray(values)) return null;
  return values.slice(0, MAX_ITEMS).map(function (value) {
    if (typeof value === "string") return { command: cleanText(value, MAX_TEXT), result: "unknown" };
    if (!value || typeof value !== "object") return null;
    return { command: cleanText(value.command, MAX_TEXT), result: cleanText(value.result, MAX_TEXT) || "unknown" };
  }).filter(Boolean);
}

function attachPairTaskControl(ctx) {
  function queueFor(worker) {
    if (!Array.isArray(worker._pairFollowups)) worker._pairFollowups = [];
    return worker._pairFollowups;
  }
  function registryFor(worker) {
    if (!worker._pairTaskIds) worker._pairTaskIds = Object.create(null);
    return worker._pairTaskIds;
  }
  function current(worker) { return worker && worker._pairDelegation || null; }
  function taskGeneration(worker) {
    return worker._pairGeneration || worker.sessionProvenance && worker.sessionProvenance.generation || null;
  }
  function findTask(worker, taskId) {
    var active = current(worker);
    if (active && active.taskId === taskId) return active;
    var queue = queueFor(worker);
    for (var i = 0; i < queue.length; i++) if (queue[i].taskId === taskId) return queue[i];
    return null;
  }
  function begin(worker, caller, message, requestedId) {
    var taskId = cleanId(requestedId, "ptask_");
    if (!taskId) throw new Error("taskId is invalid");
    var existing = registryFor(worker)[taskId];
    if (existing && existing.status === "starting" && existing.workerSessionId === worker.localId &&
        existing.driverSessionId === caller.localId && existing.message === message) {
      existing.status = "running";
      existing.startedAt = existing.startedAt || Date.now();
      return existing;
    }
    if (findTask(worker, taskId) || existing) throw new Error("taskId is already in use for this Worker generation");
    var task = {
      taskId: taskId,
      generation: taskGeneration(worker),
      workerSessionId: worker.localId,
      driverSessionId: caller.localId,
      message: message,
      createdAt: Date.now(),
      status: "running",
    };
    registryFor(worker)[taskId] = task;
    return task;
  }
  function projectTask(task) {
    return {
      taskId: task.taskId,
      generation: task.generation,
      workerSessionId: task.workerSessionId,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt || null,
      replacesTaskId: task.replacesTaskId || null,
      message: cleanText(task.message, MAX_TEXT),
    };
  }
  function queue(args, caller) {
    try {
      ctx.turnControl.assertWorkerAction(caller);
      var resolved = ctx.resolvePair(caller);
      var worker = resolved.partner;
      var message = cleanText(args.message, 30000);
      if (!message) throw new Error("message is required");
      if (!worker.isProcessing && !worker._queryStarting && !current(worker)) throw new Error("the Split Worker is idle; use send_to_partner for an immediate follow-up");
      var task = begin(worker, caller, message, args.taskId);
      task.status = "queued";
      var items = queueFor(worker);
      if (items.filter(function (item) { return item.status === "queued" || item.status === "waiting_for_interrupt"; }).length >= MAX_QUEUE) throw new Error("the Split Worker follow-up queue is full");
      items.push(task);
      return result({ status: "queued", task: projectTask(task) });
    } catch (err) { return result({ status: "rejected", reason: err.message || String(err) }); }
  }
  function inspect(args, caller) {
    try {
      var worker = ctx.resolvePair(caller).partner;
      return result(status(worker));
    } catch (err) { return result({ status: "rejected", reason: err.message || String(err) }); }
  }
  function cancel(args, caller) {
    try {
      ctx.turnControl.assertWorkerAction(caller);
      var worker = ctx.resolvePair(caller).partner;
      var task = findTask(worker, args.taskId);
      if (!task || (task.status !== "queued" && task.status !== "waiting_for_interrupt")) throw new Error("the exact queued task is not cancellable");
      task.status = "cancelled";
      task.completedAt = Date.now();
      return result({ status: "cancelled", taskId: task.taskId });
    } catch (err) { return result({ status: "rejected", taskId: args.taskId || null, reason: err.message || String(err) }); }
  }
  function markInterruption(worker, by, reason, targetTaskId) {
    var active = current(worker);
    worker._pairInterruption = {
      interruptedBy: by || "system",
      reason: cleanText(reason, MAX_TEXT) || "No reason supplied.",
      targetTaskId: targetTaskId || active && active.taskId || null,
      requestedAt: Date.now(),
      completedAt: null,
    };
    return worker._pairInterruption;
  }
  function ensureSystemInterruption(worker, token) {
    if (worker._lastTurnInterrupted && (!worker._pairInterruption || worker._pairInterruption.targetTaskId !== token.taskId)) {
      markInterruption(worker, "system", "The Worker runtime ended this task as interrupted.", token.taskId);
    }
  }
  function replaceTask(args, caller) {
    try {
      ctx.turnControl.assertWorkerAction(caller);
      var resolved = ctx.resolvePair(caller);
      var worker = resolved.partner;
      var active = current(worker);
      if (!active || !worker.isProcessing) throw new Error("there is no active delegated task to replace");
      if (!args.targetTaskId || args.targetTaskId !== active.taskId) throw new Error("targetTaskId must match the exact active task");
      var message = cleanText(args.message, 30000);
      if (!message) throw new Error("message is required");
      var replacement = begin(worker, caller, message, args.taskId);
      replacement.status = "waiting_for_interrupt";
      replacement.replacesTaskId = active.taskId;
      queueFor(worker).push(replacement);
      markInterruption(worker, "driver", args.reason || "The Driver replaced the active task.", active.taskId);
      worker.taskStopRequested = true;
      if (worker.abortController) worker.abortController.abort();
      return result({ status: "interrupting", targetTaskId: active.taskId, replacement: projectTask(replacement) });
    } catch (err) { return result({ status: "rejected", reason: err.message || String(err) }); }
  }
  function resumeTask(args, caller) {
    try {
      ctx.turnControl.assertWorkerAction(caller);
      var worker = ctx.resolvePair(caller).partner;
      if (worker.isProcessing || worker._queryStarting || current(worker)) throw new Error("the Split Worker is not idle");
      var prior = worker._lastInterruptedPairTask;
      if (!prior) throw new Error("the Split Worker has no resumable interrupted task");
      var message = cleanText(args.message, 30000) || prior.message;
      return ctx.sendFollowup({ message: message, wait: args.wait, timeoutSeconds: args.timeoutSeconds, taskId: args.taskId }, caller);
    } catch (err) { return result({ status: "rejected", reason: err.message || String(err) }); }
  }
  function report(args, worker) {
    try {
      if (!worker || ctx.sm.sessions.get(worker.localId) !== worker) throw new Error("the Worker session is no longer live");
      var resolved = ctx.rolesFor(worker);
      if (!resolved || resolved.worker !== worker) throw new Error("only the exact configured Split Worker can report an outcome");
      var active = current(worker);
      if (!active || args.taskId !== active.taskId) throw new Error("taskId must match the exact active delegated task");
      var outcome = typeof args.outcome === "string" ? args.outcome.trim().toLowerCase() : "";
      if (OUTCOMES.indexOf(outcome) === -1) throw new Error("outcome must be completed, partial, failed, or interrupted");
      active.reportedOutcome = {
        outcome: outcome,
        summary: cleanText(args.summary, MAX_TEXT) || null,
        changedFiles: cleanStrings(args.changedFiles),
        verifications: cleanVerifications(args.verifications),
        unverified: cleanStrings(args.unverified),
        processes: cleanStrings(args.processes),
        nextAction: cleanText(args.nextAction, MAX_TEXT) || null,
        reportedAt: Date.now(),
      };
      return result({ status: "recorded", taskId: active.taskId });
    } catch (err) { return result({ status: "rejected", reason: err.message || String(err) }); }
  }
  function complete(worker, caller, token, observedStatus, response, error) {
    if (!token) return null;
    if (token.outcomeEnvelope) return token.outcomeEnvelope;
    var interruption = worker._pairInterruption && worker._pairInterruption.targetTaskId === token.taskId ? worker._pairInterruption : null;
    if (interruption) interruption.completedAt = Date.now();
    var report = token.reportedOutcome || null;
    var finalStatus = error ? "failed" : (interruption ? "interrupted" : (report ? report.outcome : observedStatus));
    var envelope = {
      taskId: token.taskId,
      generation: token.generation,
      workerSessionId: worker.localId,
      status: finalStatus,
      completedAt: Date.now(),
      interruption: interruption,
      workerReport: report,
      changedFiles: report ? report.changedFiles : null,
      verifications: report ? report.verifications : null,
      unverified: report ? report.unverified : null,
      processes: report ? report.processes : null,
      nextAction: report ? report.nextAction : null,
      verificationAuthority: report ? "worker_reported" : "unknown",
      response: response || "",
      error: error || null,
    };
    token.status = finalStatus;
    token.outcomeEnvelope = envelope;
    worker._lastPairOutcome = envelope;
    if (finalStatus === "interrupted" || finalStatus === "partial") worker._lastInterruptedPairTask = { taskId: token.taskId, message: token.message, generation: token.generation };
    if (ctx.sm.sendToSession) ctx.sm.sendToSession(caller, { type: "partner_task_completed", outcome: envelope });
    return envelope;
  }
  function status(worker) {
    var active = current(worker);
    var registry = registryFor(worker);
    var ids = Object.keys(registry);
    return {
      status: "ok",
      current: active ? projectTask(active) : null,
      queued: queueFor(worker).filter(function (item) { return item.status === "queued" || item.status === "waiting_for_interrupt"; }).map(projectTask),
      interruption: worker._pairInterruption || null,
      lastOutcome: worker._lastPairOutcome || null,
      recent: ids.slice(-20).map(function (id) { return projectTask(registry[id]); }),
    };
  }
  function drain(caller, worker) {
    if (ctx.turnControl.blockedReason(caller) || worker.isProcessing || worker._queryStarting || current(worker)) return false;
    var queue = queueFor(worker);
    var next = null;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].status === "queued" || queue[i].status === "waiting_for_interrupt") { next = queue[i]; break; }
    }
    if (!next) return false;
    next.status = "starting";
    next.startedAt = Date.now();
    queue.splice(queue.indexOf(next), 1);
    Promise.resolve(ctx.sendFollowup({ message: next.message, wait: false, taskId: next.taskId }, caller)).then(function (delivery) {
      next.status = delivery && delivery.isError ? "failed" : "running";
      if (delivery && delivery.isError) next.error = delivery.content && delivery.content[0] && delivery.content[0].text || "Follow-up rejected";
    }, function (err) { next.status = "failed"; next.error = err.message || String(err); });
    return true;
  }
  function driverToolDefs(handlers) {
    return [{ name: "queue_partner_followup", description: "Queue a distinct follow-up task behind the active Split Worker task.", inputSchema: buildShape({ message: { type: "string" }, taskId: { type: "string" } }, ["message"]), handler: handlers.queue },
      { name: "inspect_partner_followups", description: "Inspect current, queued, interrupted, and last completed Split Worker task state.", inputSchema: buildShape({}), handler: handlers.inspect },
      { name: "cancel_partner_followup", description: "Cancel one exact queued follow-up without interrupting active work.", inputSchema: buildShape({ taskId: { type: "string" } }, ["taskId"]), handler: handlers.cancel },
      { name: "replace_partner_task", description: "Interrupt one exact active delegated task and queue a replacement task in the same Worker generation.", inputSchema: buildShape({ targetTaskId: { type: "string" }, message: { type: "string" }, taskId: { type: "string" }, reason: { type: "string" } }, ["targetTaskId", "message"]), handler: handlers.replace },
      { name: "resume_partner_task", description: "Resume the last interrupted task as a new correlated task. A human Stop blocks this until a new user turn.", inputSchema: buildShape({ message: { type: "string" }, taskId: { type: "string" }, wait: { type: "boolean" }, timeoutSeconds: { type: "number" } }), handler: handlers.resume }];
  }
  function workerToolDefs(worker) {
    return [{ name: "report_partner_outcome", description: "Report structured, Worker-observed task outcome data. This does not claim Driver verification.", inputSchema: buildShape({ taskId: { type: "string" }, outcome: { type: "string" }, summary: { type: "string" }, changedFiles: { type: "array", items: { type: "string" } }, verifications: { type: "array", items: { type: "object" } }, unverified: { type: "array", items: { type: "string" } }, processes: { type: "array", items: { type: "string" } }, nextAction: { type: "string" } }, ["taskId", "outcome"]), handler: function (args) { return report(args || {}, worker); } }];
  }
  return { begin: begin, cancel: cancel, complete: complete, drain: drain, driverToolDefs: driverToolDefs, ensureSystemInterruption: ensureSystemInterruption, inspect: inspect, markInterruption: markInterruption, queue: queue, replaceTask: replaceTask, resumeTask: resumeTask, status: status, workerToolDefs: workerToolDefs };
}

module.exports = { attachPairTaskControl: attachPairTaskControl };
