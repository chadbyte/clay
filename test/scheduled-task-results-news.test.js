var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var logsStore = require("../lib/project-logs-store");
var attachService = require("../lib/project-logs-service").attachProjectLogsService;
var attachProjectLogs = require("../lib/project-logs").attachProjectLogs;
var createSessionManager = require("../lib/sessions").createSessionManager;
var createScheduledRunState = require("../lib/scheduled-run-state").createScheduledRunState;

function tempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function result(runId, ownerId, outcome) {
  return {
    runId: runId, scheduleId: "task-1", name: "Morning review", ownerId: ownerId,
    outcome: outcome || "completed", summary: "Verified the scheduled review.",
    startedAt: 100, finishedAt: 200, driverOriginId: "origin-driver-" + ownerId,
    workerOriginId: "origin-worker-" + ownerId, driverProviderSessionId: "provider-" + ownerId,
  };
}

test("scheduled results are durable, idempotent, owner-isolated, and read per user", function (t) {
  var base = tempDir("clay-scheduled-results-");
  t.after(function () { fs.rmSync(base, { recursive: true, force: true }); });
  var store = logsStore.createProjectLogsStore({ root: "/project", baseDir: base });
  var first = store.createScheduledResult(result("run-a", "user-a"), null);
  var duplicate = store.createScheduledResult(result("run-a", "user-a"), null);
  var second = store.createScheduledResult(result("run-b", "user-b", "failed"), null);
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.entry.ref, first.entry.ref);
  assert.notEqual(second.entry.ref, first.entry.ref);
  assert.deepEqual(store.list({ scheduledResultOwnerId: "user-a" }).entries.map(function (entry) { return entry.ref; }), [first.entry.ref]);
  assert.deepEqual(store.list({ scheduledResultOwnerId: "user-b" }).entries.map(function (entry) { return entry.ref; }), [second.entry.ref]);
  assert.equal(store.read(second.entry.ref, false, "user-a"), null);
  assert.deepEqual(store.unreadScheduledResults("user-a"), { count: 1, newestRef: first.entry.ref, refs: [first.entry.ref] });
  assert.equal(store.markScheduledResultRead(first.entry.ref, "user-a").count, 0);

  var reopened = logsStore.createProjectLogsStore({ root: "/project", baseDir: base });
  assert.equal(reopened.unreadScheduledResults("user-a").count, 0, "read state survives a new store instance");
  assert.equal(reopened.unreadScheduledResults("user-b").count, 1, "one user's display never reads another user's result");
  assert.throws(function () { reopened.markScheduledResultRead(second.entry.ref, "user-a"); }, /not found/);
});

test("the server-owned writer validates owners and user bindings cannot cross-read results", function (t) {
  var base = tempDir("clay-scheduled-service-");
  t.after(function () { fs.rmSync(base, { recursive: true, force: true }); });
  var status = { slug: "shared", path: "/shared", projectOwnerId: "user-a", visibility: "private", allowedUsers: ["user-b"] };
  var manager = { sessions: new Map() };
  var project = { getStatus: function () { return status; }, getSessionManager: function () { return manager; } };
  var projects = new Map([["shared", project]]);
  var cache = null;
  var service = attachService({
    getProjects: function () { return projects; }, isMultiUser: function () { return true; },
    canAccessProject: function (userId, current) { return current.projectOwnerId === userId || current.allowedUsers.indexOf(userId) !== -1; },
    findUserById: function (id) { return id === "user-a" || id === "user-b" ? { id: id } : null; },
    openStore: function () { if (!cache) cache = logsStore.createProjectLogsStore({ root: "/shared", baseDir: base }); return cache; },
  });
  var created = service.recordScheduledResult(Object.assign({ projectSlug: "shared" }, result("run-a", "user-a")));
  service.recordScheduledResult(Object.assign({ projectSlug: "shared" }, result("run-b", "user-b")));
  var userA = service.bindUser({ projectSlug: "shared", user: { id: "user-a" } });
  var userB = service.bindUser({ projectSlug: "shared", user: { id: "user-b" } });
  assert.deepEqual(userA.listLogs({}).entries.map(function (entry) { return entry.ref; }), [created.entry.ref]);
  assert.equal(userB.listLogs({}).total, 1);
  assert.throws(function () { userB.readLog({ ref: created.entry.ref }); }, /not found/);
  assert.throws(function () { service.recordScheduledResult(Object.assign({ projectSlug: "shared" }, result("run-x", "missing"))); }, /owner is unavailable/);
  var driver = { localId: 1, cliSessionId: "driver-a", ownerId: "user-a", vendor: "claude" };
  manager.sessions.set(driver.localId, driver);
  var agent = service.bindProjectSession({ projectSlug: "shared", session: driver });
  assert.throws(function () { agent.updateLog({ ref: created.entry.ref, summary: "Rewritten" }); }, /server-owned/);
  assert.throws(function () { userA.removeLog({ ref: created.entry.ref }); }, /server-owned/);
  status.allowedUsers = [];
  assert.throws(function () { userB.scheduledResultsState(); }, /not available/);
});

test("unread state uses the same exact worktree scope as list and read", function (t) {
  var base = tempDir("clay-scheduled-worktree-");
  t.after(function () { fs.rmSync(base, { recursive: true, force: true }); });
  var parentStatus = { slug: "parent", path: "/parent", projectKnowledgeId: "shared-ledger", projectOwnerId: "user-a", visibility: "private", allowedUsers: [] };
  var worktreeA = { slug: "work-a", path: "/work-a", parentSlug: "parent", projectKnowledgeId: "shared-ledger", projectOwnerId: "user-a", visibility: "private", allowedUsers: ["user-b"], isWorktree: true, changeSetId: "cs_change_a" };
  var worktreeB = { slug: "work-b", path: "/work-b", parentSlug: "parent", projectKnowledgeId: "shared-ledger", projectOwnerId: "user-a", visibility: "private", allowedUsers: ["user-b"], isWorktree: true, changeSetId: "cs_change_b" };
  var manager = { sessions: new Map() };
  var projects = new Map([
    ["parent", { getStatus: function () { return parentStatus; }, getSessionManager: function () { return manager; } }],
    ["work-a", { getStatus: function () { return worktreeA; }, getSessionManager: function () { return manager; } }],
    ["work-b", { getStatus: function () { return worktreeB; }, getSessionManager: function () { return manager; } }],
  ]);
  var cache = null;
  var service = attachService({
    getProjects: function () { return projects; }, isMultiUser: function () { return true; },
    canAccessProject: function (userId, current) { return current.allowedUsers.indexOf(userId) !== -1; },
    hasFullProjectAccess: function () { return false; },
    findUserById: function (id) { return id === "user-a" || id === "user-b" ? { id: id } : null; },
    openStore: function () { if (!cache) cache = logsStore.createProjectLogsStore({ root: "/parent", baseDir: base, projectKnowledgeId: "shared-ledger" }); return cache; },
  });
  var resultA = service.recordScheduledResult(Object.assign({ projectSlug: "work-a" }, result("run-work-a", "user-b")));
  var resultB = service.recordScheduledResult(Object.assign({ projectSlug: "work-b" }, result("run-work-b", "user-b")));
  var bound = service.bindUser({ projectSlug: "work-a", user: { id: "user-b" } });
  assert.deepEqual(bound.listLogs({}).entries.map(function (entry) { return entry.ref; }), [resultA.entry.ref]);
  assert.deepEqual(bound.scheduledResultsState(), { count: 1, newestRef: resultA.entry.ref, refs: [resultA.entry.ref] });
  assert.throws(function () { bound.readLog({ ref: resultB.entry.ref }); }, /not found/);
  bound.markScheduledResultRead({ ref: resultA.entry.ref });
  assert.deepEqual(bound.scheduledResultsState(), { count: 0, newestRef: null, refs: [] });
});

test("live result metadata is pushed only after current project authorization", function (t) {
  var base = tempDir("clay-scheduled-push-");
  t.after(function () { fs.rmSync(base, { recursive: true, force: true }); });
  var status = { slug: "shared", path: "/shared", projectOwnerId: "user-a", visibility: "private", allowedUsers: ["user-b"] };
  var manager = { sessions: new Map() };
  var project = { getStatus: function () { return status; }, getSessionManager: function () { return manager; } };
  var service = attachService({
    getProjects: function () { return new Map([["shared", project]]); },
    isMultiUser: function () { return true; },
    canAccessProject: function (userId, current) { return current.projectOwnerId === userId || current.allowedUsers.indexOf(userId) !== -1; },
    findUserById: function (id) { return id === "user-a" || id === "user-b" ? { id: id } : null; },
    openStore: function () { return logsStore.createProjectLogsStore({ root: "/shared", baseDir: base }); },
  });
  var ownerSocket = { readyState: 1, _clayUser: { id: "user-a" } };
  var memberSocket = { readyState: 1, _clayUser: { id: "user-b" } };
  var sent = [];
  var logs = attachProjectLogs({
    service: service, sm: manager, projectSlug: "shared",
    getClients: function () { return [ownerSocket, memberSocket]; },
    sendTo: function (socket, message) { sent.push({ socket: socket, message: message }); },
  });
  logs.recordScheduledResult(Object.assign({ projectSlug: "ignored" }, result("run-live", "user-b")));
  assert.deepEqual(sent.map(function (delivery) { return delivery.socket; }), [memberSocket]);
  status.allowedUsers = [];
  logs.recordScheduledResult(result("run-revoked", "user-b"));
  assert.equal(sent.length, 1, "revoked sockets receive no scheduled result metadata");
});

test("live delivery requires the exact result to pass the bound read scope", function () {
  var socket = { readyState: 1, _clayUser: { id: "user-b" } };
  var sent = [];
  var readAttempts = 0;
  var service = {
    recordScheduledResult: function () { return { created: true, entry: { ref: "log:abcdefghijklmnopqrstuvwx", title: "Private", summary: "Private summary", scheduledResult: { ownerId: "user-b", outcome: "completed" } } }; },
    bindUser: function () { return { readLog: function () { readAttempts += 1; throw new Error("Log entry not found."); } }; },
  };
  var logs = attachProjectLogs({ service: service, sm: { sessions: new Map() }, projectSlug: "work-a", getClients: function () { return [socket]; }, sendTo: function (target, message) { sent.push(message); } });
  logs.recordScheduledResult(result("run-hidden-scope", "user-b"));
  assert.equal(readAttempts, 1);
  assert.deepEqual(sent, []);
});

test("marking a result read synchronizes every authorized tab for that user", function (t) {
  var base = tempDir("clay-scheduled-tabs-");
  t.after(function () { fs.rmSync(base, { recursive: true, force: true }); });
  var status = { slug: "shared", path: "/shared", projectOwnerId: "user-a", visibility: "private", allowedUsers: ["user-b"] };
  var manager = { sessions: new Map() };
  var project = { getStatus: function () { return status; }, getSessionManager: function () { return manager; } };
  var cache = null;
  var service = attachService({
    getProjects: function () { return new Map([["shared", project]]); }, isMultiUser: function () { return true; },
    canAccessProject: function (userId, current) { return current.projectOwnerId === userId || current.allowedUsers.indexOf(userId) !== -1; },
    findUserById: function (id) { return id === "user-a" || id === "user-b" ? { id: id } : null; },
    openStore: function () { if (!cache) cache = logsStore.createProjectLogsStore({ root: "/shared", baseDir: base }); return cache; },
  });
  var created = service.recordScheduledResult(Object.assign({ projectSlug: "shared" }, result("run-tabs", "user-b")));
  var first = { readyState: 1, _clayUser: { id: "user-b" } };
  var second = { readyState: 1, _clayUser: { id: "user-b" } };
  var owner = { readyState: 1, _clayUser: { id: "user-a" } };
  var sent = [];
  var logs = attachProjectLogs({ service: service, sm: manager, projectSlug: "shared", getClients: function () { return [first, second, owner]; }, sendTo: function (socket, message) { sent.push({ socket: socket, message: message }); } });
  assert.equal(logs.handleLogsMessage(first, { type: "scheduled_task_result_mark_read", ref: created.entry.ref }), true);
  assert.deepEqual(sent.map(function (delivery) { return delivery.socket; }), [first, second]);
  assert.deepEqual(sent.map(function (delivery) { return delivery.message.unreadCount; }), [0, 0]);
});

test("hidden scheduled sessions stay out of session projections across reload", function (t) {
  var root = tempDir("clay-scheduled-sessions-");
  var sessionsBase = path.join(root, "sessions");
  var cliSessions = path.join(root, "cli");
  fs.mkdirSync(cliSessions, { recursive: true });
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var messages = [];
  var first = createSessionManager({ cwd: "/scheduled-project", sessionsBase: sessionsBase, cliSessionsDir: cliSessions, send: function (message) { messages.push(message); } });
  var hidden = first.createSessionRaw({ cliSessionId: "scheduled-driver", hidden: true });
  hidden.scheduledTaskRun = { runId: "run-hidden", scheduleId: "task-hidden", role: "driver" };
  first.saveSessionFile(hidden);
  var ordinary = first.createSessionRaw({ cliSessionId: "ordinary-session" });
  first.saveSessionFile(ordinary);
  first.broadcastSessionList();
  var firstIds = messages.pop().sessions.map(function (session) { return session.cliSessionId; });
  assert.equal(firstIds.indexOf("scheduled-driver"), -1);
  assert.notEqual(firstIds.indexOf("ordinary-session"), -1);

  var restoredMessages = [];
  var restored = createSessionManager({ cwd: "/scheduled-project", sessionsBase: sessionsBase, cliSessionsDir: cliSessions, send: function (message) { restoredMessages.push(message); } });
  restored.broadcastSessionList();
  assert.deepEqual(restoredMessages.pop().sessions.map(function (session) { return session.cliSessionId; }), ["ordinary-session"]);
  var restoredHidden = Array.from(restored.sessions.values()).filter(function (session) { return session.cliSessionId === "scheduled-driver"; })[0];
  assert.equal(restoredHidden.hidden, true);
  assert.equal(restoredHidden.scheduledTaskRun.runId, "run-hidden");
});

test("terminal callbacks happen after durable completion and do not repeat", function () {
  var record = { id: "task-1", activeRun: { runId: "run-a", startedAt: 100 }, runs: [], updatedAt: 0 };
  var saved = 0;
  var terminal = [];
  var state = createScheduledRunState({
    getRecord: function () { return record; },
    save: function () { saved += 1; return true; },
    onTerminal: function (current, run) {
      terminal.push({ activeRun: current.activeRun, run: run });
    },
  });
  assert.equal(state.complete("task-1", "run-a", { outcome: "interrupted", reason: "Daemon stopped." }), true);
  assert.equal(saved, 1);
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].activeRun, null, "the durable record is terminal before publication");
  assert.equal(terminal[0].run.outcome, "interrupted");
  assert.equal(state.complete("task-1", "run-a", { outcome: "failed" }), false);
  assert.equal(terminal.length, 1, "a duplicate completion cannot publish twice");
});

test("client decisions separate reconnect, live delivery, visibility, and exact display", async function () {
  var modulePath = pathToFileURL(path.join(__dirname, "../lib/public/modules/scheduled-result-client.js")).href + "?test=" + Date.now();
  var client = await import(modulePath);
  var ref = "log:abcdefghijklmnopqrstuvwx";
  var state = { scheduledResultUnread: 0, scheduledResultAutoFocusHandled: false, scheduledResultSeenRefs: {}, scheduledResultSessionRequestId: "open-1", projectLogsOpen: true, projectLogsView: "detail", projectLogsSelectedRef: ref };
  var reconnect = client.scheduledResultStateTransition(state, { unreadCount: 2, newestUnreadRef: ref, autoFocus: true });
  assert.equal(reconnect.openRef, ref); assert.equal(reconnect.patch.scheduledResultFocusRef, ref);
  state = Object.assign({}, state, reconnect.patch);
  assert.equal(client.scheduledResultStateTransition(state, { unreadCount: 2, newestUnreadRef: ref, autoFocus: true }).openRef, null, "duplicate reconnect cannot steal focus twice");
  var live = client.scheduledResultCreatedTransition(state, { ref: ref });
  assert.equal(live.scheduledResultUnread, 3);
  state = Object.assign({}, state, live);
  assert.equal(client.scheduledResultCreatedTransition(state, { ref: ref }), null, "duplicate live completion is ignored");
  var entry = { ref: ref, scheduledResult: { runId: "run-a" } };
  assert.equal(client.shouldAcknowledgeScheduledResult(entry, state, "hidden"), false, "background display stays unread");
  assert.equal(client.shouldAcknowledgeScheduledResult(entry, Object.assign({}, state, { projectLogsSelectedRef: "log:other" }), "visible"), false, "a result navigated away from stays unread");
  assert.equal(client.shouldAcknowledgeScheduledResult(entry, state, "visible"), true);
  assert.equal(client.shouldFocusScheduledResult(entry, state), true);
  assert.equal(client.scheduledResultSessionId(state, { requestId: "other", sessionId: 12 }), null);
  assert.equal(client.scheduledResultSessionId(state, { requestId: "open-1", sessionId: 12 }), 12);
});
