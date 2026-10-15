// Reserve a new project directory before running Git or changing ownership.
// Filesystem identity checks also keep failed attempts from deleting targets
// replaced by another actor. Hostile OS/root mutation is outside this boundary.
var fs = require("fs");
var path = require("path");

function canonical(candidate) {
  var current = path.resolve(candidate);
  var missing = [];
  while (true) {
    try { return path.join.apply(path, [fs.realpathSync(current)].concat(missing)); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      // A dangling symlink is an existing object, not a missing directory.
      try { fs.lstatSync(current); throw new Error("A project path contains a dangling symlink."); }
      catch (statError) { if (statError.code !== "ENOENT") throw statError; }
      var parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function inside(root, candidate) {
  var relative = path.relative(root, candidate);
  return relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative);
}

function rejectIntersection(target, projects, userId) {
  (projects || []).forEach(function (project) {
    var root = canonical(project.path);
    if (target === root || inside(target, root) || (project.ownerId !== userId && inside(root, target))) {
      throw new Error("The destination intersects a registered project.");
    }
  });
}

function claim(options) {
  var slug = options.slug;
  if (!slug || slug === "." || slug === ".." || path.basename(slug) !== slug) throw new Error("Invalid project directory name.");
  var base = canonical(options.baseDir);
  var target = path.join(base, slug);
  rejectIntersection(target, options.projects, options.userId);
  fs.mkdirSync(base, { recursive: true });
  if (fs.realpathSync(options.baseDir) !== base) throw new Error("The project base directory changed.");
  rejectIntersection(target, options.projects, options.userId);
  // EEXIST rejects directories, files, symlinks and concurrent claims alike.
  fs.mkdirSync(target, { mode: 0o700 });
  var identity = fs.lstatSync(target);
  function assertOwned() {
    var current = fs.lstatSync(target);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || fs.realpathSync(base) !== base) {
      throw new Error("The claimed project directory changed.");
    }
  }
  function cleanup() {
    try { assertOwned(); } catch (error) { return false; }
    fs.rmSync(target, { recursive: true });
    return true;
  }
  return { path: target, assertOwned: assertOwned, cleanup: cleanup };
}

module.exports = { claim: claim, canonical: canonical };
