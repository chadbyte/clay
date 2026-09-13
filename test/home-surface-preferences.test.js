var test = require("node:test");
var assert = require("node:assert/strict");
var childProcess = require("node:child_process");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attachHomeSurfacePreferences = require("../lib/users-home-surface-preferences").attachHomeSurfacePreferences;
var attachHomePreferences = require("../lib/server-home-preferences").attachHomePreferences;

function harness() {
  var data = { users: [{ id: "u1" }, { id: "u2" }] };
  var saves = 0;
  var preferences = attachHomeSurfacePreferences({
    loadUsers: function () { return data; },
    saveUsers: function (next) { data = next; saves++; },
  });
  return { preferences: preferences, getSaves: function () { return saves; } };
}

test("Home surface preferences default to no durable conversation selection", function () {
  var fixture = harness();
  assert.deepStrictEqual(fixture.preferences.getHomeSurfacePreference("u1"), {
    surface: null,
    projectSlug: null,
    activeMateId: null,
    activeSessionByMate: {},
    sidebarCollapsed: false,
    matesCollapsed: false,
    chatScope: "all",
    subSurface: "chat",
  });
});

test("Home surface preferences preserve exact sessions per Mate across partial updates", function () {
  var fixture = harness();
  fixture.preferences.setHomeSurfacePreference("u1", {
    surface: "home",
    projectSlug: "project-a",
    activeMateId: "mate-a",
    activeSessionByMate: { "mate-a": "session-a" },
    matesCollapsed: true,
    chatScope: "current",
    subSurface: "debates",
  });
  var result = fixture.preferences.setHomeSurfacePreference("u1", {
    activeMateId: "mate-b",
    activeSessionByMate: { "mate-b": "session-b" },
    sidebarCollapsed: true,
  });
  assert.deepStrictEqual(result.preference, {
    surface: "home",
    projectSlug: "project-a",
    activeMateId: "mate-b",
    activeSessionByMate: { "mate-a": "session-a", "mate-b": "session-b" },
    sidebarCollapsed: true,
    matesCollapsed: true,
    chatScope: "current",
    subSurface: "debates",
  });
  assert.deepStrictEqual(fixture.preferences.getHomeSurfacePreference("u2").activeSessionByMate, {});
  assert.strictEqual(fixture.preferences.getHomeSurfacePreference("u1").matesCollapsed, true);
  assert.strictEqual(fixture.preferences.getHomeSurfacePreference("u2").matesCollapsed, false);
  assert.strictEqual(fixture.preferences.getHomeSurfacePreference("u2").chatScope, "all");
  assert.strictEqual(fixture.preferences.getHomeSurfacePreference("u2").subSurface, "chat");
  assert.strictEqual(fixture.getSaves(), 2);
});

test("Home surface preferences discard malformed identifiers and session references", function () {
  var fixture = harness();
  var result = fixture.preferences.setHomeSurfacePreference("u1", {
    surface: "elsewhere",
    projectSlug: "../project",
    activeMateId: "../mate",
    activeSessionByMate: { "mate-a": "valid-session", "../mate": "bad", "mate-b": "\n" },
    sidebarCollapsed: "yes",
    chatScope: "nearby",
    subSurface: "elsewhere",
  });
  assert.deepStrictEqual(result.preference, {
    surface: null,
    projectSlug: null,
    activeMateId: null,
    activeSessionByMate: { "mate-a": "valid-session" },
    sidebarCollapsed: false,
    matesCollapsed: false,
    chatScope: "all",
    subSurface: "chat",
  });
});

test("Home surface WebSocket requests roundtrip only to the requesting client", function () {
  var fixture = harness();
  var messages = [];
  var ws = { _clayUser: { id: "u1" }, send: function (value) { messages.push(JSON.parse(value)); } };
  var handler = attachHomePreferences({
    users: {
      isMultiUser: function () { return true; },
      getHomeSurfacePreference: fixture.preferences.getHomeSurfacePreference,
      setHomeSurfacePreference: fixture.preferences.setHomeSurfacePreference,
    },
    projects: new Map(),
  });
  assert.strictEqual(handler.handleMessage(ws, {
    type: "home_surface_set",
    preference: { surface: "home", projectSlug: "project-a", activeMateId: "mate-a", activeSessionByMate: { "mate-a": "session-a" }, matesCollapsed: true, chatScope: "current", subSurface: "debates" },
  }), true);
  assert.deepStrictEqual(messages[0].preference.activeSessionByMate, { "mate-a": "session-a" });
  assert.strictEqual(messages[0].preference.surface, "home");
  assert.strictEqual(messages[0].preference.projectSlug, "project-a");
  assert.strictEqual(messages[0].preference.chatScope, "current");
  assert.strictEqual(messages[0].preference.subSurface, "debates");
  assert.strictEqual(messages[0].preference.matesCollapsed, true);
  messages.length = 0;
  handler.handleMessage(ws, { type: "home_surface_get" });
  assert.strictEqual(messages[0].preference.activeMateId, "mate-a");
  assert.strictEqual(messages[0].preference.chatScope, "current");
  assert.strictEqual(messages[0].preference.subSurface, "debates");
  assert.strictEqual(messages[0].preference.matesCollapsed, true);
});

test("single-user Home preference persists and restores Mate collapse without dropping other fields", function () {
  var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-home-pref-"));
  var configPath = path.join(tempDir, "daemon.json");
  var script = [
    "var prefs = require(" + JSON.stringify(path.join(process.cwd(), "lib/users-home-surface-preferences")) + ").attachHomeSurfacePreferences({ loadUsers: function () { return { users: [] }; }, saveUsers: function () {} });",
    "var first = prefs.setHomeSurfacePreference('default', { surface: 'home', chatScope: 'current', matesCollapsed: true });",
    "var second = prefs.setHomeSurfacePreference('default', { activeMateId: 'mate-a' });",
    "process.stdout.write(JSON.stringify({ first: first.preference, second: second.preference, restored: prefs.getHomeSurfacePreference('default') }));",
  ].join("\n");
  try {
    var result = childProcess.spawnSync(process.execPath, ["-e", script], {
      env: Object.assign({}, process.env, { CLAY_HOME: tempDir, CLAY_CONFIG: configPath, CLAY_DEV: "" }),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    var output = JSON.parse(result.stdout);
    assert.strictEqual(output.first.matesCollapsed, true);
    assert.strictEqual(output.second.matesCollapsed, true);
    assert.strictEqual(output.restored.matesCollapsed, true);
    assert.strictEqual(output.restored.chatScope, "current");
    assert.strictEqual(output.restored.activeMateId, "mate-a");
    var savedConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(savedConfig.homeSurfacePreference.matesCollapsed, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
