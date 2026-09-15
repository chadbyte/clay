var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var delivery = require("../lib/project-message-delivery");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("server acknowledges a recorded message and deduplicates its replay", function () {
  var sent = [];
  var api = delivery.createProjectMessageDelivery(function (ws, msg) {
    sent.push({ ws: ws, msg: msg });
  }, "project-a");
  var ws = { _clayUser: { id: "user-1" } };
  var session = { history: [] };
  var receipt = api.inspect(ws, session, { clientMessageId: "cm-first" });
  assert.equal(receipt.duplicate, false);

  var recorded = { type: "user_message", text: "hello", from: "user-1", clientMessageId: "cm-first" };
  session.history.push(recorded);
  api.markRecorded(session, receipt, recorded);
  api.acknowledge(ws, receipt, recorded, { localId: 12 });
  assert.deepEqual(sent[0].msg, {
    type: "message_ack",
    clientMessageId: "cm-first",
    projectSlug: "project-a",
    sessionId: 12,
    message: recorded,
  });

  var replay = api.inspect(ws, session, { clientMessageId: "cm-first" });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.recordedMessage, recorded);
});

test("persisted delivery identifiers survive a server restart", function () {
  var recorded = { type: "user_message", text: "hello", from: "user-1", clientMessageId: "cm-persisted" };
  var restored = { history: [recorded] };
  var api = delivery.createProjectMessageDelivery(function () {});
  var sameUser = api.inspect({ _clayUser: { id: "user-1" } }, restored, { clientMessageId: "cm-persisted" });
  var otherUser = api.inspect({ _clayUser: { id: "user-2" } }, restored, { clientMessageId: "cm-persisted" });
  assert.equal(sameUser.duplicate, true);
  assert.equal(otherUser.duplicate, false, "one user's identifier cannot suppress another user's message");
});

test("invalid delivery identifiers are ignored", function () {
  assert.equal(delivery.normalizeClientMessageId(""), null);
  assert.equal(delivery.normalizeClientMessageId("contains spaces"), null);
  assert.equal(delivery.normalizeClientMessageId("x".repeat(129)), null);
  assert.equal(delivery.normalizeClientMessageId("cm-valid_1.2:3"), "cm-valid_1.2:3");
});

test("client retains sends until acknowledgement and replays only into the same project session", function () {
  var client = source("lib/public/modules/message-delivery.js");
  var input = source("lib/public/modules/input.js");
  var messages = source("lib/public/modules/app-messages.js");
  assert.match(client, /pendingOutboundMessages/);
  assert.match(client, /clay-message-delivery-timeout/);
  assert.match(client, /pending\[i\]\.projectSlug === projectSlug && pending\[i\]\.sessionId === sessionId/);
  assert.match(input, /sendAcknowledgedMessage\(payload\)/);
  assert.match(messages, /case "message_ack":[\s\S]*acknowledgeMessage\(msg\.clientMessageId\)/);
  assert.match(messages, /case "session_switched":[\s\S]*replayPendingMessages\(msg\.id\)/);
});

test("Claude optimistic activity replaces an older placeholder", function () {
  var rendering = source("lib/public/modules/app-rendering.js");
  var start = rendering.indexOf("export function showClaudePreThinking()");
  var end = rendering.indexOf("export function showMatePreThinking()", start);
  var body = rendering.slice(start, end);
  assert.ok(body.indexOf("removeMatePreThinking();") < body.indexOf("doShowMatePreThinking("));
});
