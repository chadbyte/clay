var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var createSessionManager = require("../lib/sessions").createSessionManager;
var visibility = require("../lib/session-visibility");
var permissions = require("../lib/users-permissions").attachPermissions({
  findUserById: function(id) { return { id: id, role: id === "admin" ? "admin" : "member" }; },
});
var project = { visibility: "public" };

function fixture(t, extra) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-visibility-"));
  t.after(function() { fs.rmSync(root, { recursive: true, force: true }); });
  var options = Object.assign({ cwd: root, sessionsBase: path.join(root, "sessions"), cliSessionsDir: path.join(root, "cli"), send: function() {} }, extra);
  return { manager: function() { return createSessionManager(options); } };
}

test("new GUI and raw sessions are private, including admin-created sessions", function(t) {
  var sm = fixture(t).manager();
  ["createSession", "createSessionRaw"].forEach(function(method) {
    ["alice", "admin"].forEach(function(ownerId) {
      var session = sm[method]({ ownerId: ownerId });
      assert.equal(session.sessionVisibility, "private");
      assert.equal(permissions.canAccessSession(ownerId, session, project), true);
      assert.equal(permissions.canAccessSession("bob", session, project), false);
    });
  });
  assert.equal(sm.mapSessionForClient({ localId: 99 }).sessionVisibility, "private");
});

test("legacy persisted shared defaults become private without losing ownership or history", function(t) {
  var f = fixture(t);
  var sm = f.manager();
  [undefined, "shared", "private"].forEach(function(value, index) {
    var id = "legacy-" + index;
    fs.writeFileSync(path.join(sm.sessionsDir, id + ".jsonl"), [
      JSON.stringify({ type: "meta", localId: index + 1, cliSessionId: id, ownerId: "alice", sessionVisibility: value, title: "Legacy" }),
      JSON.stringify({ type: "user_message", text: "Preserved history" }),
    ].join("\n") + "\n");
  });
  var restored = f.manager();
  assert.equal(restored.sessions.size, 3);
  restored.sessions.forEach(function(session) {
    assert.equal(session.sessionVisibility, "private");
    assert.equal(session.ownerId, "alice");
    assert.equal(session.history[0].text, "Preserved history");
    assert.equal(permissions.canAccessSession("bob", session, project), false);
    assert.equal(permissions.canAccessSession("alice", session, project), true);
  });
});

test("explicit sharing and returning to private survive restarts", function(t) {
  var f = fixture(t);
  var sm = f.manager();
  var session = sm.createSessionRaw({ ownerId: "alice" });
  session.cliSessionId = "explicit-share";
  sm.setSessionVisibility(session.localId, "shared");
  var restored = f.manager();
  var shared = Array.from(restored.sessions.values())[0];
  assert.equal(shared.sessionVisibility, "shared");
  assert.equal(permissions.canAccessSession("bob", shared, project), true);
  restored.setSessionVisibility(shared.localId, "private");
  assert.equal(Array.from(f.manager().sessions.values())[0].sessionVisibility, "private");
});

test("admins can access private history while members remain isolated", function() {
  assert.equal(permissions.canAccessSession("admin", { ownerId: "alice", sessionVisibility: "private" }, project), true);
  assert.equal(permissions.canAccessSession("admin", { ownerId: "alice" }, project), true);
  assert.equal(permissions.canAccessSession("bob", { ownerId: "alice" }, project), false);
  assert.equal(permissions.canAccessSession("bob", { ownerId: "alice", sessionVisibility: "private" }, project), false);
  assert.equal(permissions.canAccessSession("alice", { ownerId: "alice", sessionVisibility: "private" }, project), true);
  assert.equal(permissions.canAccessSession("admin", {}, project), true);
  assert.equal(permissions.canAccessSession("bob", {}, project), false);
  assert.equal(permissions.canAccessSession("bob", { sessionVisibility: "shared" }, project), false);
});

test("only the owner can share; privatizing retains admins and revokes members", function() {
  var session = { localId: 1, ownerId: "alice", sessionVisibility: "private" };
  var changes = [];
  var closed = [];
  var owner = { _clayUser: { id: "alice" }, _clayActiveSession: 1, readyState: 1, close: function() { closed.push("alice"); } };
  var admin = { _clayUser: { id: "admin" }, _clayActiveSession: 1, readyState: 1, close: function() { closed.push("admin"); } };
  var member = { _clayUser: { id: "bob" }, _clayActiveSession: 1, readyState: 1, close: function() { closed.push("bob"); } };
  var forgedAdmin = { _clayUser: { id: "mallory", role: "admin" }, _clayActiveSession: 1, readyState: 1, close: function() { closed.push("mallory"); } };
  var ctx = {
    sm: {
      sessions: new Map([[1, session]]),
      setSessionVisibility: function(id, value) { changes.push(value); session.sessionVisibility = value; },
    },
    usersModule: Object.assign({ isMultiUser: function() { return true; } }, permissions),
    getProjectAccess: function() { return project; },
    clients: new Set([owner, admin, member, forgedAdmin]),
  };
  ["bob", "admin"].forEach(function(id) {
    visibility.handleChange(ctx, { _clayUser: { id: id } }, { sessionId: 1, visibility: "shared" });
  });
  assert.deepEqual(changes, []);
  visibility.handleChange(ctx, { _clayUser: { id: "alice" } }, { sessionId: 1, visibility: "shared" });
  assert.deepEqual(changes, ["shared"]);
  visibility.handleChange(ctx, { _clayUser: { id: "alice" } }, { sessionId: 1, visibility: "private" });
  assert.deepEqual(changes, ["shared", "private"]);
  assert.deepEqual(closed, ["bob", "mallory"]);
  assert.equal(owner._clayActiveSession, 1);
  assert.equal(admin._clayActiveSession, 1);
  assert.equal(member._clayActiveSession, null);
  assert.equal(forgedAdmin._clayActiveSession, null);
});

test("private sessions do not broadcast content or activity to other project members", function(t) {
  var received = [];
  var ws = { _clayActiveSession: 1, readyState: 1, send: function(data) { received.push(JSON.parse(data)); } };
  var sm = fixture(t, { sendEach: function(fn) {
    fn(ws, function(session) { return permissions.canAccessSession("bob", session, project); });
  } }).manager();
  var session = sm.createSessionRaw({ ownerId: "alice" });
  received.length = 0;
  session.isProcessing = true;
  sm.sendToSession(session, { type: "text_delta", text: "secret" });
  sm.sendAndRecord(session, { type: "assistant", text: "secret" });
  assert.deepEqual(received, []);
});
