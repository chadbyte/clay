var fs = require("fs");
var path = require("path");
var { CONFIG_DIR } = require("./config");
var { encodeCwd } = require("./utils");
var validateCron = require("./schedule-validation").validateCron;
var scheduleRule = require("./schedule-rule");
var recordRevision = require("./record-revision");
var createScheduledRunState = require("./scheduled-run-state").createScheduledRunState;
function parseCronField(field, min, max) {
  var values = [];
  var parts = field.split(",");
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (part.indexOf("/") !== -1) {
      var slashParts = part.split("/");
      var step = parseInt(slashParts[1], 10);
      var rangeStr = slashParts[0];
      var rangeMin = min;
      var rangeMax = max;
      if (rangeStr !== "*") {
        var rp = rangeStr.split("-");
        rangeMin = parseInt(rp[0], 10);
        rangeMax = rp.length > 1 ? parseInt(rp[1], 10) : rangeMin;
      }
      for (var v = rangeMin; v <= rangeMax; v += step) {
        values.push(v);
      }
      continue;
    }
    if (part === "*") {
      for (var v = min; v <= max; v++) {
        values.push(v);
      }
      continue;
    }
    // range: N-M
    if (part.indexOf("-") !== -1) {
      var rangeParts = part.split("-");
      var from = parseInt(rangeParts[0], 10);
      var to = parseInt(rangeParts[1], 10);
      for (var v = from; v <= to; v++) {
        values.push(v);
      }
      continue;
    }
    // single value
    values.push(parseInt(part, 10));
  }
  return values;
}

function parseCron(expr) {
  if (!validateCron(expr).ok) return null;
  var fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  return {
    minutes: parseCronField(fields[0], 0, 59),
    hours: parseCronField(fields[1], 0, 23),
    daysOfMonth: parseCronField(fields[2], 1, 31),
    months: parseCronField(fields[3], 1, 12),
    daysOfWeek: parseCronField(fields[4], 0, 6),
  };
}

function cronMatches(parsed, date) {
  var minute = date.getMinutes();
  var hour = date.getHours();
  var dayOfMonth = date.getDate();
  var month = date.getMonth() + 1;
  var dayOfWeek = date.getDay();
  return (
    parsed.minutes.indexOf(minute) !== -1 &&
    parsed.hours.indexOf(hour) !== -1 &&
    parsed.daysOfMonth.indexOf(dayOfMonth) !== -1 &&
    parsed.months.indexOf(month) !== -1 &&
    parsed.daysOfWeek.indexOf(dayOfWeek) !== -1
  );
}

/**
 * Calculate next run time from a cron expression after a given date.
 * Brute-force: check each minute for up to 366 days.
 */
function nextRunTime(cronExpr, after) {
  var parsed = parseCron(cronExpr);
  if (!parsed) return null;
  var d = new Date(after || Date.now());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  var limit = 366 * 24 * 60;
  for (var i = 0; i < limit; i++) {
    if (cronMatches(parsed, d)) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

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
  });

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
          if ((rec.cron || rec.scheduleRule) && rec.enabled) {
            rec.nextRunAt = nextRecordRunTime(rec);
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
    if (onChange) onChange(records);
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
    if (!previous.execution && rec.execution && previous.enabled && previous.nextRunAt && previous.nextRunAt <= Date.now() && sameTiming) rec.nextRunAt = previous.nextRunAt;

    if (!save()) {
      recordRevision.restoreRecord(rec, previous);
      return null;
    }
    if (onChange) onChange(records);
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
    if (onChange) onChange(records);
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
    if (onChange) onChange(records);
    return true;
  }

  function toggleEnabled(id) {
    var rec = getById(id);
    var oneOffSchedule = rec && !rec.cron && !rec.scheduleRule && rec.date && rec.time && rec.source === "schedule";
    if (!rec || (!rec.cron && !rec.scheduleRule && !oneOffSchedule)) return null;
    var previous = Object.assign({}, rec);
    rec.enabled = !rec.enabled;
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
    if (onChange) onChange(records);
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
