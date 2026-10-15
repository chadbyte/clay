var test = require("node:test");
var assert = require("node:assert/strict");
var attachSessions = require("../lib/project-sessions").attachSessions;
var attachAskUser = require("../lib/project-ask-user").attachAskUser;
var attachDebateProposal = require("../lib/project-debate-proposal").attachDebateProposal;
var historyToHomeChat = require("../lib/server-home-chat-events").historyToHomeChat;
var transformEvent = require("../lib/server-home-chat-events").transformEvent;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var yokeUserInput = require("../lib/yoke/user-input");

function fixture(users) {
  var recorded = [];
  var manager = {
    currentPermissionMode: "default",
    permissionRequestIndex: {},
    sendAndRecord: function (session, event) { session.history.push(event); recorded.push(event); },
    appendToSessionFile: function () {},
  };
  var sessions = attachSessions({
    cwd: "/tmp/project", slug: "mate-builtin:clay", isMate: true, osUsers: null,
    currentVersion: "test", sm: manager, sdk: { startQuery: function () {}, pushMessage: function () {} }, tm: {}, clients: new Set(),
    send: function () {}, sendTo: function () {}, sendToAdmins: function () {}, sendToSession: function () {}, sendToSessionOthers: function () {},
    opts: {}, usersModule: users || {}, userPresence: {}, matesModule: {}, getSessionForWs: function () { return null; },
    getLinuxUserForSession: function () {}, ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {},
    hydrateImageRefs: function () {}, onProcessingChanged: function () {}, broadcastPresence: function () {}, adapter: {},
  });
  return { sessions: sessions, recorded: recorded };
}

test("canonical AskUserQuestion response accepts the exact pending tool once", function () {
  var f = fixture();
  var result = null;
  var session = { localId: 1, history: [], pendingAskUser: { "ask-1": { input: { questions: [{ question: "Outcome?" }] }, resolve: function (value) { result = value; } } } };
  assert.equal(f.sessions.respondToAskUser(session, { toolId: "ask-1", answers: { 0: "Decision" } }), true);
  assert.equal(f.sessions.respondToAskUser(session, { toolId: "ask-1", answers: { 0: "Again" } }), false);
  assert.deepEqual(f.recorded, [{ type: "ask_user_answered", toolId: "ask-1", answers: { 0: "Decision" } }]);
  assert.equal(result.behavior, "deny");
  assert.match(result.message, /Decision/);
});

test("project persistence resumes one canonical Yoke request and rejects stale answers", async function () {
  var f = fixture();
  var askUser = attachAskUser({ record: function (session, event) { session.history.push(event); } });
  var session = { localId: 11, history: [], pendingAskUser: {} };
  var pending = yokeUserInput.dispatchUserInput(askUser.createHandler(session), {
    questions: [{ id: "topic", header: "Topic", question: "What topic?", options: [] }],
  }, { requestId: "yoke-ask" });
  assert.equal(f.sessions.respondToAskUser(session, { toolId: "yoke-ask", answers: { topic: "Housing" } }), true);
  assert.equal(f.sessions.respondToAskUser(session, { toolId: "yoke-ask", answers: { topic: "Again" } }), false);
  assert.deepEqual(await pending, { status: "submitted", answers: { topic: ["Housing"] } });
  assert.equal(session.pendingAskUser["yoke-ask"], undefined);
  assert.equal(session.history[0].name, "AskUserQuestion");
  assert.equal(f.recorded[0].type, "ask_user_answered");
});

test("MCP AskUserQuestion answer continues canonically without a duplicate Home user bubble", function () {
  var f = fixture();
  var input = { questions: [{ question: "Outcome?", options: [{ label: "Decision" }, { label: "Trade-offs" }] }] };
  var session = { localId: 2, history: [{ type: "tool_executing", id: "ask-mcp", name: "AskUserQuestion", input: input }], pendingAskUser: { "ask-mcp": { mode: "mcp", input: input } }, isProcessing: true };
  assert.equal(f.sessions.respondToAskUser(session, { toolId: "ask-mcp", answers: { 0: "Decision" } }), true);
  var injected = session.history.filter(function (event) { return event.type === "user_message"; });
  assert.equal(injected.length, 1);
  assert.equal(injected[0].askUserAnswer, true);
  var home = historyToHomeChat(session.history, true);
  assert.equal(home.length, 1);
  assert.equal(home[0].role, "question");
  assert.equal(home[0].status, "answered");
});

test("Mate AskUserQuestion MCP records against its query-bound session, never a global active session", async function () {
  var records = [];
  var askUser = attachAskUser({ record: function (session, event) { records.push({ session: session, event: event }); } });
  var adapter = { createToolServer: function (definition) { return definition; } };
  var exact = { localId: 7, history: [], pendingAskUser: {} };
  var unrelated = { localId: 8, history: [], pendingAskUser: {} };
  var server = askUser.createMcpServer(adapter, exact);
  var resultPromise = server.tools[0].handler({ questions: [{ header: "Outcome", question: "What result?", options: [{ label: "Decision", description: "Choose" }, { label: "Trade-offs", description: "Compare" }] }] });
  await Promise.resolve();
  assert.equal(records.length, 1);
  assert.equal(records[0].session, exact);
  assert.equal(records[0].event.name, "AskUserQuestion");
  assert.equal(Object.keys(exact.pendingAskUser).length, 1);
  assert.equal(Object.keys(unrelated.pendingAskUser).length, 0);
  exact.pendingAskUser[Object.keys(exact.pendingAskUser)[0]].respond({ 0: "Decision" });
  var result = await resultPromise;
  assert.equal(result.isError, undefined);
  var unbound = askUser.createMcpServer(adapter, null);
  var rejected = await unbound.tools[0].handler({ questions: [{ question: "No session", options: [{ label: "A" }, { label: "B" }] }] });
  assert.equal(rejected.isError, true);
});

test("planning SDK query binds AskUser and proposal tools to the same exact Home session", async function () {
  var captured = [];
  var projected = [];
  var debateStarts = [];
  var manager = {
    defaultVendor: "codex",
    currentPermissionMode: "default",
    capabilitiesByVendor: { codex: {} },
    modelsByVendor: { codex: [] },
    permissionRequestIndex: {},
    saveSessionFile: function () {},
    broadcastSessionList: function () {},
    sendToSession: function () {},
    sendAndRecord: function (session, event) {
      session.history.push(event);
      var message = transformEvent(event, "builtin:clay", session, "plan-sdk", "local:31");
      if (message) projected.push(message);
    },
  };
  var askUser = attachAskUser({ record: manager.sendAndRecord });
  var proposal = attachDebateProposal({
    cwd: "/mates/builtin:clay",
    isMate: true,
    isHostAgent: true,
    sendTo: function () {},
    buildMateCtx: function (userId) { return { userId: userId }; },
    getMate: function (ctx, mateId) { return mateId === "builtin:clay" || mateId === "panel-1" ? { id: mateId } : null; },
    getProjectOwnerId: function () { return "owner-a"; },
    recordSessionEvent: manager.sendAndRecord,
    startDebate: function (session, brief, moderatorId) {
      debateStarts.push({ session: session, brief: brief, moderatorId: moderatorId });
      session.homeDebatePhase = "live";
      return { ok: true };
    },
  });
  var handle = {
    pushMessage: function () { return true; },
    close: function () {},
    [Symbol.asyncIterator]: function () { return { next: function () { return new Promise(function () {}); } }; },
  };
  var adapter = {
    vendor: "codex",
    userInputCapability: { mode: "native", native: true },
    createQuery: function (options) { captured.push(options); return Promise.resolve(handle); },
  };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: manager,
    adapter: adapter,
    adapters: { codex: adapter },
    send: function () {},
    getSessionToolDefs: function (session) { return proposal.getToolDefs(session); },
    onUserInputRequest: function (boundSession, request, respond) { return askUser.createHandler(boundSession)(request, respond); },
  });
  var session = { localId: 31, ownerId: "owner-a", vendor: "codex", model: "gpt-test", debateSetupMode: true, homeDebatePlanning: true, history: [], pendingAskUser: {}, isProcessing: false };
  await bridge.startQuery(session, "hidden debate setup");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].userInputMode, "fallback");
  assert.deepEqual(captured[0].dynamicTools.map(function (tool) { return tool.name; }), ["propose_debate", "ask_user_questions"]);
  var input = { questions: [{ header: "Topic", question: "What would you like to debate?", options: [{ label: "Product direction", description: "Choose a roadmap" }, { label: "Architecture", description: "Discuss systems" }, { label: "Growth", description: "Explore acquisition" }] }] };
  var firstCall = captured[0].callDynamicTool("ask_user_questions", input);
  await Promise.resolve();
  assert.equal(projected.length, 1);
  assert.equal(projected[0].type, "home_debate_question");
  assert.equal(projected[0].requestId, "plan-sdk");
  assert.equal(projected[0].sessionId, "local:31");
  assert.equal(projected[0].questions[0].question, "What would you like to debate?");
  assert.deepEqual(projected[0].questions[0].options, []);
  assert.equal(session.history[0].input.questions[0].options.length, 0);
  assert.doesNotMatch(JSON.stringify(session.history[0].input), /Product direction|Architecture|Growth/);
  var firstQuestionId = session.history[0].id;
  session.pendingAskUser[firstQuestionId].respond({ 0: "Housing affordability" });
  await firstCall;
  manager.sendAndRecord(session, { type: "ask_user_answered", toolId: firstQuestionId, answers: { 0: "Housing affordability" } });
  var secondCall = captured[0].callDynamicTool("ask_user_questions", {
    questions: [{ header: "Format", question: "How should the panel approach it?", options: [{ label: "Trade-offs", description: "Compare policies" }, { label: "Recommendation", description: "Choose a path" }] }],
  });
  await Promise.resolve();
  var secondQuestion = session.history.filter(function (event) { return event.type === "tool_executing"; })[1];
  session.pendingAskUser[secondQuestion.id].respond({ 0: "Trade-offs" });
  await secondCall;
  manager.sendAndRecord(session, { type: "ask_user_answered", toolId: secondQuestion.id, answers: { 0: "Trade-offs" } });

  session.cliSessionId = "01a05622-durable";
  var proposalPermission = await captured[0].canUseTool("propose_debate", {}, { toolUseID: "proposal-call" });
  assert.equal(proposalPermission.behavior, "allow");
  var proposalResult = captured[0].callDynamicTool("propose_debate", {
    topic: "Housing affordability",
    panelists: JSON.stringify([{ mateId: "panel-1", role: "Skeptic", brief: "Challenge assumptions" }]),
  });
  var proposalEvent = session.history.filter(function (event) { return event.type === "debate_proposal"; }).pop();
  assert.ok(proposalEvent);
  assert.equal(projected.filter(function (message) { return message.type === "home_debate_proposal"; }).length, 1);
  var ws = { _clayUser: { id: "owner-a" } };
  assert.equal(proposal.handleHomeMessage(ws, {
    type: "debate_proposal_response",
    proposalId: proposalEvent.proposal.proposalId,
    action: "start",
  }, session), true);
  var result = await proposalResult;
  assert.equal(result.isError, undefined);
  assert.equal(debateStarts.length, 1);
  assert.equal(debateStarts[0].session, session);
  assert.equal(debateStarts[0].moderatorId, "builtin:clay");
  assert.equal(session.homeDebatePhase, "live");
});

test("native structured input callback remains available for an ordinary Claude query", async function () {
  var captured = [];
  var manager = {
    defaultVendor: "claude", currentPermissionMode: "default", permissionRequestIndex: {},
    capabilitiesByVendor: { claude: {} }, modelsByVendor: { claude: [] },
    saveSessionFile: function () {}, broadcastSessionList: function () {}, sendToSession: function () {}, sendAndRecord: function () {},
  };
  var handle = { pushMessage: function () { return true; }, close: function () {}, [Symbol.asyncIterator]: function () { return { next: function () { return new Promise(function () {}); } }; } };
  var askUser = attachAskUser({ record: function (boundSession, event) { boundSession.history.push(event); } });
  var adapter = { vendor: "claude", userInputCapability: { mode: "native", native: true }, createQuery: function (options) { captured.push(options); return Promise.resolve(handle); } };
  var defaultAdapter = { vendor: "legacy", createQuery: function () { throw new Error("wrong adapter"); } };
  var bridge = createSDKBridge({
    cwd: process.cwd(), sessionManager: manager, adapter: defaultAdapter, adapters: { claude: adapter }, send: function () {},
    onUserInputRequest: function (boundSession, request, respond) { return askUser.createHandler(boundSession)(request, respond); },
  });
  var session = { localId: 32, vendor: "claude", model: "sonnet", history: [], pendingAskUser: {}, isProcessing: false };
  await bridge.startQuery(session, "ordinary question");
  assert.equal(captured[0].userInputMode, "native");
  var answer = null;
  var respond = function (value) { answer = value; };
  respond.cancel = function () {};
  captured[0].onUserInputRequest({ id: "native-ask", questions: [{ id: "topic", header: "Topic", question: "What topic?", options: [] }] }, respond);
  assert.ok(session.pendingAskUser["native-ask"]);
  session.pendingAskUser["native-ask"].respond({ topic: "Housing" });
  assert.deepEqual(answer, { topic: "Housing" });

  var typedContent = null;
  var elicitationRespond = function () {};
  elicitationRespond.cancel = function () {};
  elicitationRespond.onSettle = function () {};
  elicitationRespond.submitContent = function (content) { typedContent = content; };
  var elicitation = captured[0].onUserInputRequest({
    id: "elicit-form", presentation: "elicitation", questions: [{ id: "count", question: "Count?", options: [] }],
    diagnostics: { elicitation: { serverName: "Example", message: "Configure", mode: "form", requestedSchema: { type: "object", properties: { count: { type: "number" } } } } },
  }, elicitationRespond);
  var elicitationId = Object.keys(session.pendingElicitations)[0];
  session.pendingElicitations[elicitationId].resolve({ action: "accept", content: { count: 2 } });
  await elicitation;
  assert.deepEqual(typedContent, { count: 2 });
});


test("primary work confirmation accepts only the session owner", async function () {
  var f = fixture({ isMultiUser: function () { return true; } });
  var askUser = attachAskUser({ record: function (session, event) { session.history.push(event); } });
  var session = { localId: 11, ownerId: 'owner', history: [], pendingAskUser: {} };
  var task = yokeUserInput.dispatchUserInput(askUser.createHandler(session), {
    questions: [{ id: 'primary', question: 'Set primary?', options: [{ label: 'Set primary' }, { label: 'Keep current' }] }],
  }, { source: 'work-primary', requestId: 'primary-ask' });
  var msg = { toolId: 'primary-ask', answers: { primary: 'Set primary' } };
  assert.equal(f.sessions.respondToAskUser(session, msg), false);
  assert.equal(f.sessions.respondToAskUser(session, msg, { _clayUser: { id: 'viewer' } }), false);
  assert.ok(session.pendingAskUser['primary-ask']);
  assert.equal(f.sessions.respondToAskUser(session, msg, { _clayUser: { id: 'owner' } }), true);
  assert.equal((await task).status, 'submitted');
});


test("fallback questions and resolutions retain their exact Home planning surface", function () {
  [
    { mode: {}, prefix: "home_mate_question" },
    { mode: { debateSetupMode: true }, prefix: "home_debate_question" },
    { mode: { mateCreationMode: true }, prefix: "home_mate_creation_question" },
  ].forEach(function (item) {
    var event = { type: "tool_executing", name: "AskUserQuestion", id: "surface-question", source: "mcp_fallback", input: { questions: [{ question: "Choose the next step", options: [] }] } };
    var session = Object.assign({ localId: 41, history: [event] }, item.mode);
    var projected = transformEvent(event, "builtin:clay", session, "fixture-request");
    assert.equal(projected.type, item.prefix);
    assert.equal(projected.toolId, event.id);
    var resolved = transformEvent({ type: "ask_user_answered", toolId: event.id, answers: { 0: "Continue" } }, "builtin:clay", session, "fixture-request");
    assert.equal(resolved.type, item.prefix + "_resolved");
    assert.equal(resolved.toolId, event.id);
    assert.deepEqual(resolved.answers, { 0: "Continue" });
  });
});
