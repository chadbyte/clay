var crypto = require("crypto");

function identity(prefix, projectId, scheduleIdentity, scheduleEpoch, occurrenceAt) {
  var raw = projectId + "\n" + scheduleIdentity + "\n" + scheduleEpoch + "\n" + occurrenceAt;
  return prefix + crypto.createHash("sha256").update(raw).digest("hex");
}

function attachLoopDurableSchedule(ctx) {
  var scheduler = ctx.scheduler;
  var registry = ctx.registry;
  var type = "loop-occurrence:" + ctx.projectId;
  var unregister = null;
  var syncing = false;

  function isMultiUser() { return typeof ctx.isMultiUser === "function" ? ctx.isMultiUser() : !!ctx.isMultiUser; }

  function ownerFor(record) {
    if (!isMultiUser()) return "local-user";
    return typeof record.ownerId === "string" && record.ownerId ? record.ownerId : null;
  }

  function jobsFor(recordId) {
    return scheduler.listJobs().filter(function (job) {
      return job.type === type && job.projectId === ctx.projectId && job.target && job.target.id === recordId;
    });
  }

  function queuedFor(recordId) {
    var jobs = jobsFor(recordId);
    for (var i = jobs.length - 1; i >= 0; i--) if (jobs[i].state === "queued") return jobs[i];
    return null;
  }

  function spec(record, ownerId) {
    var dueAt = record.nextRunAt;
    var occurrenceKey = identity("occurrence:", ctx.projectId, record.scheduleIdentity, record.scheduleEpoch, dueAt);
    return {
      idempotencyKey: "loop-" + occurrenceKey,
      type: type,
      ownerId: ownerId,
      projectId: ctx.projectId,
      target: { kind: "loop-record", id: record.id },
      payload: { recordId: record.id, occurrenceAt: dueAt, occurrenceKey: occurrenceKey, scheduleIdentity: record.scheduleIdentity, scheduleEpoch: record.scheduleEpoch, recordRevision: Number(record.updatedAt || 0) },
      runAt: dueAt,
    };
  }

  function matchesOccurrence(job, record) {
    return job && job.payload && job.payload.scheduleIdentity === record.scheduleIdentity &&
      Number(job.payload.scheduleEpoch) === Number(record.scheduleEpoch) && job.payload.occurrenceAt === record.nextRunAt;
  }

  function cancelQueued(recordId, reason) {
    var jobs = jobsFor(recordId);
    for (var i = 0; i < jobs.length; i++) {
      if (jobs[i].state === "queued") scheduler.cancel(jobs[i].id, reason);
    }
  }

  function syncRecord(record) {
    var related = jobsFor(record.id);
    var persistedDueOwned = related.some(function (job) {
      return ["queued", "claimed", "running"].indexOf(job.state) !== -1 && matchesOccurrence(job, record);
    });
    var terminal = null;
    for (var ti = related.length - 1; ti >= 0; ti--) {
      if (["completed", "failed", "interrupted"].indexOf(related[ti].state) !== -1 && matchesOccurrence(related[ti], record)) { terminal = related[ti]; break; }
    }
    if (terminal && record.enabled && Number.isFinite(record.nextRunAt)) {
      if (!registry.reconcileDurableOccurrence(record.id, record.nextRunAt)) throw new Error("The interrupted occurrence could not be reconciled.");
      record = registry.getById(record.id); related = jobsFor(record.id); persistedDueOwned = false;
    }
    if (!persistedDueOwned) {
      record = registry.normalizeDurableOccurrence(record.id, Date.now());
      if (!record) throw new Error("The scheduled occurrence could not be normalized.");
      related = jobsFor(record.id);
    }
    var queued = queuedFor(record.id);
    var ownerId = ownerFor(record);
    if (isMultiUser() && !ownerId) {
      if (queued) scheduler.cancel(queued.id, "record_requires_owner");
      registry.markNeedsOwner(record.id);
      return;
    }
    if (!record.enabled || !Number.isFinite(record.nextRunAt)) {
      if (queued) scheduler.cancel(queued.id, "record_disabled_or_unscheduled");
      return;
    }
    var wanted = spec(record, ownerId);
    if (queued) {
      if (matchesOccurrence(queued, record)) {
        scheduler.replaceQueued(queued.id, wanted);
        return;
      }
      scheduler.cancel(queued.id, "record_schedule_changed");
    }
    for (var i = related.length - 1; i >= 0; i--) {
      if ((related[i].state === "claimed" || related[i].state === "running") && matchesOccurrence(related[i], record)) return;
      if (related[i].state === "cancelled" && matchesOccurrence(related[i], record)) return;
    }
    scheduler.enqueue(wanted);
  }

  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      var records = registry.getAll();
      var present = Object.create(null);
      for (var i = 0; i < records.length; i++) {
        present[records[i].id] = true;
        syncRecord(records[i]);
      }
      var jobs = scheduler.listJobs();
      for (var ji = 0; ji < jobs.length; ji++) {
        if (jobs[ji].type === type && jobs[ji].state === "queued" && !present[jobs[ji].target.id]) {
          scheduler.cancel(jobs[ji].id, "record_deleted");
        }
      }
    } finally { syncing = false; }
  }

  function canRun(job) {
    var record = registry.getById(job.target.id);
    if (!record || !record.enabled || !matchesOccurrence(job, record)) return true;
    if (ownerFor(record) !== job.ownerId) return true;
    if (ctx.authorize && !ctx.authorize(record, job.ownerId)) return false;
    return !ctx.canRun || ctx.canRun(record);
  }

  function dispatch(job, execution) {
    var record = registry.getById(job.target.id);
    if (!record) throw new Error("The scheduled record was deleted.");
    if (!record.enabled || !matchesOccurrence(job, record)) throw new Error("The scheduled occurrence is stale.");
    if (ownerFor(record) !== job.ownerId) throw new Error("The scheduled record owner changed.");
    if (ctx.authorize && !ctx.authorize(record, job.ownerId)) throw new Error("The scheduled record owner is no longer authorized.");
    execution.recordMetadata({ projectId: ctx.projectId, recordId: record.id, occurrenceAt: job.payload.occurrenceAt, recordRevision: Number(record.updatedAt || 0) });
    var prepared = registry.prepareDurableOccurrence(record.id, job.payload.occurrenceAt);
    if (!prepared || prepared.ok === false) throw new Error(prepared && prepared.error || "The scheduled occurrence could not be reserved.");
    execution.recordReceipt({ state: "dispatching", projectId: ctx.projectId, recordId: record.id, occurrenceAt: job.payload.occurrenceAt, recordedAt: Date.now() });
    var triggerError = null;
    try { registry.triggerDurableOccurrence(record.id, prepared.value); }
    catch (error) { triggerError = error; }
    if (!registry.completeDurableOccurrence(record.id, job.payload.occurrenceAt)) throw new Error("The next scheduled occurrence could not be stored after dispatch.");
    if (triggerError) throw triggerError;
    return { dispatched: true, recordId: record.id, occurrenceAt: job.payload.occurrenceAt };
  }

  unregister = scheduler.registerHandler(type, dispatch, { canRun: canRun });
  sync();
  return {
    sync: sync,
    wake: function () { try { scheduler.tick(); } catch (error) {} },
    shutdown: function () { if (unregister) { unregister(); unregister = null; } },
    type: type,
  };
}

module.exports = { attachLoopDurableSchedule: attachLoopDurableSchedule };
