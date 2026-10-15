var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

function loadVendorPriority() {
  var file = path.join(__dirname, "../lib/public/modules/vendor-priority.js");
  var source = fs.readFileSync(file, "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

test("installed vendor selection prefers Claude over Codex", async function () {
  var vendorPriority = await loadVendorPriority();
  assert.strictEqual(vendorPriority.firstInstalledVendor(["codex", "claude", "kiro"]), "claude");
});

test("installed vendor selection falls back to Codex", async function () {
  var vendorPriority = await loadVendorPriority();
  assert.strictEqual(vendorPriority.firstInstalledVendor(["kiro", "codex"]), "codex");
});

test("Muse is third in both client and authoritative YOKE fallback priority", async function () {
  var priority = await loadVendorPriority();
  var yoke = require("../lib/yoke");
  assert.deepStrictEqual(priority.VENDOR_ORDER.slice(0, 3), ["claude", "codex", "muse"]);
  assert.deepStrictEqual(priority.VENDOR_ORDER, yoke.DEFAULT_VENDOR_ORDER);
  assert.strictEqual(priority.firstInstalledVendor(["kiro", "muse", "grok"]), "muse");
  assert.strictEqual(yoke.resolveDefaultVendor(["kiro", "muse", "grok"]), "muse");
  assert.strictEqual(yoke.resolveDefaultVendor(["muse", "codex"]), "codex");
});

test("vendor sorting groups server installation flags with stable unknown fallback", async function () {
  var priority = await loadVendorPriority();
  var entries = [
    { id: "future-b", installed: true }, { id: "kiro", installed: true },
    { id: "claude", installed: false }, { id: "muse", installed: true },
    { id: "future-a", installed: true }, { id: "codex", installed: true },
    { id: "unavailable-b", installed: false }, { id: "unavailable-a", installed: false },
  ];
  var original = entries.slice();
  assert.deepStrictEqual(priority.sortVendorEntries(entries).map(function (v) { return v.id; }),
    ["codex", "muse", "kiro", "future-b", "future-a", "claude", "unavailable-b", "unavailable-a"]);
  assert.deepStrictEqual(entries, original, "sorting must not mutate the server catalog");
});

test("installed vendor selection follows remaining priority and handles none", async function () {
  var vendorPriority = await loadVendorPriority();
  assert.strictEqual(vendorPriority.firstInstalledVendor(["qwen", "kimi", "grok"]), "grok");
  assert.strictEqual(vendorPriority.firstInstalledVendor(["qwen", "copilot"]), "copilot");
  assert.strictEqual(vendorPriority.firstInstalledVendor(["kiro", "junie"]), "junie");
  assert.strictEqual(vendorPriority.firstInstalledVendor(["kiro", "opencode"]), "opencode");
  assert.strictEqual(vendorPriority.firstInstalledVendor([]), "");
});

test("only vendors without direct use testing are marked experimental", async function () {
  var vendorPriority = await loadVendorPriority();
  var stable = ["claude", "codex", "kiro"];
  var experimental = ["grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode"];
  for (var i = 0; i < stable.length; i++) {
    assert.strictEqual(vendorPriority.isExperimentalVendor(stable[i]), false);
  }
  for (var j = 0; j < experimental.length; j++) {
    assert.strictEqual(vendorPriority.isExperimentalVendor(experimental[j]), true);
  }
});

test("composer relies on vendor priority instead of a segmented vendor picker", function () {
  var html = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");
  var panelSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-panels.js"), "utf8");

  assert.doesNotMatch(html, /id="vendor-toggle-wrap"|class="vendor-toggle-btn/);
  assert.doesNotMatch(panelSource, /vendor-btn-|updateVendorToggle|onVendorClick/);
  assert.match(html, /id="config-chip"/);
  assert.match(html, /id="active-vendor-indicator"/);
});
