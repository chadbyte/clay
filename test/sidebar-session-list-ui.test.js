var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var css = fs.readFileSync(path.join(root, "lib/public/css/sidebar.css"), "utf8");
var source = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-sessions.js"), "utf8");
var renderStart = source.indexOf("function renderSessionItem(s, options)");
var renderEnd = source.indexOf("function renderSplitGroupItem", renderStart);
var renderSource = source.slice(renderStart, renderEnd);

test("session rows separate agent identity, title, and recency", function () {
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderSource, /vendorIcon\.className = "session-vendor-icon session-vendor-mark"/);
  assert.ok(renderSource.indexOf("el.appendChild(vendorIcon)") < renderSource.indexOf("el.appendChild(textSpan)"));
  assert.match(renderSource, /age\.className = "session-item-age"/);
  assert.match(renderSource, /trailing\.className = "session-row-trailing"/);
  assert.ok(renderSource.indexOf("trailing.appendChild(age)") < renderSource.indexOf("trailing.appendChild(actions)"));
  assert.match(css, /\.session-vendor-mark\s*\{[^}]*width:\s*16px[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s);
  assert.match(css, /\.session-item\.active \.session-vendor-mark\s*\{[^}]*opacity:\s*0\.88/s);
  assert.match(css, /\.session-item-age\s*\{[^}]*font-size:\s*9\.5px/s);
});

test("active sessions use a quiet tint without adding another left edge", function () {
  assert.match(css, /\.session-item\.active\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--link\) 7%, transparent\)/s);
  assert.doesNotMatch(css, /\.session-item\.active\s*\{[^}]*background:\s*var\(--sidebar-active\)/s);
  assert.doesNotMatch(css, /\.session-item\.active\s*\{[^}]*inset 2px 0 0/s);
  assert.match(css, /\.session-unread-badge\s*\{[^}]*background:\s*var\(--link\)/s);
});
