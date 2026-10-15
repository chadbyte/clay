// Installation resolution shared by adapter creation, startup and product UI.
// This never starts a provider; callers may replace resolvers for isolated tests.
var fs = require('fs');
var cp = require('child_process');
function onPath(binary, user) {
  try {
    if (user && !/^[a-z_][a-z0-9_-]*\$?$/i.test(user)) return null;
    var command = user ? 'su' : process.platform === 'win32' ? 'where' : 'which';
    var args = user ? ['-', user, '-c', 'which ' + binary] : [binary];
    if (!/^[a-zA-Z0-9_.-]+$/.test(binary)) return null;
    var result = cp.execFileSync(command, args, { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] });
    return String(result || '').trim().split(/\r?\n/)[0] || null;
  } catch (error) { return null; }
}
// Native commands require an executable regular file. SDK-owned JavaScript
// entries are readable files launched through Node, not native executables.
function validEntry(file, script) {
  try {
    if (typeof file !== 'string' || !file || !fs.statSync(file).isFile()) return false;
    fs.accessSync(file, script && /\.(?:c|m)?js$/i.test(file) ? fs.constants.R_OK : fs.constants.X_OK);
    return true;
  } catch (error) { return false; }
}
function explicitEntry(env, name, script) {
  if (!Object.prototype.hasOwnProperty.call(env, name)) return undefined;
  if (!validEntry(env[name], script)) throw new Error('Invalid explicit provider executable: ' + name);
  return env[name];
}
function pathResolver(binary, override) {
  return function(options) {
    options = options || {};
    var env = options.env || process.env;
    if (!options.user && override) {
      var explicit = explicitEntry(env, override, false);
      if (explicit !== undefined) return explicit;
    }
    var resolved = onPath(binary, options.user);
    return options.user || validEntry(resolved, false) ? resolved : null;
  };
}
function bundledResolver(find, binary) {
  return function(options) {
    options = options || {};
    // The mapped account cannot inherit the daemon account's installation.
    if (options.user) return onPath(binary, options.user);
    // The runtime resolver owns all fallback policy. Adding a discovery-only
    // PATH fallback would advertise a runtime that its adapter cannot start.
    return find();
  };
}
function acpResolver(vendor) {
  return function(options) {
    if (options && options.user) return null;
    var profiles = require('./acp-agent-profiles');
    return profiles.findAcpAgentPath(profiles.getAcpAgentProfile(vendor));
  };
}
function installed(options) {
  var registry = options && options.registry || require('./vendor-registry').VENDOR_REGISTRY;
  var result = {};
  Object.keys(registry).forEach(function(vendor) {
    var info = registry[vendor];
    result[vendor] = false;
    if (options && options.user && info.osUserIsolation !== true) return;
    if (typeof info.resolveExecutable !== 'function') return;
    try { result[vendor] = !!info.resolveExecutable(options || {}); } catch (error) {}
  });
  return result;
}
module.exports = { installed: installed, pathResolver: pathResolver, bundledResolver: bundledResolver, acpResolver: acpResolver, validEntry: validEntry, explicitEntry: explicitEntry };
