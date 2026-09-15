var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attachHomeMateCreation = require("../lib/server-home-mate-creation").attachHomeMateCreation;
var prompt = require("../lib/server-home-mate-creation").INITIATION_PROMPT;
var attachProposal = require("../lib/project-mate-creation-proposal").attachMateCreationProposal;
var readyCreation = require("../lib/mate-ready-creation");
var homeEvents = require("../lib/server-home-chat-events");
var firstQuestion = require("../lib/server-home-mate-creation").FIRST_QUESTION;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

function settle() { return new Promise(function (resolve) { setImmediate(resolve); }); }

test("Clay-led Mate creation presents its fixed opening question before starting a model", async function () {
  var sessions = new Map();
  var starts = [];
  var pushes = [];
  var nextId = 1;
  var manager = {
    sessions: sessions,
    createSession: function (options) { var session = { localId: nextId++, ownerId: options.ownerId, vendor: options.vendor, model: options.model, effort: options.effort || null, history: [], pendingAskUser: {}, isProcessing: false }; sessions.set(session.localId, session); return session; },
    sendAndRecord: function (session, event) { session.history.push(event); },
    saveSessionFile: function () {},
  };
  var found = { mate: { id: "clay", builtinKey: "clay" }, ctx: { getSessionManager: function () { return manager; }, sdk: { pushMessage: function (session, text) { pushes.push({ session: session, text: text }); return true; }, startQuery: function (session, text) { starts.push({ session: session, text: text }); } } } };
  var histories = [];
  var creation = attachHomeMateCreation({
    findMateProject: function () { return found; }, resolveHomeSession: function (value, userId, ref) { return ref === "local:1" ? sessions.get(1) : null; }, sessionReference: function (session) { return "local:" + session.localId; },
    setupTap: function (ws, value, localId, requestId) { ws._homeChatTap = { mateId: value.mate.id, sessionId: localId, requestId: requestId }; }, sendHistory: function (ws, value, session) { histories.push(session); }, sendSessionList: function () {}, sendError: function () {}, sendModelError: function () {},
    homeModels: { resolveMateModel: function () { return Promise.resolve({ vendor: "codex", model: "gpt-6-astra", effort: "high" }); } },
  });
  var ws = { _homeMateCreationRequests: {}, readyState: 1 };
  creation.start(ws, "u1", { requestId: "create-1" });
  await settle();
  creation.start(ws, "u1", { requestId: "create-1" });
  await settle();
  assert.equal(sessions.size, 1);
  var session = Array.from(sessions.values())[0];
  assert.equal(session.title, "New Mate");
  assert.equal(session.mateCreationMode, true);
  assert.equal(session.homeMateCreationPhase, "interview");
  assert.deepEqual({ vendor: session.vendor, model: session.model, effort: session.effort }, { vendor: "codex", model: "gpt-6-astra", effort: "high" });
  assert.equal(starts.length, 0);
  assert.equal(session.history.some(function (event) { return event.type === "user_message"; }), false);
  assert.equal(session.history.filter(function (event) { return event.type === "home_mate_creation_started"; }).length, 1);
  var opening = session.history.filter(function (event) { return event.type === "tool_executing"; })[0];
  assert.equal(opening.input.questions[0].question, firstQuestion.question);
  assert.deepEqual(opening.input.questions[0].options, []);
  assert.equal(histories.length >= 1, true);
  creation.respondToQuestion(ws, "u1", { mateId: "clay", sessionId: "local:1", requestId: "create-1", toolId: opening.id, answers: { 0: "A research partner who challenges my assumptions" } });
  await settle();
  assert.equal(starts.length, 1);
  assert.match(starts[0].text, /A research partner who challenges my assumptions/);
  assert.equal(session.history.filter(function (event) { return event.type === "ask_user_answered"; }).length, 1);
  assert.match(prompt, /Clay facilitating the creation/);
  assert.doesNotMatch(prompt, /\/clay-mate-interview/);
  assert.match(prompt, /complete Mate interview contract/);
  assert.match(prompt, /Do not invoke Skill, read SKILL\.md/);
  assert.match(prompt, /Before the user answers again, your first and only action must be the next most useful AskUserQuestion/);
  assert.match(prompt, /When that tool returns the user's answer, continue the interview normally/);
  assert.match(prompt, /do not use Bash, Read, Glob, Grep/);
  assert.match(prompt, /do not bulk-read knowledge files/);
  assert.match(prompt, /exactly one focused question at a time/);
  assert.match(prompt, /already answered the fixed opening question/);
  assert.match(prompt, /propose_mate/);
  assert.match(prompt, /Do not write files/);
  session.isProcessing = false;
  session.onTurnDone(session);
  await settle();
  assert.equal(starts.length, 1);
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].text, /Continue the Mate creation interview/);
});

test("an answered AI interview question resumes in the exact session when its provider turn ends", function () {
  var starts = [];
  var pushes = [];
  var session = {
    localId: 9,
    ownerId: "u1",
    mateCreationMode: true,
    homeMateCreationPhase: "interview",
    vendor: "codex",
    model: "gpt",
    isProcessing: false,
    history: [
      { type: "home_mate_creation_query_started", internal: true },
      { type: "tool_executing", name: "AskUserQuestion", id: "provider-question-1", input: { questions: [{ header: "Role", question: "Who should it help?", options: [] }] } },
      { type: "ask_user_answered", toolId: "provider-question-1", answers: { 0: "My team" } },
      { type: "result" },
      { type: "done" },
    ],
  };
  var manager = { sessions: new Map([[9, session]]), sendAndRecord: function (target, event) { target.history.push(event); } };
  var found = { mate: { id: "clay", builtinKey: "clay" }, ctx: { getSessionManager: function () { return manager; }, sdk: { pushMessage: function (target, text) { pushes.push({ target: target, text: text }); return false; }, startQuery: function (target, text) { starts.push({ target: target, text: text }); } } } };
  var creation = attachHomeMateCreation({
    findMateProject: function () { return found; },
    resolveHomeSession: function () { return session; },
    sessionReference: function () { return "durable-session"; },
    setupTap: function (ws) { ws._homeChatTap = { mateId: "clay", sessionId: 9, requestId: "resume-1" }; },
    sendHistory: function () {}, sendSessionList: function () {}, sendError: function () {}, sendModelError: function () {},
    homeModels: { resolveMateModel: function () { throw new Error("model lookup should not run"); } },
  });
  creation.start({ readyState: 1 }, "u1", { requestId: "resume-1", sessionId: "durable-session" });
  assert.equal(starts.length, 1);
  assert.equal(pushes.length, 1);
  assert.equal(starts[0].target, session);
  assert.match(starts[0].text, /latest structured answer/);
  assert.equal(session.isProcessing, true);
});

test("the exact Mate creation proposal tool opens its approval card without a permission prompt", async function () {
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: { currentPermissionMode: "default" },
    adapter: { vendor: "codex" },
    send: function () {},
    onProcessingChanged: function () {},
  });
  var input = { name: "Atlas" };
  var session = {
    mateCreationMode: true,
    history: [
      { type: "tool_executing", name: "AskUserQuestion", id: "provider-question-1" },
      { type: "ask_user_answered", toolId: "provider-question-1", answers: { 0: "A planning partner" } },
    ],
  };
  var decision = await bridge.handleCanUseTool(session, "propose_mate", input, {});
  assert.equal(decision.behavior, "allow");
  assert.equal(decision.updatedInput, input);
  assert.equal(bridge.checkToolWhitelist("propose_mate", input), null);
});

test("Mate proposal is exact-session bound and creates only after approval", async function () {
  var records = [];
  var created = [];
  var proposal = attachProposal({
    isMate: true, isHostAgent: true, isMultiUser: function () { return true; }, getProjectOwnerId: function () { return "u1"; },
    recordSessionEvent: function (session, event) { session.history.push(event); records.push(event); },
    getVendorModelCatalog: function (ws, vendor) {
      if (vendor === "codex") return Promise.resolve({ status: "ready", defaultModel: "gpt-5.6-terra", models: [{ value: "gpt-5.6-terra", displayName: "GPT-5.6 Terra" }, { value: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" }] });
      return Promise.resolve({ status: "ready", defaultModel: "sonnet", models: [{ value: "sonnet", displayName: "Sonnet" }, { value: "opus", displayName: "Opus" }] });
    },
    createReadyMate: function (ws, userId, definition) { created.push({ ws: ws, userId: userId, definition: definition }); return { id: "mate-new", name: definition.name }; },
  });
  var session = { localId: 1, ownerId: "u1", mateCreationMode: true, vendor: "claude", history: [{ type: "ask_user_answered", toolId: "q1" }] };
  var other = { localId: 2, ownerId: "u1", mateCreationMode: true, history: [] };
  var args = { name: "Atlas", bio: "Plans difficult work", relationship: "Partner", activities: "[\"Planning\"]", communicationStyle: "[\"Direct\"]", autonomy: "Ask before changes", identityMarkdown: "# Identity\n\n" + "I collaborate carefully and explain decisions. ".repeat(8) };
  var resultPromise = proposal.callBridgeTool(session, "propose_mate", args);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, "mate_creation_proposal");
  assert.equal(created.length, 0);
  assert.equal(proposal.handleHomeMessage({}, { proposalId: records[0].proposal.proposalId, action: "create" }, other), false);
  assert.equal(created.length, 0);
  assert.equal(proposal.handleHomeMessage({}, { proposalId: records[0].proposal.proposalId, action: "create" }, session), true);
  var result = await resultPromise;
  assert.equal(created.length, 1);
  assert.equal(created[0].userId, "u1");
  assert.equal(created[0].definition.model, "opus");
  assert.equal(session.homeMateCreationPhase, "created");
  assert.match(result.content[0].text, /Mate created/);

  var codexSession = { localId: 3, ownerId: "u1", mateCreationMode: true, vendor: "codex", history: [{ type: "ask_user_answered", toolId: "q2" }] };
  var codexResultPromise = proposal.callBridgeTool(codexSession, "propose_mate", Object.assign({}, args, { name: "Nova" }));
  var codexProposal = records[records.length - 1].proposal;
  assert.equal(proposal.handleHomeMessage({}, { proposalId: codexProposal.proposalId, action: "create" }, codexSession), true);
  await codexResultPromise;
  assert.equal(created[1].definition.vendor, "codex");
  assert.equal(created[1].definition.model, "gpt-5.6-sol");
});

test("ready Mate finalization writes a completed identity and rolls back failures", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-ready-mate-"));
  var registry = null;
  var deleted = [];
  var mates = {
    createMate: function () { registry = { id: "mate-1", createdBy: "u1", createdAt: 10, profile: { avatarSeed: "seed" }, seedData: {} }; fs.mkdirSync(path.join(root, registry.id), { recursive: true }); return registry; },
    getMateDir: function (ctx, id) { return path.join(root, id); },
    enforceAllSections: function (file) { fs.appendFileSync(file, "\n<!-- system -->\n"); },
    updateMate: function (ctx, id, updates) { registry = Object.assign({}, registry, updates); return registry; },
    backupIdentity: function () {}, logIdentityChange: function () {}, deleteMate: function (ctx, id) { deleted.push(id); fs.rmSync(path.join(root, id), { recursive: true, force: true }); },
  };
  var identity = "# Identity\n\n" + "I am a deliberate planning partner. ".repeat(10);
  var mate = readyCreation.createReadyMate(mates, {}, { name: "Atlas", bio: "Planning partner", relationship: "Partner", activities: ["Planning"], communicationStyle: ["Direct"], autonomy: "Ask before changes", identityMarkdown: identity, vendor: "claude", model: "opus" });
  assert.equal(mate.status, "ready");
  assert.equal(mate.profile.displayName, "Atlas");
  assert.equal(mate.model, "opus");
  assert.match(fs.readFileSync(path.join(root, "mate-1", "CLAUDE.md"), "utf8"), /I am a deliberate planning partner/);
  assert.match(fs.readFileSync(path.join(root, "mate-1", "mate.yaml"), "utf8"), /status: ready/);
  assert.match(fs.readFileSync(path.join(root, "mate-1", "mate.yaml"), "utf8"), /model: "opus"/);
  assert.deepEqual(deleted, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Mate interview history suppresses narration and restores questions and proposals", function () {
  var messages = homeEvents.historyToHomeChat([
    { type: "delta", text: "I am using a skill." },
    { type: "tool_executing", name: "AskUserQuestion", id: "q1", input: { questions: [{ header: "Role", question: "What kind of Mate?", options: [] }] } },
    { type: "ask_user_answered", toolId: "q1", answers: { 0: "A planning partner" } },
    { type: "mate_creation_proposal", proposal: { proposalId: "p1", name: "Atlas" } },
  ], false, true);
  assert.equal(messages.some(function (message) { return message.role === "assistant"; }), false);
  assert.equal(messages[0].role, "question");
  assert.equal(messages[0].flow, "mate_creation");
  assert.equal(messages[0].status, "answered");
  assert.equal(messages[1].role, "mate_proposal");
});
