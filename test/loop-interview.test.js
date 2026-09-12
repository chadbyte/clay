var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var attachLoopInterview = require("../lib/project-loop-interview").attachLoopInterview;

var root = path.join(__dirname, "..");
function source(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

function interviewFixture(options) {
  var session = Object.assign({ localId: 7, mode: "gui", history: [], isProcessing: false, _queryStarting: false, autonomousRun: null, loopInterviewBrief: null }, options || {});
  var sent = [];
  var queries = 0;
  var sm = { saveSessionFile: function () {}, appendToSessionFile: function () {}, sendToSession: function (target, message) { sent.push(message); } };
  var service = attachLoopInterview({ sm: sm, sendTo: function (ws, message) { sent.push(message); }, sendToSession: function (id, message) { sent.push(message); },
    sdk: { startQuery: function () { queries += 1; return options && options.queryGate || Promise.resolve(); } }, autonomousRun: { startApprovedBrief: function () { return Promise.resolve(true); } },
    isMate: false, getSessionForWs: function () { return session; }, canAccess: function () { return options && options.denied ? false : true; },
    isDriverOperatedSession: function () { return !!(options && options.worker); }, onProcessingChanged: function () {}, ensureProjectAccessForSession: function () { return null; } });
  return { session: session, service: service, sent: sent, queries: function () { return queries; } };
}

test("pending interview startup preserves a proposal published before query completion", async function () {
  var resolveQuery;
  var queryGate = new Promise(function (resolve) { resolveQuery = resolve; });
  var f = interviewFixture({ queryGate: queryGate });
  f.service.handleMessage({}, { type: "loop_interview_start", sessionId: 7, requestId: "ordered" });
  assert.equal(f.sent.some(function (message) { return message.type === "loop_interview_start_result" && message.ok === true; }), true);
  var tool = f.service.getToolDefs(f.session)[0];
  await tool.handler({ objective: "Keep this brief", successCriteria: ["Brief remains visible"] });
  assert.equal(f.session.loopInterviewBrief.objective, "Keep this brief");
  resolveQuery();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.session.loopInterviewBrief.objective, "Keep this brief");
  assert.equal(f.sent.some(function (message) { return message.type === "loop_interview_brief" && message.brief && message.brief.objective === "Keep this brief"; }), true);
});

test("Loop interview lifecycle closes accepted interviews and rejects stale tools", async function () {
  var f = interviewFixture();
  f.service.handleMessage({}, { type: "loop_interview_start", sessionId: 7, requestId: "first" });
  await Promise.resolve();
  f.session.isProcessing = false;
  var oldTool = f.service.getToolDefs(f.session)[0];
  await oldTool.handler({ objective: "First", successCriteria: ["Evidence"] });
  var first = f.session.loopInterviewBrief;
  f.service.handleMessage({}, { type: "loop_interview_start_run", sessionId: 7, requestId: "run-1", proposalId: first.id, version: first.version });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.service.getToolDefs(f.session).length, 0);
  f.session.autonomousRun = { id: "waiting", state: "waiting-user" };
  f.session.isProcessing = false;
  f.service.handleMessage({}, { type: "loop_interview_start", sessionId: 7, requestId: "second" });
  await Promise.resolve();
  assert.equal(f.queries(), 1);
  f.session.autonomousRun = null;
  f.session.isProcessing = false;
  f.service.handleMessage({}, { type: "loop_interview_start", sessionId: 7, requestId: "third" });
  await Promise.resolve();
  f.session.isProcessing = false;
  var stale = JSON.parse((await oldTool.handler({ objective: "Stale", successCriteria: ["Wrong"] })).content[0].text);
  assert.equal(stale.status, "rejected");
  assert.equal(f.session.loopInterviewBrief, null);
});

test("Loop entry authorization, cancel revision, and replay deduplication are enforced", async function () {
  var denied = interviewFixture({ denied: true });
  denied.service.handleMessage({}, { type: "loop_interview_start", sessionId: 7, requestId: "denied" });
  assert.equal(denied.queries(), 0);
  var tui = interviewFixture({ mode: "tui" });
  tui.service.handleMessage({}, { type: "loop_interview_start", sessionId: 7, requestId: "tui" });
  assert.equal(tui.queries(), 0);
  var worker = interviewFixture({ worker: true });
  worker.service.handleMessage({}, { type: "loop_interview_start", sessionId: 7, requestId: "worker" });
  assert.equal(worker.queries(), 0);
  var f = interviewFixture();
  f.service.handleMessage({}, { type: "loop_interview_start", sessionId: 7, requestId: "once" });
  await Promise.resolve();
  f.session.isProcessing = false;
  f.service.handleMessage({}, { type: "loop_interview_start", sessionId: 7, requestId: "once" });
  assert.equal(f.queries(), 1);
  var tool = f.service.getToolDefs(f.session)[0];
  await tool.handler({ objective: "Task", successCriteria: ["Check"] });
  var brief = f.session.loopInterviewBrief;
  f.service.handleMessage({}, { type: "loop_interview_edit", sessionId: 7, proposalId: brief.id, version: brief.version, brief: { objective: "Edited", successCriteria: ["Check"] } });
  assert.equal(f.session.loopInterviewBrief.version, 2);
  f.service.handleMessage({}, { type: "loop_interview_cancel", sessionId: 7, proposalId: brief.id, version: brief.version });
  assert.notEqual(f.session.loopInterviewBrief, null);
  f.service.handleMessage({}, { type: "loop_interview_cancel", sessionId: 7, proposalId: brief.id, version: 2 });
  assert.equal(f.session.loopInterviewBrief, null);
});

test("composer exposes the bounded Loop interview icon and keeps run details", function () {
  var html = source("lib/public/index.html");
  assert.match(html, /id="loop-interview-btn"[^>]*aria-label="Start Loop interview"/);
  assert.match(html, /id="autonomous-run-status"/);
  assert.doesNotMatch(html, /id="execution-mode-wrap"/);
  assert.doesNotMatch(html, /id="execution-until-option"/);
});

test("Loop interview start is a separate normal-query action with no autonomous controls", function () {
  var server = source("lib/project-loop-interview.js");
  var guidance = source("lib/loop-guidance.js");
  var client = source("lib/public/modules/loop-interview.js");
  assert.match(server, /msg\.type === "loop_interview_start"/);
  assert.match(server, /hasInterview\(session, requestId\)/);
  assert.match(server, /driverEligibility\.isEligibleDriverSession/);
  assert.match(server, /session\.isProcessing \|\| session\._queryStarting/);
  assert.match(server, /ctx\.sdk\.startQuery\(session, prompt/);
  assert.match(guidance, /Do not execute, arm permissions/);
  assert.match(client, /loopInterviewStarting/);
  assert.doesNotMatch(client, /getElementById\("input"\)/); // The click path never reads or mutates composer text.
});

test("Loop interview guidance requires review before the existing Until complete handoff", function () {
  var server = source("lib/project-loop-interview.js");
  var guidance = source("lib/loop-guidance.js");
  assert.match(guidance, /concrete evidence-based completion checks/);
  assert.match(guidance, /Review the brief with the user/);
});

test("propose_loop is interview-scoped and Start delegates to the existing arm handler", function () {
  var moduleSource = source("lib/project-loop-interview.js");
  var projectSource = source("lib/project.js");
  assert.match(moduleSource, /name: "propose_loop"/);
  assert.match(moduleSource, /session\.loopInterviewBrief = next/);
  assert.match(moduleSource, /version: 1/);
  assert.match(moduleSource, /autonomousRun\.startApprovedBrief\(ws, session, proposal/);
  assert.match(moduleSource, /msg\.proposalId, 200\) !== proposal\.id/);
  assert.match(moduleSource, /Number\(msg\.version\) !== Number\(proposal\.version\)/);
  assert.match(moduleSource, /proposal\.interviewId !== currentInterview\(session\)/);
  assert.match(moduleSource, /sm\.sendToSession\(session/);
  assert.doesNotMatch(moduleSource, /fullAccess\.setEnabled|autonomousRun\.consume/);
  assert.match(projectSource, /_loopInterview\.getToolDefs\(session\)/);
  assert.match(projectSource, /_loopInterview\.handleMessage\(ws, msg\)/);
  assert.match(projectSource, /var interviewTools = _loopInterview \? _loopInterview\.getToolDefs\(boundSession\)/);
});

test("Loop brief and handoff state are persisted and replayed with session switches", function () {
  var sessions = source("lib/sessions.js");
  assert.match(sessions, /metaObj\.loopInterviewBrief = session\.loopInterviewBrief/);
  assert.match(sessions, /session\.loopInterviewBrief = m\.loopInterviewBrief/);
  assert.match(sessions, /loopInterviewBrief: session\.loopInterviewBrief \|\| null/);
  assert.match(sessions, /metaObj\.loopInterviewHandoff = session\.loopInterviewHandoff/);
});
