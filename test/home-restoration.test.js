var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;
var test = require("node:test");

var root = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("legacy Home preferences restore to Projects without mounting Home", function () {
  var boot = source("lib/public/modules/home-surface-boot.js");
  var app = source("lib/public/app.js");
  var markup = source("lib/public/index.html");
  assert.match(boot, /if \(options\.currentSlug\) return "project"/);
  assert.match(boot, /return "projects"/);
  assert.match(boot, /projectsHubRestoreRequested: true/);
  assert.match(app, /function showHomeHub\(fromHistory\) \{ showProjectsHub\(fromHistory\); \}/);
  assert.doesNotMatch(markup, /id="home-hub"/);
});

test("accessible project activation still excludes Mate backing projects", async function () {
  var activation = await import(pathToFileURL(path.join(root, "lib/public/modules/project-activation.js")).href);
  var projects = [
    { slug: "mate-clay", isMate: true },
    { slug: "allowed-second" },
    { slug: "allowed-first" },
  ];
  assert.equal(activation.chooseProjectActivationTarget(projects, ["revoked", "allowed-first"]), "allowed-first");
  assert.equal(activation.chooseProjectActivationTarget(projects, ["revoked", "mate-clay"]), "allowed-second");
  assert.equal(activation.chooseProjectActivationTarget([{ slug: "mate-only", isMate: true }], ["mate-only"]), null);
});

test("exact project-session restoration waits for the authorized project socket", function () {
  var navigation = source("lib/public/modules/project-session-navigation.js");
  assert.match(navigation, /pendingProjectSessionNavigation/);
  assert.match(navigation, /activeProjectSlug/);
  assert.match(navigation, /ws\.readyState !== 1/);
  assert.match(navigation, /type: 'switch_session', id: pending\.sessionId/);
  assert.match(navigation, /switchProject\(projectSlug\)/);
});

test("debate planning restoration remains bound to the owning main-chat session", function () {
  var planning = source("lib/public/modules/project-debate-planning-workspace.js");
  var connection = source("lib/project-connection.js");
  assert.match(planning, /projectDebatePlanningAwaitingHistory/);
  assert.match(planning, /activeSessionId/);
  assert.match(planning, /type: 'switch_session', id: msg\.localId/);
  assert.match(connection, /debatePlanning/);
  assert.match(connection, /debatePhase/);
});
