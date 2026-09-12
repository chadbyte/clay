var FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

function validateNumber(value, min, max) {
  if (!/^\d+$/.test(value)) return false;
  var number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max;
}

function validatePart(part, min, max) {
  var stepParts = part.split("/");
  if (stepParts.length > 2) return false;
  if (stepParts.length === 2) {
    if (!/^\d+$/.test(stepParts[1]) || Number(stepParts[1]) < 1) return false;
    part = stepParts[0];
  }
  if (part === "*") return true;
  if (part.indexOf("-") !== -1) {
    var range = part.split("-");
    return range.length === 2 && validateNumber(range[0], min, max) && validateNumber(range[1], min, max) && Number(range[0]) <= Number(range[1]);
  }
  return validateNumber(part, min, max);
}

function validateCron(expression) {
  if (typeof expression !== "string" || expression.length > 120) return { ok: false, error: "Schedule must be a five-field cron expression." };
  var fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return { ok: false, error: "Schedule must contain minute, hour, day, month, and weekday fields." };
  for (var i = 0; i < fields.length; i++) {
    var parts = fields[i].split(",");
    if (!parts.length) return { ok: false, error: "Schedule contains an empty field." };
    for (var j = 0; j < parts.length; j++) {
      if (!validatePart(parts[j], FIELD_RANGES[i][0], FIELD_RANGES[i][1])) {
        return { ok: false, error: "Schedule contains an invalid value in field " + (i + 1) + "." };
      }
    }
  }
  return { ok: true, cron: fields.join(" ") };
}

function boundedText(value, max) {
  return typeof value === "string" ? value.trim().substring(0, max) : "";
}

function validateTaskInput(input) {
  var data = input && typeof input === "object" ? input : {};
  var cron = validateCron(data.cron);
  if (!cron.ok) return cron;
  var name = boundedText(data.name, 120);
  var instructions = boundedText(data.instructions || data.task || data.prompt, 20000);
  if (!name) return { ok: false, error: "Task name is required." };
  if (!instructions) return { ok: false, error: "Task instructions are required." };
  return {
    ok: true,
    value: {
      name: name,
      instructions: instructions,
      cron: cron.cron,
      maxIterations: Math.max(1, Math.min(100, Math.floor(Number(data.maxIterations) || 1))),
      skipIfRunning: data.skipIfRunning !== false,
    },
  };
}

function validateOneOffTaskInput(input) {
  var data = input && typeof input === "object" ? input : {};
  var name = boundedText(data.name, 120);
  var instructions = boundedText(data.instructions || data.task || data.prompt, 20000);
  var date = boundedText(data.date, 10);
  var time = boundedText(data.time, 5);
  if (!name) return { ok: false, error: "Task name is required." };
  if (!instructions) return { ok: false, error: "Task instructions are required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: "A valid date and time are required." };
  var parts = date.split("-");
  var parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (parsed.getFullYear() !== Number(parts[0]) || parsed.getMonth() !== Number(parts[1]) - 1 || parsed.getDate() !== Number(parts[2])) return { ok: false, error: "A valid date is required." };
  return { ok: true, value: {
    name: name, instructions: instructions, cron: null, date: date, time: time,
    maxIterations: Math.max(1, Math.min(100, Math.floor(Number(data.maxIterations) || 1))),
    skipIfRunning: data.skipIfRunning !== false,
  } };
}

module.exports = { validateCron: validateCron, validateTaskInput: validateTaskInput, validateOneOffTaskInput: validateOneOffTaskInput };
