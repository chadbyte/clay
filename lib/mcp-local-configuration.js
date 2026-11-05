var path = require('path');
var os = require('os');
var normalize = require('./yoke/mcp-source-adapters').normalize;

function configuration(msg, identity) {
  if (typeof msg.label !== 'string' || !msg.label.trim() || msg.label.length > 100 || /[\u0000-\u001f]/.test(msg.label)) throw new Error('Use a name between 1 and 100 characters.');
  if (typeof msg.command !== 'string' || !msg.command.trim() || msg.command.length > 4096 || /[\u0000-\u001f]/.test(msg.command)) throw new Error('Enter an executable command without shell syntax.');
  if (typeof msg.argumentsJson !== 'string' || msg.argumentsJson.length > 16384) throw new Error('Enter arguments as a JSON array of strings.');
  var args;
  try { args = JSON.parse(msg.argumentsJson); } catch (error) { throw new Error('Enter arguments as a JSON array of strings, for example ["-y", "your-mcp-package"].'); }
  if (!Array.isArray(args) || args.length > 100 || args.some(function (value) { return typeof value !== 'string' || value.includes('\0'); })) throw new Error('Enter at most 100 string arguments in a JSON array.');
  if (msg.cwd !== undefined && (typeof msg.cwd !== 'string' || msg.cwd.length > 4096 || /[\u0000-\u001f]/.test(msg.cwd))) throw new Error('Use an absolute working directory.');
  var cwd = msg.cwd && msg.cwd.trim() || (identity ? identity.home : os.homedir());
  if (!cwd || !path.isAbsolute(cwd)) throw new Error('Use an absolute working directory.');
  var config = normalize('claude', msg.label.trim(), { command: msg.command.trim(), args: args, cwd: cwd }, { scope: 'user', cwd: cwd });
  delete config.provenance; delete config.sourceEnabled;
  config.tools = [];
  return config;
}
module.exports = { configuration: configuration };
