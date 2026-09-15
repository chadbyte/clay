var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachAssignments = require("../lib/workspace-assignment-service").attachWorkspaceAssignmentService;
var attachDelegated = require("../lib/project-delegated-session").attachDelegatedSession;

function fixture(options) {
  var opts = options || {};
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-assignment-"));
  var sourceEvents = [];
  var subscribers = {};
  var sourceSession = { localId: 1, cliSessionId: "source-cli", ownerId: "u1", history: [] };
  var sourceManager = {
    sessions: new Map([[1, sourceSession]]),
    sendAndRecord: function (session, event) { session.history.push(event); sourceEvents.push(event); },
  };
  var targetManager = {
    sessions: new Map(),
    subscribeSession: function (id, cb) { subscribers[id] = cb; return function () { delete subscribers[id]; }; },
    sendAndRecord: function (session, event) { session.history.push(event); },
  };
  var followUpSession = { localId: 8, cliSessionId: "follow-cli", ownerId: "u1", sessionVisibility: "private", title: "Existing work", history: [], isProcessing: false };
  targetManager.sessions.set(8, followUpSession);
  var created = 0;
  var followedUp = 0;
  var target = {
    getStatus: function () { return { title: "Target project", projectOwnerId: "u1", isMate: false, isWorktree: false }; },
    getSessionManager: function () { return targetManager; },
    createDelegatedSession: async function (principal, task, metadata, onCreated) {
      if (opts.createError) throw new Error(opts.createError);
      created++;
      var session = { localId: 9, cliSessionId: null, ownerId: principal.userId, sessionVisibility: "private", history: [{ type: "delegated_work", text: task }], assignment: metadata };
      targetManager.sessions.set(9, session);
      onCreated(session);
      return session;
    },
    inspectDelegatedFollowUp: function (principal, ref) {
      if (ref !== "ref:target:follow-cli") throw new Error("Target session was not found in this project.");
      if (followUpSession.ownerId !== principal.userId) throw new Error("Target session access denied.");
      if (followUpSession.isProcessing) throw new Error("Target session must be idle.");
      return { session: followUpSession, sessionRef: ref, title: followUpSession.title };
    },
    dispatchDelegatedFollowUp: async function (principal, ref, task, metadata, onReady) {
      target.inspectDelegatedFollowUp(principal, ref);
      followedUp++;
      onReady(followUpSession);
      targetManager.sendAndRecord(followUpSession, { type: "delegated_follow_up", text: task, assignmentId: metadata.assignmentId });
      return followUpSession;
    },
  };
  var projects = new Map([
    ["mate", { getStatus: function () { return { projectOwnerId: "u1", isMate: true, mateId: "mate-1" }; }, getSessionManager: function () { return sourceManager; } }],
    ["target", target],
    ["public-other", { getStatus: function () { return { projectOwnerId: "u2", visibility: "public", isMate: false }; } }],
    ["mate-target", { getStatus: function () { return { projectOwnerId: "u1", isMate: true }; } }],
  ]);
  var sessionRef = function (slug, session) { return "ref:" + slug + ":" + (session.cliSessionId || session.localId); };
  var service = attachAssignments({ storageDir: dir, getProjects: function () { return projects; }, isMultiUser: function () { return true; }, sessionRef: sessionRef });
  var principal = { userId: "u1", mateId: "mate-1", sourceProjectSlug: "mate", sourceSessionId: 1, sourceSessionRef: "ref:mate:source-cli", sourceRequestId: "req-1" };
  function homeWs(userId) {
    return { _clayUser: { id: userId || "u1" }, _homeChatTap: { mateSlug: "mate", mateId: "mate-1", sessionId: 1, sessionReference: "ref:mate:source-cli", requestId: "req-1" } };
  }
  function response(proposal, action) {
    return { assignmentId: proposal.assignmentId, sourceProjectSlug: "mate", sourceSessionRef: "ref:mate:source-cli", surface: "home", action: action, mateId: "mate-1", sessionId: "ref:mate:source-cli", requestId: "req-1" };
  }
  return { dir: dir, service: service, principal: principal, sourceEvents: sourceEvents, subscribers: subscribers, projects: projects, followUpSession: followUpSession, homeWs: homeWs, response: response, getCreated: function () { return created; }, getFollowedUp: function () { return followedUp; } };
}

test("proposal is idempotent, owner-bound, and performs no target mutation before approval", function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var args = { projectSlug: "target", title: "Audit parser", task: "Inspect and test the parser." };
  var first = f.service.propose(f.principal, args);
  var second = f.service.propose(f.principal, args);
  assert.equal(first.assignmentId, second.assignmentId);
  assert.equal(first.delivery, "new_session");
  assert.equal(first.projectTitle, "Target project");
  assert.equal(f.getCreated(), 0);
  assert.equal(f.sourceEvents[0].type, "project_assignment_proposal");
  assert.equal(f.service.getStatus(f.principal, first.assignmentId).status, "proposed");
  assert.throws(function () {
    f.service.getStatus(Object.assign({}, f.principal, { sourceSessionId: 99, sourceSessionRef: "ref:mate:other" }), first.assignmentId);
  }, /not found/);
  assert.throws(function () { f.service.propose(f.principal, { projectSlug: "public-other", title: "No", task: "Do not run" }); }, /owned workspace/);
  assert.throws(function () { f.service.propose(f.principal, { projectSlug: "mate-target", title: "No", task: "Do not run" }); }, /owned workspace/);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "targetSessionId"), false);
});

test("proposal binding follows local-to-durable source identity promotion", function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  f.principal.sourceSessionRef = "ref:mate:1";
  var proposal = f.service.propose(f.principal, { projectSlug: "target", title: "Promoted", task: "Use the exact source." });
  assert.equal(proposal.sourceSessionRef, "ref:mate:source-cli");
  assert.equal(f.sourceEvents[0].assignment.sourceSessionRef, "ref:mate:source-cli");
});

test("Home approval requires exact user, Mate, request, and durable session correlation", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.propose(f.principal, { projectSlug: "target", title: "Run", task: "Do the work" });
  await assert.rejects(f.service.respond(f.homeWs("u2"), f.response(proposal, "approve"), "target"), /unavailable|denied/);
  await assert.rejects(f.service.respond({ _clayUser: { id: "u1" } }, f.response(proposal, "approve"), "target"), /stale|exact Home conversation/);
  var stale = f.response(proposal, "approve");
  stale.requestId = "stale";
  await assert.rejects(f.service.respond(f.homeWs(), stale, "target"), /stale/);
  var wrongSession = f.response(proposal, "approve");
  wrongSession.sourceSessionRef = "ref:mate:other";
  await assert.rejects(f.service.respond(f.homeWs(), wrongSession, "target"), /does not match/);
  assert.equal(f.getCreated(), 0);
  var running = await f.service.respond(f.homeWs(), f.response(proposal, "approve"), "target");
  assert.equal(running.status, "running");
  assert.equal(f.getCreated(), 1);
  var duplicate = await f.service.respond(f.homeWs(), f.response(proposal, "approve"), "target");
  assert.equal(duplicate.status, "running");
  assert.equal(f.getCreated(), 1);
  await assert.rejects(f.service.respond(f.homeWs(), f.response(proposal, "cancel"), "target"), /resolved/);
});

test("a restored Home proposal accepts the new request correlation for the same exact session", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.propose(f.principal, { projectSlug: "target", title: "Resume", task: "Run after reconnect" });
  var ws = f.homeWs();
  ws._homeChatTap.requestId = "req-after-reconnect";
  var msg = f.response(proposal, "approve");
  msg.requestId = "req-after-reconnect";
  var result = await f.service.respond(ws, msg, "unrelated-visible-project");
  assert.equal(result.status, "running");
  assert.equal(f.getCreated(), 1);
});

test("project approval is tied to the routed project and active source session", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.propose(f.principal, { projectSlug: "target", title: "Run", task: "Do the work" });
  var msg = f.response(proposal, "approve");
  msg.surface = "project";
  var ws = { _clayUser: { id: "u1" }, _clayActiveSession: 1 };
  await assert.rejects(f.service.respond(ws, msg, "other-project"), /exact project conversation/);
  await f.service.respond(ws, msg, "mate");
  assert.equal(f.getCreated(), 1);
});

test("project-routed follow-up retains the same exact source-session gate", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.proposeFollowUp(f.principal, { projectSlug: "target", targetSessionRef: "ref:target:follow-cli", title: "Continue", task: "Continue exactly." });
  var msg = f.response(proposal, "approve");
  msg.surface = "project";
  var ws = { _clayUser: { id: "u1" }, _clayActiveSession: 1 };
  await assert.rejects(f.service.respond(ws, msg, "target"), /exact project conversation/);
  var result = await f.service.respond(ws, msg, "mate");
  assert.equal(result.delivery, "follow_up");
  assert.equal(f.getFollowedUp(), 1);
});

test("target identity promotion and completion persist one terminal result", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.propose(f.principal, { projectSlug: "target", title: "Run", task: "Do the work" });
  await f.service.respond(f.homeWs(), f.response(proposal, "approve"), "mate");
  var targetSession = f.projects.get("target").getSessionManager().sessions.get(9);
  targetSession.cliSessionId = "target-cli";
  f.subscribers[9]({ type: "session_id" });
  assert.equal(f.service.records[0].targetSessionRef, "ref:target:target-cli");
  targetSession.history.push({ type: "delta", text: "Finished safely." });
  f.subscribers[9]({ type: "result" });
  f.subscribers[9] && f.subscribers[9]({ type: "done" });
  assert.equal(f.service.records[0].status, "completed");
  assert.equal(f.service.records[0].resultSummary, "Finished safely.");
  var completed = f.sourceEvents.filter(function (event) { return event.type === "project_assignment_status" && event.assignment.status === "completed"; });
  assert.equal(completed.length, 1);
});

test("registry is per-user, mode 0600, and restart marks live work interrupted", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.propose(f.principal, { projectSlug: "target", title: "Run", task: "Do the work" });
  await f.service.respond(f.homeWs(), f.response(proposal, "approve"), "mate");
  var files = fs.readdirSync(f.dir).filter(function (name) { return name.endsWith(".json"); });
  assert.equal(files.length, 1);
  assert.equal((fs.statSync(path.join(f.dir, files[0])).mode & 0o777), 0o600);
  fs.writeFileSync(path.join(f.dir, "other-user.json"), JSON.stringify([{ assignmentId: "other", userId: "u2", status: "completed" }]));
  var reloaded = attachAssignments({ storageDir: f.dir, getProjects: function () { return f.projects; }, isMultiUser: function () { return true; }, sessionRef: function (slug, session) { return "ref:" + slug + ":" + (session.cliSessionId || session.localId); } });
  assert.equal(reloaded.records.filter(function (record) { return record.userId === "u1"; })[0].status, "interrupted");
  assert.equal(reloaded.records.filter(function (record) { return record.userId === "u2"; })[0].status, "completed");
  reloaded.reconcileProject("mate");
  assert.equal(f.sourceEvents.filter(function (event) { return event.type === "project_assignment_status" && event.assignment.status === "interrupted"; }).length, 1);
});

test("approval revalidates target ownership before session creation", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.propose(f.principal, { projectSlug: "target", title: "Moved", task: "Do not cross owners" });
  f.projects.get("target").getStatus = function () { return { projectOwnerId: "u2", isMate: false, isWorktree: false }; };
  await assert.rejects(f.service.respond(f.homeWs(), f.response(proposal, "approve"), "mate"), /no longer available/);
  assert.equal(f.getCreated(), 0);
  assert.equal(f.service.records[0].status, "proposed");
});

test("follow-up proposal is idempotent and causes zero target mutation before approval", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var args = { projectSlug: "target", targetSessionRef: "ref:target:follow-cli", title: "Review fix", task: "Review the exact pending fix." };
  var proposal = f.service.proposeFollowUp(f.principal, args);
  var duplicate = f.service.proposeFollowUp(f.principal, args);
  assert.equal(duplicate.assignmentId, proposal.assignmentId);
  assert.equal(proposal.delivery, "follow_up");
  assert.equal(proposal.targetSessionTitle, "Existing work");
  assert.equal(f.followUpSession.history.length, 0);
  assert.equal(f.getCreated(), 0);
  assert.equal(f.getFollowedUp(), 0);
  var running = await f.service.respond(f.homeWs(), f.response(proposal, "approve"), "mate");
  assert.equal(running.status, "running");
  assert.equal(f.getCreated(), 0);
  assert.equal(f.getFollowedUp(), 1);
  assert.deepEqual(f.followUpSession.history.map(function (event) { return event.type; }), ["delegated_follow_up"]);
  f.followUpSession.history.push({ type: "delta", text: "Follow-up complete." });
  f.subscribers[8]({ type: "result" });
  f.subscribers[8] && f.subscribers[8]({ type: "done" });
  assert.equal(f.service.records[0].status, "completed");
  assert.equal(f.service.records[0].resultSummary, "Follow-up complete.");
  assert.equal(f.sourceEvents.filter(function (event) { return event.type === "project_assignment_status" && event.assignment.status === "completed"; }).length, 1);
});

test("follow-up approval revalidates exact target eligibility without mutation", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.proposeFollowUp(f.principal, { projectSlug: "target", targetSessionRef: "ref:target:follow-cli", title: "Wait", task: "Only if still idle." });
  f.followUpSession.isProcessing = true;
  var failed = await f.service.respond(f.homeWs(), f.response(proposal, "approve"), "mate");
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /idle/);
  assert.equal(f.followUpSession.history.length, 0);
  assert.equal(f.getCreated(), 0);
  assert.equal(f.getFollowedUp(), 0);
});

test("follow-up approval revalidates target project ownership", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.proposeFollowUp(f.principal, { projectSlug: "target", targetSessionRef: "ref:target:follow-cli", title: "Moved", task: "Do not cross owners." });
  f.projects.get("target").getStatus = function () { return { projectOwnerId: "u2", isMate: false, isWorktree: false }; };
  await assert.rejects(f.service.respond(f.homeWs(), f.response(proposal, "approve"), "mate"), /no longer available/);
  assert.equal(f.followUpSession.history.length, 0);
  assert.equal(f.getFollowedUp(), 0);
});

test("running follow-up reloads as interrupted without redispatch", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.proposeFollowUp(f.principal, { projectSlug: "target", targetSessionRef: "ref:target:follow-cli", title: "Restart", task: "Do this once." });
  await f.service.respond(f.homeWs(), f.response(proposal, "approve"), "mate");
  assert.equal(f.getFollowedUp(), 1);
  var reloaded = attachAssignments({ storageDir: f.dir, getProjects: function () { return f.projects; }, isMultiUser: function () { return true; }, sessionRef: function (slug, session) { return "ref:" + slug + ":" + (session.cliSessionId || session.localId); } });
  assert.equal(reloaded.records[0].delivery, "follow_up");
  assert.equal(reloaded.records[0].status, "interrupted");
  assert.equal(f.getFollowedUp(), 1);
  assert.equal(f.followUpSession.history.filter(function (event) { return event.type === "delegated_follow_up"; }).length, 1);
});

test("follow-up approval shares the per-user running assignment cap", async function (t) {
  var f = fixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.proposeFollowUp(f.principal, { projectSlug: "target", targetSessionRef: "ref:target:follow-cli", title: "Queued", task: "Wait for capacity." });
  for (var i = 0; i < 3; i++) f.service.records.push({ assignmentId: "busy-" + i, userId: "u1", status: "running" });
  await assert.rejects(f.service.respond(f.homeWs(), f.response(proposal, "approve"), "mate"), /Too many assignments/);
  assert.equal(f.followUpSession.history.length, 0);
  assert.equal(f.getFollowedUp(), 0);
});

test("delegated launcher resolves a concrete target model before creating one private session", async function () {
  var starts = [];
  var created = 0;
  var manager = {
    createSessionRaw: function (options) { created++; return { localId: 4, ownerId: options.ownerId, sessionVisibility: options.sessionVisibility, history: [], vendor: options.vendor, model: options.model, effort: options.effort || null, dangerouslySkipPermissions: false, permissionMode: null }; },
    broadcastSessionList: function () {},
    sendAndRecord: function (session, event) { session.history.push(event); },
  };
  var attached = attachDelegated({ sm: manager, resolveModel: function () { return Promise.resolve({ status: "ready", vendor: "claude", model: "sonnet", effort: "high" }); }, getSdk: function () { return { startQuery: function (session, task, images, linuxUser) { starts.push({ session: session, task: task, linuxUser: linuxUser }); } }; }, getLinuxUserForSession: function () { return "clay-u1"; } });
  var session = await attached.createDelegatedSession({ userId: "u1" }, "Only this bounded task", { assignmentId: "a1", title: "Task", sourceMateId: "mate", sourceProjectSlug: "mate-project", sourceSessionRef: "source-ref" });
  assert.equal(created, 1);
  assert.equal(session.sessionVisibility, "private");
  assert.equal(session.vendor, "claude");
  assert.equal(session.model, "sonnet");
  assert.equal(session.effort, "high");
  assert.equal(session.singleTurn, true);
  assert.equal(session.dangerouslySkipPermissions, false);
  assert.deepEqual(session.history.map(function (event) { return event.type; }), ["delegated_work"]);
  assert.equal(session.history[0].assignmentId, "a1");
  assert.equal(session.history.some(function (event) { return event.type === "user_message"; }), false);
  assert.equal(starts[0].task, "Only this bounded task");
  assert.equal(starts[0].linuxUser, "clay-u1");
});

test("catalog failure creates no target session", async function () {
  var created = 0;
  var attached = attachDelegated({
    sm: { createSessionRaw: function () { created++; }, broadcastSessionList: function () {} },
    resolveModel: function () { return Promise.resolve({ status: "error", error: "Sign in to a configured provider." }); },
    getSdk: function () { return { startQuery: function () {} }; },
    getLinuxUserForSession: function () { return null; },
  });
  await assert.rejects(attached.createDelegatedSession({ userId: "u1" }, "Task", { title: "Task" }), /Sign in/);
  assert.equal(created, 0);
});
