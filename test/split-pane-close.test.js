"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");

var source = fs.readFileSync("lib/public/modules/split-pane-renderer.js", "utf8");
var start = source.indexOf("export function updateSplitPaneCloseVisibility");
var end = source.indexOf("\nfunction resetPaneContextChip", start);
var implementation = source.slice(start, end).replace("export function", "function");

test("Close remains visible and enabled for the only pane and binds its current session", function () {
  var button = { dataset: {}, hidden: true, disabled: true, title: "The only pane cannot be closed", attributes: {},
    setAttribute: function (name, value) { this.attributes[name] = value; } };
  var pane = { querySelector: function () { return button; } };
  var context = { Number: Number };
  require("node:vm").runInNewContext(implementation + "\nupdateSplitPaneCloseVisibility(pane, 42);", Object.assign(context, { pane: pane }));
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.dataset.sessionId, "42");
  assert.equal(button.title, "Close pane");
  assert.equal(button.attributes["aria-label"], "Close pane");
});
