var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var createSessionManager = require("../lib/sessions").createSessionManager;
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;

test("processSDKMessage forwards Codex's real turnId into the persisted message_uuid record", function () {
  var recorded = [];
  var sm = { sendAndRecord: function (session, obj) { recorded.push(obj); } };
  var mp = attachMessageProcessor({ sm: sm, send: function () {} });
  var session = { messageUUIDs: [], history: [] };

  // Exactly the shape codex.js's flattenEvent emits for turn/started.
  mp.processSDKMessage(session, { yokeType: "turn_start", uuid: "u1", messageType: "user", turnId: "turn-live-1" });

  assert.equal(session.messageUUIDs[0].turnId, "turn-live-1", "the in-memory entry carries the real turnId");
  var persisted = recorded.find(function (m) { return m.type === "message_uuid"; });
  assert.ok(persisted, "a message_uuid record is sent for persistence");
  assert.equal(persisted.turnId, "turn-live-1",
    "the object handed to sendAndRecord -- what actually gets written to the session file -- must carry turnId too, not just the in-memory session.messageUUIDs copy");
});

// Codex's thread/revert needs a real turnId (not a count) to roll back a
// conversation (see lib/sdk-bridge.js's rollbackConversation). That id is
// captured in-memory on session.messageUUIDs, but it must also survive a
// real save/reload round trip (daemon restart, Worker respawn) or every
// rewind on a session that outlives one process would silently lose its
// only valid target and fail closed.

function manager(root) {
  return createSessionManager({
    cwd: path.join(root, "project"),
    sessionsBase: path.join(root, "sessions"),
    send: function () {},
  });
}

test("a Codex turn's turnId survives a real save and reload round trip", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-turnid-persist-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var first = manager(root);
  var session = first.createSession({ vendor: "codex", cliSessionId: "thread-abc" });

  // Mirrors exactly what sdk-message-processor.js emits for a Codex user turn.
  first.sendAndRecord(session, { type: "message_uuid", uuid: "uuid-1", messageType: "user", turnId: "turn-111" });
  first.sendAndRecord(session, { type: "message_uuid", uuid: "uuid-2", messageType: "assistant" });
  first.saveSessionFile(session);

  // A fresh manager over the same sessionsBase simulates a daemon restart.
  var second = manager(root);
  var reloaded = Array.from(second.sessions.values()).find(function (s) { return s.cliSessionId === "thread-abc"; });
  assert.ok(reloaded, "the session is reloaded from disk");
  var userEntry = reloaded.messageUUIDs.find(function (m) { return m.uuid === "uuid-1"; });
  assert.ok(userEntry, "the user turn's messageUUIDs entry is reconstructed");
  assert.equal(userEntry.turnId, "turn-111", "the real Codex turnId is not lost across a restart");
});

test("a Claude turn's absent turnId reloads as null, not a stale leftover", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-turnid-claude-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var first = manager(root);
  var session = first.createSession({ vendor: "claude", cliSessionId: "claude-session-1" });
  first.sendAndRecord(session, { type: "message_uuid", uuid: "uuid-1", messageType: "user", turnId: null });
  first.saveSessionFile(session);

  var second = manager(root);
  var reloaded = Array.from(second.sessions.values()).find(function (s) { return s.cliSessionId === "claude-session-1"; });
  var userEntry = reloaded.messageUUIDs.find(function (m) { return m.uuid === "uuid-1"; });
  assert.equal(userEntry.turnId, null);
});
