var childProcess = require('child_process');
var os = require('os');

var COMMAND = '/usr/bin/xcrun';
function isXcode(row) { return row && row.integration === 'xcode'; }
function validate(row) {
  if (row.source !== 'local' || row.transport !== 'stdio' || row.command !== COMMAND || JSON.stringify(row.args) !== '["mcpbridge"]' || Object.keys(row.env || {}).length || row.cwd || row.url || (row.references || []).length) throw new Error('Xcode connection configuration changed. Remove it and connect again from the Xcode tab.');
}
function configuration() {
  return { integration: 'xcode', source: 'local', transport: 'stdio', command: COMMAND, args: ['mcpbridge'], env: {}, label: 'Xcode', enabled: false };
}
function createXcodeSupport(options) {
  options = options || {};
  var platform = options.platform || process.platform;
  var uid = options.uid || process.getuid;
  var execFile = options.execFile || childProcess.execFile;
  function identityKey(identity) { return JSON.stringify(identity ? [identity.uid, identity.gid, identity.home, identity.user] : null); }
  function checkIdentity(identity) {
    if (platform !== 'darwin') throw new Error('Xcode requires Clay Studio to run on the same Mac as Xcode.');
    if (identity && (!uid || identity.uid !== uid())) throw new Error('Run Clay Studio as the macOS user who runs Xcode. Other OS users are not supported.');
  }
  function run(command, args, identity) {
    return new Promise(function (resolve) {
      execFile(command, args, { timeout: 8000, maxBuffer: 16384, env: { HOME: identity ? identity.home : os.homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } }, function (error, stdout, stderr) { resolve({ error: error, output: String(stdout || '') + String(stderr || '') }); });
    });
  }
  async function inspect(identity, authorize) {
    authorize();
    try { checkIdentity(identity); } catch (error) { return { supported: false, ready: false, message: error.message }; }
    var selected = await run(COMMAND, ['--find', 'mcpbridge'], identity);
    authorize();
    if (selected.error) {
      var message = /licen[cs]e/i.test(selected.output) ? 'Open Xcode and accept its license on this Mac, then check again.' : /command line tools|active developer/i.test(selected.output) ? 'Select a full Xcode installation in Xcode Settings → Locations → Command Line Tools, then check again.' : 'Xcode MCP bridge was not found. Install or update Xcode with MCP support and finish its first-launch setup.';
      return { supported: true, ready: false, message: message };
    }
    var running = await run('/usr/bin/pgrep', ['-u', String(uid()), '-x', 'Xcode'], identity);
    authorize();
    if (running.error) return { supported: true, ready: false, message: 'Open Xcode and your project on the Mac running Clay Studio, then check again.' };
    return { supported: true, ready: true, message: 'Xcode is running and its MCP bridge is available. Open your project and allow external agents before connecting.' };
  }
  return { inspect: inspect, checkIdentity: checkIdentity, identityKey: identityKey };
}
module.exports = { createXcodeSupport: createXcodeSupport, configuration: configuration, isXcode: isXcode, validate: validate };
