var test = require("node:test");
var assert = require("node:assert");
var attachFilesystem = require("../lib/project-filesystem").attachFilesystem;
var validateEnvString = require("../lib/runtime-env").validateEnvString;
var path = require("path");

function createFilesystem(overrides) {
  overrides = overrides || {};
  return attachFilesystem({
    cwd: process.cwd(),
    slug: "alpha",
    osUsers: null,
    sm: { sessions: new Map() },
    send: function() {},
    sendTo: overrides.sendTo || function() {},
    safePath: overrides.safePath || function() { return null; },
    safeAbsPath: function() { return null; },
    getOsUserInfoForWs: function() { return null; },
    requestAccess: overrides.requestAccess,
    startFileWatch: function() {},
    stopFileWatch: function() {},
    startDirWatch: function() {},
    usersModule: { getEffectivePermissions: function() { return { projectSettings: true }; } },
    fsAsUser: function() {},
    validateEnvString: validateEnvString,
    onEnvironmentChanged: overrides.onEnvironmentChanged || function() {},
    opts: overrides.opts || {},
    IGNORED_DIRS: new Set(),
    BINARY_EXTS: new Set(),
    IMAGE_EXTS: new Set(),
    FS_MAX_SIZE: 4096,
  });
}

test("saved project environment refreshes runtime only after validated persistence", function() {
  var saved = null;
  var refreshes = 0;
  var response = null;
  var filesystem = createFilesystem({
    sendTo: function(ws, msg) { response = msg; },
    onEnvironmentChanged: function() { refreshes++; },
    opts: { onSetProjectEnv: function(slug, envrc) { saved = { slug: slug, envrc: envrc }; return { ok: true }; } },
  });

  filesystem.handleFilesystemMessage({}, { type: "set_project_env", slug: "alpha", envrc: "export PROJECT_TOKEN=value" });
  assert.deepStrictEqual(saved, { slug: "alpha", envrc: "export PROJECT_TOKEN=value" });
  assert.strictEqual(refreshes, 1);
  assert.strictEqual(response.ok, true);
  assert.match(response.timing, /newly created coding-agent processes/);
});

test("filesystem read denial responses retain request and source context", function() {
  var response = null;
  var filesystem = createFilesystem({
    requestAccess: { canUseFiles: function() { return false; }, osIdentity: function() { return null; }, hasPermission: function() { return true; }, isAdmin: function() { return false; }, canAccessProject: function() { return true; } },
    sendTo: function(ws, msg) { response = msg; },
  });
  filesystem.handleFilesystemMessage({}, { type: "fs_read", path: "private.js", requestId: "read-7", projectSlug: "alpha", sessionId: "42", accountId: "user-1" });
  assert.deepStrictEqual(response, {
    type: "fs_read_result", path: "private.js", requestId: "read-7", projectSlug: "alpha", sessionId: "42", accountId: "user-1",
    error: "File browser access is not permitted",
  });
});

test("filesystem reads preserve context for callers that use request correlation", function() {
  var response = null;
  var filesystem = createFilesystem({
    safePath: function(root, requested) { return requested === "package.json" ? path.join(root, requested) : null; },
    sendTo: function(ws, msg) { response = msg; },
  });
  filesystem.handleFilesystemMessage({}, { type: "fs_read", path: "package.json", requestId: "read-8", projectSlug: "alpha", sessionId: "42", accountId: "user-1" });
  assert.equal(response.type, "fs_read_result");
  assert.equal(response.requestId, "read-8");
  assert.equal(response.projectSlug, "alpha");
  assert.equal(response.sessionId, "42");
  assert.equal(response.accountId, "user-1");
  assert.equal(typeof response.content, "string");
});

test("invalid shared environment does not persist or refresh runtime", function() {
  var saves = 0;
  var refreshes = 0;
  var response = null;
  var filesystem = createFilesystem({
    sendTo: function(ws, msg) { response = msg; },
    onEnvironmentChanged: function() { refreshes++; },
    opts: { onSetSharedEnv: function() { saves++; return { ok: true }; } },
  });

  filesystem.handleFilesystemMessage({}, { type: "set_shared_env", envrc: "TOKEN=$(command)" });
  assert.strictEqual(saves, 0);
  assert.strictEqual(refreshes, 0);
  assert.strictEqual(response.ok, false);
  assert.match(response.error, /Unsupported executable syntax/);
});
