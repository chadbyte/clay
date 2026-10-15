var crypto = require("crypto");
var sessionProvenance = require("./session-provenance");

var LOCAL_OWNER = "local-user";
var REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
function attachProjectScheduledMessages(ctx) {
  var scheduler = ctx.scheduler;
  var slug = ctx.slug;
  var sm = ctx.sm;
  var users = ctx.usersModule;
  var pendingMessageQueue = ctx.pendingMessageQueue;
  var consumePendingMessage = ctx.consumePendingMessage;
  var type = "project-chat-message:" + slug;
  var makeRevision = ctx.makeRevision || function () { return crypto.randomUUID(); };
  var now = ctx.now || Date.now;
  var unregister = null;
  var stopped = false;
  function sessionIdentity(session) {
    if (!session) return null;
    if (ctx.isMate) return session.sessionOriginId || session._sessionRecordId || session.cliSessionId || null;
    return session.cliSessionId || null;
  }
  function findSession(targetId) {
    var found = null;
    sm.sessions.forEach(function (session) {
      if (!found && (sessionIdentity(session) === targetId || (ctx.isMate &&
          (session.cliSessionId === targetId || session._sessionRecordId === targetId)))) found = session;
    });
    return found;
  }
  function latestJob(session) {
    if (!scheduler || !session || !sessionIdentity(session)) return null;
    var jobs = scheduler.listJobs();
    for (var i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].type === type && jobs[i].projectId === slug && jobs[i].target && findSession(jobs[i].target.id) === session) return jobs[i];
    }
    return null;
  }
  function pendingJob(session) {
    if (!scheduler || !session || !sessionIdentity(session)) return null;
    if (session.scheduledMessage && session.scheduledMessage.jobId) {
      var direct = scheduler.getJob(session.scheduledMessage.jobId);
      if (direct && direct.state === "queued" && !direct.payload.mateScheduleId) return direct;
    }
    var jobs = scheduler.listJobs();
    for (var i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].type === type && jobs[i].projectId === slug && jobs[i].state === "queued" && !jobs[i].payload.mateScheduleId &&
          jobs[i].target && findSession(jobs[i].target.id) === session) return jobs[i];
    }
    return null;
  }
  function projection(job, queueItem) {
    if (!job || job.state !== "queued") return null;
    return {
      jobId: job.id,
      revision: job.payload.revision,
      text: queueItem && queueItem.message ? queueItem.message.text : "",
      resetsAt: job.runAt,
      scheduledAt: job.payload.scheduledAt,
    };
  }
  var queue = require('./project-scheduled-message-queue').attachScheduledMessageQueue({ users: users, pendingMessageQueue: pendingMessageQueue });
  var queueActor = queue.actor;
  var queueItemForJob = queue.item;
  var validateQueueControl = queue.validate;
  function sendState(session, targetWs, sendFn) {
    var job = pendingJob(session);
    session.scheduledMessage = projection(job, queueItemForJob(session, job, job && job.payload && job.payload.actorId));
    var latest = latestJob(session);
    var interrupted = !job && latest && latest.state === "interrupted" ? {
      jobId: latest.id,
      revision: latest.payload.revision,
      text: latest.payload.text,
    } : null;
    var message = { type: "scheduled_message_state", scheduledMessage: session.scheduledMessage, interrupted: interrupted };
    if (sendFn) sendFn(message);
    else if (targetWs) ctx.sendTo(targetWs, message);
    else ctx.sendToSession(session.localId, message);
    return message;
  }
  function visibleError(session, targetWs, text) {
    var message = { type: "error", text: text };
    if (targetWs) ctx.sendTo(targetWs, message);
    else if (session) ctx.sendToSession(session.localId, message);
  }
  function ownerFor(session) {
    if (!users.isMultiUser()) return LOCAL_OWNER;
    if (!session.ownerId) throw new Error("Scheduled messages require a session owner.");
    if (!users.findUserById(session.ownerId)) throw new Error("The session owner no longer exists.");
    return session.ownerId;
  }
  function authorize(session, actorId) {
    if (!session || session.destroying) throw new Error("The session is no longer available.");
    if (sm.sessions.get(session.localId) !== session) throw new Error("The session is no longer live.");
    if (!sessionIdentity(session)) throw new Error(ctx.isMate ? "This Mate has no persistent server identity yet." : "This session has no persistent provider identity yet.");
    if (session.mode === "tui" || session.runtimeMode === "tui" || sessionProvenance.isWorker(session) ||
        (ctx.isDriverOperatedSession && ctx.isDriverOperatedSession(session))) {
      throw new Error("Scheduled messages are available only for ordinary project chat sessions.");
    }
    if (ctx.isMate && (session._mcpForeignInput || session.sessionVisibility === "shared" || session.mateCreationMode ||
        (session.history || []).some(function (entry) { return entry.type === "user_message" && entry.from && entry.from !== (session.ownerId || "default"); }))) throw new Error("Foreign input cannot authorize private Mate schedules.");
    if (!users.isMultiUser()) return LOCAL_OWNER;
    if (!actorId || !users.findUserById(actorId)) throw new Error("The scheduling user no longer exists.");
    var access = ctx.getProjectAccess();
    if (!ctx.canAccessProjectSlug(actorId, slug) || !users.canAccessSession(actorId, session, access)) {
      throw new Error("Scheduled message access was revoked.");
    }
    var ownerId = ownerFor(session);
    if (!ctx.canAccessProjectSlug(ownerId, slug) || !users.canAccessSession(ownerId, session, access)) {
      throw new Error("The session owner no longer has access.");
    }
    return ownerId;
  }
  function buildSpec(session, text, resetsAt, actorId, revision, options) {
    options = options || {};
    var timestamp = now();
    var runAt = options.exact === true ? resetsAt : (resetsAt <= timestamp ? timestamp + 5000 : resetsAt + 60000);
    var ownerId = authorize(session, actorId);
    return {
      type: type,
      idempotencyKey: "project-message:" + slug + ":" + sessionIdentity(session) + ":" + revision,
      ownerId: ownerId,
      projectId: slug,
      target: { kind: "project-session", id: sessionIdentity(session) },
      payload: {
        text: text,
        hasAttachments: false,
        queueAdmissionRequired: true,
        cliSessionId: session.cliSessionId || null,
        sessionIdentity: sessionIdentity(session),
        actorId: actorId || LOCAL_OWNER,
        sessionOwnerId: ownerId,
        revision: revision,
        requestedResetsAt: resetsAt,
        scheduledAt: timestamp,
        scheduleRule: options.scheduleRule || null,
        mateScheduleId: options.mateScheduleId || null,
        logicalScheduleId: options.logicalScheduleId || options.mateScheduleId || null,
        logicalRevision: options.logicalRevision || null,
        occurrence: Number(options.occurrence || 0),
      },
      runAt: runAt,
    };
  }
  function requestJobs(session, actorId, requestId) {
    if (!scheduler || !session || !requestId) return [];
    var jobs = scheduler.listJobs();
    return jobs.filter(function (job) {
      return job.type === type && job.projectId === slug && job.target && findSession(job.target.id) === session &&
        job.payload && job.payload.admissionRequestId === requestId && job.payload.actorId === actorId;
    });
  }
  function requestIdempotencyKey(session, actorId, requestId) {
    var base = "project-message:" + slug + ":" + sessionIdentity(session) + ":actor:" + actorId + ":request:" + requestId;
    var jobs = requestJobs(session, actorId, requestId);
    var retryCount = 0;
    for (var i = 0; i < jobs.length; i++) if (jobs[i].state === "cancelled" && jobs[i].cancelledReason === "queue_admission_failed") retryCount++;
    var key = crypto.createHash("sha256").update(base).digest("hex");
    return "project-message-request:" + key + (retryCount ? ":retry-" + retryCount : "");
  }
  function sendAdmissionResult(targetWs, session, actorId, requestId, job, error, transportAccountId) {
    if (!targetWs || !requestId) return;
    ctx.sendTo(targetWs, {
      type: "schedule_message_result",
      requestId: requestId,
      projectSlug: slug,
      sessionId: session ? session.localId : null,
      accountId: transportAccountId || actorId || "default",
      ok: !error,
      error: error || null,
      scheduledMessage: job ? projection(job, queueItemForJob(session, job, actorId)) : null,
    });
  }
  function schedule(session, text, resetsAt, actorUser, targetWs, attachments, requestId, transportAccountId, options) {
    var actorId = users.isMultiUser() ? (actorUser && actorUser.id) : LOCAL_OWNER;
    if (!scheduler || stopped) {
      sendAdmissionResult(targetWs, session, actorId, requestId, null, "Scheduled messages are temporarily unavailable.", transportAccountId);
      visibleError(session, targetWs, "Scheduled messages are temporarily unavailable.");
      return null;
    }
    var images = attachments && Array.isArray(attachments.images) ? attachments.images : [];
    var pastes = attachments && Array.isArray(attachments.pastes) ? attachments.pastes : [];
    if (attachments && Object.prototype.hasOwnProperty.call(attachments, "images") && !Array.isArray(attachments.images)) {
      sendAdmissionResult(targetWs, session, actorId, requestId, null, "Invalid image attachments.", transportAccountId);
      return null;
    }
    if (attachments && Object.prototype.hasOwnProperty.call(attachments, "pastes") && !Array.isArray(attachments.pastes)) {
      sendAdmissionResult(targetWs, session, actorId, requestId, null, "Invalid paste attachments.", transportAccountId);
      return null;
    }
    if (requestId && (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId))) {
      sendAdmissionResult(targetWs, session, actorId, requestId, null, "Invalid schedule request identifier.", transportAccountId);
      return null;
    }
    if (typeof text !== "string" || (!text.trim() && !images.length && !pastes.length) || !isFinite(Number(resetsAt)) || (options && options.exact === true && Number(resetsAt) <= now())) {
      sendAdmissionResult(targetWs, session, actorId, requestId, null, "A valid scheduled message and reset time are required.", transportAccountId);
      visibleError(session, targetWs, "A valid scheduled message and reset time are required.");
      return null;
    }
    try {
      // Authorization is deliberately performed before looking up a durable
      // request association, so replay cannot disclose another account's job.
      authorize(session, actorId);
      var priorJobs = requestJobs(session, actorId, requestId);
      var prior = priorJobs.length ? priorJobs[priorJobs.length - 1] : null;
      if (prior && (prior.state !== "cancelled" || prior.cancelledReason !== "queue_admission_failed")) {
        if (prior.state === "queued") {
          var priorItem = queueItemForJob(session, prior, actorId);
          if (!priorItem) throw new Error("Scheduled queue item is missing; refusing to replay request.");
          if (["cancelled", "consumed", "failed"].indexOf(priorItem.state) >= 0) throw new Error("Scheduled queue item is no longer available; refusing to replay request.");
        }
        sendAdmissionResult(targetWs, session, actorId, requestId, prior, null, transportAccountId);
        return prior;
      }
      var revision = makeRevision();
      var spec = buildSpec(session, text, Number(resetsAt), actorId, revision, options);
      if (requestId) {
        spec.idempotencyKey = requestIdempotencyKey(session, actorId, requestId);
        spec.payload.admissionRequestId = requestId;
        spec.payload.admissionAccountId = actorId;
      }
      spec.payload.hasAttachments = images.length > 0 || pastes.length > 0;
      var current = pendingJob(session);
      if (options && options.mateScheduleId) current = null;
      if (current && requestId && (!current.payload || current.payload.admissionRequestId !== requestId)) {
        throw new Error("Another scheduled message is already pending.");
      }
      if (current && pendingMessageQueue) validateQueueControl(session, current, actorId, null, false);
      var job = current ? scheduler.replaceQueued(current.id, spec) : scheduler.enqueue(spec);
      if (pendingMessageQueue && job) {
        var queuedScheduled = pendingMessageQueue.upsertScheduled(session, {
          type: "message",
          text: text,
          images: images,
          pastes: pastes,
          clientMessageId: requestId ? "scheduled-request-" + requestId : "scheduled-" + job.id,
          schedule: { jobId: job.id, revision: job.payload.revision, notBefore: job.runAt, ready: false },
        }, queueActor(actorId));
        if (!queuedScheduled.ok) {
          if (current) {
            try { scheduler.replaceQueued(current.id, current); }
            catch (rollbackError) { throw new Error((queuedScheduled.error || "Unable to queue scheduled message") + "; scheduler rollback failed: " + rollbackError.message); }
          } else {
            scheduler.cancel(job.id, "queue_admission_failed");
          }
          throw new Error(queuedScheduled.error || "Unable to queue scheduled message");
        }
      }
      session.scheduledMessage = projection(job, queueItemForJob(session, job, job && job.payload && job.payload.actorId));
      sendAdmissionResult(targetWs, session, actorId, requestId, job, null, transportAccountId);
      sm.sendAndRecord(session, Object.assign({ type: "scheduled_message_queued" }, session.scheduledMessage));
      return job;
    } catch (error) {
      if (session) session.rateLimitAutoContinuePending = false;
      sendAdmissionResult(targetWs, session, actorId, requestId, null, error.message, transportAccountId);
      visibleError(session, targetWs, "Could not schedule the message: " + error.message);
      return null;
    }
  }
  function requireCorrelation(job, correlation, targetWs) {
    if (!targetWs) return;
    if (!correlation || correlation.jobId !== job.id || correlation.revision !== job.payload.revision || correlation.queueRevision == null || !pendingMessageQueue || Number(correlation.queueRevision) !== pendingMessageQueue.getRevision()) {
      throw new Error("The scheduled-message control is stale.");
    }
  }
  function cancel(session, actorUser, targetWs, reason, correlation) {
    try {
      authorize(session, users.isMultiUser() ? (actorUser && actorUser.id) : LOCAL_OWNER);
      var job = correlation && correlation.jobId ? scheduler.getJob(correlation.jobId) : (pendingJob(session) || latestJob(session));
      if (job && (job.projectId !== slug || job.type !== type || !job.target || findSession(job.target.id) !== session || job.ownerId !== ownerFor(session) ||
          (correlation && correlation.revision !== job.payload.revision))) throw new Error("The scheduled-message control is stale.");
      if (!job) return false;
      requireCorrelation(job, correlation, targetWs);
      if (pendingMessageQueue) validateQueueControl(session, job, actorUser && actorUser.id, correlation, !!targetWs);
      if (pendingMessageQueue) {
        var queueCancelled = pendingMessageQueue.cancelScheduled(session, job.id, queueActor(actorUser && actorUser.id));
        if (!queueCancelled || queueCancelled.ok !== true) throw new Error((queueCancelled && queueCancelled.error) || "The scheduled queue item could not be cancelled.");
      }
      if (job.state === "queued" && !pendingMessageQueue) scheduler.cancel(job.id, reason || "cancelled_by_user");
      session.scheduledMessage = null;
      session.rateLimitAutoContinuePending = false;
      if (!pendingMessageQueue) sm.sendAndRecord(session, { type: "scheduled_message_cancelled", jobId: job.id, revision: job.payload.revision });
      return true;
    } catch (error) {
      visibleError(session, targetWs, "Could not cancel the scheduled message: " + error.message);
      return false;
    }
  }
  function sendNow(session, actorUser, targetWs, correlation) {
    try {
      authorize(session, users.isMultiUser() ? (actorUser && actorUser.id) : LOCAL_OWNER);
      var job = pendingJob(session);
      if (!job) return false;
      requireCorrelation(job, correlation, targetWs);
      var existing = validateQueueControl(session, job, actorUser && actorUser.id, correlation, !!targetWs);
      var updated = scheduler.replaceQueued(job.id, {
        runAt: now(),
        idempotencyKey: job.idempotencyKey + ":now",
      });
      if (pendingMessageQueue) {
        var queued = pendingMessageQueue.upsertScheduled(session, {
          type: "message",
          text: existing ? existing.message.text : updated.payload.text,
          images: existing ? existing.message.images : undefined,
          pastes: existing ? existing.message.pastes : undefined,
          clientMessageId: existing ? existing.clientMessageId : "scheduled-" + updated.id,
          schedule: { jobId: updated.id, revision: updated.payload.revision, notBefore: updated.runAt, ready: false },
        }, queueActor(actorUser && actorUser.id));
        if (!queued.ok) {
          try { scheduler.replaceQueued(job.id, job); }
          catch (rollbackError) { throw new Error((queued.error || "The scheduled queue item could not be updated.") + "; scheduler rollback failed: " + rollbackError.message); }
          throw new Error(queued.error || "The scheduled queue item could not be updated.");
        }
      }
      session.scheduledMessage = projection(updated, existing);
      scheduler.tick();
      return true;
    } catch (error) {
      visibleError(session, targetWs, "Could not send the scheduled message: " + error.message);
      return false;
    }
  }
  function canRun(job) {
    var session = findSession(job.target && job.target.id);
    if (!session) return true;
    return !session.isProcessing && !session._queryStarting;
  }
  function failJob(session, job, error, processingOwner) {
    if (session && job.payload.mateScheduleId && ctx.mateLifecycle) {
      try { ctx.mateLifecycle().failed(session, job, error); }
      catch (saveError) { console.error("[mate-schedules] Failed to persist dispatch failure:", saveError.message); }
    }
    var ownsProcessing = session && processingOwner && session._scheduledMessageProcessing === processingOwner &&
      session._queryGeneration === processingOwner.queryGeneration &&
      session.queryInstance === processingOwner.queryInstance && !session._queryStarting;
    if (ownsProcessing && session.isProcessing) {
      session.isProcessing = false;
      ctx.onProcessingChanged();
      ctx.sendToSession(session.localId, { type: "status", status: "idle" });
      sm.broadcastSessionList();
    }
    if (session && session._scheduledMessageProcessing === processingOwner) delete session._scheduledMessageProcessing;
    if (session && session.scheduledMessage && session.scheduledMessage.jobId === job.id) {
      session.scheduledMessage = null;
      session.rateLimitAutoContinuePending = false;
      sm.sendAndRecord(session, { type: "scheduled_message_cancelled", jobId: job.id, revision: job.payload.revision, reason: error.message });
    }
    if (session) sm.sendAndRecord(session, { type: "error", text: "Scheduled message failed: " + error.message });
  }

  async function dispatch(job, execution) {
    var session = findSession(job.target.id);
    var processingOwner = null;
    try {
      if (!session) throw new Error("The scheduled session was deleted.");
      var ownerId = authorize(session, job.payload.actorId);
      if (job.payload.mateScheduleId && ctx.mateLifecycle && !ctx.mateLifecycle().current(session, job)) throw new Error("The Mate schedule is no longer active.");
      if (ownerId !== job.ownerId || ownerId !== job.payload.sessionOwnerId) throw new Error("The session owner changed.");
      if (ctx.osUsers) {
        var owner = users.findUserById(job.ownerId);
        if (!owner || !owner.linuxUser) throw new Error("The session owner has no OS identity.");
      }
      var linuxUser = ctx.ensureProjectAccessForSession(session);
      if (ctx.osUsers && !linuxUser) throw new Error("The session owner OS identity is unavailable.");
      execution.recordMetadata({ projectSlug: slug, cliSessionId: session.cliSessionId, revision: job.payload.revision });
      if (!pendingMessageQueue) throw new Error("Scheduled message queue is unavailable.");
      var existing = queueItemForJob(session, job, job.payload.actorId);
      if (existing && ["cancelled", "consumed", "failed"].indexOf(existing.state) >= 0) {
        return { released: false, queueItemId: existing.id, cliSessionId: session.cliSessionId, revision: job.payload.revision };
      }
      if (!existing && ["interrupted", "completed"].indexOf(job.state) >= 0) {
        return { released: false, queueItemId: null, cliSessionId: session.cliSessionId, revision: job.payload.revision };
      }
      var ensured = existing;
      if (!ensured && job.payload.queueAdmissionRequired === true) throw new Error("Scheduled queue item is missing; refusing to recreate message payload.");
      if (!ensured) ensured = pendingMessageQueue.upsertScheduled(session, {
        type: "message", text: job.payload.text, clientMessageId: "scheduled-" + job.id,
        schedule: { jobId: job.id, revision: job.payload.revision, notBefore: job.runAt, ready: false },
      }, queueActor(job.payload.actorId));
      if (!ensured || ensured.ok === false) throw new Error(ensured.error || "Scheduled queue handoff could not be prepared.");
      var released = pendingMessageQueue.releaseScheduled(session, job.id, job.payload.revision);
      if (!released) throw new Error("Scheduled message queue handoff could not be released.");
      if (typeof consumePendingMessage === "function") setImmediate(function () { consumePendingMessage(session); });
      return { released: true, queueItemId: released.id, cliSessionId: session.cliSessionId, revision: job.payload.revision };
    } catch (error) {
      failJob(session, job, error, processingOwner);
      throw error;
    }
  }
  function onQueueConsumed(item) {
    if (!item || !item.schedule || !scheduler) return false;
    var job = scheduler.getJob(item.schedule.jobId);
    var session = job && job.target ? findSession(job.target.id) : null;
    if (!session) return false;
    if (session.scheduledMessage && session.scheduledMessage.jobId === item.schedule.jobId) {
      session.scheduledMessage = null;
      session.rateLimitAutoContinuePending = false;
    }
    sm.sendAndRecord(session, { type: "scheduled_message_sent", jobId: job.id, revision: item.schedule.revision });
    if (job.payload && job.payload.mateScheduleId && ctx.mateLifecycle) ctx.mateLifecycle().consumed(session, job);
    sm.broadcastSessionList();
    return true;
  }
  function onQueueCancelled(item) {
    if (!item || !item.schedule || !scheduler) return false;
    var job = scheduler.getJob(item.schedule.jobId);
    if (job && job.state === "queued") {
      try { scheduler.cancel(job.id, "cancelled_by_user"); } catch (error) {}
    }
    var session = job && job.target ? findSession(job.target.id) : null;
    if (session && job.payload.mateScheduleId && ctx.mateLifecycle) ctx.mateLifecycle().cancelled(session, job);
    if (session && session.scheduledMessage && session.scheduledMessage.jobId === item.schedule.jobId) {
      session.scheduledMessage = null;
      session.rateLimitAutoContinuePending = false;
      sm.sendAndRecord(session, { type: "scheduled_message_cancelled", jobId: item.schedule.jobId, revision: item.schedule.revision });
    }
    return true;
  }
  function authorizePending(item, session) {
    if (!item || !item.schedule || !scheduler || !session) return true;
    var job = scheduler.getJob(item.schedule.jobId);
    var expectedActorId = users.isMultiUser() ? job && job.payload && job.payload.actorId : "default";
    if (!job || ["running", "completed", "interrupted"].indexOf(job.state) < 0 || !job.target || findSession(job.target.id) !== session ||
        !job.payload || job.projectId !== slug || job.payload.revision !== item.schedule.revision || item.actorId !== expectedActorId ||
        job.ownerId !== job.payload.sessionOwnerId) return false;
    if (job.payload.mateScheduleId && ctx.mateLifecycle && !ctx.mateLifecycle().current(session, job)) return false;
    try { return authorize(session, job.payload.actorId) === job.ownerId; } catch (error) { return false; }
  }
  function rehydrate() {
    sm.sessions.forEach(function (session) {
      var pending = pendingJob(session);
      session.scheduledMessage = projection(pending, queueItemForJob(session, pending, pending && pending.payload && pending.payload.actorId));
      if (!pendingMessageQueue) return;
      var jobs = scheduler.listJobs();
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].type !== type || jobs[i].projectId !== slug || !jobs[i].target || findSession(jobs[i].target.id) !== session) continue;
        var actor = users.isMultiUser() ? users.findUserById(jobs[i].payload.actorId) : { id: "default" };
        if (jobs[i].state === "queued" && !queueItemForJob(session, jobs[i], jobs[i].payload.actorId)) {
          if (jobs[i].payload.queueAdmissionRequired !== true || (jobs[i].payload.mateScheduleId && ctx.mateLifecycle && ctx.mateLifecycle().current(session, jobs[i]))) pendingMessageQueue.upsertScheduled(session, {
            type: "message", text: jobs[i].payload.text, clientMessageId: "scheduled-" + jobs[i].id,
            schedule: { jobId: jobs[i].id, revision: jobs[i].payload.revision, notBefore: jobs[i].runAt, ready: false },
          }, actor);
        }
        else if (["interrupted", "completed"].indexOf(jobs[i].state) >= 0) {
          var existing = queueItemForJob(session, jobs[i], jobs[i].payload.actorId);
          if (existing && existing.state === "pending" && jobs[i].runAt <= now() && authorizePending(existing, session)) {
            var released = pendingMessageQueue.releaseScheduled(session, jobs[i].id, jobs[i].payload.revision);
            if (released && typeof consumePendingMessage === "function") setImmediate(function () { consumePendingMessage(session); });
          }
        }
      }
    });
  }
  function deleted(localId, session) {
    if (!session) return;
    scheduler.listJobs().forEach(function (job) {
      if (job.type === type && job.state === "queued" && job.target && [sessionIdentity(session), session.cliSessionId, session._sessionRecordId].indexOf(job.target.id) >= 0) {
        try { scheduler.cancel(job.id, "session_deleted"); } catch (error) {}
      }
    });
    session.scheduledMessage = null;
  }
  function notify() {
    if (!scheduler || stopped) return;
    try { scheduler.tick(); } catch (error) {}
  }
  function shutdown() {
    stopped = true;
    if (unregister) unregister();
    unregister = null;
  }

  if (scheduler) {
    unregister = scheduler.registerHandler(type, dispatch, { canRun: canRun });
    if (!ctx.deferRehydrate) rehydrate();
    sm.addOnSessionDeleted(deleted);
    sm.addOnSessionViewed(function (session, targetWs, sendFn) { sendState(session, targetWs, sendFn); });
  }

  return {
    schedule: schedule,
    cancel: cancel,
    sendNow: sendNow,
    sendState: sendState,
    rehydrate: rehydrate,
    notify: notify,
    shutdown: shutdown,
    handlerType: type,
    authorizePending: authorizePending,
    authorize: authorize,
    identity: sessionIdentity,
    queueItem: queueItemForJob,
    onQueueConsumed: onQueueConsumed,
    onQueueCancelled: onQueueCancelled,
  };
}

module.exports = { attachProjectScheduledMessages: attachProjectScheduledMessages, LOCAL_OWNER: LOCAL_OWNER };
