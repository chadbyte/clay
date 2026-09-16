var recordRevision = require("./record-revision");

function attachLoopRegistryOccurrence(ctx) {
  function normalize(id, now) {
    var rec = ctx.getById(id);
    if (!rec || !rec.enabled || !rec.scheduleRule || !rec.nextRunAt || rec.nextRunAt > now - 60000) return rec;
    var next = ctx.nextRecordRunTime(rec, now - 60000);
    if (Number(next) === Number(rec.nextRunAt)) return rec;
    var previous = JSON.parse(JSON.stringify(rec));
    rec.nextRunAt = next;
    if (!next) rec.enabled = false;
    if (!ctx.save()) { recordRevision.restoreRecord(rec, previous); return null; }
    ctx.changed();
    return rec;
  }

  function markNeedsOwner(id) {
    var rec = ctx.getById(id);
    if (!rec || rec.needsOwner === true) return false;
    var previous = JSON.parse(JSON.stringify(rec));
    rec.needsOwner = true;
    rec.setupRequired = "owner";
    rec.enabled = false;
    rec.nextRunAt = null;
    rec.scheduleEpoch = Math.max(1, Number(rec.scheduleEpoch) || 1) + 1;
    rec.updatedAt = recordRevision.nextRevision(rec);
    if (!ctx.save()) { recordRevision.restoreRecord(rec, previous); return false; }
    ctx.changed();
    return true;
  }

  function prepare(id, occurrenceAt) {
    var rec = ctx.getById(id);
    if (!rec || !rec.enabled || Number(rec.nextRunAt) !== Number(occurrenceAt)) return { ok: false, error: "The scheduled occurrence is stale." };
    var previous = JSON.parse(JSON.stringify(rec));
    var prepared = ctx.prepareTrigger ? ctx.prepareTrigger(rec) : null;
    if (prepared && prepared.ok === false) return prepared;
    ctx.scheduledRuns.prepareRecord(rec, prepared);
    if (!ctx.save()) { recordRevision.restoreRecord(rec, previous); return { ok: false, error: ctx.lastSaveError() || "The occurrence reservation could not be stored." }; }
    ctx.changed();
    if (prepared && prepared.skippedRun) ctx.scheduledRuns.notifyTerminal(rec, prepared.skippedRun);
    return { ok: true, value: prepared };
  }

  function trigger(id, prepared) {
    var rec = ctx.getById(id);
    if (!rec) throw new Error("The scheduled record was deleted.");
    if (ctx.onTrigger) ctx.onTrigger(rec, prepared);
  }

  function advance(id, occurrenceAt, result) {
    var rec = ctx.getById(id);
    if (!rec || Number(rec.nextRunAt) !== Number(occurrenceAt)) return false;
    var previous = JSON.parse(JSON.stringify(rec));
    var now = Date.now();
    rec.lastRunAt = result === "interrupted" ? occurrenceAt : now;
    if (result) rec.lastRunResult = result;
    if (rec.scheduleRule) ctx.scheduleRule.recordScheduleStartState(rec, occurrenceAt);
    if (rec.cron || rec.scheduleRule) {
      rec.nextRunAt = ctx.nextRecordRunTime(rec, now);
      if (rec.scheduleRule && !rec.nextRunAt) rec.enabled = false;
    } else {
      rec.nextRunAt = null;
      rec.enabled = false;
    }
    if (!ctx.save()) { recordRevision.restoreRecord(rec, previous); return false; }
    ctx.changed();
    return true;
  }

  function complete(id, occurrenceAt) { return advance(id, occurrenceAt, null); }
  function reconcile(id, occurrenceAt) { return advance(id, occurrenceAt, "interrupted"); }

  return { normalize: normalize, markNeedsOwner: markNeedsOwner, prepare: prepare, trigger: trigger, complete: complete, reconcile: reconcile };
}

module.exports = { attachLoopRegistryOccurrence: attachLoopRegistryOccurrence };
