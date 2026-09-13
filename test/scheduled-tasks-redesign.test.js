var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;
var scheduledTasks = require("../lib/project-scheduled-tasks");
var attachScheduledTasks = scheduledTasks.attachScheduledTasks;
var authorizeStoredOwner = scheduledTasks.authorizeStoredOwner;
var validateCron = require("../lib/schedule-validation").validateCron;
var createLoopRegistry = require("../lib/scheduler").createLoopRegistry;
var createScheduledTaskRecords = require("../lib/scheduled-task-records").createScheduledTaskRecords;
var EXECUTION = { driver: { vendor: "claude", model: "fable", effort: "medium" }, worker: { vendor: "codex", model: "gpt-5.6-sol", effort: "medium" } };

function fixture(options) {
  var opts = options || {};
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-scheduled-tasks-"));
  var session = Object.assign({ localId: 7, mode: "gui", ownerId: "owner-1", history: [], isProcessing: false, scheduledTaskDraft: null, _sdkQueryGeneration: 0 }, opts.session || {});
  var records = [];
  var sent = [];
  var queryCount = 0;
  var executionCalls = 0;
  var sessions = new Map([[session.localId, session]]);
  var registry = opts.registry || {
    getAll: function () { return records; },
    getById: function (id) { return records.find(function (record) { return record.id === id; }) || null; },
    register: function (data) { var record = Object.assign({ runs: [], nextRunAt: Date.now() + 60000 }, data); records.push(record); return record; },
    update: function (id, data) { var record = this.getById(id); if (!record) return null; Object.assign(record, data); return record; },
  };
  var service = attachScheduledTasks({
    cwd: cwd, isMate: !!opts.isMate, sm: {
      sessions: sessions,
      appendToSessionFile: function () {}, saveSessionFile: function () {},
      sendToSession: function (target, message) { sent.push(message); },
    },
    sdk: { startQuery: function () { queryCount += 1; return opts.queryGate || Promise.resolve(); } },
    registry: registry, sendTo: function (ws, message) { sent.push(message); }, sendToSession: function (id, message) { sent.push(message); },
    getSessionForWs: function () { return session; }, ensureProjectAccessForSession: function () { return null; }, onProcessingChanged: function () {},
    canAccess: function () { return !opts.denied; }, hasPermission: function () { return !opts.noPermission; },
    canUseSession: function (target) { return sessions.get(target.localId) === target && !opts.denied && !opts.noPermission; },
    isDriverOperatedSession: function () { return !!opts.worker; }, resolveOwnerName: function (id) { return id === "owner-1" ? "Owner One" : null; },
    scheduledExecution: opts.scheduledExecution || { runnable: function () { return { ok: true }; }, trigger: function () { executionCalls++; return { ok: true }; }, stopRecord: function () { return true; } },
  });
  var ws = { _clayUser: { id: "owner-1", displayName: "Owner One" } };
  return { cwd: cwd, session: session, sessions: sessions, records: records, sent: sent, service: service, ws: ws, queries: function () { return queryCount; }, executionCalls: function () { return executionCalls; } };
}

test("Run now is correlated and a replay cannot create a duplicate pair", function () {
  var f = fixture();
  f.records.push({ id: "run-once", name: "Run", task: "Run", cron: "0 9 * * *", ownerId: "owner-1", updatedAt: 10, execution: EXECUTION, enabled: true, runs: [] });
  var message = { type: "scheduled_task_run", sessionId: 7, requestId: "run-request", id: "run-once", version: 10 };
  f.service.handleMessage(f.ws, message); f.service.handleMessage(f.ws, message);
  assert.equal(f.executionCalls(), 1);
  var replies = f.sent.filter(function (item) { return item.requestId === "run-request"; });
  assert.equal(replies.length, 2); assert.equal(replies[1].duplicate, true);
});

test("same-query tools begin, propose, and explicitly create a correlated owned schedule", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.cwd, { recursive: true, force: true }); });
  var tools = f.service.getToolDefs(f.session);
  assert.equal(tools[0].structuredQuestionLimit(), null, "ordinary structured input remains unrestricted before the schedule interview starts");
  var begin = JSON.parse((await tools[0].handler({})).content[0].text);
  assert.equal(begin.status, "interview_started");
  assert.equal(tools[0].structuredQuestionLimit(), 1);
  assert.equal(f.queries(), 0, "the active query is not replaced by a second SDK query");
  var proposed = JSON.parse((await tools[1].handler({ name: "Morning check", instructions: "Run the focused checks.", cron: "0 9 * * 1-5", execution: EXECUTION })).content[0].text);
  assert.equal(proposed.status, "proposed");
  var draft = f.session.scheduledTaskDraft;
  f.service.handleMessage(f.ws, { type: "scheduled_task_create", sessionId: 7, requestId: "create-1", proposalId: draft.id, version: draft.version, data: Object.assign({}, draft, { name: "Morning verification" }) });
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].name, "Morning verification");
  assert.equal(f.records[0].ownerId, "owner-1");
  assert.equal(f.records[0].sessionId, 7);
  assert.equal(fs.readFileSync(path.join(f.cwd, ".claude", "loops", f.records[0].id, "PROMPT.md"), "utf8"), "Run the focused checks.\n");
  assert.equal(f.session.scheduledTaskDraft, null);
  f.service.handleMessage(f.ws, { type: "scheduled_task_create", sessionId: 7, requestId: "create-1", proposalId: draft.id, version: draft.version });
  assert.equal(f.records.length, 1, "a replay cannot create a second record");
});

test("button start uses one new-session query while replay and delayed completion preserve the draft", async function () {
  var resolveQuery;
  var gate = new Promise(function (resolve) { resolveQuery = resolve; });
  var f = fixture({ queryGate: gate });
  f.service.handleMessage(f.ws, { type: "scheduled_task_interview_start", sessionId: 7, requestId: "start-1" });
  assert.equal(f.queries(), 1);
  f.session.isProcessing = false;
  var tool = f.service.getToolDefs(f.session)[1];
  await tool.handler({ name: "Keep me", instructions: "Do work", cron: "15 8 * * *" });
  f.service.handleMessage(f.ws, { type: "scheduled_task_interview_start", sessionId: 7, requestId: "start-1" });
  assert.equal(f.queries(), 1);
  resolveQuery();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.session.scheduledTaskDraft.name, "Keep me");
});

test("stale proposal tools, wrong sessions, Mate, TUI, Worker, and denied access fail closed", async function () {
  var f = fixture();
  var oldTools = f.service.getToolDefs(f.session);
  await oldTools[0].handler({});
  await oldTools[1].handler({ name: "First", instructions: "One", cron: "0 8 * * *" });
  var first = f.session.scheduledTaskDraft;
  f.service.handleMessage(f.ws, { type: "scheduled_task_cancel", sessionId: 7, proposalId: first.id, version: first.version });
  f.session._sdkQueryGeneration = 1;
  var newTools = f.service.getToolDefs(f.session);
  await newTools[0].handler({});
  var stale = JSON.parse((await oldTools[1].handler({ name: "Stale", instructions: "Wrong", cron: "0 9 * * *" })).content[0].text);
  assert.equal(stale.status, "rejected");
  f.service.handleMessage(f.ws, { type: "scheduled_tasks_list", sessionId: 99, requestId: "wrong" });
  assert.equal(f.sent.some(function (message) { return message.requestId === "wrong" && message.ok === false; }), true);
  var mate = fixture({ isMate: true });
  var worker = fixture({ worker: true });
  var tui = fixture({ session: { mode: "tui" } });
  assert.equal(mate.service.getToolDefs(mate.session).length, 0);
  assert.equal(worker.service.getToolDefs(worker.session).length, 0);
  assert.equal(tui.service.getToolDefs(tui.session).length, 0);
  var noPermission = fixture({ noPermission: true });
  assert.equal(noPermission.service.getToolDefs(noPermission.session).length, 0);
  var revocable = {};
  var revoked = fixture(revocable);
  var revokedTools = revoked.service.getToolDefs(revoked.session);
  revocable.noPermission = true;
  var revokedBegin = JSON.parse((await revokedTools[0].handler({})).content[0].text);
  assert.equal(revokedBegin.status, "rejected");
  var replaced = fixture();
  var replacedTools = replaced.service.getToolDefs(replaced.session);
  replaced.sessions.set(7, Object.assign({}, replaced.session));
  var replacedBegin = JSON.parse((await replacedTools[0].handler({})).content[0].text);
  assert.equal(replacedBegin.status, "rejected");
  assert.equal(fixture({ denied: true }).service.handleMessage({}, { type: "scheduled_tasks_list", sessionId: 7 }), true);
});

test("strict cron validation rejects zero steps and edit persistence updates task files", async function (t) {
  assert.equal(validateCron("*/0 * * * *").ok, false);
  assert.equal(validateCron("0 25 * * *").ok, false);
  assert.equal(validateCron("0 9 * * 1-5").ok, true);
  var registry = createLoopRegistry({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "clay-cron-")) });
  assert.equal(registry.nextRunTime("*/0 * * * *"), null);
  var f = fixture();
  t.after(function () { fs.rmSync(f.cwd, { recursive: true, force: true }); });
  var tools = f.service.getToolDefs(f.session); await tools[0].handler({});
  var invalid = JSON.parse((await tools[1].handler({ name: "Bad", instructions: "No", cron: "*/0 * * * *" })).content[0].text);
  assert.equal(invalid.status, "rejected");
  f.records.push({ id: "existing", name: "Old", task: "Old task", prompt: "Old task", cron: "0 8 * * *", enabled: true, maxIterations: 1, ownerId: null, updatedAt: 10 });
  f.service.handleMessage(f.ws, { type: "scheduled_task_update", sessionId: 7, requestId: "bad-edit", id: "existing", version: 10, data: { name: "Bad", instructions: "Bad", cron: "*/0 * * * *" } });
  assert.equal(f.records[0].name, "Old");
  f.service.handleMessage(f.ws, { type: "scheduled_task_update", sessionId: 7, requestId: "good-edit", id: "existing", version: 10, data: { name: "New", instructions: "New task", cron: "30 8 * * *" } });
  assert.equal(f.records[0].name, "New");
  assert.equal(fs.readFileSync(path.join(f.cwd, ".claude", "loops", "existing", "PROMPT.md"), "utf8"), "New task\n");
  f.service.handleMessage(f.ws, { type: "scheduled_tasks_list", sessionId: 7, requestId: "list" });
  var listed = f.sent.filter(function (message) { return message.type === "scheduled_tasks_state"; }).pop();
  assert.equal(listed.records[0].ownerName, "Unassigned");
});

test("real registry schedule revisions increase across frozen and backward clocks", function (t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-schedule-revisions-"));
  var registryDir = path.join(cwd, "registry");
  var registryPath = path.join(registryDir, "registry.jsonl");
  var originalNow = Date.now;
  var now = 1000;
  Date.now = function () { return now; };
  t.after(function () { Date.now = originalNow; fs.rmSync(cwd, { recursive: true, force: true }); });
  var registry = createLoopRegistry({ cwd: cwd, registryPath: registryPath });
  var record = registry.register({ id: "revision-task", name: "Original", task: "Original instructions", prompt: "Original instructions", cron: "0 8 * * *", ownerId: "owner-1" });
  var records = createScheduledTaskRecords({ cwd: cwd, registry: registry, canUseSession: function () { return true; } });
  var session = { localId: 7, ownerId: "owner-1" };
  var originalRevision = record.updatedAt;
  var first = records.update(session, record.id, originalRevision, { name: "First", instructions: "First instructions", cron: "0 9 * * *" });
  assert.equal(first.ok, true);
  assert.ok(first.record.revision > originalRevision);
  now = 900;
  var stale = records.update(session, record.id, originalRevision, { name: "Stale", instructions: "Stale instructions", cron: "0 10 * * *" });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /changed/);
  assert.equal(registry.getById(record.id).name, "First");
  var second = records.update(session, record.id, first.record.revision, { name: "Second", instructions: "Second instructions", cron: "0 11 * * *" });
  assert.equal(second.ok, true);
  assert.ok(second.record.revision > first.record.revision);
  var toggled = registry.toggleEnabled(record.id);
  assert.ok(toggled.updatedAt > second.record.revision);
  var toggleRevision = toggled.updatedAt;
  var metadata = registry.updateRecord(record.id, { description: "Persisted metadata" });
  assert.ok(metadata.updatedAt > toggleRevision);
  var persisted = JSON.parse(fs.readFileSync(registryPath, "utf8").trim());
  assert.equal(persisted.name, "Second");
  assert.equal(persisted.description, "Persisted metadata");
  assert.equal(persisted.updatedAt, metadata.updatedAt);
  var beforeFailure = Object.assign({}, registry.getById(record.id));
  fs.rmSync(registryDir, { recursive: true, force: true });
  fs.writeFileSync(registryDir, "block persistence");
  assert.equal(registry.updateRecord(record.id, { transientField: "Must roll back" }), null);
  assert.deepEqual(registry.getById(record.id), beforeFailure);
  assert.equal(Object.prototype.hasOwnProperty.call(registry.getById(record.id), "transientField"), false);
});

test("closed start replays do not launch queries and cancellation works before a proposal", async function () {
  var f = fixture();
  f.service.handleMessage(f.ws, { type: "scheduled_task_interview_start", sessionId: 7, requestId: "start-once" });
  assert.equal(f.queries(), 1);
  var interviewId = f.service.activeInterviewId(f.session);
  f.service.handleMessage(f.ws, { type: "scheduled_task_cancel", sessionId: 7, interviewId: interviewId });
  assert.equal(f.service.activeInterviewId(f.session), null);
  f.service.handleMessage(f.ws, { type: "scheduled_task_interview_start", sessionId: 7, requestId: "start-once" });
  assert.equal(f.queries(), 1);
});

test("late interview failure cannot reset a newer query", async function () {
  var rejectQuery;
  var gate = new Promise(function (resolve, reject) { rejectQuery = reject; });
  var f = fixture({ queryGate: gate });
  f.service.handleMessage(f.ws, { type: "scheduled_task_interview_start", sessionId: 7, requestId: "late-error" });
  f.session._sdkQueryGeneration += 1;
  f.session.isProcessing = true;
  rejectQuery(new Error("old query failed"));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.session.isProcessing, true);
  assert.equal(f.sent.some(function (message) { return message.requestId === "late-error" && message.ok === false; }), false);
});

test("one-off edits preserve linked task files and mode while changing date and runtime settings", function () {
  var f = fixture();
  f.records.push({ id: "one-off", linkedTaskId: "shared-task", source: "schedule", name: "Once", task: "Shared instructions", prompt: "Shared instructions", cron: null, date: "2099-01-02", time: "08:00", mode: "judge", maxIterations: 1, updatedAt: 20 });
  f.service.handleMessage(f.ws, { type: "scheduled_task_update", sessionId: 7, requestId: "edit-once", id: "one-off", version: 20, data: { name: "Once later", cron: null, date: "2099-01-03", time: "10:15" } });
  assert.equal(f.records[0].date, "2099-01-03");
  assert.equal(f.records[0].time, "10:15");
  assert.equal(f.records[0].task, "Shared instructions");
  assert.equal(f.records[0].mode, "judge");
});

test("registry persistence failure is reported and leaves the exact draft pending", async function (t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-schedule-save-failure-"));
  var blocker = path.join(cwd, "not-a-directory");
  fs.writeFileSync(blocker, "block");
  var registry = createLoopRegistry({ cwd: cwd, registryPath: path.join(blocker, "registry.jsonl") });
  var f = fixture({ registry: registry });
  t.after(function () { fs.rmSync(cwd, { recursive: true, force: true }); fs.rmSync(f.cwd, { recursive: true, force: true }); });
  var tools = f.service.getToolDefs(f.session);
  await tools[0].handler({});
  await tools[1].handler({ name: "Persist me", instructions: "Keep the draft", cron: "0 9 * * *", execution: EXECUTION });
  var draft = f.session.scheduledTaskDraft;
  f.service.handleMessage(f.ws, { type: "scheduled_task_create", sessionId: 7, requestId: "save-fails", proposalId: draft.id, version: draft.version, data: draft });
  var result = f.sent.filter(function (message) { return message.requestId === "save-fails"; }).pop();
  assert.equal(result.ok, false);
  assert.equal(f.session.scheduledTaskDraft.id, draft.id);
  assert.equal(registry.getAll().length, 0, "a failed register cannot remain executable in memory");
  assert.deepEqual(fs.readdirSync(path.join(f.cwd, ".claude", "loops")), []);
});

test("manual creation starts blank in the current owned session and saves without a query", function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.cwd, { recursive: true, force: true }); });
  f.service.handleMessage(f.ws, { type: "scheduled_task_manual_start", sessionId: 7, requestId: "manual-1" });
  var draft = f.session.scheduledTaskDraft;
  assert.equal(f.queries(), 0);
  assert.equal(draft.manual, true);
  assert.equal(draft.name, "");
  assert.equal(draft.instructions, "");
  assert.equal(draft.cron, "");
  f.service.handleMessage(f.ws, { type: "scheduled_task_create", sessionId: 7, requestId: "manual-create-invalid", proposalId: draft.id, version: draft.version, data: { name: "", instructions: "", cron: "*/0 * * * *" } });
  assert.equal(f.records.length, 0);
  assert.equal(f.session.scheduledTaskDraft.id, draft.id);
  f.service.handleMessage(f.ws, { type: "scheduled_task_create", sessionId: 7, requestId: "manual-create", proposalId: draft.id, version: draft.version, data: { name: "Manual check", instructions: "Run it manually configured.", cron: "0 8 * * 1-5", execution: EXECUTION, skipIfRunning: true } });
  assert.equal(f.queries(), 0);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].ownerId, "owner-1");
  assert.equal(f.records[0].name, "Manual check");
  assert.equal(f.session.scheduledTaskDraft, null);
  f.service.handleMessage(f.ws, { type: "scheduled_task_create", sessionId: 7, requestId: "manual-create", proposalId: draft.id, version: draft.version });
  assert.equal(f.records.length, 1);
  f.service.handleMessage(f.ws, { type: "scheduled_task_manual_start", sessionId: 7, requestId: "manual-1" });
  assert.equal(f.session.scheduledTaskDraft, null, "replaying a completed manual start cannot create another draft");
});

test("manual creation rejects stale or unauthorized sessions and preserves an existing draft", function () {
  var uncorrelated = fixture();
  uncorrelated.service.handleMessage(uncorrelated.ws, { type: "scheduled_task_manual_start", sessionId: 7 });
  assert.equal(uncorrelated.session.scheduledTaskDraft, null);
  var denied = fixture({ noPermission: true });
  denied.service.handleMessage(denied.ws, { type: "scheduled_task_manual_start", sessionId: 7, requestId: "denied-manual" });
  assert.equal(denied.session.scheduledTaskDraft, null);
  assert.equal(denied.sent.some(function (message) { return message.type === "scheduled_task_manual_start_result" && message.requestId === "denied-manual" && message.ok === false; }), true);
  var stale = fixture();
  stale.sessions.set(7, Object.assign({}, stale.session));
  stale.service.handleMessage(stale.ws, { type: "scheduled_task_manual_start", sessionId: 7, requestId: "stale-manual" });
  assert.equal(stale.session.scheduledTaskDraft, null);
  var existing = fixture();
  var interviewId = "existing-interview";
  var draft = { id: "existing-draft", version: 3, interviewId: interviewId, sessionId: 7, name: "Keep this", instructions: "Keep these instructions", cron: "0 7 * * *" };
  existing.session.history.push({ source: "scheduled_task_interview", interviewId: interviewId });
  existing.session.scheduledTaskDraft = draft;
  existing.service.handleMessage(existing.ws, { type: "scheduled_task_manual_start", sessionId: 7, requestId: "resume-manual" });
  assert.equal(existing.session.scheduledTaskDraft, draft);
  assert.equal(existing.session.scheduledTaskDraft.name, "Keep this");
  assert.equal(existing.queries(), 0);
  var orphaned = fixture();
  orphaned.session.scheduledTaskDraft = Object.assign({}, draft, { interviewId: "missing-history" });
  orphaned.service.handleMessage(orphaned.ws, { type: "scheduled_task_manual_start", sessionId: 7, requestId: "orphan-manual" });
  assert.equal(orphaned.session.scheduledTaskDraft.name, "Keep this");
  assert.equal(orphaned.sent.some(function (message) { return message.requestId === "orphan-manual" && message.ok === false; }), true);
});

test("real registry failures roll back register and update state plus task-file edits", function (t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-registry-rollback-"));
  var registryDir = path.join(cwd, "registry");
  var registryPath = path.join(registryDir, "loops.jsonl");
  var registry = createLoopRegistry({ cwd: cwd, registryPath: registryPath });
  var original = registry.register({ id: "persisted", name: "Original", task: "Original task", prompt: "Original task", cron: "0 9 * * *", enabled: true });
  assert.equal(original.name, "Original");
  fs.rmSync(registryDir, { recursive: true, force: true });
  fs.writeFileSync(registryDir, "block");
  assert.equal(registry.register({ id: "ghost", name: "Ghost", cron: "0 10 * * *", enabled: true }), null);
  assert.equal(registry.getById("ghost"), null);
  var f = fixture({ registry: registry });
  var promptDir = path.join(f.cwd, ".claude", "loops", "persisted");
  fs.mkdirSync(promptDir, { recursive: true });
  fs.writeFileSync(path.join(promptDir, "PROMPT.md"), "Original task\n");
  f.service.handleMessage(f.ws, { type: "scheduled_task_update", sessionId: 7, requestId: "failed-update", id: "persisted", version: original.updatedAt, data: { name: "Changed", instructions: "Changed task", cron: "30 9 * * *" } });
  var result = f.sent.filter(function (message) { return message.requestId === "failed-update"; }).pop();
  assert.equal(result.ok, false);
  assert.equal(registry.getById("persisted").name, "Original");
  assert.equal(registry.getById("persisted").cron, "0 9 * * *");
  assert.equal(fs.readFileSync(path.join(promptDir, "PROMPT.md"), "utf8"), "Original task\n");
  t.after(function () { fs.rmSync(cwd, { recursive: true, force: true }); fs.rmSync(f.cwd, { recursive: true, force: true }); });
});

test("client recurrence labels and state wiring cover constrained cron and correlated refreshes", async function () {
  var modulePath = path.join(__dirname, "..", "lib", "public", "modules", "scheduled-tasks.js");
  var recurrencePath = path.join(__dirname, "..", "lib", "public", "modules", "scheduled-task-recurrence.js");
  var client = await import(pathToFileURL(recurrencePath).href + "?scheduled-task-test=" + Date.now());
  assert.equal(client.humanRecurrence("*/5 * * * 1-5"), "Every 5 minutes · Mon–Fri");
  assert.equal(client.humanRecurrence("0 9 1 * *"), "Monthly on day 1 at 09:00");
  assert.equal(client.humanRecurrence("0 9 * * 1-5"), "Weekdays at 09:00");
  assert.equal(client.humanRecurrence("30 14 * * 1,3,5"), "Weekly on Mon, Wed, Fri at 14:30");
  var source = fs.readFileSync(modulePath, "utf8");
  assert.match(source, /scheduledTaskDraftForm/);
  assert.match(source, /scheduledTaskEditForm/);
  assert.match(source, /scheduledTaskListRequest/);
  assert.match(source, /new_session_result/);
  assert.doesNotMatch(source, /exclusiveClosers|registerScheduledTaskClosers/);
});

test("legacy updates cannot replace ownership and new executions reauthorize their stored owner", function () {
  var root = path.join(__dirname, "..");
  var loop = fs.readFileSync(path.join(root, "lib", "project-loop.js"), "utf8");
  assert.match(loop, /delete registryUpdateData\.ownerId/);
  assert.match(loop, /record\.createdViaScheduledTasks[\s\S]*authorizeScheduledRun/);
  var owner = { id: "owner-1", linuxUser: "ownerlinux", permissions: { scheduledTasks: true } };
  var granted = null;
  var context = {
    osUsers: true,
    projectAccess: { visibility: "private", allowedUsers: ["owner-1"] },
    usersModule: {
      isMultiUser: function () { return true; },
      findUserById: function (id) { return id === owner.id ? owner : null; },
      getEffectivePermissions: function (user) { return user.permissions; },
      canAccessProject: function (id, project) { return project.allowedUsers.indexOf(id) >= 0; },
    },
    resolveLinuxUser: function (linuxUser) { return linuxUser === "ownerlinux" ? { uid: 1001 } : null; },
    grantProjectAccess: function (linuxUser) { granted = linuxUser; },
  };
  assert.equal(authorizeStoredOwner({ ownerId: "owner-1", sessionId: 987654 }, context), true, "authorization does not require the creating chat to exist");
  assert.equal(granted, "ownerlinux");
  context.projectAccess.allowedUsers = [];
  assert.equal(authorizeStoredOwner({ ownerId: "owner-1", sessionId: 7 }, context), false);
  context.projectAccess.allowedUsers = ["owner-1"];
  owner.linuxUser = "wronglinux";
  assert.equal(authorizeStoredOwner({ ownerId: "owner-1" }, context), false);
});

test("Driver tools read and update one exact schedule with revision and ownership guards", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.cwd, { recursive: true, force: true }); });
  f.records.push({ id: "stable-task", name: "Original", task: "Keep these instructions", prompt: "Keep these instructions", cron: "0 8 * * 1-5", enabled: true, maxIterations: 4, skipIfRunning: false, ownerId: "owner-1", vendor: "codex", model: "gpt-5", effort: "high", linkedTaskId: null, updatedAt: 50 });
  var tools = f.service.getToolDefs(f.session);
  var listed = JSON.parse((await tools[2].handler({})).content[0].text);
  assert.deepEqual(listed.tasks.map(function (record) { return record.id; }), ["stable-task"]);
  var read = JSON.parse((await tools[3].handler({ id: "stable-task" })).content[0].text);
  assert.equal(read.record.revision, 50);
  assert.equal(read.record.instructions, "Keep these instructions");
  var updated = JSON.parse((await tools[4].handler({ id: "stable-task", revision: 50, cron: "30 9 * * 1-5" })).content[0].text);
  assert.equal(updated.ok, true);
  assert.equal(f.records.length, 1, "editing cannot create a duplicate record");
  assert.equal(f.records[0].cron, "30 9 * * 1-5");
  assert.equal(f.records[0].task, "Keep these instructions");
  assert.equal(f.records[0].vendor, "codex");
  assert.equal(f.records[0].model, "gpt-5");
  f.records[0].updatedAt = 51;
  var stale = JSON.parse((await tools[4].handler({ id: "stable-task", revision: 50, name: "Stale" })).content[0].text);
  assert.equal(stale.ok, false);
  assert.match(stale.error, /changed/);
  f.session._sdkQueryGeneration = 1;
  var oldQuery = JSON.parse((await tools[4].handler({ id: "stable-task", revision: 51, name: "Old query" })).content[0].text);
  assert.equal(oldQuery.status, "rejected");
  f.records[0].ownerId = "another-owner";
  var currentTools = f.service.getToolDefs(f.session);
  var denied = JSON.parse((await currentTools[3].handler({ id: "stable-task" })).content[0].text);
  assert.equal(denied.ok, false);
  assert.match(denied.error, /access denied/);
});

test("schedule record updates reject malformed ids, unknown fields, and linked instructions before IO", function () {
  var lookups = 0;
  var linked = { id: "linked-schedule", linkedTaskId: "task-1", source: "schedule", name: "Linked", task: "Shared", date: "2099-01-02", time: "08:00", ownerId: "owner-1", updatedAt: 7 };
  var registry = {
    getAll: function () { return [linked]; },
    getById: function (id) { lookups += 1; return id === linked.id ? linked : null; },
    update: function () { throw new Error("must not write"); },
  };
  var records = createScheduledTaskRecords({ cwd: "/tmp", registry: registry, canUseSession: function () { return true; } });
  var session = { ownerId: "owner-1" };
  assert.match(records.read(session, "../linked-schedule").error, /id is invalid/);
  assert.equal(lookups, 0, "malformed ids are rejected before registry or filesystem access");
  assert.match(records.update(session, linked.id, 7, { enabled: false }).error, /Unsupported scheduled task field/);
  assert.match(records.update(session, linked.id, 7, { instructions: "Replace shared" }).error, /linked task/);
  assert.equal(linked.task, "Shared");
});

test("interview engine state is correlated and resolves the selected vendor catalog", async function () {
  var session = { localId: 9, vendor: "claude", mode: "gui", history: [] };
  var sent = [];
  var sm = { sessions: new Map([[9, session]]), installedVendors: ["codex"], modelsByVendor: {} };
  var service = attachScheduledTasks({
    cwd: process.cwd(), projectSlug: "project-a", sm: sm, registry: { getAll: function () { return []; } }, isMate: false,
    usersModule: { getScheduledTaskInterviewEngine: function () { return { vendor: "codex", model: "gpt-5.2-codex", effort: "high" }; } },
    getSessionForWs: function () { return session; }, sendTo: function (ws, message) { sent.push(message); }, isDriverOperatedSession: function () { return false; }, canUseSession: function () { return true; },
    getEngineCatalog: function (ws, vendor) { sm.modelsByVendor[vendor] = [{ value: "gpt-5.2-codex" }]; return Promise.resolve({ status: "ready", models: sm.modelsByVendor[vendor] }); },
  });
  service.handleMessage({}, { type: "scheduled_task_interview_engine_get", sessionId: 9, projectSlug: "project-a", requestId: "engine-1", vendor: "codex" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(sent[0].requestId, "engine-1");
  assert.equal(sent[0].projectSlug, "project-a");
  assert.equal(sent[0].sessionId, 9);
  assert.equal(sent[0].catalogReadyByVendor.codex, true);
});

test("pausing a one-off schedule stays paused and the same action can resume it", function (t) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clay-one-off-schedule-"));
  var registryPath = path.join(cwd, "registry.jsonl");
  var registry = createLoopRegistry({ cwd: cwd, registryPath: registryPath });
  t.after(function () { fs.rmSync(cwd, { recursive: true, force: true }); });
  var record = registry.register({ name: "Once", source: "schedule", date: "2099-04-12", time: "09:30" });
  assert.equal(record.enabled, true);
  assert.ok(record.nextRunAt);
  registry.update(record.id, { enabled: false });
  assert.equal(record.enabled, false);
  assert.equal(record.nextRunAt, null);
  registry.toggleEnabled(record.id);
  assert.equal(record.enabled, true);
  assert.ok(record.nextRunAt);
  registry.toggleEnabled(record.id);
  assert.equal(record.enabled, false);
  assert.equal(record.nextRunAt, null);
});

test("project workbench replaces Home entry while legacy calendar code remains", function () {
  var root = path.join(__dirname, "..");
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/scheduled-tasks.css"), "utf8");
  var palette = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette-order.js"), "utf8");
  var scheduler = fs.readFileSync(path.join(root, "lib/public/modules/scheduler.js"), "utf8");
  var workbench = fs.readFileSync(path.join(root, "lib/public/modules/scheduled-tasks.js"), "utf8");
  assert.doesNotMatch(html, /home-scheduler-btn/);
  assert.match(palette, /id: "scheduler-btn"/);
  assert.doesNotMatch(palette, /id: "mate-scheduler-btn"/);
  assert.match(workbench, /main-panels/);
  assert.match(workbench, /type: "new_session", mode: "gui", forceNew: true/);
  assert.match(workbench, /type: "scheduled_task_manual_start", sessionId: store\.get\('activeSessionId'\)/);
  assert.match(workbench, /aria-haspopup="menu"/);
  assert.match(workbench, /event\.key === "Escape"/);
  assert.match(workbench, /handleScheduledTaskSessionSwitched/);
  assert.match(css, /scheduled-tasks-topbar \{ flex-shrink: 0/);
  assert.match(css, /scheduled-task-draft-slot \{ flex: 0 1 auto; min-height: 0; max-height: calc\(100% - 48px\); overflow-y: auto/);
  assert.match(scheduler, /export function openHomeScheduler/);
  assert.match(scheduler, /function renderMonth/);
});
