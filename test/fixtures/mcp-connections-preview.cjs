// Production UI preview with isolated sample data; no real accounts or credentials.
var http = require('http');
var fs = require('fs');
var path = require('path');
var root = path.resolve(__dirname, '../../lib/public');
var index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var sections = index.slice(index.indexOf('<div id="skills-modal"'), index.indexOf('<!-- Debate Modal'));
var script = `
import { createStore, store } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';
import { initMcp, handleMcpServersState, handleMcpConnectionMessage } from '/modules/mcp-ui.js';
import { initExtensionSettings } from '/modules/extension-settings.js';
var servers = [], xcode = null;
if (location.pathname === '/mcp-tabs') servers = [
  { id: 'server-local', name: 'server-local', label: 'Server files', source: 'local', transport: 'stdio', status: 'ready', projectEnabled: true, extensionEnabled: true, tools: [{ name: 'read_server_file', inputSchema: { type: 'object' } }], toolCount: 1 },
  { id: 'server-remote', name: 'server-remote', label: 'Remote documents', source: 'url', url: 'https://example.com/mcp', status: 'ready', projectEnabled: false, extensionEnabled: true, tools: [], toolCount: 0 },
  { id: 'chrome-files', name: 'chrome-files', label: 'Chrome files', source: 'computer', transport: 'stdio', status: 'ready', projectEnabled: true, extensionEnabled: true, tools: [{ name: 'read_computer_file', inputSchema: { type: 'object' } }], toolCount: 1 }
];
var xcodeMode = location.pathname === '/xcode-failure' ? 'failure' : location.pathname === '/xcode-unsupported' ? 'unsupported' : '';
createStore({ currentSlug: 'preview', myUserId: 'owner', activeSessionId: 1, connected: true, permissions: { skills: true }, mcpSkillsWorkbench: {} });
function state() { handleMcpServersState({ slug: 'preview', servers: servers, xcode: xcode, hostConnected: location.pathname === '/mcp-tabs', extensionConnected: location.pathname === '/mcp-tabs', extensionId: location.pathname === '/mcp-tabs' ? 'fixture-extension' : null }); }
setWs({ readyState: 1, send: function (payload) {
  var msg = JSON.parse(payload);
  if (msg.type === 'mcp_state_request') { setTimeout(state, 30); return; }
  if (msg.type === 'mcp_toggle_server') { var server = servers.find(function (item) { return item.source === 'computer' && item.name === msg.name; }); if (server) server.projectEnabled = msg.enabled; state(); return; }
  if (msg.type === 'mcp_discovery_request') { setTimeout(function () { handleMcpConnectionMessage({ type: 'mcp_discovery_result', requestId: msg.requestId, ok: true, scanId: 'fixture-scan', candidates: [{ id: 'fixture-source', name: 'Example local tool', vendor: 'kiro', scope: 'user', file: '/home/fixture/.kiro/settings/mcp.json', transport: 'stdio', dependency: 'node', references: ['API_TOKEN'], sourceEnabled: true, duplicate: true, conflict: false }], diagnostics: [{ vendor: 'claude', scope: 'plugin', message: 'Unsupported transport: ws' }] }); }, 100); return; }
  if (msg.type !== 'mcp_connection_action') return;
  setTimeout(function () {
    var row = servers.find(function (item) { return item.id === msg.id; });
    if (msg.action === 'xcode_check') xcode = xcodeMode === 'unsupported' ? { supported: false, ready: false, message: 'Xcode requires Clay Studio to run on the same Mac as Xcode.' } : { supported: true, ready: true, message: 'Xcode is running and its MCP bridge is available. Open your project and allow external agents before connecting.' };
    if (msg.action === 'xcode_connect') {
      row = servers.find(function (item) { return item.integration === 'xcode'; });
      if (!row) { row = { id: 'fixture-xcode', name: 'fixture-xcode', label: 'Xcode', integration: 'xcode', source: 'local', transport: 'stdio', extensionEnabled: true }; servers.push(row); }
      row.status = 'ready'; row.error = ''; row.projectEnabled = true; row.tools = [{ name: 'BuildProject', description: 'Build the project currently open in Xcode.', inputSchema: { type: 'object' } }, { name: 'RunAllTests', description: 'Run tests in the selected Xcode project.', inputSchema: { type: 'object' } }]; row.toolCount = row.tools.length;
      if (xcodeMode === 'failure') { row.status = 'unavailable'; row.projectEnabled = false; row.tools = []; row.toolCount = 0; row.error = 'Could not connect to Xcode. Open your project, turn on “Allow external agents to use Xcode tools” in Xcode Settings → Intelligence, and approve Clay’s connection in Xcode if asked. Then try again.'; state(); handleMcpConnectionMessage({ type: 'mcp_action_result', requestId: msg.requestId, ok: false, error: row.error }); return; }
    }
    if (msg.action === 'xcode_disconnect') { row = servers.find(function (item) { return item.integration === 'xcode'; }); if (row) { row.projectEnabled = false; row.status = 'idle'; } }
    if (msg.action === 'import') { row = { id: 'fixture-import', name: 'fixture-import', label: 'Example local tool', source: 'local', transport: 'stdio', status: 'unavailable', projectEnabled: false, extensionEnabled: true, tools: [], toolCount: 0, references: ['API_TOKEN'], provenance: { vendor: 'kiro', scope: 'user', file: '/home/fixture/.kiro/settings/mcp.json' } }; servers.push(row); }
    if (msg.action === 'add_local') { row = { id: 'fixture-local', name: 'fixture-local', label: msg.label, source: 'local', transport: 'stdio', status: 'idle', projectEnabled: false, extensionEnabled: true, tools: [], toolCount: 0 }; servers.push(row); }
    if (msg.action === 'credentials') { row.references = []; }
    if (msg.action === 'add') { row = { id: 'preview-connection', name: 'preview-connection', label: 'Example service', source: 'url', url: msg.url, status: 'auth_required', projectEnabled: false, extensionEnabled: true, toolCount: 0, tools: [], error: 'Sign in or provide an access token to connect.' }; servers.push(row); }
    if (msg.action === 'enable') row.projectEnabled = msg.enabled;
    if (msg.action === 'rename') row.label = msg.label;
    if (msg.action === 'remove') servers = servers.filter(function (item) { return item !== row; });
    if (msg.action === 'test' || msg.action === 'token') { row.status = 'ready'; row.error = ''; row.tools = [{name:'search_documents',description:'Search documents you can access.',inputSchema:{type:'object',properties:{query:{type:'string'}}}}];row.toolCount=1; }
    state(); handleMcpConnectionMessage({type:'mcp_action_result',requestId:msg.requestId,ok:true,id:row ? row.id : null,action:msg.action});
  }, 400);
} });
initMcp(); initExtensionSettings(); state();
`;
var html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0}#main-panels{display:flex;height:100vh}#app{flex:1;padding:32px}#main-panels:has(.panel-fullscreen:not(.hidden))>#app{display:none}.preview-label{opacity:.6;max-width:34em;margin-top:20px;line-height:1.7}</style></head><body><div id="main-panels"><main id="app"><button id="mcp-btn">MCP / Skills</button><p class="preview-label">MCP connection screen preview. Sample data only; no real connections are made.</p></main></div>' + sections + '<script>window.addEventListener("error", function(event){var p=document.createElement("pre");p.textContent=event.message;document.body.appendChild(p);});</script><script src="https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js"></script><script type="module">' + script + '</script></body></html>';
var server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (['/', '/mcp-tabs', '/xcode-failure', '/xcode-unsupported', '/xcode-light'].includes(url.pathname)) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(url.pathname === '/xcode-light' ? html.replace('<html>', '<html class="light-theme">') : html); return; }
  var file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (error, data) { if (error) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(data); });
});
server.listen(0, '127.0.0.1', function () { console.log('Preview: http://127.0.0.1:' + server.address().port); });
