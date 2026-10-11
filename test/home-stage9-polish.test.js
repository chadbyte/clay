var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

var appSource = source("lib/public/app.js");
var avatarSource = source("lib/public/modules/avatar.js");
var avatarGeneratorSource = source("lib/public/modules/avatar-imprint.js");
var builtinSource = source("lib/builtin-mates.js");
var dockSource = source("lib/public/modules/home-dock.js");
var homeCssSource = source("lib/public/css/home-hub.css");
var hubSource = source("lib/public/modules/app-home-hub.js");
var mateCssSource = source("lib/public/css/mates.css");
var iconCssSource = source("lib/public/css/icon-strip.css");
var indexSource = source("lib/public/index.html");
var sheetSource = source("lib/public/modules/home-conversations-sheet.js");
var sidebarSource = source("lib/public/modules/home-sidebar.js");

test("Workbench remains usable in tablet and mobile widths", function () {
  assert.match(indexSource, /<div class="home-dock-content" id="home-dock-content"><\/div>/);
  assert.match(homeCssSource, /@media \(max-width: 768px\)[\s\S]*#home-hub\.dock-split \.home-tool-workbench[\s\S]*width: 100%/);
});

test("generated avatars use a muted source palette while custom images bypass it", function () {
  assert.match(avatarGeneratorSource, /var MUTED_INDIGO = "#72778f"/);
  assert.match(avatarGeneratorSource, /var MATE_MARK_PALETTE = \[/);
  assert.doesNotMatch(avatarGeneratorSource, /#5857fc|#07e5a3/);
  assert.match(avatarSource, /if \(user && user\.avatarCustom\) return user\.avatarCustom/);
  assert.match(avatarSource, /if \(p\.avatarCustom \|\| mate\.avatarCustom\) return p\.avatarCustom \|\| mate\.avatarCustom/);
  assert.doesNotMatch(mateCssSource + iconCssSource, /filter:\s*(?:saturate|grayscale)/);
});

test("built-in generated Mates declare the same muted identity colors", function () {
  var expected = {
    arch: "#8a806a",
    rush: "#887b91",
    ward: "#6f8382",
    pixel: "#92756d",
    buzz: "#6f7489",
  };
  var keys = Object.keys(expected);
  for (var i = 0; i < keys.length; i++) {
    var pattern = new RegExp('key: "' + keys[i] + '"[\\s\\S]*?avatarColor: "' + expected[keys[i]] + '"');
    assert.match(builtinSource, pattern);
  }
  assert.match(builtinSource, /key: "clay"[\s\S]*avatarCustom: "\/clay-studio-symbol\.png"/);
  assert.match(builtinSource, /key: "ally"[\s\S]*avatarCustom: "\/mates\/ally\.png"/);
});

test("Escape respects overlays and editable controls before changing Workbench state", function () {
  assert.match(dockSource, /if \(hasVisibleEscapeLayer\(\)\) return;[\s\S]*closeHomeBackstage\(\)[\s\S]*hasEditableEscapeTarget\(event\.target\)[\s\S]*if \(!store\.get\('dockFocus'\)\) return/);
  assert.match(dockSource, /target\.matches\('input, textarea, select, \[contenteditable="true"\]'\)/);
  assert.match(dockSource, /target\.closest\('\[contenteditable="true"\]'\)/);
  assert.match(sheetSource, /event\.key === "Escape"[\s\S]*closeSheet\(\)/);
  assert.match(sidebarSource, /event\.key !== "Escape"[\s\S]*closeNarrowDrawer\(true\)/);
  assert.doesNotMatch(sidebarSource + dockSource, /history\.back\(\)|location\.href/);
});

test("popstate without a project falls back to Projects instead of Home", function () {
  assert.match(appSource, /window\.addEventListener\("popstate"/);
  assert.match(appSource, /if \(!newSlug\) \{[\s\S]*showProjectsHub\(true\)/);
  assert.match(appSource, /function showHomeHub\(fromHistory\) \{ showProjectsHub\(fromHistory\); \}/);
});

test("Stage 9 client changes keep direct dependencies and module limits", function () {
  var modules = [
    "lib/public/modules/home-dock.js",
    "lib/public/modules/avatar-imprint.js",
  ];
  for (var i = 0; i < modules.length; i++) {
    var moduleSource = source(modules[i]);
    assert.ok(moduleSource.split("\n").length < 500, modules[i] + " must stay under 500 lines");
    assert.doesNotMatch(moduleSource, /\b(?:const|let)\b|=>|localStorage/);
  }
});
