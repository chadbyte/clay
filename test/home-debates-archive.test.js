var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;
var attachHomeDebates = require("../lib/server-home-debates").attachHomeDebates;

var root = path.join(__dirname, "..");

function debateSession(id, ownerId, phase, activity, history) {
  return {
    localId: id,
    ownerId: ownerId,
    homeDebatePlanning: true,
    homeDebatePhase: phase,
    title: "Debate planning",
    createdAt: activity - 100,
    lastActivity: activity,
    history: history || [],
  };
}

function serverFixture() {
  var sessionsByMate = {
    clay: new Map(),
    analyst: new Map(),
  };
  sessionsByMate.clay.set(1, debateSession(1, "u1", "planning", 10, []));
  sessionsByMate.clay.get(1).homeDebateInitialTopic = "Prefilled planning topic";
  sessionsByMate.clay.set(2, debateSession(2, "u1", "live", 70, [{
    type: "debate_started", topic: "Architecture direction", format: "round_robin", moderatorId: "clay", moderatorName: "Clay",
    panelists: [{ mateId: "analyst", name: "Analyst", role: "skeptic" }],
  }, { type: "debate_turn_done", round: 2 }]));
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
      return { mate: allMates.filter(function (mate) { return mate.id === mateId; })[0], ctx: { getSessionManager: function () { return { sessions: sessionsByMate[mateId] }; } } };
    },
    ownsSession: function (session, userId) { return !session.hidden && session.ownerId === userId; },
    sessionReference: function (session) { return "local:" + session.localId; },
    sendMessage: function (ws, payload) { messages.push(payload); },
  });
  return { archive: archive, messages: messages };
}

test("Home debate archive is owned, metadata-driven, complete, and newest first", function () {
  var fixture = serverFixture();
  var debates = fixture.archive.list("u1");
  assert.equal(debates.length, 7);
  assert.deepEqual(debates.map(function (debate) { return debate.lastActivity; }), [70, 60, 50, 40, 30, 20, 10]);
  assert.deepEqual(debates.map(function (debate) { return debate.phase; }), ["live", "ended", "interrupted", "ended", "ended", "ended", "planning"]);
  assert.equal(debates[0].sessionId, "local:2");
  assert.equal(debates[0].topic, "Architecture direction");
  assert.equal(debates[0].format, "round_robin");
  assert.equal(debates[0].round, 2);
  assert.equal(debates[6].topic, "Prefilled planning topic");
  assert.deepEqual(debates[0].participants, [
    { mateId: "clay", name: "Clay", role: "moderator" },
    { mateId: "analyst", name: "Analyst", role: "skeptic" },
  ]);
  assert.equal(debates.some(function (debate) { return debate.lastActivity === 1000 || debate.lastActivity === 999; }), false);
});

test("Home debate archive protocol returns the full exact-session list", function () {
  var fixture = serverFixture();
  assert.equal(fixture.archive.handle({}, "u1", { type: "home_debates_list", requestId: "archive-1" }), true);
  assert.equal(fixture.messages.length, 1);
  assert.equal(fixture.messages[0].type, "home_debates_state");
  assert.equal(fixture.messages[0].requestId, "archive-1");
  assert.equal(fixture.messages[0].status, "ready");
  assert.equal(fixture.messages[0].debates.length, 7);
});

function FakeElement(tag, documentRef) {
  this.tagName = tag.toUpperCase();
  this.ownerDocument = documentRef;
  this.children = [];
  this.attributes = {};
  this.listeners = {};
  this.dataset = {};
  this.className = "";
  this.hidden = false;
  this.textContent = "";
  var target = this;
  this.classList = {
    add: function (name) { target.className = (target.className + " " + name).trim(); },
    remove: function (name) { target.className = target.className.split(/\s+/).filter(function (item) { return item && item !== name; }).join(" "); },
    toggle: function (name, enabled) {
      var names = target.className.split(/\s+/).filter(Boolean).filter(function (item) { return item !== name; });
      if (enabled) names.push(name);
      target.className = names.join(" ");
    },
  };
  Object.defineProperty(this, "innerHTML", { get: function () { return ""; }, set: function () { target.children = []; } });
}
FakeElement.prototype.appendChild = function (child) { this.children.push(child); child.parentNode = this; return child; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.removeAttribute = function (name) { delete this.attributes[name]; };
FakeElement.prototype.addEventListener = function (name, listener) { this.listeners[name] = listener; };
FakeElement.prototype.click = function () { if (this.listeners.click) this.listeners.click({ currentTarget: this }); };
FakeElement.prototype.getClientRects = function () { return [1]; };
FakeElement.prototype.focus = function (options) { this.ownerDocument.activeElement = this; this.focusOptions = options; };

test("opening Debates owns the full Home stage and sends only an archive request", async function () {
  var originalDocument = global.document;
  var originalWindow = global.window;
  var originalLucide = global.lucide;
  var originalRaf = global.requestAnimationFrame;
  var originalLocalStorage = global.localStorage;
  var originalMarked = global.marked;
  var originalMermaid = global.mermaid;
  var elements = {};
  var continuationQueries = 0;
  var documentRef = {
    activeElement: null,
    body: null,
    createElement: function (tag) { return new FakeElement(tag, documentRef); },
    getElementById: function (id) { return elements[id] || null; },
    querySelector: function (selector) { return selector === ".home-mate-chat-composer-frame" ? elements.composer : null; },
    querySelectorAll: function (selector) {
      if (selector === "[data-driver-continuation-key]") continuationQueries++;
      return [];
    },
    addEventListener: function () {},
    removeEventListener: function () {},
  };
  documentRef.body = new FakeElement("body", documentRef);
  var ids = ["home-debates-archive", "home-mate-chat", "home-mate-chat-messages", "home-mate-chat-suggestions", "home-sidebar-debate", "home-debates-title", "home-debates-summary", "home-debates-list", "home-debates-new", "home-debates-topic-form", "home-debates-topic", "home-debates-topic-status", "home-debates-topic-cancel", "home-debates-topic-submit"];
  for (var i = 0; i < ids.length; i++) elements[ids[i]] = new FakeElement("div", documentRef);
  elements.composer = new FakeElement("div", documentRef);
  var sent = [];
  global.document = documentRef;
  global.window = {};
  global.lucide = { createIcons: function () {} };
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
  global.marked = { use: function () {}, parse: function (value) { return value; } };
  global.mermaid = { initialize: function () {} };
  try {
    var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
    var wsModule = await import(pathToFileURL(path.join(root, "lib/public/modules/ws-ref.js")).href);
    var archiveModule = await import(pathToFileURL(path.join(root, "lib/public/modules/home-debates-archive.js")).href);
    storeModule.createStore({ homeSubSurface: "chat", homeDebatesStatus: "idle", homeDebates: [], connected: true, cachedMatesList: [{ id: "builtin:clay", builtinKey: "clay" }], homeActiveSessionByMate: {}, homeSurfaceLoaded: true });
    wsModule.setWs({ readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } });
    archiveModule.initHomeDebatesArchive();
    archiveModule.openHomeDebatesArchive();
    assert.equal(continuationQueries, 0, "unrelated Home state must not scan continuation cards");
    assert.equal(storeModule.store.get('homeSubSurface'), "debates");
    assert.equal(elements["home-debates-archive"].hidden, false);
    assert.equal(elements["home-mate-chat-messages"].hidden, true);
    assert.equal(elements.composer.hidden, true);
    assert.equal(elements["home-mate-chat-suggestions"].hidden, true);
    assert.equal(elements["home-sidebar-debate"].attributes["aria-pressed"], "true");
    assert.equal(documentRef.activeElement, elements["home-debates-title"]);
    assert.deepEqual(elements["home-debates-title"].focusOptions, { preventScroll: true });
    assert.deepEqual(sent.map(function (message) { return message.type; }), ["home_surface_set", "home_debates_list"]);
    assert.equal(sent.some(function (message) { return /new_session|debate_plan/.test(message.type); }), false);

    archiveModule.handleHomeDebatesState({ type: "home_debates_state", requestId: sent[1].requestId, status: "error", error: "Temporary failure", debates: [] });
    assert.equal(elements["home-debates-summary"].textContent, "Debates could not be loaded.");
    assert.equal(elements["home-debates-list"].children[0].children[3].textContent, "Retry");
    elements["home-debates-list"].children[0].children[3].click();
    assert.equal(sent[sent.length - 1].type, "home_debates_list");

    archiveModule.handleHomeDebatesState({ type: "home_debates_state", requestId: sent[sent.length - 1].requestId, status: "ready", debates: [] });
    assert.equal(elements["home-debates-summary"].textContent, "No debates yet");
    assert.equal(elements["home-debates-list"].children[0].children[1].textContent, "Your debate archive is empty");

    archiveModule.handleHomeDebatesState({ type: "home_debates_state", requestId: sent[sent.length - 1].requestId, status: "ready", debates: Array.from({ length: 7 }, function (_, index) {
      return { mateId: "clay", sessionId: "local:" + index, title: "Debate " + index, phase: "ended", participants: [], lastActivity: 100 - index };
    }) });
    assert.equal(elements["home-debates-list"].children.length, 7);
    assert.equal(elements["home-debates-summary"].textContent, "7 debates");
    elements["home-debates-new"].click();
    assert.equal(elements["home-debates-topic-form"].hidden, false);
    assert.equal(documentRef.activeElement, elements["home-debates-topic"]);
    assert.equal(sent.filter(function (message) { return message.type === "home_mate_debate_plan"; }).length, 0);
    elements["home-debates-topic-form"].listeners.submit({ preventDefault: function () {} });
    assert.equal(elements["home-debates-topic-status"].textContent, "Enter a topic to start the debate.");
    elements["home-debates-topic"].value = "Should Clay prioritize local-first storage?";
    delete elements["home-mate-chat"];
    elements["home-debates-topic-form"].listeners.submit({ preventDefault: function () {} });
    assert.equal(sent.filter(function (message) { return message.type === "home_mate_debate_plan"; }).length, 1);
    assert.equal(sent.filter(function (message) { return message.type === "home_mate_debate_plan"; })[0].topic, "Should Clay prioritize local-first storage?");
    assert.equal(storeModule.store.get('homeSubSurface'), "chat");
    assert.equal(elements["home-debates-archive"].hidden, true);
  } finally {
    global.document = originalDocument;
    global.window = originalWindow;
    global.lucide = originalLucide;
    global.requestAnimationFrame = originalRaf;
    global.localStorage = originalLocalStorage;
    global.marked = originalMarked;
    global.mermaid = originalMermaid;
  }
});

test("archive source uses exact chat restore and New debate is the only launch path", function () {
  var archive = fs.readFileSync(path.join(root, "lib/public/modules/home-debates-archive.js"), "utf8");
  var sidebar = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
  var hub = fs.readFileSync(path.join(root, "lib/public/modules/app-home-hub.js"), "utf8");
  var connection = fs.readFileSync(path.join(root, "lib/public/modules/app-connection.js"), "utf8");
  var surface = fs.readFileSync(path.join(root, "lib/public/modules/home-surface.js"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/home-debates-archive.css"), "utf8");
  var serverChat = fs.readFileSync(path.join(root, "lib/server-home-chat.js"), "utf8");
  var project = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var router = fs.readFileSync(path.join(root, "lib/public/modules/app-message-router.js"), "utf8");
  var schema = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");
  assert.match(archive, /openHomeConversation\(debate\.mateId, debate\.sessionId\)/);
  assert.match(archive, /function startNewDebate\(\)[\s\S]*homeDebateTopicFormOpen: true/);
  assert.match(archive, /function submitNewDebate\(event\)[\s\S]*openHomeMateAction\("debate", topic\.slice\(0, 1000\)\)/);
  assert.match(sidebar, /function openDebatesFromSidebar\(\)[\s\S]*openHomeDebatesArchive\(\)[\s\S]*closeNarrowDrawer\(false\)/);
  assert.doesNotMatch(sidebar, /openHomeMateAction\("debate"\)|openMateActionFromSidebar/);
  assert.match(hub, /if \(!restoreHomeDebatesArchive\(\) && state\.homeChatMateId\) resumeHomeChat\(\)/);
  assert.match(hub, /activeMateId && !resume && !isHomeDebatesSurface\(\)/);
  assert.match(connection, /homeSurfaceLoaded'\) && !isHomeDebatesSurface\(\)\) resumeHomeChat\(\)/);
  assert.match(surface, /subSurface: normalizeSubSurface\(state\.homeSubSurface\)/);
  assert.match(surface, /homeSubSurface: normalizeSubSurface\(preference\.subSurface\)/);
  assert.match(css, /\.home-debates-list \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /\.home-debates-topic-form textarea[\s\S]*resize: vertical/);
  assert.doesNotMatch(archive, /slice\(0,\s*5\)|MAX_(?:DEBATE|ARCHIVE)/i);
  assert.match(serverChat, /homeDebates\.handle\(ws, userId, msg\)/);
  assert.match(project, /msg\.type === "home_debates_list"[\s\S]*opts\.onDmMessage\(ws, msg, slug\)/);
  assert.match(router, /msg\.type === "home_debates_state"[\s\S]*handleHomeDebatesState\(msg\)/);
  assert.match(schema, /"home_debates_list"[\s\S]*"home_debates_state"/);
});
