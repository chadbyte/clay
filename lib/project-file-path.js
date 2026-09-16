var path = require("path");

// Resolve a file-browser target in the caller's project namespace. Ordinary
// mode delegates to safePath, which enforces the realpath/symlink boundary.
// OS-user mode deliberately returns the project-relative absolute target and
// leaves access enforcement to the mapped user's filesystem operation.
function resolveFilePath(cwd, requested, safePath, osUserInfo) {
  if (typeof requested !== "string" || !requested) return null;
  if (osUserInfo) return path.resolve(cwd, requested);
  return typeof safePath === "function" ? safePath(cwd, requested) : null;
}

module.exports = { resolveFilePath: resolveFilePath };
