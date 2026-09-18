var test = require("node:test");
var assert = require("node:assert/strict");
var feature = require("../lib/multi-worker-feature");
var fs = require("fs");
var path = require("path");

test("the server-owned multi-Worker feature is default-off and exact", function () {
  assert.equal(feature.fromServerConfig({}), null);
  assert.equal(feature.fromServerConfig({ multiWorkerRuntimeEnabled: false }), null);
  assert.equal(feature.fromServerConfig({ multiWorkerRuntimeEnabled: "true" }), null);
  assert.equal(feature.isEnabled({ feature: "multi-worker-runtime" }), false);
  var enabled = feature.fromServerConfig({ multiWorkerRuntimeEnabled: true });
  assert.equal(feature.isEnabled(enabled), true);
});

test("production project creation enables multi-Worker runtime only for non-Mate contexts", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/server.js"), "utf8");
  assert.match(source, /multiWorkerRuntimeEnabled:\s*!extra\.isMate/);
});
