var path = require("path");
var fs = require("fs");

function failure(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function inside(base, target) {
  var relative = path.relative(base, target);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

// Scope is server-derived for each request. In personal and mapped OS-user
// modes, the actual filesystem operation enforces read/write permissions.
// Unmapped multi-user deployments retain the project and symlink boundary.
function resolveFilePath(cwd, requested, scope) {
  if (typeof requested !== "string" || !requested || requested.indexOf("\0") !== -1) {
    throw failure("INVALID_PATH", "Invalid file path");
  }
  var resolved = path.resolve(cwd, requested);
  if (scope && scope.projectBound === false) return resolved;
  if (!inside(path.resolve(cwd), resolved)) {
    throw failure("FILE_SCOPE", "This file is outside your project's allowed file scope");
  }
  var base = fs.realpathSync(cwd);
  var real = fs.realpathSync(resolved);
  if (!inside(base, real)) {
    throw failure("FILE_SCOPE", "This file links outside your project's allowed file scope");
  }
  return real;
}

function fileError(error) {
  var code = error.code;
  // OS-user helpers report child-process failures through stderr.
  if (error.stderr) {
    var match = String(error.stderr).match(/code: ['"](EACCES|EPERM|ENOENT|ENOTDIR)['"]/);
    if (match) code = match[1];
  }
  if (code === "ENOENT" || code === "ENOTDIR") return { code: code, status: 404, message: "File or folder not found" };
  if (code === "EACCES" || code === "EPERM") return { code: code, status: 403, message: "The operating system denied access for your account" };
  if (code === "INVALID_PATH") return { code: code, status: 400, message: error.message };
  if (code === "FILE_SCOPE" || code === "FILE_FORBIDDEN" || code === "OS_IDENTITY") return { code: code, status: 403, message: error.message };
  return { code: code || "FILE_ERROR", status: 500, message: error.message || "File operation failed" };
}

module.exports = { resolveFilePath: resolveFilePath, fileError: fileError, failure: failure };
