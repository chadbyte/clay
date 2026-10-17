var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var adapters = require('../lib/mcp-source-adapters');
var policy = require('../lib/mcp-tool-policy');
var createDiscovery = require('../lib/mcp-source-discovery').createDiscovery;
function fixture(t, runtime) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-effective-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var home = path.join(root, 'home'), cwd = path.join(root, 'project'); fs.mkdirSync(home); fs.mkdirSync(cwd);
  var ws = { owner: 'owner' }, env = runtime || {};
  function write(file, value) { var target = path.resolve(home, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); return target; }
  var service = createDiscovery({ home: home, cwd: cwd, identity: function () { return null; }, runtimeEnv: function (owner, peer) { assert.equal(owner, 'owner'); assert.equal(peer, ws); return env; }, authorize: function (owner, peer) { assert.equal(owner, peer.owner); }, snapshot: function () { return { records: [], revision: 'revision' }; } });
  function selected(scan, row) { return service.selected('owner', ws, { scanId: scan.scanId, candidateId: row.id }).config; }
  return { home: home, cwd: cwd, write: write, service: service, ws: ws, env: env, selected: selected };
}
test('every adapter preserves generic allow/deny mappings and verified vendor policy keys', function () {
  var source = { scope: 'user', cwd: '/tmp' };
  Object.keys(adapters.adapters).forEach(function (vendor) {
    [['enabled_tools', 'disabled_tools'], ['enabledTools', 'disabledTools'], ['includeTools', 'excludeTools']].forEach(function (keys) {
      var value = { command: 'example-server' }; value[keys[0]] = ['read', 'write']; value[keys[1]] = ['write'];
      var config = adapters.normalize(vendor, 'example', value, source);
      assert.equal(policy.permits(config, 'read'), true, vendor); assert.equal(policy.permits(config, 'write'), false, vendor); assert.equal(policy.permits(config, 'other'), false, vendor);
      value[keys[0]] = []; assert.equal(policy.permits(adapters.normalize(vendor, 'example', value, source), 'read'), false);
      [null, false, '', {}, ['read', null]].forEach(function (bad) { value[keys[0]] = bad; assert.throws(function () { adapters.normalize(vendor, 'example', value, source); }, /policy/); });
      value[keys[0]] = ['read']; value[keys[1]] = null; assert.throws(function () { adapters.normalize(vendor, 'example', value, source); }, /policy/);
    });
  });
  assert.deepEqual(adapters.normalize('copilot', 'example', { command: 'example-server', tools: ['read_issue'] }, source).enabledTools, ['read_issue']);
  assert.equal(policy.permits(adapters.normalize('copilot', 'example', { command: 'server', tools: ['*'], disabledTools: ['write'] }, source), 'read'), true);
  assert.equal(policy.permits(adapters.normalize('copilot', 'example', { command: 'server', tools: [] }, source), 'read'), false);
  [null, {}, false].forEach(function (tools) { assert.throws(function () { adapters.normalize('copilot', 'example', { command: 'server', tools: tools }, source); }, /policy/); });
  ['security', 'allowedActions', 'permissions', 'default_tools_approval_mode', 'authProviderType', 'tools'].forEach(function (key) {
    var value = { command: 'server' }; value[key] = {}; assert.throws(function () { adapters.normalize('codex', 'example', value, source); }, /Unsupported/);
  });
});
test('owner runtime roots and inline sources take precedence and invalidate changed runtime snapshots', function (t) {
  var f = fixture(t, { CODEX_HOME: 'custom-codex', CLAUDE_CONFIG_DIR: 'custom-claude', KIMI_CODE_HOME: 'custom-kimi', XDG_CONFIG_HOME: 'custom-xdg' });
  f.write('custom-codex/config.toml', '[mcp_servers.codex]\ncommand="node"\nenabled_tools=["read"]');
  f.write('custom-claude/.claude.json', { mcpServers: { claude: { command: 'node' } } });
  f.write('custom-kimi/mcp.json', { mcpServers: { kimi: { command: 'node' } } });
  f.write('custom-xdg/opencode/opencode.json', { mcp: { inline: { type: 'local', command: ['node'], disabledTools: ['write'] } } });
  f.write('.codex/config.toml', '[mcp_servers.wrong]\ncommand="node"');
  f.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ mcp: { inline: { command: ['node', 'effective.js'] } }, tools: { 'inline_delete*': false } });
  var scan = f.service.scan('owner', f.ws), names = scan.candidates.map(function (row) { return row.name; });
  ['codex', 'claude', 'kimi', 'inline'].forEach(function (name) { assert.ok(names.includes(name)); }); assert.equal(names.includes('wrong'), false);
  var active = scan.candidates.find(function (row) { return row.scope === 'runtime-inline'; });
  var config = f.selected(scan, active); assert.deepEqual(config.args, ['effective.js']); assert.deepEqual(config.disabledTools, ['write']); assert.equal(policy.permits(config, 'delete_issue'), false); assert.equal(policy.permits(config, 'write'), false);
  assert.ok(scan.candidates.find(function (row) { return row.name === 'inline' && row.scope === 'user'; }).blocked);
  assert.equal(JSON.stringify(config.provenance).includes('OPENCODE_CONFIG_CONTENT\":'), false);
  f.env.CODEX_HOME = 'changed'; assert.throws(function () { f.selected(scan, active); }, /Runtime configuration changed/);
});
test('mapped owners ignore ambient daemon roots unless supplied through their authorized runtime resolver', function () {
  var context = require('../lib/mcp-source-context'), previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = '/another-owner';
  try {
    var result = context.resolve({ cwd: '/project' }, 'owner', {}, '/mapped-home', { home: '/mapped-home' }); assert.equal(result.roots.codex, '/mapped-home/.codex');
    result = context.resolve({ cwd: '/project', runtimeEnv: function () { return { CODEX_HOME: '/mapped-home/custom' }; } }, 'owner', {}, '/mapped-home', { home: '/mapped-home' }); assert.equal(result.roots.codex, '/mapped-home/custom');
  } finally { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; }
});
test('plugin selection uses Claude registry scope and Codex actual local/highest-version rule, retaining policies', function (t) {
  var f = fixture(t), first = path.join(f.home, 'claude-old'), second = path.join(f.home, 'claude-current');
  f.write('.claude/plugins/installed_plugins.json', { plugins: { 'example@local': [{ installPath: first, scope: 'user', version: '1' }, { installPath: second, scope: 'project', projectPath: f.cwd, version: '2' }] } });
  f.write('.claude/settings.json', { enabledPlugins: { 'example@local': true } });
  f.write(first + '/.mcp.json', { mcpServers: { old: { command: 'node' } } }); f.write(second + '/.mcp.json', { mcpServers: { current: { command: 'node', disabledTools: ['delete'] } } });
  f.write('.codex/config.toml', '[plugins."example@local"]\nenabled=false\n[plugins."example@local".mcp_servers.codex]\nenabled_tools=["read"]');
  ['1.9.0', '1.10.0'].forEach(function (version) { f.write('.codex/plugins/cache/local/example/' + version + '/mcp.json', { mcpServers: { codex: { command: 'node' } } }); });
  var scan = f.service.scan('owner', f.ws), claude = scan.candidates.find(function (row) { return row.name === 'current'; }), codex = scan.candidates.find(function (row) { return row.name === 'codex'; });
  assert.equal(scan.candidates.some(function (row) { return row.name === 'old'; }), false); assert.equal(claude.sourceEnabled, true); assert.equal(claude.pluginVersion, '2'); assert.equal(policy.permits(f.selected(scan, claude), 'delete'), false);
  assert.equal(codex.pluginVersion, '1.10.0'); assert.equal(codex.sourceEnabled, false); assert.deepEqual(f.selected(scan, codex).enabledTools, ['read']);
  f.write('.codex/plugins/cache/local/example/local/mcp.json', { mcpServers: { codex: { command: 'node' } } });
  scan = f.service.scan('owner', f.ws); assert.equal(scan.candidates.find(function (row) { return row.name === 'codex'; }).pluginVersion, 'local');
});
test('local policies, unknown restrictions, malformed policies and policy appearance block import, including explicit files', function (t) {
  var f = fixture(t), source = f.write('.codex/config.toml', '[mcp_servers.example]\ncommand="node"');
  var scan = f.service.scan('owner', f.ws), row = scan.candidates.find(function (item) { return item.name === 'example'; });
  f.write('.codex/requirements.toml', '[mcp_servers]\n'); assert.throws(function () { f.selected(scan, row); }, /changed/);
  scan = f.service.scan('owner', f.ws, { vendor: 'codex', file: source }); row = scan.candidates.find(function (item) { return item.scope === 'configured'; }); assert.ok(row.blocked); assert.throws(function () { f.selected(scan, row); }, /policy/);
  f.write('.copilot/mcp-config.json', { mcpServers: { unknown: { command: 'node', futureRestriction: ['read'] }, malformed: { command: 'node', tools: null } } });
  scan = f.service.scan('owner', f.ws); assert.equal(scan.candidates.some(function (item) { return item.name === 'unknown' || item.name === 'malformed'; }), false); assert.ok(scan.diagnostics.some(function (item) { return /Unsupported restriction/.test(item.message); }));
});
test('Copilot policy filters the actual SDK catalog and refuses excluded calls even with poisoned persisted tools', async function (t) {
  var f = fixture(t), store = require('../lib/mcp-connection-store').createConnectionStore(f.home, 'source', { shared: true });
  var script = f.write('server.cjs', [
    "var readline=require('readline'); var input=readline.createInterface({input:process.stdin});",
    "input.on('line',function(line){var msg=JSON.parse(line);if(msg.id===undefined)return;var result={};",
    "if(msg.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'policy',version:'1'}};",
    "if(msg.method==='tools/list')result={tools:[{name:'read_issue',inputSchema:{type:'object'}},{name:'delete_issue',inputSchema:{type:'object'}}]};",
    "if(msg.method==='tools/call')result={content:[{type:'text',text:msg.params.name}]};",
    "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:result})+'\\n');});",
  ].join('\n'));
  var row = adapters.normalize('copilot', 'restricted', { command: process.execPath, args: [script], tools: ['read_issue'] }, { scope: 'user', cwd: f.cwd });
  row.id = 'restricted'; row.name = row.id; row.enabled = true; store.save('owner', [row]);
  var remote = require('../lib/mcp-remote-connections').createRemoteConnections({ storage: store, authorize: function () {}, changed: function () {}, ownerIdentity: function () { return null; } });
  t.after(function () { remote.destroy(); });
  assert.equal((await remote.call('owner', row.id, 'read_issue', {}, function () {})).content[0].text, 'read_issue');
  assert.deepEqual(remote.view('owner')[0].tools.map(function (tool) { return tool.name; }), ['read_issue']);
  var saved = store.snapshot('owner'); saved.records[0].tools.push({ name: 'delete_issue', inputSchema: { type: 'object' } }); store.save('owner', saved.records, saved.revision);
  await assert.rejects(remote.call('owner', row.id, 'delete_issue', {}, function () {}), /excluded/);
});
test('OpenCode mapped runtime cannot inherit daemon inline content at process preparation', function () {
  var profiles = require('../lib/yoke/acp-agent-profiles'), profile = profiles.ACP_AGENT_PROFILES ? profiles.ACP_AGENT_PROFILES.opencode : profiles.getAgentProfile('opencode');
  var previous = process.env.OPENCODE_CONFIG_CONTENT; process.env.OPENCODE_CONFIG_CONTENT = '{"mcp":{"foreign":{"type":"local","command":["foreign"]}}}';
  try {
    var result = profile.buildProcessOptions({ driverState: { agentNames: [] } }, { env: { HOME: '/mapped-home' } });
    assert.equal(JSON.parse(result.env.OPENCODE_CONFIG_CONTENT).mcp, undefined);
  } finally { if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT; else process.env.OPENCODE_CONFIG_CONTENT = previous; }
});
test('additional verified runtime roots and configured operator sources are owner scoped', function (t) {
  var f = fixture(t, { COPILOT_HOME: 'alternate-copilot', GROK_HOME: 'alternate-grok', QWEN_HOME: '../home/alternate-qwen' });
  f.write('alternate-copilot/mcp-config.json', { mcpServers: { copilot: { command: 'node', tools: [] } } });
  f.write('alternate-grok/config.toml', '[mcp_servers.grok]\ncommand="node"');
  f.write('alternate-qwen/settings.json', { mcpServers: { qwen: { command: 'node', includeTools: ['read'] } } });
  var scan = f.service.scan('owner', f.ws);
  ['copilot', 'grok', 'qwen'].forEach(function (name) { assert.ok(scan.candidates.some(function (row) { return row.name === name; })); });
  f.env.QWEN_CODE_SYSTEM_SETTINGS_PATH = f.write('operator.json', { permissions: { deny: ['write'] } });
  scan = f.service.scan('owner', f.ws); assert.ok(scan.candidates.find(function (row) { return row.name === 'qwen'; }).blocked);
});
test('new plugin versions invalidate scan selection; unresolved Claude activation is visible and cannot import', function (t) {
  var f = fixture(t);
  f.write('.codex/config.toml', '[plugins."example@local"]\nenabled=true');
  f.write('.codex/plugins/cache/local/example/1.0.0/mcp.json', { mcpServers: { versioned: { command: 'node' } } });
  var scan = f.service.scan('owner', f.ws), row = scan.candidates.find(function (item) { return item.name === 'versioned'; });
  f.write('.codex/plugins/cache/local/example/2.0.0/mcp.json', { mcpServers: { versioned: { command: 'node' } } });
  assert.throws(function () { f.selected(scan, row); }, /selection changed/);
  f.write('.claude/plugins/installed_plugins.json', { plugins: { 'example@local': [{ scope: 'user', installPath: path.join(f.home, 'unresolved') }] } });
  f.write('unresolved/.mcp.json', { mcpServers: { unresolved: { command: 'node' } } });
  scan = f.service.scan('owner', f.ws); row = scan.candidates.find(function (item) { return item.name === 'unresolved'; });
  assert.equal(row.sourceEnabled, null); assert.match(row.blocked, /enablement is unknown/); assert.throws(function () { f.selected(scan, row); }, /unknown/);
});
test('settings merge retains local Claude disablement and partial Codex project overrides', function (t) {
  var f = fixture(t), plugin = path.join(f.home, 'claude-plugin');
  f.write('.claude/plugins/installed_plugins.json', { plugins: { 'example@local': [{ installPath: plugin, scope: 'user', version: '1' }] } });
  f.write('.claude/settings.json', { enabledPlugins: { 'example@local': true } });
  f.write(path.join(f.cwd, '.claude/settings.local.json'), { enabledPlugins: { 'example@local': false } });
  f.write(plugin + '/.mcp.json', { mcpServers: { claude: { command: 'node' } } });
  f.write('.codex/config.toml', '[plugins."example@local"]\nenabled=false');
  f.write(path.join(f.cwd, '.codex/config.toml'), '[plugins."example@local".mcp_servers.codex]\nenabled_tools=[]');
  f.write('.codex/plugins/cache/local/example/1.0.0/mcp.json', { mcpServers: { codex: { command: 'node' } } });
  var scan = f.service.scan('owner', f.ws);
  assert.equal(scan.candidates.find(function (row) { return row.name === 'claude'; }).sourceEnabled, false);
  var codex = scan.candidates.find(function (row) { return row.name === 'codex'; }); assert.equal(codex.sourceEnabled, false); assert.deepEqual(f.selected(scan, codex).enabledTools, []);
});
test('actual production coordinator discovers persisted runtime environment roots and inline sources', function (t) {
  var f = fixture(t);
  var result = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'fixtures/mcp-runtime-context.cjs'), f.home], {
    env: Object.assign({}, process.env, { HOME: f.home, CLAY_HOME: path.join(f.home, 'config'), SUDO_USER: '', CLAY_CONFIG: '' }), timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /production runtime root and inline discovery passed/);
});
