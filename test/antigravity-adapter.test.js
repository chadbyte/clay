var test = require("node:test");
var assert = require("node:assert");
var EventEmitter = require("node:events");
var PassThrough = require("node:stream").PassThrough;

var antigravity = require("../lib/yoke/adapters/antigravity");

function createFakeSpawn(calls) {
  return function(binary, args, options) {
    var proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = new EventEmitter();
    proc.stdin.write = function(line) {
      calls.push({ input: JSON.parse(line) });
      setImmediate(function() {
        proc.stdout.write(JSON.stringify({ event: "init", conversation_id: "agy-session" }) + "\n");
        proc.stdout.write(JSON.stringify({
          event: "step_update",
          step_update: { step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "hello" },
        }) + "\n");
        proc.stdout.write(JSON.stringify({
          event: "step_update",
          step_update: {
            step_index: 2,
            state: "DONE",
            step_type: "tool",
            tool_name: "run_command",
            tool_info: { name: "run_command", parameters: { CommandLine: "pwd" }, output: "/project\n" },
          },
        }) + "\n");
        proc.stdout.write(JSON.stringify({
          event: "result",
          result: {
            conversation_id: "agy-session",
            status: "SUCCESS",
            duration_seconds: 1.5,
            usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 4 },
          },
        }) + "\n");
      });
      return true;
    };
    proc.stdin.end = function() {
      setImmediate(function() { proc.emit("exit", 0, null); });
    };
    proc.kill = function() { proc.emit("exit", null, "SIGINT"); };
    calls.push({ binary: binary, args: args, options: options });
    return proc;
  };
}

test("Antigravity model parser accepts official JSON and text listings", function() {
  assert.deepStrictEqual(antigravity.parseModels(JSON.stringify({
    models: [{ id: "gemini-pro" }, { slug: "gemini-flash" }],
  })), ["gemini-pro", "gemini-flash"]);
  assert.deepStrictEqual(antigravity.parseModels("gemini-pro  Gemini Pro\ngemini-flash  Gemini Flash\n"), ["gemini-pro", "gemini-flash"]);
});

test("Antigravity adapter uses the official streaming CLI protocol", async function() {
  var calls = [];
  var adapter = antigravity.createAntigravityAdapter({
    cwd: "/project",
    _binaryPath: "/contract/agy",
    _fetchModels: function() { return Promise.resolve(["gemini-pro"]); },
    _spawn: createFakeSpawn(calls),
  });
  var ready = await adapter.init();
  assert.deepStrictEqual(ready.models, ["gemini-pro"]);
  assert.strictEqual(ready.capabilities.sessionResume, true);
  assert.strictEqual(ready.capabilities.effort, true);
  assert.deepStrictEqual(ready.capabilities.queryBoundTools, {
    mode: "none",
    reason: "The current Clay adapter does not forward custom-tool configuration to agy.",
  });
  assert.strictEqual(adapter.createToolServer({ tools: [] }), null);

  var handle = await adapter.createQuery({
    cwd: "/project",
    model: "gemini-pro",
    effort: "high",
    resumeSessionId: "previous-session",
    systemPrompt: "Project instructions",
    env: { PROJECT_TOKEN: "scoped" },
    dynamicTools: [{ name: "probe" }],
    toolServers: { probe: { command: "probe" } },
    adapterOptions: { ANTIGRAVITY: { dangerouslySkipPermissions: true } },
  });
  assert.strictEqual(handle.pushMessage("Say hello"), true);
  handle.endInput();
  var events = [];
  for await (var event of handle) events.push(event);

  assert.deepStrictEqual(calls[0].args, [
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--conversation", "previous-session",
    "--model", "gemini-pro",
    "--effort", "high",
    "--dangerously-skip-permissions",
  ]);
  assert.strictEqual(calls[1].input.message.content, "Project instructions\n\nSay hello");
  assert.strictEqual(calls[0].options.env.PROJECT_TOKEN, "scoped");
  assert.ok(events.some(function(event) { return event.yokeType === "text_delta" && event.text === "hello"; }));
  assert.ok(events.some(function(event) { return event.yokeType === "tool_start" && event.toolName === "Bash"; }));
  assert.ok(events.some(function(event) { return event.yokeType === "tool_result" && event.content === "/project\n"; }));
  assert.ok(events.some(function(event) { return event.yokeType === "result" && event.sessionId === "agy-session"; }));
  await adapter.shutdown();
});

test("Antigravity reports per-turn usage from cumulative stream results", async function() {
  var turn = 0;
  function fakeSpawn() {
    var proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = new EventEmitter();
    proc.stdin.write = function() {
      turn++;
      var current = turn;
      setImmediate(function() {
        proc.stdout.write(JSON.stringify({ event: "step_update", step_update: {
          step_index: current, state: "DONE", step_type: "agent_response", text_delta: current === 1 ? "one" : "two",
          usage: current === 1
            ? { input_tokens: 10, output_tokens: 2, cache_read_tokens: 1 }
            : { input_tokens: 4, output_tokens: 3, cache_read_tokens: 0 },
          duration_seconds: current === 1 ? 1.25 : 0.75,
        } }) + "\n");
        proc.stdout.write(JSON.stringify({ event: "result", result: {
          status: "SUCCESS", conversation_id: "multi",
          usage: current === 1
            ? { input_tokens: 10, output_tokens: 2, cache_read_tokens: 1 }
            : { input_tokens: 14, output_tokens: 5, cache_read_tokens: 1 },
          duration_seconds: current === 1 ? 1.25 : 2,
        } }) + "\n");
      });
      return true;
    };
    proc.stdin.end = function() { setImmediate(function() { proc.emit("exit", 0, null); }); };
    proc.kill = function() { proc.emit("exit", null, "SIGINT"); };
    return proc;
  }
  var handle = antigravity.createAntigravityQueryHandle("/contract/agy", { cwd: "/project", _spawn: fakeSpawn }, function() {});
  handle.pushMessage("first");
  var results = [];
  for await (var firstEvent of handle) {
    if (firstEvent.yokeType === "result") { results.push(firstEvent); break; }
  }
  handle.pushMessage("second");
  handle.endInput();
  for await (var laterEvent of handle) {
    if (laterEvent.yokeType === "result") results.push(laterEvent);
  }
  assert.deepStrictEqual(results.map(function(result) { return result.usage; }), [{
    input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 1, cache_creation_input_tokens: 0,
  }, {
    input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  }]);
  assert.deepStrictEqual(results.map(function(result) { return result.duration; }), [1250, 750]);
  assert.deepStrictEqual(await handle.getContextUsage(), { input_tokens: 15, contextWindow: null });
});

test("Antigravity sums completed step usage for the first resumed turn", async function() {
  function fakeSpawn() {
    var proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = new EventEmitter();
    proc.stdin.write = function() {
      setImmediate(function() {
        var response = { event: "step_update", step_update: {
          step_index: 1, state: "DONE", step_type: "agent_response", text_delta: "done",
          usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 1 }, duration_seconds: 1,
        } };
        proc.stdout.write(JSON.stringify(response) + "\n");
        proc.stdout.write(JSON.stringify(response) + "\n");
        proc.stdout.write(JSON.stringify({ event: "step_update", step_update: {
          step_index: 2, state: "DONE", step_type: "checkpoint",
          usage: { input_tokens: 3, output_tokens: 1, cache_read_tokens: 2 }, duration_seconds: 0.25,
        } }) + "\n");
        proc.stdout.write(JSON.stringify({ event: "result", result: {
          status: "SUCCESS", conversation_id: "resumed",
          duration_seconds: 10.25,
        } }) + "\n");
      });
      return true;
    };
    proc.stdin.end = function() { setImmediate(function() { proc.emit("exit", 0, null); }); };
    proc.kill = function() { proc.emit("exit", null, "SIGINT"); };
    return proc;
  }
  var handle = antigravity.createAntigravityQueryHandle("/contract/agy", {
    cwd: "/project", resumeSessionId: "existing", _spawn: fakeSpawn,
  }, function() {});
  handle.pushMessage("continue");
  handle.endInput();
  var result = null;
  for await (var event of handle) if (event.yokeType === "result") result = event;
  assert.deepStrictEqual(result.usage, {
    input_tokens: 13, output_tokens: 3, cache_read_input_tokens: 3, cache_creation_input_tokens: 0,
  });
  assert.strictEqual(result.duration, 1250);
});

test("Antigravity leaves an unmeasurable resumed first turn unknown and baselines the next", async function() {
  var turn = 0;
  function fakeSpawn() {
    var proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = new EventEmitter();
    proc.stdin.write = function() {
      turn++;
      var current = turn;
      setImmediate(function() {
        proc.stdout.write(JSON.stringify({ event: "result", result: {
          status: "SUCCESS", conversation_id: "resumed",
          usage: current === 1
            ? { input_tokens: 100, output_tokens: 50, cache_read_tokens: 20 }
            : { input_tokens: 104, output_tokens: 53, cache_read_tokens: 21 },
          duration_seconds: current === 1 ? 10 : 10.75,
        } }) + "\n");
      });
      return true;
    };
    proc.stdin.end = function() { setImmediate(function() { proc.emit("exit", 0, null); }); };
    proc.kill = function() { proc.emit("exit", null, "SIGINT"); };
    return proc;
  }
  var handle = antigravity.createAntigravityQueryHandle("/contract/agy", {
    cwd: "/project", resumeSessionId: "existing", _spawn: fakeSpawn,
  }, function() {});
  handle.pushMessage("first resumed turn");
  var results = [];
  for await (var firstEvent of handle) {
    if (firstEvent.yokeType === "result") { results.push(firstEvent); break; }
  }
  handle.pushMessage("second resumed turn");
  handle.endInput();
  for await (var laterEvent of handle) if (laterEvent.yokeType === "result") results.push(laterEvent);
  assert.strictEqual(results[0].usage, null);
  assert.strictEqual(results[0].duration, null);
  assert.deepStrictEqual(results[1].usage, {
    input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1, cache_creation_input_tokens: 0,
  });
  assert.strictEqual(results[1].duration, 750);
  assert.deepStrictEqual(await handle.getContextUsage(), { input_tokens: 125, contextWindow: null });
});
