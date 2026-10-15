var crypto = require('crypto');
var rule = require('./schedule-rule');

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function attachMateScheduleLifecycle(ctx) {
  var now = ctx.now || Date.now;
  function save(session, records) {
    var previous = session.mateSchedules;
    session.mateSchedules = records;
    if (ctx.sm.saveSessionFile(session) !== true) {
      session.mateSchedules = previous;
      throw new Error('The Mate schedule could not be saved.');
    }
  }
  function records(session) { return copy(session.mateSchedules || []); }
  function find(session, id) {
    return records(session).find(function (record) { return record.id === id; }) || null;
  }
  function replace(session, record) {
    var all = records(session);
    var index = all.findIndex(function (item) { return item.id === record.id; });
    if (index < 0) all.push(record); else all[index] = record;
    save(session, all);
  }
  function jobFor(record) {
    return ctx.scheduler.listJobs().reverse().find(function (job) {
      return job.projectId === ctx.slug && job.payload && job.payload.mateScheduleId === record.id &&
        job.payload.logicalRevision === record.revision && job.payload.occurrence === record.occurrence;
    });
  }
  function current(session, job) {
    var record = job && job.payload && find(session, job.payload.mateScheduleId);
    return !!(record && record.state === 'active' && record.revision === job.payload.logicalRevision &&
      record.occurrence === job.payload.occurrence && record.ownerId === job.ownerId);
  }
  function admit(session, record) {
    if (record.state !== 'active') return null;
    var existing = jobFor(record);
    if (existing && !(existing.state === 'cancelled' && existing.cancelledReason === 'queue_admission_failed')) {
      if (['failed', 'cancelled', 'interrupted'].indexOf(existing.state) >= 0) throw new Error('The occurrence requires recovery; it was not scheduled.');
      return existing;
    }
    var job = ctx.schedule(session, record.message, Math.max(record.runAt, now() + 1),
      { id: record.ownerId }, null, null, 'mate-' + record.id + '-' + record.revision + '-' + record.occurrence,
      null, { exact: true, scheduleRule: record.rule, mateScheduleId: record.id,
        logicalScheduleId: record.id, logicalRevision: record.revision, occurrence: record.occurrence });
    if (!job) throw new Error('The occurrence could not be admitted. The saved schedule needs retry.');
    return job;
  }
  function create(session, value, id) {
    ctx.authorize(session);
    var existing = find(session, id);
    if (existing) { admit(session, existing); return existing; }
    var runAt = rule.nextScheduleRuleTime(value.rule, now(), [], {});
    if (!Number.isFinite(runAt)) throw new Error('The schedule time has expired.');
    var record = { id: id, revision: crypto.randomUUID(), ownerId: ctx.owner(session), message: value.message,
      rule: value.rule, state: 'active', occurrence: 0, count: 0, dateCounts: {}, runAt: runAt };
    replace(session, record);
    admit(session, record);
    return record;
  }
  function checked(session, args) {
    ctx.authorize(session);
    var record = find(session, args.id);
    if (!record || record.ownerId !== ctx.owner(session)) throw new Error('Schedule not found.');
    if (args.revision && args.revision !== record.revision) throw new Error('The schedule revision is stale.');
    return record;
  }
  function cancel(session, args) {
    var record = checked(session, args);
    if (record.state === 'cancelled') return record;
    // Persist the tombstone before touching occurrences. Dispatch rechecks it.
    record.state = 'cancelled';
    replace(session, record);
    var job = jobFor(record);
    if (job && job.state === 'queued' && !ctx.cancelJob(session, job)) throw new Error('Cancellation was saved, but occurrence cleanup failed.');
    return record;
  }
  function update(session, args, value) {
    var previous = checked(session, args);
    if (previous.state !== 'active') throw new Error('Only active schedules can be updated.');
    var runAt = rule.nextScheduleRuleTime(value.rule, now(), [], {});
    if (!Number.isFinite(runAt)) throw new Error('The schedule time has expired.');
    var record = Object.assign({}, previous, { revision: crypto.randomUUID(), message: value.message,
      rule: value.rule, count: 0, dateCounts: {}, occurrence: 0, runAt: runAt });
    replace(session, record);
    var oldJob = jobFor(previous);
    if (oldJob && oldJob.state === 'queued' && !ctx.cancelJob(session, oldJob)) throw new Error('Update saved, but previous occurrence cleanup failed.');
    admit(session, record);
    return record;
  }
  function consumed(session, job) {
    if (!current(session, job)) return false;
    var record = find(session, job.payload.mateScheduleId);
    record.count++;
    var date = new Date(record.runAt);
    var key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    record.dateCounts[key] = Number(record.dateCounts[key] || 0) + 1;
    // Coalesce missed times: deliver the admitted occurrence once, then choose
    // the next future time. Counts represent deliveries, not missed slots.
    record.runAt = rule.nextScheduleRuleTime(record.rule, Math.max(record.runAt, now()), [],
      { startCount: record.count, dateStartCounts: record.dateCounts });
    record.occurrence++;
    if (!Number.isFinite(record.runAt)) record.state = 'completed';
    replace(session, record);
    admit(session, record);
    return true;
  }
  function reconcile(session) {
    records(session).forEach(function (record) {
      if (record.state !== 'active') return;
      ctx.authorize(session);
      var job = jobFor(record);
      var item = job && ctx.queueItem(session, job);
      if (item && item.state === 'consumed') consumed(session, job);
      else if (item && (item.state === 'cancelled' || item.state === 'failed')) {
        record.state = item.state;
        replace(session, record);
      } else if (job && ['failed', 'cancelled', 'interrupted'].indexOf(job.state) >= 0 && (!item || item.state !== 'pending')) {
        record.state = 'interrupted';
        replace(session, record);
      } else admit(session, record);
    });
  }
  function onConsumed(session, job) {
    try { return consumed(session, job); }
    catch (error) {
      // Queue consumption is already durable. Keep the accepted provider turn
      // running; reconciliation repairs the saved next occurrence after restart.
      ctx.sm.sendAndRecord(session, { type: 'error', text: 'The scheduled message was delivered, but its next occurrence needs recovery: ' + error.message });
      return false;
    }
  }
  return { create: create, read: checked, list: function (session) { ctx.authorize(session); return records(session); },
    update: update, cancel: cancel, failed: function (session, job, error) {
      if (!current(session, job)) return;
      var record = find(session, job.payload.mateScheduleId);
      record.state = 'failed'; record.error = error.message;
      replace(session, record);
    }, cancelled: function (session, job) {
      if (!current(session, job)) return;
      var record = find(session, job.payload.mateScheduleId);
      record.state = 'cancelled';
      replace(session, record);
    }, current: current, consumed: onConsumed, reconcile: reconcile };
}
module.exports = { attachMateScheduleLifecycle: attachMateScheduleLifecycle };
