var test = require("node:test");
var assert = require("node:assert/strict");
var layout = require("../lib/split-view-layout");

function source() {
  return import("../lib/public/modules/split-view-layout-client.js");
}

test("client presets match the production server tree shape for all sizes", async function () {
  var client = await source();
  var names = ["balanced", "columns", "rows", "grid", "main-left", "main-right"];
  for (var count = 0; count <= 8; count++) {
    var ids = Array.from({ length: count }, function (_, index) { return "origin-" + index; });
    for (var ni = 0; ni < names.length; ni++) {
      var tree = client.preset(ids, names[ni]);
      assert.deepEqual(tree, layout.createPreset(ids, names[ni]), names[ni] + " with " + count);
      if (count >= 2) assert.deepEqual(client.validateTree(tree, ids), { ok: true, ids: client.listIds(tree) });
      else assert.deepEqual(client.listIds(tree), ids);
    }
  }
});

test("layout placement is immutable, moves an existing source and preserves identity", async function () {
  var client = await source();
  var original = client.preset(["a", "b", "c"], "balanced");
  var result = client.place(original, "c", "a", "left", 1 / 3);
  assert.equal(result.ok, true);
  assert.deepEqual(client.listIds(result.tree).sort(), ["a", "b", "c"]);
  assert.deepEqual(original, client.preset(["a", "b", "c"], "balanced"));
  assert.equal(client.place(result.tree, "new", "b", "right").ok, true);
  assert.equal(client.place(result.tree, "new", "absent", "left").reason, "unknown-target");
  assert.equal(client.place(client.preset(["a", "b", "c", "d", "e", "f", "g", "h"], "grid"), "i", "a", "right").reason, "limit");
});

test("swaps preserve tree geometry and rectangles tile panes with stable divider paths", async function () {
  var client = await source();
  var tree = client.preset(["a", "b", "c", "d"], "grid");
  var swapped = client.swap(tree, "a", "d").tree;
  function shape(node) { return node.id ? "leaf" : node.axis + ":" + node.ratio + "(" + shape(node.left) + "," + shape(node.right) + ")"; }
  assert.equal(shape(swapped), shape(tree));
  assert.deepEqual(client.listIds(swapped), ["d", "b", "c", "a"]);
  var geometry = client.rectangles(tree, 800, 600, 7);
  assert.deepEqual(Object.keys(geometry.panes).sort(), ["a", "b", "c", "d"]);
  assert.equal(geometry.dividers.length, 3);
  assert.equal(geometry.panes.a.x, 0);
  assert.ok(geometry.panes.d.x + geometry.panes.d.width <= 800);
  var nestedDivider = geometry.dividers.find(function (item) { return item.path.join("/") === "left"; });
  assert.ok(nestedDivider && nestedDivider.branchRect.height < 600 && nestedDivider.branchRect.width === 800);
});

test("client rejects malformed shares, duplicate and invalid preset identities", async function () {
  var client = await source();
  var tree = client.preset(["a", "b"], "balanced");
  assert.equal(client.place(tree, "x", "a", "left", NaN).reason, "invalid-share");
  assert.equal(client.place(tree, "x", "a", "toString").reason, "invalid-position");
  assert.equal(client.swap(tree, "a", "missing").reason, "unknown-id");
  assert.deepEqual(client.pairTree("a", "b", "left"), { axis: "horizontal", ratio: 0.5, left: { id: "b" }, right: { id: "a" } });
  assert.throws(function () { client.pairTree("a", "a", "left"); }, TypeError);
  assert.throws(function () { client.preset(["a", "a"], "grid"); }, TypeError);
  assert.throws(function () { client.preset(["a"], "invalid"); }, TypeError);
});
