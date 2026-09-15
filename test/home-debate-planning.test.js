var test = require("node:test");
var assert = require("node:assert/strict");
var attachHomeChat = require("../lib/server-home-chat").attachHomeChat;
var attachDebateProposal = require("../lib/project-debate-proposal").attachDebateProposal;
var planningPrompt = require("../lib/server-home-debate-planning").INITIATION_PROMPT;

function settle() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function markTopicAnswered(session) {
  session.history.push({ type: "tool_executing", id: "topic-ready", name: "AskUserQuestion", input: { questions: [{ question: "Topic?", options: [] }] } });
  session.history.push({ type: "ask_user_answered", toolId: "topic-ready", answers: { 0: "User topic" } });
}

function fixture(options) {
  var opts = options || {};
  var clay = { id: "builtin:clay", builtinKey: "clay", name: "Clay", vendor: "claude", model: "sonnet" };
  var other = { id: "mate-other", name: "Other", vendor: "claude", model: "sonnet" };
  var sessions = new Map();
  var nextId = 1;
  var subscribers = {};
  var starts = [];
  var records = [];
  var catalogError = opts.catalogError === true;
  var startError = opts.startError === true;
  var manager = {
    sessions: sessions,
    createSession: function (sessionOptions) {
      var session = { localId: nextId++, cliSessionId: null, ownerId: sessionOptions.ownerId, vendor: sessionOptions.vendor || null, model: sessionOptions.model || null, effort: sessionOptions.effort || null, title: "", history: [], pendingAskUser: {}, isProcessing: false, createdAt: Date.now(), lastActivity: Date.now() };
      sessions.set(session.localId, session);
      return session;
    },
    subscribeSession: function (localId, callback) {
      subscribers[localId] = callback;
      return function () { delete subscribers[localId]; };
    },
    sendAndRecord: function (session, event) {
      session.history.push(event);
      records.push(event);
      if (subscribers[session.localId]) subscribers[session.localId](event);
    },
    saveSessionFile: function () {},
  };
  var proposalStarts = [];
  var debateControls = [];
  var proposal = attachDebateProposal({
    cwd: "/mates/builtin:clay",
    isMate: true,
    isHostAgent: true,
    sendTo: function () {},
    buildMateCtx: function () { return {}; },
    getMate: function (ctx, id) { return id === "panel-1" || id === "builtin:clay" ? { id: id } : null; },
    getProjectOwnerId: function () { return "u1"; },
    recordSessionEvent: function (session, event) { manager.sendAndRecord(session, event); },
    startDebate: function (session, brief, moderatorId) {
      proposalStarts.push({ session: session, brief: brief, moderatorId: moderatorId });
      return { ok: true };
    },
  });
  var project = {
    getSessionManager: function () { return manager; },
    getVendorModelCatalog: function () {
      if (catalogError) return Promise.resolve({ status: "error", models: [], error: "Sign in to the configured model provider and retry." });
      return Promise.resolve({ status: "ready", models: ["sonnet"], defaultModel: "sonnet", error: "" });
    },
    getVendorModelAvailability: function () { return [{ id: "claude", displayName: "Claude", installed: true }]; },
    getMemoryState: function () { return { entries: [], summary: "" }; },
    listKnowledgeFiles: function () { return []; },
    forEachClient: function () {},
    sdk: {
      startQuery: function (session, prompt) { starts.push({ session: session, prompt: prompt }); if (startError) throw new Error("query startup failed"); },
      pushMessage: function () {},
    },
    handleHomeDebateProposalResponse: function (ws, msg, session) { return proposal.handleHomeMessage(ws, msg, session); },
    handleHomeAskUserResponse: function (msg, session) {
      var pending = session.pendingAskUser[msg.toolId];
      if (!pending) return false;
      delete session.pendingAskUser[msg.toolId];
      manager.sendAndRecord(session, { type: "ask_user_answered", toolId: msg.toolId, answers: msg.answers || {} });
      pending.resolve({ behavior: "deny", message: "answered" });
      return true;
    },
    handleHomeDebateControl: function (ws, msg, session) { debateControls.push({ ws: ws, msg: msg, session: session }); return true; },
  };
  var mateList = [other, clay];
  var handler = attachHomeChat({
    users: { isMultiUser: function () { return true; } },
    mates: {
      buildMateCtx: function () { return {}; },
      getAllMates: function () { return mateList; },
      getMate: function (ctx, id) { return mateList.find(function (mate) { return mate.id === id; }) || null; },
      updateMate: function (ctx, id, patch) {
        for (var i = 0; i < mateList.length; i++) if (mateList[i].id === id) mateList[i] = Object.assign({}, mateList[i], patch);
        clay = mateList[1];
        return clay;
      },
      getMateDir: function () { return "/tmp/clay-home-debate-test"; },
    },
    projects: new Map([["mate-builtin:clay", project]]),
    addProject: function () {},
    resolveDefaultAi: opts.defaultRuntime ? function () { return Promise.resolve(Object.assign({ ready: true }, opts.defaultRuntime)); } : null,
  });
  var messages = [];
  var ws = { readyState: 1, _clayUser: { id: "u1" }, send: function (value) { messages.push(JSON.parse(value)); } };
  return { handler: handler, ws: ws, messages: messages, sessions: sessions, starts: starts, records: records, proposal: proposal, proposalStarts: proposalStarts, debateControls: debateControls, setCatalogError: function (value) { catalogError = value; }, setStartError: function (value) { startError = value; }, emit: function (localId, event) { var session = sessions.get(localId); session.history.push(event); if (subscribers[localId]) subscribers[localId](event); }, adapter: { createToolServer: function (definition) { return definition; } } };
}

test("Home Start debate creates a fresh exact Clay planning session with a hidden one-shot initiation", async function () {
  var f = fixture({ defaultRuntime: { vendor: "codex", model: "gpt-6-astra", effort: "high" } });
  assert.equal(f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", mateId: "mate-other", requestId: "plan-1" }), true);
  await settle();
  var session = Array.from(f.sessions.values())[0];
  assert.equal(session.ownerId, "u1");
  assert.equal(session.title, "Debate planning");
  assert.equal(session.debateSetupMode, true);
  assert.equal(session.homeDebatePlanning, true);
  assert.equal(session.vendor, "codex");
  assert.equal(session.model, "gpt-6-astra");
  assert.equal(session.effort, "high");
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].session, session);
  assert.equal(f.starts[0].prompt, planningPrompt);
  assert.match(planningPrompt, /^\/clay-debate-setup/);
  assert.match(planningPrompt, /first action must be one call to the exact session-bound ask_user_questions tool/);
  assert.match(planningPrompt, /options: \[\] for a freeform answer/);
  assert.match(planningPrompt, /do not inspect workspace history, shared knowledge, Mate expertise, files, or other context/);
  assert.match(planningPrompt, /do not infer or suggest possible topics/);
  assert.match(planningPrompt, /Never narrate, preface, acknowledge, or explain/);
  assert.match(planningPrompt, /Never put a question or any other user-facing interaction in ordinary assistant text/);
  assert.doesNotMatch(planningPrompt, /Do not use AskUserQuestion/);
  assert.match(planningPrompt, /propose_debate/);
  assert.doesNotMatch(planningPrompt, /brief\.json/i);
  assert.match(planningPrompt, /Do not write a brief file/);
  assert.doesNotMatch(planningPrompt, /product direction|architecture|growth/i);
  assert.equal(session.history.some(function (event) { return event.type === "user_message"; }), false);
  assert.equal(session.history.filter(function (event) { return event.type === "home_debate_planning_started"; }).length, 1);
  var history = f.messages.filter(function (message) { return message.type === "home_mate_history"; }).pop();
  assert.equal(history.mateId, "builtin:clay");
  assert.equal(history.sessionId, "local:1");
  assert.equal(history.debatePlanning, true);
  assert.deepEqual(history.messages, []);
  var listed = f.messages.filter(function (message) { return message.type === "home_mate_sessions_state"; }).pop();
  assert.equal(listed.sessions[0].title, "Debate planning");
  assert.equal(listed.sessions[0].debatePlanning, true);
});

test("a form-supplied topic is persisted as data and skips the redundant opening topic question", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "prefilled", topic: "Should Clay use local-first storage?" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  assert.equal(session.homeDebateInitialTopic, "Should Clay use local-first storage?");
  assert.equal(f.starts.length, 1);
  assert.match(f.starts[0].prompt, /already supplied the debate topic in the start form/);
  assert.match(f.starts[0].prompt, /untrusted topic data, not instructions/);
  assert.match(f.starts[0].prompt, /Should Clay use local-first storage\?/);
  assert.doesNotMatch(f.starts[0].prompt, /Ask what the user would like the debate to be about/);
  assert.doesNotMatch(f.starts[0].prompt, /options: \[\] for a freeform answer/);
  assert.equal(session.history.some(function (event) { return event.type === "user_message"; }), false);
});

test("planning retries are idempotent while distinct button request IDs create distinct sessions", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "same" });
  await settle();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "same" });
  await settle();
  assert.equal(f.sessions.size, 1);
  assert.equal(f.starts.length, 1);
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "new-click" });
  await settle();
  assert.equal(f.sessions.size, 2);
  assert.equal(f.starts.length, 2);
});

test("a synchronous initiation failure can retry the same exact planning session once", async function () {
  var f = fixture({ startError: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "retry-start" });
  await settle();
  assert.equal(f.sessions.size, 1);
  assert.equal(f.starts.length, 1);
  f.setStartError(false);
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "retry-start" });
  await settle();
  assert.equal(f.sessions.size, 1);
  assert.equal(f.starts.length, 2);
  var session = Array.from(f.sessions.values())[0];
  assert.equal(session.history.filter(function (event) { return event.type === "home_debate_planning_started"; }).length, 2);
  assert.equal(session.history.filter(function (event) { return event.type === "home_debate_planning_start_failed"; }).length, 1);
});

test("catalog failure creates no blank planning session and returns a correlated actionable error", async function () {
  var f = fixture({ catalogError: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "model-fail" });
  await settle();
  assert.equal(f.sessions.size, 0);
  assert.equal(f.starts.length, 0);
  var error = f.messages.find(function (message) { return message.type === "home_mate_error"; });
  assert.equal(error.requestId, "model-fail");
  assert.equal(error.sessionId, null);
  assert.equal(error.code, "model_unavailable");
  assert.match(error.text, /sign in|retry/i);
});

test("retrying after catalog recovery creates one initialized planning session", async function () {
  var f = fixture({ catalogError: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "recover" });
  await settle();
  f.setCatalogError(false);
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "recover" });
  await settle();
  assert.equal(f.sessions.size, 1);
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].session.localId, 1);
  assert.equal(f.starts[0].session.history.filter(function (event) { return event.type === "home_debate_planning_started"; }).length, 1);
  assert.equal(f.starts[0].session.model, "sonnet");
});

test("Clay's planning AskUserQuestion projects into the exact Home transcript and canonical answer resumes it", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "stream" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  var resolved = null;
  var topicInput = { questions: [{ header: "Topic", question: "What would you like the debate to be about?", options: [] }] };
  session.pendingAskUser["ask-1"] = { input: topicInput, resolve: function (value) { resolved = value; } };
  f.messages.length = 0;
  f.emit(session.localId, { type: "delta", text: "Let us shape this carefully." });
  f.emit(session.localId, { type: "tool_executing", id: "ask-1", name: "AskUserQuestion", input: topicInput });
  var question = f.messages.find(function (message) { return message.type === "home_debate_question"; });
  assert.equal(f.messages.some(function (message) { return message.type === "home_mate_delta"; }), false);
  assert.equal(question.sessionId, "local:1");
  assert.equal(question.requestId, "stream");
  assert.equal(question.questions[0].options.length, 0);
  f.handler.handleMessage(f.ws, { type: "home_debate_question_response", mateId: "builtin:clay", sessionId: "local:1", requestId: "stream", toolId: "ask-1", answers: { 0: "도시 주거 정책" } });
  assert.deepEqual(resolved, { behavior: "deny", message: "answered" });
  var answered = f.messages.find(function (message) { return message.type === "home_debate_question_resolved"; });
  assert.equal(answered.status, "answered");
  assert.deepEqual(answered.answers, { 0: "도시 주거 정책" });
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "builtin:clay", sessionId: "local:1", requestId: "stream" });
  await settle();
  var restoredTopic = f.messages.find(function (message) { return message.type === "home_mate_history"; }).messages[0];
  assert.equal(restoredTopic.questions[0].options.length, 0);
  assert.deepEqual(restoredTopic.answers, { 0: "도시 주거 정책" });
  f.messages.length = 0;
  f.emit(session.localId, { type: "tool_executing", id: "ask-2", name: "AskUserQuestion", input: { questions: [{ header: "Format", question: "Which format?", options: [{ label: "Round table" }, { label: "Pro/con" }] }] } });
  f.emit(session.localId, { type: "done" });
  assert.equal(f.messages.filter(function (message) { return message.type === "home_mate_done"; }).pop().text, "");
});

test("answered question ignores late prior-turn result and done before the next question", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "late-terminal" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  session.pendingAskUser["ask-late"] = { input: { questions: [{ question: "Topic?", options: [] }] }, resolve: function () {} };
  f.emit(session.localId, { type: "tool_executing", id: "ask-late", name: "AskUserQuestion", input: { questions: [{ question: "Topic?", options: [] }] } });
  f.handler.handleMessage(f.ws, { type: "home_debate_question_response", sessionId: "local:1", requestId: "late-terminal", toolId: "ask-late", answers: { 0: "Housing" } });
  f.messages.length = 0;
  f.emit(session.localId, { type: "delta", text: "I am using an internal skill and tool." });
  f.emit(session.localId, { type: "result" });
  f.emit(session.localId, { type: "done" });
  assert.equal(f.messages.some(function (message) { return message.type === "home_mate_delta"; }), false);
  assert.equal(f.messages.some(function (message) { return message.type === "home_mate_error"; }), false);
  f.emit(session.localId, { type: "tool_executing", id: "ask-next", name: "AskUserQuestion", input: { questions: [{ question: "Format?", options: [{ label: "Round table" }, { label: "Pro/con" }] }] } });
  assert.ok(f.messages.find(function (message) { return message.type === "home_debate_question" && message.toolId === "ask-next"; }));
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "builtin:clay", sessionId: "local:1", requestId: "late-terminal" });
  await settle();
  var history = f.messages.find(function (message) { return message.type === "home_mate_history"; });
  assert.equal(history.messages.some(function (message) { return message.role === "assistant" && /internal skill/.test(message.text); }), false);
});

test("Home debate question relay rejects stale, duplicate, and cross-user answers", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "question-owner" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  var count = 0;
  session.pendingAskUser["ask-owner"] = { input: { questions: [{ question: "Proceed?" }] }, resolve: function () { count++; } };
  f.handler.handleMessage(f.ws, { type: "home_debate_question_response", sessionId: "local:1", requestId: "stale", toolId: "ask-owner", answers: { 0: "No" } });
  f.handler.handleMessage(f.ws, { type: "home_debate_question_response", sessionId: "local:1", toolId: "ask-owner", answers: { 0: "No request" } });
  var attacker = { readyState: 1, _clayUser: { id: "u2" }, send: function () {} };
  f.handler.handleMessage(attacker, { type: "home_debate_question_response", sessionId: "local:1", requestId: "question-owner", toolId: "ask-owner", answers: { 0: "No" } });
  assert.equal(count, 0);
  f.handler.handleMessage(f.ws, { type: "home_debate_question_response", sessionId: "local:1", requestId: "question-owner", toolId: "ask-owner", answers: { 0: "Yes" } });
  f.handler.handleMessage(f.ws, { type: "home_debate_question_response", sessionId: "local:1", requestId: "question-owner", toolId: "ask-owner", answers: { 0: "Again" } });
  assert.equal(count, 1);
});

test("Home live controls require the owned exact active debate session", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "live-control" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  session.homeDebatePhase = "live";
  session._debate = { phase: "live" };
  f.handler.handleMessage(f.ws, { type: "home_debate_control", action: "stop", mateId: "builtin:clay", sessionId: "local:1", requestId: "live-control" });
  assert.equal(f.debateControls.length, 1);
  assert.equal(f.debateControls[0].session, session);
  f.handler.handleMessage(f.ws, { type: "home_debate_control", action: "cancel_stop", mateId: "builtin:clay", sessionId: "local:1", requestId: "live-control" });
  assert.equal(f.debateControls.length, 2);
  assert.equal(f.debateControls[1].msg.action, "cancel_stop");
  session.homeDebatePhase = "ended";
  session._debate = { phase: "ended" };
  f.handler.handleMessage(f.ws, { type: "home_debate_control", action: "resume", mateId: "builtin:clay", sessionId: "local:1", requestId: "live-control" });
  assert.equal(f.debateControls.length, 3);
  assert.equal(f.debateControls[2].msg.action, "resume");
  f.handler.handleMessage(f.ws, { type: "home_debate_control", action: "stop", mateId: "builtin:clay", sessionId: "local:1", requestId: "stale" });
  assert.equal(f.debateControls.length, 3);
  assert.equal(f.messages.some(function (message) { return message.code === "debate_not_active"; }), true);
  var attackerMessages = [];
  var attacker = { readyState: 1, _clayUser: { id: "u2" }, _homeChatTap: f.ws._homeChatTap, send: function (value) { attackerMessages.push(JSON.parse(value)); } };
  f.handler.handleMessage(attacker, { type: "home_debate_control", action: "stop", mateId: "builtin:clay", sessionId: "local:1", requestId: "live-control" });
  assert.equal(f.debateControls.length, 3);
  assert.equal(attackerMessages.some(function (message) { return message.code === "debate_not_active"; }), true);
});

test("restored unanswered question becomes actionably expired when its backend callback is gone", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "restore-question" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  f.emit(session.localId, { type: "tool_executing", id: "ask-expired", name: "AskUserQuestion", input: { questions: [{ question: "Still there?", options: [{ label: "Yes" }, { label: "No" }] }] } });
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "builtin:clay", sessionId: "local:1", requestId: "restore-question" });
  await settle();
  var restored = f.messages.filter(function (message) { return message.type === "home_mate_history"; }).pop();
  assert.equal(restored.messages[0].role, "question");
  assert.equal(restored.messages[0].status, "pending");
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_debate_question_response", sessionId: "local:1", requestId: "restore-question", toolId: "ask-expired", answers: { 0: "Yes" } });
  var expired = f.messages.find(function (message) { return message.type === "home_debate_question_resolved"; });
  assert.equal(expired.status, "expired");
  assert.match(expired.error, /repeat/i);
  var history = f.messages.find(function (message) { return message.type === "home_mate_error"; });
  assert.equal(history.code, "question_expired");
});

test("session-bound propose_debate records an inline Home proposal and exact approval starts with Clay as moderator", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "proposal" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  markTopicAnswered(session);
  var server = f.proposal.createMcpServer(f.adapter, session);
  var pending = server.tools[0].handler({ topic: "Architecture direction", panelists: JSON.stringify([{ mateId: "panel-1", role: "Skeptic", brief: "Challenge assumptions" }]) });
  var proposalMessage = f.messages.filter(function (message) { return message.type === "home_debate_proposal"; }).pop();
  assert.equal(proposalMessage.sessionId, "local:1");
  assert.equal(proposalMessage.proposal.topic, "Architecture direction");
  f.handler.handleMessage(f.ws, { type: "home_debate_proposal_response", mateId: "builtin:clay", sessionId: "local:1", requestId: "proposal", proposalId: proposalMessage.proposal.proposalId, action: "start" });
  var result = await pending;
  assert.equal(f.proposalStarts.length, 1);
  assert.equal(f.proposalStarts[0].session, session);
  assert.equal(f.proposalStarts[0].moderatorId, "builtin:clay");
  assert.equal(result.isError, undefined);
  var resolved = f.messages.filter(function (message) { return message.type === "home_debate_proposal_resolved"; }).pop();
  assert.equal(resolved.action, "start");
});

test("Home planning cannot propose before the user supplies a topic", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "proposal-before-topic" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  var server = f.proposal.createMcpServer(f.adapter, session);
  var result = await server.tools[0].handler({ topic: "Invented topic", panelists: JSON.stringify([{ mateId: "panel-1" }]) });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /debate topic/);
  assert.equal(f.messages.some(function (message) { return message.type === "home_debate_proposal"; }), false);
});

test("Home proposal relay rejects stale exact sessions without consuming the real pending proposal", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "proposal-stale" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  markTopicAnswered(session);
  var server = f.proposal.createMcpServer(f.adapter, session);
  var pending = server.tools[0].handler({ topic: "Secure routing", panelists: JSON.stringify([{ mateId: "panel-1" }]) });
  var proposalMessage = f.messages.filter(function (message) { return message.type === "home_debate_proposal"; }).pop();
  f.handler.handleMessage(f.ws, { type: "home_debate_proposal_response", sessionId: "local:99", proposalId: proposalMessage.proposal.proposalId, action: "start", requestId: "stale" });
  assert.equal(f.proposalStarts.length, 0);
  f.handler.handleMessage(f.ws, { type: "home_debate_proposal_response", sessionId: "local:1", proposalId: proposalMessage.proposal.proposalId, action: "cancel", requestId: "proposal-stale" });
  var result = await pending;
  assert.match(result.content[0].text, /cancelled/i);
});

test("Home proposal relay rejects a stale request for the same exact session", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "current-request" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  markTopicAnswered(session);
  var server = f.proposal.createMcpServer(f.adapter, session);
  var pending = server.tools[0].handler({ topic: "Correlation", panelists: JSON.stringify([{ mateId: "panel-1" }]) });
  var proposalMessage = f.messages.filter(function (message) { return message.type === "home_debate_proposal"; }).pop();
  f.handler.handleMessage(f.ws, { type: "home_debate_proposal_response", sessionId: "local:1", proposalId: proposalMessage.proposal.proposalId, action: "start", requestId: "stale-request" });
  assert.equal(f.proposalStarts.length, 0);
  f.handler.handleMessage(f.ws, { type: "home_debate_proposal_response", sessionId: "local:1", proposalId: proposalMessage.proposal.proposalId, action: "cancel", requestId: "current-request" });
  await pending;
});

test("Home proposal approval survives local to durable session identity promotion", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "promote" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  markTopicAnswered(session);
  var server = f.proposal.createMcpServer(f.adapter, session);
  var pending = server.tools[0].handler({ topic: "Durable identity", panelists: JSON.stringify([{ mateId: "panel-1" }]) });
  var proposalMessage = f.messages.filter(function (message) { return message.type === "home_debate_proposal"; }).pop();
  session.cliSessionId = "cli-planning";
  f.emit(session.localId, { type: "session_id", cliSessionId: "cli-planning" });
  f.handler.handleMessage(f.ws, { type: "home_debate_proposal_response", sessionId: "cli-planning", proposalId: proposalMessage.proposal.proposalId, action: "cancel", requestId: "promote" });
  var result = await pending;
  assert.match(result.content[0].text, /cancelled/i);
});

test("Home proposal relay rejects another user without consuming the owner's proposal", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "owner" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  markTopicAnswered(session);
  var server = f.proposal.createMcpServer(f.adapter, session);
  var pending = server.tools[0].handler({ topic: "Ownership", panelists: JSON.stringify([{ mateId: "panel-1" }]) });
  var proposalMessage = f.messages.filter(function (message) { return message.type === "home_debate_proposal"; }).pop();
  var attacker = { readyState: 1, _clayUser: { id: "u2" }, send: function () {} };
  f.handler.handleMessage(attacker, { type: "home_debate_proposal_response", sessionId: "local:1", proposalId: proposalMessage.proposal.proposalId, action: "start", requestId: "attack" });
  assert.equal(f.proposalStarts.length, 0);
  f.handler.handleMessage(f.ws, { type: "home_debate_proposal_response", sessionId: "local:1", proposalId: proposalMessage.proposal.proposalId, action: "cancel", requestId: "owner" });
  var result = await pending;
  assert.match(result.content[0].text, /cancelled/i);
});

test("proposal boundary suppresses the preface and clears pending without a duplicate final", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "boundary" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  markTopicAnswered(session);
  f.messages.length = 0;
  f.emit(session.localId, { type: "delta", text: "I have a complete brief." });
  var server = f.proposal.createMcpServer(f.adapter, session);
  var pending = server.tools[0].handler({ topic: "Boundary", panelists: JSON.stringify([{ mateId: "panel-1" }]) });
  var proposalMessage = f.messages.find(function (message) { return message.type === "home_debate_proposal"; });
  f.handler.handleMessage(f.ws, { type: "home_debate_proposal_response", sessionId: "local:1", proposalId: proposalMessage.proposal.proposalId, action: "cancel", requestId: "boundary" });
  await pending;
  f.emit(session.localId, { type: "done" });
  var done = f.messages.filter(function (message) { return message.type === "home_mate_done"; }).pop();
  assert.equal(done.text, "");
  var history = f.messages.filter(function (message) { return message.type === "home_debate_proposal" || message.type === "home_debate_proposal_resolved"; });
  assert.deepEqual(history.map(function (message) { return message.type; }), ["home_debate_proposal", "home_debate_proposal_resolved"]);
});

test("an expired restored proposal re-enables with actionable server-confirmed state", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_debate_plan", requestId: "expired" });
  await settle();
  var session = Array.from(f.sessions.values())[0];
  f.emit(session.localId, { type: "debate_proposal", proposal: { proposalId: "expired-proposal", topic: "Old proposal", panelists: [] } });
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_debate_proposal_response", sessionId: "local:1", proposalId: "expired-proposal", action: "start", requestId: "expired" });
  var resolved = f.messages.find(function (message) { return message.type === "home_debate_proposal_resolved"; });
  assert.equal(resolved.action, "error");
  assert.match(resolved.error, /no longer active/i);
  var error = f.messages.find(function (message) { return message.type === "home_mate_error"; });
  assert.equal(error.code, "proposal_not_found");
});
