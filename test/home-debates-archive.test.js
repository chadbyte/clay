var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var attachHomeDebates = require("../lib/server-home-debates").attachHomeDebates;

var root = path.join(__dirname, "..");

function debateSession(id, ownerId, phase, activity, history) {
  return { localId: id, ownerId: ownerId, homeDebatePlanning: true, homeDebatePhase: phase, title: "Debate planning", createdAt: activity - 100, lastActivity: activity, history: history || [] };
}

function serverFixture() {
  var sessionsByMate = { clay: new Map(), analyst: new Map() };
  sessionsByMate.clay.set(1, debateSession(1, "u1", "planning", 10, []));
  sessionsByMate.clay.get(1).homeDebateInitialTopic = "Prefilled planning topic";
  sessionsByMate.clay.set(2, debateSession(2, "u1", "live", 70, [
    { type: "debate_started", topic: "Architecture direction", format: "round_robin", moderatorId: "clay", moderatorName: "Clay", panelists: [{ mateId: "analyst", name: "Analyst", role: "skeptic" }] },
    { type: "debate_turn_done", round: 2 },
  ]));
  sessionsByMate.clay.set(3, debateSession(3, "u1", "ended", 60, [{ type: "debate_ended", topic: "Ended", rounds: 3 }]));
  sessionsByMate.clay.set(4, debateSession(4, "u1", "interrupted", 50, []));
  sessionsByMate.clay.set(5, debateSession(5, "u1", "ended", 40, []));
  sessionsByMate.clay.set(6, debateSession(6, "u1", "ended", 30, []));
  sessionsByMate.analyst.set(7, debateSession(7, "u1", "ended", 20, [{ type: "debate_proposal", proposal: { topic: "Pricing", format: "free_discussion", panelists: [] } }]));
  sessionsByMate.clay.set(8, debateSession(8, "u2", "ended", 999, []));
  sessionsByMate.clay.set(9, { localId: 9, ownerId: "u1", title: "Debate: title heuristic only", createdAt: 1, lastActivity: 1000, history: [] });
  sessionsByMate.clay.set(10, Object.assign(debateSession(10, "u1", "ended", 1001, []), { hidden: true }));
  var allMates = [
    { id: "clay", builtinKey: "clay", profile: { displayName: "Clay" } },
    { id: "analyst", profile: { displayName: "Analyst" } },
  ];
  var messages = [];
  var archive = attachHomeDebates({
    mates: {
      buildMateCtx: function (userId) { return { userId: userId }; },
      getAllMates: function () { return allMates; },
    },
    findMateProject: function (userId, mateId) {
      return { slug: "mate-" + mateId, mate: allMates.filter(function (mate) { return mate.id === mateId; })[0], ctx: { getSessionManager: function () { return { sessions: sessionsByMate[mateId] }; } } };
    },
    ownsSession: function (session, userId) { return !session.hidden && session.ownerId === userId; },
    sessionReference: function (session) { return "local:" + session.localId; },
    sendMessage: function (ws, payload) { messages.push(payload); },
  });
  return { archive: archive, messages: messages };
}

test("debate archive is owned, metadata-driven, complete, and newest first", function () {
  var debates = serverFixture().archive.list("u1");
  assert.equal(debates.length, 7);
  assert.deepEqual(debates.map(function (debate) { return debate.lastActivity; }), [70, 60, 50, 40, 30, 20, 10]);
  assert.deepEqual(debates.map(function (debate) { return debate.phase; }), ["live", "ended", "interrupted", "ended", "ended", "ended", "planning"]);
  assert.equal(debates[0].sessionId, "local:2");
  assert.equal(debates[0].projectSlug, "mate-clay");
  assert.equal(debates[0].localId, 2);
  assert.equal(debates[0].topic, "Architecture direction");
  assert.equal(debates[0].round, 2);
  assert.equal(debates[6].topic, "Prefilled planning topic");
  assert.equal(debates.some(function (debate) { return debate.lastActivity === 1000 || debate.lastActivity === 999; }), false);
});

test("debate archive protocol returns the full exact-session list", function () {
  var fixture = serverFixture();
  assert.equal(fixture.archive.handle({}, "u1", { type: "home_debates_list", requestId: "archive-1" }), true);
  assert.equal(fixture.messages[0].type, "home_debates_state");
  assert.equal(fixture.messages[0].requestId, "archive-1");
  assert.equal(fixture.messages[0].status, "ready");
  assert.equal(fixture.messages[0].debates.length, 7);
});

test("retired Home archive stays detached while Debates routes to exact project chat sessions", function () {
  var markup = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var archive = fs.readFileSync(path.join(root, "lib/public/modules/debates-workbench.js"), "utf8");
  var planning = fs.readFileSync(path.join(root, "lib/public/modules/project-debate-planning-workspace.js"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/debates-workbench.css"), "utf8");
  var serverChat = fs.readFileSync(path.join(root, "lib/server-home-chat.js"), "utf8");
  var project = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var router = fs.readFileSync(path.join(root, "lib/public/modules/app-message-router.js"), "utf8");
  var mobile = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-mobile.js"), "utf8");
  assert.doesNotMatch(markup, /id="home-debates-archive"|id="home-hub"/);
  assert.match(archive, /pendingDebateNavigation: \{ projectSlug: row\.dataset\.projectSlug, sessionId: localId \}/);
  assert.match(archive, /if \(narrowLayout\(\)\) closeDebatesWorkbench\(false\);[\s\S]*switchProject\(row\.dataset\.projectSlug\)/);
  assert.match(archive, /startProjectDebatePlanning\(topic\)/);
  assert.match(archive, /failureText\.textContent = store\.get\('debatesWorkbenchError'\)/);
  assert.doesNotMatch(archive, /innerHTML\s*=\s*[^;]*(?:msg\.error|debatesWorkbenchError)/);
  assert.match(archive, /event\.key === 'Escape'[\s\S]*closeDebatesWorkbench\(true\)/);
  assert.match(archive, /event\.key !== 'Tab' \|\| !narrowLayout\(\)/);
  assert.match(archive, /element\.inert = true/);
  assert.match(archive, /debatesWorkbenchScrollTop: list\.scrollTop/);
  assert.match(archive, /projectDebatePlanningError[^\n]*Clay is unavailable/);
  assert.match(planning, /openMateWorkspace\(clay\.id\)/);
  assert.match(planning, /type: 'home_mate_debate_plan'/);
  assert.match(planning, /type: 'switch_session', id: msg\.localId/);
  assert.match(css, /\.debates-workbench-filter \{ height: 26px/);
  assert.match(css, /\.debates-workbench-row \{[^}]*min-height: 46px/);
  assert.match(css, /\.debates-workbench-row:focus-visible[\s\S]*outline: 2px solid var\(--accent\)/);
  assert.match(css, /\.debates-workbench-new \{[^}]*background: var\(--accent\);[^}]*color: #fff/);
  assert.doesNotMatch(archive, /slice\(0,\s*5\)|MAX_(?:DEBATE|ARCHIVE)/i);
  assert.match(serverChat, /homeDebates\.handle\(ws, userId, msg\)/);
  assert.match(project, /msg\.type === "home_debates_list"[\s\S]*opts\.onDmMessage\(ws, msg, slug\)/);
  assert.match(router, /msg\.type === "home_debates_state"[\s\S]*handleDebatesWorkbenchState\(msg\)/);
  assert.match(mobile, /label: "Debates", action: "debates"/);
  assert.match(mobile, /item\.action === "debates"[\s\S]*targetId = "debates-btn"/);
});
