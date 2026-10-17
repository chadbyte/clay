var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.join(__dirname, "..");
var source = fs.readFileSync(path.join(root, "lib/public/appearance-bootstrap.js"), "utf8");
var themeSource = fs.readFileSync(path.join(root, "lib/public/modules/theme.js"), "utf8");
var index = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");

function runBootstrap(systemLight, appearance) {
  var classes = {};
  var context = {
    document: {
      documentElement: {
        classList: {
          toggle: function (name, enabled) { classes[name] = !!enabled; }
        }
      }
    },
    URLSearchParams: URLSearchParams,
    window: { location: { search: "" } }
  };
  context.window.matchMedia = function () { return { matches: systemLight }; };
  context.window.__clayAppearanceSeed = appearance;
  vm.runInNewContext(source, context);
  return classes;
}

test("server-seeded dark mode wins over a light OS before any client fetch", function () {
  var result = runBootstrap(true, { configured: true, mode: "dark" });
  assert.strictEqual(result["dark-theme"], true);
  assert.strictEqual(result["light-theme"], false);
});

test("server-seeded light mode wins over a dark OS before any client fetch", function () {
  var result = runBootstrap(false, { configured: true, mode: "light" });
  assert.strictEqual(result["light-theme"], true);
  assert.strictEqual(result["dark-theme"], false);
});

test("unconfigured appearance follows the system mode", function () {
  var result = runBootstrap(false, null);
  assert.strictEqual(result["dark-theme"], true);
  assert.strictEqual(result["light-theme"], false);
});

test("configured system mode still follows the current OS", function () {
  var result = runBootstrap(true, { configured: true, mode: null, lightTheme: "custom-light", darkTheme: "custom-dark" });
  assert.strictEqual(result["light-theme"], true);
  assert.strictEqual(result["dark-theme"], false);
});

test("invalid seeded mode falls back to the current OS", function () {
  var result = runBootstrap(false, { configured: true, mode: "unexpected" });
  assert.strictEqual(result["dark-theme"], true);
  assert.strictEqual(result["light-theme"], false);
});

test("separate server seeds keep account appearance isolated", function () {
  var first = runBootstrap(false, { configured: true, mode: "light" });
  var second = runBootstrap(true, { configured: true, mode: "dark" });
  assert.strictEqual(first["light-theme"], true);
  assert.strictEqual(second["dark-theme"], true);
});

test("seed preserves custom theme pairs for the full theme loader", function () {
  assert.match(themeSource, /window\.__clayAppearanceSeed/);
  assert.match(themeSource, /seed\[initialMode \+ 'Theme'\]/);
});

test("appearance bootstrap and fallback colors are loaded before the app stylesheet", function () {
  assert.ok(index.indexOf('<script src="appearance-bootstrap.js"></script>') < index.indexOf('<link rel="stylesheet" href="style.css'));
  assert.match(index, /html \{ background: #171715; color: #e8e8e2; \}/);
  assert.match(index, /html\.light-theme \{ background: #f7f7f3; color: #252522; \}/);
  assert.doesNotMatch(index, /html\.light-theme body/);
});
