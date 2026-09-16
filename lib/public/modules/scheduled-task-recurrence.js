export function isStrictCron(value) {
  if (typeof value !== "string") return false;
  var ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  var fields = value.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  function validNumber(text, range) { return /^\d+$/.test(text) && Number(text) >= range[0] && Number(text) <= range[1]; }
  function validPart(part, range) {
    var step = part.split("/");
    if (step.length > 2 || (step.length === 2 && (!/^\d+$/.test(step[1]) || Number(step[1]) < 1))) return false;
    var base = step[0];
    if (base === "*") return true;
    var span = base.split("-");
    if (span.length === 2) return validNumber(span[0], range) && validNumber(span[1], range) && Number(span[0]) <= Number(span[1]);
    return span.length === 1 && validNumber(base, range);
  }
  for (var i = 0; i < fields.length; i++) {
    var parts = fields[i].split(",");
    for (var j = 0; j < parts.length; j++) if (!validPart(parts[j], ranges[i])) return false;
  }
  return true;
}

export function humanRecurrence(cron) {
  if (!isStrictCron(cron)) return "Invalid schedule";
  var fields = cron.trim().split(/\s+/);
  var minute = fields[0];
  var hour = fields[1];
  var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var weekdayText = "";
  if (fields[4] === "1-5") weekdayText = "Mon–Fri";
  else if (fields[4] === "0,6" || fields[4] === "6,0") weekdayText = "weekends";
  else if (/^[0-6](,[0-6])*$/.test(fields[4])) {
    weekdayText = fields[4].split(",").map(function (day) { return dayNames[Number(day)]; }).join(", ");
  } else if (/^[0-6]$/.test(fields[4])) weekdayText = dayNames[Number(fields[4])];
  var weekday = weekdayText ? " · " + weekdayText : (fields[4] === "*" ? "" : " · " + fields[4]);
  if (minute.indexOf("*/") === 0 && hour === "*" && fields[2] === "*" && fields[3] === "*") return "Every " + minute.slice(2) + " minutes" + weekday;
  if (minute === "0" && hour.indexOf("*/") === 0 && fields[2] === "*" && fields[3] === "*") return "Every " + hour.slice(2) + " hours" + weekday;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && fields[2] === "*" && fields[3] === "*" && fields[4] === "*") {
    var h = Number(hour); var suffix = h >= 12 ? "pm" : "am"; var displayHour = h % 12 || 12;
    return "Daily at " + displayHour + ":" + String(Number(minute)).padStart(2, "0") + suffix;
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && fields[2] === "*" && fields[3] === "*" && fields[4] === "1-5") return "Weekdays at " + String(Number(hour)).padStart(2, "0") + ":" + String(Number(minute)).padStart(2, "0");
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && fields[2] === "*" && fields[3] === "*" && fields[4] !== "*") return "Weekly on " + (weekdayText || fields[4]) + " at " + String(Number(hour)).padStart(2, "0") + ":" + String(Number(minute)).padStart(2, "0");
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(fields[2]) && fields[3] === "*" && fields[4] === "*") return "Monthly on day " + fields[2] + " at " + String(Number(hour)).padStart(2, "0") + ":" + String(Number(minute)).padStart(2, "0");
  return "Cron · " + cron;
}
