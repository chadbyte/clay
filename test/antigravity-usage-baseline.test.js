var test = require("node:test");
var assert = require("node:assert/strict");
var EventEmitter = require("events");
var PassThrough = require("stream").PassThrough;
var antigravity = require("../lib/yoke/adapters/antigravity");

// turns[i] = { status, usage, duration, steps: [{ usage, duration }] }
function scriptedSpawn(turns) {
  var turn = 0;
  return function () {
    var proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = new EventEmitter();
    proc.stdin.write = function () {
      var spec = turns[turn++];
      setImmediate(function () {
        (spec.steps || []).forEach(function (step, index) {
          proc.stdout.write(JSON.stringify({ event: "step_update", step_update: {
            step_index: index, state: "DONE", step_type: "agent_response", text_delta: "t" + turn,
            usage: step.usage, duration_seconds: step.duration,
          } }) + "\n");
        });
        var result = { status: spec.status || "SUCCESS", conversation_id: "conv" };
        if (spec.usage) result.usage = spec.usage;
        if (typeof spec.duration === "number") result.duration_seconds = spec.duration;
        proc.stdout.write(JSON.stringify({ event: "result", result: result }) + "\n");
      });
      return true;
    };
    proc.stdin.end = function () { setImmediate(function () { proc.emit("exit", 0, null); }); };
    proc.kill = function () { proc.emit("exit", null, "SIGINT"); };
    return proc;
  };
}

function usage(input, output, cache) {
  return { input_tokens: input, output_tokens: output, cache_read_tokens: cache || 0 };
}

async function runTurns(turns, opts) {
  var handle = antigravity.createAntigravityQueryHandle("/contract/agy", Object.assign({ cwd: "/project", _spawn: scriptedSpawn(turns) }, opts || {}), function () {});
  var iterator = handle[Symbol.asyncIterator]();
  var results = [];
  for (var i = 0; i < turns.length; i++) {
    handle.pushMessage("turn " + (i + 1));
    if (i === turns.length - 1) handle.endInput();
    for (;;) {
      var next = await iterator.next();
      if (next.done) break;
      if (next.value.yokeType === "result") {
        results.push({
          usage: next.value.usage ? [next.value.usage.input_tokens, next.value.usage.output_tokens, next.value.usage.cache_read_input_tokens] : null,
          duration: next.value.duration,
        });
        break;
      }
    }
  }
  return results;
}

test("a turn without counters falls back to step totals and the next result re-baselines", async function () {
  var results = await runTurns([
    { status: "CANCELED", steps: [{ usage: usage(10, 2), duration: 1 }] },
    { usage: usage(14, 5), duration: 3, steps: [{ usage: usage(4, 3), duration: 0.5 }] },
    { usage: usage(20, 9), duration: 4.5 },
  ]);
  assert.deepEqual(results, [
    { usage: [10, 2, 0], duration: 1000 },
    { usage: [4, 3, 0], duration: 500 },
    { usage: [6, 4, 0], duration: 1500 },
  ]);
});

test("intermediate missing counters report unknown instead of historical totals", async function () {
  var results = await runTurns([
    { usage: usage(10, 2, 1), duration: 2 },
    { status: "ERROR" },
    { usage: usage(30, 10, 4), duration: 9 },
    { usage: usage(33, 12, 4), duration: 10 },
  ]);
  assert.deepEqual(results, [
    { usage: [10, 2, 1], duration: 2000 },
    { usage: null, duration: null },
    { usage: null, duration: null },
    { usage: [3, 2, 0], duration: 1000 },
  ]);
});

test("error and cancelled turns with counters keep a trusted baseline", async function () {
  var results = await runTurns([
    { usage: usage(10, 2), duration: 1 },
    { status: "ERROR", usage: usage(12, 3), duration: 1.5 },
    { status: "CANCELED", usage: usage(15, 5), duration: 2 },
    { usage: usage(16, 7), duration: 2.25 },
  ]);
  assert.deepEqual(results.map(function (r) { return r.usage; }), [[10, 2, 0], [2, 1, 0], [3, 2, 0], [1, 2, 0]]);
  assert.deepEqual(results.map(function (r) { return r.duration; }), [1000, 500, 500, 250]);
});

test("counters that go backwards are not trusted as a baseline", async function () {
  var results = await runTurns([
    { usage: usage(50, 20), duration: 5 },
    { usage: usage(8, 3), duration: 1, steps: [{ usage: usage(8, 3), duration: 1 }] },
    { usage: usage(9, 3), duration: 0.5 },
    { usage: usage(12, 6), duration: 2 },
  ]);
  assert.deepEqual(results, [
    { usage: [50, 20, 0], duration: 5000 },
    { usage: [8, 3, 0], duration: 1000 },
    { usage: [1, 0, 0], duration: null },
    { usage: [3, 3, 0], duration: 1500 },
  ]);
});

test("a resumed conversation starts unknown, uses step totals when present, and recovers", async function () {
  var unknown = await runTurns([
    { usage: usage(100, 50, 20), duration: 10 },
    { status: "CANCELED" },
    { usage: usage(110, 55, 21), duration: 12 },
    { usage: usage(111, 57, 21), duration: 12.5 },
  ], { resumeSessionId: "conv" });
  assert.deepEqual(unknown, [
    { usage: null, duration: null },
    { usage: null, duration: null },
    { usage: null, duration: null },
    { usage: [1, 2, 0], duration: 500 },
  ]);
  var measured = await runTurns([
    { usage: usage(100, 50), duration: 10, steps: [{ usage: usage(3, 1), duration: 0.25 }, { usage: usage(2, 1), duration: 0.5 }] },
    { usage: usage(104, 53), duration: 11 },
  ], { resumeSessionId: "conv" });
  assert.deepEqual(measured, [
    { usage: [5, 2, 0], duration: 750 },
    { usage: [4, 3, 0], duration: 1000 },
  ]);
});
