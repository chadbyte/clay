var crypto = require("crypto");
var sessionProvenance = require("./session-provenance");

var LOCAL_OWNER = "local-user";

function attachProjectScheduledMessages(ctx) {
  var scheduler = ctx.scheduler;
  var slug = ctx.slug;
  var sm = ctx.sm;
  var sdk = ctx.sdk;
  var users = ctx.usersModule;
  var type = "project-chat-message:" + slug;
  var makeRevision = ctx.makeRevision || function () { return crypto.randomUUID(); };
  var now = ctx.now || Date.now;
  var unregister = null;
  var stopped = false;

  function findSession(cliSessionId) {
    var found = null;
    sm.sessions.forEach(function (session) {
      if (!found && session.cliSessionId === cliSessionId) found = session;
    });
    return found;
  }

  function latestJob(session) {
    if (!scheduler || !session || !session.cliSessionId) return null;
    var jobs = scheduler.listJobs();
    for (var i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].type === type && jobs[i].projectId === slug && jobs[i].target && jobs[i].target.id === session.cliSessionId) return jobs[i];
    }
    return null;
  }

  function pendingJob(session) {
    if (!scheduler || !session || !session.cliSessionId) return null;
    if (session.scheduledMessage && session.scheduledMessage.jobId) {
      var direct = scheduler.getJob(session.scheduledMessage.jobId);
      if (direct && direct.state === "queued") return direct;
    }
    var jobs = scheduler.listJobs();
    for (var i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].type === type && jobs[i].projectId === slug && jobs[i].state === "queued" &&
          jobs[i].target && jobs[i].target.id === session.cliSessionId) return jobs[i];
    }
    return null;
  }

  function projection(job) {
    if (!job || job.state !== "queued") return null;
    return {
      jobId: job.id,
      revision: job.payload.revision,
      text: job.payload.text,
      resetsAt: job.runAt,
      scheduledAt: job.payload.scheduledAt,
    };
  }

  function sendState(session, targetWs, sendFn) {
    var job = pendingJob(session);
    session.scheduledMessage = projection(job);
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
    if (!session.cliSessionId) throw new Error("This session has no persistent provider identity yet.");
    if (session.mode === "tui" || session.runtimeMode === "tui" || sessionProvenance.isWorker(session) ||
        (ctx.isDriverOperatedSession && ctx.isDriverOperatedSession(session))) {
      throw new Error("Scheduled messages are available only for ordinary project chat sessions.");
    }
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

  function buildSpec(session, text, resetsAt, actorId, revision) {
    var timestamp = now();
    var runAt = resetsAt <= timestamp ? timestamp + 5000 : resetsAt + 60000;
    var ownerId = authorize(session, actorId);
    return {
      type: type,
      idempotencyKey: "project-message:" + slug + ":" + session.cliSessionId + ":" + revision,
      ownerId: ownerId,
      projectId: slug,
      target: { kind: "project-session", id: session.cliSessionId },
      payload: {
        text: text,
        cliSessionId: session.cliSessionId,
        actorId: actorId || LOCAL_OWNER,
        sessionOwnerId: ownerId,
        revision: revision,
        requestedResetsAt: resetsAt,
        scheduledAt: timestamp,
      },
      runAt: runAt,
    };
  }

  function schedule(session, text, resetsAt, actorUser, targetWs) {
    if (!scheduler || stopped) {
      visibleError(session, targetWs, "Scheduled messages are temporarily unavailable.");
      return null;
    }
    if (typeof text !== "string" || !text.trim() || !isFinite(Number(resetsAt))) {
      visibleError(session, targetWs, "A valid scheduled message and reset time are required.");
      return null;
    }
    try {
      var actorId = users.isMultiUser() ? (actorUser && actorUser.id) : LOCAL_OWNER;
      var revision = makeRevision();
      var spec = buildSpec(session, text, Number(resetsAt), actorId, revision);
      var current = pendingJob(session);
      var job = current ? scheduler.replaceQueued(current.id, spec) : scheduler.enqueue(spec);
      session.scheduledMessage = projection(job);
      sm.sendAndRecord(session, Object.assign({ type: "scheduled_message_queued" }, session.scheduledMessage));
      return job;
    } catch (error) {
      if (session) session.rateLimitAutoContinuePending = false;
      visibleError(session, targetWs, "Could not schedule the message: " + error.message);
      return null;
    }
  }

  function requireCorrelation(job, correlation, targetWs) {
    if (!targetWs) return;
    if (!correlation || correlation.jobId !== job.id || correlation.revision !== job.payload.revision) {
      throw new Error("The scheduled-message control is stale.");
    }
  }

  function cancel(session, actorUser, targetWs, reason, correlation) {
    try {
      authorize(session, users.isMultiUser() ? (actorUser && actorUser.id) : LOCAL_OWNER);
      var job = pendingJob(session);
      if (!job) return false;
      requireCorrelation(job, correlation, targetWs);
      scheduler.cancel(job.id, reason || "cancelled_by_user");
      session.scheduledMessage = null;
      session.rateLimitAutoContinuePending = false;
      sm.sendAndRecord(session, { type: "scheduled_message_cancelled", jobId: job.id, revision: job.payload.revision });
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
      var updated = scheduler.replaceQueued(job.id, {
        runAt: now(),
        idempotencyKey: job.idempotencyKey + ":now",
      });
      session.scheduledMessage = projection(updated);
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
      if (ownerId !== job.ownerId || ownerId !== job.payload.sessionOwnerId) throw new Error("The session owner changed.");
      if (ctx.osUsers) {
        var owner = users.findUserById(job.ownerId);
        if (!owner || !owner.linuxUser) throw new Error("The session owner has no OS identity.");
      }
      var linuxUser = ctx.ensureProjectAccessForSession(session);
      if (ctx.osUsers && !linuxUser) throw new Error("The session owner OS identity is unavailable.");
      execution.recordMetadata({ projectSlug: slug, cliSessionId: session.cliSessionId, revision: job.payload.revision });
      execution.recordReceipt({ state: "dispatching", projectSlug: slug, cliSessionId: session.cliSessionId, revision: job.payload.revision, recordedAt: now() });

      var userMessage = {
        type: "user_message",
        text: job.payload.text,
        _ts: now(),
        scheduledJobId: job.id,
        scheduledRevision: job.payload.revision,
      };
      session.history.push(userMessage);
      sm.appendToSessionFile(session, userMessage);
      ctx.sendToSession(session.localId, userMessage);
      processingOwner = {};
      session._scheduledMessageProcessing = processingOwner;
      session.isProcessing = true;
      ctx.onProcessingChanged();
      ctx.sendToSession(session.localId, { type: "status", status: "processing" });
      var queryPromise = sdk.startQuery(session, job.payload.text, null, linuxUser);
      processingOwner.queryGeneration = session._queryGeneration;
      processingOwner.queryInstance = session.queryInstance;
      if (session.scheduledMessage && session.scheduledMessage.jobId === job.id) {
        session.scheduledMessage = null;
        session.rateLimitAutoContinuePending = false;
      }
      sm.sendAndRecord(session, { type: "scheduled_message_sent", jobId: job.id, revision: job.payload.revision });
      sm.broadcastSessionList();
      await Promise.resolve(queryPromise);
      if (session._scheduledMessageProcessing === processingOwner) delete session._scheduledMessageProcessing;
      return { dispatched: true, cliSessionId: session.cliSessionId, revision: job.payload.revision };
    } catch (error) {
      failJob(session, job, error, processingOwner);
      throw error;
    }
  }

  function rehydrate() {
    sm.sessions.forEach(function (session) { session.scheduledMessage = projection(pendingJob(session)); });
  }

  function deleted(localId, session) {
    var job = pendingJob(session);
    if (!job) return;
    try { scheduler.cancel(job.id, "session_deleted"); } catch (error) {}
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
    rehydrate();
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
  };
}

module.exports = { attachProjectScheduledMessages: attachProjectScheduledMessages, LOCAL_OWNER: LOCAL_OWNER };
