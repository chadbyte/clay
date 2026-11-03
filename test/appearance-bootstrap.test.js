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
  ['workshop', 'clay-embossed'].forEach(function (background) {
    [false, true].forEach(function (light) { assert.equal(runBootstrap(light, { configured: true, background: background }).background, background); });
  });
});

 test('bounded solid colors are seeded before hydration with Clay Gray as fallback', function () {
  var catalog = require('../lib/public/workspace-background-catalog');
  assert.equal(catalog.defaultColorId, 'clay-gray');
  assert.equal(catalog.colors.length, 9);
  assert.deepEqual(catalog.colors.map(function (color) { return color.name; }), ['Windows 95 Teal', 'Windows 2000 Blue', 'Mac OS 8 Blue', 'Amiga Workbench Blue', 'NeXTSTEP Gray', 'BeOS Blue', 'Commodore 64 Blue', 'DOS Black', 'Clay Gray']);
  [false, true].forEach(function (light) {
    [null, {}, { configured: true }, { backgroundColor: 'url(evil)' }].forEach(function (seed) {
      var result = runBootstrap(light, seed);
      assert.equal(result.color, 'clay-gray');
      assert.equal(result.fill['--workspace-solid-light'], '#E7E7E2');
      assert.equal(result.fill['--workspace-solid-dark'], '#242422');
    });
  });
  var css = fs.readFileSync(path.join(root, 'lib/public/css/navigation-island.css'), 'utf8');
  assert.match(css, /--workspace-solid-dark, #242422/);
  assert.match(css, /--workspace-solid-light, #E7E7E2/);
  catalog.colors.concat(catalog.legacyColors).forEach(function (color) {
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
  assert.strictEqual(result.color, 'clay-gray');
});


test('catalog pictures automatically seed tile or cover rendering and clear it for solids', function () {
  var catalog = require('../lib/public/workspace-background-catalog');
  assert.deepEqual(catalog.pictures.map(function (picture) { return picture.name; }), ['Clay Embossed', 'Classic Mac Dither', 'Clay Memphis', 'Clay Clouds', 'Clay Mates', 'Clay Meadow', 'Clay Silicon', 'Clay Aqua', 'Clay Light', 'Clay Galaxy', 'Clay Cove']);
  assert.equal(catalog.getPicture('clay-embossed').mode, 'tile');
  assert.equal(catalog.getPicture('workshop').mode, 'cover');
  assert.equal(catalog.getPicture('clay-memphis').mode, 'cover');
  assert.equal(catalog.getPicture('clay-clouds').mode, 'cover');
  assert.equal(catalog.getPicture('clay-mates').mode, 'cover');
  assert.equal(catalog.getPicture('clay-meadow').mode, 'cover');
  assert.equal(catalog.getPicture('clay-silicon').mode, 'cover');
  assert.equal(catalog.getPicture('clay-aqua').mode, 'cover');
  assert.equal(catalog.getPicture('clay-light').mode, 'cover');
  assert.equal(catalog.getPicture('clay-galaxy').mode, 'cover');
  assert.equal(catalog.getPicture('clay-cove').mode, 'cover');
  [false, true].forEach(function (light) {
    var tile = runBootstrap(light, { configured: true, background: 'clay-embossed' }).fill;
    assert.equal(tile['--workspace-art-size'], '240px 180px'); assert.equal(tile['--workspace-art-repeat'], 'repeat');
    assert.equal(tile['--workspace-art-light'], tile['--workspace-art-dark']);
    var dither = runBootstrap(light, { configured: true, background: 'classic-mac-dither' }).fill;
    assert.equal(dither['--workspace-art-size'], '4px 4px'); assert.equal(dither['--workspace-art-repeat'], 'repeat');
    assert.equal(dither['--workspace-art-light'], dither['--workspace-art-dark']);
    var cover = runBootstrap(light, { configured: true, background: 'workshop' }).fill;
    assert.equal(cover['--workspace-art-size'], 'cover'); assert.equal(cover['--workspace-art-repeat'], 'no-repeat');
    assert.match(cover['--workspace-art-light'], /workshop-light/); assert.match(cover['--workspace-art-dark'], /workshop-dark/);
  });
  var style = { setProperty: function (name, value) { this[name] = value; } };
  catalog.applyPicture(style, 'clay-embossed'); catalog.applyPicture(style, 'plain');
  assert.equal(style['--workspace-art-light'], 'none'); assert.equal(style['--workspace-art-dark'], 'none');
  assert.equal(style['--workspace-art-size'], 'cover'); assert.equal(style['--workspace-art-repeat'], 'no-repeat');
});
