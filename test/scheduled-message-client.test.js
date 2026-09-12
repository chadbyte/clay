var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

function loadFunctions() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/scheduled-message-state.js"), "utf8");
  var state = {};
  var sandbox = {
    exported: null,
    store: {
      get: function (key) { return state[key]; },
      set: function (partial) { Object.assign(state, partial); },
    },
  };
  source = source.replace(/^import .*;$/m, "").replace(/export function/g, "function");
  vm.runInNewContext(source + "\nexported = { apply: applyScheduledMessageState, queued: applyScheduledMessageQueued, terminal: applyScheduledMessageTerminal, control: scheduledMessageControl };", sandbox);
  return sandbox.exported;
}

test("authoritative scheduled state clears replayed history and restores only a pending job", function () {
  var apply = loadFunctions().apply;
  var calls = [];
  var actions = {
    remove: function () { calls.push("remove"); },
    setDisabled: function (value) { calls.push("disabled:" + value); },
    add: function (text, runAt, correlation) { calls.push("add:" + text + ":" + runAt + ":" + correlation.jobId); },
    interrupted: function (value) { calls.push("interrupted:" + value.jobId); },
  };
  assert.strictEqual(apply({ scheduledMessage: null }, actions), false);
  assert.deepStrictEqual(calls, ["remove", "disabled:false"]);
  calls.length = 0;
  assert.strictEqual(apply({ scheduledMessage: null, interrupted: { jobId: "job-1" } }, actions), false);
  assert.deepStrictEqual(calls, ["remove", "disabled:false", "interrupted:job-1"]);
  calls.length = 0;
  assert.strictEqual(apply({ scheduledMessage: { text: "continue", resetsAt: 1234, jobId: "job-2" } }, actions), true);
  assert.deepStrictEqual(calls, ["remove", "disabled:false", "add:continue:1234:job-2", "disabled:true"]);
});

test("scheduled controls carry exact durable job and revision correlation", function () {
  var control = loadFunctions().control;
  var correlated = JSON.parse(JSON.stringify(control("send_scheduled_now", { jobId: "job-1", revision: "rev-2" })));
  assert.deepStrictEqual(correlated, {
    type: "send_scheduled_now", jobId: "job-1", revision: "rev-2",
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(control("cancel_scheduled_message", null))), { type: "cancel_scheduled_message" });
});

test("an older sent or cancelled event cannot remove a queued successor", function () {
  var terminalTypes = ["scheduled_message_sent", "scheduled_message_cancelled"];
  for (var i = 0; i < terminalTypes.length; i++) {
    var functions = loadFunctions();
    var calls = [];
    var actions = {
      add: function (text) { calls.push("add:" + text); },
      remove: function () { calls.push("remove"); },
      setDisabled: function (value) { calls.push("disabled:" + value); },
    };
    functions.queued({ type: "scheduled_message_queued", text: "first", resetsAt: 1, jobId: "old", revision: "r1" }, actions);
    functions.queued({ type: "scheduled_message_queued", text: "successor", resetsAt: 2, jobId: "next", revision: "r2" }, actions);
    calls.length = 0;
    assert.strictEqual(functions.terminal({ type: terminalTypes[i], jobId: "old", revision: "r1" }, actions), false);
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(functions.terminal({ type: terminalTypes[i], jobId: "next", revision: "r2" }, actions), true);
    assert.deepStrictEqual(calls, ["remove", "disabled:false"]);
  }
});
