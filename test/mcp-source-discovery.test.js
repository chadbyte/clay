var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var createDiscovery = require('../lib/mcp-source-discovery').createDiscovery;
var createStore = require('../lib/mcp-connection-store').createConnectionStore;
var attachMcp = require('../lib/project-mcp').attachMcp;
function setup(t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mcp-sources-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var home = path.join(root, 'home'), cwd = path.join(root, 'project'); fs.mkdirSync(home); fs.mkdirSync(cwd);
  function write(base, file, value) { var target = path.join(base, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); return target; }
  return { root: root, home: home, cwd: cwd, write: write };
}
function discovery(f) {
  var store = createStore(f.root, 'project', { shared: true });
  return createDiscovery({ cwd: f.cwd, home: f.home, identity: function () { return null; }, authorize: function (owner, ws) { if (ws.owner !== owner) throw new Error('denied'); }, snapshot: store.snapshot });
}
test('all registered runtime formats and plugin/agent sources are file-only, redacted and loss-preserving', function (t) {
  var f = setup(t), server = { command: 'node', args: ['--credential=private-value'], env: { TOKEN: '${API_TOKEN:-private-default}' } };
  var adapters = require('../lib/mcp-source-adapters').adapters;
  Object.keys(adapters).filter(function (vendor) { return vendor !== 'acp'; }).forEach(function (vendor) {
    var entry = vendor === 'opencode' ? { type: 'local', command: ['node', 'script.js'], environment: { TOKEN: '${API_TOKEN}' } } : server;
    var value = {}; value[adapters[vendor].key] = {}; value[adapters[vendor].key][vendor + '-server'] = entry;
    f.write(f.home, adapters[vendor].user[0], adapters[vendor].user[0].endsWith('.toml') ? '[mcp_servers.' + vendor + '-server]\ncommand="node"\nargs=["--credential=private-value"]\n[mcp_servers.' + vendor + '-server.env]\nTOKEN="${API_TOKEN:-private-default}"\n' : value);
  });
  f.write(f.cwd, '.mcp.json', { mcpServers: { project: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer private-value' } }, unknown: { type: 'ws', url: 'wss://example.com/mcp' } } });
  f.write(f.home, '.kiro/agents/current.md', '---\nmcpServers:\n  markdown-agent:\n    command: node\n---\nAgent body is not evaluated.');
  f.write(f.home, '.codex/plugins/cache/local/example/1/.mcp.json', { mcpServers: { codexPlugin: { type: 'http', url: 'https://example.com/plugin' } } });
  f.write(f.home, '.kiro/agents/custom.json', { mcpServers: { agent: server } });
  var pluginRoot = path.join(f.home, 'plugin');
  f.write(f.home, '.claude/plugins/installed_plugins.json', { plugins: { test: [{ installPath: pluginRoot, scope: 'user' }] } });
  f.write(pluginRoot, '.mcp.json', { plugin: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'] } });
  f.write(pluginRoot, '.claude-plugin/plugin.json', { mcpServers: { inline: { command: 'node' } } });
  var service = discovery(f), ws = { owner: 'owner' }, result = service.scan('owner', ws);
  assert.equal(new Set(result.candidates.map(function (row) { return row.vendor; })).size, 10);
  assert.ok(result.candidates.some(function (row) { return row.scope === 'agent'; }));
  assert.ok(result.candidates.some(function (row) { return row.scope === 'plugin'; }));
  assert.ok(result.candidates.some(function (row) { return row.name === 'inline'; }));
  assert.ok(result.candidates.some(function (row) { return row.name === 'markdown-agent'; }));
  assert.ok(result.candidates.some(function (row) { return row.name === 'codexPlugin' && row.vendor === 'codex' && row.scope === 'plugin'; }));
  assert.ok(result.diagnostics.some(function (row) { return /Unsupported transport/.test(row.message); }));
  assert.equal(JSON.stringify(result).includes('private-value'), false); assert.equal(JSON.stringify(result).includes('private-default'), false);
  assert.ok(result.candidates.some(function (row) { return row.references.includes('API_TOKEN'); }));
  var before = fs.readFileSync(path.join(f.cwd, '.mcp.json'), 'utf8'); service.scan('owner', ws);
  assert.equal(fs.readFileSync(path.join(f.cwd, '.mcp.json'), 'utf8'), before);
});
test('duplicate/conflict provenance remains selectable; foreign sockets and changed files cannot import old scans', function (t) {
  var f = setup(t), ws = { owner: 'owner' }, service = discovery(f);
  var file = f.write(f.home, '.claude.json', { mcpServers: { same: { command: 'node', args: ['one'] } }, projects: {} });
  f.write(f.cwd, '.mcp.json', { mcpServers: { same: { command: 'node', args: ['two'] }, duplicate: { command: 'node', args: ['one'] } } });
  var scan = service.scan('owner', ws); assert.ok(scan.candidates.some(function (row) { return row.conflict; })); assert.ok(scan.candidates.some(function (row) { return row.duplicate; }));
  var request = { scanId: scan.scanId, candidateId: scan.candidates[0].id };
  assert.throws(function () { service.selected('owner', { owner: 'foreign' }, request); }, /denied/);
  assert.throws(function () { service.selected('owner', { owner: 'owner' }, request); }, /expired/);
  fs.writeFileSync(file, '{}'); assert.throws(function () { service.selected('owner', ws, request); }, /changed/);
});
test('configured ACP arrays normalize commands, name/value env and remote transport without exposing headers', function (t) {
  var f = setup(t), service = discovery(f), ws = { owner: 'owner' };
  var file = f.write(f.cwd, 'agent.json', { mcpServers: [{ name: 'stdio', command: 'node', args: [], env: [{ name: 'TOKEN', value: 'secret' }] }, { name: 'remote', type: 'http', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', value: 'secret' }] }] });
  var scan = service.scan('owner', ws, { vendor: 'acp', file: file });
  assert.equal(scan.candidates.length, 2); assert.equal(JSON.stringify(scan).includes('secret'), false);
  assert.equal(service.selected('owner', ws, { scanId: scan.scanId, candidateId: scan.candidates[0].id }).config.env.TOKEN, 'secret');
});
test('production message import is disabled and performs no execution until enable; actual stdio process serves a Mate after restart', async function (t) {
  var f = setup(t), ws = { readyState: 1, _clayUser: { id: 'owner' } }, messages = [];
  var script = f.write(f.cwd, 'mcp.cjs', [
    "var fs=require('fs'); fs.writeFileSync(process.argv[2], 'started');",
    "var readline=require('readline'); var input=readline.createInterface({input:process.stdin});",
    "input.on('line',function(line){var msg=JSON.parse(line); if(msg.id===undefined)return; var result={};",
    "if(msg.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};",
    "if(msg.method==='tools/list')result={tools:[{name:'echo',inputSchema:{type:'object'}}]};",
    "if(msg.method==='tools/call')result={content:[{type:'text',text:JSON.stringify(msg.params.arguments)}]};",
    "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:result})+'\\n');});",
  ].join('\n'));
  var marker = path.join(f.cwd, 'started');
  f.write(f.home, '.kiro/settings/mcp.json', { mcpServers: { fixture: { command: process.execPath, args: [script, marker] } } });
  var session = { localId: 1, ownerId: 'owner', history: [], mode: 'gui' };
  function manager(slug) {
    return attachMcp({ root: f.root, cwd: f.cwd, discoveryHome: f.home, slug: slug, clients: new Set([ws]),
      isMultiUser: function () { return true; }, canAccess: function (peer) { return peer === ws; }, canUseOwner: function (owner) { return owner === 'owner'; }, canUseSession: function (value) { return value === session; },
      canDiscover: function () { return true; }, identity: function () { return null; }, sendTo: function (peer, msg) { messages.push(msg); }, getEnabledMcpServers: function () { return []; } });
  }
  var source = manager('source'); t.after(function () { source.destroy(); });
  source.handleMcpMessage(ws, { type: 'mcp_discovery_request', requestId: 'scan' });
  var scan = messages.find(function (msg) { return msg.type === 'mcp_discovery_result'; }); assert.equal(scan.ok, true);
  source.handleMcpMessage(ws, { type: 'mcp_connection_action', action: 'import', requestId: 'import', scanId: scan.scanId, candidateId: scan.candidates[0].id });
  await new Promise(function (resolve) { setImmediate(resolve); });
  var result = messages.find(function (msg) { return msg.requestId === 'import'; }); assert.equal(result.ok, true);
  assert.equal(fs.existsSync(marker), false); assert.deepEqual(source.getMcpServers(session), {});
  source.handleMcpMessage(ws, { type: 'mcp_connection_action', action: 'enable', requestId: 'enable', id: result.id, enabled: true });
  for (var i = 0; i < 100 && !messages.some(function (msg) { return msg.requestId === 'enable'; }); i++) await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(messages.find(function (msg) { return msg.requestId === 'enable'; }).ok, true); assert.equal(fs.readFileSync(marker, 'utf8'), 'started');
  source.destroy();
  var mate = manager('mate'); t.after(function () { mate.destroy(); });
  var proxy = mate.getMcpServers(session)[result.id], tool = proxy.instance._registeredTools.echo;
  var response = await (tool.handler || tool.callback)({ value: 'resumed' }); assert.equal(response.content[0].text, '{"value":"resumed"}');
});
test('credential substitution keeps secrets out of public requirements and does not read referenced files', function () {
  var helper = require('../lib/mcp-import-credentials');
  var row = { env: { TOKEN: '${TOKEN:-hidden-default}' }, headers: { Authorization: 'Bearer ${API_KEY}' }, references: ['${TOKEN:-hidden-default}', '${API_KEY}'], environmentNames: [] };
  assert.deepEqual(helper.requiredNames(row), ['TOKEN', 'API_KEY']);
  var next = helper.applyCredentials(row, { TOKEN: 'private-token', API_KEY: 'private-key' });
  assert.equal(next.env.TOKEN, 'private-token'); assert.equal(next.headers.Authorization, 'Bearer private-key'); assert.deepEqual(next.references, []);
  assert.throws(function () { helper.applyCredentials({ references: ['{file:/credentials}'] }, {}); }, /vendor-specific/);
});

test('Copilot discovery includes ancestor definitions only up to the nearest Git root', function (t) {
  var f = setup(t); fs.mkdirSync(path.join(f.cwd, '.git')); var nested = path.join(f.cwd, 'nested'); fs.mkdirSync(nested);
  f.write(f.cwd, '.github/mcp.json', { mcpServers: { ancestor: { command: 'node' } } });
  var service = discovery(Object.assign({}, f, { cwd: nested }));
  var scan = service.scan('owner', {owner:'owner'});
  assert.ok(scan.candidates.some(function (row) { return row.vendor === 'copilot' && row.name === 'ancestor' && row.scope === 'project-ancestor'; }));
});
