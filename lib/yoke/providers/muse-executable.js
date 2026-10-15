// Discovery and startup share this resolver; an invalid override never falls back.
var path = require("path");
var discovery = require("../discovery");
var onPath = discovery.pathResolver("muse");
function resolve(options) {
  options = options || {};
  if (options.user || options.linuxUser || options.osUsers) return null;
  var env = options.env || process.env;
  var explicit = discovery.explicitEntry(env, "MUSE_CODE_PATH", false);
  if (explicit !== undefined) return explicit;
  var found = onPath(options);
  if (found) return found;
  var home = options.home || require("../../config").REAL_HOME || require("os").homedir();
  var local = path.join(home, ".local", "bin", process.platform === "win32" ? "muse.exe" : "muse");
  return discovery.validEntry(local, false) ? local : null;
}
module.exports = { resolve: resolve };
