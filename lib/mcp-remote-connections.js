var crypto = require('crypto');
var Client = require('@modelcontextprotocol/sdk/client/index.js').Client;
var SSEClientTransport = require('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransport;
var localTransport = require('./mcp-local-transport').localTransport;
var StreamableHTTPClientTransport = require('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport;
var network = require('./mcp-network');
var oauth = require('./mcp-oauth');
var createLoginBrowser = require('./vendor-login-browser').createLoginBrowser;

function createRemoteConnections(ctx) {
  var accounts = new Map(), live = new Map(), flows = new Map(), queues = new Map();
  var remoteFetch = ctx.remoteFetch || network.createRemoteFetch();
  var closed = false;
  function sameRuntimeConfig(left, right) {
    return left && right && left.url === right.url && left.enabled === right.enabled && left.authMode === right.authMode && left.token === right.token && JSON.stringify(left.auth || null) === JSON.stringify(right.auth || null) && JSON.stringify([left.transport, left.command, left.args, left.env, left.cwd, left.headers, left.envHeaders, left.references, left.disabledTools, left.enabledTools, left.toolPatterns, left.toolPrefix]) === JSON.stringify([right.transport, right.command, right.args, right.env, right.cwd, right.headers, right.envHeaders, right.references, right.disabledTools, right.enabledTools, right.toolPatterns, right.toolPrefix]);
  }
  function invalidate(owner, previous, current) {
    var byId = new Map(current.filter(function (row) { return row.source !== 'computer'; }).map(function (row) { return [row.id, row]; }));
    previous.filter(function (row) { return row.source !== 'computer'; }).forEach(function (row) {
      var next = byId.get(row.id);
      if (!next || !sameRuntimeConfig(row, next)) disconnect(owner, row.id);
    });
  }
  function records(owner) {
    ctx.authorize(owner);
    var account = accounts.get(owner), snapshot = typeof ctx.storage.snapshot === 'function' ? ctx.storage.snapshot(owner) : { records: ctx.storage.load(owner), revision: typeof ctx.storage.revision === 'function' ? ctx.storage.revision(owner) : null };
    var loaded = snapshot.records, revision = snapshot.revision;
    if (!account) accounts.set(owner, account = { records: loaded, revision: revision });
    else if (account.revision !== revision) { invalidate(owner, account.records, loaded); account.records = loaded; account.revision = revision; }
    return account.records;
  }
  function persist(owner) {
    ctx.authorize(owner); if (closed) throw new Error('MCP connections closed.');
    var account = accounts.get(owner);
    if (!account) throw new Error('MCP connection snapshot is unavailable.');
    var revision;
    try { revision = ctx.storage.save(owner, account.records, account.revision); }
    catch (error) { accounts.delete(owner); invalidate(owner, account.records, []); throw error; }
    if (account) account.revision = revision;
  }
  function find(owner, id) {
    var row = records(owner).find(function (item) { return item.id === id; });
    if (!row) throw new Error('Connection is unavailable.');
    return row;
  }
  function key(owner, id) { return JSON.stringify([owner, id]); }
  function check(owner, row) {
    if (closed || find(owner, row.id) !== row) throw new Error('Connection changed.');
    if (row.source === 'local' && ctx.ownerIdentity) ctx.ownerIdentity(owner);
  }
  function changed(owner) { if (!closed) ctx.changed(owner); }
  function view(owner) {
    return records(owner).filter(function (row) { return row.source !== 'computer'; }).map(function (row) {
      var entry = live.get(key(owner, row.id));
      return { id: row.id, name: row.id, label: row.label, source: row.source, transport: row.transport || 'http', url: row.url ? new URL(row.url).origin + new URL(row.url).pathname : null, provenance: row.provenance, references: require('./mcp-import-credentials').requiredNames(row),
        projectEnabled: !!row.enabled, extensionEnabled: true, tools: row.tools || [], toolCount: (row.tools || []).length,
        status: entry ? entry.status : (row.provenance || row.tools ? 'idle' : 'unavailable'), error: entry ? entry.error : '', authMode: row.authMode || 'auto' };
    });
  }
  async function disconnect(owner, id) {
    var entry = live.get(key(owner, id));
    live.delete(key(owner, id));
    if (entry && entry.client) await entry.client.close().catch(function () {});
  }
  function provider(owner, row, flow) {
    return oauth.createOAuthProvider(row, function () { check(owner, row); persist(owner); }, flow, function () { check(owner, row); });
  }
  async function connect(owner, row, flow) {
    check(owner, row);
    await disconnect(owner, row.id);
    check(owner, row);
    if (flow && flow.cancelled) throw new Error('Sign-in expired.');
    var client = new Client({ name: 'clay', version: '1.0.0' }, { capabilities: {} });
    if (row.source !== 'local' && ((row.references || []).length || Object.keys(row.envHeaders || {}).length)) throw new Error('Configure required credentials in Clay before connecting.');
    var options = { fetch: async function (input, init) { check(owner, row); var response = await remoteFetch.fetch(input, init); check(owner, row); return response; }, requestInit: { headers: row.headers || {} } };
    if (row.authMode === 'token' && row.token) options.requestInit = { headers: Object.assign({}, row.headers || {}, { Authorization: 'Bearer ' + row.token }) };
    else if (flow || (row.auth && row.auth.tokens)) options.authProvider = provider(owner, row, flow);
    var transport = row.source === 'local' ? localTransport(row, ctx.ownerIdentity ? ctx.ownerIdentity(owner) : null) : (row.transport === 'sse' ? new SSEClientTransport(new URL(row.url), options) : new StreamableHTTPClientTransport(new URL(row.url), options));
    var entry = { client: client, transport: transport, status: 'connecting', error: '' };
    live.set(key(owner, row.id), entry); changed(owner);
    try {
      await client.connect(transport, { timeout: 30000 });
      check(owner, row);
      var tools = [], cursor, seen = new Set();
      do {
        var page = await client.listTools(cursor ? { cursor: cursor } : {}, { timeout: 30000 });
        check(owner, row);
        tools = tools.concat(page.tools);
        if (tools.length > 1000 || seen.size >= 100 || (page.nextCursor && seen.has(page.nextCursor))) throw new Error('Tool catalog exceeds the supported limit.');
        cursor = page.nextCursor; seen.add(cursor);
      } while (cursor);
      if (JSON.stringify(tools).length > 2 * 1024 * 1024) throw new Error('Tool catalog exceeds the supported limit.');
      check(owner, row);
      if (live.get(key(owner, row.id)) !== entry || (flow && flow.cancelled)) throw new Error('Connection changed.');
      tools = tools.filter(function (tool) {
        return require('./mcp-tool-policy').permits(row, tool.name);
      });
      require('./mcp-proxy').validateDefinitions(tools);
      row.tools = tools; entry.status = 'ready'; persist(owner);
      return entry;
    } catch (error) {
      var requiresAuth = error.code === 401 || error.code === 403 || error.name === 'UnauthorizedError' || (flow && flow.authorizationUrl);
      entry.status = requiresAuth ? 'auth_required' : 'unavailable';
      entry.error = requiresAuth ? 'Sign in or provide an access token to connect.' : row.source === 'local' ? 'Could not start the command. Check its dependency and working directory.' : 'Could not connect. Check the address and try again.';
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
    try { check(owner, row); } catch (error) { flow.close(); throw error; }
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
  function commitImport(owner, select, authorize) {
    authorize();
    var imported = select();
    records(owner);
    if (accounts.get(owner).revision !== imported.revision) throw new Error('Connections changed. Scan again.');
    if (records(owner).some(function (item) { return item.importSignature === imported.signature || imported.config.url && item.url === imported.config.url; })) throw new Error('This server is already imported.');
    authorize();
    var row = Object.assign({}, imported.config, { id: 'remote-' + crypto.randomBytes(8).toString('hex'), importSignature: imported.signature, enabled: false });
    records(owner).push(row); persist(owner);
    return row;
  }
  function importConnection(owner, select, authorize) {
    return serial(owner, function () { var row = commitImport(owner, select, authorize); changed(owner); return row.id; });
  }
  function command(owner, msg, ws) {
    // Revocation takes effect before any queued network work completes.
    if (msg.action === 'remove' || (msg.action === 'enable' && msg.enabled !== true)) {
      try {
        var revoked = find(owner, msg.id);
        if (revoked.source === 'computer') throw new Error('Not a remote connection.');
        revoked.enabled = false; cancelLogin(owner, revoked.id); persist(owner);
        disconnect(owner, revoked.id); changed(owner);
      } catch (error) { return Promise.reject(error); }
    }
    return serial(owner, async function () {
      var row;
      if (msg.action === 'import') {
        row = commitImport(owner, function () { return ctx.selectImport(owner, ws, msg); }, function () { if (!ctx.canAccess(ws, owner)) throw new Error('MCP account is unavailable.'); });
      } else if (msg.action === 'add') {
        var url = network.remoteUrl(msg.url).href;
        if (records(owner).filter(function (item) { return item.source !== 'computer'; }).length >= 30) throw new Error('You can add up to 30 remote connections per project.');
        if (records(owner).some(function (item) { return item.url === url; })) throw new Error('This server is already connected. Open it from your connections.');
        row = { id: 'remote-' + crypto.randomBytes(8).toString('hex'), source: 'url', url: url, label: new URL(url).hostname, enabled: false };
        records(owner).push(row); persist(owner);
        await connect(owner, row);
      } else {
        row = find(owner, msg.id);
        if (row.source === 'computer') throw new Error('Not a remote connection.');
        if (msg.action === 'enable') { row.enabled = msg.enabled === true; persist(owner); if (row.enabled && row.provenance) { try { await connect(owner, row); } catch (error) { row.enabled = false; persist(owner); throw error; } } }
        else if (msg.action === 'rename') {
          if (typeof msg.label !== 'string' || !msg.label.trim() || msg.label.length > 100) throw new Error('Use a name between 1 and 100 characters.');
          row.label = msg.label.trim(); persist(owner);
        } else if (msg.action === 'remove') {
          cancelLogin(owner, row.id); await disconnect(owner, row.id);
          var account = accounts.get(owner);
          accounts.set(owner, { records: records(owner).filter(function (item) { return item !== row; }), revision: account && account.revision }); persist(owner);
        } else if (msg.action === 'test') { cancelLogin(owner, row.id); await connect(owner, row); }
        else if (msg.action === 'credentials') {
          if (!msg.values || typeof msg.values !== 'object' || Array.isArray(msg.values)) throw new Error('Enter required credential values.');
          var next = require('./mcp-import-credentials').applyCredentials(row, msg.values);
          cancelLogin(owner, row.id); Object.assign(row, next); persist(owner); await disconnect(owner, row.id);
        } else if (msg.action === 'token') {
          if (typeof msg.token !== 'string' || !msg.token.trim() || msg.token.length > 8192 || /[\r\n]/.test(msg.token)) throw new Error('Enter a valid access token.');
          cancelLogin(owner, row.id); row.token = msg.token.trim(); row.authMode = 'token'; delete row.auth; persist(owner); await connect(owner, row);
        } else if (msg.action === 'signin') { if (row.source === 'local') throw new Error('This server uses process environment credentials.'); await signIn(owner, row, ws); }
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
      if (!require('./mcp-tool-policy').permits(row, name)) throw new Error('Tool is excluded by the imported vendor policy.');
      var entry = live.get(key(owner, id));
      if (!entry || entry.status !== 'ready') entry = await connect(owner, row);
      authorize(); check(owner, row);
      if (!row.enabled || entry.status !== 'ready') throw new Error('MCP connection is not ready. Open MCP Servers to reconnect.');
      if (!(row.tools || []).some(function (tool) { return tool.name === name; })) throw new Error('Tool is unavailable.');
      // Never replay a tools/call after an ambiguous transport failure.
      var result;
      try { result = await entry.client.callTool({ name: name, arguments: args || {} }, undefined, { timeout: 60000 }); }
      catch (error) {
        authorize(); check(owner, row);
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
  return { view: view, command: command, importConnection: importConnection, call: call, handleBrowser: handleBrowser, destroy: destroy,
    computerEnabled: computerEnabled, toggleComputer: toggleComputer };
}
module.exports = { createRemoteConnections: createRemoteConnections };
