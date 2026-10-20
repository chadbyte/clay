var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var { execFileSync } = require("node:child_process");

var root = path.join(__dirname, "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function createPackFixture(t) {
  var fixture = fs.mkdtempSync(path.join(os.tmpdir(), "clay-package-metadata-"));
  t.after(function () { fs.rmSync(fixture, { recursive: true, force: true }); });
  fs.copyFileSync(path.join(root, "package.json"), path.join(fixture, "package.json"));
  fs.copyFileSync(path.join(root, "package-lock.json"), path.join(fixture, "package-lock.json"));
  fs.mkdirSync(path.join(fixture, "bin"));
  fs.copyFileSync(path.join(root, "bin", "cli.js"), path.join(fixture, "bin", "cli.js"));
  fs.mkdirSync(path.join(fixture, 'scripts'));
  fs.copyFileSync(path.join(root, 'scripts/build-pane-assets.js'), path.join(fixture, 'scripts/build-pane-assets.js'));
  fs.mkdirSync(path.join(fixture, 'lib'));
  fs.copyFileSync(path.join(root, 'lib/pane-asset-manifest.js'), path.join(fixture, 'lib/pane-asset-manifest.js'));
  fs.cpSync(path.join(root, 'lib/public'), path.join(fixture, 'lib/public'), { recursive: true, filter: function (source) { return !source.includes(path.sep + 'pane-assets'); } });
  return fixture;
}

test("source package metadata is production-only and preserves explicit dev mode", function () {
  var packageJson = readJson(path.join(root, "package.json"));
  var lock = readJson(path.join(root, "package-lock.json"));
  assert.deepEqual(packageJson.bin, { "clay-server": "./bin/cli.js" });
  assert.deepEqual(lock.packages[""].bin, { "clay-server": "bin/cli.js" });
  assert.equal(packageJson.scripts.dev, "node bin/cli.js --dev");
  assert.equal(packageJson.scripts.prepack, 'npm run build:pane-assets');
  ['preinstall', 'install', 'postinstall', 'prepare'].forEach(function (hook) { assert.equal(packageJson.scripts[hook], undefined); });
  assert.equal(packageJson.scripts.postpack, undefined);
});

test("npm pack keeps the source manifest unchanged and publishes production-only metadata", function (t) {
  var fixture = createPackFixture(t);
  var packageFile = path.join(fixture, "package.json");
  var before = fs.readFileSync(packageFile, "utf8");
  var result = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", fixture], {
    cwd: fixture,
    encoding: "utf8",
    env: Object.assign({}, process.env, { npm_config_loglevel: "silent", NODE_PATH: [process.env.NODE_PATH, path.join(root, "node_modules")].filter(Boolean).join(path.delimiter) })
  }))[0];
  var archive = path.join(fixture, result.filename);
  var packed = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }));
  assert.equal(fs.readFileSync(packageFile, "utf8"), before);
  assert.deepEqual(packed.bin, { "clay-server": "./bin/cli.js" });
  assert.equal(packed.bin["clay-dev"], undefined);
  ['preinstall', 'install', 'postinstall', 'prepare'].forEach(function (hook) { assert.equal(packed.scripts[hook], undefined); });
  var unpacked = path.join(fixture, 'unpacked'); fs.mkdirSync(unpacked);
  execFileSync('tar', ['-xf', archive, '-C', unpacked]);
  var packedRoot = path.join(unpacked, 'package/lib/public');
  var recorded = readJson(path.join(packedRoot, 'pane-assets/manifest.json'));
  Object.entries(Object.assign({}, recorded.inputs, recorded.outputs)).forEach(function (entry) {
    var file = path.join(packedRoot, entry[0]);
    assert.ok(fs.existsSync(file), 'packed input/output missing: ' + entry[0]);
    assert.equal(require('../lib/pane-asset-manifest').digest(fs.readFileSync(file)), entry[1], 'packed digest: ' + entry[0]);
  });
  var manifest = require('../lib/pane-asset-manifest').createPaneAssets(fs.realpathSync(path.join(unpacked, 'package/lib/public')))();
  assert.ok(manifest, 'the actual npm archive contains fresh generated assets and their source inputs');
  assert.ok(manifest.outputs[manifest.js]); assert.ok(manifest.outputs[manifest.css]);
  assert.equal(fs.existsSync(path.join(unpacked, 'package/scripts/build-pane-assets.js')), false, 'build tooling is not a runtime install dependency');
});
