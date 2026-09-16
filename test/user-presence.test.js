var test = require("node:test");
var assert = require("node:assert");
var userPresence = require("../lib/user-presence");

test("sessionIdForPersistence prefers the durable CLI session id", function () {
  assert.strictEqual(userPresence.sessionIdForPersistence({
    localId: 17,
    cliSessionId: "cli-durable",
  }), "cli-durable");
  assert.strictEqual(userPresence.sessionIdForPersistence({ localId: 17 }), 17);
});

test("findSession restores a renumbered session through its CLI session id", function () {
  var sessions = new Map([
    [41, { localId: 41, cliSessionId: "cli-other" }],
    [42, { localId: 42, cliSessionId: "cli-active" }],
  ]);
  assert.strictEqual(userPresence.findSession(sessions, "cli-active"), sessions.get(42));
});

test("findSession accepts legacy numeric presence records", function () {
  var sessions = new Map([
    [8, { localId: 8, cliSessionId: "cli-eight" }],
  ]);
  assert.strictEqual(userPresence.findSession(sessions, 8), sessions.get(8));
});

test("disconnect presence cannot overwrite a newer tab selection", function () {
  assert.equal(userPresence.shouldPersistDisconnectPresence({ sessionId: "newer" }, "older"), false);
  assert.equal(userPresence.shouldPersistDisconnectPresence({ sessionId: "same" }, "same"), true);
  assert.equal(userPresence.shouldPersistDisconnectPresence(null, "first"), true);
  assert.equal(userPresence.shouldPersistDisconnectPresence(null, null), false);
  var session = { localId: 11, cliSessionId: "cli-11" };
  assert.equal(userPresence.shouldPersistDisconnectPresence({ sessionId: 11 }, "cli-11", session, session), true);
});
