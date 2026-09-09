var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/thinking-summary.js"), "utf8");
var loaded = import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

test("Codex headings remain readable across streamed Markdown boundaries", async function () {
  var summary = (await loaded).thinkingSummary;
  var text = "";
  var chunks = ["*", "*Setting up", " temporary git symlink in PATH*", "*", "\n\n*", "*Planning patch application", " with output limit**"];
  var expected = ["Thinking", "Setting up", "Setting up temporary git symlink in PATH", "Setting up temporary git symlink in PATH", "Setting up temporary git symlink in PATH", "Planning patch application", "Planning patch application with output limit"];
  for (var i = 0; i < chunks.length; i++) {
    text += chunks[i];
    assert.equal(summary(text), expected[i]);
  }
});

test("Claude prose uses a bounded supplied sentence rather than an invented status", async function () {
  var summary = (await loaded).thinkingSummary;
  assert.equal(summary("I should inspect the handler. Then I can verify the fix."), "I should inspect the handler.");
  assert.equal(summary("Earlier thought.\n\nNow checking the result. More details."), "Now checking the result.");
  assert.equal(summary("A".repeat(200)).length, 140);
  assert.equal(summary(""), "Thinking");
});

test("headings take priority over their detail and support Unicode text", async function () {
  var summary = (await loaded).thinkingSummary;
  assert.equal(summary("## Checking permissions\nDetailed explanation."), "Checking permissions");
  assert.equal(summary("결과를 확인합니다。 다음 단계입니다。"), "결과를 확인합니다。");
  assert.equal(summary("**Reviewing [files](https://example.com)**"), "Reviewing files");
});
