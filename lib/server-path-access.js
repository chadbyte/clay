// Directory pickers and project registration must not become content-access
// bypasses through another spelling, symlink or nested directory.
var fs = require("fs");
var path = require("path");
function inside(root, target) {
  var relative = path.relative(root, target);
  return relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative);
}
function attachPathAccess(ctx) {
  return function (userId, requested) {
    if (!ctx.users.isMultiUser()) return true;
    var user = userId && ctx.users.findUserById(userId);
    if (!user) return false;
    var target;
    try { target = fs.realpathSync(requested); } catch (error) { return false; }
    var allowed = false;
    var denied = false;
    ctx.projects.forEach(function (project, slug) {
      var status = project.getStatus();
      var root;
      try { root = fs.realpathSync(status.path); } catch (error) { return; }
      if (inside(root, target) || inside(target, root)) {
        if (!ctx.canAccess(userId, slug)) denied = true;
        else if (inside(root, target)) allowed = true;
      }
    });
    if (denied) return false;
    if (ctx.osUsers) {
      if (!user.linuxUser) return false;
      try {
        var identity = ctx.resolveIdentity(user.linuxUser);
        return inside(fs.realpathSync(identity.home), target);
      } catch (error) { return false; }
    }
    return allowed || ctx.users.getAllUsers().length === 1;
  };
}
module.exports = { attachPathAccess: attachPathAccess };
