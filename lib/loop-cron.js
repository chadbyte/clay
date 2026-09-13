var validateCron = require("./schedule-validation").validateCron;

function parseField(field, min, max) {
  var values = [];
  var parts = field.split(",");
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (part.indexOf("/") !== -1) {
      var slash = part.split("/");
      var step = parseInt(slash[1], 10);
      var range = slash[0] === "*" ? [min, max] : slash[0].split("-").map(function (value) { return parseInt(value, 10); });
      if (range.length === 1) range.push(range[0]);
      for (var stepped = range[0]; stepped <= range[1]; stepped += step) values.push(stepped);
    } else if (part === "*") {
      for (var any = min; any <= max; any++) values.push(any);
    } else if (part.indexOf("-") !== -1) {
      var bounds = part.split("-");
      for (var ranged = parseInt(bounds[0], 10); ranged <= parseInt(bounds[1], 10); ranged++) values.push(ranged);
    } else values.push(parseInt(part, 10));
  }
  return values;
}

function parse(expr) {
  if (!validateCron(expr).ok) return null;
  var fields = expr.trim().split(/\s+/);
  return { minutes: parseField(fields[0], 0, 59), hours: parseField(fields[1], 0, 23), daysOfMonth: parseField(fields[2], 1, 31), months: parseField(fields[3], 1, 12), daysOfWeek: parseField(fields[4], 0, 6) };
}

function matches(parsed, date) {
  return parsed.minutes.indexOf(date.getMinutes()) !== -1 && parsed.hours.indexOf(date.getHours()) !== -1 &&
    parsed.daysOfMonth.indexOf(date.getDate()) !== -1 && parsed.months.indexOf(date.getMonth() + 1) !== -1 && parsed.daysOfWeek.indexOf(date.getDay()) !== -1;
}

function nextRunTime(expr, after) {
  var parsed = parse(expr);
  if (!parsed) return null;
  var date = new Date(after || Date.now());
  date.setSeconds(0, 0); date.setMinutes(date.getMinutes() + 1);
  for (var i = 0; i < 366 * 24 * 60; i++) {
    if (matches(parsed, date)) return date.getTime();
    date.setMinutes(date.getMinutes() + 1);
  }
  return null;
}

module.exports = { nextRunTime: nextRunTime };
