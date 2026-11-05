var crypto = require('crypto');
var local = require('./mcp-local-configuration');
var network = require('./mcp-network');
var ACTIONS = ['add_local', 'add_remote', 'enable', 'disable', 'test', 'rename', 'remove', 'signin', 'xcode_connect', 'xcode_disconnect', 'client_enable', 'client_disable', 'client_setup', 'enter_credentials', 'enter_token', 'permissions'];
function exact(args, keys) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(function (key) { return keys.indexOf(key) < 0; })) throw new Error('Unsupported MCP management input.');
}
function name(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Enter a valid ' + field + '.');
  return value.trim();
}
function createManagementService(ctx) {
  function version(owner) {
    return crypto.createHash('sha256').update(JSON.stringify([ctx.remote.managementVersion(owner), ctx.clientVersion(owner)])).digest('hex');
  }
  async function read(owner, args, authorize) {
    exact(args, ['id', 'checkXcode', 'offset', 'limit']); authorize();
    if (args.checkXcode !== undefined && typeof args.checkXcode !== 'boolean') throw new Error('Invalid Xcode check flag.');
    if (args.checkXcode) await ctx.remote.inspectXcode(owner, authorize);
    authorize();
    var state = ctx.state(owner), rows = state.servers;
    var output = { status: 'observed', revision: version(owner), extensionConnected: state.extensionConnected, bridgeConnected: state.hostConnected, xcode: state.xcode,
      setup: ['Local MCP', 'Remote MCP URL', 'Import vendor config', 'Client MCP'],
      humanSteps: ['Enter access tokens and credential values only in the MCP settings form.', 'Extension installation, bridge installation, extension server definitions and Xcode settings are human setup operations.', 'Permissions opens the existing session policy editor; this tool does not change session approval policy.'] };
    if (args.id !== undefined) {
      var id = name(args.id, 'connection ID', 300), row = rows.find(function (item) { return item.id === id; });
      if (!row) throw new Error('Connection is unavailable.');
      var offset = args.offset === undefined ? 0 : args.offset, limit = args.limit === undefined ? 50 : args.limit;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Use a non-negative offset and a limit from 1 to 100.');
      output.connection = Object.assign({}, row, { tools: (row.tools || []).slice(offset, offset + limit) });
      output.nextOffset = offset + limit < (row.tools || []).length ? offset + limit : null;
    } else output.connections = rows.map(function (row) { var result = Object.assign({}, row); delete result.tools; return result; });
    return output;
  }
  function prepare(owner, args, session, authorize) {
    authorize();
    var action = args.action;
    if (ACTIONS.indexOf(action) < 0) throw new Error('Unsupported MCP management action.');
    var keys = ['action'], msg = {}, target, screen, title, config;
    if (action === 'add_local') keys = keys.concat(['label', 'command', 'args', 'cwd']);
    else if (action === 'add_remote') keys.push('url');
    else if (['xcode_connect', 'xcode_disconnect', 'client_setup'].indexOf(action) < 0) keys.push('id');
    if (action === 'rename') keys.push('label');
    exact(args, keys);
    var snapshot = version(owner), remoteVersion = ctx.remote.managementVersion(owner), identity = ctx.identityKey(owner);
    if (keys.indexOf('id') >= 0) {
      target = ctx.state(owner).servers.find(function (row) { return row.id === name(args.id, 'connection ID', 300); });
      if (!target) throw new Error('Connection is unavailable.');
      msg.id = target.id;
    }
    if (action === 'add_local') {
      config = local.configuration({ label: args.label, command: args.command, argumentsJson: JSON.stringify(args.args === undefined ? [] : args.args), cwd: args.cwd }, ctx.identity(owner));
      msg = { action: 'add_local', label: config.label, command: config.command, argumentsJson: JSON.stringify(config.args), cwd: config.cwd };
      title = 'Save a DISABLED Local MCP connection: ' + config.label + '\nCommand: ' + config.command + '\nArguments: ' + JSON.stringify(config.args) + '\nWorking directory: ' + config.cwd + '\nNo program starts until a separate Enable or Test action.';
    } else if (action === 'add_remote') {
      msg = { action: 'add', url: network.remoteUrl(args.url).href };
      title = 'Add and test remote MCP: ' + msg.url + '\nClay will contact this public HTTPS service. The saved connection starts disabled.';
    } else if (action === 'client_setup') { screen = 'client'; title = 'Open Client MCP setup on this exact owner interface. Extension and bridge installation remain human steps.'; }
    else if (['enter_credentials', 'enter_token', 'permissions'].includes(action)) {
      if (target.source === 'computer' && action !== 'permissions' || target.source !== 'url' && action === 'enter_token' || action === 'enter_credentials' && !(target.references || []).length) throw new Error('This connection does not support that settings form.');
      screen = action === 'enter_credentials' ? 'credentials' : action === 'enter_token' ? 'token' : 'permissions';
      title = 'Open ' + screen + ' for ' + target.label + '. Enter secrets only in the existing secure settings form. Opening does not change any values.';
    } else if (action === 'client_enable' || action === 'client_disable') {
      if (target.source !== 'computer') throw new Error('Select an exact Client MCP connection.');
      title = (action === 'client_enable' ? 'Enable' : 'Disable') + ' Client MCP ' + target.label + ' for this project. This changes tool availability, not approval for individual calls.';
    } else {
      if (target && target.source === 'computer') throw new Error('Client MCP supports project enable/disable and setup; edit its definitions in the extension.');
      msg.action = action === 'enable' || action === 'disable' ? 'enable' : action;
      if (msg.action === 'enable') msg.enabled = action === 'enable';
      if (action === 'rename') msg.label = name(args.label, 'name', 100);
      title = action.replace(/_/g, ' ') + ': ' + (target ? target.label + ' (' + target.id + ')' : 'Xcode on the Clay host');
      if (target && target.integration === 'xcode' && action === 'enable') msg.action = 'xcode_connect';
      if (['enable', 'test', 'xcode_connect'].includes(action)) title += '\nThis can start a program on the Clay host or contact its MCP service. Tools become available to your supported private sessions and Mates after enablement; individual calls still follow session approval policy.';
      if (action === 'remove') title += '\nRemoves this saved connection and its stored credentials. This cannot undo earlier tool calls.';
      if (action === 'signin') title += '\nStarts the existing private sign-in browser for the authenticated owner. The agent receives no credentials; starting sign-in is not completed authentication.';
    }
    var question = title + '\nAccount: ' + owner + '\nConnection revision: ' + snapshot + '\nOnly this exact action is reviewed. Stop cancels further work; uncertain effects are never replayed automatically.';
    if (question.length > 2000) throw new Error('This change exceeds the review card limit. Use MCP settings to review its complete configuration.');
    return { action: action, review: question, version: snapshot, validate: function () { authorize(); if (ctx.identityKey(owner) !== identity || version(owner) !== snapshot) throw new Error('MCP target or OS identity changed. Inspect again.'); }, execute: async function (ws, signal, started) {
      function check() { authorize(); if (signal.aborted || ctx.identityKey(owner) !== identity || !ctx.canRespond(ws, session, owner)) throw new Error('MCP review expired, stopped, or owner identity changed.'); }
      check(); if (version(owner) !== snapshot) throw new Error('MCP connections changed. Inspect the change again.');
      if (screen) { started(); return ctx.openSettings(owner, ws, screen, target && target.id, session, check, signal); }
      if (action === 'client_enable' || action === 'client_disable') {
        started(); ctx.toggleClient(owner, target.name, action === 'client_enable', check); check();
        return { status: 'persisted', id: target.id, enabled: action === 'client_enable', scope: 'project' };
      }
      var id = await ctx.remote.command(owner, msg, ws, { version: remoteVersion, authorize: check, signal: signal, started: started });
      check();
      var row = ctx.remote.view(owner).find(function (item) { return item.id === id; });
      var status = action === 'test' ? 'tested' : action === 'signin' ? row && row.status === 'ready' ? 'connection_ready' : 'sign_in_started' : action === 'xcode_disconnect' && !id ? 'unchanged' : 'persisted';
      return { status: status, id: id, connection: row || null, message: status === 'sign_in_started' ? 'Sign-in started; authentication completion has not been observed.' : 'Read connections to verify current availability before continuing.' };
    } };
  }
  return { read: read, prepare: prepare, version: version };
}
module.exports = { createManagementService: createManagementService, ACTIONS: ACTIONS };
