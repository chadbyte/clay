var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attachDebate = require("../lib/project-debate").attachDebate;
var createSessionManager = require("../lib/sessions").createSessionManager;
var mates = require("../lib/mates");
var homeEvents = require("../lib/server-home-chat-events");

function settle() { return new Promise(function (resolve) { setImmediate(resolve); }); }

function fixture(home) {
  var originalGetMate = mates.getMate;
  var originalBuildMateCtx = mates.buildMateCtx;
  mates.getMate = function (ctx, id) {
    return {
      id: id,
      name: id === "builtin:clay" ? "Clay" : "Panel",
      vendor: "claude",
      profile: {
        displayName: id === "builtin:clay" ? "Clay" : "Panel",
        avatarCatalogId: "C12",
        avatarStyle: "imprint",
        avatarSeed: id,
        avatarColor: "#555",
        avatarCustom: "data:image/svg+xml," + encodeURIComponent(id)
      }
    };
  };
  mates.buildMateCtx = function (userId) { return { userId: userId }; };
  var sessions = new Map();
  var created = 0;
  var events = [];
  var mentionOptions = [];
  var session = { localId: 7, ownerId: "user-a", title: "Debate planning", history: [], homeDebatePlanning: home === true, homeDebatePhase: home === true ? "planning" : null, debateSetupMode: home === true, isProcessing: home === true, queryInstance: { close: function () {} }, abortController: { abort: function () {} }, messageQueue: { end: function () {} } };
  sessions.set(session.localId, session);
  var manager = {
    sessions: sessions,
    createSession: function (options, ws) { created++; var next = { localId: 7 + created, ownerId: options && options.ownerId, history: [] }; sessions.set(next.localId, next); if (ws) ws._clayActiveSession = next.localId; return next; },
    saveSessionFile: function () {}, switchSession: function () {},
    sendAndRecord: function (target, event) { target.history.push(event); events.push({ session: target, event: event }); },
  };
  var engine = attachDebate({
    cwd: "/tmp/clay-home-debate-live-test", slug: "mate-builtin:clay", isMate: false,
    projectOwnerId: "user-a", send: function () {}, sendTo: function () {}, sendToSession: function () {}, sm: manager,
    sdk: { createMentionSession: function (options) { mentionOptions.push(options); return Promise.resolve({ isAlive: function () { return true; }, pushMessage: function () {}, close: function () {} }); } },
    getMateProfile: function (ctx, id) { return { name: id === "builtin:clay" ? "Clay" : "Panel", avatarStyle: "imprint", avatarSeed: id, avatarColor: "#555", avatarCustom: "data:image/svg+xml," + encodeURIComponent(id) }; },
    loadMateClaudeMd: function () { return ""; }, loadMateDigests: function () { return ""; }, hydrateImageRefs: function () {}, onProcessingChanged: function () {},
    getLinuxUserForSession: function () { return null; }, getSessionForWs: function () { return session; }, updateMemorySummary: function () {}, initMemorySummary: function () {},
  });
  function restore() { mates.getMate = originalGetMate; mates.buildMateCtx = originalBuildMateCtx; }
  return { engine: engine, manager: manager, session: session, events: events, mentionOptions: mentionOptions, created: function () { return created; }, restore: restore };
}

function brief() { return { topic: "Housing policy", format: "round_table", panelists: [{ mateId: "panel-1", role: "Analyst", brief: "Examine trade-offs" }] }; }

test("Home debate pins approved moderator and panelist models for the exact debate", async function (t) {
  var f = fixture(true);
  t.after(f.restore);
  var selected = brief();
  selected.participantModels = [
    { mateId: "builtin:clay", vendor: "claude", model: "claude-opus" },
    { mateId: "panel-1", vendor: "codex", model: "gpt-5.6" },
  ];
  var ws = { _clayUser: { id: "user-a" }, _homeChatTap: { mateSlug: "mate-builtin:clay", sessionId: 7 } };
  f.engine.handleMcpDebateApproval(f.session, selected, "builtin:clay", ws);
  await settle();
  assert.equal(f.mentionOptions[0].vendor, "claude");
  assert.equal(f.mentionOptions[0].model, "claude-opus");
  assert.deepEqual(f.session.debateState.participantModels, selected.participantModels);
  assert.deepEqual(f.session.history[0].participantModels, selected.participantModels);
  f.mentionOptions[0].onDone("@Panel, respond.");
  await settle();
  assert.equal(f.mentionOptions[1].vendor, "codex");
  assert.equal(f.mentionOptions[1].model, "gpt-5.6");
});

test("Home approval reuses the exact planning session and projects canonical live turns", async function (t) {
  var f = fixture(true);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _homeChatTap: { mateSlug: "mate-builtin:clay", sessionId: 7 }, _clayActiveSession: 99 };
  assert.deepEqual(f.engine.handleMcpDebateApproval(f.session, brief(), "builtin:clay", ws), { ok: true });
  await settle();
  assert.equal(f.created(), 0);
  assert.equal(f.manager.sessions.size, 1);
  assert.equal(ws._clayActiveSession, 7);
  assert.equal(f.session.homeDebatePhase, "live");
  assert.equal(f.session.title, "Debate: Housing policy");
  assert.equal(f.session.debateState.phase, "live");
  assert.deepEqual(f.events.slice(0, 2).map(function (entry) { return entry.event.type; }), ["debate_started", "debate_turn"]);
  assert.equal(f.events[0].session, f.session);
  assert.equal(f.events[1].event.mateName, "Clay");
  assert.equal(f.events[1].event.avatarCatalogId, "C12");
  assert.equal(f.events[1].event.avatarSeed, "builtin:clay");
  assert.match(f.events[1].event.avatarCustom, /builtin%3Aclay/);
  f.mentionOptions[0].onActivity("Thinking");
  f.mentionOptions[0].onDelta("Opening ");
  f.mentionOptions[0].onDone("Opening statement without a panel call.");
  var types = f.events.map(function (entry) { return entry.event.type; });
  assert.deepEqual(types.slice(2, 6), ["debate_activity", "debate_stream", "debate_turn_done", "debate_conclude_confirm"]);
  assert.equal(f.engine.handleHomeControl(ws, { action: "conclude", response: "end" }, f.session), true);
  assert.equal(f.session.homeDebatePhase, "ended");
  assert.equal(f.events[f.events.length - 1].event.type, "debate_ended");
  var projected = f.events.map(function (entry) { return homeEvents.transformEvent(entry.event, "builtin:clay", f.session, "request-a", "durable-a"); }).filter(Boolean);
  assert.equal(projected.every(function (event) { return event.type === "home_debate_event"; }), true);
  assert.equal(projected[1].sessionId, "durable-a");
  assert.equal(projected[1].requestId, "request-a");
  assert.equal(projected[1].avatarCatalogId, "C12");
  assert.equal(projected[1].avatarSeed, "builtin:clay");
  assert.match(projected[1].avatarCustom, /builtin%3Aclay/);
});

test("Home conclude control rebuilds a missing live runtime and resumes the exact debate", async function (t) {
  var f = fixture(true);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _homeChatTap: { mateSlug: "mate-builtin:clay", sessionId: 7 }, _clayActiveSession: 7 };
  f.session.homeDebatePhase = "live";
  f.session.history = [
    { type: "debate_started", topic: "Housing policy", format: "round_table", moderatorId: "builtin:clay", panelists: [{ mateId: "panel-1", role: "Analyst", brief: "Examine trade-offs" }] },
    { type: "debate_turn_done", mateId: "builtin:clay", mateName: "Clay", role: "moderator", round: 2, text: "A closing thought." },
    { type: "debate_conclude_confirm", topic: "Housing policy", round: 2 },
  ];

  assert.equal(f.session._debate, undefined);
  assert.equal(f.engine.handleHomeControl(ws, { action: "resume", text: "Compare implementation paths" }, f.session), true);
  await settle();

  assert.equal(f.created(), 0);
  assert.equal(f.manager.sessions.size, 1);
  assert.equal(f.session._debate.phase, "live");
  assert.equal(f.session._debate.awaitingConcludeConfirm, false);
  assert.equal(f.session.homeDebatePhase, "live");
  assert.equal(f.session.debateState.awaitingConcludeConfirm, false);
  assert.equal(f.mentionOptions.length, 1);
  assert.match(f.mentionOptions[0].initialMessage, /Compare implementation paths/);
  assert.deepEqual(f.events.map(function (entry) { return entry.event.type; }), ["debate_user_resume", "debate_resumed", "debate_turn"]);
});

test("an ended Home debate can be resumed repeatedly in the same exact session", async function (t) {
  var f = fixture(true);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _homeChatTap: { mateSlug: "mate-builtin:clay", sessionId: 7 }, _clayActiveSession: 7 };
  f.session.homeDebatePhase = "ended";
  f.session.debateState = { phase: "ended", topic: "Housing policy", format: "round_table", moderatorId: "builtin:clay", panelists: [{ mateId: "panel-1", role: "Analyst", brief: "Examine trade-offs" }], round: 3, debateId: "durable-debate", ownerId: "user-a" };
  f.session.history = [
    { type: "debate_started", topic: "Housing policy", format: "round_table", moderatorId: "builtin:clay", panelists: [{ mateId: "panel-1", role: "Analyst" }] },
    { type: "debate_turn_done", mateId: "panel-1", mateName: "Panel", role: "Analyst", round: 3, text: "First ending." },
    { type: "debate_ended", reason: "natural", round: 3 },
  ];
  assert.equal(f.engine.handleHomeControl(ws, { action: "resume" }, f.session), true);
  await settle();
  assert.equal(f.session.homeDebatePhase, "live");
  assert.equal(f.session._debate.debateId, "durable-debate");
  assert.equal(f.session._debate.panelists[0].brief, "Examine trade-offs");
  assert.equal(f.mentionOptions.length, 1);

  f.session.history.push({ type: "debate_ended", reason: "user_stopped", round: 3 });
  f.session.homeDebatePhase = "ended";
  f.session.debateState.phase = "ended";
  delete f.session._debate;
  assert.equal(f.engine.handleHomeControl(ws, { action: "resume" }, f.session), true);
  await settle();
  assert.equal(f.session.homeDebatePhase, "live");
  assert.equal(f.manager.sessions.size, 1);
  assert.equal(f.mentionOptions.length, 2);
  assert.equal(f.session.history.filter(function (event) { return event.type === "debate_resumed"; }).length, 2);
});

test("a pending Home debate stop is server-confirmed and can be cancelled before the turn ends", async function (t) {
  var f = fixture(true);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _homeChatTap: { mateSlug: "mate-builtin:clay", sessionId: 7 }, _clayActiveSession: 7 };
  f.engine.handleMcpDebateApproval(f.session, brief(), "builtin:clay", ws);
  await settle();
  assert.equal(f.session._debate.turnInProgress, true);
  assert.equal(f.engine.handleHomeControl(ws, { action: "stop" }, f.session), true);
  assert.equal(f.session._debate.phase, "ending");
  assert.equal(f.session.debateState.phase, "ending");
  assert.equal(f.events[f.events.length - 1].event.type, "debate_stop_requested");
  assert.equal(f.engine.handleHomeControl(ws, { action: "cancel_stop" }, f.session), true);
  assert.equal(f.session._debate.phase, "live");
  assert.equal(f.session.debateState.phase, "live");
  assert.equal(f.events[f.events.length - 1].event.type, "debate_stop_cancelled");
  f.mentionOptions[0].onDone("Continue with @Panel on implementation trade-offs.");
  assert.equal(f.session.homeDebatePhase, "live");
  assert.equal(f.events.some(function (entry) { return entry.event.type === "debate_ended"; }), false);
});

test("debate moderator records auditable Bash commands without exposing unrelated tool input", async function (t) {
  var f = fixture(true);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _homeChatTap: { mateSlug: "mate-builtin:clay", sessionId: 7 }, _clayActiveSession: 7 };
  f.engine.handleMcpDebateApproval(f.session, brief(), "builtin:clay", ws);
  await settle();
  var handler = f.mentionOptions[0].canUseTool;
  var allowed = await handler("Bash", { command: "rg -n housing lib", secret: "never-project-this" }, { toolUseID: "tool-safe" });
  var blocked = await handler("Edit", { file_path: "/tmp/private", new_string: "never-project-this" }, { toolUseID: "tool-write" });
  assert.equal(allowed.behavior, "allow");
  assert.equal(blocked.behavior, "deny");
  assert.match(blocked.message, /moderator blocked/);
  var decisions = f.session.history.filter(function (event) { return event.type === "debate_tool_decision"; });
  assert.deepEqual(decisions.map(function (event) { return [event.decisionId, event.mateName, event.toolName, event.decision]; }), [
    ["tool-safe", "Clay", "Bash", "allowed"],
    ["tool-write", "Clay", "Edit", "blocked"],
  ]);
  assert.equal(decisions[0].action, "Run read-only shell commands (rg)");
  assert.equal(decisions[0].reason, "Read-only investigation");
  assert.equal(decisions[1].action, "Edit a project file");
  assert.equal(decisions[1].reason, "Would modify project files");
  assert.equal(decisions[0].command, "rg -n housing lib");
  assert.equal(decisions[1].command, "");
  assert.doesNotMatch(JSON.stringify(decisions), /never-project-this|\/tmp\/private/);
  var projected = decisions.map(function (event) { return homeEvents.transformEvent(event, "builtin:clay", f.session, "request-tools", "durable-tools"); });
  assert.deepEqual(projected.map(function (event) { return [event.eventType, event.decisionId, event.decision, event.toolName]; }), [
    ["debate_tool_decision", "tool-safe", "allowed", "Bash"],
    ["debate_tool_decision", "tool-write", "blocked", "Edit"],
  ]);
  assert.equal(projected[0].requestId, "request-tools");
  assert.equal(projected[0].sessionId, "durable-tools");
  assert.equal(projected[0].command, "rg -n housing lib");
});

test("legacy project approval still creates a dedicated live debate session", function (t) {
  var f = fixture(false);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _clayActiveSession: 7 };
  f.engine.handleMcpDebateApproval(f.session, brief(), "builtin:clay", ws);
  assert.equal(f.created(), 1);
  assert.equal(f.manager.sessions.size, 2);
  assert.equal(f.session._debate, undefined);
});

test("Home live history restores one finalized turn without duplicating streamed text", function () {
  var history = [
    { type: "debate_started", topic: "Housing", moderatorId: "builtin:clay", moderatorName: "Clay", panelists: [{ mateId: "panel-1", name: "Panel", role: "Analyst" }] },
    { type: "debate_turn", turnId: "d:1", mateId: "builtin:clay", mateName: "Clay", role: "moderator", round: 1, avatarStyle: "imprint", avatarSeed: "clay-seed", avatarCustom: "data:image/svg+xml,clay" },
    { type: "debate_stream", turnId: "d:1", mateId: "builtin:clay", delta: "Hello " },
    { type: "debate_stream", turnId: "d:1", mateId: "builtin:clay", delta: "panel" },
    { type: "debate_turn_done", turnId: "d:1", mateId: "builtin:clay", mateName: "Clay", role: "moderator", round: 1, text: "Hello panel" },
    { type: "debate_stop_requested", topic: "Housing", round: 1 },
    { type: "debate_stop_cancelled", topic: "Housing", round: 1 },
    { type: "debate_tool_decision", decisionId: "tool-1", mateId: "panel-1", mateName: "Panel", toolName: "Bash", action: "Run read-only shell commands (rg)", decision: "allowed", reason: "Read-only investigation" },
    { type: "debate_tool_decision", decisionId: "tool-2", mateId: "panel-1", mateName: "Panel", toolName: "Bash", action: "Run read-only shell commands (rg)", decision: "allowed", reason: "Read-only investigation" },
    { type: "debate_tool_decision", decisionId: "tool-3", mateId: "panel-1", mateName: "Panel", toolName: "Edit", action: "Edit a project file", decision: "blocked", reason: "Would modify project files" },
    { type: "debate_ended", topic: "Housing", round: 1, reason: "interrupted" },
  ];
  var messages = homeEvents.historyToHomeChat(history, true);
  var turns = messages.filter(function (message) { return message.role === "debate_turn"; });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, "Hello panel");
  assert.equal(turns[0].status, "done");
  assert.equal(turns[0].mateName, "Clay");
  assert.equal(turns[0].avatarSeed, "clay-seed");
  assert.equal(turns[0].avatarCustom, "data:image/svg+xml,clay");
  var decision = messages.find(function (message) { return message.role === "debate_tool_decision"; });
  assert.equal(decision.decisionId, "tool-1");
  assert.equal(decision.toolName, "Bash");
  assert.equal(decision.decision, "allowed");
  assert.equal(decision.entries.length, 3);
  assert.equal(messages.find(function (message) { return message.role === "debate_header"; }).stopping, false);
  assert.equal(messages.find(function (message) { return message.role === "debate_header"; }).phase, "interrupted");
});

test("Home live debate survives websocket reconnect but a restarted runtime restores as interrupted", async function (t) {
  var f = fixture(true);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _homeChatTap: { mateSlug: "mate-builtin:clay", sessionId: 7 }, _clayActiveSession: 7 };
  f.engine.handleMcpDebateApproval(f.session, brief(), "builtin:clay", ws);
  await settle();
  var activeRuntime = f.session._debate;
  f.engine.restoreDebateState(ws);
  assert.equal(f.session._debate, activeRuntime);
  assert.equal(f.session.homeDebatePhase, "live");
  delete f.session._debate;
  f.engine.restoreDebateState(ws);
  assert.equal(f.session.homeDebatePhase, "interrupted");
  assert.equal(f.session.debateState.phase, "interrupted");
  assert.equal(f.session.history.filter(function (event) { return event.type === "debate_ended" && event.reason === "interrupted"; }).length, 1);
  f.engine.restoreDebateState(ws);
  assert.equal(f.session.history.filter(function (event) { return event.type === "debate_ended" && event.reason === "interrupted"; }).length, 1);
});

test("Home debate identity and phase persist with the exact session", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-home-debate-phase-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var options = { cwd: path.join(root, "project"), sessionsBase: path.join(root, "sessions"), cliSessionsDir: path.join(root, "cli"), send: function () {} };
  var first = createSessionManager(options);
  var session = first.createSessionRaw({ cliSessionId: "11111111-2222-4333-8444-555555555555", vendor: "claude", model: "sonnet" });
  session.debateSetupMode = true;
  session.homeDebatePlanning = true;
  session.homeDebatePhase = "live";
  session.title = "Debate planning";
  first.saveSessionFile(session);
  var second = createSessionManager(options);
  var restored = Array.from(second.sessions.values())[0];
  assert.equal(restored.cliSessionId, session.cliSessionId);
  assert.equal(restored.debateSetupMode, true);
  assert.equal(restored.homeDebatePlanning, true);
  assert.equal(restored.homeDebatePhase, "live");
  assert.equal(restored.title, "Debate planning");
});

test("Home debate gives every Mate and participant the same left identity rail", function () {
  var root = path.join(__dirname, "..");
  var css = fs.readFileSync(path.join(root, "lib/public/css/home-debate-live.css"), "utf8");
  assert.match(css, /\.home-debate-live-turn\.msg-assistant,[\s\S]*grid-template-columns: 34px minmax\(0, 1fr\)/);
  assert.match(css, /\.home-debate-live-turn > \.dm-bubble-avatar,[\s\S]*\.home-debate-live-user > \.dm-bubble-avatar \{[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.doesNotMatch(css, /home-debate-live-user\.msg-user \{ grid-template-columns: minmax|home-debate-live-user \.dm-bubble-content \{ display: contents|home-debate-live-user \.dm-bubble-header \{ grid-column/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.home-debate-live-turn\.msg-assistant,[\s\S]*\.home-debate-live-user\.msg-user \{ grid-template-columns: 32px minmax\(0, 1fr\); gap: 9px;/);
});
