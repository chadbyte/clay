var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var url = require("node:url");

var sourcePath = path.join(__dirname, "..", "lib", "public", "modules", "avatar-imprint.js");

function loadModule() {
  var source = fs.readFileSync(sourcePath, "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

test("Clay Imprints are deterministic and preserve the requested size", async function () {
  var module = await loadModule();
  var first = module.imprintSvg({ style: "thumbs", seed: "sample-user", size: 24, color: "#7c3aed" });
  var second = module.imprintSvg({ style: "thumbs", seed: "sample-user", size: 24, color: "#7c3aed" });
  assert.equal(first, second);
  assert.match(first, /width="24" height="24"/);
  assert.match(first, /viewBox="0 0 7 7"/);
  assert.match(first, /stroke-width="0\.08"/);
});

test("legacy avatar choices remain part of the identity hash", async function () {
  var module = await loadModule();
  var thumbs = module.imprintSvg({ style: "thumbs", seed: "same-user", size: 64, color: "#5857fc" });
  var bots = module.imprintSvg({ style: "bottts", seed: "same-user", size: 64, color: "#5857fc" });
  var imprint = module.imprintSvg({ style: "imprint", seed: "same-user", size: 64, color: "#5857fc" });
  assert.notEqual(thumbs, bots);
  assert.notEqual(thumbs, imprint);
});

test("pixel avatars are symmetric and ignore caller color overrides", async function () {
  var module = await loadModule();
  var purple = module.imprintSvg({ style: "imprint", seed: "sample-user", size: 64, color: "#7c3aed" });
  var green = module.imprintSvg({ style: "imprint", seed: "sample-user", size: 64, color: "#07e5a3" });
  assert.equal(purple, green);
  assert.match(purple, /viewBox="0 0 7 7"/);
  assert.match(purple, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(purple, /#5857fc|#07e5a3/);
  var cells = module.identiconCells(123456);
  for (var i = 0; i < cells.length; i++) {
    assert.ok(cells.some(function (cell) { return cell[0] === 4 - cells[i][0] && cell[1] === cells[i][1]; }));
  }
  assert.doesNotMatch(purple, /<rect x="0" y="[0-4]"/);
});

test("generated avatars are local SVG data URLs with no remote dependency", async function () {
  var module = await loadModule();
  var result = module.imprintDataUrl({ style: "imprint", seed: "local-user", size: 32, color: "#466bd6" });
  assert.match(result, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.doesNotMatch(result, /dicebear|https?:/i);
});

test("Clay Mate marks use a conventional display-name initial", async function () {
  var module = await loadModule();
  var arch = module.mateMarkSvg({ seed: "Arch", size: 64 });
  var ada = module.mateMarkSvg({ seed: "Ada", size: 64 });
  var buzz = module.mateMarkSvg({ seed: "Buzz", size: 64 });
  var archAgain = module.mateMarkSvg({ seed: "Arch", size: 64 });
  assert.equal(arch, archAgain);
  assert.equal(arch, ada);
  assert.notEqual(arch, buzz);
  assert.match(arch, />A<\/text>/);
  assert.match(buzz, />B<\/text>/);
  assert.doesNotMatch(arch, /fill="#333330"/);
  assert.doesNotMatch(buzz, /fill="#333330"/);
  assert.notEqual(arch, module.imprintSvg({ seed: "Arch", size: 64 }));
});

test("built-in Mate initials map to distinct muted source colors", async function () {
  var module = await loadModule();
  var expected = {
    Arch: "#8a806a",
    Rush: "#887b91",
    Ward: "#6f8382",
    Pixel: "#92756d",
    Buzz: "#6f7489",
  };
  var names = Object.keys(expected);
  for (var i = 0; i < names.length; i++) {
    var result = module.mateMarkSvg({ seed: names[i], size: 64 });
    assert.match(result, new RegExp(expected[names[i]]));
    assert.doesNotMatch(result, /#5857fc|#07e5a3/);
  }
});

test("Clay Mate marks are deterministic local SVG data URLs", async function () {
  var module = await loadModule();
  var first = module.mateMarkDataUrl({ seed: "reviewer", size: 32 });
  var second = module.mateMarkDataUrl({ seed: "reviewer", size: 32 });
  assert.equal(first, second);
  assert.match(first, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.doesNotMatch(first, /https?:/i);
});
