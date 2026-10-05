var test = require("node:test");
var assert = require("node:assert");

var { AcpProcessManager } = require("../lib/yoke/acp-process-manager");

function makeManager() {
  var manager = new AcpProcessManager("/nonexistent/acp-agent", {});
  manager.started = true;
  manager.proc = { stdin: { write: function() { return true; } } };
  manager.written = [];
  manager._write = function(msg) { manager.written.push(msg); };
  return manager;
}

function serverRequest(id, sessionId) {
  return {
    jsonrpc: "2.0",
    id: id,
    method: "session/request_permission",
    params: { sessionId: sessionId },
  };
}

test("shared ACP routing selects the handler for the message session", function() {
  var manager = makeManager();
  var seenA = 0;
  var seenB = 0;
  var handlerA = manager.addHandler(function() { seenA++; });
  var handlerB = manager.addHandler(function() { seenB++; });
  handlerA.sessionId = "session-a";
  handlerB.sessionId = "session-b";

  manager._handleMessage({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: "session-b", update: {} },
  });

  assert.strictEqual(seenA, 0);
  assert.strictEqual(seenB, 1);
});

test("shared ACP routing fans process-wide notifications out to all handlers", function() {
  var manager = makeManager();
  var seen = 0;
  manager.addHandler(function() { seen++; }).sessionId = "session-a";
  manager.addHandler(function() { seen++; }).sessionId = "session-b";

  manager._handleMessage({ jsonrpc: "2.0", method: "agent/status", params: {} });

  assert.strictEqual(seen, 2);
});

test("shared ACP routing delivers a server request exactly once", function() {
  var manager = makeManager();
  var seen = 0;
  manager.addHandler(function() { seen++; }).sessionId = "session-a";
  manager.addHandler(function() { seen++; }).sessionId = "session-a";

  manager._handleMessage(serverRequest(7, "session-a"));

  assert.strictEqual(seen, 1);
});

test("shared ACP routing delivers elicitation to one matching session handler", function() {
  var manager = makeManager();
  var seenA = 0;
  var seenB = 0;
  manager.addHandler(function() { seenA++; }).sessionId = "session-a";
  manager.addHandler(function() { seenB++; }).sessionId = "session-b";

  manager._handleMessage({
    jsonrpc: "2.0", id: 71, method: "elicitation/create",
    params: { sessionId: "session-b", mode: "form" },
  });

  assert.strictEqual(seenA, 0);
  assert.strictEqual(seenB, 1);
});

test("shared ACP routing rejects an unmatched server request", function() {
  var manager = makeManager();
  manager.addHandler(function() { assert.fail("wrong handler"); }).sessionId = "session-a";

  manager._handleMessage(serverRequest(8, "session-missing"));

  assert.strictEqual(manager.written.length, 1);
  assert.strictEqual(manager.written[0].id, 8);
  assert.strictEqual(manager.written[0].error.code, -32001);
});

test("shared ACP routing resolves a matching client request", async function() {
  var manager = makeManager();
  var pending = manager.send("session/new", { cwd: "/tmp" });
  var request = manager.written[0];

  manager._handleMessage({
    jsonrpc: "2.0",
    id: request.id,
    result: { sessionId: "session-a" },
  });

  assert.deepStrictEqual(await pending, { sessionId: "session-a" });
  assert.strictEqual(manager.pendingRequests[request.id], undefined);
});

test("shared ACP process request handlers produce one JSON-RPC response", async function() {
  var manager = makeManager();
  manager.addRequestHandler("agent/authenticate", function(params) {
    assert.deepStrictEqual(params, { challenge: "token" });
    return { authenticated: true };
  });

  manager._handleMessage({
    jsonrpc: "2.0",
    id: 9,
    method: "agent/authenticate",
    params: { challenge: "token" },
  });
  await new Promise(function(resolve) { setImmediate(resolve); });

  assert.deepStrictEqual(manager.written, [{
    jsonrpc: "2.0",
    id: 9,
    result: { authenticated: true },
  }]);
});

test("shared ACP rejects unknown process requests instead of leaking them to a session", function() {
  var manager = makeManager();
  var seen = 0;
  manager.addHandler(function() { seen++; }).sessionId = "session-a";

  manager._handleMessage({
    jsonrpc: "2.0",
    id: 10,
    method: "agent/unknown_request",
    params: {},
  });

  assert.strictEqual(seen, 0);
  assert.deepStrictEqual(manager.written, [{
    jsonrpc: "2.0",
    id: 10,
    error: { code: -32601, message: "No process handler for method agent/unknown_request" },
  }]);
});
