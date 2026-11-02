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
        dataset: {},
        style: { setProperty: function (key, value) { this[key] = value; } },
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
  vm.runInNewContext(fs.readFileSync(path.join(root, 'lib/public/workspace-background-catalog.js'), 'utf8'), context);
  vm.runInNewContext(source, context);
  classes.background = context.document.documentElement.dataset.workspaceBackground;
  classes.color = context.document.documentElement.dataset.workspaceColor;
  classes.fill = context.document.documentElement.style;
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

test("background choice is ready before styles, with solids for missing or invalid picture seeds", function () {
  assert.equal(runBootstrap(false, null).background, 'plain');
  assert.equal(runBootstrap(false, { background: 'invalid' }).background, 'plain');
  assert.equal(runBootstrap(true, { configured: true, background: 'workshop' }).background, 'workshop');
});

 test('bounded solid colors are seeded before hydration with Sky as fallback', function () {
  var catalog = require('../lib/public/workspace-background-catalog');
  assert.equal(catalog.defaultColorId, 'sky');
  assert.equal(catalog.colors.length, 15);
  assert.equal(catalog.colors[0].id, 'clay');
  [false, true].forEach(function (light) {
    [null, {}, { configured: true }, { backgroundColor: 'url(evil)' }].forEach(function (seed) {
      var result = runBootstrap(light, seed);
      assert.equal(result.color, 'sky');
      assert.equal(result.fill['--workspace-solid-light'], '#cbdfe9');
      assert.equal(result.fill['--workspace-solid-dark'], '#2e3f4b');
    });
  });
  var css = fs.readFileSync(path.join(root, 'lib/public/css/navigation-island.css'), 'utf8');
  assert.match(css, /--workspace-solid-dark, #2e3f4b/);
  assert.match(css, /--workspace-solid-light, #cbdfe9/);
  catalog.colors.forEach(function (color) {
    [false, true].forEach(function (light) {
      var result = runBootstrap(light, { configured: true, backgroundColor: color.id });
      assert.equal(result.color, color.id);
      assert.equal(result.fill['--workspace-solid-light'], color.light);
      assert.equal(result.fill['--workspace-solid-dark'], color.dark);
    });
  });
  assert.ok(index.indexOf('workspace-background-catalog.js') < index.indexOf('appearance-bootstrap.js'));
});


test('custom paired colors are validated before first paint', function () {
  var color = { id: 'custom-rose', name: 'Rose', light: '#e9cbd4', dark: '#49333d' };
  var result = runBootstrap(true, { configured: true, backgroundColor: color.id, customBackgroundColors: [color] });
  assert.strictEqual(result.color, color.id);
  assert.strictEqual(result.fill['--workspace-solid-light'], '#E9CBD4');
  assert.strictEqual(result.fill['--workspace-solid-dark'], '#49333D');
  result = runBootstrap(false, { configured: true, backgroundColor: color.id, customBackgroundColors: [Object.assign({}, color, { light: 'url(https://invalid)' })] });
  assert.strictEqual(result.color, 'sky');
});
