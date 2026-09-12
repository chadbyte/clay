var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var driverEligibility = require("./session-driver-eligibility");
var validation = require("./schedule-validation");

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

function interviewPrompt() {
  return "You are helping the user create a scheduled task for this project. Use AskUserQuestion (or the available Clay request_user_input polyfill) to ask 1-3 concise questions at a time. Establish a short name, precise instructions, a five-field cron schedule, and supported runtime settings. Explain the recurrence in plain English and confirm it with the user. Then call propose_scheduled_task with the complete proposal. Do not create or run the task yourself; the human must use the final Create task control in the Scheduled Tasks window.";
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

  function eligible(session) {
    return !!(session && !ctx.isMate && (session.runtimeMode || session.mode) === "gui" && driverEligibility.isEligibleDriverSession(session) && !ctx.isDriverOperatedSession(session));
  }

  function available(session) {
    if (!eligible(session)) return false;
    if (!sm.sessions || sm.sessions.get(session.localId) !== session) return false;
    return !ctx.canUseSession || ctx.canUseSession(session);
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
      manual: true, name: "", instructions: "", cron: "", maxIterations: 1, skipIfRunning: true, createdAt: Date.now(),
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
    var checked = validation.validateTaskInput(args);
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
    if (!available(session)) return [];
    var toolInterviewId = activeInterviewId(session);
    var queryGeneration = Number(session._sdkQueryGeneration || 0);
    return [
      {
        name: "begin_scheduled_task_interview",
        queryBound: true,
        description: "Open this project's Scheduled Tasks workbench and begin a schedule interview in this same Driver query. Use this when the user asks in natural language to create or schedule recurring work. Continue with AskUserQuestion; never create a new session from this tool.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: function () {
          if (!available(session) || Number(session._sdkQueryGeneration || 0) !== queryGeneration) return toolResult({ status: "rejected", reason: "This scheduled-task tool belongs to an older query." });
          session._scheduledTaskStartToken = crypto.randomUUID();
          var result = begin(session, "tool-" + crypto.randomUUID());
          if (result.ok && !result.duplicate) toolInterviewId = result.interviewId;
          return toolResult(Object.assign({}, result, { status: result.ok ? "interview_started" : "rejected", guidance: interviewPrompt() }));
        },
      },
      {
        name: "propose_scheduled_task",
        queryBound: true,
        description: "Publish the reviewed scheduled-task draft into the open workbench. This does not create the task; the human explicitly creates it there.",
        inputSchema: { type: "object", properties: {
          name: { type: "string" }, instructions: { type: "string" }, cron: { type: "string" },
          maxIterations: { type: "integer", minimum: 1, maximum: 100 }, skipIfRunning: { type: "boolean" },
        }, required: ["name", "instructions", "cron"], additionalProperties: false },
        handler: function (args) {
          return propose(session, toolInterviewId, queryGeneration, args || {});
        },
      },
    ];
  }

  function owner(ws) {
    var user = ws && ws._clayUser;
    return { id: user && user.id || null, name: user && (user.displayName || user.username) || null };
  }

  function list(ws, requestId) {
    var records = registry.getAll();
    var items = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (!rec.cron && !(rec.source === "schedule" && rec.date && rec.time)) continue;
      items.push(Object.assign({}, rec, {
        ownerName: rec.ownerName || (rec.ownerId && ctx.resolveOwnerName && ctx.resolveOwnerName(rec.ownerId)) || "Unassigned",
        projectSlug: ctx.projectSlug || null,
        projectTitle: ctx.projectTitle || ctx.projectSlug || "Project",
      }));
    }
    ctx.sendTo(ws, { type: "scheduled_tasks_state", requestId: requestId || null, records: items });
  }

  function createTaskFiles(id, task) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("Task storage identity is invalid.");
    var dir = path.join(ctx.cwd, ".claude", "loops", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PROMPT.md"), task.instructions + "\n", "utf8");
    fs.writeFileSync(path.join(dir, "LOOP.json"), JSON.stringify({ loopMode: "simple", maxIterations: task.maxIterations }, null, 2) + "\n", "utf8");
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
    var checked = validation.validateTaskInput(msg.data || draft);
    if (!checked.ok) return { ok: false, error: checked.error };
    var recordId = "loop_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
    var saved;
    try {
      var actor = owner(ws);
      if (session.ownerId && actor.id !== session.ownerId) return { ok: false, error: "The schedule owner does not match this Driver session." };
      createTaskFiles(recordId, checked.value);
      saved = registry.register(Object.assign({}, checked.value, {
        id: recordId, task: checked.value.instructions, prompt: checked.value.instructions, enabled: true,
        mode: "simple", source: null, ownerId: actor.id, ownerName: actor.name, sessionId: session.localId, createdViaScheduledTasks: true,
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
    if (["scheduled_tasks_list", "scheduled_task_interview_state", "scheduled_task_interview_start", "scheduled_task_manual_start", "scheduled_task_create", "scheduled_task_update", "scheduled_task_cancel"].indexOf(msg.type) === -1) return false;
    var session = ctx.getSessionForWs(ws);
    if (!session || !allowed(ws, session) || (msg.sessionId !== undefined && Number(msg.sessionId) !== Number(session.localId))) {
      ctx.sendTo(ws, { type: msg.type === "scheduled_task_manual_start" ? "scheduled_task_manual_start_result" : "scheduled_task_action_result", sessionId: session && session.localId || null, requestId: msg.requestId || null, ok: false, error: "Scheduled Tasks is unavailable in this session." });
      return true;
    }
    if (msg.type === "scheduled_tasks_list") { list(ws, msg.requestId); return true; }
    if (msg.type === "scheduled_task_interview_state") { publish(session); return true; }
    if (msg.type === "scheduled_task_manual_start") {
      var manualRequestId = clean(msg.requestId, 200);
      var manual = manualRequestId ? beginManual(session, manualRequestId) : { ok: false, error: "A correlated manual draft request is required." };
      ctx.sendTo(ws, Object.assign({ type: "scheduled_task_manual_start_result", sessionId: session.localId, requestId: msg.requestId || null }, manual));
      return true;
    }
    if (msg.type === "scheduled_task_interview_start") {
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
        var query = ctx.sdk.startQuery(session, interviewPrompt(), null, ctx.ensureProjectAccessForSession(session));
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
      if (result.ok) list(ws, null);
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
    var existing = registry.getById(msg.id);
    if (!existing) { ctx.sendTo(ws, { type: "scheduled_task_action_result", requestId: msg.requestId || null, action: "update", ok: false, error: "Task not found." }); return true; }
    if (Number(msg.version) !== Number(existing.updatedAt)) { ctx.sendTo(ws, { type: "scheduled_task_action_result", requestId: msg.requestId || null, action: "update", ok: false, error: "This task changed while it was being edited. Reopen it and try again." }); return true; }
    var update = existing.source === "schedule" && !existing.cron ? validation.validateOneOffTaskInput(msg.data || {}) : validation.validateTaskInput(msg.data || {});
    if (!update.ok) { ctx.sendTo(ws, { type: "scheduled_task_action_result", requestId: msg.requestId || null, action: "update", ok: false, error: update.error }); return true; }
    var priorRecord = Object.assign({}, existing);
    var promptPath = path.join(ctx.cwd, ".claude", "loops", existing.id, "PROMPT.md");
    var priorPrompt = null;
    var hadPrompt = false;
    if (!existing.linkedTaskId) {
      try { priorPrompt = fs.readFileSync(promptPath, "utf8"); hadPrompt = true; } catch (readError) {}
    }
    try {
      var updateData = Object.assign({}, update.value);
      if (!existing.linkedTaskId) {
        fs.mkdirSync(path.join(ctx.cwd, ".claude", "loops", existing.id), { recursive: true });
        fs.writeFileSync(promptPath, update.value.instructions + "\n", "utf8");
        updateData.task = update.value.instructions;
        updateData.prompt = update.value.instructions;
      } else {
        delete updateData.instructions;
      }
      if (!registry.update(existing.id, updateData)) throw new Error("The schedule registry did not update the task.");
      if (registry.getLastSaveError && registry.getLastSaveError()) throw new Error(registry.getLastSaveError());
    } catch (error) {
      Object.assign(existing, priorRecord);
      if (!existing.linkedTaskId) {
        try {
          if (hadPrompt) fs.writeFileSync(promptPath, priorPrompt, "utf8");
          else fs.rmSync(promptPath, { force: true });
        } catch (restoreError) {}
      }
      ctx.sendTo(ws, { type: "scheduled_task_action_result", requestId: msg.requestId || null, action: "update", ok: false, error: "The task could not be stored: " + (error.message || error) });
      return true;
    }
    ctx.sendTo(ws, { type: "scheduled_task_action_result", requestId: msg.requestId || null, action: "update", ok: true, recordId: existing.id });
    list(ws, null);
    return true;
  }

  function getSystemPrompt(session) {
    if (!available(session)) return "";
    return "When the user asks in natural language to create recurring or scheduled project work, call begin_scheduled_task_interview. Continue the interview in this same query with AskUserQuestion, then call propose_scheduled_task. Never create a sibling session for an existing-conversation request.";
  }

  return { getToolDefs: getToolDefs, getSystemPrompt: getSystemPrompt, handleMessage: handleMessage, activeInterviewId: activeInterviewId };
}

module.exports = { attachScheduledTasks: attachScheduledTasks, activeInterviewId: activeInterviewId, interviewPrompt: interviewPrompt, authorizeStoredOwner: authorizeStoredOwner };
