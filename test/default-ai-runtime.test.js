var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var childProcess = require("node:child_process");
var attachPreferences = require("../lib/users-default-ai-preferences").attachDefaultAiPreferences;
var runtime = require("../lib/default-ai-runtime");

function preferenceHarness(options) {
  options = options || {};
  var data = options.data || { users: [{ id: "u1" }, { id: "u2" }] };
  var config = options.config || {};
  var saves = 0;
  var prefs = attachPreferences({
    loadUsers: function () { return data; },
    saveUsers: function (next) { data = next; saves++; },
    isMultiUser: function () { return options.multiUser === true; },
    configModule: {
      loadConfig: function () { return config; },
      saveConfig: function (next) { config = next; saves++; },
    },
  });
  return { prefs: prefs, data: function () { return data; }, config: function () { return config; }, saves: function () { return saves; } };
}

test("Default AI preferences are isolated and migrate legacy values on read only", function () {
  var h = preferenceHarness({ multiUser: true, data: { users: [{ id: "u1", scheduledTaskInterviewEngine: { vendor: "codex", model: "old", effort: "low" } }, { id: "u2" }] } });
  var first = h.prefs.getDefaultAiPreference("u1");
  assert.deepStrictEqual(first.preference, { vendor: "codex", model: "old", effort: "low" });
  assert.equal(first.source, "legacy");
  assert.equal(h.saves(), 0);
  assert.equal(h.prefs.getDefaultAiPreference("u2").present, false);
});

test("Default AI set rejects malformed text and unknown users", function () {
  var h = preferenceHarness({ multiUser: true });
  assert.match(h.prefs.setDefaultAiPreference("u1", { vendor: "codex", model: "bad\nmodel", effort: "medium" }).error, /model/i);
  assert.match(h.prefs.setDefaultAiPreference("missing", { vendor: "codex", model: "x", effort: "medium" }).error, /User not found/);
  assert.equal(h.saves(), 0);
  var failing = attachPreferences({ loadUsers: function () { return { users: [{ id: "u1", keep: true }] }; }, saveUsers: function () { throw new Error("disk full"); }, isMultiUser: function () { return true; } });
  assert.match(failing.setDefaultAiPreference("u1", { vendor: "codex", model: "gpt", effort: "medium" }).error, /disk full/);
  var original = { id: "u1", keep: true };
  var safe = attachPreferences({ loadUsers: function () { return { users: [original] }; }, saveUsers: function () { throw new Error("read-only"); }, isMultiUser: function () { return true; } });
  safe.setDefaultAiPreference("u1", { vendor: "codex", model: "gpt", effort: "medium" });
  assert.equal(Object.prototype.hasOwnProperty.call(original, "defaultAiPreference"), false);
  var readFailure = attachPreferences({ loadUsers: function () { throw new Error("users unreadable"); }, isMultiUser: function () { return true; } });
  assert.match(readFailure.getDefaultAiPreference("u1").error, /users unreadable/);
});

test("Single-user persistence preserves daemon config and uses explicit presence", function () {
  var h = preferenceHarness({ config: { port: 1, scheduledTaskInterviewEngine: { vendor: "claude", model: "legacy" } } });
  var legacy = h.prefs.getDefaultAiPreference("default");
  assert.equal(legacy.source, "legacy");
  assert.equal(h.prefs.setDefaultAiPreference("default", { vendor: "codex", model: "", effort: "" }).ok, true);
  assert.deepStrictEqual(h.config(), { port: 1, scheduledTaskInterviewEngine: { vendor: "claude", model: "legacy" }, defaultAiPreference: { vendor: "codex", model: "", effort: "" } });
  assert.equal(h.prefs.getDefaultAiPreference("default").source, "explicit");
});

function catalog(vendor, models, defaultModel) {
  return { vendor: vendor, status: "ready", models: models, defaultModel: defaultModel || "" };
}

test("Runtime retains an explicit low-tier model and rejects unavailable choices", async function () {
  var getPreference = function () { return { present: true, source: "explicit", preference: { vendor: "claude", model: "haiku", effort: "low" } }; };
  var result = await runtime.resolveDefaultAiRuntime({ userId: "u1", multiUser: true, getPreference: getPreference, installedVendors: ["claude"], getCatalog: function () { return catalog("claude", ["opus", "haiku"], "opus"); } });
  assert.deepStrictEqual({ vendor: result.vendor, model: result.model, effort: result.effort }, { vendor: "claude", model: "haiku", effort: "low" });
  result = await runtime.resolveDefaultAiRuntime({ userId: "u1", multiUser: true, getPreference: function () { return { present: true, preference: { vendor: "claude", model: "gone", effort: "medium" } }; }, installedVendors: ["claude"], getCatalog: function () { return catalog("claude", ["opus"], "opus"); } });
  assert.equal(result.ready, false);
  assert.match(result.error, /unavailable/);
  result = await runtime.resolveDefaultAiRuntime({ getPreference: function () { return { present: true, preference: { vendor: "codex", model: "gpt-6-astra", effort: "banana" } }; }, installedVendors: ["codex"], getCatalog: function () { return catalog("codex", [{ value: "gpt-6-astra", supportedEffortLevels: ["low", { value: "medium" }] }], "gpt-6-astra"); } });
  assert.equal(result.ready, false);
  assert.match(result.error, /effort/i);
  result = await runtime.resolveDefaultAiRuntime({ getPreference: function () { return { present: true, preference: { vendor: "codex", model: "gpt-6-astra", effort: "low" } }; }, installedVendors: ["codex"], getCatalog: function () { return catalog("codex", [{ value: "gpt-6-astra", supportedEffortLevels: [] }], "gpt-6-astra"); } });
  assert.equal(result.ready, false);
});

test("Runtime requires authenticated identity and does not mutate while resolving", async function () {
  var called = false;
  var result = await runtime.resolveDefaultAiRuntime({ multiUser: true, getPreference: function () { called = true; return { present: false }; }, installedVendors: ["claude"] });
  assert.equal(result.ready, false);
  assert.equal(called, false);
});

test("Runtime ranks only offered known families and uses unknown vendor catalog default", async function () {
  assert.equal(runtime.selectTopModel("claude", catalog("claude", ["sonnet", "opus", "haiku"], "sonnet")), "opus");
  assert.equal(runtime.selectTopModel("codex", catalog("codex", ["gpt-5", "gpt-6-sol", "gpt-6-astra"], "gpt-5")), "gpt-6-astra");
  assert.equal(runtime.selectTopModel("codex", catalog("codex", ["gpt-5", "gpt-6-sol"], "gpt-5")), "gpt-6-sol");
  assert.equal(runtime.selectTopModel("unknown", catalog("unknown", [{ value: "a", resolvedModel: "unknown-a" }, { value: "b" }], "unknown-a")), "a");
  var result = await runtime.resolveDefaultAiRuntime({ getPreference: function () { return { present: false }; }, installedVendors: ["claude"], getCatalog: function () { return catalog("claude", [{ value: "haiku", resolvedModel: "claude-haiku" }, { value: "opus" }], "claude-haiku"); } });
  assert.equal(result.model, "opus");
});

test("Runtime accepts catalog aliases and preserves explicit effort only when supplied", async function () {
  var result = await runtime.resolveDefaultAiRuntime({ getPreference: function () { return { present: true, preference: { vendor: "claude", model: "claude-opus-4", effort: "" } }; }, installedVendors: ["claude"], getCatalog: function () { return catalog("claude", [{ value: "opus", resolvedModel: "claude-opus-4" }], "opus"); } });
  assert.equal(result.model, "opus");
  assert.equal(result.effort, "");
  result = await runtime.resolveDefaultAiRuntime({ getPreference: function () { return { present: true, preference: { vendor: "codex", model: "gpt-6-astra", effort: "" } }; }, installedVendors: ["codex"], getCatalog: function () { return { status: "ready", models: [{ value: "gpt-6-astra", defaultReasoningEffort: "high", supportedEffortLevels: ["medium", "high"] }] }; } });
  assert.equal(result.effort, "", "an explicit Provider default selection remains empty");
  result = await runtime.resolveDefaultAiRuntime({ getPreference: function () { return { present: false }; }, installedVendors: ["codex"], getCatalog: function () { return { status: "ready", models: [{ value: "gpt-6-astra", defaultReasoningEffort: "medium", supportedEffortLevels: ["low", "medium"] }], defaultEffort: "banana" }; } });
  assert.equal(result.effort, "medium");
  result = await runtime.resolveDefaultAiRuntime({ getPreference: function () { return { present: false }; }, installedVendors: ["codex"], getCatalog: function () { return { status: "ready", models: [{ value: "gpt-6-astra", defaultReasoningEffort: "banana", supportedEffortLevels: ["low", "medium"] }], defaultEffort: "medium" }; } });
  assert.equal(result.effort, "medium");
});

test("Default AI disk persistence works under an isolated CLAY_HOME", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-default-ai-"));
  var file = path.join(dir, "users.json");
  var data = { users: [{ id: "u1" }] };
  var h = preferenceHarness({ multiUser: true, data: data });
  assert.equal(h.prefs.setDefaultAiPreference("u1", { vendor: "codex", model: "gpt", effort: "medium" }).ok, true);
  fs.writeFileSync(file, JSON.stringify(h.data()));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")).users[0].defaultAiPreference, { vendor: "codex", model: "gpt", effort: "medium" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Default AI uses the real config module with temporary CLAY_HOME and empty CLAY_DEV", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-default-ai-config-"));
  var script = [
    "var config = require(" + JSON.stringify(path.join(process.cwd(), "lib/config")) + ");",
    "var prefs = require(" + JSON.stringify(path.join(process.cwd(), "lib/users-default-ai-preferences")) + ").attachDefaultAiPreferences({ loadUsers: function () { return { users: [] }; }, saveUsers: function () {}, configModule: config });",
    "prefs.setDefaultAiPreference('default', { vendor: 'codex', model: 'gpt', effort: 'medium' });",
    "if (!config.loadConfig()) process.exit(2);",
  ].join("\n");
  try {
    var result = childProcess.spawnSync(process.execPath, ["-e", script], { env: Object.assign({}, process.env, { CLAY_HOME: dir, CLAY_CONFIG: path.join(dir, "daemon.json"), CLAY_DEV: "" }), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    var saved = JSON.parse(fs.readFileSync(path.join(dir, "daemon.json"), "utf8"));
    assert.equal(saved.port, undefined);
    assert.deepStrictEqual(saved.defaultAiPreference, { vendor: "codex", model: "gpt", effort: "medium" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
