var test = require("node:test");
var assert = require("node:assert/strict");
var users = require("../lib/users");
var normalize = require("../lib/yoke/adapters/claude").contractTestKit.normalizeEvent;
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;
var expired = "Failed to authenticate: OAuth session expired and could not be refreshed";

function fixture(t, linuxUser) {
  t.mock.method(users, "isMultiUser", function () { return true; });
  t.mock.method(users, "findUserById", function (id) {
    return id === "member" ? { id: id, role: "member", linuxUser: linuxUser } : null;
  });
  var session = {
    localId: 22, vendor: "claude", ownerId: "member", cliSessionId: "expired-session",
    history: [], messageUUIDs: [], responsePreview: "", pendingPermissions: {},
    pendingElicitations: {}, pendingAskUser: {}, sentToolResults: {},
  };
  var sent = [];
  var notifications = [];
  var processor = attachMessageProcessor({
    sm: {
      sendAndRecord: function (target, msg) { target.history.push(msg); },
      sendToSession: function (target, msg) { sent.push({ target: target.localId, message: msg }); },
      broadcastSessionList: function () {},
    },
    opts: {}, onProcessingChanged: function () {}, onTurnDone: function () {},
    getNotificationsModule: function () {
      return { notify: function (type, data) { notifications.push({ type: type, data: data }); } };
    },
  });
  return {
    session: session, sent: sent, notifications: notifications,
    finish: function (text, cost) {
      session.isProcessing = true;
      session._awaitingTurnResult = true;
      processor.processSDKMessage(session, normalize({ type: "assistant", message: {
        role: "assistant", content: [{ type: "text", text: text }],
      } }));
      processor.processSDKMessage(session, normalize({ type: "result", subtype: "success", total_cost_usd: cost, duration_ms: 100 }));
    },
  };
}

test("expired OAuth response sends transient recovery for the session's Linux user", function (t) {
  var f = fixture(t, "clay_member");
  f.finish(expired, 0);
  var auth = f.sent.filter(function (entry) { return entry.message.type === "auth_required"; });
  assert.equal(auth.length, 1);
  assert.equal(auth[0].target, 22);
  assert.equal(auth[0].message.vendor, "claude");
  assert.equal(auth[0].message.linuxUser, "clay_member");
  assert.equal(auth[0].message.canAutoLogin, true);
  assert.equal(f.session.cliSessionId, null);
  assert.equal(f.session.isProcessing, false);
  assert.equal(f.session.history.some(function (msg) { return msg.type === "auth_required"; }), false);
  var notice = f.notifications.find(function (entry) { return entry.type === "auth_required"; });
  assert.equal(notice.data.ownerId, "member");
  f.finish(expired, 0);
  assert.equal(f.sent.filter(function (entry) { return entry.message.type === "auth_required"; }).length, 1);
});

test("expired OAuth does not grant host login access to an unmapped member", function (t) {
  var f = fixture(t, null);
  f.finish(expired, 0);
  var auth = f.sent.find(function (entry) { return entry.message.type === "auth_required"; });
  assert.equal(auth.message.canAutoLogin, false);
  assert.equal(auth.message.linuxUser, null);
});

test("older not-logged-in responses still request recovery", function (t) {
  var f = fixture(t, "clay_member");
  f.finish("Not logged in · Please run /login", 0);
  assert.equal(f.sent.some(function (entry) { return entry.message.type === "auth_required"; }), true);
});

test("paid responses, explanations and other vendors do not trigger expired-Claude recovery", function (t) {
  var f = fixture(t, "clay_member");
  f.finish(expired, 0.01);
  f.finish("The error says: " + expired, 0);
  f.finish(expired + " — here is how to fix it.", 0);
  f.session.vendor = "codex";
  f.finish(expired, 0);
  assert.equal(f.sent.some(function (entry) { return entry.message.type === "auth_required"; }), false);
});
