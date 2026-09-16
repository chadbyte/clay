var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var resolveFilePath = require("../lib/project-file-path").resolveFilePath;

test("OS-user file targets resolve relative paths from the project cwd", function () {
  var cwd = "/srv/projects/demo";
  var safePath = function () { throw new Error("ordinary resolver should not run"); };
  var identity = { uid: 1201, gid: 1201 };
  assert.equal(resolveFilePath(cwd, "../../shared/readme.md", safePath, identity), path.resolve(cwd, "../../shared/readme.md"));
  assert.equal(resolveFilePath(cwd, "/opt/shared/readme.md", safePath, identity), "/opt/shared/readme.md");
});

test("ordinary file targets retain the safePath boundary", function () {
  var called = [];
  var result = resolveFilePath("/srv/projects/demo", "../secret.txt", function (cwd, requested) {
    called.push([cwd, requested]);
    return null;
  }, null);
  assert.equal(result, null);
  assert.deepEqual(called, [["/srv/projects/demo", "../secret.txt"]]);
});

test("missing targets and non-string targets fail closed", function () {
  assert.equal(resolveFilePath("/srv/projects/demo", "", function () { return "/tmp/no"; }, null), null);
  assert.equal(resolveFilePath("/srv/projects/demo", null, function () { return "/tmp/no"; }, { uid: 1 }), null);
});
