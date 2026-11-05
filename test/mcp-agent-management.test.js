var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
function fixture(t, options) {
  options = options || {};
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mcp-manage-'));
  var session = { localId: 1, sessionOriginId: 'fixture-origin', ownerId: 'alice', vendor: 'claude', _sdkQueryGeneration: 1, history: [], abortController: new AbortController() };
  var sessions = new Map([[1, session]]), owners = new Set(['alice', 'bob']), clients = new Set(), cards = [], sent = [], starts = [], requests = [];
  var identity = { value: null }, ws = { readyState: 1, _clayUser: { id: 'alice' }, _clayActiveSession: 1 }; clients.add(ws);
  var script = path.join(root, 'mcp.cjs');
  fs.writeFileSync(script, "require('readline').createInterface({input:process.stdin}).on('line',function(line){var m=JSON.parse(line);if(m.id===undefined)return;var result={};if(m.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};if(m.method==='tools/list')result={tools:[{name:'echo',inputSchema:{type:'object'}}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:result})+'\\n');});");
  var storage = require('../lib/mcp-connection-store').createConnectionStore(root, 'fixture', { shared: true });
  var ask = require('../lib/project-ask-user').attachAskUser({ record: function (value, event) { value.history.push(event); } });
  var manager = require('../lib/project-mcp').attachMcp({ root: root, storage: storage, cwd: root, discoveryHome: root, slug: 'fixture', clients: clients,
    isMultiUser: function () { return true; }, canAccess: function (peer) { return !!peer._clayUser && owners.has(peer._clayUser.id); }, canUseOwner: function (owner) { return owners.has(owner); },
    canUseSession: function (value) { return sessions.get(value.localId) === value && owners.has(value.ownerId) && !value._mcpForeignInput && value.sessionVisibility !== 'shared'; },
    canDiscoverSession: function () { return options.discovery !== false; }, runtimeEnvForSession: function () { return {}; }, ownerIdentity: function () { return identity.value; }, identity: function () { return null; }, canDiscover: function () { return true; }, extensionId: function () { return 'fixture-extension'; }, getEnabledMcpServers: function () { return []; },
    sendTo: function (peer, msg) { sent.push({ ws: peer, msg: msg }); if (options.send) options.send(peer, msg, manager); },
    userInput: function (value) { return function (request, respond) { cards.push({ request: request, respond: respond }); return ask.createHandler(value)(request, respond); }; }, consentTimeout: options.timeout || 1000,
    xcodeOptions: { platform: 'darwin', uid: function () { return process.getuid(); }, execFile: function (command, args, settings, done) { done(null, '/fixture/bridge', ''); } },
    localTransport: function (row) { starts.push(row.command); if (options.localTransport) return options.localTransport(row); return new (require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport)({ command: process.execPath, args: [script], env: { HOME: root }, stderr: 'ignore' }); },
    createLoginBrowser: function () { return { id: 'fixture-browser', close: function () { sent.push({ closed: true }); }, attach: function () {}, input: function () {} }; },
    remoteFetch: { close: function () {}, fetch: async function (url, init) {
      requests.push({ url: String(url), init: init }); if (options.fetch) { var answer = await options.fetch(url, init); if (answer) return answer; }
      if (init.method === 'GET') return new Response('', { status: 405 }); var msg = JSON.parse(init.body || '{}'); if (msg.id === undefined) return new Response(null, { status: 202 });
      var result = msg.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'remote fixture', version: '1' } } : { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] };
      return Response.json({ jsonrpc: '2.0', id: msg.id, result: result });
    } },
  });
  t.after(function () { manager.destroy(); fs.rmSync(root, { recursive: true, force: true }); });
  function tool(name, target) { var server = manager.getMcpServers(target || session)['clay-mcp-connections']; return server && server.instance._registeredTools[name]; }
  async function invoke(name, args, target) { var entry = tool(name, target); assert.ok(entry, name); return JSON.parse((await (entry.handler || entry.callback)(args || {})).content[0].text); }
  async function inspect(args) { var result = await invoke('inspect_mcp_connection_change', args); assert.equal(result.status, 'inspected', JSON.stringify(result)); return result.changeId; }
  async function card() { await new Promise(function (resolve) { setImmediate(resolve); }); assert.ok(cards.length); return cards.at(-1); }
  function answer(entry, peer, label) { if (!entry.request.authorizeResponse(peer || ws)) return false; return entry.respond({ mcp_change: [label || 'Apply this MCP change'] }); }
  async function apply(id) { var task = invoke('apply_mcp_connection_change', { changeId: id }); var entry = await card(); answer(entry); return task; }
  return { root: root, manager: manager, storage: storage, session: session, sessions: sessions, owners: owners, clients: clients, ws: ws, cards: cards, sent: sent, starts: starts, requests: requests, identity: identity, invoke: invoke, tool: tool, inspect: inspect, apply: apply, card: card, answer: answer };
}
test('all owner-private agents can inspect MCP without OS discovery; reads omit credentials and checks never start Xcode', async function (t) {
  var f = fixture(t, { discovery: false });
  f.storage.save('alice', [{ id: 'saved', source: 'url', label: 'Saved', url: 'https://example.com/mcp', token: 'never-expose', auth: { tokens: { access_token: 'never-expose' } }, enabled: false }]);
  var read = await f.invoke('read_mcp_connections', { checkXcode: true }); assert.equal(read.status, 'observed'); assert.equal(read.xcode.ready, true); assert.equal(f.starts.length, 0); assert.equal(JSON.stringify(read).includes('never-expose'), false);
  f.session.sessionVisibility = 'shared'; assert.equal(f.tool('read_mcp_connections'), undefined); delete f.session.sessionVisibility;
  f.session._mcpForeignInput = true; assert.equal(f.tool('read_mcp_connections'), undefined); delete f.session._mcpForeignInput;
  f.session.delegated = true; assert.equal(f.tool('read_mcp_connections'), undefined); delete f.session.delegated;
  var old = f.tool('read_mcp_connections'); f.session._sdkQueryGeneration++; assert.equal(JSON.parse((await (old.handler || old.callback)({})).content[0].text).status, 'refused');
});
test('local setup is exact-reviewed, saved disabled, enabled only with another review, and receipt retries never replay', async function (t) {
  var f = fixture(t), id = await f.inspect({ action: 'add_local', label: 'Fixture', command: 'node', args: ['fixture.cjs'], cwd: f.root });
  assert.equal(f.storage.load('alice').length, 0); assert.equal(f.starts.length, 0);
  var task = f.invoke('apply_mcp_connection_change', { changeId: id }), card = await f.card(); assert.match(card.request.questions[0].question, /DISABLED|fixture.cjs/); f.answer(card);
  var result = await task; assert.equal(result.status, 'persisted'); assert.equal(result.connection.projectEnabled, false); assert.equal(f.starts.length, 0);
  assert.equal((await f.invoke('apply_mcp_connection_change', { changeId: id })).status, 'persisted'); assert.equal(f.storage.load('alice').length, 1);
  var enable = await f.inspect({ action: 'enable', id: result.id }); assert.equal((await f.apply(enable)).connection.status, 'ready'); assert.equal(f.starts.length, 1);
  var rename = await f.inspect({ action: 'rename', id: result.id, label: 'Renamed' }); assert.equal((await f.apply(rename)).connection.label, 'Renamed');
  var remove = await f.inspect({ action: 'remove', id: result.id }); assert.equal((await f.apply(remove)).status, 'persisted'); assert.equal(f.storage.load('alice').length, 0);
});
test('remote add contacts only the reviewed endpoint and preserves owner scope', async function (t) {
  var f = fixture(t), id = await f.inspect({ action: 'add_remote', url: 'https://example.com/mcp' }); assert.equal(f.requests.length, 0);
  var result = await f.apply(id); assert.equal(result.status, 'persisted'); assert.equal(result.connection.status, 'ready'); assert.equal(result.connection.projectEnabled, false); assert.deepEqual(f.storage.load('bob'), []);
  assert.equal((await f.invoke('inspect_mcp_connection_change', { action: 'add_remote', url: 'http://localhost/mcp' })).status, 'refused');
  assert.equal((await f.invoke('apply_mcp_connection_change', { changeId: id, approved: true })).status, 'refused');
});
test('denial, absent owner, cancellation and timeout leave the connection catalog unchanged', async function (t) {
  var f = fixture(t, { timeout: 25 }), args = { action: 'add_remote', url: 'https://example.com/mcp' };
  var id = await f.inspect(args), task = f.invoke('apply_mcp_connection_change', { changeId: id }), card = await f.card(); f.answer(card, f.ws, 'Keep unchanged'); assert.equal((await task).status, 'declined');
  id = await f.inspect(args); task = f.invoke('apply_mcp_connection_change', { changeId: id }); card = await f.card(); card.respond.cancel(); assert.equal((await task).status, 'cancelled');
  id = await f.inspect(args); task = f.invoke('apply_mcp_connection_change', { changeId: id }); await f.card(); assert.equal((await task).status, 'expired');
  id = await f.inspect(args); f.clients.clear(); assert.equal((await f.invoke('apply_mcp_connection_change', { changeId: id })).status, 'consent_unavailable'); assert.equal(f.requests.length, 0); assert.deepEqual(f.storage.load('alice'), []);
});
test('foreign reviewers and changed owner, query, identity, target revision or source refuse reviewed mutations', async function (t) {
  var changes = [function (f) { f.session._sdkQueryGeneration++; }, function (f) { f.session.ownerId = 'bob'; }, function (f) { f.identity.value = { uid: 123, home: '/changed' }; }, function (f) { f.storage.save('alice', [{ id: 'concurrent', source: 'url', label: 'Changed', url: 'https://example.org/mcp' }]); }, function (f) { f.sessions.set(1, Object.assign({}, f.session)); }, function (f) { f.ws.readyState = 3; }, function (f) { f.session.sessionOriginId = 'replacement'; }];
  for (var change of changes) {
    var f = fixture(t), id = await f.inspect({ action: 'add_remote', url: 'https://example.com/mcp' });
    var task = f.invoke('apply_mcp_connection_change', { changeId: id }), card = await f.card();
    var foreign = { readyState: 1, _clayUser: { id: 'bob' }, _clayActiveSession: 1 }; f.clients.add(foreign); assert.equal(f.answer(card, foreign), false);
    assert.equal(f.answer(card), true); change(f); assert.equal((await task).status, 'refused'); assert.equal(f.requests.length, 0);
  }
});
test('Client MCP toggles share human persistence and refuse replaced device targets', async function (t) {
  var f = fixture(t), update = { type: 'mcp_servers_available', hostConnected: true, servers: [{ name: 'client-tool', tools: [], enabled: true }] }; f.manager.handleMcpMessage(f.ws, update);
  var id = await f.inspect({ action: 'client_enable', id: 'client:client-tool' }); assert.equal((await f.apply(id)).enabled, true); assert.equal(f.storage.load('alice').find(function (row) { return row.source === 'computer'; }).enabled, true);
  id = await f.inspect({ action: 'client_disable', id: 'client:client-tool' }); var task = f.invoke('apply_mcp_connection_change', { changeId: id }), card = await f.card(); f.answer(card); f.manager.handleMcpMessage(f.ws, update); assert.equal((await task).status, 'refused');
});
test('Xcode setup uses the fixed service and Stop prevents activation during a pending review', async function (t) {
  var f = fixture(t), id = await f.inspect({ action: 'xcode_connect' }), connected = await f.apply(id); assert.equal(connected.status, 'persisted'); assert.equal(connected.connection.integration, 'xcode'); assert.deepEqual(f.starts, ['/usr/bin/xcrun']);
  var stop = await f.inspect({ action: 'xcode_disconnect' }); assert.equal((await f.apply(stop)).connection.projectEnabled, false);
  id = await f.inspect({ action: 'xcode_connect' }); var task = f.invoke('apply_mcp_connection_change', { changeId: id }); await f.card(); f.session.abortController.abort(); assert.equal((await task).status, 'cancelled'); assert.equal(f.starts.length, 1);
});
test('secure form navigation uses the exact reviewer socket and reports client acceptance, not credential persistence', async function (t) {
  var f = fixture(t, { send: function (peer, msg, manager) { if (msg.type === 'mcp_settings_request') setImmediate(function () { manager.handleMcpMessage(peer, { type: 'mcp_settings_result', requestId: msg.requestId, slug: msg.slug, sessionId: msg.sessionId, accepted: true }); }); } });
  f.storage.save('alice', [{ id: 'saved', source: 'url', label: 'Saved', url: 'https://example.com/mcp', enabled: false }]);
  var id = await f.inspect({ action: 'enter_token', id: 'saved' }), result = await f.apply(id); assert.equal(result.status, 'client_accepted'); assert.equal(result.rendered, 'unconfirmed'); assert.equal(f.sent.find(function (entry) { return entry.msg.type === 'mcp_settings_request'; }).ws, f.ws); assert.equal(f.storage.load('alice')[0].token, undefined);
});
test('Stop during remote handshake records an unknown outcome and never replays the request', async function (t) {
  var release, started, entered = new Promise(function (resolve) { started = resolve; });
  var f = fixture(t, { fetch: async function (url, init) { var msg = JSON.parse(init.body || '{}'); if (msg.method === 'initialize') { started(); await new Promise(function (resolve) { release = resolve; }); } } });
  var id = await f.inspect({ action: 'add_remote', url: 'https://example.com/mcp' }), task = f.invoke('apply_mcp_connection_change', { changeId: id }), card = await f.card(); f.answer(card); await entered;
  f.session.abortController.abort(); release(); assert.equal((await task).status, 'unknown');
  assert.equal(f.storage.load('alice')[0].enabled, false); assert.equal(f.requests.filter(function (entry) { return JSON.parse(entry.init.body || '{}').method === 'initialize'; }).length, 1);
  assert.equal(f.tool('apply_mcp_connection_change'), undefined);
  f.session.abortController = new AbortController();
  assert.equal((await f.invoke('read_mcp_connections', { changeId: id })).status, 'unknown');
  assert.equal((await f.invoke('apply_mcp_connection_change', { changeId: id })).status, 'unknown'); assert.equal(f.storage.load('alice').length, 1);
});
test('sign-in starts only after review and Stop closes its private browser without exposing tokens', async function (t) {
  var f = fixture(t, { fetch: async function (input, init) {
    var url = String(input);
    if (url.includes('/.well-known/oauth-protected-resource')) return Response.json({ resource: 'https://example.com/mcp', authorization_servers: ['https://example.com'] });
    if (url.includes('/.well-known/oauth-authorization-server')) return Response.json({ issuer: 'https://example.com', authorization_endpoint: 'https://example.com/authorize', token_endpoint: 'https://example.com/token', registration_endpoint: 'https://example.com/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    if (url.endsWith('/register')) return Response.json(Object.assign(JSON.parse(init.body), { client_id: 'fixture' }), { status: 201 });
    if (url.endsWith('/mcp')) return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"' } });
  } });
  f.storage.save('alice', [{ id: 'saved', source: 'url', label: 'Saved', url: 'https://example.com/mcp', enabled: false }]);
  var id = await f.inspect({ action: 'signin', id: 'saved' }); assert.equal(f.requests.length, 0);
  var result = await f.apply(id); assert.equal(result.status, 'sign_in_started'); assert.ok(f.sent.some(function (entry) { return entry.msg && entry.msg.type === 'mcp_login_ready'; }));
  f.session.abortController.abort(); assert.ok(f.sent.some(function (entry) { return entry.closed; })); assert.equal(f.storage.load('alice')[0].auth.tokens, undefined);
});
test('queued approved changes revalidate Stop before admission and cannot save a second connection', async function (t) {
  var release, entered, started = new Promise(function (resolve) { entered = resolve; });
  var f = fixture(t, { fetch: async function (url, init) { var msg = JSON.parse(init.body || '{}'); if (msg.method === 'initialize') { entered(); await new Promise(function (resolve) { release = resolve; }); } } });
  f.manager.handleMcpMessage(f.ws, { type: 'mcp_connection_action', action: 'add', requestId: 'human', url: 'https://example.com/mcp' }); await started;
  var id = await f.inspect({ action: 'add_local', label: 'Queued', command: 'never-start-this', args: [], cwd: f.root }), task = f.invoke('apply_mcp_connection_change', { changeId: id }), card = await f.card(); f.answer(card);
  await new Promise(function (resolve) { setImmediate(resolve); }); f.session.abortController.abort(); release();
  assert.equal((await task).status, 'refused'); assert.equal(f.storage.load('alice').some(function (row) { return row.label === 'Queued'; }), false); assert.equal(f.starts.length, 0);
});
test('review receipts are bounded, expire after ten minutes and are scoped to the source query', async function (t) {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  var f = fixture(t), id;
  for (var i = 0; i < 100; i++) id = await f.inspect({ action: 'add_local', label: 'Bounded', command: 'never-start-this', args: [], cwd: f.root });
  assert.equal((await f.invoke('inspect_mcp_connection_change', { action: 'client_setup' })).status, 'refused');
  t.mock.timers.tick(10 * 60 * 1000 + 1);
  assert.equal((await f.invoke('read_mcp_connections', { changeId: id })).status, 'refused');
  id = await f.inspect({ action: 'client_setup' }); f.session._sdkQueryGeneration++;
  assert.equal((await f.invoke('read_mcp_connections', { changeId: id })).status, 'refused'); assert.equal(f.cards.length, 0); assert.equal(f.starts.length, 0);
});
