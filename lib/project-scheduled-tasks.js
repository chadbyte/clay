var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var driverEligibility = require("./session-driver-eligibility");
var validation = require("./schedule-validation");
var sessionToolTransport = require("./yoke/session-tool-transport");
var createScheduledTaskRecords = require("./scheduled-task-records").createScheduledTaskRecords;
var SCHEDULE_RULE_SCHEMA = {
  type: ["object", "null"],
  description: "Server-local anchored cadence. Null when using advanced cron.",
  properties: {
    version: { type: "integer", enum: [1] }, timezone: { type: "string", enum: ["server-local"] },
    anchorDate: { type: "string" }, time: { type: "string" },
    recurrence: { type: ["object", "null"], properties: { every: { type: "integer", minimum: 1, maximum: 99 }, unit: { type: "string", enum: ["day", "week", "month", "year"] }, weekdays: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 } } } },
    recurrenceEnd: { type: ["object", "null"], properties: { type: { type: "string", enum: ["until", "after"] }, date: { type: "string" }, count: { type: "integer", minimum: 1, maximum: 999 } } },
    interval: { type: ["object", "null"], properties: { every: { type: "integer", minimum: 1, maximum: 999 }, unit: { type: "string", enum: ["minute", "hour"] }, end: { type: ["object", "null"], properties: { type: { type: "string", enum: ["until", "after"] }, time: { type: "string" }, count: { type: "integer", minimum: 1, maximum: 999 } } } } },
  }, required: ["version", "timezone", "anchorDate", "time"], additionalProperties: false,
};
var RUNTIME_SCHEMA = { type: "object", properties: { vendor: { type: "string" }, model: { type: ["string", "null"] }, effort: { type: ["string", "null"] } }, required: ["vendor"], additionalProperties: false };
var EXECUTION_SCHEMA = { type: ["object", "null"], properties: { driver: RUNTIME_SCHEMA, worker: RUNTIME_SCHEMA }, required: ["driver", "worker"], additionalProperties: false };

function clean(value, max) {
  return typeof value === "string" ? value.trim().substring(0, max) : "";
}

function activeInterviewId(session) {
  var history = Array.isArray(session && session.history) ? session.history : [];
  var current = null;
  for (var i = 0; i < history.length; i++) {
    var entry = history[i];
    if (entry && (entry.source === "scheduled_task_interview" || entry.source === "scheduled_task_manual_start")) current = entry.interviewId || null;
    if (entry && entry.source === "scheduled_task_interview_close" && entry.interviewId === current) current = null;
  }
  return current;
}

function interviewPrompt(vendor) {
  var questionTool = sessionToolTransport.questionToolName(vendor || "claude");
  var proposeTool = sessionToolTransport.scheduleToolName(vendor || "claude", "propose_scheduled_task");
  return "You are helping the user create a scheduled task for this project. If the task description is blank, that is expected input for the interview, not a blocker: first ask what task they want scheduled. Use " + questionTool + " to ask exactly one concise question, wait for the answer, then ask the next question if needed. Never bundle questions. Establish a short name, precise instructions, the intended local date/time cadence, and independent Driver and Split Worker runtimes. Prefer scheduleRule for anchored day/week/month/year repeats and intra-day intervals; use cron only when the user explicitly needs an advanced custom expression. Explain the timing and execution pair in plain English and confirm them with the user. Then call " + proposeTool + " with the complete proposal. Do not create or run the task yourself; the human must use the final Create task control in the Scheduled Tasks window.";
}

function authorizeStoredOwner(record, ctx) {
  var users = ctx.usersModule;
  var multiUser = users.isMultiUser();
  if (!record || !record.ownerId) return !multiUser && !ctx.osUsers;
  var owner = users.findUserById(record.ownerId);
  if (!owner) return false;
  if (!users.getEffectivePermissions(owner, ctx.osUsers).scheduledTasks) return false;
  if (!users.canAccessProject(record.ownerId, ctx.projectAccess)) return false;
  if (!ctx.osUsers) return true;
  if (!owner.linuxUser || !ctx.resolveLinuxUser(owner.linuxUser)) return false;
  ctx.grantProjectAccess(owner.linuxUser);
  return true;
}

function attachScheduledTasks(ctx) {
  var sm = ctx.sm;
  var registry = ctx.registry;
  var records = createScheduledTaskRecords({ cwd: ctx.cwd, registry: registry, canUseSession: ctx.canUseSession, canAccessRecord: ctx.canAccessRecord, preflightRuntime: ctx.preflightRuntime, runtimeStatus: ctx.scheduledExecution ? function (record) { return ctx.scheduledExecution.runnable(record); } : null });
  var schedulerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;

  function eligible(session) {
    return !!(session && !ctx.isMate && (session.runtimeMode || session.mode) === "gui" && driverEligibility.isEligibleDriverSession(session) && !ctx.isDriverOperatedSession(session));
  }

  function available(session) {
    if (!eligible(session)) return false;
    if (!sm.sessions || sm.sessions.get(session.localId) !== session) return false;
    return !ctx.canUseSession || ctx.canUseSession(session);
  }

  function toolsAvailable(session) {
    return available(session) && sessionToolTransport.availableForSession(session).available;
  }

  function allowed(ws, session) {
    if (!eligible(session)) return false;
    if (!sm.sessions || sm.sessions.get(session.localId) !== session) return false;
    if (ctx.canAccess && !ctx.canAccess(ws, session)) return false;
    return !ctx.hasPermission || ctx.hasPermission(ws);
  }

  function record(session, entry) {
    session.history.push(entry);
    sm.appendToSessionFile(session, entry);
    sm.saveSessionFile(session);
  }

  function publish(session, options) {
    sm.sendToSession(session, {
      type: "scheduled_task_interview_state",
      sessionId: session.localId,
      interviewId: activeInterviewId(session),
      draft: session.scheduledTaskDraft || null,
      timeZone: schedulerTimeZone,
      open: !!(options && options.open),
    });
  }

  function begin(session, requestId) {
    var existing = activeInterviewId(session);
    if (existing) {
      publish(session, { open: true });
      return { ok: true, duplicate: true, interviewId: existing };
    }
    var history = session.history || [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i] && history[i].source === "scheduled_task_interview" && history[i].requestId === requestId) {
        return { ok: true, duplicate: true, closed: true, interviewId: history[i].interviewId };
      }
    }
    var interviewId = crypto.randomUUID();
    session.scheduledTaskDraft = null;
    record(session, { type: "user_message", text: "[Scheduled task interview started]", source: "scheduled_task_interview", interviewId: interviewId, requestId: requestId, _ts: Date.now(), _internal: true });
    publish(session, { open: true });
    return { ok: true, interviewId: interviewId };
  }

  function beginManual(session, requestId) {
    var existing = activeInterviewId(session);
    if (session.scheduledTaskDraft) {
      if (!existing || session.scheduledTaskDraft.interviewId !== existing) return { ok: false, error: "The existing schedule draft could not be safely resumed." };
      publish(session, { open: true });
      return { ok: true, duplicate: true, resumed: true, interviewId: existing };
    }
    if (existing) {
      return { ok: false, error: "Finish or cancel the active schedule interview before starting a manual draft." };
    }
    var history = session.history || [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i] && history[i].source === "scheduled_task_manual_start" && history[i].requestId === requestId) {
        return { ok: true, duplicate: true, closed: true, interviewId: history[i].interviewId };
      }
    }
    var interviewId = crypto.randomUUID();
    session.scheduledTaskDraft = {
      id: crypto.randomUUID(), version: 1, interviewId: interviewId, sessionId: session.localId,
      manual: true, name: "", instructions: "", cron: "", execution: null, skipIfRunning: true, createdAt: Date.now(),
    };
    record(session, { type: "scheduled_task_manual_start", source: "scheduled_task_manual_start", interviewId: interviewId, requestId: requestId, _ts: Date.now(), _internal: true });
    publish(session, { open: true });
    return { ok: true, interviewId: interviewId };
  }

  function toolResult(value) {
    return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
  }

  function propose(session, capturedInterviewId, queryGeneration, args) {
    if (!available(session) || Number(session._sdkQueryGeneration || 0) !== queryGeneration || !capturedInterviewId || activeInterviewId(session) !== capturedInterviewId) {
      return toolResult({ status: "rejected", reason: "This scheduled-task proposal belongs to a stale or unavailable interview." });
    }
    var checked = validation.validateScheduledTaskInput(args);
    if (!checked.ok) return toolResult({ status: "rejected", reason: checked.error });
    var prior = session.scheduledTaskDraft;
    var draft = Object.assign({}, checked.value, {
      id: prior && prior.id || crypto.randomUUID(),
      version: prior && prior.interviewId === capturedInterviewId ? Number(prior.version) + 1 : 1,
      interviewId: capturedInterviewId,
      sessionId: session.localId,
      createdAt: prior && prior.createdAt || Date.now(),
    });
    session.scheduledTaskDraft = draft;
    sm.saveSessionFile(session);
    publish(session, { open: true });
    return toolResult({ status: "proposed", draft: draft });
  }

  function getToolDefs(session) {
    if (!toolsAvailable(session)) return [];
    var toolInterviewId = activeInterviewId(session);
    var queryGeneration = Number(session._sdkQueryGeneration || 0);
    return [
      {
        name: "begin_scheduled_task_interview",
        queryBound: true,
        scheduleInterviewActive: function () { return !!activeInterviewId(session); },
        structuredQuestionLimit: function () { return available(session) && Number(session._sdkQueryGeneration || 0) === queryGeneration && activeInterviewId(session) ? 1 : null; },
        description: "Open this project's Scheduled Tasks workbench and begin a schedule interview in this same Driver query. Use this when the user asks in natural language to create or schedule recurring work. Missing task details are expected interview input: ask the user for them with structured questions. Never create a new session from this tool.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: function () {
          if (!available(session) || Number(session._sdkQueryGeneration || 0) !== queryGeneration) return toolResult({ status: "rejected", reason: "This scheduled-task tool belongs to an older query." });
          session._scheduledTaskStartToken = crypto.randomUUID();
          var result = begin(session, "tool-" + crypto.randomUUID());
          if (result.ok && !result.duplicate) toolInterviewId = result.interviewId;
          return toolResult(Object.assign({}, result, { status: result.ok ? "interview_started" : "rejected", guidance: interviewPrompt(session.vendor || "claude") }));
        },
      },
      {
        name: "propose_scheduled_task",
        queryBound: true,
        description: "Publish the reviewed scheduled-task draft into the open workbench. Prefer an anchored scheduleRule for normal recurrence and interval controls; use cron only for an explicit advanced custom expression. This does not create the task; the human explicitly creates it there.",
        inputSchema: { type: "object", properties: {
          name: { type: "string" }, instructions: { type: "string" }, cron: { type: ["string", "null"] }, date: { type: "string" }, time: { type: "string" },
          scheduleRule: SCHEDULE_RULE_SCHEMA,
          execution: EXECUTION_SCHEMA, skipIfRunning: { type: "boolean" },
        }, required: ["name", "instructions", "cron"], additionalProperties: false },
        handler: function (args) {
          return propose(session, toolInterviewId, queryGeneration, args || {});
        },
      },
      {
        name: "list_scheduled_tasks", queryBound: true,
        description: "List scheduled tasks owned by this Driver session. Use this to identify an existing task before reading or editing it.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: function () {
          if (!available(session) || Number(session._sdkQueryGeneration || 0) !== queryGeneration) return toolResult({ status: "rejected", reason: "This scheduled-task tool belongs to an older query." });
          return toolResult({ status: "ok", tasks: records.list(session) });
        },
      },
      {
        name: "read_scheduled_task", queryBound: true,
        description: "Read one scheduled task by stable id, including its revision, owner, schedule, instructions, and runtime settings.",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
        handler: function (args) {
          if (!available(session) || Number(session._sdkQueryGeneration || 0) !== queryGeneration) return toolResult({ status: "rejected", reason: "This scheduled-task tool belongs to an older query." });
          var result = records.read(session, clean(args && args.id, 200));
          if (result.ok) publishRecord(session, result.record);
          return toolResult(result);
        },
      },
      {
        name: "update_scheduled_task", queryBound: true,
        description: "Update the exact existing scheduled task by stable id and revision. Omitted fields are preserved; this never creates a duplicate task.",
        inputSchema: { type: "object", properties: {
          id: { type: "string" }, revision: { type: "number" }, name: { type: "string" }, instructions: { type: "string" }, cron: { type: ["string", "null"] },
          date: { type: "string" }, time: { type: "string" }, scheduleRule: SCHEDULE_RULE_SCHEMA, execution: EXECUTION_SCHEMA, skipIfRunning: { type: "boolean" },
        }, required: ["id", "revision"], additionalProperties: false },
        handler: function (args) {
          if (!available(session) || Number(session._sdkQueryGeneration || 0) !== queryGeneration) return toolResult({ status: "rejected", reason: "This scheduled-task tool belongs to an older query." });
          var patch = Object.assign({}, args || {}); delete patch.id; delete patch.revision;
          var result = records.update(session, clean(args && args.id, 200), args && args.revision, patch);
          if (result.ok) publishRecord(session, result.record);
          return toolResult(result);
        },
      },
    ];
  }

  function publishRecord(session, record) {
    sm.sendToSession(session, { type: "scheduled_task_driver_edit_state", sessionId: session.localId, record: record, open: true });
  }

  function owner(ws) {
    var user = ws && ws._clayUser;
    return { id: user && user.id || null, name: user && (user.displayName || user.username) || null };
  }

  function list(ws, requestId, session) {
    var taskRecords = registry.getAll();
    var items = [];
    for (var i = 0; i < taskRecords.length; i++) {
      var rec = taskRecords[i];
      if (!rec.cron && !rec.scheduleRule && !(rec.source === "schedule" && rec.date && rec.time)) continue;
      if (!records.canAccess(session, rec)) continue;
      items.push(Object.assign({}, rec, {
        ownerName: rec.ownerName || (rec.ownerId && ctx.resolveOwnerName && ctx.resolveOwnerName(rec.ownerId)) || "Unassigned",
        projectSlug: ctx.projectSlug || null,
        projectTitle: ctx.projectTitle || ctx.projectSlug || "Project",
        readiness: ctx.scheduledExecution ? ctx.scheduledExecution.runnable(rec) : null,
        latestRun: Array.isArray(rec.runs) && rec.runs.length ? rec.runs[rec.runs.length - 1] : null,
      }));
    }
    ctx.sendTo(ws, { type: "scheduled_tasks_state", requestId: requestId || null, records: items, timeZone: schedulerTimeZone });
  }

  async function engineState(ws, msg, session) {
    var userId = ws && ws._clayUser ? ws._clayUser.id : "default";
    var preference = ctx.usersModule && ctx.usersModule.getScheduledTaskInterviewEngine ? ctx.usersModule.getScheduledTaskInterviewEngine(userId) : {};
    var installed = (sm.installedVendors || []).filter(function (vendor) { return sessionToolTransport.capability(vendor).kind !== "none"; });
    var runtimeInstalled = sm.installedVendors || [];
    var requestedVendor = clean(msg && msg.vendor, 40);
    var targetVendor = runtimeInstalled.indexOf(requestedVendor) !== -1 ? requestedVendor : (installed.indexOf(preference.vendor) !== -1 ? preference.vendor : installed[0] || "");
    var catalogError = "";
    if (targetVendor && ctx.getEngineCatalog) {
      try {
        var catalog = await ctx.getEngineCatalog(ws, targetVendor);
        if (!catalog || catalog.status !== "ready") catalogError = catalog && catalog.error || "Models are not available for this interview engine yet.";
      } catch (error) { catalogError = error.message || String(error); }
    }
    var models = {};
    var ready = {};
    for (var i = 0; i < runtimeInstalled.length; i++) {
      models[runtimeInstalled[i]] = (sm.modelsByVendor && sm.modelsByVendor[runtimeInstalled[i]] || []).slice();
      ready[runtimeInstalled[i]] = models[runtimeInstalled[i]].length > 0;
    }
    ctx.sendTo(ws, { type: "scheduled_task_interview_engine_state", requestId: msg.requestId || null, projectSlug: ctx.projectSlug || null, sessionId: session.localId, installedVendors: installed, runtimeInstalledVendors: runtimeInstalled.slice(), modelsByVendor: models, catalogReadyByVendor: ready, catalogVendor: targetVendor, error: catalogError, preference: preference || {} });
  }

  function createTaskFiles(id, task) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("Task storage identity is invalid.");
    var dir = path.join(ctx.cwd, ".claude", "loops", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PROMPT.md"), task.instructions + "\n", "utf8");
  }

  function createFromDraft(ws, session, msg) {
    var requestId = clean(msg.requestId, 200);
    var history = session.history || [];
    for (var i = 0; i < history.length; i++) {
      if (history[i] && history[i].source === "scheduled_task_created" && history[i].requestId === requestId) return { ok: true, duplicate: true, recordId: history[i].recordId };
    }
    var draft = session.scheduledTaskDraft;
    if (!draft || draft.id !== clean(msg.proposalId, 200) || Number(draft.version) !== Number(msg.version) || draft.interviewId !== activeInterviewId(session)) {
      return { ok: false, error: "This scheduled-task draft is stale or no longer pending." };
    }
    var taskInput = msg.data || draft;
    var checked = validation.validateScheduledTaskInput(taskInput);
    if (!checked.ok) return { ok: false, error: checked.error };
    if (!checked.value.execution) return { ok: false, error: "Choose both a Driver and a Split Worker runtime." };
    if (ctx.preflightRuntime) {
      try {
        ctx.preflightRuntime(checked.value.execution.driver, null, true);
        ctx.preflightRuntime(checked.value.execution.worker, null, true);
      } catch (runtimeError) { return { ok: false, error: runtimeError.message || String(runtimeError) }; }
    }
    var recordId = "loop_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
    var saved;
    try {
      var actor = owner(ws);
      if (session.ownerId && actor.id !== session.ownerId) return { ok: false, error: "The schedule owner does not match this Driver session." };
      createTaskFiles(recordId, checked.value);
      saved = registry.register(Object.assign({}, checked.value, {
        id: recordId, task: checked.value.instructions, prompt: checked.value.instructions, enabled: true,
        mode: "simple", source: checked.value.cron ? null : "schedule", ownerId: actor.id, ownerName: actor.name, sessionId: session.localId, createdViaScheduledTasks: true,
      }));
      if (!saved || (registry.getLastSaveError && registry.getLastSaveError())) throw new Error(registry.getLastSaveError() || "The schedule registry did not save the task.");
    } catch (error) {
      if (saved && saved.id && registry.remove) {
        try { registry.remove(saved.id); } catch (removeError) {}
      }
      try { fs.rmSync(path.join(ctx.cwd, ".claude", "loops", recordId), { recursive: true, force: true }); } catch (removeFileError) {}
      return { ok: false, error: "The task could not be stored: " + (error.message || error) };
    }
    record(session, { type: "scheduled_task_created", source: "scheduled_task_created", interviewId: draft.interviewId, proposalId: draft.id, proposalVersion: draft.version, requestId: requestId, recordId: saved.id, _ts: Date.now() });
    record(session, { type: "scheduled_task_interview_close", source: "scheduled_task_interview_close", interviewId: draft.interviewId, _ts: Date.now() });
    session.scheduledTaskDraft = null;
    sm.saveSessionFile(session);
    publish(session);
    return { ok: true, recordId: saved.id };
  }

  function handleMessage(ws, msg) {
    if (["scheduled_tasks_list", "scheduled_task_interview_engine_get", "scheduled_task_interview_state", "scheduled_task_interview_start", "scheduled_task_manual_start", "scheduled_task_create", "scheduled_task_update", "scheduled_task_cancel", "scheduled_task_run", "scheduled_task_toggle", "scheduled_task_delete", "scheduled_task_open_run"].indexOf(msg.type) === -1) return false;
    var session = ctx.getSessionForWs(ws);
    if (!session || !allowed(ws, session) || (msg.sessionId !== undefined && Number(msg.sessionId) !== Number(session.localId))) {
      ctx.sendTo(ws, { type: msg.type === "scheduled_task_manual_start" ? "scheduled_task_manual_start_result" : "scheduled_task_action_result", sessionId: session && session.localId || null, requestId: msg.requestId || null, ok: false, error: "Scheduled Tasks is unavailable in this session." });
      return true;
    }
    if (msg.type === "scheduled_tasks_list") { list(ws, msg.requestId, session); return true; }
    if (msg.type === "scheduled_task_run" || msg.type === "scheduled_task_toggle" || msg.type === "scheduled_task_delete" || msg.type === "scheduled_task_open_run") {
      var actionRequestId = clean(msg.requestId, 200);
      var actionFingerprint = msg.type + ":" + clean(msg.id, 200) + ":" + Number(msg.version);
      var priorAction = null;
      for (var hi = (session.history || []).length - 1; hi >= 0; hi--) {
        if (session.history[hi] && session.history[hi].source === "scheduled_task_action" && session.history[hi].requestId === actionRequestId) { priorAction = session.history[hi]; break; }
      }
      if (!actionRequestId || (priorAction && priorAction.fingerprint !== actionFingerprint)) {
        ctx.sendTo(ws, { type: "scheduled_task_action_result", requestId: msg.requestId || null, action: msg.type, ok: false, error: "A unique correlated scheduled-task action is required." });
        return true;
      }
      if (priorAction) { ctx.sendTo(ws, Object.assign({}, priorAction.result, { duplicate: true })); return true; }
      var actionRecord = registry.getById(clean(msg.id, 200));
      if (!actionRecord || !records.canAccess(session, actionRecord) || Number(msg.version) !== Number(actionRecord.updatedAt)) {
        ctx.sendTo(ws, { type: "scheduled_task_action_result", requestId: msg.requestId || null, action: msg.type, ok: false, error: "This scheduled task changed or is unavailable." });
        return true;
      }
      var actionOk = false; var actionError = null; var openSessionId = null;
      if (msg.type === "scheduled_task_open_run") {
        var runRef = actionRecord.activeRun || (Array.isArray(actionRecord.runs) && actionRecord.runs.length ? actionRecord.runs[actionRecord.runs.length - 1] : null);
        if (runRef && runRef.driverOriginId) sm.sessions.forEach(function (candidate) {
          var marker = candidate.scheduledTaskRun;
          if (openSessionId === null && candidate.ownerId === actionRecord.ownerId && candidate.sessionOriginId === runRef.driverOriginId && marker && marker.role === "driver" && marker.scheduleId === actionRecord.id && marker.runId === runRef.runId) openSessionId = candidate.localId;
        });
        actionOk = openSessionId !== null; actionError = actionOk ? null : "The saved Driver session for this run is unavailable.";
      } else if (msg.type === "scheduled_task_run") {
        var runResult = ctx.scheduledExecution.trigger(actionRecord, "manual"); actionOk = !!runResult.ok; actionError = runResult.error || null;
      } else if (msg.type === "scheduled_task_toggle") actionOk = !!registry.toggleEnabled(actionRecord.id);
      else {
        if (actionRecord.activeRun) ctx.scheduledExecution.stopRecord(actionRecord, "The scheduled task was deleted.");
        actionOk = registry.remove(actionRecord.id);
      }
      var actionResult = { type: "scheduled_task_action_result", requestId: msg.requestId || null, action: msg.type, ok: actionOk, sessionId: openSessionId, error: actionOk ? null : actionError || "The scheduled task action failed." };
      record(session, { type: "scheduled_task_action", source: "scheduled_task_action", requestId: actionRequestId, fingerprint: actionFingerprint, result: actionResult, _ts: Date.now() });
      ctx.sendTo(ws, actionResult);
      if (actionOk) list(ws, null, session);
      return true;
    }
    if (msg.type === "scheduled_task_interview_engine_get") {
      Promise.resolve(engineState(ws, msg, session)).catch(function (error) {
        ctx.sendTo(ws, { type: "scheduled_task_interview_engine_state", requestId: msg.requestId || null, projectSlug: ctx.projectSlug || null, sessionId: session.localId, error: error.message || String(error), installedVendors: [], modelsByVendor: {}, catalogReadyByVendor: {}, preference: {} });
      });
      return true;
    }
    if (msg.type === "scheduled_task_interview_state") { publish(session); return true; }
    if (msg.type === "scheduled_task_manual_start") {
      var manualRequestId = clean(msg.requestId, 200);
      var manual = manualRequestId ? beginManual(session, manualRequestId) : { ok: false, error: "A correlated manual draft request is required." };
      ctx.sendTo(ws, Object.assign({ type: "scheduled_task_manual_start_result", sessionId: session.localId, requestId: msg.requestId || null }, manual));
      return true;
    }
    if (msg.type === "scheduled_task_interview_start") {
      var toolAvailability = sessionToolTransport.availableForSession(session);
      if (!toolAvailability.available) {
        ctx.sendTo(ws, { type: "scheduled_task_interview_start_result", sessionId: session.localId, requestId: msg.requestId || null, ok: false, error: toolAvailability.reason });
        return true;
      }
      if (session.isProcessing || session._queryStarting) {
        ctx.sendTo(ws, { type: "scheduled_task_interview_start_result", sessionId: session.localId, requestId: msg.requestId || null, ok: false, error: "Wait for the current task to finish." });
        return true;
      }
      var started = begin(session, clean(msg.requestId, 200));
      if (started.duplicate) {
        ctx.sendTo(ws, { type: "scheduled_task_interview_start_result", sessionId: session.localId, requestId: msg.requestId || null, ok: true, duplicate: true, interviewId: started.interviewId });
        return true;
      }
      session.isProcessing = true;
      var startToken = crypto.randomUUID();
      session._scheduledTaskStartToken = startToken;
      ctx.onProcessingChanged();
      ctx.sendToSession(session.localId, { type: "status", status: "processing" });
      try {
        var query = ctx.sdk.startQuery(session, interviewPrompt(session.vendor || "claude"), null, ctx.ensureProjectAccessForSession(session));
        var startQueryGeneration = Number(session._sdkQueryGeneration || 0);
        ctx.sendTo(ws, { type: "scheduled_task_interview_start_result", sessionId: session.localId, requestId: msg.requestId || null, ok: true, interviewId: started.interviewId });
        Promise.resolve(query).catch(function (error) {
          if (activeInterviewId(session) !== started.interviewId || session._scheduledTaskStartToken !== startToken || Number(session._sdkQueryGeneration || 0) !== startQueryGeneration) return;
          session.isProcessing = false;
          ctx.onProcessingChanged();
          ctx.sendToSession(session.localId, { type: "status", status: "idle" });
          if (!session.scheduledTaskDraft) record(session, { type: "scheduled_task_interview_close", source: "scheduled_task_interview_close", interviewId: started.interviewId, _ts: Date.now() });
          ctx.sendTo(ws, { type: "scheduled_task_interview_start_result", sessionId: session.localId, requestId: msg.requestId || null, ok: false, error: error.message || String(error) });
        });
      } catch (error) {
        session.isProcessing = false;
        ctx.onProcessingChanged();
        if (!session.scheduledTaskDraft) record(session, { type: "scheduled_task_interview_close", source: "scheduled_task_interview_close", interviewId: started.interviewId, _ts: Date.now() });
        ctx.sendTo(ws, { type: "scheduled_task_interview_start_result", sessionId: session.localId, requestId: msg.requestId || null, ok: false, error: error.message || String(error) });
      }
      return true;
    }
    if (msg.type === "scheduled_task_create") {
      var result = createFromDraft(ws, session, msg);
      ctx.sendTo(ws, Object.assign({ type: "scheduled_task_action_result", requestId: msg.requestId || null, action: "create" }, result));
      if (result.ok) list(ws, null, session);
      return true;
    }
    if (msg.type === "scheduled_task_cancel") {
      var draft = session.scheduledTaskDraft;
      var cancelInterviewId = draft && draft.id === msg.proposalId && Number(draft.version) === Number(msg.version) ? draft.interviewId : clean(msg.interviewId, 200);
      if (cancelInterviewId && cancelInterviewId === activeInterviewId(session)) {
        session._scheduledTaskStartToken = crypto.randomUUID();
        record(session, { type: "scheduled_task_interview_close", source: "scheduled_task_interview_close", interviewId: cancelInterviewId, _ts: Date.now() });
        session.scheduledTaskDraft = null; sm.saveSessionFile(session); publish(session);
      }
      return true;
    }
    var updated = records.update(session, clean(msg.id, 200), msg.version, msg.data || {});
    ctx.sendTo(ws, { type: "scheduled_task_action_result", requestId: msg.requestId || null, action: "update", ok: updated.ok, recordId: updated.record && updated.record.id || null, error: updated.error || null });
    if (!updated.ok) return true;
    list(ws, null, session);
    return true;
  }

  function getSystemPrompt(session) {
    if (!toolsAvailable(session)) return "";
    var vendor = session.vendor || "claude";
    return "When the user asks in natural language to create recurring or scheduled project work, call " + sessionToolTransport.scheduleToolName(vendor, "begin_scheduled_task_interview") + ". Continue in this same query, asking exactly one question at a time with " + sessionToolTransport.questionToolName(vendor) + ", then call " + sessionToolTransport.scheduleToolName(vendor, "propose_scheduled_task") + ". Missing task details are expected interview input, not a blocker. When the user asks to inspect or edit an existing scheduled task, use " + sessionToolTransport.scheduleToolName(vendor, "list_scheduled_tasks") + ", " + sessionToolTransport.scheduleToolName(vendor, "read_scheduled_task") + ", and " + sessionToolTransport.scheduleToolName(vendor, "update_scheduled_task") + "; update by stable id and revision and never create a duplicate. Never create a sibling session for an existing-conversation request.";
  }

  function canStartInterview(ws, session) {
    return allowed(ws, session) && toolsAvailable(session);
  }

  return { getToolDefs: getToolDefs, getSystemPrompt: getSystemPrompt, handleMessage: handleMessage, activeInterviewId: activeInterviewId, canStartInterview: canStartInterview };
}

module.exports = { attachScheduledTasks: attachScheduledTasks, activeInterviewId: activeInterviewId, interviewPrompt: interviewPrompt, authorizeStoredOwner: authorizeStoredOwner };
