var StdioClientTransport = require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport;
var wrapSpawnAsUser = require('./os-users').wrapSpawnAsUser;
var os = require('os');
function localTransport(row, identity) {
  if ((row.references || []).length || (row.environmentNames || []).some(function (name) { return !Object.prototype.hasOwnProperty.call(row.env || {}, name); })) throw new Error('Configure required environment values before connecting.');
  var home = identity ? identity.home : os.homedir();
  var env = Object.assign({ HOME: home, USER: identity ? identity.user : os.userInfo().username, LOGNAME: identity ? identity.user : os.userInfo().username, SHELL: identity ? identity.shell || '/bin/sh' : '/bin/sh', PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' }, row.env || {});
  var wrapped = wrapSpawnAsUser(row.command, row.args, identity ? { uid: identity.uid, gid: identity.gid, env: env } : { env: env });
  // The SDK cannot apply uid/gid itself; never fall back to spawning as the daemon.
  if (wrapped.options.uid != null || wrapped.options.gid != null) throw new Error('Install util-linux setpriv to run MCP as the account OS user.');
  return new StdioClientTransport({ command: wrapped.command, args: wrapped.args, env: env, cwd: row.cwd, stderr: 'ignore' });
}
module.exports = { localTransport: localTransport };
