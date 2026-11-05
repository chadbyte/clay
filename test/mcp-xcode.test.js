var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var xcode = require('../lib/mcp-xcode');
var createStore = require('../lib/mcp-connection-store').createConnectionStore;
var createRemote = require('../lib/mcp-remote-connections').createRemoteConnections;
var StdioClientTransport = require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport;

function fixture(t, options) {
  options = options || {};
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-xcode-'));
  var storage = createStore(root, 'fixture', { shared: true });
  var script = path.join(root, 'mcp.cjs'), marker = path.join(root, 'started');
  fs.writeFileSync(script, [
    "var fs=require('fs');fs.appendFileSync(process.argv[2],'start\\n');",
    "require('readline').createInterface({input:process.stdin}).on('line',function(line){var msg=JSON.parse(line);if(msg.id===undefined)return;var result={};",
    "if(msg.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'Xcode fixture',version:'1'}};",
    "if(msg.method==='tools/list')result={tools:[{name:'BuildProject',description:'Build the selected project',inputSchema:{type:'object',properties:{target:{type:'string'}}}}]};",
    "if(msg.method==='tools/call'){if(msg.params.arguments.target==='crash'){process.exit(1);return;}result={content:[{type:'text',text:'Built '+msg.params.arguments.target}]};}",
    "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:result})+'\\n');});",
  ].join('\n'));
  var allowed = true, identity = null, probes = [], spawned = [];
  var ctx = { storage: storage, authorize: function (owner) { if (!allowed || owner !== 'alice') throw new Error('Account denied'); },
    canAccess: function (ws, owner) { return allowed && ws && ws.owner === owner && ws.readyState === 1; }, ownerIdentity: function () { return identity; }, changed: function () {},
    xcodeOptions: { platform: options.platform || 'darwin', uid: function () { return 501; }, execFile: function (command, args, settings, done) { probes.push({ command: command, args: args, settings: settings }); if (options.probe) options.probe(command, args, done); else done(null, '/fixture/bridge', ''); } },
    localTransport: function (row) { spawned.push(JSON.parse(JSON.stringify(row))); return new StdioClientTransport({ command: process.execPath, args: [script, marker], env: { HOME: root, PATH: process.env.PATH }, stderr: 'ignore' }); },
  };
  var manager = createRemote(ctx), ws = { owner: 'alice', readyState: 1 };
  t.after(function () { manager.destroy(); fs.rmSync(root, { recursive: true, force: true }); });
  return { manager: manager, ctx: ctx, ws: ws, storage: storage, probes: probes, spawned: spawned, root: root,
    identity: function (value) { identity = value; }, revoke: function () { allowed = false; },
    command: function (action, args) { return manager.command('alice', Object.assign({ action: action }, args || {}), ws); } };
}
test('Xcode check is bounded, read-only, and reports unsupported platforms, license, missing bridge and closed Xcode', async function (t) {
  var linux = fixture(t, { platform: 'linux' }); await linux.command('xcode_check');
  assert.equal(linux.manager.xcodeState('alice').supported, false); assert.equal(linux.probes.length, 0); assert.deepEqual(linux.storage.load('alice'), []);
  await assert.rejects(linux.command('xcode_connect'), /same Mac/);
  var cases = [
    { message: 'Xcode license not accepted', expected: /accept its license/ },
    { message: 'invalid active developer path', expected: /Command Line Tools/ },
    { message: 'mcpbridge not found', expected: /Install or update Xcode/ },
  ];
  for (var item of cases) {
    var f = fixture(t, { probe: function (command, args, done) { done(new Error('probe'), '', item.message); } });
    await f.command('xcode_check'); assert.match(f.manager.xcodeState('alice').message, item.expected); assert.equal(f.spawned.length, 0);
    assert.equal(f.probes[0].settings.timeout, 8000); assert.equal(f.probes[0].settings.maxBuffer, 16384);
  }
  var closed = fixture(t, { probe: function (command, args, done) { done(command.endsWith('pgrep') ? new Error('not running') : null, '/bridge'); } });
  await closed.command('xcode_check'); assert.match(closed.manager.xcodeState('alice').message, /Open Xcode/); assert.equal(closed.manager.xcodeState('alice').ready, false);
});
test('direct Xcode connection uses fixed stdio configuration, survives restart, shares only with its owner, and never duplicates', async function (t) {
  var f = fixture(t); await f.command('xcode_check'); assert.deepEqual(f.storage.load('alice'), []);
  var id = await f.command('xcode_connect', { command: 'evil', args: ['ignored'], env: { EVIL: 'ignored' }, integration: 'other' });
  assert.equal(f.spawned[0].command, '/usr/bin/xcrun'); assert.deepEqual(f.spawned[0].args, ['mcpbridge']); assert.deepEqual(f.spawned[0].env, {});
  var row = f.manager.view('alice')[0]; assert.equal(row.integration, 'xcode'); assert.equal(row.status, 'ready'); assert.equal(row.projectEnabled, true); assert.equal(row.toolCount, 1);
  assert.equal((await f.manager.call('alice', id, 'BuildProject', { target: 'App' }, function () {})).content[0].text, 'Built App');
  assert.equal(await f.command('xcode_connect'), id); assert.equal(f.storage.load('alice').length, 1); assert.deepEqual(f.storage.load('bob'), []);
  await assert.rejects(f.manager.command('bob', { action: 'xcode_connect' }, f.ws), /denied/);
  f.manager.destroy();
  var resumed = createRemote(f.ctx); t.after(function () { resumed.destroy(); });
  assert.equal(resumed.view('alice')[0].status, 'idle');
  assert.equal((await resumed.call('alice', id, 'BuildProject', { target: 'Resumed' }, function () {})).content[0].text, 'Built Resumed');
  await resumed.command('alice', { action: 'xcode_disconnect' }, f.ws);
  await assert.rejects(resumed.call('alice', id, 'BuildProject', {}, function () {}), /disabled/);
});
test('Xcode connection rejects other OS users, changing identities, revoked accounts and stale human sockets', async function (t) {
  var f = fixture(t); f.identity({ uid: 502, gid: 20, home: '/other' });
  await assert.rejects(f.command('xcode_connect'), /same macOS user|macOS user who/); assert.equal(f.probes.length, 0); assert.equal(f.spawned.length, 0);
  var release, held = fixture(t, { probe: function (command, args, done) { release = done; } });
  var pending = held.command('xcode_connect'); await new Promise(function (resolve) { setImmediate(resolve); });
  held.ws.readyState = 3; release(null, '/bridge'); await assert.rejects(pending, /access changed/); assert.equal(held.spawned.length, 0);
  var active = fixture(t), id = await active.command('xcode_connect'); active.identity({ uid: 501, gid: 20, home: '/changed' });
  await assert.rejects(active.manager.call('alice', id, 'BuildProject', {}, function () {}), /identity changed/);
  active.revoke(); assert.throws(function () { active.manager.view('alice'); }, /denied/);
});
test('cancel during checking and before queued connect admission prevents activation without automatic replay', async function (t) {
  var release, f = fixture(t, { probe: function (command, args, done) { release = done; } });
  var checking = f.command('xcode_check'); await new Promise(function (resolve) { setImmediate(resolve); });
  var connect = f.command('xcode_connect'); await f.command('xcode_disconnect'); release(null, '/bridge');
  await assert.rejects(checking, /cancelled/); await assert.rejects(connect, /cancelled/);
  assert.equal(f.spawned.length, 0); assert.deepEqual(f.storage.load('alice'), []);
});
test('unexpected Xcode exit marks the connection unavailable and a failed tool call is never replayed', async function (t) {
  var f = fixture(t), id = await f.command('xcode_connect');
  await assert.rejects(f.manager.call('alice', id, 'BuildProject', { target: 'crash' }, function () {}), /tool call failed/);
  assert.equal(f.spawned.length, 1); assert.equal(f.manager.view('alice')[0].status, 'unavailable');
});
test('failed Xcode handshakes stay disabled and an explicit retry reuses the saved connection', async function (t) {
  var f = fixture(t), transport = f.ctx.localTransport;
  f.ctx.localTransport = function () { return new StdioClientTransport({ command: process.execPath, args: ['-e', 'process.exit(1)'], env: { HOME: f.root }, stderr: 'ignore' }); };
  await assert.rejects(f.command('xcode_connect'), /Allow external agents/);
  var row = f.manager.view('alice')[0]; assert.equal(row.status, 'unavailable'); assert.equal(row.projectEnabled, false); assert.equal(row.toolCount, 0);
  f.ctx.localTransport = transport; assert.equal(await f.command('xcode_connect'), row.id); assert.equal(f.storage.load('alice').length, 1);
  assert.equal(f.manager.view('alice')[0].status, 'ready');
});
test('cancel during MCP catalog discovery closes the transport and a late catalog cannot reactivate tools', async function (t) {
  var f = fixture(t), release, started;
  var reached = new Promise(function (resolve) { started = resolve; });
  var Server = require('@modelcontextprotocol/sdk/server/index.js').Server;
  var schema = require('@modelcontextprotocol/sdk/types.js');
  var pair = require('@modelcontextprotocol/sdk/inMemory.js').InMemoryTransport.createLinkedPair();
  var server = new Server({ name: 'held-xcode', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(schema.ListToolsRequestSchema, async function () { started(); await new Promise(function (resolve) { release = resolve; }); return { tools: [{ name: 'BuildProject', inputSchema: { type: 'object' } }] }; });
  await server.connect(pair[1]); t.after(function () { server.close(); });
  f.ctx.localTransport = function () { return pair[0]; };
  var pending = f.command('xcode_connect'); await reached;
  await f.command('xcode_disconnect'); release(); await assert.rejects(pending, /cancelled/);
  assert.equal(f.storage.load('alice')[0].enabled, false); assert.equal(f.manager.view('alice')[0].toolCount, 0);
});
test('Xcode tagged records cannot replace the fixed executable or add environment injection', function () {
  var config = xcode.configuration(); xcode.validate(config);
  assert.throws(function () { xcode.validate(Object.assign({}, config, { command: '/bin/sh' })); }, /configuration changed/);
  assert.throws(function () { xcode.validate(Object.assign({}, config, { env: { DYLD_INSERT_LIBRARIES: '/evil' } })); }, /configuration changed/);
});
test('Xcode production messages feed native, dynamic and resumed bridge catalogs and retain session/Stop guards', async function (t) {
  var f = fixture(t), waiters = new Map(), messages = [], sessions = new Map();
  f.manager.destroy();
  var ws = { readyState: 1, _clayUser: { id: 'alice' }, owner: 'alice' }, clients = new Set([ws]), sequence = 0;
  var manager = require('../lib/project-mcp').attachMcp({ root: f.root, cwd: f.root, slug: 'xcode-fixture', storage: f.storage, clients: clients,
    xcodeOptions: f.ctx.xcodeOptions, localTransport: f.ctx.localTransport, ownerIdentity: function () { return null; }, identity: function () { return null; },
    isMultiUser: function () { return true; }, canAccess: function (peer) { return clients.has(peer) && peer.readyState === 1; }, canUseOwner: function (owner) { return owner === 'alice'; },
    canUseSession: function (session) { return sessions.get(session.localId) === session && session.ownerId === 'alice' && require('../lib/mcp-session-access').canUsePersonalConnections(session, sessions); },
    canDiscoverSession: function () { return false; },
    sendTo: function (peer, message) { messages.push(message); var resolve = waiters.get(message.requestId); if (resolve) { waiters.delete(message.requestId); resolve(message); } },
  }); t.after(function () { manager.destroy(); });
  function request(action) {
    return new Promise(function (resolve) { var id = 'request-' + (++sequence); waiters.set(id, resolve); manager.handleMcpMessage(ws, { type: 'mcp_connection_action', action: action, requestId: id }); });
  }
  assert.equal((await request('xcode_check')).ok, true); assert.equal(f.spawned.length, 0);
  var connected = await request('xcode_connect'); assert.equal(connected.ok, true);
  assert.ok(messages.some(function (msg) { return msg.type === 'mcp_servers_state' && msg.servers.some(function (row) { return row.integration === 'xcode' && row.projectEnabled; }); }));
  var vendors = ['claude', 'codex', 'kiro', 'opencode', 'kimi', 'grok', 'qwen', 'copilot', 'junie'];
  for (var vendor of vendors) {
    var session = { localId: sequence++, ownerId: 'alice', vendor: vendor, history: [], mode: 'gui', sessionVisibility: 'private' }; sessions.set(session.localId, session);
    var generation = 1;
    var bridge = require('../lib/mcp-query-bridge').createQueryBridge({ valid: function () { return generation === 1 && !session.stopped; }, getServers: function () { return manager.getMcpServers(session); } });
    var native = manager.getMcpServers(session)[connected.id]; assert.ok(native, vendor);
    assert.ok(bridge.list().some(function (tool) { return tool.server === connected.id && tool.name === 'BuildProject'; }));
    var dynamic = bridge.dynamicDefs().find(function (tool) { return tool.name.endsWith('__BuildProject'); }); assert.ok(dynamic.queryBound);
    assert.equal((await dynamic.handler({ target: vendor })).content[0].text, 'Built ' + vendor);
    session.cliSessionId = 'resumed-fixture'; assert.equal((await bridge.call(connected.id, 'BuildProject', { target: 'resumed' })).content[0].text, 'Built resumed');
    session.stopped = true; await assert.rejects(bridge.call(connected.id, 'BuildProject', {}), /authorized query/); session.stopped = false;
    generation++; assert.deepEqual(bridge.list(), []); await assert.rejects(dynamic.handler({}), /authorized query/);
    session.sessionVisibility = 'shared'; assert.deepEqual(manager.getMcpServers(session), {}); session.sessionVisibility = 'private';
    session._mcpForeignInput = true; assert.deepEqual(manager.getMcpServers(session), {}); delete session._mcpForeignInput;
    session.ownerId = 'bob'; assert.deepEqual(manager.getMcpServers(session), {}); session.ownerId = 'alice';
    sessions.set(session.localId, Object.assign({}, session)); assert.deepEqual(manager.getMcpServers(session), {});
  }
  var unsupported = { localId: 1000, ownerId: 'alice', vendor: 'antigravity', history: [] }; sessions.set(1000, unsupported); assert.deepEqual(manager.getMcpServers(unsupported), {});
  assert.equal((await request('xcode_disconnect')).ok, true); assert.equal(f.storage.load('alice')[0].enabled, false);
});
