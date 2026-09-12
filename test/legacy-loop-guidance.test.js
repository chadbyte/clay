var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
function source(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("legacy scheduler crafting has no clay-ralph install dependency", function () {
  var server = source("lib/project-loop.js");
  var guidance = source("lib/loop-guidance.js");
  var scheduler = source("lib/public/modules/scheduler.js");
  var app = source("lib/public/app.js");
  assert.doesNotMatch(server, /\/clay-ralph|clay-ralph skill|invoke the clay-ralph/);
  assert.doesNotMatch(scheduler, /requireClayRalph/);
  assert.doesNotMatch(app.slice(app.indexOf("initScheduler({"), app.indexOf("// --- Remove/Add project")), /requireSkills|clay-ralph/);
  assert.match(server, /loopGuidance\.legacyCraftPrompt/);
  assert.match(guidance, /clarifying any missing goal/);
  assert.match(guidance, /concrete evidence-based completion checks/);
  assert.match(guidance, /future fresh session/);
  assert.match(guidance, /user-provided files/);
  assert.match(guidance, /Never make an automatic commit/);
});
