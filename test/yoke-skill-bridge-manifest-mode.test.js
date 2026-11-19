var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var skills = require("../lib/yoke/skill-discovery");

test("Claude skill bridge manifest is readable by the mapped OS user", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-bridge-mode-"));
  var oldUmask = process.umask(0o022);
  try {
    var homeDir = path.join(root, "home");
    var source = path.join(root, "project", "skills");
    fs.mkdirSync(source, { recursive: true });
    var pluginDir = skills.ensureClaudeCodexPlugin({ homeDir: homeDir, source: source, name: "shared-project-test" });
    assert.ok(pluginDir);
    var mode = fs.statSync(path.join(pluginDir, ".claude-plugin", "plugin.json")).mode & 0o777;
    // The root daemon creates this file inside the mapped user home; Claude then runs as that user.
    assert.strictEqual(mode & 0o044, 0o044, "plugin.json must be group/other readable, got " + mode.toString(8));
  } finally { process.umask(oldUmask); fs.rmSync(root, { recursive: true, force: true }); }
});
