var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-capsule-turn-"));
process.env.CLAY_HOME = testRoot;

var capsuleMateTurn = require("../lib/capsule-mate-turn");
var projectCapsuleTurn = require("../lib/project-capsule-turn");
var registry = require("../lib/tools-registry");
var serverTools = require("../lib/server-tools");

test.after(function () { fs.rmSync(testRoot, { recursive: true, force: true }); });

var PIG_MANIFEST = { id: "pig", name: "Pig" };

function playingEvent(seq, turn, status) {
  var event = { seq: seq, actor: "user", action: "hold", previous: {}, next: { status: status || "playing", turn: turn } };
  // Mirrors what a Capsule's Logic declares: engage on a turn handed to the
  // mate seat in a live game, nothing otherwise.
  if ((status || "playing") === "playing" && turn === "mate") event.engage = { kind: "turn" };
  return event;
}

function fakeMateProject() {
  var record = { deliveries: [], lookups: [], broadcasts: [] };
  record.broadcastToUser = function (userId, payload) { record.broadcasts.push({ userId: userId, payload: payload }); };
  record.findMateProject = function (userId, mateId, ensureRegistered) {
    record.lookups.push({ userId: userId, mateId: mateId, ensureRegistered: ensureRegistered });
    return {
      mate: { id: mateId || "clay-builtin" },
      ctx: {
        deliverCapsuleTurn: function (principal, options) {
          record.deliveries.push({ principal: principal, options: options });
          return Promise.resolve({ session: { localId: 7 }, created: record.deliveries.length === 1, reference: "local:7" });
        },
      },
    };
  };
  return record;
}

test("a human act that hands the turn to the mate seat wakes the opponent exactly once", async function () {
  var mateProject = fakeMateProject();
  var bridge = capsuleMateTurn.attachCapsuleMateTurn({
    users: { isMultiUser: function () { return true; } },
    findMateProject: mateProject.findMateProject,
  });

  await bridge.maybeNudge("user-a", PIG_MANIFEST, "human", playingEvent(4, "mate"));
  assert.strictEqual(mateProject.deliveries.length, 1);
  assert.strictEqual(mateProject.deliveries[0].principal.userId, "user-a");
  assert.strictEqual(mateProject.deliveries[0].options.toolId, "pig");
  assert.match(mateProject.deliveries[0].options.text, /clay_tool_snapshot/);
  assert.match(mateProject.deliveries[0].options.text, /"pig"/);

  // The same event never nudges twice, and older events never re-fire.
  await bridge.maybeNudge("user-a", PIG_MANIFEST, "human", playingEvent(4, "mate"));
  await bridge.maybeNudge("user-a", PIG_MANIFEST, "human", playingEvent(3, "mate"));
  assert.strictEqual(mateProject.deliveries.length, 1);

  // Mate acts, turns back to the user, or a finished game: no nudge.
  await bridge.maybeNudge("user-a", PIG_MANIFEST, "mate", playingEvent(5, "mate"));
  await bridge.maybeNudge("user-a", PIG_MANIFEST, "human", playingEvent(6, "user"));
  await bridge.maybeNudge("user-a", PIG_MANIFEST, "human", playingEvent(7, "mate", "complete"));
  assert.strictEqual(mateProject.deliveries.length, 1);
});

test("starting a new game seats the Mate at the table without letting it act", async function () {
  var mateProject = fakeMateProject();
  var bridge = capsuleMateTurn.attachCapsuleMateTurn({
    users: { isMultiUser: function () { return true; } },
    findMateProject: mateProject.findMateProject,
    broadcastToUser: mateProject.broadcastToUser,
  });

  var resetEvent = { seq: 9, actor: "user", action: "reset", previous: {}, next: { status: "playing", turn: "user" }, engage: { kind: "start" } };
  await bridge.maybeNudge("user-a", PIG_MANIFEST, "human", resetEvent);
  assert.strictEqual(mateProject.deliveries.length, 1);
  assert.match(mateProject.deliveries[0].options.text, /started a new game/);
  assert.match(mateProject.deliveries[0].options.text, /do not call clay_tool_act now/);
  // The explicit start pushes the game session to the user's clients, so the
  // home board can navigate into the Mate's game conversation.
  assert.strictEqual(mateProject.broadcasts.length, 1);
  assert.strictEqual(mateProject.broadcasts[0].userId, "user-a");
  assert.strictEqual(mateProject.broadcasts[0].payload.type, "capsule_game_session");
  assert.strictEqual(mateProject.broadcasts[0].payload.kind, "start");
  assert.strictEqual(mateProject.broadcasts[0].payload.sessionId, "local:7");
  assert.strictEqual(mateProject.broadcasts[0].payload.mateId, "clay-builtin");

  // A Mate resetting a finished game does not announce to itself, and the
  // same reset event never fires twice.
  await bridge.maybeNudge("user-a", PIG_MANIFEST, "human", resetEvent);
  await bridge.maybeNudge("user-a", PIG_MANIFEST, "mate", { seq: 10, actor: "mate", action: "reset", previous: {}, next: { status: "playing", turn: "user" }, engage: { kind: "start" } });
  assert.strictEqual(mateProject.deliveries.length, 1);
});

test("the opponent seat belongs to the Mate that last acted, with the host Mate as the fallback", async function () {
  var mateProject = fakeMateProject();
  var bridge = capsuleMateTurn.attachCapsuleMateTurn({
    users: { isMultiUser: function () { return false; } },
    findMateProject: mateProject.findMateProject,
  });

  // No Mate has acted yet: the lookup falls back to the built-in host Mate.
  await bridge.maybeNudge("default", PIG_MANIFEST, "human", playingEvent(1, "mate"));
  assert.strictEqual(mateProject.lookups[0].mateId, null);
  assert.strictEqual(mateProject.lookups[0].ensureRegistered, true);
  // Single-user mode binds no owner onto the session.
  assert.strictEqual(mateProject.deliveries[0].principal.userId, null);

  bridge.rememberOpponent("default", "pig", "mate-folder-7");
  await bridge.maybeNudge("default", PIG_MANIFEST, "human", playingEvent(2, "mate"));
  assert.strictEqual(mateProject.lookups[1].mateId, "mate-folder-7");
});

test("a nudge failure is contained and never breaks the act that caused it", async function () {
  var bridge = capsuleMateTurn.attachCapsuleMateTurn({
    users: { isMultiUser: function () { return true; } },
    findMateProject: function () { throw new Error("registry exploded"); },
  });
  var result = await bridge.maybeNudge("user-a", PIG_MANIFEST, "human", playingEvent(1, "mate"));
  assert.strictEqual(result, null);
});

test("deliverCapsuleTurn hosts the whole game in one reused session", async function () {
  var sessions = new Map();
  var recorded = [];
  var queries = [];
  var nextId = 1;
  var sm = {
    sessions: sessions,
    createSessionRaw: function (options) {
      var session = { localId: "s" + nextId++, ownerId: options.ownerId, vendor: options.vendor, model: options.model, effort: options.effort || null };
      sessions.set(session.localId, session);
      return session;
    },
    sendAndRecord: function (session, message) { recorded.push({ session: session, message: message }); },
    broadcastSessionList: function () {},
  };
  var sdk = {
    pushMessage: function () { return false; },
    startQuery: function (session, text) { queries.push({ session: session, text: text }); return Promise.resolve(); },
  };
  var turns = projectCapsuleTurn.attachCapsuleTurn({
    sm: sm,
    getSdk: function () { return sdk; },
    getLinuxUserForSession: function () { return null; },
    isMultiUser: function () { return false; },
    resolveModel: function () { return Promise.resolve({ status: "ready", vendor: "claude", model: "test-model", effort: "high" }); },
  });

  var principal = { userId: null };
  var first = await turns.deliverCapsuleTurn(principal, { toolId: "pig", toolName: "Pig", kind: "turn", text: "your turn" });
  assert.strictEqual(first.created, true);
  assert.strictEqual(first.reference, "local:" + first.session.localId);
  assert.strictEqual(first.session.title, "Pig game");
  assert.deepStrictEqual(first.session.capsuleGame, { toolId: "pig" });
  assert.strictEqual(first.session.effort, "high");
  assert.strictEqual(queries.length, 1);
  // The delivery is recorded as a dedicated event the transcript renders as a
  // short system note, never as a human turn.
  assert.strictEqual(recorded[0].message.type, "capsule_turn");
  assert.strictEqual(recorded[0].message.toolId, "pig");
  assert.strictEqual(recorded[0].message.kind, "turn");

  var second = await turns.deliverCapsuleTurn(principal, { toolId: "pig", toolName: "Pig", text: "your turn again" });
  assert.strictEqual(second.session, first.session, "the game keeps one session across turns");
  assert.strictEqual(second.created, false);
  assert.strictEqual(sessions.size, 1);
  assert.strictEqual(queries.length, 2);
});

test("a live query receives the turn through pushMessage instead of a second query", async function () {
  var pushed = [];
  var sm = {
    sessions: new Map(),
    createSessionRaw: function (options) {
      var session = { localId: "s1", ownerId: options.ownerId };
      sm.sessions.set(session.localId, session);
      return session;
    },
    sendAndRecord: function () {},
    broadcastSessionList: function () {},
  };
  var sdk = {
    pushMessage: function (session, text) { pushed.push(text); return true; },
    startQuery: function () { throw new Error("startQuery must not run when pushMessage delivered"); },
  };
  var turns = projectCapsuleTurn.attachCapsuleTurn({
    sm: sm,
    getSdk: function () { return sdk; },
    getLinuxUserForSession: function () { return null; },
    isMultiUser: function () { return false; },
    resolveModel: function () { return Promise.resolve({ status: "ready", vendor: "claude", model: "test-model" }); },
  });
  await turns.deliverCapsuleTurn({ userId: null }, { toolId: "pig", toolName: "Pig", text: "turn" });
  assert.deepStrictEqual(pushed, ["turn"]);
});

test("the act pipeline wakes the opponent when the user hands the turn over", async function () {
  var mateProject = fakeMateProject();
  var tools = serverTools.attachTools({
    users: { isMultiUser: function () { return true; }, findUserById: function (id) { return { id: id }; } },
    projects: new Map(),
    findMateProject: mateProject.findMateProject,
  });
  registry.listTools({ userId: "turn-user", multiUser: true });

  // The user rolls and holds; holding hands the turn to the mate seat.
  var state = await tools.controlForUser("turn-user", "pig", "act", { actionId: "roll", args: {} });
  if (state.turn === "user") state = await tools.controlForUser("turn-user", "pig", "act", { actionId: "hold", args: {} });
  assert.strictEqual(state.turn, "mate");
  for (var i = 0; i < 100 && mateProject.deliveries.length === 0; i++) {
    await new Promise(function (resolve) { setTimeout(resolve, 5); });
  }
  assert.strictEqual(mateProject.deliveries.length, 1);
  assert.strictEqual(mateProject.deliveries[0].options.toolId, "pig");

  // The mate plays its turn back: the opponent seat is remembered, and the
  // mate's own acts never nudge anyone.
  var before = mateProject.deliveries.length;
  var mateState = await tools.controlForMate("turn-user", "mate-folder-9", "pig", "act", { actionId: "hold", args: {} });
  assert.strictEqual(mateState.turn, "user");
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  assert.strictEqual(mateProject.deliveries.length, before);

  state = await tools.controlForUser("turn-user", "pig", "act", { actionId: "roll", args: {} });
  if (state.turn === "user") state = await tools.controlForUser("turn-user", "pig", "act", { actionId: "hold", args: {} });
  for (var j = 0; j < 100 && mateProject.deliveries.length === before; j++) {
    await new Promise(function (resolve) { setTimeout(resolve, 5); });
  }
  var lastLookup = mateProject.lookups[mateProject.lookups.length - 1];
  assert.strictEqual(lastLookup.mateId, "mate-folder-9", "the Mate that played holds the seat");
});
