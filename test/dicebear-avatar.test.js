var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var test = require("node:test");
var avatars = require("../lib/dicebear-avatar");

var historicalStyles = ["thumbs", "bottts", "pixel-art", "adventurer", "micah", "fun-emoji", "icons"];

test("the exact historical DiceBear styles render deterministic local SVGs", async function () {
  assert.deepStrictEqual(avatars.styles, historicalStyles);
  var first = await Promise.all(historicalStyles.map(function (style) {
    return avatars.renderAvatar(style, "saved-seed", 48);
  }));
  var second = await Promise.all(historicalStyles.map(function (style) {
    return avatars.renderAvatar(style, "saved-seed", 48);
  }));
  assert.deepStrictEqual(second, first);
  var hashes = first.map(function (svg) {
    assert.match(svg, /^<svg[^>]+width="48" height="48"/);
    assert.doesNotMatch(svg, /api\.dicebear\.com/i);
    return crypto.createHash("sha256").update(svg).digest("hex");
  });
  assert.strictEqual(new Set(hashes).size, historicalStyles.length);
});

test("avatar rendering validates style and bounds size and seed", async function () {
  assert.throws(function () { avatars.normalizeRequest("lorelei", "seed", 48); }, /Unknown avatar style/);
  assert.deepStrictEqual(avatars.normalizeRequest("thumbs", "", 999), { style: "thumbs", seed: "anonymous", size: 64 });
  assert.strictEqual(avatars.normalizeRequest("thumbs", "x".repeat(100), 32).seed.length, 80);
  var escaped = await avatars.renderAvatar("thumbs", '<script>alert("x")</script>', 32);
  assert.doesNotMatch(escaped, /<script>|alert\(/i);
});
