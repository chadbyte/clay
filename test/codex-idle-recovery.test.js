var test = require("node:test");
var assert = require("node:assert/strict");
var createAdapter = require("../lib/yoke/adapters/codex").createCodexAdapter;

function tick() {
  return new Promise(function(resolve) { setImmediate(resolve); });
}

function deferred() {
  var resolve;
  var promise = new Promise(function(done) { resolve = done; });
  return { promise: promise, resolve: resolve };
}

function fixture(t, overrides) {
  var servers = [];
  var nextThread = 0;
  var nextTurn = 0;
  function createServer() {
    var server = { started: false, stopped: 0, calls: [], handlers: [] };
    server.start = function() { server.started = true; return Promise.resolve(); };
    server.stop = function() { server.stopped++; server.started = false; };
    server.addHandler = function(fn) {
      var entry = { threadId: null, fn: fn };
      server.handlers.push(entry);
      return entry;
    };
    server.removeHandler = function(entry) {
      server.handlers = server.handlers.filter(function(current) { return current !== entry; });
    };
    server.notify = function() {};
    server.respond = function() {};
    server.send = function(method, params) {
      server.calls.push({ method: method, params: params });
      if (overrides && overrides.send) {
        var overridden = overrides.send(server, method, params);
        if (overridden !== undefined) return overridden;
      }
      if (method === "thread/start") return Promise.resolve({ thread: { id: "thread-" + (++nextThread) } });
      if (method === "thread/resume") return Promise.resolve({ thread: { id: params.threadId } });
      if (method === "turn/start") return Promise.resolve({ turn: { id: "turn-" + (++nextTurn) } });
      return Promise.resolve({ data: [], nextCursor: null });
    };
    server.complete = function(threadId, turnId) {
      server.handlers.slice().forEach(function(entry) {
        if (entry.threadId === threadId) entry.fn({ method: "turn/completed", params: {
          threadId: threadId, turn: { id: turnId, status: "completed" },
        } });
      });
    };
    servers.push(server);
    return server;
  }
  var adapter = createAdapter({ cwd: process.cwd(), createAppServer: createServer });
  t.after(function() { return adapter.shutdown(); });
  return {
    adapter: adapter,
    servers: servers,
    fresh: function() { return adapter.createQuery({ cwd: process.cwd(), model: "gpt-test" }); },
    recover: function(controller) {
      return adapter.createQuery({ cwd: process.cwd(), resumeSessionId: "saved-thread",
        abortController: controller,
        sessionMcpServer: { name: "clay-session-tools", command: process.execPath, args: ["unused-test-bridge.js"] },
      });
    },
  };
}

async function completeFirstTurn(kit) {
  var handle = await kit.fresh();
  assert.equal(handle.pushMessage("First message"), true);
  await tick();
  kit.servers[0].complete("thread-1", "turn-1");
  await tick();
  return handle;
}

test("completed idle handles no longer block recovery and reject later pushes", async function(t) {
  var kit = fixture(t);
  var idle = await completeFirstTurn(kit);
  var iterator = idle[Symbol.asyncIterator]();
  var resultSeen = false;
  for (var i = 0; i < 4; i++) {
    var event = await iterator.next();
    if (event.value && event.value.yokeType === "result") { resultSeen = true; break; }
  }
  assert.equal(resultSeen, true);
  var recovery = await kit.recover();
  assert.equal(kit.servers[0].stopped, 1);
  assert.equal(kit.servers[0].handlers.length, 0, "retired input loop detached before process release");
  assert.equal(idle.pushMessage("Must be resumed through a new handle"), false);
  assert.equal(kit.servers[0].calls.some(function(call) { return call.method === "turn/interrupt"; }), false);
  recovery.pushMessage("Continue saved conversation");
  await tick();
  assert.equal(kit.servers[1].calls.filter(function(call) { return call.method === "thread/resume"; })[0].params.threadId, "saved-thread");
  assert.equal(kit.servers[1].calls.filter(function(call) { return call.method === "turn/start"; }).length, 1);
});

test("a running sibling prevents retirement of every idle handle", async function(t) {
  var kit = fixture(t);
  var idle = await completeFirstTurn(kit);
  var active = await kit.fresh();
  active.pushMessage("Still running");
  await tick();
  await assert.rejects(kit.recover(), /active shared runtime/);
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(kit.servers[0].handlers.length, 2);
  assert.equal(idle.pushMessage("Still usable"), true, "failed recovery cannot partially retire idle inputs");
});

test("an allocated handle awaiting its first message remains protected", async function(t) {
  var kit = fixture(t);
  var fresh = await kit.fresh();
  await assert.rejects(kit.recover(), /active shared runtime/);
  assert.equal(fresh.pushMessage("Initial delivery"), true);
  assert.equal(kit.servers[0].stopped, 0);
});

test("queued messages stay protected between turns", async function(t) {
  var kit = fixture(t);
  var handle = await kit.fresh();
  handle.pushMessage("First");
  await tick();
  handle.pushMessage("Second");
  kit.servers[0].complete("thread-1", "turn-1");
  await assert.rejects(kit.recover(), /active shared runtime/);
  await tick();
  var starts = kit.servers[0].calls.filter(function(call) { return call.method === "turn/start"; });
  assert.equal(starts.length, 2);
  assert.equal(starts[1].params.input[0].text, "Second");
  assert.equal(kit.servers[0].stopped, 0);
  kit.servers[0].complete("thread-1", "turn-2");
  await tick();
  await kit.recover();
  assert.equal(kit.servers[0].stopped, 1);
});

test("recovery never releases a runtime while Stop is awaiting interruption", async function(t) {
  var interrupt = deferred();
  var kit = fixture(t, { send: function(server, method) {
    if (method === "turn/interrupt") return interrupt.promise;
  } });
  var handle = await kit.fresh();
  handle.pushMessage("Running");
  await tick();
  var stopped = handle.abort();
  await assert.rejects(kit.recover(), /active shared runtime/);
  assert.equal(kit.servers[0].stopped, 0);
  interrupt.resolve({});
  await stopped;
  await kit.recover();
  assert.equal(kit.servers[0].stopped, 1);
});

test("messages arriving during idle verification invalidate retirement even if they finish", async function(t) {
  var probe = deferred();
  var probing = false;
  var kit = fixture(t, { send: function(server, method) {
    if (probing && method === "thread/backgroundTerminals/list") return probe.promise;
  } });
  var handle = await completeFirstTurn(kit);
  probing = true;
  var rejected = assert.rejects(kit.recover(), /active shared runtime/);
  await tick();
  assert.equal(handle.pushMessage("Arrived during verification"), true);
  await tick();
  kit.servers[0].complete("thread-1", "turn-2");
  await tick();
  probe.resolve({ data: [], nextCursor: null });
  await rejected;
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(handle.pushMessage("Still usable"), true);
});

test("ordinary starts wait for recovery admission and attach to a replacement shared runtime", async function(t) {
  var probe = deferred();
  var probing = false;
  var kit = fixture(t, { send: function(server, method) {
    if (probing && method === "thread/backgroundTerminals/list") return probe.promise;
  } });
  var idle = await completeFirstTurn(kit);
  probing = true;
  var recovery = kit.recover();
  await tick();
  var admitted = false;
  var ordinary = kit.fresh().then(function(handle) { admitted = true; return handle; });
  await tick();
  assert.equal(admitted, false);
  probe.resolve({ data: [], nextCursor: null });
  await recovery;
  var next = await ordinary;
  assert.equal(idle.pushMessage("Cannot write to retired server"), false);
  assert.equal(next.pushMessage("New shared query"), true);
  await tick();
  assert.equal(kit.servers.length, 3);
  assert.equal(kit.servers[0].stopped, 1);
  assert.equal(kit.servers[2].calls.filter(function(call) { return call.method === "turn/start"; }).length, 1);
});

test("cancelled recovery does not retire idle inputs or start an isolated process", async function(t) {
  var probe = deferred();
  var probing = false;
  var kit = fixture(t, { send: function(server, method) {
    if (probing && method === "thread/backgroundTerminals/list") return probe.promise;
  } });
  var handle = await completeFirstTurn(kit);
  probing = true;
  var controller = new AbortController();
  var cancelled = assert.rejects(kit.recover(controller), { name: "AbortError" });
  await tick();
  controller.abort();
  probe.resolve({ data: [], nextCursor: null });
  await cancelled;
  assert.equal(kit.servers.length, 1);
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(handle.pushMessage("Still usable"), true);
});

test("background work and unverified background state prevent retirement", async function(t) {
  var results = [
    { data: [{ processId: "background-1" }], nextCursor: null },
    { terminals: [{ id: "background-1", status: "running" }] },
    { data: [], nextCursor: "more" },
    {},
    new Error("Background inspection unavailable"),
  ];
  for (var i = 0; i < results.length; i++) {
    await t.test("background case " + i, async function(st) {
      var result = results[i];
      var inspecting = false;
      var kit = fixture(st, { send: function(server, method) {
        if (inspecting && method === "thread/backgroundTerminals/list") {
          return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
        }
      } });
      var idle = await completeFirstTurn(kit);
      inspecting = true;
      await assert.rejects(kit.recover(), /active shared runtime/);
      assert.equal(kit.servers[0].stopped, 0);
      assert.equal(idle.pushMessage("Keep the conversation available"), true);
    });
  }
});

test("shutdown invalidates recovery and ordinary starts waiting on its handoff", async function(t) {
  var probe = deferred();
  var probing = false;
  var kit = fixture(t, { send: function(server, method) {
    if (probing && method === "thread/backgroundTerminals/list") return probe.promise;
  } });
  await completeFirstTurn(kit);
  probing = true;
  var recovery = assert.rejects(kit.recover(), /shut/i);
  await tick();
  var ordinary = assert.rejects(kit.fresh(), /shut/i);
  var warmup = assert.rejects(kit.adapter.init({}), /shut/i);
  await kit.adapter.shutdown();
  probe.resolve({ data: [], nextCursor: null });
  await Promise.all([recovery, ordinary, warmup]);
  assert.equal(kit.servers.length, 1, "pending work cannot resurrect a shut down runtime");
});

test("cancelled ordinary admission cannot create a handle after recovery finishes", async function(t) {
  var probe = deferred();
  var probing = false;
  var kit = fixture(t, { send: function(server, method) {
    if (probing && method === "thread/backgroundTerminals/list") return probe.promise;
  } });
  await completeFirstTurn(kit);
  probing = true;
  var recovery = kit.recover();
  await tick();
  var controller = new AbortController();
  var cancelled = assert.rejects(kit.adapter.createQuery({ abortController: controller }), { name: "AbortError" });
  controller.abort();
  probe.resolve({ data: [], nextCursor: null });
  await recovery;
  await cancelled;
  assert.equal(kit.servers.length, 2, "only the recovery runtime was created");
});

test("SDK stream cleanup retires an idle session and its next message resumes once", async function(t) {
  var kit = fixture(t);
  var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
  var session = { localId: 700, vendor: "codex", isProcessing: true,
    pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {}, history: [], messageUUIDs: [],
  };
  var recorded = [];
  var bridge = createSDKBridge({
    cwd: process.cwd(), adapter: kit.adapter, adapters: { codex: kit.adapter }, send: function() {},
    sessionManager: {
      sessions: new Map([[700, session]]), availableModels: [],
      saveSessionFile: function() {}, broadcastSessionList: function() {}, sendToSession: function() {},
      sendAndRecord: function(target, message) { recorded.push(message); },
    },
  });
  assert.equal(await bridge.startQuery(session, "First message"), true);
  await tick();
  kit.servers[0].complete("thread-1", "turn-1");
  await tick();
  assert.equal(session.isProcessing, false);
  assert.ok(session.queryInstance, "normal turn completion retains its input");
  var originalThread = session.cliSessionId;
  await kit.recover();
  await tick();
  assert.equal(session.queryInstance, null, "SDK finally clears the retired handle");
  assert.equal(session.abortController, null);
  assert.equal(session.cliSessionId, originalThread, "history identity is preserved");
  assert.equal(recorded.some(function(message) { return message.type === "error"; }), false);
  session.isProcessing = true;
  assert.equal(bridge.pushMessage(session, "Next message"), false, "caller must resume after retirement");
  assert.equal(await bridge.startQuery(session, "Next message"), true);
  await tick();
  var starts = kit.servers[2].calls.filter(function(call) { return call.method === "turn/start"; });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].params.threadId, originalThread);
  assert.ok(starts[0].params.input[0].text.endsWith("Next message"));
});
