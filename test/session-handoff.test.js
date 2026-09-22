var test = require("node:test");
var assert = require("node:assert");

var handoffModule = require("../lib/project-session-handoff");
var contextBuilder = require("../lib/session-handoff-context");

function fixture(overrides) {
  overrides = overrides || {};
  var source = Object.assign({
    localId: 1,
    ownerId: null,
    sessionVisibility: "private",
    vendor: "claude",
    title: "Fix the installer",
    history: [
      { type: "user_message", text: "Fix the installer without changing package policy." },
      { type: "delta", text: "I inspected the installer and found the fallback path." },
      { type: "user_message", text: "Continue and run the focused tests." },
      { type: "delta", text: "The implementation is ready; the focused test is still pending." },
    ],
    isProcessing: false,
  }, overrides.source || {});
  var sessions = new Map([[source.localId, source]]);
  var sent = [];
  var started = [];
  var switched = null;
  var nextId = 2;
  var sm = {
    sessions: sessions,
    defaultVendor: "claude",
    installedVendors: overrides.installedVendors || ["claude", "codex", "kiro"],
    modelsByVendor: {
      claude: [{ value: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" }],
      codex: [{ value: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" }],
    },
    capabilitiesByVendor: { claude: { effort: true }, codex: { effort: true } },
    currentEffort: "medium",
    currentEffortByVendor: {},
    createSessionRaw: function (opts) {
      var session = Object.assign({
        localId: nextId++,
        history: [],
        sentToolResults: {},
        isProcessing: false,
        createdAt: Date.now(),
      }, opts);
      sessions.set(session.localId, session);
      return session;
    },
    appendToSessionFile: function () {},
    switchSession: function (id, ws) { switched = id; ws._clayActiveSession = id; },
    sendAndRecord: function (session, entry) { session.history.push(entry); },
    broadcastSessionList: function () {},
  };
  var sdk = {
    startQuery: function (session, prompt, images, linuxUser) {
      started.push({ session: session, prompt: prompt, linuxUser: linuxUser });
      if (overrides.startQuery) return overrides.startQuery(session, prompt, linuxUser);
      return Promise.resolve();
    },
  };
  var splitGroup = overrides.splitGroup || null;
  var attached = handoffModule.attachSessionHandoff({
    cwd: process.cwd(),
    projectSlug: "test-project",
    sm: sm,
    isMate: false,
    isMultiUser: function () { return false; },
    getProjectAccess: function () { return { visibility: "public" }; },
    splitStore: { groupForMember: function () { return splitGroup; } },
    getSdk: function () { return sdk; },
    sendTo: function (ws, msg) { sent.push(msg); },
    usersModule: { isMultiUser: function () { return false; } },
    adapters: { claude: {}, codex: {}, kiro: {} },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
  });
  var ws = { _clayActiveSession: source.localId, _clayUser: null };
  return {
    source: source,
    sessions: sessions,
    sent: sent,
    started: started,
    ws: ws,
    handle: function (msg) { return attached.handleMessage(ws, msg); },
    get switched() { return switched; },
  };
}

test("handoff context keeps recent user intent and omits raw tool output", function () {
  var history = [
    { type: "user_message", text: "Keep this decision." },
    { type: "tool_result", text: "SECRET_TOOL_PAYLOAD" },
    { type: "delta", text: "Work is partly complete." },
  ];
  var turns = contextBuilder.recentTurns(history);
  assert.strictEqual(turns.length, 1);
  assert.strictEqual(turns[0].user, "Keep this decision.");
  assert.strictEqual(turns[0].assistant, "Work is partly complete.");
  assert.doesNotMatch(JSON.stringify(turns), /SECRET_TOOL_PAYLOAD/);
});

test("handoff creates and switches to a new vendor session with bounded context", function () {
  var f = fixture();
  assert.strictEqual(f.handle({ type: "handoff_session", targetVendor: "codex", model: "gpt-5.6-sol", effort: "high" }), true);
  assert.strictEqual(f.started.length, 1);
  assert.strictEqual(f.switched, 2);
  assert.strictEqual(f.ws._clayActiveSession, 2);
  assert.strictEqual(f.started[0].session.vendor, "codex");
  assert.strictEqual(f.started[0].session.model, "gpt-5.6-sol");
  assert.strictEqual(f.started[0].session.effort, "high");
  assert.strictEqual(f.started[0].session.sessionVisibility, "private");
  assert.strictEqual(f.started[0].session.handoff.sourceSessionId, 1);
  assert.match(f.started[0].prompt, /Current user request, verbatim:\nContinue and run the focused tests\./);
  assert.match(f.started[0].prompt, /Source agent: Claude Code/);
  assert.match(f.started[0].prompt, /Target agent: Codex/);
  assert.doesNotMatch(f.started[0].prompt, /read_handoff_source/);
  assert.ok(f.started[0].prompt.length <= contextBuilder.MAX_CONTEXT_CHARS);
  assert.strictEqual(f.source.history[f.source.history.length - 1].type, "handoff_created");
  assert.strictEqual(f.started[0].session.history[0].type, "handoff_context");
  assert.strictEqual(f.started[0].session.history[0].request, "Continue and run the focused tests.");
  assert.strictEqual(handoffModule.hasUserContext(f.started[0].session), true);
  assert.deepStrictEqual(f.sent[f.sent.length - 1], {
    type: "session_handoff_result",
    ok: true,
    sourceSessionId: 1,
    targetSessionId: 2,
    targetVendor: "codex",
  });
});

test("handoff dialog options include vendor models and effort capabilities", function () {
  var f = fixture();
  assert.strictEqual(f.handle({ type: "handoff_session_options" }), true);
  assert.deepStrictEqual(f.sent[0], {
    type: "handoff_session_options",
    installedVendors: ["claude", "codex", "kiro"],
    modelsByVendor: {
      claude: [{ value: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" }],
      codex: [{ value: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" }],
    },
    capabilitiesByVendor: { claude: { effort: true }, codex: { effort: true } },
  });
});

test("handoff supports a new session with the same vendor", function () {
  var same = fixture({ source: { cliSessionId: "source-native-thread" } });
  same.handle({ type: "handoff_session", targetVendor: "claude" });
  assert.strictEqual(same.started.length, 1);
  assert.strictEqual(same.started[0].session.localId, 2);
  assert.strictEqual(same.started[0].session.vendor, "claude");
  assert.strictEqual(same.started[0].session.cliSessionId, undefined);
  assert.match(same.started[0].prompt, /Source agent: Claude Code/);
  assert.match(same.started[0].prompt, /Target agent: Claude Code/);
  assert.match(same.started[0].prompt, /read_handoff_source/);
});

test("handoff rejects missing vendors and split-group sources", function () {
  var missing = fixture();
  missing.handle({ type: "handoff_session", targetVendor: "opencode" });
  assert.strictEqual(missing.started.length, 0);
  assert.match(missing.sent[0].error, /not installed/);

  var split = fixture({ splitGroup: { id: "split-1" } });
  split.handle({ type: "handoff_session", targetVendor: "codex" });
  assert.strictEqual(split.started.length, 0);
  assert.match(split.sent[0].error, /Open the session by itself/);
});

test("handoff waits for an active response to finish", function () {
  var f = fixture({ source: { isProcessing: true } });
  f.handle({ type: "handoff_session", targetVendor: "kiro" });
  assert.strictEqual(f.started.length, 0);
  assert.match(f.sent[0].error, /current response to finish/);
});

test("handoff contains synchronous query startup failures in the target session", function () {
  var f = fixture({
    startQuery: function () { throw new Error("adapter exploded"); },
  });
  assert.doesNotThrow(function () {
    f.handle({ type: "handoff_session", targetVendor: "codex" });
  });
  var target = f.sessions.get(2);
  assert.strictEqual(target.isProcessing, false);
  assert.strictEqual(target.history[target.history.length - 1].type, "error");
  assert.match(target.history[target.history.length - 1].text, /adapter exploded/);
});
