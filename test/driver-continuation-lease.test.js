var test = require("node:test");
var assert = require("node:assert");
var attachUserMessage = require("../lib/project-user-message").attachUserMessage;
var continuationLease = require("../lib/driver-continuation-lease");

test("human source work is queued once and cancels the unresolved successor", function () {
  var closed = 0;
  var admitted = [];
  var sent = [];
  var source = { localId: 1, ownerId: null, history: [] };
  var target = { localId: 2, queryInstance: { close: function () { closed++; } } };
  continuationLease.begin(source, target, "proposal");
  var pendingMessageQueue = {
    inspect: function () { return null; },
    admit: function (session, message) { admitted.push({ session: session, message: message }); return { ok: true }; },
    isPaused: function () { return false; },
    getRevision: function () { return 4; },
  };
  var attached = attachUserMessage({
    cwd: process.cwd(), slug: "clay", isMate: false, sm: {}, sdk: {},
    sendTo: function (ws, message) { sent.push(message); }, sendToSession: function () {},
    sendToSessionOthers: function () {}, clients: new Set(), opts: {},
    usersModule: { isMultiUser: function () { return false; } },
    getSessionForWs: function () { return source; }, pendingMessageQueue: pendingMessageQueue,
    isDriverOperatedSession: function () { return false; },
    _loop: { handleLoopMessage: function () { return false; } },
  });
  var handled = attached.handleUserMessage({ _clayUser: null }, {
    type: "message", text: "new source direction", clientMessageId: "message-1",
  });
  assert.strictEqual(handled, true);
  assert.strictEqual(admitted.length, 1);
  assert.strictEqual(admitted[0].session, source);
  assert.strictEqual(admitted[0].message.text, "new source direction");
  assert.strictEqual(closed, 1);
  assert.strictEqual(source.history.length, 0, "queued work must not be recorded or replayed early");
  assert.ok(sent.some(function (message) { return message.type === "message_ack"; }));
  assert.ok(sent.some(function (message) { return message.type === "message_queued"; }));
});
