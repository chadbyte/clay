var test = require("node:test");
var assert = require("node:assert/strict");
var attachHomeChat = require("../lib/server-home-chat").attachHomeChat;

function settle() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function fixture(options) {
  var opts = options || {};
  var mate = { id: "mate-a", name: "A", vendor: "claude", model: "sonnet" };
  if (opts.clay) mate.builtinKey = "clay";
  var sessions = new Map([
    [1, { localId: 1, cliSessionId: "session-old", ownerId: "u1", title: "Older", lastActivity: 10, vendor: "claude", model: "sonnet", history: [] }],
    [2, { localId: 2, cliSessionId: "session-new", ownerId: "u1", title: "Newer", lastActivity: 30, vendor: "codex", model: "gpt-5.6", history: [{ type: "user_message", text: "Hello" }] }],
    [3, { localId: 3, cliSessionId: "session-other", ownerId: "u2", title: "Other user's chat", lastActivity: 40, history: [] }],
    [4, { localId: 4, cliSessionId: "session-hidden", ownerId: "u1", title: "Hidden", lastActivity: 50, hidden: true, history: [] }],
    [5, { localId: 5, cliSessionId: "session-single", title: "Single-user chat", lastActivity: 20, history: [] }],
  ]);
  var subscribed = null;
  var subscription = null;
  var subscriptions = {};
  var recorded = [];
  var manager = {
    sessions: sessions,
    subscribeSession: function (id, callback) {
      subscribed = id;
      subscription = callback;
      subscriptions[id] = callback;
      return function () { if (subscriptions[id] === callback) delete subscriptions[id]; };
    },
    saveSessionFile: function () {},
    createSession: function (createOptions) {
      if (!opts.allowCreate) throw new Error("unexpected session creation");
      var session = { localId: 6, ownerId: createOptions.ownerId, vendor: createOptions.vendor, model: createOptions.model, history: [], isProcessing: false };
      sessions.set(6, session);
      return session;
    },
    sendAndRecord: function (session, event) {
      recorded.push(event);
      session.history.push(event);
      if (subscribed === session.localId && subscription) subscription(event);
    },
  };
  var project = {
    getSessionManager: function () { return manager; },
    getVendorModelCatalog: function () { return Promise.resolve({ status: "ready", models: ["sonnet"], defaultModel: "sonnet", error: "" }); },
    getMemoryState: function () { return { entries: [], summary: "" }; },
    listKnowledgeFiles: function () { return []; },
    forEachClient: function () {},
    handleHomePermissionResponse: function (ws, message, session) {
      if (typeof opts.onPermissionResponse === "function") return opts.onPermissionResponse(ws, message, session, manager);
      return false;
    },
    stopHomeSession: function (session) {
      if (typeof opts.onStop === "function") return opts.onStop(session);
      return false;
    },
    sdk: Object.prototype.hasOwnProperty.call(opts, "sdk") ? opts.sdk : null,
  };
  var handler = attachHomeChat({
    users: { isMultiUser: function () { return opts.singleUser !== true; } },
    mates: {
      buildMateCtx: function () { return {}; },
      getAllMates: function () { return [mate]; },
      getMate: function () { return mate; },
      updateMate: function (ctx, mateId, patch) { mate = Object.assign({}, mate, patch); return mate; },
      getMateDir: function () { return "/tmp/mate-a"; },
    },
    projects: new Map([["mate-mate-a", project]]),
    addProject: function () {},
  });
  var messages = [];
  var ws = {
    readyState: 1,
    _clayUser: opts.unauthenticated ? null : { id: "u1" },
    send: function (value) { messages.push(JSON.parse(value)); },
  };
  return {
    handler: handler,
    ws: ws,
    messages: messages,
    getSubscribed: function () { return subscribed; },
    emit: function (event) { if (subscription) subscription(event); },
    emitFor: function (sessionId, event) { if (subscriptions[sessionId]) subscriptions[sessionId](event); },
    emitRecorded: function (event) {
      var session = sessions.get(subscribed);
      if (event.type === "session_id") session.cliSessionId = event.cliSessionId;
      session.history.push(event);
      if (subscription) subscription(event);
    },
    addSession: function (session) { sessions.set(session.localId, session); },
    getSession: function (id) { return sessions.get(id); },
    getRecorded: function () { return recorded; },
    record: function (sessionId, event) { manager.sendAndRecord(sessions.get(sessionId), event); },
  };
}

test("Mate conversation list includes only the requesting user's visible sessions", function () {
  var f = fixture();
  assert.strictEqual(f.handler.handleMessage(f.ws, { type: "home_mate_sessions_list", mateId: "mate-a" }), true);
  assert.deepStrictEqual(f.messages[0], {
    type: "home_mate_sessions_state",
    mateId: "mate-a",
    sessions: [
      { id: "session-new", cliSessionId: "session-new", localId: 2, title: "Newer", vendor: "codex", model: "gpt-5.6", createdAt: 0, lastActivity: 30, isProcessing: false, sessionRole: "driver", parentSessionId: null, parentAvailable: false, workerGeneration: null },
      { id: "session-old", cliSessionId: "session-old", localId: 1, title: "Older", vendor: "claude", model: "sonnet", createdAt: 0, lastActivity: 10, isProcessing: false, sessionRole: "driver", parentSessionId: null, parentAvailable: false, workerGeneration: null },
    ],
  });
});

test("Mate conversation details expose local-only identity without weakening ownership filtering", function () {
  var f = fixture();
  f.addSession({ localId: 6, cliSessionId: null, ownerId: "u1", title: "Local\ndraft\u0000", createdAt: 35, lastActivity: 60, vendor: "claude", model: "haiku", isProcessing: true, history: [] });
  f.handler.handleMessage(f.ws, { type: "home_mate_sessions_list", mateId: "mate-a" });
  var sessions = f.messages[0].sessions;
  assert.deepStrictEqual(sessions[0], {
    id: "local:6",
    cliSessionId: null,
    localId: 6,
    title: "Local draft",
    vendor: "claude",
    model: "haiku",
    createdAt: 35,
    lastActivity: 60,
    isProcessing: true,
    sessionRole: "driver",
    parentSessionId: null,
    parentAvailable: false,
    workerGeneration: null,
  });
  assert.strictEqual(sessions.some(function (session) { return session.title === "Other user's chat" || session.title === "Hidden"; }), false);
});

test("Home lists repair legacy global-search boilerplate titles", function () {
  var f = fixture();
  f.addSession({
    localId: 6,
    cliSessionId: "legacy-search",
    ownerId: "u1",
    title: "This conversation began in Clay Studio's global search. Resp",
    titleAutoGenerated: true,
    lastActivity: 60,
    vendor: "codex",
    model: "gpt-5.6-sol",
    history: [{ type: "user_message", text: "Find our accessibility review" }],
  });
  f.handler.handleMessage(f.ws, { type: "home_mate_sessions_list", mateId: "mate-a" });
  assert.equal(f.messages[0].sessions[0].title, "Find our accessibility review");
  assert.equal(f.getSession(6).titleAutoGenerated, false);
});

test("Mate settings memory and knowledge responses preserve request correlation", function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_memory_list", mateId: "mate-a", requestId: "memory-a" });
  f.handler.handleMessage(f.ws, { type: "home_mate_knowledge_list", mateId: "mate-a", requestId: "knowledge-a" });
  assert.deepStrictEqual(f.messages.map(function (message) { return [message.type, message.mateId, message.requestId]; }), [
    ["home_mate_memory_state", "mate-a", "memory-a"],
    ["home_mate_knowledge_state", "mate-a", "knowledge-a"],
  ]);
});

test("Explicit Mate conversation open restores the exact requested session", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old", requestId: "open-old" });
  await settle();
  assert.strictEqual(f.getSubscribed(), 1);
  assert.strictEqual(f.messages[0].type, "home_mate_history");
  assert.strictEqual(f.messages[0].sessionId, "session-old");
  assert.strictEqual(f.messages[0].requestId, "open-old");
  assert.strictEqual(f.messages[0].vendor, "claude");
  assert.strictEqual(f.messages[0].model, "sonnet");
});

test("global Ask Clay keeps its stream subscription when Home opens another conversation", async function () {
  var starts = [];
  var f = fixture({
    clay: true,
    allowCreate: true,
    sdk: { startQuery: function (session, text) { starts.push({ session: session, text: text }); } },
  });
  f.handler.handleMessage(f.ws, { type: "home_clay_ask", requestId: "search-request", text: "Find fruit" });
  await settle();
  assert.equal(starts.length, 1);
  assert.equal(f.ws._searchClayTap.sessionId, 6);
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old", requestId: "home-request" });
  await settle();
  assert.equal(f.ws._homeChatTap.sessionId, 1);
  assert.equal(f.ws._searchClayTap.sessionId, 6);
  f.messages.length = 0;
  f.getSession(6).responsePreview = "The fruit conversation is here.";
  f.getSession(6).history.push({ type: "delta", text: "The fruit conversation is here." });
  f.emitFor(6, { type: "done" });
  var reply = f.messages.find(function (message) { return message.type === "home_mate_done"; });
  assert.equal(reply.requestId, "search-request");
  assert.equal(reply.text, "The fruit conversation is here.");
  f.getSession(6).isProcessing = false;
  f.handler.handleMessage(f.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: "local:6", requestId: "search-request", text: "Which one?" });
  await settle();
  assert.equal(starts.length, 2);
  assert.equal(starts[1].session.localId, 6);
  assert.equal(f.getSession(1).history.length, 0);
  assert.equal(f.getSession(6).history[f.getSession(6).history.length - 1].text, "Which one?");
});

test("global Ask Clay restores and resolves only the exact session-bound pending permission", async function () {
  var resolved = [];
  var f = fixture({
    clay: true,
    allowCreate: true,
    sdk: { startQuery: function () {} },
    onPermissionResponse: function (ws, message, session, manager) {
      var pending = session.pendingPermissions[message.requestId];
      delete session.pendingPermissions[message.requestId];
      pending.resolve(message.decision);
      manager.sendAndRecord(session, { type: "permission_resolved", requestId: message.requestId, decision: message.decision });
      return true;
    },
  });
  f.handler.handleMessage(f.ws, { type: "home_clay_ask", requestId: "search-control", text: "Change a file" });
  await settle();
  var session = f.getSession(6);
  session.pendingPermissions = {
    "permission-1": { toolName: "Edit", toolInput: { file_path: "/repo/a.js" }, decisionReason: "Update the file", resolve: function (decision) { resolved.push(decision); } },
  };
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_clay_ask", requestId: "search-control", text: "Change a file" });
  await settle();
  var history = f.messages.find(function (message) { return message.type === "home_mate_history"; });
  assert.deepEqual(history.pendingPermissions, [{ permissionRequestId: "permission-1", toolName: "Edit", toolInput: { file_path: "/repo/a.js" }, decisionReason: "Update the file" }]);

  f.handler.handleMessage(f.ws, { type: "home_mate_permission_response", mateId: "mate-a", sessionId: "local:6", requestId: "wrong-search", permissionRequestId: "permission-1", decision: "allow" });
  assert.deepEqual(resolved, []);
  f.handler.handleMessage(f.ws, { type: "home_mate_permission_response", mateId: "mate-a", sessionId: "local:6", requestId: "search-control", permissionRequestId: "permission-1", decision: "allow" });
  assert.deepEqual(resolved, ["allow"]);
  assert.equal(session.pendingPermissions["permission-1"], undefined);
  assert.equal(f.messages.some(function (message) { return message.type === "home_mate_permission_resolved" && message.permissionRequestId === "permission-1"; }), true);
});

test("global Ask Clay Stop targets its exact session and rejects stale session controls", async function () {
  var stopped = [];
  var f = fixture({ clay: true, allowCreate: true, sdk: { startQuery: function () {} }, onStop: function (session) { stopped.push(session.localId); return true; } });
  f.handler.handleMessage(f.ws, { type: "home_clay_ask", requestId: "search-stop", text: "Keep working" });
  await settle();
  f.handler.handleMessage(f.ws, { type: "home_mate_stop", mateId: "mate-a", sessionId: "session-old", requestId: "search-stop" });
  assert.deepEqual(stopped, []);
  f.handler.handleMessage(f.ws, { type: "home_mate_stop", mateId: "mate-a", sessionId: "local:6", requestId: "search-stop" });
  assert.deepEqual(stopped, [6]);
  assert.equal(f.messages.some(function (message) { return message.type === "home_mate_stopping" && message.sessionId === "local:6"; }), true);
});

test("exact Home sessions retain distinct committed model metadata", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old", requestId: "open-a" });
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-new", requestId: "open-b" });
  await settle();
  var histories = f.messages.filter(function (message) { return message.type === "home_mate_history"; });
  assert.deepStrictEqual(histories.map(function (message) {
    return [message.sessionId, message.vendor, message.model, message.requestId];
  }), [
    ["session-old", "claude", "sonnet", "open-a"],
    ["session-new", "codex", "gpt-5.6", "open-b"],
  ]);
});

test("Home live session events refresh committed model metadata", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-new", requestId: "open-live" });
  await settle();
  f.messages.length = 0;
  f.emit({ type: "delta", text: "Hi" });
  f.emit({ type: "done" });
  assert.deepStrictEqual(f.messages.slice(0, 2).map(function (message) {
    return [message.type, message.sessionId, message.vendor, message.model, message.requestId];
  }), [
    ["home_mate_delta", "session-new", "codex", "gpt-5.6", "open-live"],
    ["home_mate_done", "session-new", "codex", "gpt-5.6", "open-live"],
  ]);
});

test("fresh Home taps promote session identity before streaming notification-visible output", async function () {
  var f = fixture();
  f.addSession({ localId: 6, cliSessionId: null, ownerId: "u1", title: "Fresh", lastActivity: 60, vendor: "claude", model: "sonnet", history: [] });
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "local:6", requestId: "open-fresh" });
  await settle();
  assert.equal(f.messages[0].sessionId, "local:6");
  f.messages.length = 0;
  f.getSession(6).responsePreview = "The visible assistant reply";
  f.emitRecorded({ type: "session_id", cliSessionId: "durable-fresh" });
  f.emitRecorded({ type: "delta", text: "The visible assistant reply" });
  f.emitRecorded({ type: "result" });
  var stream = f.messages.filter(function (message) {
    return message.type === "home_mate_session_identity" || message.type === "home_mate_delta" || message.type === "home_mate_done";
  });
  assert.deepEqual(stream.map(function (message) {
    return [message.type, message.previousSessionId || null, message.sessionId, message.requestId, message.text || null];
  }), [
    ["home_mate_session_identity", "local:6", "durable-fresh", "open-fresh", null],
    ["home_mate_delta", null, "durable-fresh", "open-fresh", "The visible assistant reply"],
    ["home_mate_done", null, "durable-fresh", "open-fresh", "The visible assistant reply"],
  ]);
  assert.equal(f.getSession(6).responsePreview, "The visible assistant reply");
  assert.equal(f.ws._homeChatTap.sessionReference, "durable-fresh");
  var refreshed = f.messages.find(function (message) { return message.type === "home_mate_sessions_state"; });
  assert.equal(refreshed.sessions[0].id, "durable-fresh");
  assert.equal(refreshed.sessions[0].cliSessionId, "durable-fresh");
  assert.equal(refreshed.sessions[0].localId, 6);
});

test("Home final events recover canonical history text when a live delta was missed", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old", requestId: "open-final-only" });
  await settle();
  f.messages.length = 0;
  f.getSession(1).history.push({ type: "user_message", text: "Question" });
  f.getSession(1).history.push({ type: "delta", text: "Recovered from canonical history" });
  f.emitRecorded({ type: "done" });
  assert.equal(f.messages[0].type, "home_mate_done");
  assert.equal(f.messages[0].text, "Recovered from canonical history");
  assert.equal(f.messages[0].requestId, "open-final-only");
});

test("Explicit Mate conversation open rejects another user's session", function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-other", requestId: "open-denied" });
  assert.strictEqual(f.getSubscribed(), null);
  assert.strictEqual(f.messages[0].type, "home_mate_error");
  assert.strictEqual(f.messages[0].code, "session_not_found");
  assert.strictEqual(f.messages[0].sessionId, "session-other");
  assert.strictEqual(f.messages[0].requestId, "open-denied");
});

test("Home send failures inherit the active session correlation", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old", requestId: "open-send" });
  await settle();
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_mate_send", mateId: "mate-a", text: "Hello" });
  await settle();
  assert.strictEqual(f.messages[0].type, "home_mate_error");
  assert.strictEqual(f.messages[0].sessionId, "session-old");
  assert.strictEqual(f.messages[0].requestId, "open-send");
  assert.match(f.messages[0].text, /SDK bridge unavailable/);
});

test("Home send records one canonical user turn and restores user plus assistant history", async function () {
  var startCalls = 0;
  var f = fixture({ sdk: {
    startQuery: function () { startCalls++; },
    pushMessage: function () { throw new Error("unexpected push"); },
  } });
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old", requestId: "open-record" });
  await settle();
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: "session-old", requestId: "open-record", text: "Remember my question" });
  await settle();
  assert.equal(startCalls, 1);
  assert.deepEqual(f.getRecorded(), [{ type: "user_message", text: "Remember my question" }]);
  assert.equal(f.messages.some(function (message) { return message.type === "home_mate_user_message" || message.type === "user_message"; }), false);
  f.record(1, { type: "delta", text: "Here is the answer" });
  f.record(1, { type: "result" });
  f.handler.handleMessage(f.ws, { type: "home_mate_close" });
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old", requestId: "reopen-record" });
  await settle();
  assert.deepEqual(f.messages[0].messages, [
    { role: "user", text: "Remember my question" },
    { role: "assistant", text: "Here is the answer" },
  ]);
});

test("Capsule creation starts one exact Mate conversation without mutating a Capsule", async function () {
  var starts = [];
  var f = fixture({ allowCreate: true, sdk: {
    startQuery: function (session, text) { starts.push({ session: session, text: text }); },
    pushMessage: function () { throw new Error("unexpected push"); },
  } });
  f.handler.handleMessage(f.ws, {
    type: "home_mate_new_session",
    mateId: "mate-a",
    requestId: "capsule-create-1",
    intent: { type: "capsule_creation", description: "  A weekly review board  " },
  });
  await settle();
  assert.equal(f.getSubscribed(), 6);
  assert.deepEqual(f.getRecorded(), [{ type: "user_message", text: "A weekly review board" }]);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].session.localId, 6);
  assert.match(starts[0].text, /durable Capsule interface/);
  assert.match(starts[0].text, /A weekly review board/);
  assert.match(starts[0].text, /explicitly approved/);
  var history = f.messages.find(function (message) { return message.type === "home_mate_history"; });
  assert.equal(history.mateId, "mate-a");
  assert.equal(history.sessionId, "local:6");
  assert.equal(history.requestId, "capsule-create-1");
  assert.deepEqual(history.messages, [{ role: "user", text: "A weekly review board" }]);
  assert.equal(history.isProcessing, true);
});

test("invalid Capsule creation intent is correlated and creates no conversation", async function () {
  var f = fixture({ allowCreate: true, sdk: { startQuery: function () { throw new Error("unexpected start"); } } });
  f.handler.handleMessage(f.ws, {
    type: "home_mate_new_session",
    mateId: "mate-a",
    requestId: "capsule-create-empty",
    intent: { type: "capsule_creation", description: "   " },
  });
  await settle();
  assert.equal(f.getSession(6), undefined);
  assert.equal(f.messages[0].type, "home_mate_error");
  assert.equal(f.messages[0].requestId, "capsule-create-empty");
  assert.equal(f.messages[0].code, "capsule_description_required");
});

test("Home push-to-existing-query records one canonical user turn", async function () {
  var pushCalls = 0;
  var f = fixture({ sdk: {
    startQuery: function () { throw new Error("unexpected start"); },
    pushMessage: function () { pushCalls++; },
  } });
  f.getSession(1).isProcessing = true;
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old", requestId: "open-push" });
  await settle();
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: "session-old", requestId: "open-push", text: "Follow up" });
  await settle();
  assert.equal(pushCalls, 1);
  assert.deepEqual(f.getRecorded(), [{ type: "user_message", text: "Follow up" }]);
  assert.equal(f.messages.length, 0);
});

test("a synchronous Home dispatch failure preserves one submitted user turn", async function () {
  var f = fixture({ sdk: {
    startQuery: function () { throw new Error("dispatch failed"); },
    pushMessage: function () { throw new Error("unexpected push"); },
  } });
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old", requestId: "open-fail" });
  await settle();
  f.messages.length = 0;
  f.handler.handleMessage(f.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: "session-old", requestId: "open-fail", text: "Keep this submission" });
  await settle();
  assert.deepEqual(f.getRecorded(), [{ type: "user_message", text: "Keep this submission" }]);
  assert.equal(f.messages[0].type, "home_mate_error");
  assert.match(f.messages[0].text, /dispatch failed/);
});

test("single-user Mate conversation lists include only ownerless sessions", function () {
  var f = fixture({ singleUser: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_sessions_list", mateId: "mate-a" });
  assert.deepStrictEqual(f.messages[0].sessions, [
    { id: "session-single", cliSessionId: "session-single", localId: 5, title: "Single-user chat", vendor: null, model: null, createdAt: 0, lastActivity: 20, isProcessing: false, sessionRole: "driver", parentSessionId: null, parentAvailable: false, workerGeneration: null },
  ]);
});

test("unauthenticated multi-user Mate conversation requests reveal no sessions", function () {
  var f = fixture({ unauthenticated: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_sessions_list", mateId: "mate-a", requestId: "list-auth" });
  assert.strictEqual(f.messages[0].type, "home_mate_error");
  assert.strictEqual(f.messages[0].text, "Not authenticated.");
  assert.strictEqual(f.messages[0].requestId, "list-auth");
});
