var test = require("node:test");
var assert = require("node:assert/strict");
var createOriginRejectionLogger = require("../lib/network-origin-diagnostics").createOriginRejectionLogger;

test("rejection hints are rate limited with fixed state and count suppressed rejections", function () {
  var clock = 1000;
  var lines = [];
  var logRejected = createOriginRejectionLogger({ intervalMs: 60000, now: function () { return clock; }, log: function (line) { lines.push(line); } });
  assert.equal(logRejected("https://tunnel.example", "localhost:2633"), true);
  for (var i = 0; i < 5000; i++) assert.equal(logRejected("https://attacker-" + i + ".example", "localhost:2633"), false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /origin "https:\/\/tunnel\.example" \(Host "localhost:2633"\)/);
  assert.match(lines[0], /Server Settings > Network/);
  clock += 59999;
  assert.equal(logRejected("https://late.example", "localhost:2633"), false);
  clock += 1;
  assert.equal(logRejected("https://next.example", "localhost:2633"), true);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /5001 similar rejection\(s\) were not logged/);
});

test("rejection hints escape control characters and truncate long values", function () {
  var lines = [];
  var logRejected = createOriginRejectionLogger({ log: function (line) { lines.push(line); } });
  logRejected("https://evil.example\n[auth] admin logged in" + "x".repeat(500), undefined);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].indexOf("\n"), -1);
  assert.match(lines[0], /\\n\[auth\]/);
  assert.match(lines[0], /x{100,}\.\.\."/);
  assert.ok(lines[0].length < 600);
  assert.match(lines[0], /Host \(none\)/);
});
