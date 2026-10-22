var test = require("node:test");
var assert = require("node:assert/strict");
var publishedStableTag = require("../scripts/release-target.cjs").publishedStableTag;

function release(overrides) {
  return Object.assign({ tag_name: "v5.4.0", draft: false, prerelease: false, published_at: "2026-10-22T00:00:00Z" }, overrides);
}

test("only a published stable release at the current commit selects Stable docs", function () {
  assert.equal(publishedStableTag("5.4.0", ["v5.4.0"], release()), "v5.4.0");
  assert.equal(publishedStableTag("5.4.0-beta.1", ["v5.4.0-beta.1"], release()), "");
  assert.equal(publishedStableTag("5.4.0", [], release()), "");
  assert.equal(publishedStableTag("5.4.0", ["v5.3.0"], release()), "");
});

test("draft, prerelease, missing and mismatched release records fail closed", function () {
  [null, release({ draft: true }), release({ prerelease: true }), release({ published_at: null }), release({ tag_name: "v5.3.0" })].forEach(function (record) {
    assert.throws(function () { publishedStableTag("5.4.0", ["v5.4.0"], record); }, /published/);
  });
});
