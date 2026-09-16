var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
var faviconSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-favicon.js"), "utf8");

test("tool activity replaces the generic bouncing indicator", function () {
  assert.match(source, /case "tool_start":\s*removeMatePreThinking\(\);\s*stopThinking\(\);\s*setActivity\(null\);/);
});

test("permission prompts clear stale bouncing indicators", function () {
  assert.match(source, /case "permission_request":\s*setActivity\(null\);\s*renderPermissionRequest/);
  assert.match(source, /case "permission_request_pending":\s*setActivity\(null\);\s*renderPermissionRequest/);
});

test("live Thinking suppresses only the duplicate generic indicator", function () {
  assert.match(faviconSource, /text === "thinking" && thinkingState && thinkingState\.active/);
  assert.match(faviconSource, /Compaction and tool[\s\S]*continue through/);
  assert.match(source, /case "compacting":[\s\S]*setActivity\("compacting"\)/);
});
