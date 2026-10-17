var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachFollowUp = require("../lib/project-delegated-follow-up").attachDelegatedFollowUp;
var unsafeReason = require("../lib/project-delegated-follow-up").unsafeReason;
var attachAssignments = require("../lib/workspace-assignment-service").attachWorkspaceAssignmentService;

function ref(slug, session) { return "session:" + slug + ":" + (session.cliSessionId || session.localId); }

function targetFixture(options) {
  var opts = options || {};
  var session = {
    localId: 4, cliSessionId: "cli-target", ownerId: "u1", sessionVisibility: "private",
    vendor: "claude", mode: "gui", permissionMode: "default", history: [], pendingPermissions: {}, pendingAskUser: {},
    isProcessing: false, title: "Parser audit",
  };
  var sessions = new Map([[4, session]]);
  var events = [];
  var starts = [];
  var pushes = [];
  var activeSessionId = 99;
  var sm = {
    sessions: sessions,
    sendAndRecord: function (target, event) { target.history.push(event); events.push(event); },
    broadcastSessionList: function () {},
  };
  var api = attachFollowUp({
    sm: sm,
    isMultiUser: function () { return true; },
    sessionRef: function (target) { return ref("target", target); },
    isPairedSession: function (target) { return !!target.paired; },
    canResumeVendor: function (vendor) { return vendor === "claude"; },
    getSdk: function () { return {
      pushMessage: function (target, task) { pushes.push([target.localId, task]); return false; },
      startQuery: function (target, task, images, linuxUser) { starts.push([target.localId, task, images, linuxUser]); if (opts.startError) throw new Error(opts.startError); },
    }; },
    getLinuxUserForSession: function () { return "clay-u1"; },
  });
  return { api: api, sm: sm, session: session, events: events, starts: starts, pushes: pushes, active: function () { return activeSessionId; } };
}

test("follow-up target requires a durable private owned idle ordinary resumable session", function () {
  var f = targetFixture();
  assert.equal(f.api.inspectDelegatedFollowUp({ userId: "u1" }, ref("target", f.session)).session, f.session);
  assert.throws(function () { f.api.inspectDelegatedFollowUp({ userId: "u2" }, ref("target", f.session)); }, /denied/);
  assert.throws(function () { f.api.inspectDelegatedFollowUp({ userId: "u1" }, "local:4"); }, /durable opaque/);
  var unsafe = [
    { hidden: true }, { cliSessionId: null }, { sessionVisibility: "shared" }, { isProcessing: true },
    { pendingPermissions: { p: true } }, { pendingAskUser: { q: true } }, { mode: "tui" },
    { runtimeMode: "tui" }, { homeDebatePlanning: true }, { debateState: {} }, { loop: {} },
    { taskStopRequested: true }, { _pendingMessageDrainPaused: true }, { spawn: {} }, { handoff: {} }, { assignment: {} }, { _pairDelegation: {} }, { scheduledMessage: {} },
  ];
  for (var i = 0; i < unsafe.length; i++) {
    var candidate = Object.assign({}, f.session, unsafe[i]);
    assert.notEqual(unsafeReason(candidate, false), "", "unsafe class " + i + " must be rejected");
  }
  assert.notEqual(unsafeReason(f.session, true), "");
  f.session.vendor = "non-resumable";
  assert.throws(function () { f.api.inspectDelegatedFollowUp({ userId: "u1" }, ref("target", f.session)); }, /cannot safely resume/);
});

test("approved target dispatch records orchestration without a user bubble or active-session change", async function () {
  var f = targetFixture();
  var beforeSize = f.sm.sessions.size;
  var beforeActive = f.active();
  await f.api.dispatchDelegatedFollowUp({ userId: "u1" }, ref("target", f.session), "Check the parser edge case.", { assignmentId: "a1", sourceMateId: "mate-1", sourceProjectSlug: "mate", sourceSessionRef: "source-ref" });
  assert.equal(f.sm.sessions.size, beforeSize);
  assert.equal(f.active(), beforeActive);
  assert.deepEqual(f.session.history.map(function (event) { return event.type; }), ["delegated_follow_up"]);
  assert.equal(f.session.history.some(function (event) { return event.type === "user_message"; }), false);
  assert.equal(f.events[0].assignmentId, "a1");
  assert.equal(f.session.permissionMode, "default");
  assert.deepEqual(f.pushes, [[4, "Check the parser edge case."]]);
  assert.deepEqual(f.starts, [[4, "Check the parser edge case.", undefined, "clay-u1"]]);
});

test("follow-up dispatch failure clears processing without disguising the audit event", async function () {
  var f = targetFixture({ startError: "Provider resume failed" });
  await assert.rejects(f.api.dispatchDelegatedFollowUp({ userId: "u1" }, ref("target", f.session), "Check parser.", { assignmentId: "a-error", sourceMateId: "mate-1", sourceProjectSlug: "mate", sourceSessionRef: "source-ref" }), /Provider resume failed/);
  assert.equal(f.session.isProcessing, false);
  assert.deepEqual(f.session.history.map(function (event) { return event.type; }), ["delegated_follow_up", "error"]);
  assert.equal(f.session.history[1].text, "Delegated follow-up could not start: Provider resume failed");
});

function assignmentFixture() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-follow-up-"));
  var source = { localId: 1, cliSessionId: "source-cli", ownerId: "u1", history: [] };
  var sourceManager = { sessions: new Map([[1, source]]), sendAndRecord: function (session, event) { session.history.push(event); } };
  var target = targetFixture();
  var subscribers = {};
  target.sm.subscribeSession = function (id, callback) { subscribers[id] = callback; return function () { delete subscribers[id]; }; };
  var targetProject = {
    getStatus: function () { return { title: "Target", projectOwnerId: "u1", isMate: false, isWorktree: false }; },
    getSessionManager: function () { return target.sm; },
    inspectDelegatedFollowUp: target.api.inspectDelegatedFollowUp,
    dispatchDelegatedFollowUp: target.api.dispatchDelegatedFollowUp,
  };
  var projects = new Map([
    ["mate", { getStatus: function () { return { projectOwnerId: "u1", isMate: true, mateId: "mate-1" }; }, getSessionManager: function () { return sourceManager; } }],
    ["target", targetProject],
  ]);
  var service = attachAssignments({ storageDir: dir, getProjects: function () { return projects; }, isMultiUser: function () { return true; }, sessionRef: function (slug, session) { return ref(slug, session); } });
  var principal = { userId: "u1", mateId: "mate-1", sourceProjectSlug: "mate", sourceSessionId: 1, sourceSessionRef: ref("mate", source), sourceRequestId: "req-1" };
  var ws = { _clayUser: { id: "u1" }, _homeChatTap: { mateSlug: "mate", mateId: "mate-1", sessionId: 1, sessionReference: "source-cli", requestId: "req-1" } };
  function response(record) { return { assignmentId: record.assignmentId, action: "approve", surface: "home", sourceProjectSlug: "mate", sourceSessionRef: ref("mate", source), mateId: "mate-1", sessionId: "source-cli", requestId: "req-1" }; }
  return { dir: dir, service: service, principal: principal, ws: ws, response: response, target: target, targetProject: targetProject, subscribers: subscribers };
}

test("follow-up proposal mutates nothing, then approval revalidates and completes once", async function (t) {
  var f = assignmentFixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.proposeFollowUp(f.principal, { projectSlug: "target", targetSessionRef: ref("target", f.target.session), title: "Parser follow-up", task: "Check the parser." });
  assert.equal(proposal.delivery, "follow_up");
  assert.equal(proposal.targetSessionRef, ref("target", f.target.session));
  assert.equal(proposal.targetSessionTitle, "Parser audit");
  assert.equal(f.target.session.history.length, 0);
  var running = await f.service.respond(f.ws, f.response(proposal), "mate");
  assert.equal(running.status, "running");
  assert.equal(f.target.session.history[0].type, "delegated_follow_up");
  var retry = f.service.proposeFollowUp(f.principal, { projectSlug: "target", targetSessionRef: ref("target", f.target.session), title: "Parser follow-up", task: "Check the parser." });
  assert.equal(retry.assignmentId, proposal.assignmentId);
  assert.equal(f.target.session.history.length, 1);
  f.target.session.history.push({ type: "delta", text: "Parser is safe." });
  f.subscribers[4]({ type: "result" });
  if (f.subscribers[4]) f.subscribers[4]({ type: "done" });
  assert.equal(f.service.records[0].status, "completed");
  assert.equal(f.service.records[0].resultSummary, "Parser is safe.");
});

test("follow-up approval rechecks target state and fails without dispatch", async function (t) {
  var f = assignmentFixture();
  t.after(function () { fs.rmSync(f.dir, { recursive: true, force: true }); });
  var proposal = f.service.proposeFollowUp(f.principal, { projectSlug: "target", targetSessionRef: ref("target", f.target.session), title: "Parser follow-up", task: "Check the parser." });
  f.target.session.isProcessing = true;
  var failed = await f.service.respond(f.ws, f.response(proposal), "mate");
  assert.equal(failed.status, "failed");
  assert.equal(f.target.session.history.length, 0);
  assert.match(failed.error, /idle/);
});
