var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var origins = require("../lib/network-origins");

test("origin policy supports direct, IPv6, and Host-preserving proxy access", function () {
  [
    ["http://localhost:2633", "localhost:2633"],
    ["http://192.168.1.10:2633", "192.168.1.10:2633"],
    ["http://[::1]:2633", "[::1]:2633"],
    ["https://clay.example.com", "clay.example.com"],
    ["https://CLAY.example.com:443", "clay.example.com"],
  ].forEach(function (pair) { assert.equal(origins.isAllowedOrigin(pair[0], pair[1], []), true); });
  assert.equal(origins.isAllowedOrigin(undefined, "localhost:2633", []), true);
});

test("rewritten hosts require explicit origins, with no port or forwarded-host bypass", function () {
  assert.equal(origins.isAllowedOrigin("https://tunnel.example", "localhost:2633", []), false);
  assert.equal(origins.isAllowedOrigin("https://tunnel.example", "localhost:2633", ["https://tunnel.example"]), true);
  ["http://evil.example:2633", "https://evil.example", "http://tunnel.example", "https://tunnel.example:8443",
    "https://tunnel.example.evil", "null", "", "file:///tmp", "https://tunnel.example/path", "https://user@tunnel.example"].forEach(function (origin) {
    assert.equal(origins.isAllowedOrigin(origin, "localhost:2633", ["https://tunnel.example"]), false, origin);
  });
  assert.equal(origins.isAllowedOrigin("https://evil.example", "localhost:2633", ["*", null]), false);
});

test("configuration normalizes exact origins and rejects unsafe or excessive input", function () {
  assert.deepEqual(origins.normalizeAllowedOrigins(["https://CLAY.example:443/", "https://clay.example"]), ["https://clay.example"]);
  [null, {}, "https://clay.example", Array(101).fill("https://clay.example")].forEach(function (value) {
    assert.throws(function () { origins.normalizeAllowedOrigins(value); });
  });
  ["*", "https://*.example", "null", "https://clay.example/path", "https://clay.example?", "https://clay.example#",
    "https://clay.example\\evil", "https://user:pass@clay.example", "javascript:alert(1)", " https://clay.example", 42].forEach(function (value) {
    assert.throws(function () { origins.normalizeAllowedOrigins([value]); });
  });
});

test("validation errors identify the entry and give an actionable reason", function () {
  [
    [["https://ok.example", "clay.example"], 1, /must start with http:\/\/ or https:\/\//],
    [["https://*.example"], 0, /wildcards/],
    [["https://ok.example", "https://ok.example", "https://clay.example/path"], 2, /path/],
    [["https://user:pass@clay.example"], 0, /username or password/],
    [["https://clay.example:99999"], 0, /not a valid address/],
    [[42], 0, /must be text/],
  ].forEach(function (item) {
    try {
      origins.normalizeAllowedOrigins(item[0]);
      assert.fail("expected rejection");
    } catch (error) {
      assert.equal(error.index, item[1]);
      assert.match(error.entryReason, item[2]);
      assert.match(error.message, new RegExp("^Entry " + (item[1] + 1) + " "));
    }
  });
});

test("stored entries are described without dropping invalid manual edits", function () {
  assert.deepEqual(origins.describeConfiguredOrigins(undefined), { allowedOrigins: [], invalid: [] });
  var described = origins.describeConfiguredOrigins(["https://ok.example", "clay.example", null, 42]);
  assert.deepEqual(described.allowedOrigins, ["https://ok.example", "clay.example", "null", "42"]);
  assert.deepEqual(described.invalid.map(function (item) { return item.index; }), [1, 2, 3]);
  var single = origins.describeConfiguredOrigins("https://ok.example");
  assert.deepEqual(single.allowedOrigins, ["https://ok.example"]);
  assert.match(single.invalid[0].reason, /not stored as a list/);
});

test("missing or empty Host never matches through the Host fallback", function () {
  [undefined, "", "   "].forEach(function (host) {
    assert.equal(origins.isAllowedOrigin("https://undefined", host, []), false, String(host));
    assert.equal(origins.isAllowedOrigin("http://localhost:2633", host, []), false, String(host));
  });
  assert.equal(origins.isAllowedOrigin("https://tunnel.example", undefined, ["https://tunnel.example"]), true);
});

test("saving persists origins alongside all existing config and does not apply failed writes", function (t) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-network-config-"));
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var filename = path.join(directory, "daemon.json");
  var config = { port: 2633, tls: true, projects: [{ slug: "example" }], futureOption: { retained: true } };
  origins.saveAllowedOrigins(config, ["https://CLAY.example:443"], function (next) {
    fs.writeFileSync(filename, JSON.stringify(next));
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, "utf8")), config);
  assert.deepEqual(config.futureOption, { retained: true });
  assert.deepEqual(config.allowedOrigins, ["https://clay.example"]);
  assert.throws(function () {
    origins.saveAllowedOrigins(config, [], function () { throw new Error("Disk unavailable"); });
  });
  assert.deepEqual(config.allowedOrigins, ["https://clay.example"]);
});
