var test = require("node:test");
var assert = require("node:assert/strict");
var attachSessions = require("../lib/project-sessions").attachSessions;

// Plan feedback is injected into a running turn, so restored history must be
// able to tell it apart from a user message that starts a new turn.
test("plan deny_with_feedback records a flagged mid-turn user message and pushes it to the running query", async function () {
  var recorded = [];
  var sent = [];
  var pushed = [];
  var started = [];
  var resolved = null;
  var session = {
    localId: 4, history: [], isProcessing: true, queryInstance: {},
    pendingPermissions: { "plan-1": { toolName: "ExitPlanMode", toolInput: {}, resolve: function (value) { resolved = value; } } },
  };
  var manager = {
    currentPermissionMode: "default",
    permissionRequestIndex: { "plan-1": 4 },
    sessions: new Map([[4, session]]),
    sendAndRecord: function (target, event) { target.history.push(event); recorded.push(event); },
    appendToSessionFile: function (target, event) { recorded.push(event); },
  };
  var sessions = attachSessions({
    cwd: "/tmp/project", slug: "project", isMate: false, osUsers: null,
    currentVersion: "test", sm: manager, tm: {}, clients: new Set(),
    sdk: {
      startQuery: function (target, text) { started.push(text); },
      pushMessage: function (target, text) { pushed.push(text); return true; },
    },
    send: function () {}, sendTo: function () {}, sendToAdmins: function () {},
    sendToSession: function (id, msg) { sent.push(msg); }, sendToSessionOthers: function () {},
    opts: {}, usersModule: {}, userPresence: {}, matesModule: {}, getSessionForWs: function () { return session; },
    getLinuxUserForSession: function () {}, ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {},
    hydrateImageRefs: function () {}, onProcessingChanged: function () {}, broadcastPresence: function () {}, adapter: {},
  });
  var ws = { readyState: 1, _clayActiveSession: 4 };
  assert.equal(sessions.handleSessionsMessage(ws, { type: "permission_response", requestId: "plan-1", decision: "deny_with_feedback", feedback: "Use smaller steps" }), true);
  assert.equal(resolved.behavior, "deny");
  await new Promise(function (resolve) { setTimeout(resolve, 260); });
  var feedback = session.history.filter(function (event) { return event.type === "user_message"; });
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].text, "Use smaller steps");
  assert.equal(feedback[0].planFeedback, true);
  assert.equal(sent.filter(function (msg) { return msg.type === "user_message"; })[0].planFeedback, true, "live clients receive the same flag");
  assert.deepEqual(pushed, ["Use smaller steps"], "the running query receives the feedback");
  assert.deepEqual(started, []);
});
