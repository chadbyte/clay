var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var css = fs.readFileSync(path.join(root, "lib/public/css/title-bar.css"), "utf8");

test("project header always presents a quiet identity mark", function () {
  assert.match(html, /id="title-bar-project-icon"[^>]*aria-hidden="true"/);
  assert.match(css, /\.title-bar-project-icon\s*\{[^}]*display:\s*inline-flex[^}]*width:\s*28px[^}]*background:\s*var\(--bg\)[^}]*box-shadow:/s);
  assert.match(css, /\.title-bar-project-icon::before\s*\{[^}]*mask:/s);
  assert.match(css, /\.title-bar-project-icon\.has-icon::before\s*\{[^}]*display:\s*none/s);
});

test("project header uses compact typography and restrained interaction", function () {
  assert.match(css, /\.title-bar-project-name\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.title-bar-project-dropdown:hover[\s\S]*background:\s*rgba\(var\(--overlay-rgb\), 0\.035\)/);
  assert.doesNotMatch(css, /\.title-bar-project-dropdown:hover\s*\{[^}]*var\(--accent\)/s);
});

test("Mate project header exposes persistent defaults without changing ordinary project behavior", function () {
  var sidebar = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-projects.js"), "utf8");
  var navigation = fs.readFileSync(path.join(root, "lib/public/modules/project-mate-navigation.js"), "utf8");
  var settings = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-settings.js"), "utf8");
  assert.match(html, /id="title-bar-project-default"/);
  assert.match(sidebar, /mateForWorkspace\(store\.snap\(\)\)[\s\S]*openHomeMateSettings\(currentMate\.id, dropdownBtn, \{ section: "model" \}\);[\s\S]*showProjectCtxMenu/);
  assert.match(navigation, /detail\.textContent = vendor \+ ' · ' \+ model/);
  assert.match(settings, /cachedMatesList:[\s\S]*vendor: msg\.vendor, model: msg\.model/);
  assert.match(sidebar, /if \(currentMate\)[\s\S]*return;[\s\S]*showProjectCtxMenu/);
});
