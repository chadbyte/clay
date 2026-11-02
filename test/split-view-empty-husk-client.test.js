"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var source = fs.readFileSync(path.join(root, "lib/public/modules/split-view-presentations.js"), "utf8");

function slice(from, to) {
  var start = source.indexOf(from);
  assert.notEqual(start, -1, "anchor not found: " + from);
  var end = source.indexOf(to, start);
  assert.notEqual(end, -1, "end anchor not found: " + to);
  return source.slice(start, end);
}

// Deleting the active session empties its workspace view. If the client keeps
// or restores that husk as the active presentation, the native app stays
// hidden behind a blank canvas and sidebar clicks are pulled back into it.
test("a sessionless view is only usable when it still presents open panes", function () {
  var helper = slice("function presentableWithoutSessions(view)", "function renderActive()");
  assert.match(helper, /view\.workspace\.panes\.some\(function \(pane\) \{ return pane\.open; \}\)/);
  assert.match(helper, /return !\(getCachedSessions\(\) \|\| \[\]\)\.length;/,
    "without open panes an empty view is a blank canvas only for a project without sessions");
});

test("a saved empty active view is not restored over live sessions", function () {
  var restore = slice("var activeId = state.projectSplitViewActiveId;", "var removedActive");
  assert.match(restore, /presentableWithoutSessions\(emptyRestorable\)/);
});

test("renderActive releases a husk view instead of leaving the app hidden", function () {
  var render = slice("if (restoreViewPair(view)) return;", "var tree = presentationTree(view);");
  assert.match(render, /if \(!view\.sessions\.length && !presentableWithoutSessions\(view\)\) \{/);
  assert.match(render, /projectSplitViewActiveId: null/);
  assert.match(render, /hidePresentationView\(\);/);
});
