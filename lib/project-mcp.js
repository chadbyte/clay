var crypto = require('crypto');
var createProxy = require('./mcp-proxy').createProxy;
var createStore = require('./mcp-connection-store').createConnectionStore;
var createRemoteConnections = require('./mcp-remote-connections').createRemoteConnections;

function attachMcp(ctx) {
  var devices = new Map(), pending = new Map();
  function ownerFor(ws) {
    if (!ctx.canAccess(ws)) throw new Error('MCP access is not permitted.');
    return ctx.isMultiUser() ? String(ws._clayUser.id) : 'default';
  }
  function authorizeOwner(owner) { if (!ctx.canUseOwner(owner)) throw new Error('MCP account is unavailable.'); }
  function sendOwner(owner, msg) {
    ctx.clients.forEach(function (ws) {
      try { if (ws.readyState === 1 && ownerFor(ws) === owner) ctx.sendTo(ws, Object.assign({ slug: ctx.slug }, msg)); } catch (error) {}
    });
  }
  var remote = createRemoteConnections({
    remoteFetch: ctx.remoteFetch, createLoginBrowser: ctx.createLoginBrowser,
    storage: ctx.storage || createStore(ctx.root, ctx.slug), authorize: authorizeOwner,
    changed: function (owner) { broadcast(owner); }, sendOwner: sendOwner, sendTo: function (ws, msg) { ctx.sendTo(ws, Object.assign({ slug: ctx.slug }, msg)); },
    identity: ctx.identity,
    canAccess: function (ws, owner) { try { return ownerFor(ws) === owner; } catch (error) { return false; } },
  });
  function deviceFor(owner) {
    var device = devices.get(owner);
    if (!device || device.ws.readyState !== 1) return null;
    try { if (ownerFor(device.ws) !== owner) return null; } catch (error) { return null; }
    return device;
  }
  function enabled(owner, name) {
    var legacy = !ctx.isMultiUser() && (ctx.getEnabledMcpServers() || []).indexOf(name) >= 0;
    return remote.computerEnabled(owner, name, legacy);
  }
  function buildState(owner) {
    var active = deviceFor(owner), device = devices.get(owner), servers = remote.view(owner);
    if (device) device.servers.forEach(function (server) {
      servers.push({ id: server.name, name: server.name, label: server.name, source: 'computer', transport: 'stdio',
        toolCount: server.tools.length, tools: server.tools, projectEnabled: enabled(owner, server.name),
        extensionEnabled: server.enabled, status: active && server.enabled && device.hostConnected ? 'ready' : 'unavailable',
        error: active && device.hostConnected ? '' : 'Reconnect the local bridge on your computer.' });
    });
    return { type: 'mcp_servers_state', slug: ctx.slug, servers: servers,
      hostConnected: !!(active && device.hostConnected), extensionConnected: !!active,
      extensionId: device ? device.extensionId : null };
  }
  function broadcast(owner) {
    try { sendOwner(owner, buildState(owner)); } catch (error) {}
  }
  function sendConnectionState(ws) {
    try { ctx.sendTo(ws, buildState(ownerFor(ws))); } catch (error) {}
  }
  function disconnectDevice(ws) {
    devices.forEach(function (device, owner) {
      if (ws && device.ws !== ws) return;
      if (!ws && device.ws.readyState === 1) return;
      device.hostConnected = false;
      pending.forEach(function (call, id) {
        if (call.ws !== device.ws) return;
        clearTimeout(call.timer); pending.delete(id); call.reject(new Error('Your computer disconnected.'));
      });
      broadcast(owner);
    });
  }
  function handleMcpMessage(ws, msg) {
    if (!msg || typeof msg.type !== 'string' || (msg.type.indexOf('mcp_') !== 0 && msg.type !== 'mcp_toggle_server')) return false;
    var owner;
    try { owner = ownerFor(ws); } catch (error) { return true; }
    if (msg.type === 'mcp_state_request') { sendConnectionState(ws); return true; }
    if (msg.type === 'mcp_servers_available') {
      var servers = Array.isArray(msg.servers) ? msg.servers : [];
      if (servers.length > 100 || JSON.stringify(servers).length > 2 * 1024 * 1024) return true;
      servers = servers.filter(function (server) { return server && /^[a-zA-Z0-9_-]{1,80}$/.test(server.name) && !/^(clay-|remote-)/.test(server.name) && !Object.prototype.hasOwnProperty.call(Object.prototype, server.name) && !server.url && server.transport !== 'http'; }).map(function (server) {
        return { name: server.name, enabled: server.enabled !== false, tools: Array.isArray(server.tools) ? server.tools.slice(0, 1000) : [] };
      });
      var old = devices.get(owner);
      if (old && old.ws !== ws) disconnectDevice(old.ws);
      devices.set(owner, { ws: ws, servers: servers, hostConnected: !!msg.hostConnected, extensionId: ctx.extensionId(ws) });
      broadcast(owner); return true;
    }
    if (msg.type === 'mcp_tool_result' || msg.type === 'mcp_tool_error') {
      var call = pending.get(msg.callId);
      if (!call || call.ws !== ws || call.owner !== owner) return true;
      clearTimeout(call.timer); pending.delete(msg.callId);
      try { call.authorize(); } catch (error) { call.reject(error); return true; }
      if (msg.type === 'mcp_tool_error') call.reject(new Error('Computer MCP tool failed.'));
      else call.resolve(msg.result || { content: [] });
      return true;
    }
    if (msg.type.indexOf('mcp_login_') === 0) { remote.handleBrowser(owner, ws, msg); return true; }
    if (msg.type === 'mcp_toggle_server') {
      var device = deviceFor(owner);
      if (device && device.servers.some(function (server) { return server.name === msg.name; })) {
        try { remote.toggleComputer(owner, msg.name, msg.enabled); } catch (error) { ctx.sendTo(ws, { type: 'mcp_action_result', ok: false, error: error.message }); }
      }
      return true;
    }
    if (msg.type === 'mcp_connection_action') {
      remote.command(owner, msg, ws).then(function (id) {
        if (ownerFor(ws) === owner) ctx.sendTo(ws, { type: 'mcp_action_result', slug: ctx.slug, requestId: msg.requestId, ok: true, id: id, action: msg.action });
      }).catch(function (error) {
        try { if (ownerFor(ws) === owner) ctx.sendTo(ws, { type: 'mcp_action_result', slug: ctx.slug, requestId: msg.requestId, ok: false, error: error.message }); } catch (ignored) {}
      });
      return true;
    }
    return false;
  }
  function callComputer(owner, server, tool, args, authorize) {
    return new Promise(function (resolve, reject) {
      authorize();
      var device = deviceFor(owner);
      if (!device || !device.hostConnected || !enabled(owner, server)) throw new Error('Computer connection is unavailable or disabled.');
      var row = device.servers.find(function (item) { return item.name === server && item.enabled; });
      if (!row || !row.tools.some(function (item) { return item.name === tool; })) throw new Error('Computer tool is unavailable.');
      var id = crypto.randomUUID();
      var timer = setTimeout(function () { pending.delete(id); reject(new Error('Computer tool timed out.')); }, 60000);
      pending.set(id, { owner: owner, ws: device.ws, resolve: resolve, reject: reject, timer: timer, authorize: function () {
        authorize(); if (!enabled(owner, server) || deviceFor(owner) !== device) throw new Error('Computer access changed.');
      } });
      ctx.sendTo(device.ws, { type: 'mcp_tool_call', callId: id, server: server, method: 'tools/call', params: { name: tool, arguments: args } });
    });
  }
  function getMcpServers(session) {
    if (!session || !ctx.canUseSession(session)) return {};
    var owner = ctx.isMultiUser() ? String(session.ownerId) : 'default';
    function authorize() {
      authorizeOwner(owner);
      if (!ctx.canUseSession(session) || (ctx.isMultiUser() && String(session.ownerId) !== owner)) throw new Error('Session MCP access changed.');
    }
    var result = {};
    buildState(owner).servers.forEach(function (server) {
      if (!server.projectEnabled || !server.extensionEnabled || !server.tools.length) return;
      try {
        result[server.name] = createProxy(server.name, server.tools, function (tool, args) {
          return server.source === 'url' ? remote.call(owner, server.id, tool, args, authorize) : callComputer(owner, server.name, tool, args, authorize);
        });
      } catch (error) { /* Unsupported schemas are not advertised as callable tools. */ }
    });
    return result;
  }
  function destroy() {
    pending.forEach(function (call) { clearTimeout(call.timer); call.reject(new Error('MCP closed.')); }); pending.clear();
    devices.clear(); remote.destroy();
  }
  return { handleMcpMessage: handleMcpMessage, getMcpServers: getMcpServers, sendConnectionState: sendConnectionState,
    handleExtensionDisconnect: disconnectDevice, rebuildAndBroadcast: function () { devices.forEach(function (device, owner) { broadcast(owner); }); }, destroy: destroy };
}
module.exports = { attachMcp: attachMcp };
