var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

var { createCodexAdapter } = require("../lib/yoke/adapters/codex");

function createFakeServer(options) {
  return {
    options: options,
    started: false,
    proc: null,
    start: function () { this.started = true; return Promise.resolve(); },
    send: function (method) {
      if (method === "skills/list") return Promise.resolve({ data: [] });
      return Promise.resolve({});
    },
    notify: function () {},
    stop: function () { this.started = false; },
  };
}

// Initializes an adapter against a fake app-server and returns the config the
// adapter would have handed to the real spawn.
async function spawnedConfig(initOpts) {
  var spawned = [];
  var adapter = createCodexAdapter({
    cwd: process.cwd(),
    createAppServer: function (options) {
      var server = createFakeServer(options);
      spawned.push(server);
      return server;
    },
  });
  await adapter.init(initOpts || {});
  assert.strictEqual(spawned.length, 1, "exactly one app-server is spawned");
  return spawned[0].options.config || {};
}

test("the spawned app-server asks for detailed reasoning summaries", async function () {
  var config = await spawnedConfig({});
  assert.strictEqual(config.model_reasoning_summary, "detailed");
  assert.strictEqual(config.model_supports_reasoning_summaries, undefined);
});

test("without a runtime default flag, Codex falls back to its bundled default GPT-6.1 Sol", async function () {
  var adapter = createCodexAdapter({
    cwd: process.cwd(),
    createAppServer: function (options) { return createFakeServer(options); },
  });
  var models = await adapter.supportedModels();
  var ready = await adapter.init({});
  assert.strictEqual(models[0], "gpt-6.1-sol");
  assert.strictEqual(ready.defaultModel, "gpt-6.1-sol");
});

test("raw agent reasoning is left to the user and never forced on", async function () {
  var config = await spawnedConfig({});
  assert.ok(
    !Object.prototype.hasOwnProperty.call(config, "show_raw_agent_reasoning"),
    "show_raw_agent_reasoning must stay a user opt-in: it is encrypted on ChatGPT-auth models"
  );
});

test("user-supplied Codex config overrides the reasoning defaults", async function () {
  var config = await spawnedConfig({
    adapterOptions: { CODEX: { config: { model_reasoning_summary: "none" } } },
  });
  assert.strictEqual(config.model_reasoning_summary, "none", "the user's choice wins");
  assert.strictEqual(
    config.model_supports_reasoning_summaries, undefined,
    "obsolete settings are not injected"
  );
});

test("a user can turn summary forcing off entirely", async function () {
  var config = await spawnedConfig({
    adapterOptions: {
      CODEX: { config: { model_reasoning_summary: "concise", model_supports_reasoning_summaries: false } },
    },
  });
  assert.strictEqual(config.model_reasoning_summary, "concise");
  assert.strictEqual(config.model_supports_reasoning_summaries, false);
});

test("user config can enable raw reasoning explicitly", async function () {
  var config = await spawnedConfig({
    adapterOptions: { CODEX: { config: { show_raw_agent_reasoning: true } } },
  });
  assert.strictEqual(config.show_raw_agent_reasoning, true);
  assert.strictEqual(config.model_reasoning_summary, "detailed", "defaults still apply alongside");
});

test("unrelated user config keys are carried through with the defaults", async function () {
  var config = await spawnedConfig({
    adapterOptions: { CODEX: { config: { model_verbosity: "low" } } },
  });
  assert.strictEqual(config.model_verbosity, "low");
  assert.strictEqual(config.model_reasoning_summary, "detailed");
  assert.strictEqual(config.model_supports_reasoning_summaries, undefined);
});

test("reasoning defaults survive the MCP server config merge", async function () {
  // MCP servers are merged into the same config object after the defaults are
  // applied, so a regression there would silently drop the reasoning keys.
  var config = await spawnedConfig({});
  assert.strictEqual(config.model_reasoning_summary, "detailed");
  if (config.mcp_servers) {
    assert.strictEqual(typeof config.mcp_servers, "object", "mcp_servers coexists with reasoning keys");
  }
});

test("the reasoning defaults serialize to valid TOML --config flags", function () {
  // serializeConfig is module-private; evaluate it from source so the test
  // asserts the exact flags the app-server receives on argv.
  var source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "yoke", "codex-app-server.js"),
    "utf8"
  );
  var start = source.indexOf("function serializeConfig");
  var end = source.indexOf("// --- CodexAppServer ---");
  assert.ok(start !== -1 && end > start, "serializeConfig and toTomlValue must be present");
  var helpers = new Function(
    source.slice(start, end) + "\nreturn { serializeConfig: serializeConfig };"
  )();

  var args = helpers.serializeConfig({
    model_reasoning_summary: "detailed",
  }, "");
  assert.deepStrictEqual(args, [
    'model_reasoning_summary="detailed"',
  ]);
});

test("the adapter still maps every reasoning event to thinking", function () {
  // The config change is only useful because these mappings already exist;
  // pin them so a rename on either side cannot silently blank out thinking.
  var kit = require("../lib/yoke/adapters/codex").contractTestKit;
  var state = kit.createEventState("gpt-5.6-terra");
  state.threadId = "t1";
  // The first summary delta opens a thinking block and streams its text.
  var summaryDelta = kit.normalizeEvent({
    method: "item/reasoning/summaryTextDelta",
    params: { threadId: "t1", itemId: "i1", delta: "Weighing options" },
  }, state);
  assert.deepStrictEqual(summaryDelta, [
    { yokeType: "thinking_start", blockId: "blk_1" },
    { yokeType: "thinking_delta", blockId: "blk_1", text: "Weighing options" },
  ]);

  // Later deltas append to the block that is already open.
  var more = kit.normalizeEvent({
    method: "item/reasoning/summaryTextDelta",
    params: { threadId: "t1", itemId: "i1", delta: " carefully" },
  }, state);
  assert.deepStrictEqual(more, [
    { yokeType: "thinking_delta", blockId: "blk_1", text: " carefully" },
  ]);

  // summaryPartAdded separates sections within the same block.
  var partAdded = kit.normalizeEvent({
    method: "item/reasoning/summaryPartAdded",
    params: { threadId: "t1", itemId: "i1" },
  }, state);
  assert.deepStrictEqual(partAdded, [
    { yokeType: "thinking_delta", blockId: "blk_1", text: "\n\n" },
  ]);

  // Raw reasoning text (only present when the user opts into
  // show_raw_agent_reasoning) streams into the same thinking channel.
  var textDelta = kit.normalizeEvent({
    method: "item/reasoning/textDelta",
    params: { threadId: "t1", itemId: "i2", delta: "raw" },
  }, state);
  assert.deepStrictEqual(textDelta, [
    { yokeType: "thinking_start", blockId: "blk_2" },
    { yokeType: "thinking_delta", blockId: "blk_2", text: "raw" },
  ]);
});
