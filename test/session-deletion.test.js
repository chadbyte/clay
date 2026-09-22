var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var createSessionManager = require("../lib/sessions").createSessionManager;

test("a deleted Claude CLI session is not adopted again after restart", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-session-delete-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var sessionsBase = path.join(root, "sessions");
  var cliSessionsDir = path.join(root, "claude-sessions");
  fs.mkdirSync(cliSessionsDir, { recursive: true });
  var cliSessionId = "11111111-2222-4333-8444-555555555555";
  var transcriptPath = path.join(cliSessionsDir, cliSessionId + ".jsonl");
  var transcript = [
    { type: "user", timestamp: "2026-08-16T00:00:00.000Z", message: { role: "user", content: "keep the source transcript" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
  ];
  fs.writeFileSync(transcriptPath, transcript.map(JSON.stringify).join("\n") + "\n");

  function manager() {
    return createSessionManager({
      cwd: path.join(root, "project"),
      sessionsBase: sessionsBase,
      cliSessionsDir: cliSessionsDir,
      send: function () {},
    });
  }

  var first = manager();
  assert.strictEqual(first.sessions.size, 1);
  var adopted = Array.from(first.sessions.values())[0];
  assert.strictEqual(adopted.adopted, true);
  first.deleteSession(adopted.localId);
  assert.strictEqual(fs.existsSync(transcriptPath), true);

  var second = manager();
  var resumedIds = Array.from(second.sessions.values()).map(function (session) { return session.cliSessionId; });
  assert.strictEqual(resumedIds.indexOf(cliSessionId), -1);
});

test("an adopted warmup row from an older version is removed on startup", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-warmup-sweep-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var sessionsBase = path.join(root, "sessions");
  var cliSessionsDir = path.join(root, "claude-sessions");
  var cwd = path.join(root, "project");
  var encoded = require("../lib/utils").encodeCwd(cwd);
  var sessionsDir = path.join(sessionsBase, encoded);
  var cliSessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(cliSessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, cliSessionId + ".jsonl"), JSON.stringify({
    type: "meta",
    localId: 9,
    cliSessionId: cliSessionId,
    title: "hi",
    createdAt: Date.now() - 60000,
    vendor: "claude",
    mode: "tui",
    adopted: true,
  }) + "\n");
  var warmup = [
    { type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
    { type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
  ];
  fs.writeFileSync(path.join(cliSessionsDir, cliSessionId + ".jsonl"), warmup.map(JSON.stringify).join("\n") + "\n");

  var manager = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var ids = Array.from(manager.sessions.values()).map(function (session) { return session.cliSessionId; });
  assert.strictEqual(ids.indexOf(cliSessionId), -1);
});

test("an empty adopted row is removed after daemon cleanup deleted its source", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-missing-adopted-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var cwd = path.join(root, "project");
  var sessionsBase = path.join(root, "sessions");
  var sessionsDir = path.join(sessionsBase, require("../lib/utils").encodeCwd(cwd));
  var cliSessionsDir = path.join(root, "claude-sessions");
  var cliSessionId = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(cliSessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, cliSessionId + ".jsonl"), JSON.stringify({
    type: "meta",
    localId: 4,
    cliSessionId: cliSessionId,
    title: "hi",
    createdAt: Date.now() - 60000,
    vendor: "claude",
    mode: "tui",
    adopted: true,
  }) + "\n");

  var manager = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var ids = Array.from(manager.sessions.values()).map(function (session) { return session.cliSessionId; });
  assert.strictEqual(ids.indexOf(cliSessionId), -1);
});

test("a session model survives a manager restart", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-session-model-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var sessionsBase = path.join(root, "sessions");
  var cliSessionsDir = path.join(root, "claude-sessions");
  var cwd = path.join(root, "project");
  var first = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var session = first.createSessionRaw({
    cliSessionId: "99999999-8888-4777-8666-555555555555",
    vendor: "codex",
    model: "gpt-5.6-sol",
  });
  first.saveSessionFile(session);

  var second = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var restored = Array.from(second.sessions.values())[0];
  assert.strictEqual(restored.model, "gpt-5.6-sol");
});

test("a session effort survives a manager restart", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-session-effort-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var sessionsBase = path.join(root, "sessions");
  var cliSessionsDir = path.join(root, "claude-sessions");
  var cwd = path.join(root, "project");
  var first = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var session = first.createSessionRaw({
    cliSessionId: "77777777-6666-4555-8444-333333333333",
    vendor: "codex",
    model: "gpt-5.6-sol",
    effort: "xhigh",
  });
  first.saveSessionFile(session);

  var second = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var restored = Array.from(second.sessions.values())[0];
  assert.strictEqual(restored.effort, "xhigh");
  assert.strictEqual(second.mapSessionForClient(restored).effort, "xhigh");
});

test("session switching emits each session's own effort", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-session-effort-switch-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var messages = [];
  var manager = createSessionManager({
    cwd: path.join(root, "project"),
    sessionsBase: path.join(root, "sessions"),
    cliSessionsDir: path.join(root, "claude-sessions"),
    send: function (message) { messages.push(message); },
  });
  var claude = manager.createSessionRaw({ vendor: "claude", effort: "max" });
  var codex = manager.createSessionRaw({ vendor: "codex", effort: "minimal" });
  manager.switchSession(claude.localId);
  manager.switchSession(codex.localId);
  var switched = messages.filter(function (message) {
    return message.type === "session_switched" && (message.id === claude.localId || message.id === codex.localId);
  });
  assert.deepStrictEqual(switched.map(function (message) { return message.effort; }), ["max", "minimal"]);
});

test("a session permission mode survives a manager restart", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-session-permission-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var sessionsBase = path.join(root, "sessions");
  var cliSessionsDir = path.join(root, "claude-sessions");
  var cwd = path.join(root, "project");
  var first = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var session = first.createSessionRaw({
    cliSessionId: "12121212-3434-4567-8787-909090909090",
    vendor: "claude",
    permissionMode: "bypassPermissions",
  });
  session.permissionModeBeforeFullAccess = "acceptEdits";
  first.saveSessionFile(session);

  var second = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var restored = Array.from(second.sessions.values())[0];
  assert.strictEqual(restored.permissionMode, "bypassPermissions");
  assert.strictEqual(restored.permissionModeBeforeFullAccess, "acceptEdits");
  assert.strictEqual(second.mapSessionForClient(restored).permissionMode, "bypassPermissions");
});

test("Driver continuation relations and decline cooldown survive a manager restart", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-driver-continuation-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var settings = {
    cwd: path.join(root, "project"),
    sessionsBase: path.join(root, "sessions"),
    cliSessionsDir: path.join(root, "claude-sessions"),
    send: function () {},
  };
  var first = createSessionManager(settings);
  var session = first.createSessionRaw({ cliSessionId: "23232323-4545-4678-8989-010101010101", vendor: "codex" });
  session.driverContinuation = { proposalId: "proposal", sourceOriginId: "source-origin", status: "accepted" };
  session.driverContinuationDecline = { proposalId: "declined", contextKey: "context" };
  assert.strictEqual(first.saveSessionFile(session), true);

  var second = createSessionManager(settings);
  var restored = Array.from(second.sessions.values())[0];
  assert.deepStrictEqual(restored.driverContinuation, session.driverContinuation);
  assert.deepStrictEqual(restored.driverContinuationDecline, session.driverContinuationDecline);
});

test("a GUI session permission mode survives a manager restart without a CLI bypass flag", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-session-permission-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var sessionsBase = path.join(root, "sessions");
  var cliSessionsDir = path.join(root, "claude-sessions");
  var cwd = path.join(root, "project");
  var first = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var session = first.createSessionRaw({
    cliSessionId: "88888888-7777-4666-8555-444444444444",
    vendor: "claude",
    mode: "gui",
    permissionMode: "bypassPermissions",
  });
  first.saveSessionFile(session);

  var second = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: cliSessionsDir,
    send: function () {},
  });
  var restored = Array.from(second.sessions.values())[0];
  assert.strictEqual(restored.permissionMode, "bypassPermissions");
  assert.strictEqual(restored.dangerouslySkipPermissions, false);
});

test("a legacy GUI bypass flag migrates to Clay-managed permission mode", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-legacy-gui-permission-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var cwd = path.join(root, "project");
  var sessionsBase = path.join(root, "sessions");
  var sessionsDir = path.join(sessionsBase, require("../lib/utils").encodeCwd(cwd));
  var cliSessionId = "66666666-5555-4444-8333-222222222222";
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, cliSessionId + ".jsonl"), JSON.stringify({
    type: "meta",
    cliSessionId: cliSessionId,
    vendor: "claude",
    mode: "gui",
    dangerouslySkipPermissions: true,
    createdAt: Date.now() - 60000,
  }) + "\n");

  var manager = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: path.join(root, "claude-sessions"),
    send: function () {},
  });
  var restored = Array.from(manager.sessions.values())[0];
  assert.strictEqual(restored.permissionMode, "bypassPermissions");
  assert.strictEqual(restored.dangerouslySkipPermissions, false);
});

test("a legacy session recovers its model from saved result usage", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-legacy-model-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  var cwd = path.join(root, "project");
  var sessionsBase = path.join(root, "sessions");
  var sessionsDir = path.join(sessionsBase, require("../lib/utils").encodeCwd(cwd));
  var cliSessionId = "77777777-6666-4555-8444-333333333333";
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, cliSessionId + ".jsonl"), [
    JSON.stringify({ type: "meta", cliSessionId: cliSessionId, vendor: "codex", createdAt: Date.now() - 60000 }),
    JSON.stringify({ type: "result", modelUsage: { "gpt-5.6-sol": { contextWindow: 272000 } } }),
  ].join("\n") + "\n");

  var manager = createSessionManager({
    cwd: cwd,
    sessionsBase: sessionsBase,
    cliSessionsDir: path.join(root, "claude-sessions"),
    send: function () {},
  });
  var restored = Array.from(manager.sessions.values())[0];
  assert.strictEqual(restored.model, "gpt-5.6-sol");
});
