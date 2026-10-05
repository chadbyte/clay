var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

function source(file) {
  return fs.readFileSync(path.join(__dirname, "../", file), "utf8");
}

test("connection overlay starts with connecting wording", function() {
  var html = source("lib/public/index.html");
  var baseCss = source("lib/public/css/base.css");
  var css = source("lib/public/css/overlays.css");
  assert.match(html, /class="connect-symbol" src="clay-studio-symbol\.png" alt="Clay Studio"/);
  assert.doesNotMatch(html, /class="connect-wordmark"/);
  assert.match(html, /id="connect-overlay-msg">Connecting…</);
  assert.doesNotMatch(html, /id="connect-overlay-msg">Reconnecting/);
  assert.match(css, /#connect-overlay[\s\S]*background: var\(--bg\)/);
  assert.match(css, /width: clamp\(58px, 6vw, 82px\)/);
  assert.doesNotMatch(css, /connect-wordmark/);
  assert.match(css, /connect-brand-breathe/);
  assert.doesNotMatch(css, /var\(--accent\) 50%/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(baseCss, /--brand-indigo: #5857fc/);
  assert.match(baseCss, /--brand-green: #07e5a3/);
});

test("reconnect wording is only set after a prior connection", function() {
  var connection = source("lib/public/modules/app-connection.js");
  assert.match(connection, /var hasConnectedOnce = false/);
  // The reveal now goes through showOverlayNow(), which still only swaps in the
  // reconnect wording once a first connection has succeeded. The startup
  // "Connecting…" text in index.html is left untouched on the first pass.
  assert.match(
    connection,
    /function showOverlayNow\(\)[\s\S]*if \(hasConnectedOnce\) \{[\s\S]*Reconnecting to server…[\s\S]*\}\s*\n\s*connectOverlay\.classList\.remove\("hidden"\);/
  );
});

test("pane overlays use a quiet themed loading state", function() {
  var css = source("lib/public/css/pane.css");
  assert.match(css, /body\.pane-mode #connect-overlay \{ background: var\(--bg\); \}/);
  assert.doesNotMatch(css, /body\.pane-mode #connect-overlay \.connect-wordmark \{ display: none; \}/);
  assert.match(css, /body\.pane-mode #connect-overlay-msg \{ color: var\(--text-dimmer\); \}/);
});
