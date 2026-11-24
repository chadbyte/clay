var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-codex-approvals-"));
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, "clay");
process.env.CLAY_CONFIG = path.join(root, "config.json");
process.env.CODEX_HOME = path.join(root, "codex");
var kit = require("../lib/yoke/adapters/codex").contractTestKit;
var guardModule = require("../lib/yoke/codex-request-guard");
test.after(function() { fs.rmSync(root, { recursive: true, force: true }); });

function tick() { return new Promise(function(resolve) { setImmediate(resolve); }); }
async function fixture(t, options) {
  options = options || {};
  var entry;
  var responses = [];
  var calls = [];
  var resolveApproval;
  var turn = 0;
  var started = [];
  var server = {
    started: true,
    addHandler: function(fn) { entry = { threadId: null, fn: fn }; return entry; },
    removeHandler: function() {},
    respond: function(id, result) { responses.push({ id: id, result: result }); },
    respondError: function(id, code, message) { responses.push({ id: id, code: code, message: message }); },
    send: function(method) {
      if (method === "thread/start" || method === "thread/resume") return Promise.resolve({ thread: { id: "thread-a" } });
      if (method === "turn/start") { turn++; started.push("turn-" + turn); return Promise.resolve({ turn: { id: "turn-" + turn } }); }
      return Promise.resolve({});
    },
  };
  function approve(name, input, metadata) {
    calls.push({ name: name, input: input, metadata: metadata });
    return new Promise(function(resolve) { resolveApproval = resolve; });
  }
  var handle = kit.createQueryHandle(server, Object.assign({ cwd: root, model: "fixture-model", abortController: new AbortController(),
    canUseTool: approve,
  }, options));
  t.after(function() { handle.close(); });
  handle.pushMessage("fixture prompt");
  await tick();
  function emit(method, params, id) { entry.fn({ method: method, id: id, params: params }); }
  return { handle: handle, responses: responses, calls: calls, started: started, emit: emit,
    disconnect: function() { server.started = false; },
    allow: function() { resolveApproval({ behavior: "allow" }); },
    request: function(method, id, overrides) {
      emit(method, Object.assign({ threadId: "thread-a", turnId: "turn-" + turn, itemId: "item-a", command: "fixture-only", serverName: "fixture", _meta: { tool: "test" } }, overrides), id);
    },
  };
}

var methods = ["item/commandExecution/requestApproval", "mcpServer/elicitation/request"];
methods.forEach(function(method) {
  test(method + " permits one live exact review and never replays it", async function(t) {
    var f = await fixture(t);
    f.request(method, 1); await tick();
    f.allow(); await tick();
    f.request(method, 1); await tick();
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.responses, [{ id: 1, result: method === "mcpServer/elicitation/request" ? { action: "accept" } : { decision: "accept" } }]);
  });
  test(method + " refuses a late allowance after transport disconnection", async function(t) {
    var f = await fixture(t);
    f.request(method, 1); await tick();
    f.disconnect(); f.allow(); await tick();
    assert.equal(f.responses.length, 1);
    assert.notEqual(f.responses[0].result.decision, "accept");
    assert.notEqual(f.responses[0].result.action, "accept");
  });
  [false, true].forEach(function(resume) {
    test(method + " retires its pending allowance on Stop (resume=" + resume + ")", async function(t) {
      var f = await fixture(t, { resumeSessionId: resume ? "thread-a" : null });
      f.request(method, 1);
      await tick();
      assert.equal(f.calls.length, 1);
      await f.handle.abort();
      assert.equal(f.calls[0].metadata.signal.aborted, true);
      f.allow(); await tick();
      assert.equal(f.responses.length, 1);
      assert.deepEqual(f.responses[0], { id: 1, result: method === "mcpServer/elicitation/request" ? { action: "cancel" } : { decision: "decline" } });
    });
  });
  test(method + " answers once and suppresses duplicate and resolved requests", async function(t) {
    var f = await fixture(t);
    f.request(method, "resolved"); await tick();
    f.request(method, "resolved"); await tick();
    assert.equal(f.calls.length, 1);
    f.emit("serverRequest/resolved", { threadId: "thread-a", requestId: "resolved-before-replay" });
    f.request(method, "resolved-before-replay"); await tick();
    assert.equal(f.calls.length, 1);
    f.emit("serverRequest/resolved", { threadId: "thread-a", requestId: "resolved" });
    f.allow(); await tick();
    assert.deepEqual(f.responses, []);
    f.request(method, "resolved"); await tick();
    assert.equal(f.calls.length, 1);
  });
  test(method + " refuses an allowance from a completed turn after the next starts", async function(t) {
    var f = await fixture(t);
    f.request(method, 1); await tick();
    f.emit("turn/completed", { threadId: "thread-a", turn: { id: "turn-1", status: "completed" } });
    f.handle.pushMessage("next prompt"); await tick();
    assert.equal(f.started.length, 2);
    f.allow(); await tick();
    assert.equal(f.responses.length, 1);
    assert.notEqual(f.responses[0].result.decision, "accept");
    assert.notEqual(f.responses[0].result.action, "accept");
  });
  test(method + " cannot accept after query close", async function(t) {
    var f = await fixture(t);
    f.request(method, 1); await tick();
    f.handle.close(); f.allow(); await tick();
    assert.equal(f.responses.length, 1);
    assert.notEqual(f.responses[0].result.decision, "accept");
    assert.notEqual(f.responses[0].result.action, "accept");
  });
  test(method + " fails closed without a review callback", async function(t) {
    var f = await fixture(t, { canUseTool: null });
    f.request(method, 1); await tick();
    assert.equal(f.responses.length, 1);
    assert.notEqual(f.responses[0].result.decision, "accept");
    assert.notEqual(f.responses[0].result.action, "accept");
  });
});

test("scoped permission requests always return an empty turn grant without invoking generic approval", async function(t) {
  var f = await fixture(t);
  [undefined, null, {}, [], { permissions: { network: { enabled: true }, fileSystem: { write: ["/"] } } }, { permissions: "malformed" }, { turnId: "old" }, { threadId: "foreign" }].forEach(function(params, index) {
    f.emit("item/permissions/requestApproval", params, index);
  });
  await tick();
  assert.equal(f.responses.length, 8);
  f.responses.forEach(function(response) { assert.deepEqual(response.result, { permissions: {}, scope: "turn" }); });
  assert.equal(f.calls.length, 0);
  var absent = await fixture(t, { canUseTool: null });
  absent.request("item/permissions/requestApproval", 1, { permissions: { network: { enabled: true } } });
  assert.deepEqual(absent.responses, [{ id: 1, result: { permissions: {}, scope: "turn" } }]);
});

test("protocol-valid file requests with grantRoot cannot create an empty or broader review", async function(t) {
  var f = await fixture(t);
  [null, "/", path.join(root, "workspace")].forEach(function(grantRoot, index) {
    // Exact FileChangeRequestApprovalParams from Codex 0.172.0: no changes/path.
    var params = { threadId: "thread-a", turnId: "turn-1", itemId: "file-" + index,
      startedAtMs: Date.now(), reason: "Request for extra write access", grantRoot: grantRoot };
    f.emit("item/fileChange/requestApproval", params, index);
    f.emit("item/fileChange/requestApproval", params, index);
  });
  await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.responses.length, 3);
  f.responses.forEach(function(response) { assert.deepEqual(response.result, { decision: "decline" }); });
  await f.handle.abort();
  assert.equal(f.responses.length, 3);
});

test("receipt capacity stops the production query and cannot authorize old duplicates or later turns", async function(t) {
  var f = await fixture(t);
  f.request("item/commandExecution/requestApproval", "pending"); await tick();
  for (var i = 1; i < guardModule.RECEIPT_LIMIT; i++) {
    f.request("item/permissions/requestApproval", "denied-" + i);
  }
  f.request("item/commandExecution/requestApproval", "overflow");
  f.allow(); await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.handle.pushMessage("must not replay"), false);
  assert.ok(f.calls[0].metadata.signal.aborted);
  assert.deepEqual(f.responses.find(function(response) { return response.id === "pending"; }).result, { decision: "decline" });
  f.request("item/commandExecution/requestApproval", "pending");
  f.request("item/commandExecution/requestApproval", "after-overflow");
  await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.responses.filter(function(response) { return response.id === "pending"; }).length, 1);
  var events = [];
  for await (var event of f.handle) events.push(event);
  assert.ok(events.some(function(event) { return event.yokeType === "error" && /safety limit/.test(event.text); }));
});

test("resolved receipts share the hard bound and exhaustion survives finish/begin lifecycle", function() {
  var responses = [], exhausted = 0;
  var guard = guardModule.create({ respond: function(id, result) { responses.push({ id: id, result: result }); } }, function() { return true; }, function() { exhausted++; });
  guard.begin("thread-a"); guard.ready("turn-1");
  for (var i = 0; i < guardModule.RECEIPT_LIMIT; i++) guard.resolved({ threadId: "thread-a", requestId: i });
  guard.resolved({ threadId: "thread-a", requestId: "overflow" });
  assert.equal(guard.receiptCount(), guardModule.RECEIPT_LIMIT);
  assert.equal(exhausted, 1);
  guard.finish(); guard.begin("thread-a"); guard.ready("turn-2");
  assert.equal(guard.open({ method: "item/tool/call", id: "later", params: { threadId: "thread-a", turnId: "turn-2" } }), null);
  assert.equal(guard.receiptCount(), guardModule.RECEIPT_LIMIT);
  assert.equal(responses[0].result.success, false);
  guard.open({ method: "item/tool/call", id: 0, params: { threadId: "thread-a", turnId: "turn-2" } });
  assert.equal(responses.length, 1, "a retained old ID never receives authority again");
});

test("command and file reviews reject missing, malformed and stale identity before asking", async function(t) {
  var f = await fixture(t);
  var id = 0;
  ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].forEach(function(method) {
    [{ threadId: "foreign" }, { turnId: "old" }, { turnId: null }, { itemId: null }].forEach(function(params) { f.request(method, ++id, params); });
  });
  f.request(methods[0], ++id, { command: null });
  f.request(methods[0], ++id, { command: {} });
  f.request("item/fileChange/requestApproval", ++id, { changes: "malformed" });
  f.request("item/fileChange/requestApproval", ++id, { changes: [null] });
  f.request("item/fileChange/requestApproval", ++id, { changes: [{}] });
  await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.responses.length, id);
  f.responses.forEach(function(response) { assert.deepEqual(response.result, { decision: "decline" }); });
});

test("MCP standalone elicitation stays query-bound when the protocol supplies no turn", async function(t) {
  var finish;
  var f = await fixture(t, { onElicitation: function(request, options) {
    assert.equal(options.signal.aborted, false);
    return new Promise(function(resolve) { finish = resolve; });
  } });
  f.request("mcpServer/elicitation/request", 1, { turnId: null, requestedSchema: { type: "object", properties: {} } });
  await tick();
  await f.handle.abort(); finish({ action: "accept", content: {} }); await tick();
  assert.deepEqual(f.responses, [{ id: 1, result: { action: "cancel" } }]);
});

test("a dynamic tool whose review resolves after Stop never executes", async function(t) {
  var executed = 0;
  var f = await fixture(t, { dynamicTools: [{ name: "fixture_tool", description: "Fixture", inputSchema: { type: "object" } }],
    callDynamicTool: function() { executed++; return { content: [] }; } });
  f.request("item/tool/call", 1, { tool: "fixture_tool", arguments: {} }); await tick();
  await f.handle.abort(); f.allow(); await tick();
  assert.equal(executed, 0);
  assert.equal(f.responses.length, 1);
  assert.equal(f.responses[0].result.success, false);
});
