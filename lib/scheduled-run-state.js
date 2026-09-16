var recordRevision = require("./record-revision");

function createScheduledRunState(ctx) {
  function mutate(id, fn) {
    var rec = ctx.getRecord(id);
    if (!rec) return false;
    var previous = JSON.parse(JSON.stringify(rec));
    if (!fn(rec)) return false;
    rec.updatedAt = recordRevision.nextRevision(rec);
    if (!ctx.save()) { recordRevision.restoreRecord(rec, previous); return false; }
    if (ctx.onChange) ctx.onChange();
    return true;
  }

  function begin(id, run) {
    return mutate(id, function (rec) {
      if (rec.activeRun) return false;
      rec.activeRun = Object.assign({}, run);
      if (run && run.source === "queued") rec.pendingRun = null;
      return true;
    });
  }

  function prepareRecord(rec, prepared) {
    if (!prepared) return;
    if (prepared.activeRun) rec.activeRun = Object.assign({}, prepared.activeRun);
    if (prepared.pendingRun) rec.pendingRun = Object.assign({}, prepared.pendingRun);
    if (prepared.skippedRun) {
      rec.lastRunResult = "skipped-busy";
      rec.runs = Array.isArray(rec.runs) ? rec.runs : [];
      rec.runs.push(Object.assign({}, prepared.skippedRun));
      if (rec.runs.length > 20) rec.runs = rec.runs.slice(-20);
    }
  }

  function update(id, runId, patch) {
    return mutate(id, function (rec) {
      if (!rec.activeRun || rec.activeRun.runId !== runId) return false;
      rec.activeRun = Object.assign({}, rec.activeRun, patch || {});
      return true;
    });
  }

  function complete(id, runId, result) {
    var completed = null;
    var saved = mutate(id, function (rec) {
      if (!rec.activeRun || rec.activeRun.runId !== runId) return false;
      var run = Object.assign({}, rec.activeRun, result || {}, { finishedAt: Date.now() });
      completed = run;
      rec.lastRunAt = run.startedAt || Date.now();
      rec.lastRunResult = run.outcome || "failed";
      rec.runs = Array.isArray(rec.runs) ? rec.runs : [];
      rec.runs.push(run);
      if (rec.runs.length > 20) rec.runs = rec.runs.slice(-20);
      if (run.outcome === "interrupted") rec.pendingRun = null;
      rec.activeRun = null;
      return true;
    });
    if (saved && completed && ctx.onTerminal) ctx.onTerminal(ctx.getRecord(id), completed);
    return saved;
  }

  function recover(rec) {
    if (!rec || !rec.activeRun) return false;
    rec.runs = Array.isArray(rec.runs) ? rec.runs : [];
    rec.runs.push(Object.assign({}, rec.activeRun, { outcome: "interrupted", reason: "Daemon restarted before the scheduled run reported an outcome.", finishedAt: Date.now() }));
    if (rec.runs.length > 20) rec.runs = rec.runs.slice(-20);
    rec.lastRunResult = "interrupted";
    rec.pendingRun = null;
    rec.activeRun = null;
    return true;
  }

  function recordLegacy(id, result) {
    var rec = ctx.getRecord(id);
    if (!rec) return false;
    var previous = JSON.parse(JSON.stringify(rec));
    rec.lastRunAt = result.startedAt || Date.now();
    rec.lastRunResult = result.reason || null;
    rec.runs = Array.isArray(rec.runs) ? rec.runs : [];
    rec.runs.push({ startedAt: result.startedAt || rec.lastRunAt, finishedAt: Date.now(), result: result.reason || "unknown", iterations: result.iterations || 0 });
    if (rec.runs.length > 20) rec.runs = rec.runs.slice(-20);
    if (!ctx.save()) { recordRevision.restoreRecord(rec, previous); return false; }
    if (ctx.onChange) ctx.onChange();
    return true;
  }

  function notifyTerminal(rec, run) {
    if (ctx.onTerminal && rec && run) ctx.onTerminal(rec, run);
  }

  return { begin: begin, complete: complete, notifyTerminal: notifyTerminal, prepareRecord: prepareRecord, recordLegacy: recordLegacy, recover: recover, update: update };
}

module.exports = { createScheduledRunState: createScheduledRunState };
