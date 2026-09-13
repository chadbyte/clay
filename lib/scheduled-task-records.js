var fs = require("fs");
var path = require("path");
var validation = require("./schedule-validation");
var restoreRecord = require("./record-revision").restoreRecord;
var ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
var PATCH_FIELDS = { name: true, instructions: true, cron: true, date: true, time: true, scheduleRule: true, execution: true, skipIfRunning: true };

function createScheduledTaskRecords(ctx) {
  function canAccess(session, record) {
    if (!session || !record) return false;
    if (ctx.canAccessRecord && !ctx.canAccessRecord(session, record)) return false;
    if (record.ownerId && record.ownerId !== session.ownerId) return false;
    return !ctx.canUseSession || ctx.canUseSession(session);
  }

  function publicRecord(record) {
    if (!record) return null;
    var runs = Array.isArray(record.runs) ? record.runs : [];
    var readiness = ctx.runtimeStatus ? ctx.runtimeStatus(record) : null;
    return {
      id: record.id, revision: Number(record.updatedAt || 0), name: record.name || "",
      instructions: record.task || record.prompt || record.instructions || "",
      cron: record.cron || null, date: record.date || null, time: record.time || null,
      scheduleRule: record.scheduleRule || null, recurrenceEnd: record.recurrenceEnd || null, intervalEnd: record.intervalEnd || null,
      execution: record.execution || null, skipIfRunning: record.skipIfRunning !== false,
      enabled: record.enabled !== false, ownerId: record.ownerId || null, ownerName: record.ownerName || null,
      vendor: record.vendor || null, model: record.model || null, effort: record.effort || null,
      linkedTaskId: record.linkedTaskId || null, source: record.source || null,
      activeRun: record.activeRun || null, lastRunResult: record.lastRunResult || null,
      latestRun: runs.length ? runs[runs.length - 1] : null, readiness: readiness,
    };
  }

  function list(session) {
    var records = ctx.registry.getAll();
    var result = [];
    for (var i = 0; i < records.length; i++) {
      if (canAccess(session, records[i]) && (records[i].cron || records[i].scheduleRule || (records[i].source === "schedule" && records[i].date && records[i].time))) result.push(publicRecord(records[i]));
    }
    return result;
  }

  function read(session, id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return { ok: false, error: "Scheduled task id is invalid." };
    var record = ctx.registry.getById(id);
    if (!record) return { ok: false, error: "Scheduled task not found." };
    if (!canAccess(session, record)) return { ok: false, error: "Scheduled task access denied." };
    return { ok: true, record: publicRecord(record) };
  }

  function update(session, id, revision, patch) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return { ok: false, error: "Scheduled task id is invalid." };
    var record = ctx.registry.getById(id);
    if (!record) return { ok: false, error: "Scheduled task not found." };
    if (!canAccess(session, record)) return { ok: false, error: "Scheduled task access denied." };
    if (Number(revision) !== Number(record.updatedAt)) return { ok: false, error: "This scheduled task changed. Read it again before updating." };
    patch = patch && typeof patch === "object" ? patch : {};
    var patchKeys = Object.keys(patch);
    if (!patchKeys.length) return { ok: false, error: "No scheduled task changes were provided." };
    for (var pi = 0; pi < patchKeys.length; pi++) {
      if (!PATCH_FIELDS[patchKeys[pi]]) return { ok: false, error: "Unsupported scheduled task field: " + patchKeys[pi] + "." };
    }
    if (record.linkedTaskId && Object.prototype.hasOwnProperty.call(patch, "instructions")) return { ok: false, error: "Instructions belong to the linked task and cannot be changed from its schedule." };
    var current = publicRecord(record);
    var merged = Object.assign({}, current, patch);
    if (Object.prototype.hasOwnProperty.call(patch, "cron") && patch.cron) merged.scheduleRule = null;
    if (Object.prototype.hasOwnProperty.call(patch, "scheduleRule") && patch.scheduleRule) merged.cron = null;
    var checked = validation.validateScheduledTaskInput(merged);
    if (!checked.ok) return { ok: false, error: checked.error };
    if (checked.value.execution && ctx.preflightRuntime) {
      try {
        ctx.preflightRuntime(checked.value.execution.driver, null, true);
        ctx.preflightRuntime(checked.value.execution.worker, null, true);
      } catch (error) { return { ok: false, error: error.message || String(error) }; }
    }
    var prior = Object.assign({}, record);
    var promptPath = path.join(ctx.cwd, ".claude", "loops", record.id, "PROMPT.md");
    var priorPrompt = null;
    var hadPrompt = false;
    if (!record.linkedTaskId) {
      try { priorPrompt = fs.readFileSync(promptPath, "utf8"); hadPrompt = true; } catch (e) {}
    }
    try {
      var updateData = Object.assign({}, checked.value);
      if (updateData.cron) {
        updateData.date = record.cron && !record.scheduleRule ? record.date || null : null;
        updateData.time = record.cron && !record.scheduleRule ? record.time || null : null;
        updateData.scheduleRule = null;
        updateData.recurrenceEnd = record.cron && !record.scheduleRule ? record.recurrenceEnd || null : null;
        updateData.intervalEnd = record.cron && !record.scheduleRule ? record.intervalEnd || null : null;
      }
      updateData.source = updateData.cron && !record.linkedTaskId ? (record.source === "schedule" ? null : record.source) : "schedule";
      if (!record.linkedTaskId) {
        fs.mkdirSync(path.dirname(promptPath), { recursive: true });
        fs.writeFileSync(promptPath, checked.value.instructions + "\n", "utf8");
        updateData.task = checked.value.instructions;
        updateData.prompt = checked.value.instructions;
      } else delete updateData.instructions;
      if (!ctx.registry.update(record.id, updateData)) throw new Error("The schedule registry did not update the task.");
      if (ctx.registry.getLastSaveError && ctx.registry.getLastSaveError()) throw new Error(ctx.registry.getLastSaveError());
    } catch (error) {
      restoreRecord(record, prior);
      if (!record.linkedTaskId) {
        try { if (hadPrompt) fs.writeFileSync(promptPath, priorPrompt, "utf8"); else fs.rmSync(promptPath, { force: true }); } catch (e) {}
      }
      return { ok: false, error: "The task could not be stored: " + (error.message || error) };
    }
    return { ok: true, record: publicRecord(ctx.registry.getById(id) || record) };
  }

  return { list: list, read: read, update: update, canAccess: canAccess };
}

module.exports = { createScheduledTaskRecords: createScheduledTaskRecords };
