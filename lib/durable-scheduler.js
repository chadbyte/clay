var crypto = require("crypto");
var path = require("path");
var attachStore = require("./durable-scheduler-store").attachDurableSchedulerStore;
var validateSavedJobs = require("./durable-scheduler-record").validateSavedJobs;

function copy(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(name + " is required");
  if (value.length > 256) throw new Error(name + " is too long");
  return value;
}

function safeValue(value, name, maxBytes) {
  var cloned;
  var serialized;
  try {
    cloned = copy(value);
    serialized = JSON.stringify(cloned);
  } catch (error) {
    throw new Error(name + " must be JSON serializable");
  }
  if (Buffer.byteLength(serialized || "", "utf8") > maxBytes) throw new Error(name + " is too large");
  return cloned;
}

function attachDurableScheduler(ctx) {
  var namespace = requiredString(ctx.namespace, "namespace");
  var now = ctx.now || Date.now;
  var makeId = ctx.makeId || function () { return crypto.randomUUID(); };
  var setTimer = ctx.setTimer || setTimeout;
  var clearTimer = ctx.clearTimer || clearTimeout;
  var maxTimerDelay = Math.min(Math.max(ctx.maxTimerDelay || 30000, 10), 2147483647);
  var globalConcurrency = Math.max(1, ctx.globalConcurrency || 4);
  var perOwnerConcurrency = Math.max(1, ctx.perOwnerConcurrency || 1);
  var store = ctx.store || attachStore({
    filePath: ctx.filePath || path.join(ctx.storageDir, "scheduler-" + namespace + ".json"),
    namespace: namespace,
  });
  var handlers = Object.create(null);
  var eligibility = Object.create(null);
  var active = Object.create(null);
  var timer = null;
  var started = false;
  var closed = false;
  var unhealthyError = null;
  var ownerCursor = 0;
  var data;

  function persist(nextData) {
    if (unhealthyError) throw unhealthyError;
    try {
      store.save(nextData);
    } catch (error) {
      unhealthyError = error;
      stopTimer();
      throw error;
    }
    data = nextData;
  }

  function recover() {
    try {
      data = store.load();
      validateSavedJobs(data.jobs);
    } catch (error) {
      store.close();
      var loadError = new Error("Scheduler store contains invalid durable data: " + error.message);
      loadError.code = error.code || "SCHEDULER_STORE_CORRUPT";
      loadError.cause = error;
      throw loadError;
    }
    var changed = false;
    var recoveredAt = now();
    for (var i = 0; i < data.jobs.length; i++) {
      var job = data.jobs[i];
      if (job.state === "claimed" || job.state === "running") {
        job.state = "interrupted";
        job.updatedAt = recoveredAt;
        job.execution = job.execution || {};
        job.execution.interruptedAt = recoveredAt;
        job.execution.interruptionReason = "server_restarted_after_claim";
        changed = true;
      }
    }
    if (changed) persist(data);
  }

  function ensureReady() {
    if (closed) throw new Error("Scheduler is shut down");
    if (unhealthyError) throw unhealthyError;
  }

  function findJob(id) {
    for (var i = 0; i < data.jobs.length; i++) if (data.jobs[i].id === id) return data.jobs[i];
    return null;
  }

  function findIdempotency(key, exceptId) {
    for (var i = 0; i < data.jobs.length; i++) {
      if (data.jobs[i].id !== exceptId && data.jobs[i].idempotencyKey === key) return data.jobs[i];
    }
    return null;
  }

  function validateSpec(spec) {
    var runAt = Number(spec.runAt);
    if (!isFinite(runAt) || runAt < 0) throw new Error("runAt must be a non-negative timestamp");
    var target = safeValue(spec.target, "target", 4096);
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("target is required");
    requiredString(target.kind, "target.kind");
    requiredString(target.id, "target.id");
    return {
      type: requiredString(spec.type, "type"),
      idempotencyKey: requiredString(spec.idempotencyKey, "idempotencyKey"),
      ownerId: requiredString(spec.ownerId, "ownerId"),
      projectId: requiredString(spec.projectId, "projectId"),
      target: target,
      payload: safeValue(spec.payload === undefined ? null : spec.payload, "payload", 256 * 1024),
      runAt: runAt,
    };
  }

  function enqueue(spec) {
    ensureReady();
    var valid = validateSpec(spec || {});
    var existing = findIdempotency(valid.idempotencyKey);
    if (existing) {
      var same = existing.type === valid.type && existing.ownerId === valid.ownerId &&
        existing.projectId === valid.projectId && existing.runAt === valid.runAt &&
        JSON.stringify(existing.target) === JSON.stringify(valid.target) &&
        JSON.stringify(existing.payload) === JSON.stringify(valid.payload);
      if (!same) throw new Error("idempotencyKey was already used with different job data");
      return copy(existing);
    }
    var createdAt = now();
    var job = {
      id: spec.id ? requiredString(spec.id, "id") : makeId(),
      idempotencyKey: valid.idempotencyKey,
      type: valid.type,
      ownerId: valid.ownerId,
      projectId: valid.projectId,
      target: valid.target,
      payload: valid.payload,
      runAt: valid.runAt,
      state: "queued",
      createdAt: createdAt,
      updatedAt: createdAt,
      execution: null,
    };
    if (findJob(job.id)) throw new Error("job id already exists");
    var next = copy(data);
    next.jobs.push(job);
    persist(next);
    scheduleTimer();
    return copy(job);
  }

  function cancel(id, reason) {
    ensureReady();
    var current = findJob(id);
    if (!current) return null;
    if (current.state !== "queued") throw new Error("Only queued jobs can be cancelled");
    var next = copy(data);
    var job = null;
    for (var i = 0; i < next.jobs.length; i++) if (next.jobs[i].id === id) job = next.jobs[i];
    job.state = "cancelled";
    job.updatedAt = now();
    job.cancelledReason = typeof reason === "string" ? reason.slice(0, 1024) : null;
    persist(next);
    scheduleTimer();
    return copy(job);
  }

  function replaceQueued(id, spec) {
    ensureReady();
    var current = findJob(id);
    if (!current) return null;
    if (current.state !== "queued") throw new Error("Only queued jobs can be replaced");
    var merged = {
      type: spec.type === undefined ? current.type : spec.type,
      idempotencyKey: spec.idempotencyKey === undefined ? current.idempotencyKey : spec.idempotencyKey,
      ownerId: spec.ownerId === undefined ? current.ownerId : spec.ownerId,
      projectId: spec.projectId === undefined ? current.projectId : spec.projectId,
      target: spec.target === undefined ? current.target : spec.target,
      payload: spec.payload === undefined ? current.payload : spec.payload,
      runAt: spec.runAt === undefined ? current.runAt : spec.runAt,
    };
    var valid = validateSpec(merged);
    if (findIdempotency(valid.idempotencyKey, id)) throw new Error("idempotencyKey already exists");
    var next = copy(data);
    var job = null;
    for (var i = 0; i < next.jobs.length; i++) if (next.jobs[i].id === id) job = next.jobs[i];
    job.type = valid.type;
    job.idempotencyKey = valid.idempotencyKey;
    job.ownerId = valid.ownerId;
    job.projectId = valid.projectId;
    job.target = valid.target;
    job.payload = valid.payload;
    job.runAt = valid.runAt;
    job.updatedAt = now();
    persist(next);
    scheduleTimer();
    return copy(job);
  }

  function activeOwnerCount(ownerId) {
    var ids = Object.keys(active);
    var count = 0;
    for (var i = 0; i < ids.length; i++) if (active[ids[i]].ownerId === ownerId) count++;
    return count;
  }

  function isEligible(job) {
    if (!eligibility[job.type]) return true;
    try { return eligibility[job.type](copy(job)) === true; } catch (error) { return false; }
  }

  function dueByFairOwner(timestamp) {
    var byOwner = Object.create(null);
    var owners = [];
    for (var i = 0; i < data.jobs.length; i++) {
      var job = data.jobs[i];
      if (job.state !== "queued" || job.runAt > timestamp || !handlers[job.type]) continue;
      if (!isEligible(job)) continue;
      if (!byOwner[job.ownerId]) {
        byOwner[job.ownerId] = [];
        owners.push(job.ownerId);
      }
      byOwner[job.ownerId].push(job);
    }
    for (var ownerName in byOwner) {
      byOwner[ownerName].sort(function (left, right) {
        return left.runAt - right.runAt || left.createdAt - right.createdAt || left.id.localeCompare(right.id);
      });
    }
    owners.sort();
    if (!owners.length) return [];
    var offset = ownerCursor % owners.length;
    var ordered = owners.slice(offset).concat(owners.slice(0, offset));
    ownerCursor = (offset + 1) % owners.length;
    var result = [];
    var selectedByOwner = Object.create(null);
    var available = globalConcurrency - Object.keys(active).length;
    while (available > 0) {
      var progressed = false;
      for (var oi = 0; oi < ordered.length && available > 0; oi++) {
        var owner = ordered[oi];
        if (activeOwnerCount(owner) + (selectedByOwner[owner] || 0) >= perOwnerConcurrency) continue;
        if (!byOwner[owner].length) continue;
        result.push(byOwner[owner].shift());
        selectedByOwner[owner] = (selectedByOwner[owner] || 0) + 1;
        available--;
        progressed = true;
      }
      if (!progressed) break;
    }
    return result;
  }

  function updateExecution(id, claimId, mutate) {
    ensureReady();
    var current = findJob(id);
    if (!current || !current.execution || current.execution.claimId !== claimId || current.state !== "running") {
      throw new Error("Job execution is no longer active");
    }
    var next = copy(data);
    var job = null;
    for (var i = 0; i < next.jobs.length; i++) if (next.jobs[i].id === id) job = next.jobs[i];
    mutate(job);
    job.updatedAt = now();
    persist(next);
    return copy(job.execution);
  }

  function settle(id, claimId, state, result) {
    if (closed || unhealthyError) return;
    var current = findJob(id);
    if (!current || !current.execution || current.execution.claimId !== claimId || current.state !== "running") return;
    var next = copy(data);
    var job = null;
    for (var i = 0; i < next.jobs.length; i++) if (next.jobs[i].id === id) job = next.jobs[i];
    job.state = state;
    job.updatedAt = now();
    if (state === "completed") {
      job.execution.completedAt = job.updatedAt;
      if (result !== undefined) {
        try {
          job.execution.result = safeValue(result, "handler result", 64 * 1024);
        } catch (error) {
          job.state = "failed";
          delete job.execution.completedAt;
          job.execution.failedAt = job.updatedAt;
          job.execution.error = error.message;
        }
      }
    } else {
      job.execution.failedAt = job.updatedAt;
      job.execution.error = String(result && result.message ? result.message : result).slice(0, 4096);
    }
    try { persist(next); } catch (error) {}
  }

  function requeueUnstarted(id, claimId) {
    if (closed || unhealthyError) return;
    var current = findJob(id);
    if (!current || !current.execution || current.execution.claimId !== claimId || current.state !== "running") return;
    var next = copy(data);
    var job = null;
    for (var i = 0; i < next.jobs.length; i++) if (next.jobs[i].id === id) job = next.jobs[i];
    job.state = "queued";
    job.updatedAt = now();
    job.execution = null;
    persist(next);
  }

  function dispatch(job) {
    if (active[job.id] || unhealthyError || closed) return;
    var handler = handlers[job.type];
    if (!handler) return;
    var claimId = makeId();
    var claimedAt = now();
    var claimed = copy(data);
    var claimedJob = null;
    for (var i = 0; i < claimed.jobs.length; i++) if (claimed.jobs[i].id === job.id) claimedJob = claimed.jobs[i];
    if (!claimedJob || claimedJob.state !== "queued") return;
    claimedJob.state = "claimed";
    claimedJob.updatedAt = claimedAt;
    claimedJob.execution = { claimId: claimId, claimedAt: claimedAt, attempt: 1, metadata: null, receipt: null };
    persist(claimed);

    var running = copy(data);
    var runningJob = null;
    for (var ri = 0; ri < running.jobs.length; ri++) if (running.jobs[ri].id === job.id) runningJob = running.jobs[ri];
    runningJob.state = "running";
    runningJob.updatedAt = now();
    runningJob.execution.startedAt = runningJob.updatedAt;
    persist(running);
    active[job.id] = { ownerId: job.ownerId, claimId: claimId };

    var execution = {
      claimId: claimId,
      recordMetadata: function (metadata) {
        return updateExecution(job.id, claimId, function (record) {
          record.execution.metadata = safeValue(metadata, "execution metadata", 64 * 1024);
        });
      },
      recordReceipt: function (receipt) {
        return updateExecution(job.id, claimId, function (record) {
          record.execution.receipt = safeValue(receipt, "execution receipt", 64 * 1024);
        });
      },
    };
    Promise.resolve().then(function () {
      if (closed || unhealthyError || !active[job.id]) return undefined;
      if (handlers[job.type] !== handler) {
        requeueUnstarted(job.id, claimId);
        return undefined;
      }
      if (!isEligible(runningJob)) {
        requeueUnstarted(job.id, claimId);
        return undefined;
      }
      return handler(copy(runningJob), execution);
    }).then(function (result) {
      settle(job.id, claimId, "completed", result);
    }, function (error) {
      settle(job.id, claimId, "failed", error);
    }).finally(function () {
      delete active[job.id];
      scheduleTimer();
      if (!closed && !unhealthyError) {
        try { tick(); } catch (error) {}
      }
    }).catch(function () {});
  }

  function tick() {
    ensureReady();
    var due = dueByFairOwner(now());
    for (var i = 0; i < due.length; i++) {
      dispatch(due[i]);
    }
    scheduleTimer();
    return due.length;
  }

  function stopTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function scheduleTimer() {
    stopTimer();
    if (!started || closed || unhealthyError) return;
    var timestamp = now();
    var earliest = null;
    var activeCount = Object.keys(active).length;
    if (activeCount < globalConcurrency) {
      for (var i = 0; i < data.jobs.length; i++) {
        var job = data.jobs[i];
        if (job.state !== "queued" || !handlers[job.type]) continue;
        if (!isEligible(job)) continue;
        if (activeOwnerCount(job.ownerId) >= perOwnerConcurrency) continue;
        if (earliest === null || job.runAt < earliest) earliest = job.runAt;
      }
    }
    var delay = maxTimerDelay;
    if (earliest !== null) delay = Math.min(maxTimerDelay, Math.max(0, earliest - timestamp));
    timer = setTimer(function () {
      timer = null;
      try { tick(); } catch (error) {}
    }, delay);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function registerHandler(type, handler, options) {
    ensureReady();
    requiredString(type, "handler type");
    if (typeof handler !== "function") throw new Error("handler must be a function");
    if (options && options.canRun !== undefined && typeof options.canRun !== "function") throw new Error("canRun must be a function");
    if (handlers[type]) throw new Error("handler already registered for " + type);
    handlers[type] = handler;
    if (options && options.canRun) eligibility[type] = options.canRun;
    if (started) tick();
    return function () {
      if (handlers[type] !== handler) return;
      delete handlers[type];
      delete eligibility[type];
      scheduleTimer();
    };
  }

  function start() {
    ensureReady();
    if (started) return false;
    started = true;
    tick();
    return true;
  }

  function shutdown() {
    if (closed) return Promise.resolve();
    closed = true;
    started = false;
    stopTimer();
    var ids = Object.keys(active);
    if (ids.length && !unhealthyError) {
      var next = copy(data);
      var stoppedAt = now();
      for (var i = 0; i < next.jobs.length; i++) {
        if (!active[next.jobs[i].id] || next.jobs[i].state !== "running") continue;
        next.jobs[i].state = "interrupted";
        next.jobs[i].updatedAt = stoppedAt;
        next.jobs[i].execution.interruptedAt = stoppedAt;
        next.jobs[i].execution.interruptionReason = "scheduler_shutdown";
      }
      try { store.save(next); data = next; } catch (error) { unhealthyError = error; }
    }
    store.close();
    return Promise.resolve();
  }

  function getJob(id) { var job = findJob(id); return job ? copy(job) : null; }
  function listJobs() { return copy(data.jobs); }
  function getReceipt(id) { var job = findJob(id); return job && job.execution ? copy(job.execution.receipt) : null; }
  function status() { return { started: started, closed: closed, healthy: !unhealthyError, error: unhealthyError ? unhealthyError.message : null, active: Object.keys(active).length }; }

  try {
    recover();
  } catch (error) {
    store.close();
    throw error;
  }
  return {
    start: start,
    shutdown: shutdown,
    registerHandler: registerHandler,
    enqueue: enqueue,
    cancel: cancel,
    replaceQueued: replaceQueued,
    tick: tick,
    getJob: getJob,
    listJobs: listJobs,
    getReceipt: getReceipt,
    status: status,
  };
}

module.exports = { attachDurableScheduler: attachDurableScheduler };
