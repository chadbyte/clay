var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var { CONFIG_DIR } = require("./config");
var { encodeCwd } = require("./utils");
var scheduleRule = require("./schedule-rule");
var recordRevision = require("./record-revision");
var createScheduledRunState = require("./scheduled-run-state").createScheduledRunState;
var attachLoopRegistryOccurrence = require("./loop-registry-occurrence").attachLoopRegistryOccurrence;
var nextRunTime = require("./loop-cron").nextRunTime;

function nextRecordRunTime(record, after) {
  return record.scheduleRule ? scheduleRule.nextScheduleRuleTime(record.scheduleRule, after, record.runs, { startCount: record.scheduleStartCount, dateStartCounts: record.scheduleDateStartCounts }) : (record.cron ? nextRunTime(record.cron, after) : null);
}

function oneOffRunTime(record) {
  var date = record.date.split("-");
  var time = record.time.split(":");
  return new Date(Number(date[0]), Number(date[1]) - 1, Number(date[2]), Number(time[0]), Number(time[1]), 0).getTime();
}

function createLoopRegistry(opts) {
  var cwd = opts.cwd;
  var onTrigger = opts.onTrigger, onChange = opts.onChange;
  var canTrigger = opts.canTrigger, prepareTrigger = opts.prepareTrigger;

  var encoded = encodeCwd(cwd);
  var registryPath = opts.registryPath || path.join(CONFIG_DIR, "loops", encoded + ".jsonl");
  var registryDir = path.dirname(registryPath);

  var records = [];
  var timerId = null;
  var CHECK_INTERVAL = 30 * 1000;
  var lastTriggeredMinute = {};
  var lastSaveError = null;
  var scheduledRuns = createScheduledRunState({
    getRecord: getById, save: save,
    onChange: function () { if (onChange) onChange(records); },
    onTerminal: opts.onRunTerminal,
  });
  var durableOccurrence;

  function load() {
    var recoveredRun = false;
    try {
      var raw = fs.readFileSync(registryPath, "utf8");
      var lines = raw.trim().split("\n");
      records = [];
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        try {
          var rec = JSON.parse(lines[i]);
          if (scheduledRuns.recover(rec)) recoveredRun = true;
          if ((rec.cron || rec.scheduleRule || (rec.source === "schedule" && rec.date && rec.time)) && !rec.scheduleIdentity) {
            rec.scheduleIdentity = crypto.randomUUID(); rec.scheduleEpoch = 1; recoveredRun = true;
          } else if (rec.scheduleIdentity && (!Number.isInteger(rec.scheduleEpoch) || rec.scheduleEpoch < 1)) {
            rec.scheduleEpoch = 1; recoveredRun = true;
          }
          if ((rec.cron || rec.scheduleRule) && rec.enabled) {
            if (!Number.isFinite(rec.nextRunAt)) rec.nextRunAt = nextRecordRunTime(rec);
            if (rec.scheduleRule && !rec.nextRunAt) rec.enabled = false;
          } else if (!rec.cron && !rec.scheduleRule && rec.enabled && rec.date && rec.time && rec.source === "schedule") {
            rec.nextRunAt = oneOffRunTime(rec);
          }
          records.push(rec);
        } catch (e) {
          // skip malformed line
        }
      }
      if (recoveredRun) save();
    } catch (e) {
      records = [];
    }
  }

  function save() {
    try {
      fs.mkdirSync(registryDir, { recursive: true });
      var lines = [];
      for (var i = 0; i < records.length; i++) {
        lines.push(JSON.stringify(records[i]));
      }
      var tmpPath = registryPath + ".tmp";
      fs.writeFileSync(tmpPath, lines.join("\n") + "\n");
      fs.renameSync(tmpPath, registryPath);
      lastSaveError = null;
      return true;
    } catch (e) {
      lastSaveError = e.message || String(e);
      console.error("[loop-registry] Failed to save:", e.message);
      return false;
    }
  }

  function notifyOrRollback(rollback) {
    if (!onChange) return true;
    try { onChange(records); return true; }
    catch (error) {
      rollback();
      var syncMessage = error && (error.message || String(error)) || "unknown durable scheduler error";
      var rollbackSaved = save();
      var rollbackMessage = rollbackSaved ? "" : " Registry rollback could not be stored: " + (lastSaveError || "unknown storage error") + ".";
      lastSaveError = "Schedule metadata was rolled back because durable synchronization failed: " + syncMessage + "." + rollbackMessage;
      console.error("[loop-registry] " + lastSaveError);
      return false;
    }
  }

  function startTimer() {
    if (timerId) return;
    timerId = setInterval(function () {
      tick();
    }, CHECK_INTERVAL);
    tick();
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function tick() {
    var now = Date.now();
    var nowMinuteKey = Math.floor(now / 60000);

    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (!rec.enabled) continue;
      if (!rec.nextRunAt) continue;
      if (rec.nextRunAt > now) continue;
      if (canTrigger && canTrigger(rec) === false) continue;

      if (rec.scheduleRule) {
        var duePrevious = JSON.parse(JSON.stringify(rec));
        var currentDue = nextRecordRunTime(rec, now - 60000);
        if (currentDue !== rec.nextRunAt) {
          rec.nextRunAt = currentDue;
          if (!currentDue) rec.enabled = false;
          if (!save()) recordRevision.restoreRecord(rec, duePrevious);
          if (onChange) onChange(records);
          continue;
        }
      }

      var triggerKey = rec.id + "_" + nowMinuteKey;
      if (lastTriggeredMinute[triggerKey]) continue;
      lastTriggeredMinute[triggerKey] = true;

      var keys = Object.keys(lastTriggeredMinute);
      for (var k = 0; k < keys.length; k++) {
        var keyParts = keys[k].split("_");
        var keyMinute = parseInt(keyParts[keyParts.length - 1], 10);
        if (keyMinute < nowMinuteKey - 1) {
          delete lastTriggeredMinute[keys[k]];
        }
      }

      if (!rec.scheduleRule && rec.recurrenceEnd) {
        var shouldDisable = false;
        if (rec.recurrenceEnd.type === "until" && rec.recurrenceEnd.date) {
          var reParts = rec.recurrenceEnd.date.split("-");
          var endDate = new Date(parseInt(reParts[0], 10), parseInt(reParts[1], 10) - 1, parseInt(reParts[2], 10), 23, 59, 59, 999);
          if (now > endDate.getTime()) {
            shouldDisable = true;
          }
        } else if (rec.recurrenceEnd.type === "after" && rec.recurrenceEnd.count > 0) {
          if ((rec.runs || []).length >= rec.recurrenceEnd.count) {
            shouldDisable = true;
          }
        }
        if (shouldDisable) {
          rec.enabled = false;
          rec.nextRunAt = null;
          save();
          if (onChange) onChange(records);
          continue;
        }
      }

      if (!rec.scheduleRule && rec.intervalEnd) {
        var skipTrigger = false;
        if (rec.intervalEnd.type === "until" && rec.intervalEnd.time) {
          var nowDate = new Date(now);
          var ieParts = rec.intervalEnd.time.split(":");
          var stopH = parseInt(ieParts[0], 10);
          var stopM = parseInt(ieParts[1], 10) || 0;
          var nowMinOfDay = nowDate.getHours() * 60 + nowDate.getMinutes();
          if (nowMinOfDay >= stopH * 60 + stopM) {
            skipTrigger = true;
          }
        } else if (rec.intervalEnd.type === "after" && rec.intervalEnd.count > 0) {
          var todayStart = new Date(now);
          todayStart.setHours(0, 0, 0, 0);
          var todayStartMs = todayStart.getTime();
          var todayRuns = (rec.runs || []).filter(function (r) { return r.startedAt >= todayStartMs; });
          if (todayRuns.length >= rec.intervalEnd.count) {
            skipTrigger = true;
          }
        }
        if (skipTrigger) {
          if (rec.cron) {
            rec.nextRunAt = nextRunTime(rec.cron, now);
          }
          save();
          continue;
        }
      }

      var previous = JSON.parse(JSON.stringify(rec));
      var prepared = prepareTrigger ? prepareTrigger(rec) : null;
      if (prepared && prepared.ok === false) { delete lastTriggeredMinute[triggerKey]; continue; }
      scheduledRuns.prepareRecord(rec, prepared);
      rec.lastRunAt = now;
      if (rec.scheduleRule) scheduleRule.recordScheduleStartState(rec, now);
      if (rec.cron || rec.scheduleRule) {
        rec.nextRunAt = nextRecordRunTime(rec, now);
        if (rec.scheduleRule && !rec.nextRunAt) rec.enabled = false;
      } else {
        rec.nextRunAt = null;
        rec.enabled = false;
      }
      if (!save()) {
        recordRevision.restoreRecord(rec, previous);
        delete lastTriggeredMinute[triggerKey];
        continue;
      }
      if (onChange) onChange(records);

      console.log("[loop-registry] Triggering scheduled loop: " + rec.name + " (" + rec.id + ")");
      if (onTrigger) {
        try { onTrigger(rec, prepared); } catch (e) {
          console.error("[loop-registry] Trigger error:", e.message);
        }
      }
    }
  }

  function register(data) {
    var rec = {
      id: data.id || ("loop_" + Date.now() + "_" + require("crypto").randomBytes(3).toString("hex")),
      name: data.name || "Untitled",
      task: data.task || "",
      cron: data.cron || null,
      enabled: (data.cron || data.scheduleRule) ? (data.enabled !== false) : false,
      maxIterations: (data.maxIterations >= 1) ? data.maxIterations : 20,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastRunAt: null,
      lastRunResult: null,
      nextRunAt: null,
      description: data.description || "",
      date: data.date || null,
      time: data.time || null,
      allDay: data.allDay !== undefined ? data.allDay : true,
      linkedTaskId: data.linkedTaskId || null,
      craftingSessionId: data.craftingSessionId || null,
      source: data.source || null,
      color: data.color || null,
      recurrenceEnd: data.recurrenceEnd || null,
      mode: data.mode || "loop",
      prompt: data.prompt || null,
      ownerId: data.ownerId || null,
      ownerName: data.ownerName || null,
      sessionId: data.sessionId || null,
      createdViaScheduledTasks: data.createdViaScheduledTasks === true,
      skipIfRunning: data.skipIfRunning !== undefined ? data.skipIfRunning : true,
      intervalEnd: data.intervalEnd || null,
      scheduleRule: data.scheduleRule || null,
      scheduleStartCount: Number(data.scheduleStartCount || 0),
      scheduleDateStartCounts: data.scheduleDateStartCounts && typeof data.scheduleDateStartCounts === "object" ? Object.assign({}, data.scheduleDateStartCounts) : {},
      scheduleIdentity: data.scheduleIdentity || crypto.randomUUID(),
      scheduleEpoch: Number.isInteger(data.scheduleEpoch) && data.scheduleEpoch > 0 ? data.scheduleEpoch : 1,
      execution: data.execution || null,
      activeRun: data.activeRun || null,
      runs: [],
    };
    if (rec.createdViaScheduledTasks && data.maxIterations === undefined) delete rec.maxIterations;
    if ((rec.cron || rec.scheduleRule) && rec.enabled) {
      rec.nextRunAt = nextRecordRunTime(rec);
    } else if (!rec.cron && !rec.scheduleRule && rec.date && rec.time && rec.source === "schedule") {
      rec.nextRunAt = oneOffRunTime(rec);
      rec.enabled = true;
    }
    records.push(rec);
    if (!save()) {
      records.pop();
      return null;
    }
    if (!notifyOrRollback(function () { records.pop(); })) return null;
    return rec;
  }

  function update(id, data) {
    var rec = getById(id);
    if (!rec) return null;
    var previous = Object.assign({}, rec);

    if (data.name !== undefined) rec.name = data.name;
    if (data.cron !== undefined) rec.cron = data.cron;
    if (data.enabled !== undefined) rec.enabled = data.enabled;
    if (data.maxIterations !== undefined) rec.maxIterations = data.maxIterations;
    if (data.date !== undefined) rec.date = data.date;
    if (data.time !== undefined) rec.time = data.time;
    if (data.recurrenceEnd !== undefined) rec.recurrenceEnd = data.recurrenceEnd;
    if (data.mode !== undefined) rec.mode = data.mode;
    if (data.prompt !== undefined) rec.prompt = data.prompt;
    if (data.task !== undefined) rec.task = data.task;
    if (data.ownerId !== undefined) rec.ownerId = data.ownerId;
    if (data.ownerName !== undefined) rec.ownerName = data.ownerName;
    if (data.sessionId !== undefined) rec.sessionId = data.sessionId;
    if (data.description !== undefined) rec.description = data.description;
    if (data.color !== undefined) rec.color = data.color;
    if (data.allDay !== undefined) rec.allDay = data.allDay;
    if (data.linkedTaskId !== undefined) rec.linkedTaskId = data.linkedTaskId;
    if (data.source !== undefined) rec.source = data.source;
    if (data.skipIfRunning !== undefined) rec.skipIfRunning = data.skipIfRunning;
    if (data.intervalEnd !== undefined) rec.intervalEnd = data.intervalEnd;
    if (data.scheduleRule !== undefined) rec.scheduleRule = data.scheduleRule;
    if (data.execution !== undefined) rec.execution = data.execution;
    rec.updatedAt = recordRevision.nextRevision(rec);
    if ((rec.cron || rec.scheduleRule) && rec.enabled) {
      rec.nextRunAt = nextRecordRunTime(rec);
    } else if (!rec.cron && !rec.scheduleRule && rec.enabled && rec.date && rec.time && rec.source === "schedule") {
      rec.nextRunAt = oneOffRunTime(rec);
    } else {
      rec.nextRunAt = null;
    }
    var sameTiming = previous.cron === rec.cron && previous.date === rec.date && previous.time === rec.time && JSON.stringify(previous.scheduleRule || null) === JSON.stringify(rec.scheduleRule || null);
    if (!sameTiming || previous.enabled !== rec.enabled) rec.scheduleEpoch = Math.max(1, Number(previous.scheduleEpoch) || 1) + 1;
    if (previous.enabled && rec.enabled && previous.nextRunAt && sameTiming) rec.nextRunAt = previous.nextRunAt;
    if (data.ownerId) { delete rec.needsOwner; delete rec.setupRequired; }

    if (!save()) {
      recordRevision.restoreRecord(rec, previous);
      return null;
    }
    if (!notifyOrRollback(function () { recordRevision.restoreRecord(rec, previous); })) return null;
    return rec;
  }

  function updateRecord(id, data) {
    var rec = getById(id);
    if (!rec) return null;
    var previous = Object.assign({}, rec);
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      rec[keys[i]] = data[keys[i]];
    }
    rec.updatedAt = recordRevision.nextRevision(previous);
    if (!save()) {
      recordRevision.restoreRecord(rec, previous);
      return null;
    }
    if (!notifyOrRollback(function () { recordRevision.restoreRecord(rec, previous); })) return null;
    return rec;
  }

  function remove(id) {
    var idx = -1;
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return false;
    var removed = records.splice(idx, 1)[0];
    if (!save()) { records.splice(idx, 0, removed); return false; }
    if (!notifyOrRollback(function () { records.splice(idx, 0, removed); })) return false;
    return true;
  }

  function toggleEnabled(id) {
    var rec = getById(id);
    var oneOffSchedule = rec && !rec.cron && !rec.scheduleRule && rec.date && rec.time && rec.source === "schedule";
    if (!rec || (!rec.cron && !rec.scheduleRule && !oneOffSchedule)) return null;
    var previous = Object.assign({}, rec);
    rec.enabled = !rec.enabled;
    rec.scheduleEpoch = Math.max(1, Number(rec.scheduleEpoch) || 1) + 1;
    rec.updatedAt = recordRevision.nextRevision(rec);
    if (!rec.enabled) {
      rec.nextRunAt = null;
    } else if (rec.cron || rec.scheduleRule) {
      rec.nextRunAt = nextRecordRunTime(rec);
    } else {
      rec.nextRunAt = oneOffRunTime(rec);
    }
    if (!save()) {
      recordRevision.restoreRecord(rec, previous);
      return null;
    }
    if (!notifyOrRollback(function () { recordRevision.restoreRecord(rec, previous); })) return null;
    return rec;
  }

  function getAll() {
    return records;
  }

  function getById(id) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) return records[i];
    }
    return null;
  }

  function getScheduled() {
    var result = [];
    for (var i = 0; i < records.length; i++) {
      if (records[i].cron || records[i].scheduleRule) result.push(records[i]);
    }
    return result;
  }

  durableOccurrence = attachLoopRegistryOccurrence({
    getById: getById,
    save: save,
    changed: function () { if (onChange) onChange(records); },
    lastSaveError: function () { return lastSaveError; },
    prepareTrigger: prepareTrigger,
    onTrigger: onTrigger,
    scheduledRuns: scheduledRuns,
    scheduleRule: scheduleRule,
    nextRecordRunTime: nextRecordRunTime,
  });

  return {
    load: load,
    save: save,
    startTimer: startTimer,
    stopTimer: stopTimer,
    tick: tick,
    register: register,
    update: update,
    updateRecord: updateRecord,
    remove: remove,
    toggleEnabled: toggleEnabled,
    normalizeDurableOccurrence: durableOccurrence.normalize,
    markNeedsOwner: durableOccurrence.markNeedsOwner,
    prepareDurableOccurrence: durableOccurrence.prepare,
    triggerDurableOccurrence: durableOccurrence.trigger,
    completeDurableOccurrence: durableOccurrence.complete,
    reconcileDurableOccurrence: durableOccurrence.reconcile,
    recordRun: scheduledRuns.recordLegacy,
    beginRun: scheduledRuns.begin,
    updateRun: scheduledRuns.update,
    completeRun: scheduledRuns.complete,
    getAll: getAll,
    getById: getById,
    getScheduled: getScheduled,
    getLastSaveError: function () { return lastSaveError; },
    nextRunTime: nextRunTime,
  };
}

module.exports = { createLoopRegistry: createLoopRegistry };
