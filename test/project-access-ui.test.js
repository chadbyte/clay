var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/project-access.js"), "utf8");
var sidebar = fs.readFileSync(path.join(__dirname, "../lib/public/modules/sidebar-projects.js"), "utf8");

test("worktree access UI preserves explicit grants that are also inherited", function () {
  assert.match(source, /data-explicit=/);
  assert.match(source, /!checkbox\.disabled \|\| checkbox\.dataset\.explicit === "true"/);
  assert.match(source, /Entire project/);
});

test("public-parent worktrees state their effective access truthfully", function () {
  assert.match(source, /Public parent project/);
  assert.match(source, /Every authenticated user can access this worktree/);
  assert.match(source, /Exact grants are retained if the parent becomes private/);
});

test("worktree project menus do not offer nested worktree creation", function () {
  assert.match(sidebar, /if \(slug\.indexOf\("--"\) === -1\) \{\s+var wtItem/);
});
