var crypto = require('crypto');
var Client = require('@modelcontextprotocol/sdk/client/index.js').Client;
var StreamableHTTPClientTransport = require('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport;
var network = require('./mcp-network');
var oauth = require('./mcp-oauth');
var createLoginBrowser = require('./vendor-login-browser').createLoginBrowser;

function createRemoteConnections(ctx) {
  var accounts = new Map(), live = new Map(), flows = new Map(), queues = new Map();
  var remoteFetch = ctx.remoteFetch || network.createRemoteFetch();
  var closed = false;
  function records(owner) {
    ctx.authorize(owner);
    if (!accounts.has(owner)) accounts.set(owner, ctx.storage.load(owner));
    return accounts.get(owner);
  }
  function persist(owner) { ctx.authorize(owner); if (closed) throw new Error('MCP connections closed.'); ctx.storage.save(owner, records(owner)); }
  function find(owner, id) {
    var row = records(owner).find(function (item) { return item.id === id; });
    if (!row) throw new Error('Connection is unavailable.');
    return row;
  }
  function key(owner, id) { return JSON.stringify([owner, id]); }
  function check(owner, row) {
    if (closed || find(owner, row.id) !== row) throw new Error('Connection changed.');
  }
  function changed(owner) { if (!closed) ctx.changed(owner); }
  function view(owner) {
    return records(owner).filter(function (row) { return row.source === 'url'; }).map(function (row) {
      var entry = live.get(key(owner, row.id));
      return { id: row.id, name: row.id, label: row.label, source: 'url', transport: 'http', url: row.url,
        projectEnabled: !!row.enabled, extensionEnabled: true, tools: row.tools || [], toolCount: (row.tools || []).length,
        status: entry ? entry.status : (row.tools ? 'idle' : 'unavailable'), error: entry ? entry.error : '', authMode: row.authMode || 'auto' };
    });
  }
  async function disconnect(owner, id) {
    var entry = live.get(key(owner, id));
    live.delete(key(owner, id));
    if (entry && entry.client) await entry.client.close().catch(function () {});
  }
  function provider(owner, row, flow) {
    return oauth.createOAuthProvider(row, function () { check(owner, row); persist(owner); }, flow);
  }
  async function connect(owner, row, flow) {
    check(owner, row);
    await disconnect(owner, row.id);
    check(owner, row);
    if (flow && flow.cancelled) throw new Error('Sign-in expired.');
    var client = new Client({ name: 'clay', version: '1.0.0' }, { capabilities: {} });
    var options = { fetch: remoteFetch.fetch };
    if (row.authMode === 'token' && row.token) options.requestInit = { headers: { Authorization: 'Bearer ' + row.token } };
    else if (flow || (row.auth && row.auth.tokens)) options.authProvider = provider(owner, row, flow);
    var transport = new StreamableHTTPClientTransport(new URL(row.url), options);
    var entry = { client: client, transport: transport, status: 'connecting', error: '' };
    live.set(key(owner, row.id), entry); changed(owner);
    try {
      await client.connect(transport, { timeout: 30000 });
      var tools = [], cursor, seen = new Set();
      do {
        var page = await client.listTools(cursor ? { cursor: cursor } : {}, { timeout: 30000 });
        tools = tools.concat(page.tools);
        if (tools.length > 1000 || seen.size >= 100 || (page.nextCursor && seen.has(page.nextCursor))) throw new Error('Tool catalog exceeds the supported limit.');
        cursor = page.nextCursor; seen.add(cursor);
      } while (cursor);
      if (JSON.stringify(tools).length > 2 * 1024 * 1024) throw new Error('Tool catalog exceeds the supported limit.');
      check(owner, row);
      if (live.get(key(owner, row.id)) !== entry || (flow && flow.cancelled)) throw new Error('Connection changed.');
      require('./mcp-proxy').validateDefinitions(tools);
      row.tools = tools; entry.status = 'ready'; persist(owner);
      return entry;
    } catch (error) {
      var requiresAuth = error.code === 401 || error.code === 403 || error.name === 'UnauthorizedError' || (flow && flow.authorizationUrl);
      entry.status = requiresAuth ? 'auth_required' : 'unavailable';
      entry.error = requiresAuth ? 'Sign in or provide an access token to connect.' : 'Could not connect. Check the address and try again.';
      if (!flow) await client.close().catch(function () {});
      return entry;
    } finally { changed(owner); }
  }
  function cancelLogin(owner, id) {
    var idKey = key(owner, id), flow = flows.get(idKey);
    if (!flow) return;
    flow.cancelled = true; flows.delete(idKey); clearTimeout(flow.timer);
    if (flow.browser) { flow.browser.close(); ctx.sendOwner(owner, { type: 'mcp_login_closed', browserId: flow.browser.id }); }
    flow.close();
  }
  async function signIn(owner, row, ws) {
    cancelLogin(owner, row.id);
    var identity = ctx.identity(ws);
    var flow = await oauth.createCallback(async function (code, issuer) {
      check(owner, row);
      if (flows.get(key(owner, row.id)) !== flow) throw new Error('Sign-in expired.');
      var metadata = row.auth && row.auth.discovery;
      var expected = metadata && metadata.authorizationServerMetadata && metadata.authorizationServerMetadata.issuer;
      if ((metadata && metadata.authorizationServerMetadata && metadata.authorizationServerMetadata.authorization_response_iss_parameter_supported && !issuer) || (issuer && (!expected || issuer !== expected))) throw new Error('Sign-in issuer mismatch.');
      var entry = live.get(key(owner, row.id));
      if (!entry || !entry.transport) throw new Error('Sign in again.');
      await entry.transport.finishAuth(code);
      check(owner, row);
      if (flows.get(key(owner, row.id)) !== flow) throw new Error('Sign-in expired.');
      var ready = await connect(owner, row);
      if (ready.status !== 'ready') throw new Error('Connection failed after sign-in.');
      setTimeout(function () { if (flows.get(key(owner, row.id)) === flow) { cancelLogin(owner, row.id); changed(owner); } }, 500);
    });
    flows.set(key(owner, row.id), flow);
    flow.timer = setTimeout(function () { cancelLogin(owner, row.id); }, 10 * 60 * 1000); flow.timer.unref();
    row.authMode = 'auto'; delete row.token;
    // A fresh loopback redirect requires a matching client registration.
    row.auth = { redirectUrl: flow.redirectUrl }; persist(owner);
    var entry = await connect(owner, row, flow);
    if (!flow.authorizationUrl) { cancelLogin(owner, row.id); if (entry.status !== 'ready') throw new Error('This server could not start browser sign-in. Use an access token if supported.'); return; }
    check(owner, row);
    if (flow.cancelled) throw new Error('Sign-in expired.');
    try { flow.browser = (ctx.createLoginBrowser || createLoginBrowser)({ ws: ws, vendor: 'mcp', initialUrl: flow.authorizationUrl,
      osUserInfo: identity, restrictedNetwork: true,
      canAccess: function (peer) { return flows.get(key(owner, row.id)) === flow && ctx.canAccess(peer, owner); },
      sendTo: function (peer, message) { ctx.sendTo(peer, Object.assign({}, message, { type: message.type.replace('vendor_login_', 'mcp_login_'), connectionId: row.id })); } });
    } catch (error) { cancelLogin(owner, row.id); throw new Error('Could not open the sign-in browser. Retry or use an access token.'); }
    ctx.sendTo(ws, { type: 'mcp_login_ready', browserId: flow.browser.id, connectionId: row.id, label: row.label });
  }
  function serial(owner, task) {
    var pending = (queues.get(owner) || Promise.resolve()).catch(function () {}).then(task);
    queues.set(owner, pending);
    pending.finally(function () { if (queues.get(owner) === pending) queues.delete(owner); }).catch(function () {});
    return pending;
  }
  function command(owner, msg, ws) {
    // Revocation takes effect before any queued network work completes.
    if (msg.action === 'remove' || (msg.action === 'enable' && msg.enabled !== true)) {
      try {
        var revoked = find(owner, msg.id);
        if (revoked.source !== 'url') throw new Error('Not a remote connection.');
        revoked.enabled = false; cancelLogin(owner, revoked.id); persist(owner);
        disconnect(owner, revoked.id); changed(owner);
      } catch (error) { return Promise.reject(error); }
    }
    return serial(owner, async function () {
      var row;
      if (msg.action === 'add') {
        var url = network.remoteUrl(msg.url).href;
        if (records(owner).filter(function (item) { return item.source === 'url'; }).length >= 30) throw new Error('You can add up to 30 remote connections per project.');
        if (records(owner).some(function (item) { return item.url === url; })) throw new Error('This server is already connected. Open it from your connections.');
        row = { id: 'remote-' + crypto.randomBytes(8).toString('hex'), source: 'url', url: url, label: new URL(url).hostname, enabled: false };
        records(owner).push(row); persist(owner);
        await connect(owner, row);
      } else {
        row = find(owner, msg.id);
        if (row.source !== 'url') throw new Error('Not a remote connection.');
        if (msg.action === 'enable') { row.enabled = msg.enabled === true; persist(owner); }
        else if (msg.action === 'rename') {
          if (typeof msg.label !== 'string' || !msg.label.trim() || msg.label.length > 100) throw new Error('Use a name between 1 and 100 characters.');
          row.label = msg.label.trim(); persist(owner);
        } else if (msg.action === 'remove') {
          cancelLogin(owner, row.id); await disconnect(owner, row.id);
          accounts.set(owner, records(owner).filter(function (item) { return item !== row; })); persist(owner);
        } else if (msg.action === 'test') { cancelLogin(owner, row.id); await connect(owner, row); }
        else if (msg.action === 'token') {
          if (typeof msg.token !== 'string' || !msg.token.trim() || msg.token.length > 8192 || /[\r\n]/.test(msg.token)) throw new Error('Enter a valid access token.');
          cancelLogin(owner, row.id); row.token = msg.token.trim(); row.authMode = 'token'; delete row.auth; persist(owner); await connect(owner, row);
        } else if (msg.action === 'signin') await signIn(owner, row, ws);
        else throw new Error('Unsupported connection action.');
      }
      changed(owner);
      return row.id;
    });
  }
  function handleBrowser(owner, ws, msg) {
    var flow = flows.get(key(owner, msg.connectionId));
    if (!flow || !flow.browser || flow.browser.id !== msg.browserId || !ctx.canAccess(ws, owner)) return;
    if (msg.type === 'mcp_login_cancel') cancelLogin(owner, msg.connectionId);
    else if (msg.type === 'mcp_login_browser_attach') flow.browser.attach(ws);
    else if (msg.type === 'mcp_login_browser_input') flow.browser.input(ws, msg.event);
  }
  async function call(owner, id, name, args, authorize) {
    return serial(owner, async function () {
      authorize(); var row = find(owner, id);
      if (!row.enabled) throw new Error('Connection is disabled.');
      var entry = live.get(key(owner, id));
      if (!entry || entry.status !== 'ready') entry = await connect(owner, row);
      authorize(); check(owner, row);
      if (!row.enabled || entry.status !== 'ready') throw new Error('MCP connection is not ready. Open MCP Servers to reconnect.');
      if (!(row.tools || []).some(function (tool) { return tool.name === name; })) throw new Error('Tool is unavailable.');
      // Never replay a tools/call after an ambiguous transport failure.
      var result;
      try { result = await entry.client.callTool({ name: name, arguments: args || {} }, undefined, { timeout: 60000 }); }
      catch (error) {
        if (live.get(key(owner, id)) === entry) {
          entry.status = error.code === 401 || error.code === 403 || error.name === 'UnauthorizedError' ? 'auth_required' : 'unavailable';
          entry.error = entry.status === 'auth_required' ? 'Sign in again to reconnect.' : 'The tool call could not complete. Check the service before retrying.';
          changed(owner);
        }
        throw new Error('MCP tool call failed. Open MCP Servers to check the connection.');
      }
      authorize(); check(owner, row);
      if (!row.enabled || live.get(key(owner, id)) !== entry) throw new Error('Connection was disabled or changed.');
      return result;
    });
  }
  function computerEnabled(owner, name, fallback) {
    var row = records(owner).find(function (item) { return item.source === 'computer' && item.name === name; });
    return row ? row.enabled : !!fallback;
  }
  function toggleComputer(owner, name, enabled) {
    var list = records(owner), row = list.find(function (item) { return item.source === 'computer' && item.name === name; });
    if (!row) { row = { id: crypto.randomUUID(), source: 'computer', name: name }; list.push(row); }
    row.enabled = !!enabled; persist(owner); changed(owner);
  }
  function destroy() {
    flows.forEach(function (flow, flowKey) { var pair = JSON.parse(flowKey); cancelLogin(pair[0], pair[1]); });
    closed = true; live.forEach(function (entry) { entry.client.close().catch(function () {}); }); live.clear();
    remoteFetch.close();
  }
  return { view: view, command: command, call: call, handleBrowser: handleBrowser, destroy: destroy,
    computerEnabled: computerEnabled, toggleComputer: toggleComputer };
}
module.exports = { createRemoteConnections: createRemoteConnections };
