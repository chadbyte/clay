var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/fonts.css"), "utf8");

test("the default UI stack leaves non-Korean glyph fallback to the platform", function () {
  var root = css.match(/:root\s*\{([^}]*)\}/);
  assert.ok(root, "the root font stack should exist");
  assert.match(root[1], /--font-ui:\s*"Geist",\s*"Twemoji",\s*system-ui/);
  assert.doesNotMatch(root[1], /Noto Sans KR/);
});

test("Korean language scopes retain the bundled Korean fallback", function () {
  var korean = css.match(/\[lang\|="ko"\]\s*\{([^}]*)\}/);
  assert.ok(korean, "the Korean language font stack should exist");
  assert.match(korean[1], /--font-ui:\s*"Geist",\s*"Noto Sans KR",\s*"Twemoji",\s*system-ui/);
  assert.match(korean[1], /font-family:\s*var\(--font-ui\)/);
  assert.doesNotMatch(css, /:lang\(ko\)/, "inherited language must not override descendant code fonts");
});
