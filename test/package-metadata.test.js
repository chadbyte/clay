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
  return fixture;
}

test("source package metadata is production-only and preserves explicit dev mode", function () {
  var packageJson = readJson(path.join(root, "package.json"));
  var lock = readJson(path.join(root, "package-lock.json"));
  assert.deepEqual(packageJson.bin, { "clay-server": "./bin/cli.js" });
  assert.deepEqual(lock.packages[""].bin, { "clay-server": "bin/cli.js" });
  assert.equal(packageJson.scripts.dev, "node bin/cli.js --dev");
  assert.equal(packageJson.scripts.prepack, undefined);
  assert.equal(packageJson.scripts.postpack, undefined);
});

test("npm pack keeps the source manifest unchanged and publishes production-only metadata", function (t) {
  var fixture = createPackFixture(t);
  var packageFile = path.join(fixture, "package.json");
  var before = fs.readFileSync(packageFile, "utf8");
  var result = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", fixture], {
    cwd: fixture,
    encoding: "utf8",
    env: Object.assign({}, process.env, { npm_config_loglevel: "silent" })
  }))[0];
  var archive = path.join(fixture, result.filename);
  var packed = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }));
  assert.equal(fs.readFileSync(packageFile, "utf8"), before);
  assert.deepEqual(packed.bin, { "clay-server": "./bin/cli.js" });
  assert.equal(packed.bin["clay-dev"], undefined);
});
