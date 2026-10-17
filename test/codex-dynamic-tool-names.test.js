// Codex dynamic tool aliases against the installed app-server validation rules.
// The fake app-server below never spawns Codex or contacts a provider.
var test = require("node:test");
var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var codexModule = require("../lib/yoke/adapters/codex");
var toolNames = require("../lib/yoke/codex-dynamic-tool-names");

// Port of codex-rs/app-server thread_processor.rs validate_dynamic_tools
// (rust-v0.162.1, the installed @openai/codex version) for function specs.
function validateLikeCodex(tools) {
  var seen = new Set();
  tools.forEach(function (tool) {
    var name = tool.name.trim();
    if (!name) throw new Error("dynamic tool name must not be empty");
    if (name !== tool.name) throw new Error("dynamic tool name has leading/trailing whitespace: " + tool.name);
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("dynamic tool name must match ^[a-zA-Z0-9_-]+$: " + name);
    if (name.length > 128) throw new Error("dynamic tool name must be at most 128 characters: " + name);
    if (name === "mcp" || name.indexOf("mcp__") === 0) throw new Error("dynamic tool name is reserved: " + name);
    if (seen.has(name)) throw new Error("duplicate dynamic tool name: " + name);
    seen.add(name);
    if (tool.type !== "function" || !tool.inputSchema || typeof tool.inputSchema !== "object") throw new Error("invalid spec: " + name);
  });
}

var DISCOVER = "mcp__clay-mcp-connections__discover_mcp_connections";
var PROPOSE = "mcp__clay-mcp-connections__propose_mcp_import";

function def(name) {
  return { name: name, description: "desc " + name, inputSchema: { type: "object", properties: {} } };
}

function fakeServer(script) {
  var server = { calls: [], responses: [], entry: null };
  server.started = true;
  server.addHandler = function (fn) { server.entry = { threadId: null, fn: fn }; return server.entry; };
  server.removeHandler = function () {};
  server.respond = function (id, result) { server.responses.push({ id: id, result: result }); };
  server.send = function (method, params) {
    server.calls.push({ method: method, params: params });
    if (method === "thread/start") return Promise.resolve({ thread: { id: "thread-alias" } });
    if (method === "thread/resume") return Promise.resolve({ thread: { id: params.threadId } });
    if (method === "turn/start") {
      setImmediate(function () {
        (script || []).forEach(function (message) { server.entry.fn(message); });
        setImmediate(function () { server.entry.fn({ method: "turn/completed", params: { threadId: "thread-alias" } }); });
      });
    }
    return Promise.resolve({});
  };
  return server;
}

async function run(server, opts) {
  var permissions = [], executed = [], events = [];
  var handle = codexModule.contractTestKit.createQueryHandle(server, Object.assign({
    cwd: process.cwd(), model: "gpt-test", abortController: new AbortController(),
    canUseTool: function (name) { permissions.push(name); return Promise.resolve({ behavior: "allow" }); },
    callDynamicTool: function (name, args) { executed.push({ name: name, args: args }); return Promise.resolve({ content: [{ type: "text", text: "ok " + name }] }); },
  }, opts));
  handle.pushMessage("Use the tools");
  for await (var event of handle) {
    events.push(event);
    if (event.yokeType === "result" || event.yokeType === "error") break;
  }
  handle.close();
  await new Promise(function (resolve) { setImmediate(resolve); });
  return { permissions: permissions, executed: executed, events: events };
}

function toolCall(id, tool, extra) {
  return { id: id, method: "item/tool/call", params: Object.assign({ threadId: "thread-alias", callId: "call-" + id, tool: tool, arguments: { probe: id } }, extra || {}) };
}

test("fresh Codex thread/start advertises a catalog the installed validator accepts", async function () {
  var longName = "mcp__" + "s".repeat(90) + "__" + "t".repeat(90);
  var originals = [DISCOVER, PROPOSE, "write_note", "send_to_partner", "mcp", "mcp__my.server__tool name", longName,
    toolNames.transportName(DISCOVER), "clay__plain_lookalike"];
  assert.throws(function () { validateLikeCodex(originals.map(function (name) { return { type: "function", name: name, inputSchema: {} }; })); },
    /dynamic tool name is reserved: mcp__clay-mcp-connections__discover_mcp_connections/, "the baseline names reproduce the reported failure");
  var server = fakeServer([]);
  await run(server, { dynamicTools: originals.map(def) });
  var start = server.calls.find(function (call) { return call.method === "thread/start"; });
  validateLikeCodex(start.params.dynamicTools);
  var names = start.params.dynamicTools.map(function (tool) { return tool.name; });
  assert.equal(names.length, originals.length);
  assert.equal(names[2], "write_note");
  assert.equal(names[3], "send_to_partner");
  assert.match(names[0], /^clay__clay-mcp-connections__discover_mcp_connections__[0-9a-f]{16}$/);
  assert.notEqual(names[7], names[0], "an original that spells another tool's alias is itself re-aliased");
  assert.equal(start.params.dynamicTools[0].description, "desc " + DISCOVER);
});

test("Codex resolves aliases to original names for permission, dispatch and activity", async function () {
  var alias = toolNames.transportName(DISCOVER);
  var server = fakeServer([
    { method: "item/started", params: { item: { type: "dynamicToolCall", id: "item-1", tool: alias, arguments: { probe: 1 } } } },
    toolCall(51, alias),
  ]);
  var result = await run(server, { dynamicTools: [def(DISCOVER), def("write_note")] });
  assert.deepEqual(result.permissions, [DISCOVER]);
  assert.deepEqual(result.executed, [{ name: DISCOVER, args: { probe: 51 } }]);
  var started = result.events.filter(function (event) { return event.yokeType === "tool_start" || event.yokeType === "tool_executing"; });
  assert.deepEqual(started.map(function (event) { return event.toolName; }), [DISCOVER, DISCOVER]);
  assert.deepEqual(server.responses, [{ id: 51, result: { contentItems: [{ type: "inputText", text: "ok " + DISCOVER }], success: true } }]);
});

test("Codex refuses raw reserved, spoofed, namespaced and unadvertised aliases before permission", async function () {
  var forged = toolNames.transportName(DISCOVER).replace(/[0-9a-f]{16}$/, "0000000000000000");
  var server = fakeServer([
    toolCall(61, DISCOVER),
    toolCall(62, forged),
    toolCall(63, toolNames.transportName(DISCOVER), { namespace: "clay" }),
    toolCall(64, toolNames.transportName("mcp__other__tool")),
  ]);
  var result = await run(server, { dynamicTools: [def(DISCOVER)] });
  assert.deepEqual(result.permissions, []);
  assert.deepEqual(result.executed, []);
  assert.deepEqual(server.responses.map(function (response) { return response.id; }), [61, 62, 63, 64]);
  server.responses.forEach(function (response) {
    assert.equal(response.result.success, false);
    assert.match(response.result.contentItems[0].text, /^Error: /);
  });
  assert.match(server.responses[2].result.contentItems[0].text, /namespaced/);
});

test("a resumed thread's persisted aliases resolve against a rebuilt catalog and stale ones are refused", async function () {
  var discoverAlias = toolNames.transportName(DISCOVER);
  var proposeAlias = toolNames.transportName(PROPOSE);
  var server = fakeServer([toolCall(71, discoverAlias), toolCall(72, proposeAlias), toolCall(73, "write_note")]);
  // Rebuilt in a different order, with the propose tool no longer present.
  var result = await run(server, { resumeSessionId: "thread-alias", dynamicTools: [def("write_note"), def(DISCOVER)] });
  var resume = server.calls.find(function (call) { return call.method === "thread/resume"; });
  assert.equal(Object.prototype.hasOwnProperty.call(resume.params, "dynamicTools"), false);
  assert.deepEqual(result.executed.map(function (call) { return call.name; }), [DISCOVER, "write_note"]);
  assert.deepEqual(result.permissions, [DISCOVER, "mcp__clay-notes__write_note"]);
  var stale = server.responses.find(function (response) { return response.id === 72; });
  assert.equal(stale.result.success, false);
  assert.match(stale.result.contentItems[0].text, /not in this conversation's current catalog/);
});

test("identical originals are advertised once and a true alias collision fails closed before thread/start", async function () {
  var catalog = toolNames.createCatalog([def(DISCOVER), def(DISCOVER), def("write_note")]);
  assert.deepEqual(catalog.advertised.map(function (entry) { return entry.name; }), [toolNames.transportName(DISCOVER), "write_note"]);
  var original = crypto.createHash;
  crypto.createHash = function () {
    return { update: function () { return { digest: function () { return "f".repeat(64); } }; } };
  };
  var server = fakeServer([]);
  var result;
  try {
    result = await run(server, { dynamicTools: [def("mcp__a_b"), def("mcp__a.b")] });
  } finally {
    crypto.createHash = original;
  }
  assert.equal(server.calls.some(function (call) { return call.method === "thread/start"; }), false);
  var error = result.events.find(function (event) { return event.yokeType === "error"; });
  assert.match(error.text, /Codex dynamic tool names collide: mcp__a_b and mcp__a\.b/);
});
