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
  assert.deepEqual(state.currentContextUsage, { input_tokens: null, contextWindow: 1000 });
});
