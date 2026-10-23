var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var worktree = require("../lib/worktree");

var root = path.join(__dirname, "..");
var clientHelpersPromise = null;

function loadClientHelpers() {
  if (!clientHelpersPromise) {
    var file = path.join(root, "lib/public/modules/worktree-location.js");
    var source = fs.readFileSync(file, "utf8");
    clientHelpersPromise = import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  }
  return clientHelpersPromise;
}

test("worktree paths distinguish nested and external locations", function () {
  assert.strictEqual(worktree.isPathInside("/projects/clay", "/projects/clay/.worktrees/feature"), true);
  assert.strictEqual(worktree.isPathInside("/projects/clay", "/projects/clay-feature"), false);
  assert.strictEqual(worktree.isPathInside("/projects/clay", "/tmp/clay-feature"), false);
});

test("client worktree metadata treats external location as informational", async function () {
  var helpers = await loadClientHelpers();
  var external = { isWorktree: true, worktreeExternal: true };

  assert.strictEqual(helpers.isExternalWorktree(external), true);
  assert.strictEqual(helpers.isExternalWorktree({ isWorktree: true }), false);
  assert.match(helpers.externalWorktreeTooltip("Feature"), /outside the main project folder/);
});

test("external worktrees stay selectable and use the reviewed removal controls", function () {
  var sidebar = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-projects.js"), "utf8");
  var switcher = fs.readFileSync(path.join(root, "lib/public/modules/project-switcher.js"), "utf8");
  var project = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");

  assert.match(project, /status\.worktreeExternal = worktreeMeta\.external === true/);
  assert.match(sidebar, /appendExternalWorktreeBadge\(wtEl, "worktree-external-badge"\)/);
  assert.match(sidebar, /if \(switchProject\) switchProject\(slug\)/);
  assert.match(sidebar, /reviewWorktreeRemoval\(slug, "delete", anchorEl\)/);
  assert.doesNotMatch(sidebar, /worktreeAccessible|wt-disabled/);
  assert.match(switcher, /external: external,\s*disabled: false/);
  assert.match(switcher, /project-switcher-external-badge/);
});
