var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attachLaunch = require("../lib/project-issue-launch").attachIssueLaunch;
var attachService = require("../lib/issues-service").attachIssuesService;
var resolveIssueWorkSession = require("../lib/issue-work-session").resolveIssueWorkSession;
var issueStore = require("../lib/issues-store");

function fixture(options) {
  var opts = options || {};
  var actor = { id: "u1", displayName: "Owner" };
  var ws = { readyState: 1, _clayUser: actor };
  var entry = { ref: "issue:" + "a".repeat(24), revision: 1, title: "Launch work", summary: "Do it", body: "Details",
    status: "open", linkedWorkSessions: [] };
  var sessions = new Map();
  var created = 0; var runtimeCalls = 0; var sdkCalls = [];
  var sm = { sessions: sessions, installedVendors: ["codex"],
    createSessionRaw: function (settings) { var session = Object.assign({ localId: ++created, history: [], isProcessing: false }, settings); sessions.set(session.localId, session); return session; },
    deleteSession: function (id) { sessions.delete(id); }, saveSessionFile: function () {}, broadcastSessionList: function () {},
    switchSession: function (id, socket) { socket._clayActiveSession = id; },
    sendAndRecord: function (session, event) { session.history.push(event); }, sendToSession: function () {} };
  var bound = { scopeId: "project/pk/issues", readIssue: function () { return Object.assign({}, entry, { linkedWorkSessions: entry.linkedWorkSessions.slice() }); },
    linkWorkSession: function (args, session) {
      if (args.expectedRevision !== entry.revision) throw new Error("Issue revision conflict.");
      entry = Object.assign({}, entry, { revision: entry.revision + 1, status: "in_progress",
        linkedWorkSessions: [{ sessionId: session.sessionOriginId, role: "driver", issueRevision: args.expectedRevision, requestId: args.requestId }] });
      return entry;
    } };
  var linuxUser = opts.linuxUser || null;
  var context = { sm: sm, osUsers: opts.osUsers === true,
    getProjectAccess: function () { return opts.projectAccess || { sessionVisibilityDefault: "private" }; },
    resolveDefaultAi: function () { runtimeCalls++; return opts.runtime || Promise.resolve({ ready: true, vendor: "codex", model: "test-model" }); },
    canStartWork: function (socket, user) { return opts.canStart ? opts.canStart(socket, user) : true; },
    getLinuxUserForSession: function () { return linuxUser; },
    ensureProjectAccessForSession: function () { return linuxUser; },
    getSdk: function () { return { startQuery: function (session, prompt, images, linuxUser) {
      sdkCalls.push({ session: session, prompt: prompt, images: images, linuxUser: linuxUser });
      if (opts.sdk) return opts.sdk(session, prompt, images, linuxUser);
      session.queryInstance = { active: true };
      return Promise.resolve();
    } }; }, onProcessingChanged: function () {} };
  return { start: attachLaunch(context), ws: ws, actor: actor, bound: bound, entry: function () { return entry; }, setLinuxUser: function (value) { linuxUser = value; },
    sessions: sessions, sdkCalls: sdkCalls, runtimeCalls: function () { return runtimeCalls; } };
}

test("two request IDs deduplicate one in-flight issue launch and completed IDs replay exactly", async function () {
  var release;
  var runtime = new Promise(function (resolve) { release = resolve; });
  var f = fixture({ runtime: runtime });
  var args = { ref: f.entry().ref, expectedRevision: 1 };
  var first = f.start(f.ws, { requestId: "first", args: args }, f.bound);
  var second = f.start(f.ws, { requestId: "second", args: args }, f.bound);
  assert.equal(f.runtimeCalls(), 1);
  release({ ready: true, vendor: "codex", model: "test-model" });
  var results = await Promise.all([first, second]);
  assert.equal(results[0].sessionId, results[1].sessionId);
  assert.equal(f.sessions.size, 1);
  assert.equal(f.sdkCalls.length, 1);
  assert.equal((await f.start(f.ws, { requestId: "first", args: args }, f.bound)).sessionId, results[0].sessionId);
  await assert.rejects(f.start(f.ws, { requestId: "first", args: { ref: args.ref, expectedRevision: 2 } }, f.bound), /different arguments/);
  assert.equal(f.entry().status, "in_progress");
  assert.equal(f.entry().linkedWorkSessions[0].issueRevision, 1);
  assert.equal(f.entry().linkedWorkSessions[0].requestId, "first");
  assert.equal(f.sdkCalls[0].session.issueOrigin.requestId, "first");
  f.sdkCalls[0].session.isProcessing = false;
  assert.equal(f.entry().status, "in_progress", "session completion never resolves an Issue");
});

test("visible Issue Start work sessions inherit the project visibility default", async function () {
  var f = fixture({ projectAccess: { sessionVisibilityDefault: "shared" } });
  await f.start(f.ws, { requestId: "shared-issue", args: { ref: f.entry().ref, expectedRevision: 1 } }, f.bound);
  assert.equal(f.sessions.get(1).sessionVisibility, "shared");
});

test("launch revalidates the exact actor and creation authority after runtime resolution", async function () {
  var release;
  var runtime = new Promise(function (resolve) { release = resolve; });
  var allowed = true;
  var f = fixture({ runtime: runtime, canStart: function () { return allowed; } });
  var pending = f.start(f.ws, { requestId: "revoked", args: { ref: f.entry().ref, expectedRevision: 1 } }, f.bound);
  allowed = false;
  release({ ready: true, vendor: "codex", model: "test-model" });
  await assert.rejects(pending, /no longer allowed/);
  assert.equal(f.sessions.size, 0);
});

test("launch rejects an OS identity change during Default AI resolution", async function () {
  var release;
  var runtime = new Promise(function (resolve) { release = resolve; });
  var f = fixture({ runtime: runtime, osUsers: true, linuxUser: "linux-owner" });
  var pending = f.start(f.ws, { requestId: "identity-change", args: { ref: f.entry().ref, expectedRevision: 1 } }, f.bound);
  f.setLinuxUser("other-owner");
  release({ ready: true, vendor: "codex", model: "test-model" });
  await assert.rejects(pending, /OS identity changed/);
  assert.equal(f.sessions.size, 0);
});

test("OS identity reaches the real SDK argument and a launch failure stays visible in the session", async function () {
  var f = fixture({ osUsers: true, linuxUser: "linux-owner", sdk: function (session) {
    session.isProcessing = false;
    session.history.push({ type: "error", text: "Adapter login failed." });
    return Promise.resolve();
  } });
  var error;
  try { await f.start(f.ws, { requestId: "failure", args: { ref: f.entry().ref, expectedRevision: 1 } }, f.bound); }
  catch (caught) { error = caught; }
  assert.ok(error);
  assert.match(error.message, /Adapter login failed/);
  assert.equal(error.sessionId, 1);
  assert.equal(f.sdkCalls[0].images, undefined);
  assert.equal(f.sdkCalls[0].linuxUser, "linux-owner");
  assert.match(f.sdkCalls[0].prompt, /Session completion never resolves/);
  assert.ok(f.sdkCalls[0].session.history.some(function (event) { return event.type === "user_message" && event.issueRef === f.entry().ref; }));
  assert.ok(f.sdkCalls[0].session.history.some(function (event) { return event.type === "error"; }));
});

test("linked work session APIs enforce exact revision and visible Driver identity while preserving closed history", async function (t) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-issue-links-"));
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var sessions = new Map();
  var status = { slug: "app", path: directory, projectKnowledgeId: "pk_links", projectOwnerId: "u1", isMate: false };
  var manager = { sessions: sessions };
  var project = { getStatus: function () { return status; }, getSessionManager: function () { return manager; } };
  var service = attachService({ getProjects: function () { return new Map([["app", project]]); }, isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "u1" ? { id: "u1" } : null; }, baseDir: directory });
  var bound = service.bindUser({ projectSlug: "app", userId: "u1" });
  var issue = issueStore.createIssuesStore({ projectKnowledgeId: "pk_links", baseDir: directory }).create({ title: "Lifecycle" }, { type: "user", userId: "u1" });
  var hidden = { localId: 1, ownerId: "u1", hidden: true }; sessions.set(1, hidden);
  assert.throws(function () { bound.linkWorkSession({ ref: issue.ref, expectedRevision: 1 }, hidden); }, /Invalid work session/);
  var driver = { localId: 2, ownerId: "u1" }; sessions.set(2, driver);
  var linked = bound.linkWorkSession({ ref: issue.ref, expectedRevision: 1 }, driver);
  assert.equal(linked.status, "in_progress");
  assert.throws(function () { resolveIssueWorkSession(bound, { ref: issue.ref, expectedRevision: 1, sessionOriginId: driver.sessionOriginId }); }, /conflict/);
  assert.equal(resolveIssueWorkSession(bound, { ref: issue.ref, expectedRevision: 2, sessionOriginId: driver.sessionOriginId }), driver);
  driver.delegated = true;
  assert.throws(function () { bound.resolveWorkSession({ ref: issue.ref, expectedRevision: 2, sessionOriginId: driver.sessionOriginId }); }, /unavailable/);
  driver.delegated = false;
  var closed = await bound.updateIssue({ ref: issue.ref, expectedRevision: 2, status: "closed", closeReason: "declined" });
  assert.equal(resolveIssueWorkSession(bound, { ref: issue.ref, expectedRevision: closed.revision, sessionOriginId: driver.sessionOriginId }), driver,
    "closed issues retain navigable work history");
});
