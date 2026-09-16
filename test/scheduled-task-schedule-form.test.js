var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var execFileSync = require("node:child_process").execFileSync;
var pathToFileURL = require("node:url").pathToFileURL;
var createLoopRegistry = require("../lib/scheduler").createLoopRegistry;
var attachLoop = require("../lib/project-loop").attachLoop;
var attachScheduledTasks = require("../lib/project-scheduled-tasks").attachScheduledTasks;
var createScheduledTaskRecords = require("../lib/scheduled-task-records").createScheduledTaskRecords;
var EXECUTION = { driver: { vendor: "claude", model: "fable", effort: "medium" }, worker: { vendor: "codex", model: "gpt-5.6-sol", effort: "medium" } };
var validation = require("../lib/schedule-validation");
var scheduleRule = require("../lib/schedule-rule");

function serviceFixture(t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-schedule-form-"));
  var registryPath = path.join(cwd, "registry", "tasks.jsonl");
  var registry = createLoopRegistry({ cwd: cwd, registryPath: registryPath });
  var session = { localId: 7, mode: "gui", ownerId: "owner-1", history: [], scheduledTaskDraft: null, _sdkQueryGeneration: 0 };
  var sent = [];
  var sm = {
    sessions: new Map([[7, session]]), appendToSessionFile: function () {}, saveSessionFile: function () {},
    sendToSession: function (target, message) { sent.push(message); },
  };
  var service = attachScheduledTasks({
    cwd: cwd, sm: sm, registry: registry, isMate: false,
    getSessionForWs: function () { return session; }, canUseSession: function () { return true; }, canAccess: function () { return true; }, hasPermission: function () { return true; },
    isDriverOperatedSession: function () { return false; }, sendTo: function (ws, message) { sent.push(message); },
  });
  var ws = { _clayUser: { id: "owner-1", displayName: "Owner" } };
  t.after(function () { fs.rmSync(cwd, { recursive: true, force: true }); });
  return { cwd: cwd, registryPath: registryPath, registry: registry, session: session, sent: sent, service: service, ws: ws };
}

test("manual schedule draft creates and persists a real one-off record", function (t) {
  var f = serviceFixture(t);
  f.service.handleMessage(f.ws, { type: "scheduled_task_manual_start", sessionId: 7, requestId: "manual-once" });
  var interviewState = f.sent.filter(function (message) { return message.type === "scheduled_task_interview_state"; }).pop();
  assert.equal(interviewState.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone || null);
  var draft = f.session.scheduledTaskDraft;
  f.service.handleMessage(f.ws, {
    type: "scheduled_task_create", sessionId: 7, requestId: "create-once", proposalId: draft.id, version: draft.version,
    data: { name: "One review", instructions: "Review the release once.", cron: null, date: "2099-05-06", time: "14:30", execution: EXECUTION, skipIfRunning: true },
  });
  var result = f.sent.filter(function (message) { return message.type === "scheduled_task_action_result"; }).pop();
  assert.equal(result.ok, true);
  var record = f.registry.getAll()[0];
  assert.equal(record.source, "schedule");
  assert.equal(record.cron, null);
  assert.equal(record.date, "2099-05-06");
  assert.equal(record.time, "14:30");
  assert.equal(record.enabled, true);
  var persisted = JSON.parse(fs.readFileSync(f.registryPath, "utf8").trim());
  assert.equal(persisted.id, record.id);
  assert.equal(persisted.source, "schedule");
});

test("a created standalone one-off never falls back to the legacy Loop executor", function (t) {
  var f = serviceFixture(t);
  f.service.handleMessage(f.ws, { type: "scheduled_task_manual_start", sessionId: 7, requestId: "manual-trigger" });
  var draft = f.session.scheduledTaskDraft;
  f.service.handleMessage(f.ws, {
    type: "scheduled_task_create", sessionId: 7, requestId: "create-trigger", proposalId: draft.id, version: draft.version,
    data: { name: "Triggered review", instructions: "Run the standalone prompt.", cron: null, date: "2099-05-06", time: "14:30", execution: EXECUTION, skipIfRunning: true },
  });
  var created = f.registry.getAll()[0];
  execFileSync("git", ["init", "-q"], { cwd: f.cwd });
  execFileSync("git", ["-c", "user.name=Clay Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "test fixture"], { cwd: f.cwd });
  var originalNow = Date.now;
  Date.now = function () { return new Date("2100-01-01T00:00:00Z").getTime(); };
  var started = [];
  var sent = [];
  var sessions = new Map();
  var sm = {
    sessions: sessions, setResolveLoopInfo: function () {}, saveSessionFile: function () {}, broadcastSessionList: function () {}, appendToSessionFile: function () {},
    createSession: function (options) { var session = { localId: sessions.size + 100, ownerId: options.ownerId, history: [] }; sessions.set(session.localId, session); return session; },
  };
  var loop;
  try {
    loop = attachLoop({
      cwd: f.cwd, slug: "fixture", sm: sm, loopRegistryPath: f.registryPath, loopStatePath: path.join(f.cwd, "loop-state.json"),
      sdk: { startQuery: function (session, prompt) { started.push({ session: session, prompt: prompt }); session.onQueryComplete(session); } },
      send: function (message) { sent.push(message); }, sendTo: function () {}, sendToSession: function () {}, getHubSchedules: function () { return []; },
      getLinuxUserForSession: function () { return null; }, onProcessingChanged: function () {}, hydrateImageRefs: function (value) { return value; },
      authorizeScheduledRun: function () { return true; },
    });
  } finally {
    Date.now = originalNow;
  }
  t.after(function () { if (loop) loop.stopTimer(); });
  assert.equal(started.length, 0);
  assert.equal(sent.some(function (message) { return message.type === "schedule_run_started" && message.recordId === created.id; }), false);
  var triggered = loop.loopRegistry.getById(created.id);
  assert.equal(triggered.enabled, true);
  assert.equal(triggered.runs.length, 0);

  var linkedId = "linked-task-files";
  var linkedDir = path.join(f.cwd, ".claude", "loops", linkedId);
  fs.mkdirSync(linkedDir, { recursive: true });
  fs.writeFileSync(path.join(linkedDir, "PROMPT.md"), "Run the linked prompt.\n");
  fs.writeFileSync(path.join(linkedDir, "LOOP.json"), JSON.stringify({ loopMode: "simple", maxIterations: 1 }));
  var linked = loop.loopRegistry.register({ id: "linked-schedule", name: "Linked", task: "Linked", cron: "0 9 * * *", enabled: true, source: "schedule", linkedTaskId: linkedId, ownerId: "owner-1", maxIterations: 1 });
  var linkedRecords = createScheduledTaskRecords({ cwd: f.cwd, registry: loop.loopRegistry, canUseSession: function () { return true; } });
  var linkedEdit = linkedRecords.update({ ownerId: "owner-1" }, linked.id, linked.updatedAt, { cron: "15 10 * * *" });
  assert.equal(linkedEdit.ok, true);
  assert.equal(linkedEdit.record.source, "schedule");
  var persistedRecords = fs.readFileSync(f.registryPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(persistedRecords.find(function (record) { return record.id === linked.id; }).source, "schedule");
  loop.loopRegistry.getById(linked.id).nextRunAt = Date.now() - 1;
  loop.loopRegistry.tick();
  assert.equal(started.length, 0, "an existing calendar record without pair setup stays pending");
  var legacyDir = path.join(f.cwd, ".claude", "loops", "unrelated-legacy");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "PROMPT.md"), "Run the linked prompt.\n");
  fs.writeFileSync(path.join(legacyDir, "LOOP.json"), JSON.stringify({ loopMode: "simple", maxIterations: 1 }));
  var legacy = loop.loopRegistry.register({ id: "unrelated-legacy", name: "Legacy", task: "Legacy", cron: "0 9 * * *", enabled: true, linkedTaskId: linkedId, maxIterations: 1 });
  legacy.nextRunAt = Date.now() - 1;
  loop.loopRegistry.tick();
  assert.equal(started.length, 1);
  assert.equal(started[0].prompt, "Run the linked prompt.\n");
  assert.equal(loop.loopState.loopFilesId, "unrelated-legacy");
});

test("an assisted interview can propose a validated one-off draft", async function (t) {
  var f = serviceFixture(t);
  var tools = f.service.getToolDefs(f.session);
  await tools[0].handler({});
  var proposed = JSON.parse((await tools[1].handler({ name: "One-off review", instructions: "Review once.", cron: null, date: "2099-08-09", time: "16:45" })).content[0].text);
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.draft.cron, null);
  assert.equal(proposed.draft.date, "2099-08-09");
  assert.equal(proposed.draft.time, "16:45");
});

test("manual rule creation persists through the real registry and paused edits round-trip", function (t) {
  var f = serviceFixture(t);
  f.service.handleMessage(f.ws, { type: "scheduled_task_manual_start", sessionId: 7, requestId: "manual-rule" });
  var draft = f.session.scheduledTaskDraft;
  var rule = { version: 1, timezone: "server-local", anchorDate: "2099-01-05", time: "09:30", recurrence: { every: 2, unit: "week", weekdays: [1, 3] }, recurrenceEnd: { type: "after", count: 4 }, interval: { every: 2, unit: "hour", end: { type: "after", count: 3 } } };
  f.service.handleMessage(f.ws, { type: "scheduled_task_create", sessionId: 7, requestId: "create-rule", proposalId: draft.id, version: draft.version, data: { name: "Anchored review", instructions: "Run the review.", cron: null, date: rule.anchorDate, time: rule.time, scheduleRule: rule, execution: EXECUTION, skipIfRunning: false } });
  var record = f.registry.getAll()[0];
  assert.deepEqual(record.scheduleRule, rule);
  assert.deepEqual(record.execution, EXECUTION);
  assert.equal(record.skipIfRunning, false);
  assert.ok(record.nextRunAt);
  f.registry.toggleEnabled(record.id);
  var records = createScheduledTaskRecords({ cwd: f.cwd, registry: f.registry, canUseSession: function () { return true; } });
  var editedRule = Object.assign({}, rule, { recurrenceEnd: { type: "until", date: "2099-03-01" } });
  var edited = records.update({ ownerId: "owner-1" }, record.id, f.registry.getById(record.id).updatedAt, { scheduleRule: editedRule, cron: null, date: editedRule.anchorDate, time: editedRule.time });
  assert.equal(edited.ok, true);
  assert.equal(f.registry.getById(record.id).enabled, false);
  assert.equal(f.registry.getById(record.id).nextRunAt, null);
  assert.deepEqual(edited.record.scheduleRule, editedRule);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.registryPath, "utf8").trim()).scheduleRule, editedRule);
});

test("schedule rules serialize anchored cadence and preserve advanced cron exactly", async function () {
  var modulePath = pathToFileURL(path.join(__dirname, "../lib/public/modules/scheduled-task-form.js")).href + "?test=" + Date.now();
  var form = await import(modulePath);
  var ruleModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/scheduled-task-schedule-rule.js")).href + "?test=" + Date.now());
  var state = { advanced: false, customCron: "", date: "2099-04-03", time: "11:20", repeatEnabled: true, repeatEvery: 2, repeatUnit: "week", weekdays: [5, 1, 3], repeatEndType: "after", repeatEndDate: "2099-06-01", repeatEndCount: 7, intervalEnabled: true, intervalEvery: 45, intervalUnit: "minute", intervalEndType: "until", intervalEndCount: 5, intervalEndTime: "18:00" };
  var serialized = form.serializeScheduleRule(state);
  assert.equal(serialized.cron, null);
  assert.deepEqual(serialized.scheduleRule.recurrence, { every: 2, unit: "week", weekdays: [1, 3, 5] });
  assert.deepEqual(serialized.scheduleRule.recurrenceEnd, { type: "after", count: 7 });
  assert.deepEqual(serialized.scheduleRule.interval, { every: 45, unit: "minute", end: { type: "until", time: "18:00" } });
  assert.match(ruleModule.humanScheduleRule(serialized.scheduleRule), /2099-04-03 at 11:20/);
  assert.match(ruleModule.humanScheduleRule(serialized.scheduleRule), /after 7 scheduled starts/);
  assert.match(ruleModule.humanScheduleRule(serialized.scheduleRule), /stop at 18:00/);
  var legacyBiweekly = ruleModule.legacyScheduleRule({ anchorDate: "2099-04-03", time: "11:20", anchorWeekday: 5, repeatType: "custom", repeatEvery: 2, repeatUnit: "week", weekdays: [1, 5], recurrenceEnd: null, interval: null });
  assert.deepEqual(legacyBiweekly.recurrence, { every: 2, unit: "week", weekdays: [1, 5] });
  var constrained = "*/17 6-18 * 1,6 1-5";
  var advanced = form.scheduleRuleState({ cron: constrained }, { date: "2099-04-03", time: "11:20" });
  assert.equal(advanced.advanced, true);
  assert.equal(form.serializeScheduleRule(advanced).cron, constrained);
  var dirtySource = { name: "Dirty", cron: null, scheduleRule: serialized.scheduleRule, _advancedOpen: true };
  var dirty = form.serverEditorData(dirtySource);
  assert.deepEqual(dirty, { name: "Dirty", cron: null, scheduleRule: serialized.scheduleRule });
  var markup = form.editorFields({}, "draft");
  assert.match(markup, /Does not repeat/);
  assert.match(markup, /Run once at selected time/);
  assert.match(markup, /After occurrences/);
  assert.match(markup, /aria-label="Sunday"/);
  assert.match(markup, /aria-label="Saturday"/);
  var weekdays = form.scheduleRuleState({ cron: "0 9 * * 1-5", date: "2099-04-03", time: "09:00", recurrenceEnd: { type: "after", count: 8 } }, { date: "2099-01-01", time: "10:00" });
  assert.equal(weekdays.advanced, false);
  assert.deepEqual(weekdays.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(weekdays.repeatEndCount, 8);
  assert.equal(weekdays.originalCron, "0 9 * * 1-5");
  var complex = form.scheduleRuleState({ cron: "*/17 6-18 * 1,6 1-5" }, { date: "2099-01-01", time: "10:00" });
  assert.equal(complex.advanced, true);
  var unevenBoundary = form.scheduleRuleState({ cron: "*/17 * * * *" }, { date: "2099-01-01", time: "10:00" });
  assert.equal(unevenBoundary.advanced, true);
  assert.equal(form.serializeScheduleRule(unevenBoundary).cron, "*/17 * * * *");
  var offset = form.scheduleRuleState({ cron: "5,15,25,35,45,55 * * * *" }, { date: "2099-01-01", time: "10:00" });
  assert.equal(offset.advanced, false);
  assert.equal(offset.time, "00:05");
  assert.equal(offset.intervalEvery, 10);
  assert.equal(offset.originalCron, "5,15,25,35,45,55 * * * *");
  var rangedWeekdays = form.scheduleRuleState({ cron: "*/10 * * * 1-3" }, { date: "2099-01-01", time: "10:00" });
  assert.equal(rangedWeekdays.advanced, false);
  assert.equal(rangedWeekdays.repeatEnabled, true);
  assert.deepEqual(rangedWeekdays.weekdays, [1, 2, 3]);
  assert.equal(rangedWeekdays.intervalEvery, 10);
  assert.equal(rangedWeekdays.originalCron, "*/10 * * * 1-3");
  var mixedWeekdays = form.scheduleRuleState({ cron: "*/10 * * * 1-3,5" }, { date: "2099-01-01", time: "10:00" });
  assert.equal(mixedWeekdays.advanced, true);
  assert.equal(form.serializeScheduleRule(mixedWeekdays).cron, "*/10 * * * 1-3,5");
});

test("explicit rules keep anchored week, month, year, ending, and interval semantics", function () {
  function at(value) { return new Date(value).getTime(); }
  function next(rule, after, runs, state) { return new Date(scheduleRule.nextScheduleRuleTime(rule, at(after), runs, state)); }
  var biweekly = { version: 1, timezone: "server-local", anchorDate: "2028-01-03", time: "09:00", recurrence: { every: 2, unit: "week", weekdays: [1, 3] } };
  assert.equal(next(biweekly, "2028-01-05T09:00:00").toString(), new Date("2028-01-17T09:00:00").toString());
  var everyTwoDays = { version: 1, timezone: "server-local", anchorDate: "2028-01-03", time: "09:00", recurrence: { every: 2, unit: "day" } };
  assert.equal(next(everyTwoDays, "2028-01-03T09:00:00").toString(), new Date("2028-01-05T09:00:00").toString());
  var monthly = { version: 1, timezone: "server-local", anchorDate: "2028-01-31", time: "08:15", recurrence: { every: 1, unit: "month" } };
  assert.equal(next(monthly, "2028-01-31T08:15:00").toString(), new Date("2028-03-31T08:15:00").toString());
  var yearly = { version: 1, timezone: "server-local", anchorDate: "2028-02-29", time: "12:00", recurrence: { every: 1, unit: "year" } };
  assert.equal(next(yearly, "2028-02-29T12:00:00").toString(), new Date("2032-02-29T12:00:00").toString());
  var bounded = { version: 1, timezone: "server-local", anchorDate: "2028-01-01", time: "09:00", recurrence: { every: 1, unit: "day" }, recurrenceEnd: { type: "until", date: "2028-01-02" } };
  assert.equal(scheduleRule.nextScheduleRuleTime(bounded, at("2028-01-02T09:00:00")), null);
  var counted = { version: 1, timezone: "server-local", anchorDate: "2028-01-01", time: "09:00", recurrence: { every: 1, unit: "day" }, recurrenceEnd: { type: "after", count: 2 }, interval: { every: 30, unit: "minute", end: null } };
  assert.equal(next(counted, "2028-01-01T09:00:00", [], { startCount: 1 }).toString(), new Date("2028-01-01T09:30:00").toString());
  assert.equal(scheduleRule.nextScheduleRuleTime(counted, at("2028-01-01T09:30:00"), [], { startCount: 2 }), null);
  var interval = { version: 1, timezone: "server-local", anchorDate: "2028-01-01", time: "09:00", recurrence: null, interval: { every: 45, unit: "minute", end: { type: "after", count: 3 } } };
  assert.equal(next(interval, "2028-01-01T09:00:00").toString(), new Date("2028-01-01T09:45:00").toString());
  assert.equal(scheduleRule.nextScheduleRuleTime(interval, at("2028-01-01T09:00:00"), [], { dateStartCounts: { "2028-01-01": 3 } }), null);
  var cutoff = { version: 1, timezone: "server-local", anchorDate: "2028-01-01", time: "09:00", recurrence: null, interval: { every: 90, unit: "minute", end: { type: "until", time: "10:30" } } };
  assert.equal(scheduleRule.nextScheduleRuleTime(cutoff, at("2028-01-01T09:00:00")), null, "stop time is an exclusive cutoff");
});

test("rule validation rejects loose types and unsupported identity fields", function () {
  var base = { version: 1, timezone: "server-local", anchorDate: "2099-01-05", time: "09:30", recurrence: { every: 2, unit: "week", weekdays: [1, 3] }, recurrenceEnd: null, interval: null };
  assert.equal(scheduleRule.validateScheduleRule(base).ok, true);
  assert.equal(scheduleRule.validateScheduleRule(Object.assign({}, base, { version: 2 })).ok, false);
  assert.equal(scheduleRule.validateScheduleRule(Object.assign({}, base, { timezone: "UTC" })).ok, false);
  assert.equal(scheduleRule.validateScheduleRule(Object.assign({}, base, { recurrence: { every: "2", unit: "week", weekdays: [1] } })).ok, false);
  assert.equal(scheduleRule.validateScheduleRule(Object.assign({}, base, { recurrence: { every: 2, unit: "week", weekdays: [7] } })).ok, false);
  assert.equal(scheduleRule.validateScheduleRule(Object.assign({}, base, { recurrence: { every: 2, unit: "constructor" } })).ok, false);
  assert.equal(scheduleRule.validateScheduleRule(Object.assign({}, base, { recurrence: { every: 2, unit: "__proto__" } })).ok, false);
});

test("registry persists scheduled-start counts before dispatch and reload keeps the next interval", function (t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-rule-tick-"));
  var registryPath = path.join(cwd, "registry", "tasks.jsonl");
  var originalNow = Date.now;
  var now = new Date(2099, 0, 5, 8, 59, 0).getTime();
  Date.now = function () { return now; };
  t.after(function () { Date.now = originalNow; fs.rmSync(cwd, { recursive: true, force: true }); });
  var dispatched = [];
  var registry = createLoopRegistry({ cwd: cwd, registryPath: registryPath, onTrigger: function (record) { dispatched.push(JSON.parse(fs.readFileSync(registryPath, "utf8").trim()).scheduleStartCount); } });
  var rule = { version: 1, timezone: "server-local", anchorDate: "2099-01-05", time: "09:00", recurrence: { every: 1, unit: "day" }, recurrenceEnd: { type: "after", count: 2 }, interval: { every: 30, unit: "minute", end: { type: "after", count: 2 } } };
  var record = registry.register({ id: "counted-rule", name: "Counted", task: "Run", source: "schedule", scheduleRule: rule, date: rule.anchorDate, time: rule.time, enabled: true });
  now = new Date(2099, 0, 5, 9, 0, 10).getTime();
  registry.tick();
  assert.deepEqual(dispatched, [1]);
  assert.equal(record.nextRunAt, new Date(2099, 0, 5, 9, 30, 0).getTime());
  registry.recordRun(record.id, { startedAt: now, reason: "complete" });
  var history = []; for (var hi = 0; hi < 20; hi++) history.push({ startedAt: new Date(2098, 0, hi + 1).getTime(), result: "complete" });
  registry.updateRecord(record.id, { runs: history });
  registry.stopTimer();
  var restored = createLoopRegistry({ cwd: cwd, registryPath: registryPath });
  restored.load();
  assert.equal(restored.getById(record.id).scheduleStartCount, 1);
  assert.equal(restored.getById(record.id).runs.length, 20);
  assert.equal(restored.getById(record.id).nextRunAt, new Date(2099, 0, 5, 9, 30, 0).getTime());
});

test("expired rule reload and overdue cutoff fail closed without dispatch", function (t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-rule-expired-"));
  var registryPath = path.join(cwd, "registry", "tasks.jsonl");
  var originalNow = Date.now;
  var now = new Date(2099, 0, 5, 8, 59, 0).getTime();
  Date.now = function () { return now; };
  t.after(function () { Date.now = originalNow; fs.rmSync(cwd, { recursive: true, force: true }); });
  var dispatched = [];
  var registry = createLoopRegistry({ cwd: cwd, registryPath: registryPath, onTrigger: function () { dispatched.push("run"); } });
  var rule = { version: 1, timezone: "server-local", anchorDate: "2099-01-05", time: "09:00", recurrence: { every: 1, unit: "day" }, recurrenceEnd: { type: "until", date: "2099-01-05" }, interval: { every: 30, unit: "minute", end: { type: "until", time: "09:45" } } };
  var record = registry.register({ id: "expired-rule", name: "Expired", task: "Run", source: "schedule", scheduleRule: rule, date: rule.anchorDate, time: rule.time, enabled: true });
  now = new Date(2099, 0, 5, 10, 0, 0).getTime();
  registry.tick();
  assert.deepEqual(dispatched, []);
  assert.equal(record.enabled, false);
  assert.equal(record.nextRunAt, null);
  var restored = createLoopRegistry({ cwd: cwd, registryPath: registryPath });
  restored.load();
  assert.equal(restored.getById(record.id).enabled, false);
  assert.equal(restored.getById(record.id).nextRunAt, null);
});

test("scheduled-start persistence failure rolls counters back and prevents dispatch", function (t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-rule-start-failure-"));
  var registryDir = path.join(cwd, "registry");
  var registryPath = path.join(registryDir, "tasks.jsonl");
  var originalNow = Date.now;
  var now = new Date(2099, 0, 5, 8, 59, 0).getTime();
  Date.now = function () { return now; };
  t.after(function () { Date.now = originalNow; fs.rmSync(cwd, { recursive: true, force: true }); });
  var dispatched = [];
  var registry = createLoopRegistry({
    cwd: cwd, registryPath: registryPath,
    prepareTrigger: function (target) { return { ok: true, activeRun: { runId: "reserved-run", scheduleId: target.id, status: "starting", startedAt: now } }; },
    onTrigger: function () { dispatched.push("run"); },
  });
  var rule = { version: 1, timezone: "server-local", anchorDate: "2099-01-05", time: "09:00", recurrence: { every: 1, unit: "day" }, recurrenceEnd: { type: "after", count: 2 }, interval: null };
  var record = registry.register({ id: "failed-start", name: "Failed start", task: "Run", source: "schedule", scheduleRule: rule, date: rule.anchorDate, time: rule.time, enabled: true });
  fs.rmSync(registryDir, { recursive: true, force: true });
  fs.writeFileSync(registryDir, "block registry writes");
  now = new Date(2099, 0, 5, 9, 0, 10).getTime();
  registry.tick();
  assert.deepEqual(dispatched, []);
  assert.equal(record.scheduleStartCount, 0);
  assert.deepEqual(record.scheduleDateStartCounts, {});
  assert.equal(record.activeRun, null);
  assert.equal(record.nextRunAt, new Date(2099, 0, 5, 9, 0, 0).getTime());
});

test("adding execution keeps an overdue unconfigured occurrence pending", function (t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-runtime-setup-"));
  var registry = createLoopRegistry({ cwd: cwd, registryPath: path.join(cwd, "tasks.jsonl") });
  var originalNow = Date.now;
  var due = new Date(2099, 0, 5, 9, 0, 0).getTime();
  Date.now = function () { return due - 60000; };
  t.after(function () { Date.now = originalNow; fs.rmSync(cwd, { recursive: true, force: true }); });
  var record = registry.register({ id: "needs-runtime", name: "Needs runtime", task: "Run", source: "schedule", date: "2099-01-05", time: "09:00", enabled: true, createdViaScheduledTasks: true });
  Date.now = function () { return due + 60000; };
  var updated = registry.update(record.id, { date: "2099-01-05", time: "09:00", execution: EXECUTION });
  assert.equal(updated.nextRunAt, due);
});

test("registry restart records an ambiguous active pair as interrupted without redispatch", function (t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-active-recovery-"));
  var registryPath = path.join(cwd, "tasks.jsonl");
  var record = { id: "recover-run", name: "Recover", task: "Run", cron: null, date: "2099-01-05", time: "09:00", source: "schedule", enabled: false, createdViaScheduledTasks: true, updatedAt: 10, runs: [], pendingRun: { scheduleId: "recover-run", source: "schedule" }, activeRun: { runId: "run-before-restart", scheduleId: "recover-run", status: "running", startedAt: 100, driverOriginId: "driver-origin", workerOriginId: "worker-origin" } };
  fs.writeFileSync(registryPath, JSON.stringify(record) + "\n");
  t.after(function () { fs.rmSync(cwd, { recursive: true, force: true }); });
  var dispatched = [];
  var registry = createLoopRegistry({ cwd: cwd, registryPath: registryPath, onTrigger: function () { dispatched.push("run"); } });
  registry.load(); registry.tick();
  var restored = registry.getById(record.id);
  assert.equal(restored.activeRun, null);
  assert.equal(restored.runs.length, 1);
  assert.equal(restored.runs[0].outcome, "interrupted");
  assert.equal(restored.runs[0].driverOriginId, "driver-origin");
  assert.equal(restored.pendingRun, null);
  assert.deepEqual(dispatched, []);
});

test("validated record edits switch between once and recurring without false success", function (t) {
  var f = serviceFixture(t);
  var record = f.registry.register({ id: "switch-task", name: "Switch", task: "Keep instructions", prompt: "Keep instructions", cron: "0 9 * * *", enabled: true, ownerId: "owner-1", maxIterations: 4, skipIfRunning: false });
  var records = createScheduledTaskRecords({ cwd: f.cwd, registry: f.registry, canUseSession: function () { return true; } });
  var session = { ownerId: "owner-1" };
  var once = records.update(session, record.id, record.updatedAt, { cron: null, date: "2099-07-08", time: "10:15" });
  assert.equal(once.ok, true);
  assert.equal(f.registry.getById(record.id).source, "schedule");
  assert.equal(JSON.parse(fs.readFileSync(f.registryPath, "utf8").trim()).source, "schedule");
  assert.equal(f.registry.getById(record.id).maxIterations, 4);
  var stale = records.update(session, record.id, record.updatedAt - 1, { cron: "0 8 * * 1-5" });
  assert.equal(stale.ok, false);
  assert.equal(f.registry.getById(record.id).cron, null);
  var recurring = records.update(session, record.id, once.record.revision, { cron: "30 8 * * 1-5" });
  assert.equal(recurring.ok, true);
  assert.equal(f.registry.getById(record.id).source, null);
  assert.equal(JSON.parse(fs.readFileSync(f.registryPath, "utf8").trim()).source, null);
  assert.equal(f.registry.getById(record.id).date, null);
  assert.equal(f.registry.getById(record.id).time, null);
  assert.equal(f.registry.getById(record.id).skipIfRunning, false);
});

test("unchanged manual cron submits preserve legacy anchors and ending metadata", function (t) {
  var f = serviceFixture(t);
  var record = f.registry.register({ id: "legacy-metadata", name: "Original", task: "Keep", prompt: "Keep", cron: "0 9 * * 1-5", date: "2099-01-05", time: "09:00", recurrenceEnd: { type: "after", count: 9 }, intervalEnd: { type: "until", time: "18:00" }, enabled: true, ownerId: "owner-1" });
  var records = createScheduledTaskRecords({ cwd: f.cwd, registry: f.registry, canUseSession: function () { return true; } });
  var renamed = records.update({ ownerId: "owner-1" }, record.id, record.updatedAt, { name: "Renamed", cron: "0 9 * * 1-5", date: "2099-01-05", time: "09:00", scheduleRule: null });
  assert.equal(renamed.ok, true);
  var saved = f.registry.getById(record.id);
  assert.equal(saved.cron, "0 9 * * 1-5");
  assert.equal(saved.date, "2099-01-05");
  assert.equal(saved.time, "09:00");
  assert.deepEqual(saved.recurrenceEnd, { type: "after", count: 9 });
  assert.deepEqual(saved.intervalEnd, { type: "until", time: "18:00" });
});

test("invalid once and recurring values still fail server validation", function () {
  assert.equal(validation.validateOneOffTaskInput({ name: "Bad", instructions: "Bad", date: "2099-02-31", time: "09:00" }).ok, false);
  assert.equal(validation.validateTaskInput({ name: "Bad", instructions: "Bad", cron: "0 9 * *" }).ok, false);
  assert.equal(validation.validateTaskInput({ name: "Bad", instructions: "Bad", cron: "*/0 * * * *" }).ok, false);
});

test("schedule form keeps advanced execution secondary and date-time compact at mobile width", function () {
  var root = path.join(__dirname, "..");
  var form = fs.readFileSync(path.join(root, "lib/public/modules/scheduled-task-form.js"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/scheduled-tasks.css"), "utf8");
  assert.match(form, /Does not repeat/);
  assert.match(form, /Run once at selected time/);
  assert.match(form, /Advanced custom schedule/);
  assert.match(form, /Execution pair/);
  assert.doesNotMatch(form, /Maximum loop steps|maxIterations/);
  assert.match(form, /Driver vendor/);
  assert.match(form, /Split Worker vendor/);
  assert.match(form, /Skip a scheduled start while this task already has an active run/);
  assert.match(form, /When off, overlapping starts are combined into one queued run\./);
  assert.match(form, /server local timezone/);
  var mobileRule = css.match(/@media \(max-width: (\d+)px\)[\s\S]*scheduled-task-date-time[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(100px, \.65fr\)/);
  assert.ok(mobileRule && 390 <= Number(mobileRule[1]), "date and time stay compact in one row at a 390px viewport");
  assert.doesNotMatch(form, /Max runs per trigger/);
});
