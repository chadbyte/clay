import { isStrictCron, humanRecurrence } from './scheduled-task-recurrence.js';
import { humanScheduleRule, scheduleRuleState, serializeScheduleRule } from './scheduled-task-schedule-rule.js';
import { readExecutionRuntime, renderExecutionRuntime } from './scheduled-task-engine.js';

var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(value) { return String(value).padStart(2, "0"); }

function defaultOnce() {
  var date = new Date();
  date.setMinutes(0, 0, 0); date.setHours(date.getHours() + 1);
  return { date: date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()), time: pad(date.getHours()) + ":00" };
}

export function editorFields(data, mode) {
  var saveLabel = mode === "edit" ? "Save changes" : "Create task";
  var days = DAY_NAMES.map(function (day, index) { return '<label><input data-field="weekday" type="checkbox" value="' + index + '" aria-label="' + day + '"><span title="' + day + '">' + day.slice(0, 1) + '</span></label>'; }).join("");
  return '<label>Name<input data-field="name" maxlength="120" autocomplete="off"></label>' +
    '<label>Instructions<textarea data-field="instructions" maxlength="20000"></textarea></label>' +
    '<fieldset class="scheduled-task-schedule-card"><legend>Schedule</legend>' +
      '<div class="scheduled-task-date-time"><label>Date<input data-field="date" type="date"></label><label>Time<input data-field="time" type="time"></label></div>' +
      '<details class="scheduled-task-accordion" data-accordion="repeat"><summary><span><strong>Repeat</strong><small data-summary="repeat">Does not repeat</small></span></summary><div class="scheduled-task-accordion-body">' +
        '<label class="scheduled-task-checkbox"><input data-field="repeatEnabled" type="checkbox"><span>Repeat this task</span></label>' +
        '<div class="scheduled-task-every"><span>Every</span><input data-field="repeatEvery" aria-label="Repeat every" type="number" min="1" max="99"><select data-field="repeatUnit" aria-label="Repeat unit"><option value="day">day</option><option value="week">week</option><option value="month">month</option><option value="year">year</option></select></div>' +
        '<div data-repeat="week"><span class="scheduled-task-control-label">On</span><div class="scheduled-task-weekdays">' + days + '</div></div>' +
        '<div class="scheduled-task-ending"><span>Ends</span><select data-field="repeatEndType" aria-label="Repeat ends"><option value="never">Never</option><option value="until">Until date</option><option value="after">After occurrences</option></select><input data-field="repeatEndDate" aria-label="Repeat until date" type="date"><span data-end-label="repeat-count"><input data-field="repeatEndCount" aria-label="Repeat occurrence count" type="number" min="1" max="999"> occurrences</span></div>' +
      '</div></details>' +
      '<details class="scheduled-task-accordion" data-accordion="interval"><summary><span><strong>Interval</strong><small data-summary="interval">Run once at selected time</small></span></summary><div class="scheduled-task-accordion-body">' +
        '<label class="scheduled-task-checkbox"><input data-field="intervalEnabled" type="checkbox"><span>Run repeatedly within each active day</span></label>' +
        '<div class="scheduled-task-every"><span>Every</span><input data-field="intervalEvery" aria-label="Interval every" type="number" min="1" max="999"><select data-field="intervalUnit" aria-label="Interval unit"><option value="minute">minutes</option><option value="hour">hours</option></select></div>' +
        '<div class="scheduled-task-ending"><span>Ends</span><select data-field="intervalEndType" aria-label="Interval ends"><option value="allday">All day</option><option value="after">Stop after runs</option><option value="until">Stop at time</option></select><span data-end-label="interval-count"><input data-field="intervalEndCount" aria-label="Interval run count" type="number" min="1" max="999"> runs</span><input data-field="intervalEndTime" aria-label="Interval stop time" type="time"></div>' +
      '</div></details>' +
      '<details class="scheduled-task-advanced" data-accordion="custom"><summary>Advanced custom schedule</summary><div class="scheduled-task-advanced-body"><label class="scheduled-task-checkbox"><input data-field="advanced" type="checkbox"><span>Use a five-field cron expression</span></label><label data-advanced-cron>Custom cron<input data-field="customCron" class="scheduled-task-cron" autocomplete="off" spellcheck="false"><small>Existing custom expressions remain unchanged unless edited here.</small></label></div></details>' +
      '<div class="scheduled-task-schedule-summary"><strong data-schedule-summary></strong><span>Times use the server local timezone: <span data-timezone></span>.</span></div>' +
    '</fieldset>' +
    '<fieldset class="scheduled-task-runtime"><legend>Execution pair</legend><div class="scheduled-task-runtime-row"><strong>Driver</strong><select data-runtime="driver-vendor" aria-label="Driver vendor"></select><select data-runtime="driver-model" aria-label="Driver model"></select><select data-runtime="driver-effort" aria-label="Driver effort"></select></div><div class="scheduled-task-runtime-row"><strong>Split Worker</strong><select data-runtime="worker-vendor" aria-label="Split Worker vendor"></select><select data-runtime="worker-model" aria-label="Split Worker model"></select><select data-runtime="worker-effort" aria-label="Split Worker effort"></select></div><label class="scheduled-task-checkbox"><input data-field="skipIfRunning" type="checkbox"><span>Skip a scheduled start while this task already has an active run</span><small>When off, overlapping starts are combined into one queued run.</small></label></fieldset>' +
    '<p class="scheduled-task-form-error" role="alert"></p><div class="scheduled-task-form-actions"><button type="button" data-action="' + (mode === "edit" ? "edit-cancel" : "draft-cancel") + '">Cancel</button><button type="button" class="primary" data-action="' + (mode === "edit" ? "edit-save" : "draft-save") + '">' + saveLabel + '</button></div>';
}

function readSchedule(root) {
  return {
    originalCron: root.dataset.originalCron || "", scheduleDirty: root.dataset.scheduleDirty === "true",
    advanced: root.querySelector('[data-field="advanced"]').checked, customCron: root.querySelector('[data-field="customCron"]').value.trim(), date: root.querySelector('[data-field="date"]').value, time: root.querySelector('[data-field="time"]').value,
    repeatEnabled: root.querySelector('[data-field="repeatEnabled"]').checked, repeatEvery: Number(root.querySelector('[data-field="repeatEvery"]').value), repeatUnit: root.querySelector('[data-field="repeatUnit"]').value,
    weekdays: Array.from(root.querySelectorAll('[data-field="weekday"]:checked')).map(function (input) { return Number(input.value); }), repeatEndType: root.querySelector('[data-field="repeatEndType"]').value, repeatEndDate: root.querySelector('[data-field="repeatEndDate"]').value, repeatEndCount: Number(root.querySelector('[data-field="repeatEndCount"]').value),
    intervalEnabled: root.querySelector('[data-field="intervalEnabled"]').checked, intervalEvery: Number(root.querySelector('[data-field="intervalEvery"]').value), intervalUnit: root.querySelector('[data-field="intervalUnit"]').value, intervalEndType: root.querySelector('[data-field="intervalEndType"]').value, intervalEndCount: Number(root.querySelector('[data-field="intervalEndCount"]').value), intervalEndTime: root.querySelector('[data-field="intervalEndTime"]').value,
  };
}

function setValue(root, field, value) { root.querySelector('[data-field="' + field + '"]').value = value; }

function normalizeEditorRoot(root) {
  if (!root || !root.matches) return root;
  if (root.matches(".scheduled-task-draft-form, .scheduled-task-edit-form")) return root;
  return root.querySelector(".scheduled-task-draft-form, .scheduled-task-edit-form") || root;
}

function updateVisibility(root) {
  var state = readSchedule(root); var serialized = serializeScheduleRule(state);
  root.querySelector('[data-repeat="week"]').classList.toggle("hidden", !state.repeatEnabled || state.repeatUnit !== "week");
  root.querySelector('[data-field="repeatEndDate"]').classList.toggle("hidden", !state.repeatEnabled || state.repeatEndType !== "until");
  root.querySelector('[data-end-label="repeat-count"]').classList.toggle("hidden", !state.repeatEnabled || state.repeatEndType !== "after");
  root.querySelector('[data-end-label="interval-count"]').classList.toggle("hidden", !state.intervalEnabled || state.intervalEndType !== "after");
  root.querySelector('[data-field="intervalEndTime"]').classList.toggle("hidden", !state.intervalEnabled || state.intervalEndType !== "until");
  root.querySelector('[data-advanced-cron]').classList.toggle("hidden", !state.advanced);
  root.querySelector('[data-summary="repeat"]').textContent = state.advanced ? "Advanced custom expression" : (state.repeatEnabled ? humanScheduleRule(serialized.scheduleRule).split(" · every ")[0] : "Does not repeat");
  root.querySelector('[data-summary="interval"]').textContent = state.intervalEnabled ? "Every " + state.intervalEvery + " " + state.intervalUnit + (state.intervalEvery === 1 ? "" : "s") : "Run once at selected time";
  root.querySelector('[data-schedule-summary]').textContent = state.advanced ? (isStrictCron(state.customCron) ? humanRecurrence(state.customCron) : "Complete the advanced custom expression") : humanScheduleRule(serialized.scheduleRule);
}

export function fillEditor(root, data, timeZone, runtimeState) {
  root = normalizeEditorRoot(root);
  var defaults = defaultOnce(); var state = data._scheduleState || scheduleRuleState(data, defaults);
  root.dataset.originalCron = state.originalCron || ""; root.dataset.scheduleDirty = state.scheduleDirty ? "true" : "false";
  setValue(root, "name", data.name || ""); setValue(root, "instructions", data.instructions || data.task || data.prompt || "");
  var fields = ["customCron", "date", "time", "repeatEvery", "repeatUnit", "repeatEndType", "repeatEndDate", "repeatEndCount", "intervalEvery", "intervalUnit", "intervalEndType", "intervalEndCount", "intervalEndTime"];
  for (var i = 0; i < fields.length; i++) setValue(root, fields[i], state[fields[i]]);
  root.querySelector('[data-field="advanced"]').checked = state.advanced; root.querySelector('[data-field="repeatEnabled"]').checked = state.repeatEnabled; root.querySelector('[data-field="intervalEnabled"]').checked = state.intervalEnabled;
  var weekdayInputs = root.querySelectorAll('[data-field="weekday"]'); for (var wi = 0; wi < weekdayInputs.length; wi++) weekdayInputs[wi].checked = state.weekdays.indexOf(Number(weekdayInputs[wi].value)) !== -1;
  renderExecutionRuntime(root, runtimeState || {}, data.execution); root.querySelector('[data-field="skipIfRunning"]').checked = data.skipIfRunning !== false;
  var instructions = root.querySelector('[data-field="instructions"]'); if (data.linkedTaskId) { instructions.readOnly = true; instructions.setAttribute("aria-description", "Instructions are managed by the linked task."); }
  root.querySelector('[data-timezone]').textContent = timeZone || "server local";
  var accordions = root.querySelectorAll("details[data-accordion]");
  for (var ai = 0; ai < accordions.length; ai++) accordions[ai].open = Array.isArray(data._openAccordions) ? data._openAccordions.indexOf(accordions[ai].dataset.accordion) !== -1 : (state.advanced && accordions[ai].dataset.accordion === "custom");
  updateVisibility(root);
}

export function readEditor(root) {
  var scheduleState = readSchedule(root);
  var schedule = scheduleState.originalCron && !scheduleState.scheduleDirty ? { cron: scheduleState.originalCron, date: scheduleState.date, time: scheduleState.time, scheduleRule: null } : serializeScheduleRule(scheduleState);
  var openAccordions = Array.from(root.querySelectorAll("details[data-accordion][open]")).map(function (details) { return details.dataset.accordion; });
  return Object.assign({ name: root.querySelector('[data-field="name"]').value.trim(), instructions: root.querySelector('[data-field="instructions"]').value.trim(), execution: readExecutionRuntime(root), skipIfRunning: root.querySelector('[data-field="skipIfRunning"]').checked, _openAccordions: openAccordions, _scheduleState: scheduleState }, schedule);
}

export function serverEditorData(data) { var copy = Object.assign({}, data); delete copy._scheduleState; delete copy._advancedOpen; delete copy._openAccordions; return copy; }

export function validateEditor(root, data) {
  var error = ""; var rule = data.scheduleRule;
  if (!data.name) error = "Enter a task name."; else if (!data.instructions) error = "Enter task instructions.";
  else if (!rule && !isStrictCron(data.cron)) error = "Enter a valid five-field custom cron expression.";
  else if (rule && (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time))) error = "Choose a valid date and time.";
  else if (rule && rule.recurrence && (!Number.isInteger(rule.recurrence.every) || rule.recurrence.every < 1 || rule.recurrence.every > 99)) error = "Repeat cadence must be between 1 and 99.";
  else if (rule && rule.recurrence && rule.recurrence.unit === "week" && !rule.recurrence.weekdays.length) error = "Choose at least one weekday.";
  else if (rule && rule.recurrenceEnd && rule.recurrenceEnd.type === "after" && (!Number.isInteger(rule.recurrenceEnd.count) || rule.recurrenceEnd.count < 1 || rule.recurrenceEnd.count > 999)) error = "Occurrence count must be between 1 and 999.";
  else if (rule && rule.interval && (!Number.isInteger(rule.interval.every) || rule.interval.every < 1 || rule.interval.every > 999)) error = "Interval must be between 1 and 999.";
  else if (rule && rule.interval && rule.interval.unit === "hour" && rule.interval.every > 23) error = "Hour intervals must be between 1 and 23.";
  else if (rule && rule.interval && rule.interval.end && rule.interval.end.type === "after" && (!Number.isInteger(rule.interval.end.count) || rule.interval.end.count < 1 || rule.interval.end.count > 999)) error = "Run count must be between 1 and 999.";
  else if (rule && rule.interval && rule.interval.end && rule.interval.end.type === "until" && rule.interval.end.time <= data.time) error = "Stop time must be after the selected time.";
  else if (!data.execution || !data.execution.driver.vendor || !data.execution.driver.model || !data.execution.worker.vendor || !data.execution.worker.model) error = "Choose a model for both the Driver and Split Worker.";
  else if ((root.querySelector('[data-runtime="driver-effort"]').options.length > 1 && !data.execution.driver.effort) || (root.querySelector('[data-runtime="worker-effort"]').options.length > 1 && !data.execution.worker.effort)) error = "Choose a reasoning effort for each runtime that supports it.";
  root.querySelector(".scheduled-task-form-error").textContent = error; return !error;
}

export function handleEditorScheduleChange(target) {
  var root = target && target.closest && (target.closest(".scheduled-task-draft-form") || target.closest(".scheduled-task-edit-form"));
  if (!root || !target.dataset || !target.dataset.field) return false;
  if (["date", "time", "repeatEnabled", "repeatEvery", "repeatUnit", "weekday", "repeatEndType", "repeatEndDate", "repeatEndCount", "intervalEnabled", "intervalEvery", "intervalUnit", "intervalEndType", "intervalEndCount", "intervalEndTime", "advanced", "customCron"].indexOf(target.dataset.field) !== -1) root.dataset.scheduleDirty = "true";
  if (target.dataset.field === "date" && root.querySelector('[data-field="repeatEndDate"]').value === "") root.querySelector('[data-field="repeatEndDate"]').value = target.value;
  updateVisibility(root); return true;
}

export { scheduleRuleState, serializeScheduleRule };
