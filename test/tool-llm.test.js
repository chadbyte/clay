var test = require("node:test");
var assert = require("node:assert");
var toolLlm = require("../lib/tool-llm");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var managedAllow = require("../lib/claude-hook-installer").CLAY_MANAGED_ALLOW;

function queryHandle(events, capture) {
  return {
    pushMessage: function (prompt) { capture.prompt = prompt; return true; },
    setModel: function () {}, setEffort: function () {}, setToolPolicy: function () {},
    stopTask: function () {}, getContextUsage: function () { return Promise.resolve(null); },
    endInput: function () { capture.inputEnded = true; }, abort: function () {}, close: function () { capture.closed = true; },
    [Symbol.asyncIterator]: async function* () {
      for (var i = 0; i < events.length; i++) yield events[i];
    },
  };
}

test("LLM arguments retain capability aliases and reject vendor model names", function () {
  assert.strictEqual(toolLlm.validateArgs({ prompt: "hello", model: "fast" }).model, "fast");
  assert.throws(function () { toolLlm.validateArgs({ prompt: "hello", model: "claude-opus-4" }); }, /capability alias/);
});

test("LLM completion uses a sessionless one-shot adapter query", async function () {
  var capture = {};
  var adapter = {
    vendor: "claude",
    createQuery: function () { throw new Error("generic query must not run"); },
    createOneShotQuery: function (opts) {
      capture.opts = opts;
      return Promise.resolve({
        handle: queryHandle([{ yokeType: "text_delta", text: "안녕" }, { yokeType: "result" }], capture),
        backendPersistence: "ephemeral",
      });
    },
  };
  var text = await toolLlm.complete({
    adapters: { claude: adapter },
    cwd: "/tmp",
    args: { prompt: "hello", model: "fast" },
    selection: { vendor: "claude", model: "claude-haiku-4-5", effort: "high" },
  });
  assert.strictEqual(text, "안녕");
  assert.strictEqual(capture.opts.model, "claude-haiku-4-5");
  assert.strictEqual(capture.opts.effort, "high");
  assert.strictEqual(capture.opts.skipProjectInstructions, true);
  assert.strictEqual(capture.opts.skipSkills, true);
  assert.strictEqual((await capture.opts.canUseTool("Read", {})).behavior, "deny");
  assert.strictEqual(capture.prompt, "hello");
  assert.strictEqual(capture.inputEnded, true);
  assert.strictEqual(capture.closed, true);
});

test("LLM completion uses the adapter-native YOKE one-shot path when available", async function () {
  var capture = { prompts: [] };
  var adapter = {
    vendor: "claude",
    createQuery: function () { throw new Error("Capsule bridge bypassed completeOnce"); },
    createOneShotQuery: function (opts) {
      capture.opts = opts;
      return Promise.resolve({
        handle: queryHandle([{ yokeType: "text_delta", text: "native" }, { yokeType: "result" }], capture),
        backendPersistence: "ephemeral",
      });
    },
  };
  var text = await toolLlm.complete({
    adapters: { claude: adapter }, cwd: "/tmp", args: { prompt: "hello", model: "fast" },
    selection: { vendor: "claude", model: "claude-haiku-4-5" },
  });
  assert.strictEqual(text, "native");
  assert.strictEqual(capture.opts.skipProjectInstructions, true);
  assert.strictEqual(capture.opts.skipSkills, true);
});

test("LLM completion never stringifies a rich catalog object as the selected model", async function () {
  var capture = {};
  var adapter = {
    vendor: "claude",
    createQuery: function () { throw new Error("generic query must not run"); },
    createOneShotQuery: function (opts) {
      capture.model = opts.model;
      return Promise.resolve({ handle: queryHandle([{ yokeType: "result" }], capture), backendPersistence: "ephemeral" });
    },
  };
  await toolLlm.complete({
    adapters: { claude: adapter },
    cwd: "/tmp",
    args: { prompt: "hello", model: "fast" },
    selection: { vendor: "claude", model: "fable" },
  });
  assert.strictEqual(capture.model, "fable");
  assert.notStrictEqual(capture.model, "[object Object]");
});

test("LLM completion rejects providers without verified ephemeral one-shot support", async function () {
  var adapter = {
    vendor: "legacy-provider",
    createQuery: function () { throw new Error("must not materialize a backend query"); },
  };
  await assert.rejects(toolLlm.complete({
    adapters: { legacy: adapter }, cwd: "/tmp", args: { prompt: "hello", model: "fast" },
    selection: { vendor: "legacy", model: "legacy-model" },
  }), /legacy-provider adapter does not guarantee ephemeral one-shot execution/);
});

test("LLM completion rejects missing concrete configuration actionably", async function () {
  await assert.rejects(toolLlm.complete({ adapters: {}, cwd: "/tmp", args: { prompt: "hello" }, selection: { status: "error", error: "Configure a provider and retry." } }), /Configure a provider/);
});

test("capsule authoring tools are excluded from both auto-approval paths", function () {
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: {}, adapter: {}, send: function () {} });
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_list", {}).behavior, "allow");
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_act", {}).behavior, "allow");
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_source", {}).behavior, "allow");
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_install", {}), null);
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_uninstall", {}), null);
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_update", {}), null);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__clay_tool_list") !== -1);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__clay_tool_source") !== -1);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__clay_tool_install") === -1);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__clay_tool_update") === -1);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__clay_tool_uninstall") === -1);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__*") === -1);
});
