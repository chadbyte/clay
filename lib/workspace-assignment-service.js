var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var ACTIVE = { proposed: true, queued: true, starting: true, running: true };
var MAX_RUNNING = 3;

function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function userStorageKey(userId) {
  return crypto.createHash("sha256").update(String(userId || "_single_user")).digest("hex").slice(0, 24) + ".json";
}

function attachWorkspaceAssignmentService(ctx) {
  var storageDir = ctx.storageDir || null;
  var records = [];
  var unsubscribers = {};
  var pendingRestartReplay = {};
  var presentations = new WeakMap();
  var presentationTargets = new WeakMap();
  var followUps = require('./workspace-follow-up-queue').createFollowUpQueue({ records: records,
    exactSource: exactSource, exactTarget: exactTarget, settle: settle, approve: approve });

  function recordFile(userId) {
    return storageDir ? path.join(storageDir, userStorageKey(userId)) : null;
  }

  function saveUser(userId) {
    var file = recordFile(userId);
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    var owned = records.filter(function (record) { return record.userId === (userId || null); });
    var temp = file + ".tmp." + process.pid;
    fs.writeFileSync(temp, JSON.stringify(owned, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  function load() {
    if (!storageDir) return;
    var files = [];
    try { files = fs.readdirSync(storageDir); } catch (e) { return; }
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith(".json") || files[i].indexOf(".tmp.") !== -1) continue;
      try {
        var loaded = JSON.parse(fs.readFileSync(path.join(storageDir, files[i]), "utf8"));
        if (Array.isArray(loaded)) records.push.apply(records, loaded);
      } catch (e) {}
    }
    var changedUsers = {};
    for (var j = 0; j < records.length; j++) {
      if (records[j].status !== "queued" && records[j].status !== "starting" && records[j].status !== "running") continue;
      records[j].deliveryState = records[j].status === "queued" ? "not_sent" : "unknown";
      records[j].status = "interrupted";
      records[j].error = "Clay restarted before this assignment completed.";
      records[j].updatedAt = Date.now();
      pendingRestartReplay[records[j].assignmentId] = true;
      changedUsers[String(records[j].userId || "_single_user")] = records[j].userId || null;
    }
    var keys = Object.keys(changedUsers);
    for (var k = 0; k < keys.length; k++) saveUser(changedUsers[keys[k]]);
  }

  function sourceKey(principal) {
    return String(principal.userId || "_single_user") + ":" + principal.sourceProjectSlug + ":" + principal.sourceSessionRef;
  }

  function normalizePrincipal(principal) {
    if (!principal || !principal.sourceProjectSlug) return null;
    var project = ctx.getProjects().get(principal.sourceProjectSlug);
    var manager = project && project.getSessionManager ? project.getSessionManager() : null;
    var session = manager && manager.sessions ? manager.sessions.get(principal.sourceSessionId) : null;
    if (!session && manager && manager.sessions && principal.sourceSessionRef) {
      manager.sessions.forEach(function (candidate) {
        if (!session && ctx.sessionRef(principal.sourceProjectSlug, candidate) === principal.sourceSessionRef) session = candidate;
      });
    }
    if (!session) return null;
    return Object.assign({}, principal, {
      sourceSessionId: session.localId,
      sourceSessionRef: ctx.sessionRef(principal.sourceProjectSlug, session),
    });
  }

  function publicRecord(record) {
    return {
      assignmentId: record.assignmentId,
      delivery: record.delivery || "new_session",
      projectSlug: record.targetProjectSlug,
      projectTitle: record.targetProjectTitle,
      title: record.title,
      task: record.task,
      status: record.status,
      deliveryState: record.deliveryState || null,
      parentAssignmentId: record.parentAssignmentId || null,
      sourceProjectSlug: record.sourceProjectSlug,
      sourceSessionRef: record.sourceSessionRef,
      targetSessionRef: record.targetSessionRef || null,
      targetSessionTitle: record.targetSessionTitle || null,
      resultSummary: record.resultSummary || "",
      error: record.error || "",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  function ownsProject(record, status) {
    if (!status || status.isWorktree || status.isMate) return false;
    if (ctx.isMultiUser()) return !!record.userId && status.projectOwnerId === record.userId;
    return !status.projectOwnerId || (!!record.singleUserOwnerId && status.projectOwnerId === record.singleUserOwnerId);
  }

  function exactTarget(record) {
    var project = ctx.getProjects().get(record.targetProjectSlug);
    if (!project || !ownsProject(record, project.getStatus())) return null;
    return project;
  }

  function exactSource(record) {
    var project = ctx.getProjects().get(record.sourceProjectSlug);
    if (!project) return null;
    var status = project.getStatus();
    if (!status || status.isMate !== true || status.mateId !== record.sourceMateId) return null;
    if (ctx.isMultiUser() && status.projectOwnerId !== record.userId) return null;
    var mate = ctx.resolveMate && ctx.resolveMate(status.projectOwnerId || null, record.sourceMateId);
    if (ctx.resolveMate && (!mate || mate.id !== record.sourceMateId || ctx.isMultiUser() && mate.createdBy !== record.userId)) return null;
    var manager = project.getSessionManager();
    var session = null;
    if (manager && manager.sessions) {
      manager.sessions.forEach(function (candidate) {
        if (!session && ctx.sessionRef(record.sourceProjectSlug, candidate) === record.sourceSessionRef) session = candidate;
      });
    }
    if (!session) return null;
    if (ctx.isMultiUser() && session.ownerId !== record.userId) return null;
    if (!ctx.isMultiUser() && session.ownerId && session.ownerId !== record.singleUserOwnerId) return null;
    return { project: project, manager: manager, session: session, mate: mate || null };
  }

  function present(record, principal) {
    try {
      var display = ctx.getPresentation && ctx.getPresentation(principal), project = exactTarget(record);
      if (!display || !project) return;
      var view = { project: project, session: null, origin: null }; presentationTargets.set(record, view);
      if (record.delivery === 'follow_up') project.getSessionManager().sessions.forEach(function (session) { if (ctx.sessionRef(record.targetProjectSlug, session) === record.targetSessionRef) { view.session = session; view.origin = session.sessionOriginId; } });
      var projection = require('./clay-control-target-projection');
      var target = view.session ? { kind: 'session', projectSlug: record.targetProjectSlug, sessionId: view.session.localId, sessionOriginId: view.origin } : { kind: 'project', projectSlug: record.targetProjectSlug, runtimeId: projection.runtime(project.getSessionManager()) };
      var observer = display.track('assignment', record.delivery === 'follow_up' ? 'follow_up' : 'assign', target, function () {
        if (exactTarget(record) !== project || view.session && (project.getSessionManager().sessions.get(view.session.localId) !== view.session || view.session.sessionOriginId !== view.origin || (view.session.ownerId || null) !== (record.userId || null))) throw new Error('Assignment target changed.');
      }, 'review');
      if (observer) { presentations.set(record, observer); var expiry = setTimeout(function () { presentations.delete(record); }, 300000); expiry.unref(); }
    } catch (error) { /* Presentation never changes the assignment decision. */ }
  }
  function emit(record, eventType) {
    var observer = presentations.get(record);
    if (observer) {
      if (record.status === 'starting' || record.status === 'queued') observer.phase('queued');
      else if (record.status === 'running') observer.phase('running');
      else if (record.status !== 'proposed') { observer.finish({ status: record.status === 'interrupted' ? 'failed' : record.status, outcome: record.status === 'interrupted' ? 'uncertain' : undefined }); presentations.delete(record); }
    }
    var source = exactSource(record);
    if (!source) return;
    source.manager.sendAndRecord(source.session, {
      type: eventType || "project_assignment_status",
      assignment: publicRecord(record),
      requestId: record.sourceRequestId || null,
    });
  }

  function reconcileProject(projectSlug) {
    for (var i = 0; i < records.length; i++) {
      if (!pendingRestartReplay[records[i].assignmentId] || records[i].sourceProjectSlug !== projectSlug) continue;
      if (!exactSource(records[i])) continue;
      emit(records[i]);
      delete pendingRestartReplay[records[i].assignmentId];
    }
  }

  function propose(principal, args) {
    principal = normalizePrincipal(principal);
    if (!principal || !principal.sourceSessionRef) throw new Error("Project assignments require an exact session-bound Mate query.");
    var projectSlug = clean(args.projectSlug, 120);
    var title = clean(args.title, 160);
    var task = clean(args.task, 12000);
    if (!projectSlug || !title || !task) throw new Error("projectSlug, title, and task are required.");
    var candidate = {
      userId: principal.userId || null,
      singleUserOwnerId: principal.singleUserOwnerId || null,
      targetProjectSlug: projectSlug,
    };
    var target = exactTarget(candidate);
    if (!target) throw new Error("Target project not found in the owned workspace.");
    var key = sourceKey(principal);
    var idempotency = crypto.createHash("sha256").update(key + "\u0000" + projectSlug + "\u0000" + title + "\u0000" + task).digest("hex");
    for (var i = 0; i < records.length; i++) {
      if (records[i].idempotencyKey === idempotency) return publicRecord(records[i]);
      if (records[i].sourceKey === key && ACTIVE[records[i].status]) throw new Error("This conversation already has an active assignment.");
    }
    var now = Date.now();
    var targetStatus = target.getStatus();
    var record = {
      assignmentId: "assignment_" + crypto.randomUUID(),
      idempotencyKey: idempotency,
      sourceKey: key,
      userId: principal.userId || null,
      singleUserOwnerId: principal.singleUserOwnerId || null,
      sourceMateId: principal.mateId,
      sourceProjectSlug: principal.sourceProjectSlug,
      sourceSessionRef: principal.sourceSessionRef,
      sourceRequestId: principal.sourceRequestId || null,
      targetProjectSlug: projectSlug,
      targetProjectTitle: clean(targetStatus.title || targetStatus.project || projectSlug, 160),
      title: title,
      task: task,
      delivery: "new_session",
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    };
    if (!exactSource(record)) throw new Error("Source conversation is no longer available.");
    records.push(record);
    saveUser(record.userId);
    present(record, principal);
    emit(record, "project_assignment_proposal");
    return publicRecord(record);
  }

  function proposeFollowUp(principal, args) {
    principal = normalizePrincipal(principal);
    if (!principal || !principal.sourceSessionRef) throw new Error("Project follow-ups require an exact session-bound Mate query.");
    var projectSlug = clean(args.projectSlug, 120);
    var targetSessionRef = clean(args.targetSessionRef, 100);
    var title = clean(args.title, 160);
    var task = clean(args.task, 12000);
    if (!projectSlug || !targetSessionRef || !title || !task) throw new Error("projectSlug, targetSessionRef, title, and task are required.");
    var key = sourceKey(principal);
    var idempotency = crypto.createHash("sha256").update(key + "\u0000follow_up\u0000" + projectSlug + "\u0000" + targetSessionRef + "\u0000" + title + "\u0000" + task).digest("hex");
    for (var i = 0; i < records.length; i++) {
      if (records[i].idempotencyKey === idempotency) return publicRecord(records[i]);
      if (records[i].sourceKey === key && ACTIVE[records[i].status] &&
          (records[i].targetProjectSlug !== projectSlug || records[i].targetSessionRef !== targetSessionRef)) throw new Error("An active assignment already exists. Send this update to that exact Driver session.");
    }
    var candidate = { userId: principal.userId || null, singleUserOwnerId: principal.singleUserOwnerId || null, targetProjectSlug: projectSlug };
    var target = exactTarget(candidate);
    if (!target || typeof target.inspectDelegatedFollowUp !== "function") throw new Error("Target project is unavailable for follow-ups.");
    if (records.filter(function (item) { return item.sourceKey === key && item.delivery === 'follow_up' && ACTIVE[item.status]; }).length >= 16) throw new Error('There are already 16 pending follow-ups. Wait for or cancel a review.');
    var candidateInput = { userId: principal.userId || null, sourceKey: key, targetProjectSlug: projectSlug, targetSessionRef: targetSessionRef,
      sourceMateId: principal.mateId, sourceProjectSlug: principal.sourceProjectSlug, sourceSessionRef: principal.sourceSessionRef };
    var inspected = followUps.inspect(candidateInput, target);
    var now = Date.now();
    var targetStatus = target.getStatus();
    var record = {
      assignmentId: "assignment_" + crypto.randomUUID(), idempotencyKey: idempotency, sourceKey: key,
      userId: principal.userId || null, singleUserOwnerId: principal.singleUserOwnerId || null,
      sourceMateId: principal.mateId, sourceProjectSlug: principal.sourceProjectSlug,
      sourceSessionRef: principal.sourceSessionRef, sourceRequestId: principal.sourceRequestId || null,
      targetProjectSlug: projectSlug, targetProjectTitle: clean(targetStatus.title || targetStatus.project || projectSlug, 160),
      targetSessionRef: inspected.sessionRef, targetSessionTitle: clean(inspected.title || "Existing session", 160),
      title: title, task: task, delivery: "follow_up", status: "proposed", createdAt: now, updatedAt: now,
    };
    if (!exactSource(record)) throw new Error("Source conversation is no longer available.");
    followUps.remember(record, target, inspected);
    records.push(record);
    saveUser(record.userId);
    present(record, principal);
    emit(record, "project_assignment_proposal");
    return publicRecord(record);
  }

  function findOwned(userId, assignmentId) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].assignmentId === assignmentId && records[i].userId === (userId || null)) return records[i];
    }
    return null;
  }

  function responseUserId(ws) {
    return ctx.isMultiUser() && ws && ws._clayUser ? ws._clayUser.id : null;
  }

  function summarize(session) {
    var text = "";
    for (var i = (session && session.history || []).length - 1; i >= 0; i--) {
      if (session.history[i].type === "delta") text = session.history[i].text + text;
      else if (text && (session.history[i].type === "user_message" || session.history[i].type === "delegated_work" || session.history[i].type === "delegated_follow_up")) break;
    }
    return clean(text, 1200);
  }

  function settle(record, status, session, error) {
    if (!ACTIVE[record.status]) return publicRecord(record);
    if (record.delivery === "follow_up" && record.deliveryState !== "accepted") record.deliveryState = record.status === "starting" ? "unknown" : "not_sent";
    record.status = status;
    followUps.cleanup(record);
    record.resultSummary = status === "completed" ? summarize(session) : "";
    record.error = clean(error || "", 800);
    record.updatedAt = Date.now();
    if (unsubscribers[record.assignmentId]) unsubscribers[record.assignmentId]();
    delete unsubscribers[record.assignmentId];
    saveUser(record.userId);
    emit(record);
    followUps.wake(record);
    return publicRecord(record);
  }

  function watch(record, manager, session) {
    var view = presentationTargets.get(record); if (view) { view.session = session; view.origin = session.sessionOriginId; var observer = presentations.get(record); if (observer && observer.target) observer.target({ kind: 'session', projectSlug: record.targetProjectSlug, sessionId: session.localId, sessionOriginId: session.sessionOriginId }); }
    if (unsubscribers[record.assignmentId]) unsubscribers[record.assignmentId]();
    var unsubscribe = manager.subscribeSession(session.localId, function (event) {
      if (record.status === 'queued') {
        if (event.type === 'error') settle(record, 'failed', session, event.text || 'Driver failed before follow-up delivery.');
        else if (event.type === 'done' || event.type === 'result') followUps.schedule(record);
        return;
      }
      if (event.type === "session_id") {
        record.targetSessionRef = ctx.sessionRef(record.targetProjectSlug, session);
        record.updatedAt = Date.now();
        saveUser(record.userId);
        emit(record);
      } else if (event.type === "error") {
        settle(record, "failed", session, event.text || "Assignment failed.");
      } else if (event.type === "done" || event.type === "result") {
        if (record.delivery === "follow_up") record.deliveryState = "accepted";
        settle(record, session._lastTurnInterrupted ? "interrupted" : "completed", session, "");
      }
    });
    if (unsubscribe) unsubscribers[record.assignmentId] = unsubscribe;
  }

  async function approve(record) {
    if (record.status !== "proposed" && record.status !== "queued") return publicRecord(record);
    var running = records.filter(function (item) {
      return item.userId === record.userId && (item.status === "starting" || item.status === "running");
    }).length;
    if (!exactSource(record)) throw new Error("Source conversation is no longer available.");
    var target = exactTarget(record);
    var followUp = record.delivery === "follow_up";
    if (!target || (followUp ? typeof target.dispatchDelegatedFollowUp !== "function" : typeof target.createDelegatedSession !== "function")) throw new Error("Target project is no longer available.");
    if (followUp) {
      var inspected;
      try { inspected = followUps.validate(record, target, followUps.inspect(record, target)); }
      catch (error) { return settle(record, 'failed', null, error.message); }
      if (followUps.busy(inspected.session) || (followUps.first(record) && followUps.first(record) !== record)) {
        var beforeQueue = Object.assign({}, record, { decision: record.decision, deliveryState: record.deliveryState, queueOrder: record.queueOrder });
        if (record.status === 'proposed') record.queueOrder = records.reduce(function (max, item) { return Math.max(max, item.queueOrder || 0); }, 0) + 1;
        record.decision = 'approve'; record.status = 'queued'; record.deliveryState = 'queued'; record.updatedAt = Date.now();
        try { saveUser(record.userId); } catch (error) { Object.assign(record, beforeQueue); throw error; }
        watch(record, target.getSessionManager(), inspected.session); followUps.track(record); emit(record); followUps.schedule(record);
        return publicRecord(record);
      }
    }
    if (running >= MAX_RUNNING) throw new Error("Too many assignments are already running.");
    followUps.cleanup(record);
    record.decision = "approve";
    record.status = "starting";
    if (followUp) record.deliveryState = "dispatching";
    record.updatedAt = Date.now();
    saveUser(record.userId);
    emit(record);
    try {
      var metadata = {
        assignmentId: record.assignmentId,
        title: record.title,
        sourceMateId: record.sourceMateId,
        sourceProjectSlug: record.sourceProjectSlug,
        sourceSessionRef: record.sourceSessionRef,
        parentAssignmentId: record.parentAssignmentId || null,
      };
      var session;
      if (followUp) {
        session = await target.dispatchDelegatedFollowUp({ userId: record.userId, sourceMateId: record.sourceMateId, sourceProjectSlug: record.sourceProjectSlug, sourceSessionRef: record.sourceSessionRef }, record.targetSessionRef, record.task, metadata, function (existing) { followUps.validate(record, exactTarget(record), followUps.inspect(record, target)); watch(record, target.getSessionManager(), existing); });
      } else {
        session = await target.createDelegatedSession({ userId: record.userId }, record.task, metadata, function (created) { watch(record, target.getSessionManager(), created); });
      }
      if (record.status !== "starting") return publicRecord(record);
      record.targetSessionRef = ctx.sessionRef(record.targetProjectSlug, session);
      record.targetSessionId = session.localId;
      record.status = "running";
      if (followUp) record.deliveryState = "accepted";
      record.updatedAt = Date.now();
      saveUser(record.userId);
      emit(record);
    } catch (e) {
      settle(record, "failed", null, e.message || String(e));
    }
    return publicRecord(record);
  }

  function cancel(record) {
    if (record.status !== "proposed" && record.status !== "queued") return publicRecord(record);
    followUps.cleanup(record);
    if (unsubscribers[record.assignmentId]) unsubscribers[record.assignmentId]();
    delete unsubscribers[record.assignmentId];
    record.deliveryState = 'not_sent';
    record.decision = "cancel";
    record.status = "cancelled";
    record.updatedAt = Date.now();
    saveUser(record.userId);
    emit(record);
    followUps.wake(record);
    return publicRecord(record);
  }

  function getStatus(principal, assignmentId) {
    principal = normalizePrincipal(principal);
    if (!principal) throw new Error("Assignment not found for this conversation.");
    var record = findOwned(principal.userId, assignmentId);
    if (!record || record.sourceKey !== sourceKey(principal)) throw new Error("Assignment not found for this conversation.");
    return publicRecord(record);
  }

  function validateResponseSource(ws, msg, record, routedProjectSlug) {
    var source = exactSource(record);
    if (!source) throw new Error("Source conversation is no longer available.");
    var userId = responseUserId(ws);
    if (record.userId !== (userId || null)) throw new Error("Assignment access denied.");
    if (msg.sourceProjectSlug !== record.sourceProjectSlug || msg.sourceSessionRef !== record.sourceSessionRef) {
      throw new Error("Assignment response does not match its source conversation.");
    }
    if (msg.surface === "home") {
      var tap = ws && ws._homeChatTap;
      if (!tap || tap.mateSlug !== record.sourceProjectSlug || tap.sessionId !== source.session.localId) {
        throw new Error("Open the exact Home conversation before responding.");
      }
      if (msg.mateId !== tap.mateId || msg.sessionId !== tap.sessionReference || msg.requestId !== tap.requestId) {
        throw new Error("Assignment response is stale for this Home conversation.");
      }
    } else if (routedProjectSlug !== record.sourceProjectSlug || !ws || ws._clayActiveSession !== source.session.localId) {
      throw new Error("Open the exact project conversation before responding.");
    }
    return source;
  }

  async function respond(ws, msg, routedProjectSlug) {
    var userId = responseUserId(ws);
    var record = findOwned(userId, clean(msg.assignmentId, 100));
    if (!record) throw new Error("Assignment proposal is stale or unavailable.");
    validateResponseSource(ws, msg, record, routedProjectSlug);
    var action = msg.action === "approve" ? "approve" : (msg.action === "cancel" ? "cancel" : "");
    if (!action) throw new Error("Choose approve or cancel.");
    if (record.status === "queued" && action === "cancel") return cancel(record);
    if (record.status !== "proposed") {
      if (record.decision === action) return publicRecord(record);
      throw new Error("Assignment proposal has already been resolved.");
    }
    return action === "approve" ? approve(record) : cancel(record);
  }

  function handleMessage(ws, msg, routedProjectSlug) {
    if (!msg || msg.type !== "project_assignment_response") return false;
    respond(ws, msg, routedProjectSlug).then(function (assignment) {
      if (ws.readyState !== 1) return;
      if (msg.surface === "home") {
        ws.send(JSON.stringify({ type: "home_project_assignment_status", assignment: assignment, mateId: msg.mateId, sessionId: msg.sessionId, requestId: msg.requestId }));
      } else {
        ws.send(JSON.stringify({ type: "project_assignment_status", assignment: assignment }));
      }
    }).catch(function (error) {
      if (ws.readyState !== 1) return;
      if (msg.surface === "home") {
        var userId = responseUserId(ws);
        var record = findOwned(userId, msg.assignmentId);
        var assignment = record ? publicRecord(record) : { assignmentId: msg.assignmentId || null, status: "proposed" };
        assignment.error = error.message || String(error);
        ws.send(JSON.stringify({ type: "home_project_assignment_status", assignment: assignment, mateId: msg.mateId, sessionId: msg.sessionId, requestId: msg.requestId }));
      } else {
        ws.send(JSON.stringify({ type: "project_assignment_error", assignmentId: msg.assignmentId || null, error: error.message || String(error) }));
      }
    });
    return true;
  }

  load();
  return {
    propose: propose,
    proposeFollowUp: proposeFollowUp,
    getStatus: getStatus,
    respond: respond,
    handleMessage: handleMessage,
    reconcileProject: reconcileProject,
    records: records,
  };
}

module.exports = {
  attachWorkspaceAssignmentService: attachWorkspaceAssignmentService,
  userStorageKey: userStorageKey,
};
