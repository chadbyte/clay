var test = require("node:test");
var assert = require("node:assert/strict");
var kit = require("../lib/yoke/adapters/claude").contractTestKit;
var createCorrelation = require("../lib/yoke/claude-message-correlation").createCorrelation;

["direct", "worker"].forEach(function(mode) {
  test(mode + " query correlates merged replies and leaves later input pending", async function() {
    var sent = [];
    var emit;
    var handle;
    if (mode === "direct") {
      var events = [];
      handle = kit.createQueryHandle({
        [Symbol.asyncIterator]: function() {
          return { next: function() { return Promise.resolve({ value: events.shift(), done: false }); } };
        },
      }, { push: function(message) { sent.push(message); return true; } }, {});
      emit = function(event) { events.push(event); };
    } else {
      var receive;
      handle = kit.createWorkerQueryHandle({
        process: { killed: false, exitCode: null },
        onMessage: function(callback) { receive = callback; },
        onExit: function() {},
        send: function(message) { sent.push(message.content); return true; },
      });
      emit = function(event) { receive({ type: "sdk_event", event: event }); };
    }
    var iterator = handle[Symbol.asyncIterator]();
    assert.equal(handle.pushMessage("first"), true);
    assert.equal(handle.pushMessage("second"), true);
    assert.equal(handle.pushMessage("third"), true);
    assert.equal(new Set(sent.map(function(message) { return message.uuid; })).size, 3);
    emit({ type: "result", user_message_uuid: sent[0].uuid,
      user_message_uuids: [sent[0].uuid, sent[1].uuid, sent[1].uuid], result_index: 0 });
    var result = (await iterator.next()).value;
    assert.equal(result.answeredUserMessageCount, 2);
    assert.equal(result.resultIndex, 0);
    assert.deepEqual(result.userMessageIds, [sent[0].uuid, sent[1].uuid, sent[1].uuid]);
    emit({ type: "result", user_message_uuid: sent[2].uuid, resume_reason: "interrupted" });
    result = (await iterator.next()).value;
    assert.equal(result.answeredUserMessageCount, 1);
    assert.equal(result.resumeReason, "interrupted");
  });
});

test("correlation keeps older provider results compatible", function() {
  var tracker = createCorrelation();
  var first = tracker.message([]);
  var second = tracker.message([]);
  tracker.accepted(first);
  tracker.accepted(second);
  assert.deepEqual(tracker.result({ type: "result" }, {}), { submittedMessageCount: 2 });
  assert.equal(tracker.result({ type: "result", user_message_uuid: second.uuid }, {}).answeredUserMessageCount, 1);
});

test("message correlation metadata survives streaming and complete replies", function() {
  [
    { type: "stream_event", event: { type: "message_start" } },
    { type: "assistant", message: { content: [] } },
  ].forEach(function(raw) {
    raw.user_message_uuid = "first";
    raw.user_message_uuids = ["first", "second"];
    var event = kit.normalizeEvent(raw);
    assert.equal(event.userMessageId, "first");
    assert.deepEqual(event.userMessageIds, ["first", "second"]);
  });
});
