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

test("Mate project header exposes the Mate bio without changing ordinary project behavior", function () {
  var sidebar = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-projects.js"), "utf8");
  var navigation = fs.readFileSync(path.join(root, "lib/public/modules/project-mate-navigation.js"), "utf8");
  var header = fs.readFileSync(path.join(root, "lib/public/modules/project-header-identity.js"), "utf8");
  var settings = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-settings.js"), "utf8");
  assert.match(html, /id="title-bar-project-default"/);
  assert.match(sidebar, /mateForWorkspace\(store\.snap\(\)\)[\s\S]*openHomeMateSettings\(currentMate\.id, dropdownBtn, \{ section: "general" \}\);[\s\S]*showProjectCtxMenu/);
  assert.match(navigation, /renderMateProjectHeader\(state, mate\)/);
  assert.match(header, /getHomeMateBio\(mate\)\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)/);
  assert.match(header, /detail\.textContent = bio/);
  assert.match(header, /'Open Mate settings for ' \+ displayName/);
  assert.match(header, /title-bar-mate-avatar[\s\S]*title-bar-mate-vendor/);
  assert.match(css, /\[data-mate-defaults="true"\] \.title-bar-chevron \{ display: none; \}/);
  assert.match(css, /\[data-mate-defaults="true"\]\[data-mate-bio="true"\] \.title-bar-project-default \{ display: block; \}/);
  assert.match(settings, /cachedMatesList:[\s\S]*vendor: msg\.vendor, model: msg\.model/);
  assert.match(settings, /var sections = \["general", "model"\]/);
  assert.doesNotMatch(settings, /var sections = \[[^\]]*"memory"/);
  assert.match(sidebar, /if \(currentMate\)[\s\S]*return;[\s\S]*showProjectCtxMenu/);
});
