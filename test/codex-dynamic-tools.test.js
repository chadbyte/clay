var test = require("node:test");
var assert = require("node:assert");
var codexModule = require("../lib/yoke/adapters/codex");

test("Codex canonicalizes every note operation to the exact Clay Notes namespace", function () {
  var canonical = codexModule.contractTestKit.canonicalDynamicPermissionToolName;
  var tools = ["list_notes", "write_note", "close_note", "reopen_note", "remove_note"];
  for (var i = 0; i < tools.length; i++) {
    assert.strictEqual(canonical(tools[i]), "mcp__clay-notes__" + tools[i]);
  }
  assert.strictEqual(canonical("close_note_extra"), "close_note_extra");
  assert.strictEqual(canonical("unrelated_tool"), "unrelated_tool");
});

test("Codex registers and executes session-bound dynamic tools", async function () {
  var calls = [];
  var responses = [];
  var handlerEntry = null;
  var server = {
    started: true,
    addHandler: function (fn) {
      handlerEntry = { threadId: null, fn: fn };
      return handlerEntry;
    },
    removeHandler: function () {},
    respond: function (id, result) { responses.push({ id: id, result: result }); },
    send: function (method, params) {
      calls.push({ method: method, params: params });
      if (method === "thread/start") return Promise.resolve({ thread: { id: "thread-pair" } });
      if (method === "turn/start") {
        setImmediate(function () {
          handlerEntry.fn({
            id: 41,
            method: "item/tool/call",
            params: { threadId: "thread-pair", callId: "call-1", tool: "send_to_partner", arguments: { message: "Build it" } },
          });
          setImmediate(function () {
            handlerEntry.fn({ method: "turn/completed", params: { threadId: "thread-pair" } });
          });
        });
        return Promise.resolve({});
      }
      return Promise.resolve({});
    },
  };
  var receivedArgs = null;
  var handle = codexModule.contractTestKit.createQueryHandle(server, {
    cwd: process.cwd(),
    model: "gpt-test",
    systemPrompt: "Base instructions",
    appendSystemPrompt: "You are the Driver",
    dynamicTools: [{
      name: "send_to_partner",
      description: "Delegate work",
      inputSchema: { type: "object", properties: { message: { type: "string" } } },
    }],
    callDynamicTool: function (name, args) {
      assert.strictEqual(name, "send_to_partner");
      receivedArgs = args;
      return Promise.resolve({ content: [{ type: "text", text: "Worker complete" }] });
    },
    abortController: new AbortController(),
  });

  await handle.setModel("gpt-5.6-sol");
  handle.pushMessage("Implement the feature");
  var events = [];
  for await (var event of handle) {
    events.push(event);
    if (event.yokeType === "result") break;
  }
  handle.close();

  var startCall = calls.find(function (call) { return call.method === "thread/start"; });
  assert.strictEqual(startCall.params.dynamicTools[0].name, "send_to_partner");
  var turnCall = calls.find(function (call) { return call.method === "turn/start"; });
  assert.strictEqual(turnCall.params.model, "gpt-5.6-sol");
  assert.match(turnCall.params.input[0].text, /Base instructions/);
  assert.match(turnCall.params.input[0].text, /You are the Driver/);
  assert.deepStrictEqual(receivedArgs, { message: "Build it" });
  assert.deepStrictEqual(events[0], { yokeType: "session_started", sessionId: "thread-pair" });
  assert.deepStrictEqual(responses, [{
    id: 41,
    result: { contentItems: [{ type: "inputText", text: "Worker complete" }], success: true },
  }]);
});

test("Codex does not send unsupported dynamicTools on thread/resume", async function () {
  var calls = [];
  var server = {
    started: true,
    addHandler: function () { return { threadId: null, fn: function () {} }; },
    removeHandler: function () {},
    send: function (method, params) {
      calls.push({ method: method, params: params });
      if (method === "thread/resume") return Promise.resolve({ thread: { id: "resumed" } });
      if (method === "turn/start") return Promise.resolve({});
      return Promise.resolve({});
    },
  };
  var handle = codexModule.contractTestKit.createQueryHandle(server, {
    cwd: process.cwd(), model: "gpt-test", resumeSessionId: "resumed",
    dynamicTools: [{ name: "new_tool", inputSchema: { type: "object" } }],
    abortController: new AbortController(),
  });
  handle.pushMessage("Continue");
  await new Promise(function (resolve) { setImmediate(resolve); });
  handle.close();
  var resume = calls.filter(function (call) { return call.method === "thread/resume"; })[0];
  assert.ok(resume);
  assert.equal(Object.prototype.hasOwnProperty.call(resume.params, "dynamicTools"), false,
    "the installed protocol does not define dynamicTools for thread/resume");
});

test("Codex recovers a stale resumed catalog through supported query MCP config", async function () {
  var calls = [];
  var server = {
    started: true,
    addHandler: function () { return { threadId: null, fn: function () {} }; },
    removeHandler: function () {},
    send: function (method, params) {
      calls.push({ method: method, params: params });
      if (method === "thread/resume") return Promise.resolve({ thread: { id: "resumed" } });
      return Promise.resolve({});
    },
  };
  var handle = codexModule.contractTestKit.createQueryHandle(server, {
    cwd: process.cwd(), model: "gpt-test", resumeSessionId: "resumed",
    sessionMcpServer: { name: "clay-session-tools", command: process.execPath, args: ["bridge.js", "--session", "7", "--query-generation", "3"], env: { CLAY_AUTH_TOKEN: "scoped" } },
    abortController: new AbortController(),
  });
  handle.pushMessage("Continue");
  await new Promise(function (resolve) { setImmediate(resolve); });
  handle.close();
  var resume = calls.filter(function (call) { return call.method === "thread/resume"; })[0];
  assert.deepEqual(resume.params.config, { mcp_servers: {
    "clay-session-tools": { command: process.execPath, args: ["bridge.js", "--session", "7", "--query-generation", "3"], env: { CLAY_AUTH_TOKEN: "scoped" } },
  } });
  assert.equal(Object.prototype.hasOwnProperty.call(resume.params, "dynamicTools"), false);
});

test("Codex resumes stale session tools from a warmed idle runtime and reaps it after abort", async function () {
  var servers = [];
  function fakeServer(serverOpts) {
    var server = { started: false, stopped: 0, calls: [], handler: null, options: serverOpts };
    server.start = function() { server.started = true; return Promise.resolve(); };
    server.stop = function() { server.stopped++; server.started = false; };
    server.addHandler = function(fn) { server.handler = fn; return { threadId: null, fn: fn }; };
    server.removeHandler = function() {};
    server.notify = function() {};
    server.respond = function() {};
    server.send = function(method, params) {
      server.calls.push({ method: method, params: params });
      if (method === "thread/resume") return Promise.resolve({ thread: { id: "saved-thread" } });
      if (method === "thread/start") return Promise.resolve({ thread: { id: "fresh-thread" } });
      return Promise.resolve({ data: [] });
    };
    servers.push(server);
    return server;
  }
  var adapter = codexModule.createCodexAdapter({
    cwd: process.cwd(), createAppServer: fakeServer,
    adapterOptions: { CODEX: { config: { mcp_servers: {
      "external-server": { command: "external-mcp", args: ["--preserve"] },
    } } } },
  });
  await adapter.init({});
  await Promise.resolve();
  var handle = await adapter.createQuery({
    cwd: process.cwd(), resumeSessionId: "saved-thread", model: "gpt-test",
    sessionMcpServer: { name: "clay-session-tools", command: process.execPath, args: ["bridge.js", "--session", "7", "--query-generation", "3"] },
  });
  handle.pushMessage("Continue");
  await new Promise(function(resolve) { setImmediate(resolve); });
  assert.equal(servers.length, 2, "recovery starts a second, isolated app-server only after releasing the shared one");
  assert.equal(servers[0].stopped, 1, "the idle shared runtime is released before resume");
  assert.equal(servers[0].calls.some(function(call) { return call.method === "thread/resume"; }), false);
  assert.deepEqual(servers[1].options.config.mcp_servers["external-server"], { command: "external-mcp", args: ["--preserve"] }, "configured external MCP servers survive recovery initialization");
  assert.ok(servers[1].options.config.mcp_servers["clay-tools"], "the regular Clay bridge survives recovery initialization");
  assert.deepEqual(servers[1].options.config.mcp_servers["clay-session-tools"], {
    command: process.execPath, args: ["bridge.js", "--session", "7", "--query-generation", "3"], env: {},
  }, "the exact recovery bridge is added alongside existing servers");
  assert.equal(servers[1].calls.some(function(call) { return call.method === "thread/resume" && call.params.config; }), false, "isolated resume does not replace its initialized MCP server map");
  handle.abort();
  await new Promise(function(resolve) { setImmediate(resolve); });
  assert.equal(servers[1].stopped, 1, "the isolated recovery runtime is reaped after abort");
});

test("Codex waits for isolated recovery cleanup before resuming the same thread again", async function () {
  var EventEmitter = require("node:events").EventEmitter;
  var servers = [];
  function fakeServer() {
    var isRecoveryRuntime = servers.length > 0;
    var server = { started: false, stopped: 0, calls: [], handler: null };
    if (isRecoveryRuntime) {
      server.proc = new EventEmitter();
      server.proc.exitCode = null;
      server.proc.signalCode = null;
      server.proc.kill = function() {};
    }
    server.start = function() { server.started = true; return Promise.resolve(); };
    server.stop = function() {
      server.stopped++;
      server.started = false;
      if (server.proc) {
        setTimeout(function() {
          server.proc.exitCode = 0;
          server.proc.emit("exit");
        }, 30);
      }
    };
    server.addHandler = function(fn) { server.handler = fn; return { threadId: null, fn: fn }; };
    server.removeHandler = function() {}; server.notify = function() {}; server.respond = function() {};
    server.send = function(method, params) {
      server.calls.push({ method: method, params: params });
      if (method === "thread/resume") return Promise.resolve({ thread: { id: "saved-thread" } });
      return Promise.resolve({ data: [] });
    };
    servers.push(server);
    return server;
  }
  var adapter = codexModule.createCodexAdapter({ cwd: process.cwd(), createAppServer: fakeServer });
  await adapter.init({});
  var first = await adapter.createQuery({
    cwd: process.cwd(), resumeSessionId: "saved-thread", model: "gpt-test",
    sessionMcpServer: { name: "clay-session-tools", command: process.execPath, args: ["bridge.js"] },
  });
  first.abort();
  var secondPromise = adapter.createQuery({
    cwd: process.cwd(), resumeSessionId: "saved-thread", model: "gpt-test",
    sessionMcpServer: { name: "clay-session-tools", command: process.execPath, args: ["bridge.js"] },
  });
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  assert.equal(servers.length, 2, "the next recovery does not start while the prior writer is still exiting");
  var second = await secondPromise;
  assert.equal(servers.length, 3, "the next recovery starts only after prior cleanup completes");
  second.abort();
  await adapter.shutdown();
  assert.equal(servers[2].stopped, 1, "parent shutdown awaits and reaps the retained recovery runtime once");
});

test("Codex refuses recovery while a shared-runtime sibling is active", async function () {
  var servers = [];
  function fakeServer() {
    var server = { started: false, stopped: 0, calls: [], handler: null };
    server.start = function() { server.started = true; return Promise.resolve(); };
    server.stop = function() { server.stopped++; server.started = false; };
    server.addHandler = function(fn) { server.handler = fn; return { threadId: null, fn: fn }; };
    server.removeHandler = function() {}; server.notify = function() {}; server.respond = function() {};
    server.send = function(method, params) {
      server.calls.push({ method: method, params: params });
      if (method === "thread/start") return Promise.resolve({ thread: { id: "fresh-thread" } });
      return Promise.resolve({ data: [] });
    };
    servers.push(server);
    return server;
  }
  var adapter = codexModule.createCodexAdapter({ cwd: process.cwd(), createAppServer: fakeServer });
  var fresh = await adapter.createQuery({ cwd: process.cwd(), model: "gpt-test" });
  fresh.pushMessage("Keep the shared runtime active");
  await new Promise(function(resolve) { setImmediate(resolve); });
  await assert.rejects(adapter.createQuery({
    cwd: process.cwd(), resumeSessionId: "saved-thread",
    sessionMcpServer: { name: "clay-session-tools", command: process.execPath, args: ["bridge.js"] },
  }), /active shared runtime/);
  assert.equal(servers.length, 1, "no isolated writer is started beside an active shared query");
  assert.equal(servers[0].stopped, 0, "the active sibling is never terminated for recovery");
  fresh.abort();
});

test("Codex reports that resumed query-bound tools depend on the persisted thread catalog", function () {
  var adapter = codexModule.createCodexAdapter({ cwd: process.cwd() });
  assert.deepStrictEqual(adapter.queryBoundToolCapability, {
    mode: "dynamic",
    resume: "session-mcp-recovery",
  });
});

test("Codex context accounting separates verified last-turn input from cumulative and cache totals", async function () {
  var kit = codexModule.contractTestKit;
  var state = kit.createEventState("gpt-test");
  kit.normalizeEvent({ method: "thread/tokenUsage/updated", params: {
    tokenUsage: { lastTurn: { inputTokens: 100, cachedInputTokens: 900, outputTokens: 5 }, total: { inputTokens: 99999 }, modelContextWindow: 1000 },
  } }, state);
  assert.equal(state.lastInputTokens, 100);
  assert.deepEqual(state.currentContextUsage, { input_tokens: 100, contextWindow: 1000 });

  kit.normalizeEvent({ method: "thread/tokenUsage/updated", params: {
    tokenUsage: { total: { inputTokens: 99999 }, modelContextWindow: 1000 },
  } }, state);
  assert.equal(state.lastInputTokens, null, "a total-only update clears stale turn usage");
  assert.equal(state.currentContextUsage, null);

  kit.normalizeEvent({ method: "thread/tokenUsage/updated", params: {
    tokenUsage: { lastTurn: { inputTokens: 5000 }, modelContextWindow: 1000 },
  } }, state);
  assert.equal(state.lastInputTokens, null, "an impossible snapshot is not trusted");
  assert.equal(state.currentContextUsage, null, "an impossible snapshot hides current context");
});

test("Codex requires a valid current-turn window and preserves zero occupancy", function () {
  var kit = codexModule.contractTestKit;
  var state = kit.createEventState("gpt-test");
  kit.normalizeEvent({ method: "turn/started", params: {} }, state);
  kit.normalizeEvent({ method: "thread/tokenUsage/updated", params: {
    tokenUsage: { lastTurn: { inputTokens: 0 }, modelContextWindow: 1000 },
  } }, state);
  assert.deepStrictEqual(state.currentContextUsage, { input_tokens: 0, contextWindow: 1000 });
  kit.normalizeEvent({ method: "turn/started", params: {} }, state);
  assert.equal(state.currentContextUsage, null, "a new turn cannot reuse the previous snapshot");
  kit.normalizeEvent({ method: "thread/tokenUsage/updated", params: {
    tokenUsage: { lastTurn: { inputTokens: 10 } },
  } }, state);
  assert.equal(state.currentContextUsage, null, "a snapshot without a valid window is unavailable");
});

test("Codex completion keeps billing usage separate from context occupancy", function () {
  var kit = codexModule.contractTestKit;
  var state = kit.createEventState("gpt-test");
  kit.normalizeEvent({ method: "thread/tokenUsage/updated", params: {
    tokenUsage: { lastTurn: { inputTokens: 100, cachedInputTokens: 900 }, modelContextWindow: 1000 },
  } }, state);
  var events = kit.normalizeEvent({ method: "turn/completed", params: {
    usage: { input_tokens: 739000, output_tokens: 12, cached_input_tokens: 258000 },
  } }, state);
  var result = events.filter(function (event) { return event.yokeType === "result"; })[0];
  assert.equal(result.usage.input_tokens, 739000, "generic accounting keeps reported billing usage");
  assert.equal(result.usage.cache_read_input_tokens, 258000);
  assert.equal(state.currentContextUsage.input_tokens, 100, "context occupancy stays on the verified snapshot");
  assert.deepStrictEqual(result.modelUsage["gpt-test"].contextSnapshot, {
    valid: true,
    inputTokens: 100,
    contextWindow: 1000,
  });
});

test("Codex completion falls back to snapshot accounting without reporting occupancy as billing", function () {
  var kit = codexModule.contractTestKit;
  var state = kit.createEventState("gpt-test");
  kit.normalizeEvent({ method: "thread/tokenUsage/updated", params: {
    tokenUsage: { lastTurn: { inputTokens: 42, cachedInputTokens: 7, outputTokens: 3 }, modelContextWindow: 1000 },
  } }, state);
  var events = kit.normalizeEvent({ method: "turn/completed", params: {} }, state);
  var result = events.filter(function (event) { return event.yokeType === "result"; })[0];
  assert.equal(result.usage.input_tokens, 42);
  assert.equal(result.usage.cache_read_input_tokens, 7);
  assert.equal(result.usage.output_tokens, 3);
  assert.equal(result.modelUsage["gpt-test"].contextSnapshot.valid, true);
});

test("Codex completion persists an invalid snapshot marker when occupancy is unavailable", function () {
  var kit = codexModule.contractTestKit;
  var state = kit.createEventState("gpt-test");
  var events = kit.normalizeEvent({ method: "turn/completed", params: {
    usage: { input_tokens: 739000, output_tokens: 1, cached_input_tokens: 258000 },
  } }, state);
  var result = events.filter(function (event) { return event.yokeType === "result"; })[0];
  assert.deepStrictEqual(result.modelUsage["gpt-test"].contextSnapshot, { valid: false });
});

test("Codex ignores token snapshots from a different current turn", function () {
  var kit = codexModule.contractTestKit;
  var state = kit.createEventState("gpt-test");
  kit.normalizeEvent({ method: "turn/started", params: { turnId: "turn-current" } }, state);
  kit.normalizeEvent({ method: "thread/tokenUsage/updated", params: {
    turnId: "turn-old", tokenUsage: { lastTurn: { inputTokens: 10 }, modelContextWindow: 1000 },
  } }, state);
  assert.equal(state.currentContextUsage, null);
  kit.normalizeEvent({ method: "thread/tokenUsage/updated", params: {
    turnId: "turn-current", tokenUsage: { lastTurn: { inputTokens: 0 }, modelContextWindow: 1000 },
  } }, state);
  assert.equal(state.currentContextUsage.input_tokens, 0);
  assert.equal(state.currentContextUsage.turnId, "turn-current");
});
