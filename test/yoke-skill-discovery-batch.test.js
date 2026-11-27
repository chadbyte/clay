var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var childProcess = require("child_process");

var skills = require("../lib/yoke/skill-discovery");
var osUsers = require("../lib/os-users");

function createSkill(root, directoryName, name, description) {
  var skillDir = path.join(root, directoryName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: " + name + "\ndescription: " + description + "\n---\n\nBody\n");
}

function withFixture(fn) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-skills-batch-"));
  var homeDir = path.join(root, "home");
  var cwd = path.join(root, "project");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  createSkill(path.join(homeDir, ".claude", "skills"), "review", "review", "User review");
  createSkill(path.join(cwd, "skills"), "deploy", "deploy", "Project deploy");
  createSkill(path.join(cwd, "skills"), "report", "report", "Project report");
  // Vendor roots that alias the project source through symlinks (a common layout).
  fs.mkdirSync(path.join(cwd, ".claude", "skills"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".agents", "skills"), { recursive: true });
  fs.symlinkSync("../../skills/deploy", path.join(cwd, ".claude", "skills", "deploy"));
  fs.symlinkSync("../../skills/report", path.join(cwd, ".agents", "skills", "report"));
  fs.symlinkSync("../../skills/missing", path.join(cwd, ".agents", "skills", "dangling"));
  fs.mkdirSync(path.join(cwd, "skills", "no-skill-md"), { recursive: true });
  try { return fn({ homeDir: homeDir, cwd: cwd }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// No uid/gid: the helper processes run as the current test user without setpriv.
function userInfo(fixture) { return { home: fixture.homeDir, user: os.userInfo().username }; }
function perFileOptions(fixture) {
  return skills.optionsForOsUser(userInfo(fixture), function (op, args, info) { return osUsers.fsAsUser(op, args, info); });
}
function withExecSpy(onCall, fn) {
  var original = childProcess.execFileSync;
  childProcess.execFileSync = function (command, args) { onCall(command, args || []); return original.apply(childProcess, arguments); };
  try { return fn(); } finally { childProcess.execFileSync = original; }
}
function isBatchScript(args) { return args.indexOf("-e") !== -1 && args.join(" ").indexOf("var roots =") !== -1; }

test("os-user discovery scans all roots in one helper process with per-file results", function () {
  withFixture(function (fixture) {
    var expected = skills.discoverSkills(fixture.cwd, perFileOptions(fixture));
    var batchCalls = 0;
    var actual = withExecSpy(function (command, args) { if (isBatchScript(args)) batchCalls++; }, function () {
      return skills.discoverSkills(fixture.cwd, skills.optionsForOsUser(userInfo(fixture)));
    });
    assert.deepStrictEqual(actual, expected);
    assert.strictEqual(batchCalls, 1);
    assert.ok(actual.some(function (skill) { return skill.name === "deploy"; }));
  });
});

test("os-user discovery falls back to per-file reads when the batch helper fails", function () {
  withFixture(function (fixture) {
    var expected = skills.discoverSkills(fixture.cwd, perFileOptions(fixture));
    var original = childProcess.execFileSync;
    var errors = console.error;
    childProcess.execFileSync = function (command, args) {
      if (isBatchScript(args || [])) throw new Error("simulated helper failure");
      return original.apply(childProcess, arguments);
    };
    console.error = function () {};
    try {
      assert.deepStrictEqual(skills.discoverSkills(fixture.cwd, skills.optionsForOsUser(userInfo(fixture))), expected);
    } finally { childProcess.execFileSync = original; console.error = errors; }
  });
});

test("injected fsAsUser keeps per-file behaviour (no batch helper)", function () {
  withFixture(function (fixture) {
    var batchCalls = 0;
    withExecSpy(function (command, args) { if (isBatchScript(args)) batchCalls++; }, function () {
      skills.discoverSkills(fixture.cwd, perFileOptions(fixture));
    });
    assert.strictEqual(batchCalls, 0);
  });
});
