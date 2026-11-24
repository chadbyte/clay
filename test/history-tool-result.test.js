var test = require("node:test");
var assert = require("node:assert/strict");
var result = require("../lib/history-tool-result");

test("history previews leave small and live entries intact and defer the bulk of large results", function () {
  var small = { type: "tool_result", id: "small", content: "found" };
  var images = [{ mediaType: "image/png", data: "a".repeat(500000) }];
  var large = { type: "tool_result", id: "large", content: "some output", images: images };
  assert.strictEqual(result.preview(small), small);
  assert.deepEqual(result.preview(large), { type: "tool_result", id: "large", content: "some output", deferredHistoryResult: true });
  assert.strictEqual(large.images, images);
  var text = { type: "tool_result", id: "text", content: "<system-reminder>internal</system-reminder>" + "я".repeat(9000) };
  assert.equal(result.preview(text).content, "я".repeat(1000));
});

test("the complete result is only returned for the exact session origin, index and tool", function () {
  var images = [{ mediaType: "image/jpeg", data: "x".repeat(20000) }];
  var session = { localId: 2, sessionOriginId: "origin", history: [
    { type: "tool_start", id: "tool" },
    { type: "tool_result", id: "tool", content: "full output", images: images },
  ] };
  var request = { sessionId: 2, sessionOriginId: "origin", index: 1, toolId: "tool" };
  assert.deepEqual(result.read(session, request), { content: "full output", images: images });
  [{ sessionId: 3 }, { sessionOriginId: "replaced" }, { index: 0 }, { index: -1 }, { index: 1.1 }, { toolId: "other" }].forEach(function (change) {
    assert.equal(result.read(session, Object.assign({}, request, change)), null);
  });
});
