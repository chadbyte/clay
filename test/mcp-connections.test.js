var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var network = require('../lib/mcp-network');
var oauth = require('../lib/mcp-oauth');
var createRemote = require('../lib/mcp-remote-connections').createRemoteConnections;
var createStore = require('../lib/mcp-connection-store').createConnectionStore;
var attachMcp = require('../lib/project-mcp').attachMcp;
var catalog = [{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }];
function fixture(options) {
  options = options || {};
  var saved = {}, requests = [], messages = [], browser;
  var ctx = { storage: { load: function (owner) { return saved[owner] || []; }, save: function (owner, value) { saved[owner] = value; } },
    authorize: function () {}, changed: function () {}, identity: function () { return null; }, canAccess: function (ws, owner) { return ws.owner === owner; },
    sendOwner: function (owner, msg) { messages.push(msg); }, sendTo: function (ws, msg) { messages.push(msg); },
    createLoginBrowser: function (opts) { browser = opts; return { id: 'browser', close: function () {}, attach: function () {}, input: function () {} }; },
    remoteFetch: { close: function () {}, fetch: async function (input, init) {
      var url = String(input); init = init || {}; requests.push({ url: url, init: init });
      if (options.fetch) { var custom = await options.fetch(url, init); if (custom) return custom; }
      if (init.method === 'GET') return new Response('', { status: 405 });
      var msg = JSON.parse(init.body || '{}');
      if (msg.id === undefined) return new Response(null, { status: 202 });
      var result;
      if (msg.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } };
      if (msg.method === 'tools/list') result = { tools: catalog };
      if (msg.method === 'tools/call') result = options.call ? await options.call(msg.params) : { content: [{ type: 'text', text: msg.params.arguments.value }] };
      return Response.json({ jsonrpc: '2.0', id: msg.id, result: result });
    } } };
  var manager = createRemote(ctx);
  return { manager: manager, ctx: ctx, saved: saved, requests: requests, messages: messages, browser: function () { return browser; } };
}
test('remote address validation rejects local, reserved, and credential-bearing destinations', async function () {
  ['http://example.com/mcp', 'https://localhost/mcp', 'https://127.1/mcp', 'https://[::1]/mcp', 'https://169.254.169.254/', 'https://user:secret@example.com/'].forEach(function (url) { assert.throws(function () { network.remoteUrl(url); }); });
  ['10.1.2.3', '192.168.1.1', '100.64.0.1', '::ffff:127.0.0.1', '2001:db8::1'].forEach(function (ip) { assert.equal(network.publicAddress(ip), false); });
  assert.equal(network.remoteUrl('https://example.com/mcp').href, 'https://example.com/mcp');
  assert.equal(network.publicAddress('8.8.8.8'), true);
});
test('records are encrypted, scoped by owner and project, and survive restart', function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mcp-test-')); t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var store = createStore(root, 'alpha'); store.save('alice', [{ token: 'top-secret', enabled: true }]);
  assert.deepEqual(createStore(root, 'alpha').load('alice'), [{ token: 'top-secret', enabled: true }]);
  assert.deepEqual(store.load('bob'), []); assert.deepEqual(createStore(root, 'beta').load('alice'), []);
  fs.readdirSync(path.join(root, 'mcp-connections')).filter(function (name) { return name.endsWith('.json'); }).forEach(function (name) {
    assert.equal(fs.readFileSync(path.join(root, 'mcp-connections', name), 'utf8').includes('top-secret'), false);
  });
});
test('real SDK initializes and calls remote tools only after explicit enable; token stays private', async function (t) {
  var f = fixture(); t.after(function () { f.manager.destroy(); });
  var id = await f.manager.command('alice', { action: 'add', url: 'https://example.com/mcp' });
  assert.equal(f.manager.view('alice')[0].status, 'ready');
  assert.equal(f.manager.view('alice')[0].projectEnabled, false);
  await assert.rejects(f.manager.call('alice', id, 'echo', { value: 'hi' }, function () {}), /disabled/);
  await f.manager.command('alice', { action: 'token', id: id, token: 'private-token' });
  await f.manager.command('alice', { action: 'enable', id: id, enabled: true });
  var result = await f.manager.call('alice', id, 'echo', { value: 'hello' }, function () {});
  assert.equal(result.content[0].text, 'hello');
  assert.equal(JSON.stringify(f.manager.view('alice')).includes('private-token'), false);
  assert.equal(f.manager.view('bob').length, 0);
  await assert.rejects(f.manager.command('bob', { action: 'remove', id: id }), /unavailable/);
  assert.ok(f.requests.some(function (req) { return new Headers(req.init.headers).get('Authorization') === 'Bearer private-token'; }));
});
test('disabling preempts an in-flight tool and blocks an already loaded proxy', async function (t) {
  var finish, started;
  var called = new Promise(function (resolve) { started = resolve; });
  var f = fixture({ call: function () { started(); return new Promise(function (resolve) { finish = resolve; }); } });
  t.after(function () { f.manager.destroy(); });
  var id = await f.manager.command('alice', { action: 'add', url: 'https://example.com/mcp' });
  await f.manager.command('alice', { action: 'enable', id: id, enabled: true });
  var call = f.manager.call('alice', id, 'echo', { value: 'pending' }, function () {});
  var rejection = assert.rejects(call);
  await called;
  var disabled = f.manager.command('alice', { action: 'enable', id: id, enabled: false });
  assert.equal(f.manager.view('alice')[0].projectEnabled, false);
  finish({ content: [] }); await rejection; await disabled;
  await assert.rejects(f.manager.call('alice', id, 'echo', {}, function () {}), /disabled/);
});
test('OAuth callback rejects wrong state and replay; canceled flow cannot store tokens', async function (t) {
  var codes = [];
  var flow = await oauth.createCallback(function (code) { codes.push(code); }); t.after(function () { flow.close(); });
  assert.equal((await fetch(flow.redirectUrl + '?state=wrong&code=bad')).status, 400);
  assert.equal((await fetch(flow.redirectUrl + '?state=' + flow.state + '&code=good')).status, 200);
  assert.equal((await fetch(flow.redirectUrl + '?state=' + flow.state + '&code=replay')).status, 400);
  assert.deepEqual(codes, ['good']);
  var row = {}, writes = 0, provider = oauth.createOAuthProvider(row, function () { writes++; }, flow);
  flow.cancelled = true;
  assert.throws(function () { provider.saveTokens({ access_token: 'late-secret' }); }, /expired/);
  assert.equal(writes, 0); assert.equal(row.auth.tokens, undefined);
});
test('computer routing is per account and rejects spoofed results and revoked session access', async function (t) {
  var alice = { owner: 'alice', _clayUser: { id: 'alice' }, readyState: 1 }, bob = { owner: 'bob', _clayUser: { id: 'bob' }, readyState: 1 };
  var sent = [], saved = {}, allowed = true;
  var mcp = attachMcp({ slug: 'demo', clients: new Set([alice, bob]), isMultiUser: function () { return true; },
    canAccess: function () { return true; }, canUseOwner: function () { return true; }, canUseSession: function () { return allowed; }, identity: function () {}, extensionId: function () { return 'extension'; },
    storage: { load: function (owner) { return saved[owner] || []; }, save: function (owner, rows) { saved[owner] = rows; } },
    sendTo: function (ws, msg) { sent.push({ ws: ws, msg: msg }); }, getEnabledMcpServers: function () { return []; } });
  t.after(function () { mcp.destroy(); });
  [alice, bob].forEach(function (ws) {
    mcp.handleMcpMessage(ws, { type: 'mcp_servers_available', hostConnected: true, servers: [{ name: 'computer', tools: catalog, enabled: true }] });
    mcp.handleMcpMessage(ws, { type: 'mcp_toggle_server', name: 'computer', enabled: true });
  });
  var proxy = mcp.getMcpServers({ ownerId: 'alice' }).computer;
  var callback = proxy.instance._registeredTools.echo.handler || proxy.instance._registeredTools.echo.callback;
  var call = callback({ value: 'hello' });
  var request = sent.find(function (entry) { return entry.msg.type === 'mcp_tool_call'; });
  assert.equal(request.ws, alice);
  mcp.handleMcpMessage(bob, { type: 'mcp_tool_result', callId: request.msg.callId, result: { content: [{ type: 'text', text: 'spoof' }] } });
  mcp.handleMcpMessage(alice, { type: 'mcp_tool_result', callId: request.msg.callId, result: { content: [{ type: 'text', text: 'valid' }] } });
  assert.equal((await call).content[0].text, 'valid');
  allowed = false; await assert.rejects(callback({ value: 'blocked' }), /access changed/);
});
test('OAuth discovery, PKCE browser handoff, callback, token exchange and reconnect use the SDK', async function (t) {
  var tokenRequest;
  var f = fixture({ fetch: async function (url, init) {
    if (url.includes('/.well-known/oauth-protected-resource')) return Response.json({ resource: 'https://example.com/mcp', authorization_servers: ['https://example.com'] });
    if (url.includes('/.well-known/oauth-authorization-server')) return Response.json({ issuer: 'https://example.com', authorization_endpoint: 'https://example.com/authorize', token_endpoint: 'https://example.com/token', registration_endpoint: 'https://example.com/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    if (url.endsWith('/register')) return Response.json(Object.assign(JSON.parse(init.body), { client_id: 'clay-test' }), { status: 201 });
    if (url.endsWith('/token')) { tokenRequest = new URLSearchParams(init.body); return Response.json({ access_token: 'oauth-secret', token_type: 'Bearer', refresh_token: 'refresh-secret', expires_in: 3600 }); }
    if (url.endsWith('/mcp') && new Headers(init.headers).get('Authorization') !== 'Bearer oauth-secret') return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"' } });
  } });
  t.after(function () { f.manager.destroy(); });
  var id = await f.manager.command('alice', { action: 'add', url: 'https://example.com/mcp' });
  assert.equal(f.manager.view('alice')[0].status, 'auth_required');
  await f.manager.command('alice', { action: 'signin', id: id }, { owner: 'alice' });
  var browser = f.browser(); assert.ok(browser, JSON.stringify(f.manager.view('alice')));
  assert.equal(browser.restrictedNetwork, true);
  assert.equal(browser.canAccess({ owner: 'bob' }), false);
  var url = new URL(browser.initialUrl);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  var callback = url.searchParams.get('redirect_uri') + '?code=fixture-code&state=' + url.searchParams.get('state') + '&iss=https%3A%2F%2Fexample.com';
  var response = await fetch(callback);
  assert.equal(response.status, 200, await response.text());
  assert.equal(tokenRequest.get('code'), 'fixture-code');
  assert.ok(tokenRequest.get('code_verifier'));
  assert.equal(f.manager.view('alice')[0].status, 'ready');
  assert.equal(JSON.stringify(f.messages).includes('oauth-secret'), false);
});
test('proxy preserves full JSON Schema and validates object constraints through MCP', async function (t) {
  var Client = require('@modelcontextprotocol/sdk/client/index.js').Client;
  var linked = require('@modelcontextprotocol/sdk/inMemory.js').InMemoryTransport.createLinkedPair();
  var proxy = require('../lib/mcp-proxy').createProxy('sample', catalog, async function (name, args) { return { content: [{ type: 'text', text: args.value }] }; });
  var client = new Client({ name: 'test', version: '1' });
  t.after(async function () { await client.close(); await proxy.instance.close(); });
  await proxy.instance.connect(linked[0]); await client.connect(linked[1]);
  assert.deepEqual((await client.listTools()).tools[0].inputSchema, catalog[0].inputSchema);
  assert.equal((await client.callTool({ name: 'echo', arguments: { value: 'okay' } })).content[0].text, 'okay');
  var invalid = await client.callTool({ name: 'echo', arguments: { value: 'okay', unexpected: true } });
  assert.equal(invalid.isError, true);
});
test('remote fetch and browser CONNECT proxy refuse loopback destinations', async function (t) {
  var transport = network.createRemoteFetch(); t.after(function () { transport.close(); });
  await assert.rejects(transport.fetch('https://127.0.0.1/'), /public server/);
  var proxy = await require('../lib/mcp-browser-proxy').createBrowserProxy(); t.after(function () { proxy.close(); });
  var address = new URL(proxy.server);
  var status = await new Promise(function (resolve, reject) {
    var request = require('http').request({ host: address.hostname, port: address.port, method: 'CONNECT', path: '127.0.0.1:443' });
    request.on('connect', function (res, socket) { socket.destroy(); resolve(res.statusCode); }); request.on('error', reject); request.end();
  });
  assert.equal(status, 403);
});
test('personal access rejects shared Drivers, foreign input, and Worker indirection', function () {
  var canUse = require('../lib/mcp-session-access').canUsePersonalConnections;
  var driver = { localId: 1, ownerId: 'alice', sessionOriginId: 'driver', history: [] };
  var worker = { localId: 2, ownerId: 'alice', sessionProvenance: { kind: 'worker', parentSessionOriginId: 'driver' } };
  var sessions = new Map([[1, driver], [2, worker]]);
  assert.equal(canUse(driver, sessions), true); assert.equal(canUse(worker, sessions), true);
  driver.sessionVisibility = 'shared'; assert.equal(canUse(worker, sessions), false);
  driver.sessionVisibility = 'private'; driver.history.push({ type: 'user_message', from: 'bob' });
  assert.equal(canUse(driver, sessions), false); assert.equal(canUse(worker, sessions), false);
  driver.history = []; sessions.delete(1); assert.equal(canUse(worker, sessions), false);
});
test('expired access token changes ready state to sign-in required without replaying the call', async function (t) {
  var expired = false, attempts = 0;
  var f = fixture({ fetch: function (url, init) {
    var msg = JSON.parse(init.body || '{}');
    if (msg.method === 'tools/call' && expired) { attempts++; return new Response('', { status: 401 }); }
  } });
  t.after(function () { f.manager.destroy(); });
  var id = await f.manager.command('alice', { action: 'add', url: 'https://example.com/mcp' });
  await f.manager.command('alice', { action: 'token', id: id, token: 'expired-secret' });
  await f.manager.command('alice', { action: 'enable', id: id, enabled: true });
  expired = true;
  await assert.rejects(f.manager.call('alice', id, 'echo', { value: 'hello' }, function () {}), /MCP tool call failed/);
  assert.equal(attempts, 1); assert.equal(f.manager.view('alice')[0].status, 'auth_required');
});
