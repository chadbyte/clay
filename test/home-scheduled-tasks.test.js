var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var index = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var palettes = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette-order.js"), "utf8");
var homeSidebar = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
var scheduler = fs.readFileSync(path.join(root, "lib/public/modules/scheduler.js"), "utf8");

test("Scheduled Tasks is project-only and hidden from Home and Mate surfaces", function () {
  assert.doesNotMatch(index, /id="home-scheduler-btn"/);
  assert.match(palettes, /id:\s*"scheduler-btn"/);
  assert.doesNotMatch(palettes, /id:\s*"mate-scheduler-btn"/);
  assert.doesNotMatch(homeSidebar, /openHomeScheduler|home-scheduler-btn/);
});

test("legacy calendar remains intact without a Home entrypoint", function () {
  assert.match(scheduler, /export function openHomeScheduler\(\)[\s\S]*?showAllProjects = true;/s);
  assert.match(scheduler, /document\.getElementById\("main-area"\)/);
});
