var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
function source(name) { return fs.readFileSync(path.join(__dirname, '../lib/public/modules', name + '.js'), 'utf8').replace(/^import .*$/gm, '').replace(/^export \{.*$/gm, '').replace(/export function /g, 'function '); }
var servers = [
  { id: 'local', label: 'Host program', name: 'local', source: 'local', status: 'ready', tools: [], toolCount: 0 },
  { id: 'remote', label: 'Remote service', name: 'remote', source: 'url', status: 'ready', tools: [], toolCount: 0 },
  { id: 'computer', label: 'Extension program', name: 'computer', source: 'computer', status: 'ready', tools: [], toolCount: 0 },
];
function render(state) {
  var root = { dataset: {}, innerHTML: '', contains: function () { return false; }, closest: function () { return null; }, querySelectorAll: function () { return []; }, querySelector: function () { return null; } };
  var box = { document: { activeElement: null }, escapeHtml: function (value) { return String(value).replace(/[&<>"']/g, ''); }, iconHtml: function () { return ''; }, refreshIcons: function () {}, enhanceSettingsSelects: function () {} };
  vm.runInNewContext(source('mcp-connection-view') + '\nthis.render=renderConnections;', box);
  box.render(root, Object.assign({ loaded: true, servers: servers }, state), {}); return root.innerHTML;
}
test('one MCP list contains every source while Client setup only lists extension connections', function () {
  var html = render({});
  assert.match(html, /Host program/); assert.match(html, /Remote service/); assert.match(html, /Extension program/);
  assert.match(html, /Enable Host program for your private sessions and Mates/); assert.match(html, /Enable Extension program in this project/);
  var client = render({ screen: 'client' });
  assert.match(client, /Extension program/); assert.doesNotMatch(client, /Host program|Remote service/);
  assert.match(render({ screen: 'list', servers: [] }), /Add connection/);
});
test('four setup choices lead to distinct local and client flows without extension setup leaking into local', function () {
  var add = render({ screen: 'add' });
  assert.deepEqual(Array.from(add.matchAll(/class="mc-choice" data-action="([^"]+)"/g), function (match) { return match[1]; }), ['local', 'remote', 'discovery', 'client']);
  var local = render({ screen: 'local' });
  assert.match(local, /data-form="local"/); assert.match(local, /data-action="xcode"/);
  assert.doesNotMatch(local, /data-action="setup"|clay-mcp-bridge install/);
  assert.match(render({ screen: 'computer' }), /data-form="local"/);
  assert.match(render({ screen: 'client', servers: [] }), /data-action="setup"/);
});
test('navigation retains setup drafts and late save receipts do not replace another screen', function () {
  var state = { mcpConnections: { servers: servers, screen: 'local', localDraft: { command: 'npx' } }, mcpSkillsWorkbench: { open: true, tab: 'mcp' } };
  var sent = [];
  var box = { document: { getElementById: function () { return null; } }, crypto: { randomUUID: function () { return 'request'; } },
    store: { get: function (key) { return state[key]; }, set: function (value) { Object.assign(state, value); } },
    setTimeout: function () { return 1; }, clearTimeout: function () {}, getWs: function () { return { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } }; } };
  vm.runInNewContext(source('mcp-ui') + '\nthis.api={navigate:navigate,action:action,toggle:toggle,state:handleMcpServersState,result:handleMcpConnectionMessage};', box);
  box.api.action('add_local', { command: 'npx', argumentsJson: '[]' }); box.api.navigate('client');
  box.api.result({ type: 'mcp_action_result', requestId: 'request', action: 'add_local', id: 'new-server', ok: true });
  assert.equal(state.mcpConnections.screen, 'client'); assert.equal(state.mcpConnections.localDraft.command, 'npx');
  box.api.state({ servers: [Object.assign({}, servers[0], { id: 'same' }), Object.assign({}, servers[2], { id: 'same' })] });
  assert.equal(state.mcpConnections.servers[0].id, 'same'); assert.equal(state.mcpConnections.servers[1].id, 'client:same');
  box.api.navigate('computer'); assert.equal(state.mcpConnections.screen, 'local');
  box.api.toggle(servers[2], true); assert.equal(sent.at(-1).type, 'mcp_toggle_server'); assert.equal(sent.at(-1).name, 'computer');
  box.api.toggle(servers[0], true); assert.equal(sent.at(-1).action, 'enable'); assert.equal(sent.at(-1).id, 'local');
});
