var test = require("node:test");
var assert = require("node:assert/strict");
var kit = require("../lib/yoke/adapters/codex").contractTestKit;
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;

function snapshot(primary, secondary, limitId) {
  return kit.normalizeEvent({ method: "account/rateLimits/updated", params: {
    rateLimits: { primary: primary, secondary: secondary, limitId: limitId },
  } }, kit.createEventState())[0];
}

test("Codex keeps actual quota durations and never infers request rejection", function () {
  [10080, 300, 15, 90, null, undefined].forEach(function (duration) {
    var event = snapshot({ usedPercent: 100, windowDurationMins: duration, resetsAt: 1900000000 });
    assert.equal(event.yokeType, "rate_limit");
    assert.equal(event.rateLimitInfo.source, "account_snapshot");
    assert.equal(event.rateLimitInfo.status, undefined);
    assert.equal(event.rateLimitInfo.windows[0].windowDurationMins, duration || null);
    assert.equal(event.rateLimitInfo.windows[0].usedPercent, 100);
    assert.equal(event.rateLimitInfo.windows[0].resetsAt, 1900000000);
  });
});

test("Codex snapshots explicitly clear missing and disabled windows", function () {
  assert.deepEqual(snapshot(null, null).rateLimitInfo.windows, []);
  assert.deepEqual(snapshot({ windowDurationMins: 0, usedPercent: 100 }).rateLimitInfo.windows, []);
  var windows = snapshot({ windowDurationMins: 300 }, { windowDurationMins: 300 }).rateLimitInfo.windows;
  assert.deepEqual(windows.map(function (window) { return window.key; }), ["primary", "secondary"]);
  assert.equal(windows[0].usedPercent, null);
  assert.equal(windows[0].resetsAt, null);
});

function fixture() {
  var recorded = [];
  var rejected = [];
  var scheduled = [];
  var processor = attachMessageProcessor({
    sm: { sendAndRecord: function (session, msg) { recorded.push(msg); } },
    opts: {
      onRateLimitRejected: function (session, reset) { rejected.push(reset); },
      getAutoContinueSetting: function () { return true; },
      scheduleMessage: function (session, text, reset) { scheduled.push(reset); },
    },
  });
  return { processor: processor, recorded: recorded, rejected: rejected, scheduled: scheduled };
}

test("full snapshots are deduplicated per session and bucket without scheduling retries", function () {
  var f = fixture();
  var session = { localId: 12, vendor: "codex", ownerId: "owner" };
  var window = { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1900000000 };
  f.processor.processSDKMessage(session, snapshot(window));
  f.processor.processSDKMessage(session, snapshot(window));
  assert.equal(f.recorded.length, 1);
  assert.equal(f.recorded[0].type, "rate_limit_usage");
  assert.equal(f.recorded[0].sessionId, 12);
  assert.equal(f.recorded[0].vendor, "codex");
  assert.equal(f.recorded[0].quotaWindows[0].resetsAt, 1900000000000);
  assert.equal(session.rateLimitResetsAt, undefined);
  assert.equal(session.rateLimitAutoContinuePending, undefined);
  assert.deepEqual(f.rejected, []);
  assert.deepEqual(f.scheduled, []);
  f.processor.processSDKMessage({ localId: 13, vendor: "codex" }, snapshot(window));
  f.processor.processSDKMessage(session, snapshot(window, null, "other"));
  assert.equal(f.recorded.length, 3);
  f.processor.processSDKMessage(session, snapshot(Object.assign({}, window, { usedPercent: 0 })));
  f.processor.processSDKMessage(session, snapshot(null, null));
  assert.equal(f.recorded.length, 5);
  assert.deepEqual(f.recorded[4].quotaWindows, []);
  f.processor.processSDKMessage(session, snapshot(window));
  assert.equal(f.recorded.length, 6, "same quota can recur after recovery");
});

test("real rejection events retain scheduling behavior", function () {
  var f = fixture();
  var session = { localId: 1, vendor: "claude" };
  f.processor.processSDKMessage(session, { yokeType: "rate_limit", rateLimitInfo: {
    status: "rejected", rateLimitType: "five_hour", resetsAt: 1900000000,
  } });
  assert.deepEqual(f.rejected, [1900000000000]);
  assert.deepEqual(f.scheduled, [1900000000000]);
  assert.ok(f.recorded.some(function (msg) { return msg.type === "rate_limit"; }));
});

test("reconnect restores latest quota buckets beyond paginated history with the current session id", function () {
  var listener;
  attachMessageProcessor({ sm: { addOnSessionViewed: function (fn) { listener = fn; } } });
  var base = { type: "rate_limit_usage", source: "account_snapshot", vendor: "codex", sessionId: 99, limitId: "codex" };
  var session = { localId: 12, vendor: "codex", history: [
    Object.assign({}, base, { quotaWindows: [{ usedPercent: 100 }] }),
    Object.assign({}, base, { quotaWindows: [] }),
    Object.assign({}, base, { limitId: "other", quotaWindows: [{ usedPercent: 20 }] }),
  ] };
  for (var i = 0; i < 600; i++) session.history.push({ type: "user_message", text: "later" });
  var sent = [];
  listener(session, {}, function (msg) { sent.push(msg); });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].sessionId, 12);
  assert.equal(sent[1].sessionId, 12);
  assert.equal(sent[1].limitId, "codex");
  assert.deepEqual(sent[1].quotaWindows, [], "recovery wins over older exhausted snapshot");
  sent.length = 0;
  listener(Object.assign({}, session, { vendor: "claude" }), {}, function (msg) { sent.push(msg); });
  assert.deepEqual(sent, []);
});
