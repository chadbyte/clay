var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var resolveFilePath = require("../lib/project-file-path").resolveFilePath;
var fileError = require("../lib/project-file-path").fileError;

test("OS-authorized file targets resolve relative and absolute paths without daemon realpath", function () {
  var cwd = "/srv/projects/demo";
  var scope = { projectBound: false };
  assert.equal(resolveFilePath(cwd, "../../shared/readme.md", scope), path.resolve(cwd, "../../shared/readme.md"));
  assert.equal(resolveFilePath(cwd, "/opt/shared/readme.md", scope), "/opt/shared/readme.md");
});

test("bounded paths reject traversal and symlinks while distinguishing missing files", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-file-path-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var cwd = path.join(root, "project");
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(root, "secret"), "private");
  fs.symlinkSync(path.join(root, "secret"), path.join(cwd, "link"));
  ["../secret", "link", "../missing", path.join(root, "secret")].forEach(function (target) {
    assert.throws(function () { resolveFilePath(cwd, target); }, { code: "FILE_SCOPE" });
  });
  assert.throws(function () { resolveFilePath(cwd, "missing"); }, { code: "ENOENT" });
  fs.writeFileSync(path.join(cwd, "file"), "public");
  assert.equal(resolveFilePath(cwd, "file"), fs.realpathSync(path.join(cwd, "file")));
});

test("empty and malformed paths fail closed even for unbounded scope", function () {
  ["", null, {}, "file\0name"].forEach(function (target) {
    assert.throws(function () { resolveFilePath("/tmp", target, { projectBound: false }); }, { code: "INVALID_PATH" });
  });
});

test("file errors distinguish OS denial and missing paths, including mapped subprocess failures", function () {
  assert.equal(fileError({ code: "ENOENT" }).status, 404);
  assert.equal(fileError({ code: "EACCES" }).status, 403);
  assert.match(fileError({ code: "EPERM" }).message, /operating system denied/);
  assert.equal(fileError({ stderr: Buffer.from("Error: permission denied\n code: 'EACCES'") }).code, "EACCES");
});
