var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var attachHomeChat = require("../lib/server-home-chat").attachHomeChat;

function settle() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function fixture(options) {
  var opts = options || {};
  var mateModel = Object.prototype.hasOwnProperty.call(opts, "mateModel") ? opts.mateModel : "fable";
  var mateVendor = opts.mateVendor || "claude";
  var mate = { id: "mate-a", name: "A", vendor: mateVendor, model: mateModel };
  if (opts.builtinClay) mate.builtinKey = "clay";
  var sessions = new Map();
  if (opts.existingSession) sessions.set(1, opts.existingSession);
  var created = [];
  var saved = [];
  var dispatched = [];
  var manager = {
    sessions: sessions,
    createSession: function (sessionOptions) {
      created.push(sessionOptions);
      var session = Object.assign({ localId: created.length + 10, history: [], lastActivity: Date.now() }, sessionOptions);
      sessions.set(session.localId, session);
      return session;
    },
    subscribeSession: function () { return function () {}; },
    sendAndRecord: function (session, event) { session.history.push(event); },
    saveSessionFile: opts.noPersistence ? null : function (session) {
      if (opts.persistenceError) throw new Error("save failed");
      saved.push(session.localId);
    },
  };
  var messages = [];
  var ws = {
    readyState: 1,
    _clayUser: opts.unauthenticated ? null : { id: "u1" },
    send: function (value) { messages.push(JSON.parse(value)); },
  };
  var updates = [];
  var project = {
    getSessionManager: function () { return manager; },
    getVendorModelCatalog: function (catalogWs, vendor) {
      var catalog = opts.catalogs && opts.catalogs[vendor] ? opts.catalogs[vendor] : opts.catalog;
      return Promise.resolve(catalog || {
        status: "ready",
        error: "",
        models: [
          { value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" },
          { value: "sonnet", displayName: "Claude Sonnet" },
        ],
      });
    },
    getVendorModelAvailability: function () {
      return opts.vendors || [{ id: "claude", displayName: "Claude", installed: true }];
    },
    sdk: opts.sdk === null ? null : (opts.sdk || {
      startQuery: function (session) { dispatched.push(session.model); },
      pushMessage: function (session) { dispatched.push(session.model); },
    }),
    getMemoryState: function () { return { entries: [], summary: "" }; },
    listKnowledgeFiles: function () { return []; },
    forEachClient: function (fn) { fn(ws); },
  };
  var handler = attachHomeChat({
    users: { isMultiUser: function () { return true; }, findUserById: function (id) { return id === "u1" ? { id: id } : null; } },
    mates: {
      buildMateCtx: function (userId) { return { userId: userId }; },
      getAllMates: function () { return [mate]; },
      getMate: function () { return mate; },
      getMateDir: function () { return "/tmp/mate-a"; },
      updateMate: function (ctx, mateId, patch) {
        updates.push({ ctx: ctx, mateId: mateId, patch: patch });
        mate = Object.assign({}, mate, patch);
        return mate;
      },
    },
    projects: new Map([["mate-mate-a", project]]),
    addProject: function () {},
    resolveDefaultAi: opts.resolveDefaultAi,
  });
  return { handler: handler, ws: ws, messages: messages, updates: updates, created: created, sessions: sessions, manager: manager, saved: saved, dispatched: dispatched, getMate: function () { return mate; } };
}

test("Mate model catalog responses preserve request correlation and vendor state", async function () {
  var f = fixture();
  assert.equal(f.handler.handleMessage(f.ws, { type: "home_mate_models_get", mateId: "mate-a", requestId: "catalog-1" }), true);
  await settle();
  assert.deepEqual(f.messages[0], {
    type: "home_mate_models_state",
    mateId: "mate-a",
    requestId: "catalog-1",
    vendor: "claude",
    mateVendor: "claude",
    mateModel: "fable",
    model: "fable",
    models: [
      { value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" },
      { value: "sonnet", displayName: "Claude Sonnet" },
    ],
    vendors: [{ id: "claude", displayName: "Claude", installed: true }],
    status: "ready",
    error: "",
  });
  assert.equal(f.messages.some(function (message) { return message.type === "model_info"; }), false);
});

test("Mate model access errors remain correlated instead of leaving the UI loading", function () {
  var f = fixture({ unauthenticated: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_models_get", mateId: "mate-a", requestId: "catalog-auth" });
  assert.deepEqual(f.messages[0], { type: "home_mate_models_state", mateId: "mate-a", requestId: "catalog-auth", vendor: "", mateVendor: "", mateModel: "", model: "", models: [], vendors: [], status: "error", error: "Not authenticated." });
});

test("Mate model selection validates the Mate vendor catalog before persistence", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "claude", model: "unknown", requestId: "set-invalid" });
  await settle();
  assert.equal(f.updates.length, 0);
  assert.equal(f.messages[0].type, "home_mate_model_result");
  assert.equal(f.messages[0].requestId, "set-invalid");
  assert.equal(f.messages[0].ok, false);
  assert.match(f.messages[0].error, /not available/);
});

test("valid Mate model selection persists and broadcasts the server-confirmed record", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "claude", model: "claude-fable-5", requestId: "set-valid" });
  await settle();
  assert.deepEqual(f.updates[0], { ctx: { userId: "u1" }, mateId: "mate-a", patch: { vendor: "claude", model: "fable" } });
  assert.equal(f.getMate().model, "fable");
  assert.equal(f.messages[0].type, "mate_updated");
  assert.equal(f.messages[0].mate.model, "fable");
  assert.deepEqual(f.messages[1], { type: "home_mate_model_result", mateId: "mate-a", requestId: "set-valid", ok: true, vendor: "claude", model: "fable" });
});

test("Mate model chooser loads another configured vendor without partially persisting it", async function () {
  var f = fixture({
    vendors: [
      { id: "claude", displayName: "Claude", installed: true },
      { id: "codex", displayName: "Codex", installed: true },
    ],
    catalogs: {
      claude: { status: "error", models: [], error: "Claude authentication expired." },
      codex: { status: "ready", models: [{ value: "gpt-5.6", displayName: "GPT-5.6" }], error: "" },
    },
  });
  f.handler.handleMessage(f.ws, { type: "home_mate_models_get", mateId: "mate-a", vendor: "codex", requestId: "catalog-codex" });
  await settle();
  assert.equal(f.messages[0].vendor, "codex");
  assert.equal(f.messages[0].mateVendor, "claude");
  assert.equal(f.messages[0].model, "");
  assert.deepEqual(f.messages[0].models, [{ value: "gpt-5.6", displayName: "GPT-5.6" }]);
  assert.equal(f.updates.length, 0);
  assert.equal(f.getMate().vendor, "claude");
});

test("vendor and concrete model persist atomically and seed new Home sessions", async function () {
  var f = fixture({
    vendors: [
      { id: "claude", displayName: "Claude", installed: true },
      { id: "codex", displayName: "Codex", installed: true },
    ],
    catalogs: {
      codex: { status: "ready", models: [{ value: "gpt-5.6", resolvedModel: "gpt-5.6-codex", displayName: "GPT-5.6" }], error: "" },
    },
  });
  f.handler.handleMessage(f.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "codex", model: "gpt-5.6-codex", requestId: "set-codex" });
  await settle();
  assert.deepEqual(f.updates[0].patch, { vendor: "codex", model: "gpt-5.6" });
  assert.equal(f.messages[0].type, "mate_updated");
  assert.equal(f.messages[0].mate.vendor, "codex");
  assert.deepEqual(f.messages[1], { type: "home_mate_model_result", mateId: "mate-a", requestId: "set-codex", ok: true, vendor: "codex", model: "gpt-5.6" });
  f.handler.handleMessage(f.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "new-codex" });
  await settle();
  assert.equal(f.created[0].vendor, "codex");
  assert.equal(f.created[0].model, "gpt-5.6");
});

test("fresh builtin Clay sessions use shared Default AI while custom Mates retain their configured runtime", async function () {
  var resolver = function () { return Promise.resolve({ ready: true, vendor: "codex", model: "gpt-6-astra", effort: "high" }); };
  var clay = fixture({ builtinClay: true, resolveDefaultAi: resolver });
  clay.handler.handleMessage(clay.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "clay-default" });
  await settle();
  assert.deepEqual([clay.created[0].vendor, clay.created[0].model, clay.created[0].effort], ["codex", "gpt-6-astra", "high"]);
  assert.equal(clay.updates.length, 0, "the shared default does not overwrite the builtin Mate record");

  var custom = fixture({ resolveDefaultAi: resolver });
  custom.handler.handleMessage(custom.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "custom-config" });
  await settle();
  assert.deepEqual([custom.created[0].vendor, custom.created[0].model], ["claude", "fable"]);
});

test("composer model selection updates the same pristine Home draft and its next send", async function () {
  var f = fixture({
    vendors: [
      { id: "claude", displayName: "Claude", installed: true },
      { id: "codex", displayName: "Codex", installed: true },
    ],
    catalogs: { codex: { status: "ready", models: [{ value: "gpt-5.6", resolvedModel: "gpt-5.6-codex" }] } },
  });
  f.handler.handleMessage(f.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "new-draft" });
  await settle();
  var history = f.messages.filter(function (message) { return message.type === "home_mate_history"; })[0];
  assert.equal(history.sessionId, "local:11");
  f.handler.handleMessage(f.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "codex", model: "gpt-5.6-codex", sessionId: history.sessionId, requestId: "draft-model" });
  await settle();
  var result = f.messages.filter(function (message) { return message.type === "home_mate_model_result"; })[0];
  assert.equal(result.ok, true);
  assert.equal(result.requestedSessionId, "local:11");
  assert.equal(result.sessionId, "local:11");
  assert.equal(result.sessionApplied, true);
  assert.equal(result.sessionVendor, "codex");
  assert.equal(result.sessionModel, "gpt-5.6");
  assert.equal(f.sessions.get(11).vendor, "codex");
  assert.equal(f.sessions.get(11).model, "gpt-5.6");
  assert.deepEqual(f.saved, [11]);
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.getMate(), { id: "mate-a", name: "A", vendor: "codex", model: "gpt-5.6" });
  f.handler.handleMessage(f.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: "local:11", requestId: "new-draft", text: "Use the draft model" });
  await settle();
  assert.deepEqual(f.dispatched, ["gpt-5.6"]);
  assert.equal(f.created.length, 1);
});

test("activity, processing, stale, and other-user sessions remain immutable while the Mate default updates", async function () {
  var activityTypes = ["user_message", "delta", "tool_start", "tool_result"];
  for (var i = 0; i < activityTypes.length; i++) {
    var session = { localId: 1, cliSessionId: "activity-" + i, ownerId: "u1", vendor: "claude", model: "fable", history: [{ type: activityTypes[i] }], lastActivity: 20 };
    var active = fixture({ existingSession: session });
    active.handler.handleMessage(active.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "claude", model: "sonnet", sessionId: session.cliSessionId, requestId: "activity-set-" + i });
    await settle();
    var activeResult = active.messages.filter(function (message) { return message.type === "home_mate_model_result"; })[0];
    assert.equal(activeResult.sessionApplied, false);
    assert.match(activeResult.sessionReason, /already has activity/);
    assert.equal(session.model, "fable");
    assert.deepEqual(active.saved, []);
    assert.equal(active.getMate().model, "sonnet");
  }

  var processingSession = { localId: 1, cliSessionId: "processing", ownerId: "u1", vendor: "claude", model: "fable", history: [], isProcessing: true };
  var processing = fixture({ existingSession: processingSession });
  processing.handler.handleMessage(processing.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "claude", model: "sonnet", sessionId: "processing", requestId: "processing-set" });
  await settle();
  assert.equal(processingSession.model, "fable");
  assert.equal(processing.messages.filter(function (message) { return message.type === "home_mate_model_result"; })[0].sessionApplied, false);

  var owned = { localId: 1, cliSessionId: "owned", ownerId: "u1", vendor: "claude", model: "fable", history: [] };
  var inaccessible = fixture({ existingSession: owned });
  inaccessible.sessions.set(2, { localId: 2, cliSessionId: "other-user", ownerId: "u2", vendor: "claude", model: "fable", history: [] });
  inaccessible.handler.handleMessage(inaccessible.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "claude", model: "sonnet", sessionId: "other-user", requestId: "other-set" });
  await settle();
  var inaccessibleResult = inaccessible.messages.filter(function (message) { return message.type === "home_mate_model_result"; })[0];
  assert.equal(inaccessibleResult.sessionApplied, false);
  assert.equal(inaccessible.sessions.get(2).model, "fable");
  assert.deepEqual(inaccessible.saved, []);
});

test("a draft persistence failure rolls back in-memory session metadata", async function () {
  var session = { localId: 1, cliSessionId: "draft-save-error", ownerId: "u1", vendor: "claude", model: "fable", history: [] };
  var f = fixture({ existingSession: session, persistenceError: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "claude", model: "sonnet", sessionId: "draft-save-error", requestId: "draft-save" });
  await settle();
  var result = f.messages.filter(function (message) { return message.type === "home_mate_model_result"; })[0];
  assert.equal(result.ok, true);
  assert.equal(result.sessionApplied, false);
  assert.match(result.sessionReason, /could not be persisted/);
  assert.equal(session.vendor, "claude");
  assert.equal(session.model, "fable");
});

test("vendor-only, unavailable-vendor, and cross-catalog selections never persist", async function () {
  var options = {
    vendors: [
      { id: "claude", displayName: "Claude", installed: true },
      { id: "codex", displayName: "Codex", installed: true },
    ],
    catalogs: { codex: { status: "ready", models: ["gpt-5.6"], error: "" } },
  };
  var missing = fixture(options);
  missing.handler.handleMessage(missing.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "codex", model: "", requestId: "missing-model" });
  await settle();
  assert.equal(missing.updates.length, 0);
  assert.equal(missing.messages[0].ok, false);

  var unavailable = fixture(options);
  unavailable.handler.handleMessage(unavailable.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "gemini", model: "gemini-2", requestId: "bad-vendor" });
  await settle();
  assert.equal(unavailable.updates.length, 0);
  assert.match(unavailable.messages[0].error, /not configured/);

  var mismatched = fixture(options);
  mismatched.handler.handleMessage(mismatched.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "codex", model: "sonnet", requestId: "cross-catalog" });
  await settle();
  assert.equal(mismatched.updates.length, 0);
  assert.match(mismatched.messages[0].error, /not available/);
});

test("Mate model resolver repairs invalid records with the saved catalog default then first entry", async function () {
  var preferred = fixture({
    mateModel: "removed-model",
    catalog: { status: "ready", models: ["fable", "sonnet"], defaultModel: "sonnet", error: "" },
  });
  preferred.handler.handleMessage(preferred.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "new-preferred" });
  await settle();
  assert.equal(preferred.getMate().model, "sonnet");
  assert.equal(preferred.created[0].model, "sonnet");
  assert.equal(preferred.messages[0].type, "mate_updated");
  assert.equal(preferred.messages[0].mate.model, "sonnet");

  var first = fixture({
    mateModel: "removed-model",
    catalog: { status: "ready", models: [{ displayName: "Unavailable heading" }, "fable", "sonnet"], defaultModel: "removed-default", error: "" },
  });
  first.handler.handleMessage(first.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "new-first" });
  await settle();
  assert.equal(first.getMate().model, "fable");
  assert.equal(first.created[0].model, "fable");
});

test("catalog failures create no Home session and return an actionable correlated error", async function () {
  var f = fixture({ mateModel: null, catalog: { status: "error", models: [], error: "Vendor authentication expired. Reconnect the vendor and try again." } });
  f.handler.handleMessage(f.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "new-error" });
  await settle();
  assert.equal(f.created.length, 0);
  assert.equal(f.messages[0].type, "home_mate_error");
  assert.equal(f.messages[0].requestId, "new-error");
  assert.equal(f.messages[0].code, "model_unavailable");
  assert.match(f.messages[0].text, /authentication expired/);
});

test("automatic Home open resolves a concrete model and enables the correlated send path", async function () {
  var f = fixture({ mateModel: null, catalog: { status: "ready", models: ["sonnet"], defaultModel: "sonnet", error: "" } });
  f.handler.handleMessage(f.ws, { type: "home_mate_open", mateId: "mate-a", requestId: "open-resolve" });
  await settle();
  var history = f.messages.filter(function (message) { return message.type === "home_mate_history"; })[0];
  assert.equal(history.requestId, "open-resolve");
  assert.equal(history.vendor, "claude");
  assert.equal(history.model, "sonnet");
  assert.equal(f.getMate().model, "sonnet");
  f.handler.handleMessage(f.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: history.sessionId, requestId: "open-resolve", text: "Hello" });
  await settle();
  assert.deepEqual(f.dispatched, ["sonnet"]);
});

test("catalog outages do not block exact or default resume of concrete sessions", async function () {
  var exactSession = { localId: 1, cliSessionId: "exact-ready", ownerId: "u1", vendor: "codex", model: "gpt-5.6", history: [], lastActivity: 20 };
  var exact = fixture({ mateModel: null, existingSession: exactSession, catalog: { status: "error", models: [], error: "Vendor authentication expired." } });
  exact.handler.handleMessage(exact.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "exact-ready", requestId: "exact-offline" });
  await settle();
  assert.equal(exact.messages[0].type, "home_mate_history");
  assert.equal(exact.messages[0].model, "gpt-5.6");
  assert.equal(exact.messages[0].requestId, "exact-offline");
  assert.deepEqual(exact.saved, []);
  assert.deepEqual(exact.updates, []);

  var latestSession = { localId: 1, cliSessionId: "latest-ready", ownerId: "u1", vendor: "claude", model: "sonnet", history: [], lastActivity: 30 };
  var latest = fixture({ mateModel: null, existingSession: latestSession, catalog: { status: "error", models: [], error: "Vendor authentication expired." } });
  latest.handler.handleMessage(latest.ws, { type: "home_mate_open", mateId: "mate-a", requestId: "default-offline" });
  await settle();
  assert.equal(latest.messages[0].type, "home_mate_history");
  assert.equal(latest.messages[0].sessionId, "latest-ready");
  assert.equal(latest.messages[0].model, "sonnet");
  assert.deepEqual(latest.saved, []);
  assert.deepEqual(latest.updates, []);
});

test("legacy model-less sessions commit once while concrete sessions remain immutable", async function () {
  var legacySession = { localId: 1, cliSessionId: "legacy", ownerId: "u1", vendor: "claude", model: null, history: [], lastActivity: 20 };
  var legacy = fixture({ mateModel: "sonnet", existingSession: legacySession });
  legacy.handler.handleMessage(legacy.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "legacy", requestId: "legacy-open" });
  await settle();
  assert.equal(legacySession.model, "sonnet");
  assert.deepEqual(legacy.saved, [1]);
  legacy.handler.handleMessage(legacy.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "legacy", requestId: "legacy-reopen" });
  await settle();
  assert.deepEqual(legacy.saved, [1]);

  var concreteSession = { localId: 1, cliSessionId: "concrete", ownerId: "u1", vendor: "claude", model: "fable", history: [], lastActivity: 20 };
  var concrete = fixture({ mateModel: "sonnet", existingSession: concreteSession });
  concrete.handler.handleMessage(concrete.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "concrete", requestId: "concrete-open" });
  await settle();
  assert.equal(concreteSession.model, "fable");
  assert.deepEqual(concrete.saved, []);
});

test("legacy session mutation waits for metadata persistence capability", async function () {
  var session = { localId: 1, cliSessionId: "legacy-no-save", ownerId: "u1", vendor: "legacy-vendor", model: null, history: [], lastActivity: 20 };
  var f = fixture({ mateModel: "sonnet", existingSession: session, noPersistence: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "legacy-no-save", requestId: "legacy-no-save-open" });
  await settle();
  assert.equal(session.vendor, "legacy-vendor");
  assert.equal(session.model, null);
  assert.deepEqual(f.updates, []);
  assert.equal(f.messages[0].type, "home_mate_error");
  assert.equal(f.messages[0].requestId, "legacy-no-save-open");
  assert.equal(f.messages[0].sessionId, "legacy-no-save");
  assert.equal(f.messages[0].code, "model_unavailable");
  assert.match(f.messages[0].text, /persist/);
});

test("Home send resolves a legacy model before dispatch and blocks when no catalog is available", async function () {
  var session = { localId: 1, cliSessionId: "legacy-send", ownerId: "u1", vendor: "claude", model: "", history: [], lastActivity: 20 };
  var ready = fixture({ mateModel: "sonnet", existingSession: session });
  ready.handler.handleMessage(ready.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "legacy-send", requestId: "send-open" });
  await settle();
  ready.handler.handleMessage(ready.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: "legacy-send", requestId: "send-open", text: "Hello" });
  await settle();
  assert.deepEqual(ready.dispatched, ["sonnet"]);

  var blockedSession = { localId: 1, cliSessionId: "blocked", ownerId: "u1", vendor: "claude", model: null, history: [], lastActivity: 20 };
  var blocked = fixture({ mateModel: null, existingSession: blockedSession, catalog: { status: "empty", models: [], error: "No installed models." } });
  blocked.ws._homeChatTap = { mateId: "mate-a", sessionId: 1, sessionReference: "blocked", requestId: "blocked-send" };
  blocked.handler.handleMessage(blocked.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: "blocked", requestId: "blocked-send", text: "Hello" });
  await settle();
  assert.deepEqual(blocked.dispatched, []);
  assert.equal(blocked.messages[0].code, "model_unavailable");
  assert.equal(blocked.messages[0].requestId, "blocked-send");
});

test("new Home sessions inherit the Mate model while existing sessions remain unchanged", async function () {
  var fresh = fixture({ mateModel: "sonnet" });
  fresh.handler.handleMessage(fresh.ws, { type: "home_mate_open", mateId: "mate-a" });
  await settle();
  fresh.handler.handleMessage(fresh.ws, { type: "home_mate_new_session", mateId: "mate-a" });
  await settle();
  assert.equal(fresh.created.length, 2);
  assert.deepEqual(fresh.created.map(function (options) { return [options.vendor, options.model]; }), [["claude", "sonnet"], ["claude", "sonnet"]]);

  var existingSession = { localId: 1, cliSessionId: "existing", ownerId: "u1", vendor: "claude", model: "fable", history: [], lastActivity: 20 };
  var existing = fixture({ mateModel: "sonnet", existingSession: existingSession });
  existing.handler.handleMessage(existing.ws, { type: "home_mate_open", mateId: "mate-a" });
  await settle();
  assert.equal(existing.created.length, 0);
  assert.equal(existingSession.model, "fable");
});

test("Mate model messages route through Home ownership and cannot bypass catalog validation", function () {
  var root = path.join(__dirname, "..");
  var projectSource = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var schemaSource = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");
  var matesSource = fs.readFileSync(path.join(root, "lib/server-mates.js"), "utf8");
  var homeSource = fs.readFileSync(path.join(root, "lib/server-home-chat.js"), "utf8");
  var homeModelsSource = fs.readFileSync(path.join(root, "lib/server-home-models.js"), "utf8");
  assert.match(projectSource, /home_mate_models_get[\s\S]*home_mate_model_set[\s\S]*opts\.onDmMessage/);
  assert.match(schemaSource, /"home_mate_models_get"[\s\S]*"home_mate_model_set"[\s\S]*"home_mate_models_state"[\s\S]*"home_mate_model_result"/);
  assert.match(homeSource, /findMateProject\(userId, msg\.mateId, true\)/);
  assert.match(homeModelsSource, /catalogModel\(catalog\.models \|\| \[\], msg\.model\)/);
  assert.match(matesSource, /hasOwnProperty\.call\(msg\.updates, "model"\)[\s\S]*Use the Mate model selector/);
});
