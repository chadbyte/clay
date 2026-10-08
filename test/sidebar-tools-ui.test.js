var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/sidebar.css"), "utf8");

test("sidebar tools read as a quiet launcher instead of a grid of gray cards", function () {
  assert.match(css, /\.palette-tile\s*\{[^}]*background:\s*transparent[^}]*color:\s*var\(--text-secondary\)/s);
  assert.match(css, /\.palette-tile > \.lucide\s*\{[^}]*background:\s*var\(--bg\)[^}]*box-shadow:/s);
  assert.match(css, /\.palette-tile\.active > \.lucide\s*\{[^}]*var\(--link\) 52%/s);
});

test("sidebar session actions and empty state remain legible", function () {
  assert.doesNotMatch(css, /\.session-top-action/, "the global creation control is gone");
  assert.match(css, /\.session-favorites-empty\s*\{[^}]*color:\s*var\(--text-muted\)[^}]*opacity:\s*0\.78/s);
});
