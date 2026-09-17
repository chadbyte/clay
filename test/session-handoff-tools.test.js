var test = require("node:test");
var assert = require("node:assert");

var handoffModule = require("../lib/project-session-handoff");
var contextBuilder = require("../lib/session-handoff-context");
var vendorRegistry = require("../lib/yoke/vendor-registry").VENDOR_REGISTRY;

function attachWithSessions(sessions) {
  return handoffModule.attachSessionHandoff({
    cwd: process.cwd(),
    projectSlug: "test-project",
    sm: { sessions: sessions },
    isMate: false,
    isMultiUser: function () { return false; },
    getProjectAccess: function () { return { visibility: "public" }; },
  });
}

function textOf(result) {
  return result.content[0].text;
}

test("handoff tool definitions fail closed without a bound session and expose discovery to ordinary Drivers", async function () {
  var ordinary = { localId: 9, ownerId: null, history: [] };
  var attached = attachWithSessions(new Map([[9, ordinary]]));
  var staticDefs = attached.getToolDefs(null);
  assert.strictEqual(staticDefs.length, 1);
  assert.strictEqual(staticDefs[0].name, "read_handoff_source");
  var result = await staticDefs[0].handler({});
  assert.strictEqual(result.isError, true);
  assert.match(textOf(result), /requires a session-bound tool server/);
  var ordinaryDefs = attachWithSessions(new Map([[9, ordinary]])).getToolDefs(ordinary);
  assert.deepStrictEqual(ordinaryDefs.map(function (tool) { return tool.name; }), ["list_other_driver_sessions", "search_other_driver_sessions", "read_other_driver_session"]);
});

test("handoff MCP server exposes discovery for a session without handoff metadata", function () {
  var ordinary = { localId: 9, ownerId: null, history: [] };
  var attached = attachWithSessions(new Map([[9, ordinary]]));
  var calls = [];
  var adapter = {
    createToolServer: function (config) {
      calls.push(config);
      return config;
    },
  };
  var result = attached.createMcpServer(adapter, ordinary);
  assert.ok(result);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].tools.map(function (tool) { return tool.name; }), ["list_other_driver_sessions", "search_other_driver_sessions", "read_other_driver_session"]);
});

test("handoff tool formats source history and caps entry text", async function () {
  var longText = "x".repeat(900);
  var source = {
    localId: 1,
    ownerId: null,
    vendor: "claude",
    title: "Source work",
    history: [
      { type: "user_message", text: "Please inspect this." },
      { type: "delta", text: longText },
      { type: "tool_executing", name: "Read", input: { file_path: "/tmp/example.js" } },
      { type: "tool_result", name: "Read", input: { file_path: "/tmp/example.js" } },
      { type: "usage", inputTokens: 10 },
    ],
  };
  var target = { localId: 2, ownerId: null, handoff: { sourceSessionId: 1 } };
  var attached = attachWithSessions(new Map([[1, source], [2, target]]));
  var result = await attached.getToolDefs(target)[0].handler({ offset: 0, limit: 10 });
  var text = textOf(result);
  assert.match(text, /# Source work — claude\/1/);
  assert.match(text, /Showing entries 1-5 of 5/);
  assert.match(text, /\[USER\] Please inspect this\./);
  assert.match(text, /\[ASSISTANT\] x{797}\.\.\./);
  assert.match(text, /\[TOOL\] Read \{"file_path":"\/tmp\/example\.js"\}/);
  assert.doesNotMatch(text, /inputTokens/);
});

test("handoff tool defaults to the tail and supports explicit pagination", async function () {
  var history = [];
  for (var i = 0; i < 35; i++) history.push({ type: "user_message", text: "entry-" + i });
  var source = { localId: 1, ownerId: null, vendor: "kiro", title: "Paged", history: history };
  var target = { localId: 2, ownerId: null, handoff: { sourceSessionId: 1 } };
  var attached = attachWithSessions(new Map([[1, source], [2, target]]));
  var tool = attached.getToolDefs(target)[0];

  var tail = textOf(await tool.handler({}));
  assert.match(tail, /Showing entries 6-35 of 35/);
  assert.doesNotMatch(tail, /\[USER\] entry-4\n/);
  assert.match(tail, /\[USER\] entry-5/);
  assert.match(tail, /\[USER\] entry-34/);

  var page = textOf(await tool.handler({ offset: 0, limit: 3 }));
  assert.match(page, /Showing entries 1-3 of 35/);
  assert.match(page, /entry-0/);
  assert.match(page, /entry-2/);
  assert.doesNotMatch(page, /entry-3/);
});

test("handoff tool rejects a source owned by another user without leaking content", async function () {
  var source = { localId: 1, ownerId: "other", history: [{ type: "user_message", text: "PRIVATE" }] };
  var target = { localId: 2, ownerId: "owner", handoff: { sourceSessionId: 1 } };
  var attached = attachWithSessions(new Map([[1, source], [2, target]]));
  var result = await attached.getToolDefs(target)[0].handler({});
  assert.strictEqual(result.isError, true);
  assert.match(textOf(result), /owner does not match/);
  assert.doesNotMatch(textOf(result), /PRIVATE/);
});

test("handoff tool reads a valid grandparent and rejects sessions outside the chain", async function () {
  var grandparent = {
    localId: 1,
    ownerId: "owner",
    vendor: "claude",
    history: [{ type: "user_message", text: "grandparent context" }],
  };
  var parent = { localId: 2, ownerId: "owner", handoff: { sourceSessionId: 1 }, history: [] };
  var target = { localId: 3, ownerId: "owner", handoff: { sourceSessionId: 2 } };
  var unrelated = { localId: 4, ownerId: "owner", history: [{ type: "user_message", text: "unrelated secret" }] };
  var attached = attachWithSessions(new Map([[1, grandparent], [2, parent], [3, target], [4, unrelated]]));
  var tool = attached.getToolDefs(target)[0];

  var result = await tool.handler({ sourceSessionId: "1" });
  assert.strictEqual(result.isError, undefined);
  assert.match(textOf(result), /grandparent context/);

  var rejected = await tool.handler({ sourceSessionId: "4" });
  assert.strictEqual(rejected.isError, true);
  assert.match(textOf(rejected), /not in this session's handoff chain/);
  assert.doesNotMatch(textOf(rejected), /unrelated secret/);
});

test("handoff chain cycle is bounded and does not prevent reading a valid source", async function () {
  var first = { localId: 1, ownerId: null, handoff: { sourceSessionId: 2 }, history: [] };
  var second = {
    localId: 2,
    ownerId: null,
    handoff: { sourceSessionId: 1 },
    history: [{ type: "user_message", text: "cycle source" }],
  };
  var target = { localId: 3, ownerId: null, handoff: { sourceSessionId: 2 } };
  var attached = attachWithSessions(new Map([[1, first], [2, second], [3, target]]));
  var result = await attached.getToolDefs(target)[0].handler({});
  assert.strictEqual(result.isError, undefined);
  assert.match(textOf(result), /cycle source/);
});

test("handoff tool reports a missing source session", async function () {
  var target = { localId: 2, ownerId: null, handoff: { sourceSessionId: 999 } };
  var attached = attachWithSessions(new Map([[2, target]]));
  var result = await attached.getToolDefs(target)[0].handler({});
  assert.strictEqual(result.isError, true);
  assert.match(textOf(result), /Source session was not found: 999/);
});

test("handoff context mentions source reading only when the target can mount session tools", function () {
  var options = {
    cwd: process.cwd(),
    source: {
      localId: 1,
      vendor: "claude",
      title: "Context source",
      history: [{ type: "user_message", text: "Continue the work." }],
    },
    targetVendor: "kiro",
    sourceReadTool: true,
  };
  assert.match(contextBuilder.buildHandoffContext(options), /read_handoff_source/);
  options.sourceReadTool = false;
  assert.doesNotMatch(contextBuilder.buildHandoffContext(options), /read_handoff_source/);
});

test("vendor registry exposes session-bound MCP reachability", function () {
  var supported = ["claude", "kiro", "opencode", "kimi", "grok", "copilot", "qwen", "junie"];
  for (var i = 0; i < supported.length; i++) {
    assert.strictEqual(vendorRegistry[supported[i]].sessionBoundTools, true, supported[i]);
  }
  assert.strictEqual(vendorRegistry.codex.sessionBoundTools, false);
  assert.strictEqual(vendorRegistry.antigravity.sessionBoundTools, false);
});
