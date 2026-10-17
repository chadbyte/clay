var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var src = fs.readFileSync(path.join(__dirname, "..", "lib", "public", "modules", "github-star.js"), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/export function/g, "function");
var formatStarCount = new Function(src + "\nreturn formatStarCount;")();

test("formats counts like GitHub", function () {
  assert.equal(formatStarCount(0), "0");
  assert.equal(formatStarCount(999), "999");
  assert.equal(formatStarCount(1000), "1k");
  assert.equal(formatStarCount(1234), "1.2k");
  assert.equal(formatStarCount(12599), "12.5k");
  assert.equal(formatStarCount(1200000), "1.2m");
});

test("unknown or invalid counts produce no text", function () {
  assert.equal(formatStarCount(null), "");
  assert.equal(formatStarCount(undefined), "");
  assert.equal(formatStarCount(NaN), "");
  assert.equal(formatStarCount(-3), "");
});

test("markup: fixed href, new-tab rel, no dismiss control, hidden count by default", function () {
  var html = fs.readFileSync(path.join(__dirname, "..", "lib", "public", "index.html"), "utf8");
  var block = html.slice(html.indexOf('id="github-star"'), html.indexOf('<button id="pwa-install-pill"'));
  assert.match(block, /href="https:\/\/github\.com\/chadbyte\/clay"/);
  assert.match(block, /target="_blank" rel="noopener noreferrer"/);
  assert.match(block, /class="[^"]*hidden[^"]*" id="github-star-count"/);
  assert.match(block, /Star<span class="top-bar-star-long"> on GitHub<\/span>/);
  assert.doesNotMatch(block, /top-bar-star-prompt/);
  assert.doesNotMatch(block, /<button\b|dismiss|close/i);
});

test("module does not use localStorage or arrow functions", function () {
  var raw = fs.readFileSync(path.join(__dirname, "..", "lib", "public", "modules", "github-star.js"), "utf8");
  assert.doesNotMatch(raw, /localStorage|=>/);
});
