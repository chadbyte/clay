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
