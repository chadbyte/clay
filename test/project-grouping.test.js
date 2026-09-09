var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

function loadGrouping() {
  var file = path.join(__dirname, "../lib/public/modules/project-grouping.js");
  var source = fs.readFileSync(file, "utf8").replace("export function groupProjects", "function groupProjects");
  var sandbox = { result: null };
  vm.runInNewContext(source + "\nresult = groupProjects;", sandbox);
  return sandbox.result;
}

test("an exact worktree remains visible when its parent is absent", function () {
  var groupProjects = loadGrouping();
  var exact = { slug: "app--feature-c", parentSlug: "app", isWorktree: true };
  var grouped = groupProjects([exact]);
  assert.equal(grouped.parents.length, 1);
  assert.equal(grouped.parents[0].slug, exact.slug);
  assert.deepEqual(Object.keys(grouped.wtByParent), []);
});

test("visible parents still group their visible worktrees", function () {
  var groupProjects = loadGrouping();
  var parent = { slug: "app" };
  var worktree = { slug: "app--feature", parentSlug: "app", isWorktree: true };
  var grouped = groupProjects([parent, worktree]);
  assert.equal(grouped.parents.length, 1);
  assert.equal(grouped.parents[0].slug, "app");
  assert.equal(grouped.wtByParent.app[0].slug, worktree.slug);
});
