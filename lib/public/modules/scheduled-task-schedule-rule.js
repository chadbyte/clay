var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(value) { return String(value).padStart(2, "0"); }

function detectedInterval(field, max) {
  if (/^\*\/\d+$/.test(field)) {
    var wildcardStep = Number(field.slice(2));
    return wildcardStep > 0 && max % wildcardStep === 0 ? { every: wildcardStep, offset: 0 } : null;
  }
  if (!/^\d+(,\d+)+$/.test(field)) return null;
  var values = field.split(",").map(Number);
  if (values[0] < 0 || values[values.length - 1] >= max) return null;
  var step = values[1] - values[0];
  if (step < 1) return null;
  for (var i = 1; i < values.length; i++) if (values[i] - values[i - 1] !== step) return null;
  return values[values.length - 1] + step === max + values[0] ? { every: step, offset: values[0] } : null;
}

function parsedWeekdays(field) {
  if (/^[0-6](,[0-6])*$/.test(field)) return field.split(",").map(Number);
  var range = field.match(/^([0-6])-([0-6])$/);
  if (!range || Number(range[1]) > Number(range[2])) return null;
  var days = [];
  for (var day = Number(range[1]); day <= Number(range[2]); day++) days.push(day);
  return days;
}

function cronState(record, defaults) {
  var fields = record.cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  var minuteInterval = fields[1] === "*" && fields[2] === "*" && fields[3] === "*" ? detectedInterval(fields[0], 60) : null;
  var hourInterval = /^\d+$/.test(fields[0]) && fields[2] === "*" && fields[3] === "*" ? detectedInterval(fields[1], 24) : null;
  if (hourInterval && hourInterval.every > 23) hourInterval = null;
  var minute = /^\d+$/.test(fields[0]) ? Number(fields[0]) : (minuteInterval ? minuteInterval.offset : 0);
  var hour = /^\d+$/.test(fields[1]) ? Number(fields[1]) : (hourInterval ? hourInterval.offset : 0);
  var weekdays = fields[4] === "*" ? null : parsedWeekdays(fields[4]);
  if (fields[4] !== "*" && !weekdays) return null;
  var recurrence = null;
  if (fields[2] === "*" && fields[3] === "*" && fields[4] === "*") recurrence = { every: 1, unit: "day" };
  else if (fields[2] === "*" && fields[3] === "*" && weekdays) recurrence = { every: 1, unit: "week", weekdays: weekdays };
  else if (/^\d+$/.test(fields[2]) && fields[3] === "*" && fields[4] === "*") recurrence = { every: 1, unit: "month" };
  else if (/^\d+$/.test(fields[2]) && /^\d+$/.test(fields[3]) && fields[4] === "*") recurrence = { every: 1, unit: "year" };
  if ((minuteInterval || hourInterval) && record.recurrenceEnd && record.recurrenceEnd.type === "until" && record.recurrenceEnd.date === record.date) recurrence = null;
  if ((!recurrence && !minuteInterval && !hourInterval) || (!minuteInterval && !hourInterval && (!/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])))) return null;
  var date = record.date || defaults.date;
  if (recurrence && recurrence.unit === "month") date = date.slice(0, 8) + pad(fields[2]);
  if (recurrence && recurrence.unit === "year") date = date.slice(0, 5) + pad(fields[3]) + "-" + pad(fields[2]);
  return { version: 1, timezone: "server-local", anchorDate: date, time: pad(hour) + ":" + pad(minute), recurrence: recurrence, recurrenceEnd: recurrence ? record.recurrenceEnd || null : null, interval: minuteInterval || hourInterval ? { every: (minuteInterval || hourInterval).every, unit: minuteInterval ? "minute" : "hour", end: record.intervalEnd || null } : null };
}

export function humanScheduleRule(rule) {
  if (!rule || !rule.anchorDate || !rule.time) return "Incomplete schedule";
  var repeat = rule.recurrence;
  var text = "Does not repeat";
  if (repeat) {
    var unit = repeat.unit + (repeat.every === 1 ? "" : "s");
    text = "Every " + (repeat.every === 1 ? "" : repeat.every + " ") + unit;
    if (repeat.unit === "week" && repeat.weekdays && repeat.weekdays.length) text += " · " + repeat.weekdays.map(function (day) { return DAY_NAMES[day]; }).join(", ");
  }
  if (rule.interval) text += " · every " + rule.interval.every + " " + rule.interval.unit + (rule.interval.every === 1 ? "" : "s");
  text += " · " + rule.anchorDate + " at " + rule.time;
  if (rule.recurrenceEnd && rule.recurrenceEnd.type === "until") text += " · until " + rule.recurrenceEnd.date;
  if (rule.recurrenceEnd && rule.recurrenceEnd.type === "after") text += " · after " + rule.recurrenceEnd.count + " scheduled starts";
  if (rule.interval && rule.interval.end && rule.interval.end.type === "until") text += " · stop at " + rule.interval.end.time;
  if (rule.interval && rule.interval.end && rule.interval.end.type === "after") text += " · stop after " + rule.interval.end.count + " runs per day";
  return text;
}

export function scheduleRuleState(record, defaults) {
  var parsedCron = record && record.cron ? cronState(record, defaults) : null;
  var rule = record && record.scheduleRule || parsedCron;
  if (!rule) return {
    advanced: !!(record && record.cron), customCron: record && record.cron || "", date: record && record.date || defaults.date, time: record && record.time || defaults.time,
    repeatEnabled: false, repeatEvery: 1, repeatUnit: "week", weekdays: [new Date((record && record.date || defaults.date) + "T00:00:00").getDay()], repeatEndType: "never", repeatEndDate: defaults.date, repeatEndCount: 10,
    intervalEnabled: false, intervalEvery: 10, intervalUnit: "minute", intervalEndType: "allday", intervalEndCount: 5, intervalEndTime: "18:00",
  };
  return {
    advanced: false, customCron: record && record.cron || "", originalCron: parsedCron && record.cron || "", date: rule.anchorDate, time: rule.time,
    repeatEnabled: !!rule.recurrence, repeatEvery: rule.recurrence && rule.recurrence.every || 1, repeatUnit: rule.recurrence && rule.recurrence.unit || "week", weekdays: rule.recurrence && rule.recurrence.weekdays || [new Date(rule.anchorDate + "T00:00:00").getDay()],
    repeatEndType: rule.recurrenceEnd && rule.recurrenceEnd.type || "never", repeatEndDate: rule.recurrenceEnd && rule.recurrenceEnd.date || rule.anchorDate, repeatEndCount: rule.recurrenceEnd && rule.recurrenceEnd.count || 10,
    intervalEnabled: !!rule.interval, intervalEvery: rule.interval && rule.interval.every || 10, intervalUnit: rule.interval && rule.interval.unit || "minute", intervalEndType: rule.interval && rule.interval.end && rule.interval.end.type || "allday", intervalEndCount: rule.interval && rule.interval.end && rule.interval.end.count || 5, intervalEndTime: rule.interval && rule.interval.end && rule.interval.end.time || "18:00",
  };
}

export function serializeScheduleRule(state) {
  if (state.advanced) return { cron: state.customCron || "", date: null, time: null, scheduleRule: null };
  var recurrence = state.repeatEnabled ? { every: Number(state.repeatEvery), unit: state.repeatUnit } : null;
  if (recurrence && recurrence.unit === "week") recurrence.weekdays = state.weekdays.slice().sort(function (a, b) { return a - b; });
  var recurrenceEnd = null;
  if (state.repeatEnabled && state.repeatEndType === "until") recurrenceEnd = { type: "until", date: state.repeatEndDate };
  if (state.repeatEnabled && state.repeatEndType === "after") recurrenceEnd = { type: "after", count: Number(state.repeatEndCount) };
  var interval = null;
  if (state.intervalEnabled) {
    interval = { every: Number(state.intervalEvery), unit: state.intervalUnit, end: null };
    if (state.intervalEndType === "until") interval.end = { type: "until", time: state.intervalEndTime };
    if (state.intervalEndType === "after") interval.end = { type: "after", count: Number(state.intervalEndCount) };
  }
  return { cron: null, date: state.date, time: state.time, scheduleRule: { version: 1, timezone: "server-local", anchorDate: state.date, time: state.time, recurrence: recurrence, recurrenceEnd: recurrenceEnd, interval: interval } };
}

export function legacyScheduleRule(state) {
  var recurrence = null;
  if (state.repeatType === "daily") recurrence = { every: 1, unit: "day" };
  else if (state.repeatType === "weekly") recurrence = { every: 1, unit: "week", weekdays: [state.anchorWeekday] };
  else if (state.repeatType === "biweekly") recurrence = { every: 2, unit: "week", weekdays: [state.anchorWeekday] };
  else if (state.repeatType === "monthly") recurrence = { every: 1, unit: "month" };
  else if (state.repeatType === "yearly") recurrence = { every: 1, unit: "year" };
  else if (state.repeatType === "weekdays") recurrence = { every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] };
  else if (state.repeatType === "custom" && ["day", "week", "month", "year"].indexOf(state.repeatUnit) !== -1) {
    recurrence = { every: state.repeatEvery, unit: state.repeatUnit };
    if (state.repeatUnit === "week") recurrence.weekdays = state.weekdays.length ? state.weekdays : [state.anchorWeekday];
  }
  if (!recurrence && !state.interval) return null;
  return { version: 1, timezone: "server-local", anchorDate: state.anchorDate, time: state.time, recurrence: recurrence, recurrenceEnd: state.recurrenceEnd, interval: state.interval };
}
