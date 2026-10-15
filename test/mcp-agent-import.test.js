var liveQuery = require('./helpers/live-query-fixture.cjs');
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var os = require('os');
function fixture(t, timeout) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-agent-import-')), home = path.join(root, 'home'), cwd = path.join(root, 'project'); fs.mkdirSync(home); fs.mkdirSync(cwd);
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var file = path.join(home, '.claude.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { fixture: { command: 'never-execute-this-command', args: ['private-secret'], env: { TOKEN: '${API_TOKEN}' }, enabledTools: ['read_issue'], disabledTools: ['delete_issue'] } } }));
  var session = { localId: 1, ownerId: 'owner', vendor: 'claude', _sdkQueryGeneration: 4, history: [], abortController: new AbortController() };
  var runtime = {}, identityState = { value: null };
  var sessions = new Map([[1, session]]), owners = new Set(['owner', 'foreign']), clients = new Set(), cards = [], routed = 0;
  var ws = { readyState: 1, _clayUser: { id: 'owner' }, _clayActiveSession: 1 }; clients.add(ws);
  var ask = require('../lib/project-ask-user').attachAskUser({ record: function (value, event) { value.history.push(event); }, getWorkerQuestionRouter: function () { return { routeQuestion: function () { routed++; } }; } });
  var manager = require('../lib/project-mcp').attachMcp({ root: root, cwd: cwd, discoveryHome: home, slug: 'fixture', clients: clients,
    isMultiUser: function () { return true; }, canAccess: function (peer) { return !!peer._clayUser && owners.has(peer._clayUser.id); }, canUseOwner: function (owner) { return owners.has(owner); },
    canUseSession: function (value) { return sessions.get(value.localId) === value && owners.has(value.ownerId) && !value._mcpForeignInput && value.sessionVisibility !== 'shared'; },
    canDiscoverSession: function (value) { return sessions.get(value.localId) === value; }, runtimeEnvForSession: function () { return runtime; }, runtimeEnv: function () { return {}; }, ownerIdentity: function () { return identityState.value; }, identity: function () { return null; }, canDiscover: function () { return true; }, sendTo: function () {},
    userInput: function (value) { return function (request, respond) { cards.push({ request: request, respond: respond }); return ask.createHandler(value)(request, respond); }; }, consentTimeout: timeout || 5000,
  }); t.after(function () { manager.destroy(); });
  var store = require('../lib/mcp-connection-store').createConnectionStore(root, 'fixture', { shared: true });
  function invoke(name, args, value) { var server = manager.getMcpServers(value || session)['clay-mcp-connections']; assert.ok(server); var tool = server.instance._registeredTools[name]; return (tool.handler || tool.callback)(args || {}); }
  async function scan(value) { var output = JSON.parse((await invoke('discover_mcp_connections', {}, value)).content[0].text); assert.equal(output.status, 'discovered'); return { scanId: output.scanId, candidateId: output.candidates.find(function (row) { return row.vendor === 'claude' && row.name === 'fixture' && !row.blocked; }).id }; }
  async function card() { await new Promise(function (resolve) { setImmediate(resolve); }); assert.ok(cards.length); return cards[cards.length - 1]; }
  function answer(entry, peer, label) { if (!entry.request.authorizeResponse(peer)) return false; return entry.respond({ mcp_import: [label] }); }
  return { runtime: runtime, identityState: identityState, root: root, home: home, file: file, session: session, sessions: sessions, owners: owners, ws: ws, clients: clients, manager: manager, store: store, invoke: invoke, scan: scan, card: card, answer: answer, cards: cards, routed: function () { return routed; } };
}
test('native agent import uses a concrete owner card, shares a disabled copy, does not execute or expose secrets, and consumes consent once', async function (t) {
  var f = fixture(t), request = await f.scan(), before = fs.readFileSync(f.file, 'utf8');
  var task = f.invoke('propose_mcp_import', request), card = await f.card();
  assert.equal(f.store.load('owner').length, 0); assert.equal(f.routed(), 0);
  var text = card.request.questions[0].question;
  ['fixture', '.claude.json', 'stdio', 'never-execute-this-command', 'owner owner', 'DISABLED', 'read_issue', 'delete_issue', 'API_TOKEN'].forEach(function (part) { assert.ok(text.includes(part), part); }); assert.equal(text.includes('private-secret'), false);
  assert.equal(f.answer(card, f.ws, 'Import disabled copy'), true);
  var output = JSON.parse((await task).content[0].text); assert.equal(output.imported, true); assert.equal(output.enabled, false);
  assert.equal(f.store.load('owner')[0].enabled, false); assert.equal(f.store.load('foreign').length, 0); assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal(card.respond({ mcp_import: ['Import disabled copy'] }), false);
  output = JSON.parse((await f.invoke('propose_mcp_import', request)).content[0].text); assert.equal(output.status, 'refused'); assert.equal(f.store.load('owner').length, 1);
});
test('reject, cancel, timeout and absent human never import; model confirmation cannot replace consent', async function (t) {
  var f = fixture(t, 100), request = await f.scan();
  var forged = JSON.parse((await f.invoke('propose_mcp_import', Object.assign({ confirmed: true }, request))).content[0].text); assert.equal(forged.status, 'refused'); assert.equal(f.cards.length, 0);
  var task = f.invoke('propose_mcp_import', request), card = await f.card(); f.answer(card, f.ws, 'Keep unchanged'); assert.equal(JSON.parse((await task).content[0].text).status, 'declined');
  request = await f.scan(); task = f.invoke('propose_mcp_import', request); card = await f.card(); card.respond.cancel('Cancelled by owner'); assert.equal(JSON.parse((await task).content[0].text).status, 'cancelled');
  request = await f.scan(); task = f.invoke('propose_mcp_import', request); await f.card(); assert.equal(JSON.parse((await task).content[0].text).status, 'expired'); assert.ok(f.session.history.some(function (event) { return event.type === 'mcp_import_consent_expired'; }));
  f.clients.clear(); f.session._scheduledMessageProcessing = {}; request = await f.scan(); assert.equal(JSON.parse((await f.invoke('propose_mcp_import', request)).content[0].text).status, 'consent_unavailable'); assert.equal(f.store.load('owner').length, 0);
});
test('foreign/replaced owners, shared or foreign-input sessions, and other sessions cannot approve or reuse candidates', async function (t) {
  var f = fixture(t), request = await f.scan(), task = f.invoke('propose_mcp_import', request), card = await f.card();
  var foreignWs = { readyState: 1, _clayUser: { id: 'foreign' }, _clayActiveSession: 1 }; f.clients.add(foreignWs);
  assert.equal(f.answer(card, foreignWs, 'Import disabled copy'), false); assert.equal(f.store.load('owner').length, 0);
  f.session.ownerId = 'foreign'; assert.equal(f.answer(card, f.ws, 'Import disabled copy'), false); card.respond.cancel(); await task;
  f.session.ownerId = 'owner'; f.session._mcpForeignInput = true; assert.equal(f.manager.getMcpServers(f.session)['clay-mcp-connections'], undefined);
  delete f.session._mcpForeignInput; f.session.sessionVisibility = 'shared'; assert.equal(f.manager.getMcpServers(f.session)['clay-mcp-connections'], undefined); delete f.session.sessionVisibility;
  var other = Object.assign({}, f.session, { localId: 2, ownerId: 'foreign' }); f.sessions.set(2, other);
  assert.equal(JSON.parse((await f.invoke('propose_mcp_import', request, other)).content[0].text).status, 'refused'); assert.equal(f.store.load('foreign').length, 0);
});
test('source, catalog, runtime identity, owner revocation, query generation and disconnect races are revalidated after consent', async function (t) {
  var changes = [function (f) { f.runtime.CODEX_HOME = '/changed-runtime'; }, function (f) { f.identityState.value = { home: f.home, username: 'changed-owner' }; }, function (f) { fs.writeFileSync(f.file, '{}'); }, function (f) { f.store.save('owner', [{ id: 'concurrent', source: 'url', url: 'https://example.com/mcp', enabled: false }]); }, function (f) { f.session._sdkQueryGeneration++; }, function (f) { f.owners.delete('owner'); }, function (f) { f.ws.readyState = 3; }, function (f) { f.sessions.set(1, Object.assign({}, f.session)); }];
  for (var change of changes) {
    var f = fixture(t), request = await f.scan(), task = f.invoke('propose_mcp_import', request), card = await f.card();
    assert.equal(f.answer(card, f.ws, 'Import disabled copy'), true); change(f);
    var output = JSON.parse((await task).content[0].text); assert.equal(output.imported, false); assert.equal(output.status, 'refused'); assert.equal(f.store.load('owner').some(function (row) { return row.label === 'fixture'; }), false);
  }
});
test('Home viewers are registered by the server, owner checked and removed on detach', async function (t) {
  var f = fixture(t), home = { readyState: 1, _clayUser: { id: 'owner' } }, foreign = { readyState: 1, _clayUser: { id: 'foreign' } };
  f.clients.clear(); assert.throws(function () { f.manager.registerConsentViewer(foreign, f.session); }, /owner/);
  var detach = f.manager.registerConsentViewer(home, f.session), request = await f.scan(), task = f.invoke('propose_mcp_import', request), card = await f.card();
  assert.equal(f.answer(card, home, 'Import disabled copy'), true); detach(); assert.equal(JSON.parse((await task).content[0].text).imported, false);
});
test('actual coordinators register Driver, canonical Clay and Mate import tools and accept only live structured UI responses', function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mcp-agent-coordinator-')); t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var env = Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, 'config'), CLAY_CONFIG: '', SUDO_USER: '' });
  ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'OPENCODE_CONFIG_CONTENT'].forEach(function (key) { delete env[key]; });
  var output = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'fixtures/mcp-agent-consent.cjs'), root], { env: env, timeout: 30000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(output.status, 0, output.stderr + output.stdout); ['driver', 'clay', 'mate'].forEach(function (name) { assert.ok(output.stdout.includes(name + ' production owner consent and resumed catalog passed')); });
});
test('fresh and resumed native/dynamic/exact-query catalogs call real discovery and consent tools across supported runtimes', async function (t) {
  var vendors = ['claude', 'codex', 'kiro', 'opencode', 'kimi', 'grok', 'qwen', 'copilot', 'junie'];
  for (var vendor of vendors) {
    var f = fixture(t), session = f.session; session.vendor = vendor; var captures = [];
    var adapter;
    if (vendor === 'claude') adapter = require('../lib/yoke/adapters/claude').createClaudeAdapter({ cwd: f.root, loadSDK: function () { return Promise.resolve({ query: function (args) { captures.push(args.options); return liveQuery.create(); } }); } });
    else adapter = { vendor: vendor, createQuery: function (options) { captures.push(options); return Promise.resolve(liveQuery.create()); } };
    var sm = { sessions: f.sessions, modelsByVendor: { [vendor]: [] }, capabilitiesByVendor: { [vendor]: {} }, availableModels: [], saveSessionFile: function () {}, broadcastSessionList: function () {}, sendAndRecord: function () {}, sendToSession: function () {} };
    var bridge = require('../lib/sdk-bridge').createSDKBridge({ cwd: f.root, slug: 'mate', isMate: true, sessionManager: sm, adapter: adapter, adapters: Object.fromEntries([[vendor, adapter]]), send: function () {}, getRemoteMcpServers: function () { return f.manager.getMcpServers(session); }, canUseSessionTools: function () { return f.sessions.get(1) === session; } });
    await bridge.startQuery(session, 'Discover an MCP source', null, null); await liveQuery.retire(session); session.cliSessionId = 'resumed-fixture'; await bridge.startQuery(session, 'Review source import', null, null);
    var generation = session._sdkQueryGeneration;
    var exact = require('../lib/mcp-query-bridge').createQueryBridge({ valid: function () { return session._sdkQueryGeneration === generation; }, getServers: function () { return f.manager.getMcpServers(session); } });
    assert.ok(exact.list().some(function (tool) { return tool.server === 'clay-mcp-connections' && tool.name === 'propose_mcp_import'; }), vendor);
    var scan;
    if (vendor === 'claude') {
      var native = captures[1].mcpServers['clay-mcp-connections'].instance._registeredTools.discover_mcp_connections; scan = JSON.parse((await (native.handler || native.callback)({})).content[0].text);
    } else if (vendor === 'codex') {
      assert.ok(captures[0].dynamicTools.some(function (tool) { return tool.name === 'mcp__clay-mcp-connections__propose_mcp_import'; })); assert.ok(captures[1].sessionMcpServer.args.includes('--session-only'));
      var dynamic = captures[1].dynamicTools.find(function (tool) { return tool.name === 'mcp__clay-mcp-connections__discover_mcp_connections'; }); scan = JSON.parse((await dynamic.handler({})).content[0].text);
    } else { assert.ok(captures[1].adapterOptions[vendor === 'kiro' ? 'KIRO' : 'ACP'].mcpServers[0].args.includes('--query-generation')); scan = JSON.parse((await exact.call('clay-mcp-connections', 'discover_mcp_connections', {})).content[0].text); }
    var request = { scanId: scan.scanId, candidateId: scan.candidates.find(function (row) { return row.vendor === 'claude' && row.name === 'fixture'; }).id };
    var task = exact.call('clay-mcp-connections', 'propose_mcp_import', request), card = await f.card(); f.answer(card, f.ws, 'Import disabled copy'); assert.equal(JSON.parse((await task).content[0].text).imported, true, vendor);
    session._sdkQueryGeneration++; assert.deepEqual(exact.list(), []); await assert.rejects(exact.call('clay-mcp-connections', 'discover_mcp_connections', {}), /current authorized query/);
    await liveQuery.retire(session);
    f.manager.destroy();
  }
});
test('invalid or policy-blocked candidates produce no consent request, and invalid IDs cannot reset a spent review', async function (t) {
  var f = fixture(t), request = await f.scan(), task = f.invoke('propose_mcp_import', request), card = await f.card(); f.answer(card, f.ws, 'Keep unchanged'); await task;
  var output = JSON.parse((await f.invoke('propose_mcp_import', { scanId: 'invalid', candidateId: request.candidateId })).content[0].text); assert.equal(output.status, 'refused');
  output = JSON.parse((await f.invoke('propose_mcp_import', request)).content[0].text); assert.equal(output.status, 'refused'); assert.equal(f.cards.length, 1);
  fs.writeFileSync(f.file, JSON.stringify({ permissions: { deny: ['*'] }, mcpServers: { fixture: { command: 'never-execute-this-command' } } }));
  var scan = JSON.parse((await f.invoke('discover_mcp_connections', {})).content[0].text), candidate = scan.candidates.find(function (row) { return row.vendor === 'claude' && row.name === 'fixture'; }); assert.ok(candidate.blocked);
  output = JSON.parse((await f.invoke('propose_mcp_import', { scanId: scan.scanId, candidateId: candidate.id })).content[0].text); assert.equal(output.status, 'refused'); assert.equal(f.cards.length, 1); assert.equal(f.store.load('owner').length, 0);
});
test('approved consent that expires behind real queued SDK work cannot mutate the catalog', async function (t) {
  var f = fixture(t, 100), script = path.join(f.root, 'queue.cjs'), marker = path.join(f.root, 'calling');
  fs.writeFileSync(script, [
    "var fs=require('fs');var input=require('readline').createInterface({input:process.stdin});",
    "input.on('line',function(line){var msg=JSON.parse(line);if(msg.id===undefined)return;var result={};",
    "if(msg.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'queue',version:'1'}};",
    "if(msg.method==='tools/list')result={tools:[{name:'wait',inputSchema:{type:'object'}}]};",
    "function send(){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:result})+'\\n');}",
    "if(msg.method==='tools/call'){fs.writeFileSync(process.argv[2],'calling');result={content:[{type:'text',text:'done'}]};setTimeout(send,300);}else send();});",
  ].join('\n'));
  f.store.save('owner', [{ id: 'blocker', label: 'Queue fixture', source: 'local', transport: 'stdio', command: process.execPath, args: [script, marker], cwd: f.root, env: {}, enabled: true, tools: [{ name: 'wait', inputSchema: { type: 'object' } }] }]);
  var tool = f.manager.getMcpServers(f.session).blocker.instance._registeredTools.wait, blocking = (tool.handler || tool.callback)({});
  for (var i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise(function (resolve) { setTimeout(resolve, 5); }); assert.ok(fs.existsSync(marker));
  var request = await f.scan(), task = f.invoke('propose_mcp_import', request), card = await f.card(); assert.equal(f.answer(card, f.ws, 'Import disabled copy'), true);
  var output = JSON.parse((await task).content[0].text); assert.equal(output.imported, false); assert.match(output.message, /consent expired/); assert.equal((await blocking).content[0].text, 'done');
  assert.equal(f.store.load('owner').some(function (row) { return row.label === 'fixture'; }), false);
});
