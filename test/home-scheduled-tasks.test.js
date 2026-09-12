var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var index = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var palettes = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette.js"), "utf8");
var homeSidebar = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
var scheduler = fs.readFileSync(path.join(root, "lib/public/modules/scheduler.js"), "utf8");

test("Scheduled Tasks has one primary entry in Home instead of project and Mate palettes", function () {
  assert.match(index, /id="home-scheduler-btn"[^>]*>.*Scheduled Tasks<\/span><\/button>/);
  assert.doesNotMatch(palettes, /id:\s*"scheduler-btn"/);
  assert.doesNotMatch(palettes, /id:\s*"mate-scheduler-btn"/);
  assert.match(homeSidebar, /openHomeScheduler\(\)/);
});

test("Home opens the existing scheduler in its cross-project scope", function () {
  assert.match(scheduler, /export function openHomeScheduler\(\)[\s\S]*?showAllProjects = true;/s);
  assert.match(scheduler, /document\.getElementById\("main-area"\)/);
});
