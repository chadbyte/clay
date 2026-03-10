/**
 * Loop Registry — unified storage for all Ralph Loops (one-off + scheduled).
 *
 * Stores loop records in ~/.clay/loops/{encodedCwd}.jsonl
 * Each record represents a job defined via clay-ralph (PROMPT.md + JUDGE.md).
 * Records with a `cron` field are checked every 30s and auto-triggered.
 * Records without cron are one-off (standard Ralph Loop behavior).
 */

var fs = require("fs");
var path = require("path");
var { CONFIG_DIR } = require("./config");
var { encodeCwd } = require("./utils");

// --- Cron parser (5-field: minute hour day-of-month month day-of-week) ---

function parseCronField(field, min, max) {
  var values = [];
  var parts = field.split(",");
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();

    // wildcard with step: */N
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

    // wildcard
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

// --- Loop Registry factory ---

function createLoopRegistry(opts) {
  var cwd = opts.cwd;
  var onTrigger = opts.onTrigger;
  var onChange = opts.onChange;

  var encoded = encodeCwd(cwd);
  var registryDir = path.join(CONFIG_DIR, "loops");
  var registryPath = path.join(registryDir, encoded + ".jsonl");

  var records = [];
  var timerId = null;
  var CHECK_INTERVAL = 30 * 1000;
  var lastTriggeredMinute = {};

  // --- Persistence (JSONL) ---

  function load() {
    try {
      var raw = fs.readFileSync(registryPath, "utf8");
      var lines = raw.trim().split("\n");
      records = [];
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        try {
          var rec = JSON.parse(lines[i]);
          // Recalculate nextRunAt for scheduled records
          if (rec.cron && rec.enabled) {
            rec.nextRunAt = nextRunTime(rec.cron);
          } else if (!rec.cron && rec.enabled && rec.date && rec.time && rec.source === "schedule") {
            // One-off: recalculate from date+time
            var dtP = rec.date.split("-");
            var tmP = rec.time.split(":");
            var runD = new Date(parseInt(dtP[0], 10), parseInt(dtP[1], 10) - 1, parseInt(dtP[2], 10), parseInt(tmP[0], 10), parseInt(tmP[1], 10), 0);
            rec.nextRunAt = runD.getTime();
          }
          records.push(rec);
        } catch (e) {
          // skip malformed line
        }
      }
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
    } catch (e) {
      console.error("[loop-registry] Failed to save:", e.message);
    }
  }

  // --- Timer (scheduled loops only) ---

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

      // Avoid double-trigger within same minute
      var triggerKey = rec.id + "_" + nowMinuteKey;
      if (lastTriggeredMinute[triggerKey]) continue;
      lastTriggeredMinute[triggerKey] = true;

      // Clean old trigger keys
      var keys = Object.keys(lastTriggeredMinute);
      for (var k = 0; k < keys.length; k++) {
        var keyParts = keys[k].split("_");
        var keyMinute = parseInt(keyParts[keyParts.length - 1], 10);
        if (keyMinute < nowMinuteKey - 1) {
          delete lastTriggeredMinute[keys[k]];
        }
      }

      // Update nextRunAt
      rec.lastRunAt = now;
      if (rec.cron) {
        rec.nextRunAt = nextRunTime(rec.cron, now);
      } else {
        // One-off schedule: disable after firing
        rec.nextRunAt = null;
        rec.enabled = false;
      }
      save();
      if (onChange) onChange(records);

      console.log("[loop-registry] Triggering scheduled loop: " + rec.name + " (" + rec.id + ")");
      if (onTrigger) {
        try { onTrigger(rec); } catch (e) {
          console.error("[loop-registry] Trigger error:", e.message);
        }
      }
    }
  }

  // --- CRUD ---

  function register(data) {
    var rec = {
      id: data.id || ("loop_" + Date.now() + "_" + require("crypto").randomBytes(3).toString("hex")),
      name: data.name || "Untitled",
      task: data.task || "",
      cron: data.cron || null,
      enabled: data.cron ? (data.enabled !== false) : false,
      maxIterations: data.maxIterations || 20,
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
      runs: [],
    };
    if (rec.cron && rec.enabled) {
      rec.nextRunAt = nextRunTime(rec.cron);
    } else if (!rec.cron && rec.date && rec.time && rec.source === "schedule") {
      // One-off schedule: compute nextRunAt from date + time
      var dtParts = rec.date.split("-");
      var tmParts = rec.time.split(":");
      var runDate = new Date(parseInt(dtParts[0], 10), parseInt(dtParts[1], 10) - 1, parseInt(dtParts[2], 10), parseInt(tmParts[0], 10), parseInt(tmParts[1], 10), 0);
      rec.nextRunAt = runDate.getTime();
      rec.enabled = true;
    }
    records.push(rec);
    save();
    if (onChange) onChange(records);
    return rec;
  }

  function update(id, data) {
    var rec = getById(id);
    if (!rec) return null;

    if (data.name !== undefined) rec.name = data.name;
    if (data.cron !== undefined) rec.cron = data.cron;
    if (data.enabled !== undefined) rec.enabled = data.enabled;
    if (data.maxIterations !== undefined) rec.maxIterations = data.maxIterations;
    if (data.date !== undefined) rec.date = data.date;
    if (data.recurrenceEnd !== undefined) rec.recurrenceEnd = data.recurrenceEnd;
    rec.updatedAt = Date.now();
    if (rec.cron && rec.enabled) {
      rec.nextRunAt = nextRunTime(rec.cron);
    } else if (!rec.cron && rec.date && rec.time && rec.source === "schedule") {
      var dtP2 = rec.date.split("-");
      var tmP2 = rec.time.split(":");
      var runD2 = new Date(parseInt(dtP2[0], 10), parseInt(dtP2[1], 10) - 1, parseInt(dtP2[2], 10), parseInt(tmP2[0], 10), parseInt(tmP2[1], 10), 0);
      rec.nextRunAt = runD2.getTime();
      rec.enabled = true;
    } else {
      rec.nextRunAt = null;
    }

    save();
    if (onChange) onChange(records);
    return rec;
  }

  function updateRecord(id, data) {
    var rec = getById(id);
    if (!rec) return null;
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      rec[keys[i]] = data[keys[i]];
    }
    save();
    if (onChange) onChange(records);
    return rec;
  }

  function remove(id) {
    var idx = -1;
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return false;
    records.splice(idx, 1);
    save();
    if (onChange) onChange(records);
    return true;
  }

  function toggleEnabled(id) {
    var rec = getById(id);
    if (!rec || !rec.cron) return null; // only toggle scheduled loops
    rec.enabled = !rec.enabled;
    rec.updatedAt = Date.now();
    rec.nextRunAt = rec.enabled ? nextRunTime(rec.cron) : null;
    save();
    if (onChange) onChange(records);
    return rec;
  }

  function recordRun(id, result) {
    var rec = getById(id);
    if (!rec) return;
    rec.lastRunAt = result.startedAt || Date.now();
    rec.lastRunResult = result.reason || null;
    rec.runs.push({
      startedAt: result.startedAt || rec.lastRunAt,
      finishedAt: Date.now(),
      result: result.reason || "unknown",
      iterations: result.iterations || 0,
    });
    // Keep only last 20 run entries
    if (rec.runs.length > 20) {
      rec.runs = rec.runs.slice(-20);
    }
    save();
    if (onChange) onChange(records);
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
      if (records[i].cron) result.push(records[i]);
    }
    return result;
  }

  return {
    load: load,
    save: save,
    startTimer: startTimer,
    stopTimer: stopTimer,
    register: register,
    update: update,
    updateRecord: updateRecord,
    remove: remove,
    toggleEnabled: toggleEnabled,
    recordRun: recordRun,
    getAll: getAll,
    getById: getById,
    getScheduled: getScheduled,
    nextRunTime: nextRunTime,
  };
}

module.exports = { createLoopRegistry: createLoopRegistry };
