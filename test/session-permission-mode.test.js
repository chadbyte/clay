var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var modes = require("../lib/session-permission-mode");
var fullAccess = require("../lib/project-full-access");
var createSessionManager = require("../lib/sessions").createSessionManager;

test("permission selection accepts Ask and Skip for every runtime", function () {
  var session = { permissionCapabilities: { auto: false } };
  assert.deepEqual(modes.validate(session, "default"), { ok: true, mode: "default" });
  assert.deepEqual(modes.validate(session, "bypassPermissions"), { ok: true, mode: "bypassPermissions" });
});

test("literal SDK Auto requires the live capability rather than a model name", function () {
  assert.deepEqual(modes.validate({ vendor: "claude" }, "auto"), { ok: true, mode: "auto" });
  assert.equal(modes.validate({ vendor: "codex", permissionCapabilities: { auto: true } }, "auto").ok, false);
  assert.deepEqual(modes.validate({ vendor: null }, "auto", "claude"), { ok: true, mode: "auto" });
});

test("client state distinguishes requested and effective fallback", function () {
  var state = modes.clientState({ permissionMode: "auto", effectivePermissionMode: "default", permissionCapabilities: { auto: false } });
  assert.equal(state.requestedPermissionMode, "auto");
  assert.equal(state.effectivePermissionMode, "default");
  assert.equal(state.permissionCapabilities.auto, true);
});

test("serialized Skip to Auto commits only after the native transition", async function () {
  var calls = [];
  var session = { localId: 1, permissionMode: "bypassPermissions", permissionModeBeforeFullAccess: "default",
    effectivePermissionMode: "default", queryInstance: { setPermissionMode: function(mode) { calls.push(mode); return Promise.resolve(); } } };
  var service = fullAccess.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function () {}, broadcastSessionList: function () {} } });
  await service.setMode(session, "auto");
  assert.deepEqual(calls, ["auto"]);
  assert.equal(session.permissionMode, "auto");
  assert.equal(session.effectivePermissionMode, null);
});

test("Skip stays Clay-owned while Auto is passed literally to the SDK", async function () {
  var calls = [];
  var session = { localId: 7, permissionMode: "default", queryInstance: {
    setPermissionMode: function(mode) { calls.push(mode); return Promise.resolve(); }
  } };
  var service = fullAccess.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function () {}, broadcastSessionList: function () {} } });
  await service.setMode(session, "bypassPermissions");
  await service.setMode(session, "auto");
  assert.deepEqual(calls, ["default", "auto"]);
});

test("failed Skip to Auto preserves the entire prior snapshot", async function () {
  var session = { localId: 2, permissionMode: "bypassPermissions", permissionModeBeforeFullAccess: "default",
    effectivePermissionMode: "default", queryInstance: { setPermissionMode: function() { return Promise.reject(new Error("ipc rejected")); } } };
  var service = fullAccess.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function () {}, broadcastSessionList: function () {} } });
  await assert.rejects(service.setMode(session, "auto"), /ipc rejected/);
  assert.equal(session.permissionMode, "bypassPermissions");
  assert.equal(session.permissionModeBeforeFullAccess, "default");
  assert.equal(session.effectivePermissionMode, "default");
});

test("observed effective mode during native acknowledgement is preserved", async function () {
  var session = { localId: 3, permissionMode: "default", effectivePermissionMode: "default", queryInstance: {
    setPermissionMode: function() { session.effectivePermissionMode = "auto"; return Promise.resolve(); }
  } };
  var service = fullAccess.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function () {}, broadcastSessionList: function () {} } });
  await service.setMode(session, "auto");
  assert.equal(session.effectivePermissionMode, "auto");
});

test("queued enable then disable restores the mode captured inside serialization", async function () {
  var session = { localId: 4, permissionMode: "plan", queryInstance: { setPermissionMode: function() { return Promise.resolve(); } } };
  var service = fullAccess.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function () {}, broadcastSessionList: function () {} } });
  await Promise.all([service.setEnabled(session, true), service.setEnabled(session, false)]);
  assert.equal(session.permissionMode, "plan");
});

test("restore preserves a null original selection and Skip snapshot metadata", async function () {
  var session = { localId: 5, permissionMode: "default", queryInstance: { setPermissionMode: function() { return Promise.resolve(); } } };
  var service = fullAccess.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function () {}, broadcastSessionList: function () {} } });
  await service.restore(session, { permissionMode: "bypassPermissions", permissionModeBeforeFullAccess: null, effectivePermissionMode: null, permissionModeFallbackReason: null });
  assert.equal(session.permissionMode, "bypassPermissions");
  assert.equal(session.permissionModeBeforeFullAccess, null);
  await service.restore(session, { permissionMode: null, permissionModeBeforeFullAccess: null, effectivePermissionMode: null, permissionModeFallbackReason: null });
  assert.equal(session.permissionMode, null);
});

test("restore preserves runtime status observed before the native acknowledgement", async function () {
  var session = { localId: 8, permissionMode: "bypassPermissions", permissionModeBeforeFullAccess: "default",
    effectivePermissionMode: "default", permissionModeFallbackReason: "stale current status", queryInstance: {
      setPermissionMode: function () {
        assert.equal(session.effectivePermissionMode, null);
        assert.equal(session.permissionModeFallbackReason, null);
        session.effectivePermissionMode = "default";
        session.permissionModeFallbackReason = "SDK reported an Auto fallback";
        return Promise.resolve();
      }
    } };
  var service = fullAccess.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function () {}, broadcastSessionList: function () {} } });
  await service.restore(session, { permissionMode: "auto", permissionModeBeforeFullAccess: null,
    effectivePermissionMode: "auto", permissionModeFallbackReason: "stale saved status" });
  assert.equal(session.permissionMode, "auto");
  assert.equal(session.effectivePermissionMode, "default");
  assert.equal(session.permissionModeFallbackReason, "SDK reported an Auto fallback");
});

test("restore persistence failure marks runtime unknown when native rollback also fails", async function () {
  var calls = [];
  var session = { localId: 9, permissionMode: "default", effectivePermissionMode: "default", queryInstance: {
    setPermissionMode: function (mode) {
      calls.push(mode);
      if (calls.length === 1) {
        session.effectivePermissionMode = "auto";
        return Promise.resolve();
      }
      return Promise.reject(new Error("rollback transport closed"));
    }
  } };
  var service = fullAccess.createFullAccessService({ sm: { currentPermissionMode: "default",
    saveSessionFile: function () { throw new Error("disk full"); }, broadcastSessionList: function () {} } });
  await assert.rejects(service.restore(session, { permissionMode: "auto", permissionModeBeforeFullAccess: null,
    effectivePermissionMode: "auto", permissionModeFallbackReason: null }), /disk full/);
  assert.deepEqual(calls, ["auto", "default"]);
  assert.equal(session.permissionMode, "default");
  assert.equal(session.effectivePermissionMode, null);
  assert.match(session.permissionModeFallbackReason, /Permission rollback failed: rollback transport closed/);
});

test("persistence failure compensates the native mode before reporting failure", async function () {
  var calls = [];
  var session = { localId: 6, permissionMode: "default", queryInstance: { setPermissionMode: function(mode) { calls.push(mode); return Promise.resolve(); } } };
  var service = fullAccess.createFullAccessService({ sm: { currentPermissionMode: "default", saveSessionFile: function() { throw new Error("disk"); }, broadcastSessionList: function () {} } });
  await assert.rejects(service.setMode(session, "auto"), /disk/);
  assert.deepEqual(calls, ["auto", "default"]);
  assert.equal(session.permissionMode, "default");
});

test("daemon restore preserves the selection but forgets runtime-effective state", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-permission-restore-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var options = { cwd: path.join(root, "project"), sessionsBase: path.join(root, "sessions"),
    cliSessionsDir: path.join(root, "cli"), send: function () {} };
  var first = createSessionManager(options);
  var session = first.createSession({ vendor: "claude", permissionMode: "auto" });
  session.cliSessionId = "11111111-1111-4111-8111-111111111111";
  session.effectivePermissionMode = "auto";
  session.mcpPermissionModeOverrides.github = "default";
  first.saveSessionFile(session);

  var second = createSessionManager(options);
  var restored = Array.from(second.sessions.values())[0];
  assert.equal(restored.permissionMode, "auto");
  assert.equal(restored.effectivePermissionMode, null);
  assert.deepEqual(restored.mcpPermissionModeOverrides, { github: "default" });
});
