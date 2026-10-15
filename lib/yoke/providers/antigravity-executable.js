// One authoritative resolver for both installation discovery and adapter init.
var resolvePath = require("../discovery").pathResolver("agy", "ANTIGRAVITY_CLI_PATH");
function resolve(options) {
  options = options || {};
  if (options.user) return null;
  return resolvePath(options);
}
module.exports = { resolve: resolve };
