var test = require("node:test");
var assert = require("node:assert/strict");
var userInput = require("../lib/yoke/user-input");
var claudeUserInput = require("../lib/yoke/claude-user-input");
var codexUserInput = require("../lib/yoke/codex-user-input");
var createClaudeAdapter = require("../lib/yoke/adapters/claude").createClaudeAdapter;
var codexAdapterModule = require("../lib/yoke/adapters/codex");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

function choices(count) {
  var result = [];
  for (var i = 0; i < count; i++) result.push({ label: "Choice " + i, description: "Description " + i });
  return result;
}

test("Yoke normalizes freeform and 2-6 option questions and rejects ambiguous input", function () {
  assert.equal(userInput.normalizeQuestions({ questions: [{ id: "topic", question: "Topic?", options: [] }] })[0].options.length, 0);
  assert.equal(userInput.normalizeQuestions({ questions: [{ id: "format", question: "Format?", options: choices(2) }] })[0].options.length, 2);
  assert.equal(userInput.normalizeQuestions({ questions: [{ id: "format", question: "Format?", options: choices(6) }] })[0].options.length, 6);
  assert.throws(function () { userInput.normalizeQuestions({ questions: [{ question: "Only?", options: choices(1) }] }); }, /zero options or 2-6/);
  assert.throws(function () { userInput.normalizeQuestions({ questions: [{ id: "same", question: "A?" }, { id: "same", question: "B?" }] }); }, /unique/);
  assert.throws(function () { userInput.normalizeQuestions({ questions: [{ question: " ", options: [] }] }); }, /non-empty/);
});

test("Yoke responder submits exactly once and keeps concurrent requests distinct", async function () {
  var responders = {};
  var handler = function (request, respond) { responders[request.id] = respond; };
  var first = userInput.dispatchUserInput(handler, { questions: [{ id: "a", question: "A?", options: [] }] }, { requestId: "first" });
  var second = userInput.dispatchUserInput(handler, { questions: [{ id: "b", question: "B?", options: choices(2) }] }, { requestId: "second" });
  assert.equal(responders.first({ a: "one" }), true);
  assert.equal(responders.first({ a: "again" }), false);
  responders.second({ b: "Choice 1" });
  assert.deepEqual(await first, { status: "submitted", answers: { a: ["one"] } });
  assert.deepEqual(await second, { status: "submitted", answers: { b: ["Choice 1"] } });
});

test("Yoke cancellation, handler errors, and abort settle pending responders", async function () {
  var responder;
  var settled = null;
  var controller = new AbortController();
  var pending = userInput.dispatchUserInput(function (request, respond) {
    responder = respond;
    respond.onSettle(function (result) { settled = result; });
  }, { questions: [{ question: "Wait?", options: [] }] }, { signal: controller.signal });
  controller.abort();
  assert.equal((await pending).status, "cancelled");
  assert.equal(settled.reason, "Aborted");
  assert.equal(responder.isPending(), false);
  await assert.rejects(userInput.dispatchUserInput(function () { throw new Error("handler failed"); }, { questions: [{ question: "Fail?", options: [] }] }), /handler failed/);
});

test("Claude native AskUserQuestion maps canonical answers to the SDK payload", async function () {
  var input = { questions: [{ id: "topic", header: "Topic", question: "What topic?", options: [] }] };
  var result = await claudeUserInput.ask(function (request, respond) {
    assert.equal(request.source, "claude_ask_user_question");
    assert.equal(request.native, true);
    assert.equal(request.id, "tool-7");
    respond({ topic: "Housing" });
  }, input, { toolUseID: "tool-7" });
  assert.equal(result.behavior, "allow");
  assert.deepEqual(result.updatedInput.answers, { "What topic?": "Housing" });
});

test("Claude native elicitation maps through the same canonical responder", async function () {
  var result = await claudeUserInput.elicitation(function (request, respond) {
    assert.equal(request.source, "claude_elicitation");
    assert.equal(request.id, "elicit-2");
    assert.equal(request.presentation, "elicitation");
    respond.submitContent({ choice: "B", confirmed: true, count: 2 });
  }, {
    serverName: "Example", message: "Choose", elicitationId: "elicit-2",
    requestedSchema: { type: "object", properties: { choice: { description: "Which?", enum: ["A", "B"] } } },
  });
  assert.deepEqual(result, { action: "accept", content: { choice: "B", confirmed: true, count: 2 } });
});

test("Claude adapter installs the real native callbacks and fallback mode omits them", async function () {
  var captures = [];
  var sdk = {
    query: function (args) {
      captures.push(args.options);
      return {
        close: function () {},
        setPermissionMode: function () {},
        [Symbol.asyncIterator]: async function* () {},
      };
    },
  };
  var adapter = createClaudeAdapter({ cwd: process.cwd(), loadSDK: function () { return Promise.resolve(sdk); } });
  var handler = function (request, respond) { respond({ topic: "Housing" }); };
  var nativeHandle = await adapter.createQuery({ onUserInputRequest: handler, userInputMode: "native" });
  assert.equal(typeof captures[0].canUseTool, "function");
  assert.equal(typeof captures[0].onElicitation, "function");
  var result = await captures[0].canUseTool("AskUserQuestion", { questions: [{ id: "topic", question: "Topic?", options: [] }] }, { toolUseID: "claude-native" });
  assert.equal(result.updatedInput.answers["Topic?"], "Housing");
  nativeHandle.close();
  var fallbackHandle = await adapter.createQuery({ onUserInputRequest: handler, userInputMode: "fallback" });
  assert.equal(captures[1].canUseTool, undefined);
  assert.equal(captures[1].onElicitation, undefined);
  fallbackHandle.close();
});

test("Claude in-process queries receive the resolved process environment", async function () {
  var captured = null;
  var sdk = {
    query: function(args) {
      captured = args.options;
      return { close: function() {}, [Symbol.asyncIterator]: async function* () {} };
    },
  };
  var adapter = createClaudeAdapter({ cwd: process.cwd(), loadSDK: function() { return Promise.resolve(sdk); } });
  var handle = await adapter.createQuery({ env: { PROJECT_TOKEN: "scoped" } });
  assert.deepEqual(captured.env, { PROJECT_TOKEN: "scoped" });
  handle.close();
});

test("Claude OS-user worker query options receive the resolved environment", function () {
  var kit = require("../lib/yoke/adapters/claude").contractTestKit;
  var options = kit.buildWorkerQueryOptions({
    env: { PROJECT_TOKEN: "scoped" },
    resumeSessionId: "resume-1",
  }, {
    settingSources: ["user"],
    originalHome: null,
  }, "/workspace");
  assert.deepEqual(options.env, { PROJECT_TOKEN: "scoped" });
  assert.strictEqual(options.resume, "resume-1");
});

test("Codex 0.147 requestUserInput maps the exact thread and response payload", async function () {
  var responses = [];
  var errors = [];
  var appServer = {
    respond: function (id, payload) { responses.push({ id: id, payload: payload }); },
    respondError: function (id, code, message) { errors.push({ id: id, code: code, message: message }); },
  };
  var message = { id: 41, params: { threadId: "thread-a", turnId: "turn-a", itemId: "item-a", questions: [{ id: "format", header: "Format", question: "Which?", isOther: true, options: choices(2) }] } };
  codexUserInput.handleNative(appServer, message, function (request, respond) {
    assert.equal(request.id, "item-a");
    assert.equal(request.diagnostics.threadId, "thread-a");
    respond({ format: "Choice 1" });
  }, "thread-a");
  await Promise.resolve();
  assert.deepEqual(responses, [{ id: 41, payload: { answers: { format: { answers: ["Choice 1"] } } } }]);
  codexUserInput.handleNative(appServer, message, function () {}, "other-thread");
  assert.equal(errors[0].code, -32001);
});

test("Codex query handle routes requestUserInput on its exact app-server thread", async function () {
  var handlerEntry = null;
  var responses = [];
  var server = {
    started: true,
    addHandler: function (fn) { handlerEntry = { threadId: null, fn: fn }; return handlerEntry; },
    removeHandler: function () {},
    respond: function (id, payload) { responses.push({ id: id, payload: payload }); },
    respondError: function (id, code, message) { assert.fail(code + ": " + message); },
    send: function (method) {
      if (method === "thread/start") return Promise.resolve({ thread: { id: "thread-native" } });
      if (method === "turn/start") {
        setImmediate(function () {
          handlerEntry.fn({ id: 88, method: "item/tool/requestUserInput", params: {
            threadId: "thread-native", turnId: "turn-native", itemId: "item-native",
            questions: [{ id: "topic", header: "Topic", question: "What topic?", isOther: true, options: null }],
          } });
          setImmediate(function () { handlerEntry.fn({ method: "turn/completed", params: { threadId: "thread-native" } }); });
        });
        return Promise.resolve({});
      }
      return Promise.resolve({});
    },
  };
  var seen = null;
  var handle = codexAdapterModule.contractTestKit.createQueryHandle(server, {
    cwd: process.cwd(), model: "gpt-test", abortController: new AbortController(),
    onUserInputRequest: function (request, respond) { seen = request; respond({ topic: "Housing" }); },
  });
  handle.pushMessage("Ask once");
  for await (var event of handle) {
    if (event.yokeType === "result") break;
  }
  handle.close();
  assert.equal(seen.id, "item-native");
  assert.equal(seen.diagnostics.threadId, "thread-native");
  assert.deepEqual(responses, [{ id: 88, payload: { answers: { topic: { answers: ["Housing"] } } } }]);
});

test("capability selection chooses one native or fallback path truthfully", function () {
  var nativeAdapter = { userInputCapability: { mode: "native", native: true }, createToolServer: function (definition) { return definition; } };
  var legacyAdapter = { createToolServer: function (definition) { return definition; } };
  assert.equal(userInput.selectMode(nativeAdapter, "auto"), "native");
  assert.equal(userInput.selectMode(nativeAdapter, "fallback"), "fallback");
  assert.equal(userInput.selectMode(legacyAdapter, "auto"), "fallback");
  assert.equal(userInput.createFallbackServer(nativeAdapter, function () {}), null);
  assert.equal(userInput.createFallbackServer(nativeAdapter, function () {}, { force: true }).name, "yoke-user-input");
  assert.equal(userInput.createFallbackServer(legacyAdapter, function () {}).name, "yoke-user-input");
  assert.equal(createClaudeAdapter({ cwd: process.cwd() }).userInputCapability.transport, "AskUserQuestion/onElicitation");
  assert.equal(codexAdapterModule.createCodexAdapter({ cwd: process.cwd() }).userInputCapability.transport, "item/tool/requestUserInput");
});

test("Clay auto-approves every exact Yoke structured-input transport name", function () {
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {},
    adapter: {},
    send: function () {},
  });
  var names = [
    "ask_user_questions",
    "mcp__yoke-user-input__ask_user_questions",
    "mcp__clay-ask-user__ask_user_questions",
  ];
  for (var i = 0; i < names.length; i++) {
    assert.equal(bridge.checkToolWhitelist(names[i], {}).behavior, "allow");
  }
  assert.equal(bridge.checkToolWhitelist("ask_user_questions_extra", {}), null);
});

test("schedule interviews reject bundled fallback questions without restricting ordinary flows", async function () {
  var calls = 0;
  function answer(request, respond) { calls += 1; respond({ question_1: "First", question_2: "Second" }); }
  var scheduleTool = userInput.fallbackToolDefs(answer, { maxQuestions: 1 })[0];
  var bundled = await scheduleTool.handler({ questions: [{ question: "What?" }, { question: "When?" }] });
  assert.equal(bundled.isError, true);
  assert.match(bundled.content[0].text, /exactly one question at a time/);
  assert.equal(calls, 0);
  var ordinaryTool = userInput.fallbackToolDefs(answer)[0];
  var ordinary = await ordinaryTool.handler({ questions: [{ question: "What?" }, { question: "When?" }] });
  assert.equal(ordinary.isError, undefined);
  assert.equal(calls, 1);
});
