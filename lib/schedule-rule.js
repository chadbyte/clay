var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
var TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
var UNITS = { day: true, week: true, month: true, year: true };

function validDate(value) {
  var match = typeof value === "string" && value.match(DATE_PATTERN);
  if (!match) return false;
  var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

function boundedInteger(value, min, max) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function validateEnd(value, interval) {
  if (value == null || value.type === "never" || value.type === "allday") return { ok: true, value: null };
  if (!value || typeof value !== "object") return { ok: false, error: "Schedule ending is invalid." };
  if (value.type === "until") {
    var field = interval ? "time" : "date";
    var valid = interval ? TIME_PATTERN.test(value[field] || "") : validDate(value[field]);
    return valid ? { ok: true, value: { type: "until", [field]: value[field] } } : { ok: false, error: "Schedule ending " + field + " is invalid." };
  }
  if (value.type === "after") {
    var count = boundedInteger(value.count, 1, 999);
    return count ? { ok: true, value: { type: "after", count: count } } : { ok: false, error: "Schedule ending count must be between 1 and 999." };
  }
  return { ok: false, error: "Schedule ending type is invalid." };
}

function validateScheduleRule(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Schedule rule is required." };
  if (input.version !== 1 || input.timezone !== "server-local") return { ok: false, error: "Schedule rule version or timezone is invalid." };
  if (!validDate(input.anchorDate) || !TIME_PATTERN.test(input.time || "")) return { ok: false, error: "A valid schedule date and time are required." };
  var recurrence = null;
  if (input.recurrence != null) {
    var source = input.recurrence;
    var every = boundedInteger(source.every, 1, 99);
    if (!source || !Object.prototype.hasOwnProperty.call(UNITS, source.unit) || !every) return { ok: false, error: "Repeat cadence must be every 1 to 99 days, weeks, months, or years." };
    recurrence = { every: every, unit: source.unit };
    if (source.unit === "week") {
      var seen = {};
      var weekdays = Array.isArray(source.weekdays) ? source.weekdays : [];
      if (weekdays.length > 7) return { ok: false, error: "Weekly repeat has too many weekdays." };
      recurrence.weekdays = [];
      for (var weekdayIndex = 0; weekdayIndex < weekdays.length; weekdayIndex++) {
        var day = weekdays[weekdayIndex];
        var number = boundedInteger(day, 0, 6);
        if (number === null || seen[number]) return { ok: false, error: "Weekly repeat weekdays are invalid." };
        seen[number] = true;
        recurrence.weekdays.push(number);
      }
      recurrence.weekdays.sort(function (a, b) { return a - b; });
      if (!recurrence.weekdays.length) return { ok: false, error: "Choose at least one weekday for a weekly repeat." };
    }
  }
  var repeatEnd = validateEnd(input.recurrenceEnd, false);
  if (!repeatEnd.ok) return repeatEnd;
  if (!recurrence && repeatEnd.value) return { ok: false, error: "Repeat ending requires a repeat cadence." };
  var interval = null;
  if (input.interval != null) {
    var intervalEvery = boundedInteger(input.interval.every, 1, input.interval.unit === "minute" ? 999 : 23);
    if (!intervalEvery || (input.interval.unit !== "minute" && input.interval.unit !== "hour")) return { ok: false, error: "Interval must be every 1 to 999 minutes or 1 to 23 hours." };
    var intervalEnd = validateEnd(input.interval.end, true);
    if (!intervalEnd.ok) return intervalEnd;
    interval = { every: intervalEvery, unit: input.interval.unit, end: intervalEnd.value };
    if (interval.end && interval.end.type === "until" && interval.end.time <= input.time) return { ok: false, error: "Interval stop time must be after the selected start time." };
  }
  return { ok: true, value: { version: 1, timezone: "server-local", anchorDate: input.anchorDate, time: input.time, recurrence: recurrence, recurrenceEnd: repeatEnd.value, interval: interval } };
}

function dateKey(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function localDate(value) {
  var parts = value.split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
}

function calendarDays(from, to) {
  return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);
}

function activeDate(rule, date) {
  var anchor = localDate(rule.anchorDate);
  var days = calendarDays(anchor, date);
  if (days < 0) return false;
  if (!rule.recurrence) return days === 0;
  var recurrence = rule.recurrence;
  if (recurrence.unit === "day") return days % recurrence.every === 0;
  if (recurrence.unit === "week") {
    var anchorWeek = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
    var dateWeek = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
    return Math.floor(calendarDays(anchorWeek, dateWeek) / 7) % recurrence.every === 0 && recurrence.weekdays.indexOf(date.getDay()) !== -1;
  }
  var months = (date.getFullYear() - anchor.getFullYear()) * 12 + date.getMonth() - anchor.getMonth();
  if (recurrence.unit === "month") return months >= 0 && months % recurrence.every === 0 && date.getDate() === anchor.getDate();
  return date.getFullYear() >= anchor.getFullYear() && (date.getFullYear() - anchor.getFullYear()) % recurrence.every === 0 && date.getMonth() === anchor.getMonth() && date.getDate() === anchor.getDate();
}

function nextScheduleRuleTime(input, after, runs, state) {
  var checked = validateScheduleRule(input);
  if (!checked.ok) return null;
  var rule = checked.value;
  var cursor = new Date(Number(after == null ? Date.now() : after));
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  var anchor = localDate(rule.anchorDate);
  var endDate = rule.recurrenceEnd && rule.recurrenceEnd.type === "until" ? localDate(rule.recurrenceEnd.date) : null;
  var startCount = state && Number(state.startCount) || 0;
  if (!state || state.startCount == null) startCount = (runs || []).length;
  if (rule.recurrenceEnd && rule.recurrenceEnd.type === "after" && startCount >= rule.recurrenceEnd.count) return null;
  for (var dayOffset = Math.max(0, calendarDays(anchor, cursor)); dayOffset <= 366 * 100; dayOffset++) {
    var date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dayOffset, 0, 0, 0, 0);
    if (endDate && date > endDate) return null;
    if (!activeDate(rule, date)) continue;
    var key = dateKey(date);
    var time = rule.time.split(":");
    var startMinute = Number(time[0]) * 60 + Number(time[1]);
    var step = rule.interval ? rule.interval.every * (rule.interval.unit === "hour" ? 60 : 1) : 1440;
    var lastMinute = rule.interval ? 1439 : startMinute;
    if (rule.interval && rule.interval.end && rule.interval.end.type === "until") {
      var stop = rule.interval.end.time.split(":");
      lastMinute = Number(stop[0]) * 60 + Number(stop[1]) - 1;
    }
    var runCount = 0;
    if (rule.interval && rule.interval.end && rule.interval.end.type === "after") {
      var startMs = date.getTime();
      var endMs = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
      runCount = state && state.dateStartCounts && Number(state.dateStartCounts[key]) || (runs || []).filter(function (run) { return Number(run.startedAt) >= startMs && Number(run.startedAt) < endMs; }).length;
      if (runCount >= rule.interval.end.count) continue;
    }
    for (var minute = startMinute; minute <= lastMinute; minute += step) {
      if (rule.interval && rule.interval.end && rule.interval.end.type === "after" && runCount >= rule.interval.end.count) break;
      var candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minute / 60), minute % 60, 0, 0);
      if (candidate >= cursor) return candidate.getTime();
    }
  }
  return null;
}

function recordScheduleStartState(record, startedAt) {
  var date = new Date(startedAt);
  var key = dateKey(date);
  record.scheduleStartCount = Number(record.scheduleStartCount || 0) + 1;
  if (!record.scheduleDateStartCounts || typeof record.scheduleDateStartCounts !== "object") record.scheduleDateStartCounts = {};
  record.scheduleDateStartCounts[key] = Number(record.scheduleDateStartCounts[key] || 0) + 1;
}

module.exports = { validateScheduleRule: validateScheduleRule, nextScheduleRuleTime: nextScheduleRuleTime, recordScheduleStartState: recordScheduleStartState, activeDate: activeDate };
