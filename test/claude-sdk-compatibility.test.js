var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-claude-compat-"));
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, "clay");
process.env.CLAY_CONFIG = path.join(root, "config.json");
process.env.CODEX_HOME = path.join(root, "codex");
process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
var moduleUnderTest = require("../lib/yoke/adapters/claude");
var kit = moduleUnderTest.contractTestKit;
test.after(function() { fs.rmSync(root, { recursive: true, force: true }); });

async function capture(options) {
  var captured;
  var adapter = moduleUnderTest.createClaudeAdapter({ cwd: root, loadSDK: async function() {
    return { query: function(args) {
      captured = args.options;
      return { close: function() {}, [Symbol.asyncIterator]: function() {
        return { next: async function() { return { done: true }; } };
      } };
    } };
  } });
  var handle = await adapter.createQuery(Object.assign({ skipSkills: true }, options));
  handle.close();
  return captured;
}

async function targetSpawn(sdk, options) {
  var spawned;
  var query;
  options.spawnClaudeCodeProcess = function(spawnOptions) {
    spawned = spawnOptions;
    throw new Error("FIXTURE_ENV_SPAWN_BOUNDARY");
  };
  await assert.rejects(async function() {
    try {
      query = sdk.query({ prompt: "No provider request", options: options });
      for await (var event of query) { assert.fail("No process should run"); }
    } finally { if (query) query.close(); }
  }, /FIXTURE_ENV_SPAWN_BOUNDARY/);
  assert.ok(spawned);
  return spawned;
}

test("target SDK native default inherits ambient environment while explicit scoped env excludes it", async function() {
  var sdk = await import("@anthropic-ai/claude-agent-sdk");
  var previous = process.env.CLAY_COMPAT_ENV_SENTINEL;
  process.env.CLAY_COMPAT_ENV_SENTINEL = "daemon-fixture";
  try {
    var inherited = await targetSpawn(sdk, await capture({}));
    assert.equal(inherited.env.CLAY_COMPAT_ENV_SENTINEL, "daemon-fixture");
    assert.equal(inherited.env.HOME, root);
    assert.equal(inherited.env.PATH, process.env.PATH);
    assert.equal(inherited.env.CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME, "1");
    var scoped = { HOME: root, PATH: path.dirname(process.execPath), CLAY_SCOPED_PROVIDER_ENV: "fixture-only", CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME: "0" };
    var explicit = await targetSpawn(sdk, await capture({ env: scoped }));
    assert.equal(explicit.env.CLAY_COMPAT_ENV_SENTINEL, undefined);
    assert.equal(explicit.env.CLAY_SCOPED_PROVIDER_ENV, "fixture-only");
    assert.equal(explicit.env.PATH, scoped.PATH);
    assert.equal(explicit.env.CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME, "1");
    assert.equal(scoped.CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME, "0");
  } finally {
    if (previous === undefined) delete process.env.CLAY_COMPAT_ENV_SENTINEL;
    else process.env.CLAY_COMPAT_ENV_SENTINEL = previous;
  }
});

test("target SDK worker default inherits the worker identity environment, never the daemon default", async function() {
  var sdk = await import("@anthropic-ai/claude-agent-sdk");
  var workerCapture = require("./helpers/claude-worker-environment.cjs").capture;
  var previous = process.env.CLAY_COMPAT_ENV_SENTINEL;
  process.env.CLAY_COMPAT_ENV_SENTINEL = "daemon-fixture";
  var mappedHome = path.join(root, "mapped"); fs.mkdirSync(mappedHome);
  var workerEnv = { HOME: mappedHome, PATH: path.dirname(process.execPath), CLAY_COMPAT_ENV_SENTINEL: "mapped-worker-fixture" };
  try {
    var options = kit.buildWorkerQueryOptions({ skipSkills: true }, {}, root);
    assert.equal(Object.prototype.hasOwnProperty.call(options, "env"), false);
    var inherited = await workerCapture(sdk, options, workerEnv, root);
    assert.equal(inherited.env.CLAY_COMPAT_ENV_SENTINEL, "mapped-worker-fixture");
    assert.equal(inherited.env.HOME, mappedHome);
    assert.equal(inherited.env.PATH, workerEnv.PATH);
    assert.equal(inherited.env.CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME, "1");
    var scoped = { HOME: mappedHome, PATH: workerEnv.PATH, CLAY_SCOPED_PROVIDER_ENV: "mapped-only", CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME: "0" };
    var explicit = await workerCapture(sdk, kit.buildWorkerQueryOptions({ env: scoped, skipSkills: true }, {}, root), workerEnv, root);
    assert.equal(explicit.env.CLAY_COMPAT_ENV_SENTINEL, undefined);
    assert.equal(explicit.env.CLAY_SCOPED_PROVIDER_ENV, "mapped-only");
    assert.equal(explicit.env.HOME, mappedHome);
    assert.equal(explicit.env.CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME, "1");
    assert.equal(scoped.CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME, "0");
  } finally {
    if (previous === undefined) delete process.env.CLAY_COMPAT_ENV_SENTINEL;
    else process.env.CLAY_COMPAT_ENV_SENTINEL = previous;
  }
});

test("both Claude paths disable deferred tool replay without mutating caller environment or widening sandbox access", async function() {
  var env = { FIXTURE: "preserved", CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME: "0" };
  var settings = { sandbox: { enabled: true } };
  var native = await capture({ env: env, resumeSessionId: "fixture-session", adapterOptions: { CLAUDE: { settings: settings, permissionMode: "default" } } });
  var worker = kit.buildWorkerQueryOptions({ env: env, resumeSessionId: "fixture-session" }, { settings: settings, permissionMode: "default" }, root);
  // The daemon sends only the explicitly scoped values. The worker adds the
  // replay flag at its own SDK boundary (covered by the real SDK spawn test).
  assert.deepEqual(worker.env, env);
  assert.deepEqual(native.env, { FIXTURE: "preserved", CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME: "1" });
  [native, worker].forEach(function(options) {
    assert.equal(options.resume, "fixture-session");
    assert.equal(options.permissionMode, "default");
    assert.deepEqual(options.settings.sandbox, { enabled: true });
    assert.equal(options.settings.sandbox.autoAllowBashIfSandboxed, undefined);
    assert.equal(options.allowDangerouslySkipPermissions, undefined);
    assert.doesNotThrow(function() { JSON.stringify(options); });
  });
  assert.equal(env.CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME, "0");
  assert.deepEqual(settings, { sandbox: { enabled: true } });
});

test("target SDK accepts production options and hooks up to a trapped subprocess boundary", async function() {
  var sdk = await import("@anthropic-ai/claude-agent-sdk");
  var options = await capture({ preToolUsePolicy: function() { return null; }, onModelSwitch: function() {},
    adapterOptions: { CLAUDE: { settings: { sandbox: { enabled: true } }, permissionMode: "default" } } });
  assert.ok(Array.isArray(options.hooks.PreToolUse));
  assert.ok(Array.isArray(options.hooks.PreToolUse[0].hooks));
  var spawns = 0;
  options.spawnClaudeCodeProcess = function() { spawns++; throw new Error("FIXTURE_SUBPROCESS_BOUNDARY"); };
  var query;
  await assert.rejects(async function() {
    try {
      query = sdk.query({ prompt: "No provider request", options: options });
      for await (var event of query) { assert.fail("No process should run"); }
    } finally { if (query) query.close(); }
  }, /FIXTURE_SUBPROCESS_BOUNDARY/);
  assert.equal(spawns, 1, "valid options reach the custom spawn, which throws without launching anything");
});

test("target SDK rejects non-array hook matchers and unserializable agents before any subprocess", async function() {
  var sdk = await import("@anthropic-ai/claude-agent-sdk");
  var circular = { prompt: "Fixture" }; circular.self = circular;
  var variants = [{ hooks: { PreToolUse: { hooks: [] } } }, { hooks: { PreToolUse: [{ hooks: new Set() }] } }, { agents: { fixture: circular } }];
  for (var options of variants) {
    var spawns = 0;
    options.spawnClaudeCodeProcess = function() { spawns++; throw new Error("Unexpected spawn"); };
    assert.throws(function() { sdk.query({ prompt: "No provider request", options: options }); }, /can't be sent to Claude Code/);
    assert.equal(spawns, 0);
  }
});
