var FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
var scheduleRule = require("./schedule-rule");

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

function validateExecution(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!value || typeof value !== "object" || !value.driver || !value.worker) return { ok: false, error: "Choose both a Driver and a Split Worker runtime." };
  function role(input, label) {
    var vendor = boundedText(input && input.vendor, 40);
    var model = boundedText(input && input.model, 200);
    if (!vendor) return { ok: false, error: "Choose a " + label + " vendor." };
    if (!model) return { ok: false, error: "Choose a " + label + " model." };
    return { ok: true, value: { vendor: vendor, model: model, effort: boundedText(input.effort, 40) || null } };
  }
  var driver = role(value.driver, "Driver"); if (!driver.ok) return driver;
  var worker = role(value.worker, "Split Worker"); if (!worker.ok) return worker;
  return { ok: true, value: { driver: driver.value, worker: worker.value } };
}

function validateTaskInput(input) {
  var data = input && typeof input === "object" ? input : {};
  var cron = validateCron(data.cron);
  if (!cron.ok) return cron;
  var name = boundedText(data.name, 120);
  var instructions = boundedText(data.instructions || data.task || data.prompt, 20000);
  if (!name) return { ok: false, error: "Task name is required." };
  if (!instructions) return { ok: false, error: "Task instructions are required." };
  var execution = validateExecution(data.execution); if (!execution.ok) return execution;
  return {
    ok: true,
    value: {
      name: name,
      instructions: instructions,
      cron: cron.cron,
      execution: execution.value,
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
  var execution = validateExecution(data.execution); if (!execution.ok) return execution;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: "A valid date and time are required." };
  var parts = date.split("-");
  var parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (parsed.getFullYear() !== Number(parts[0]) || parsed.getMonth() !== Number(parts[1]) - 1 || parsed.getDate() !== Number(parts[2])) return { ok: false, error: "A valid date is required." };
  return { ok: true, value: {
    name: name, instructions: instructions, cron: null, date: date, time: time,
    execution: execution.value,
    skipIfRunning: data.skipIfRunning !== false,
  } };
}

function validateRuleTaskInput(input) {
  var data = input && typeof input === "object" ? input : {};
  var name = boundedText(data.name, 120);
  var instructions = boundedText(data.instructions || data.task || data.prompt, 20000);
  if (!name) return { ok: false, error: "Task name is required." };
  if (!instructions) return { ok: false, error: "Task instructions are required." };
  var execution = validateExecution(data.execution); if (!execution.ok) return execution;
  var rule = scheduleRule.validateScheduleRule(data.scheduleRule);
  if (!rule.ok) return rule;
  return { ok: true, value: {
    name: name, instructions: instructions, cron: null,
    date: rule.value.anchorDate, time: rule.value.time, scheduleRule: rule.value,
    recurrenceEnd: rule.value.recurrenceEnd, intervalEnd: rule.value.interval && rule.value.interval.end || null,
    execution: execution.value,
    skipIfRunning: data.skipIfRunning !== false,
  } };
}

function validateScheduledTaskInput(input) {
  if (input && input.scheduleRule) return validateRuleTaskInput(input);
  return input && input.cron === null ? validateOneOffTaskInput(input) : validateTaskInput(input);
}

module.exports = { validateCron: validateCron, validateExecution: validateExecution, validateTaskInput: validateTaskInput, validateOneOffTaskInput: validateOneOffTaskInput, validateRuleTaskInput: validateRuleTaskInput, validateScheduledTaskInput: validateScheduledTaskInput };
