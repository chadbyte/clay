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
var servers = [];
createStore({ currentSlug: 'preview', myUserId: 'owner', activeSessionId: 1, connected: true, permissions: { skills: true }, mcpSkillsWorkbench: {} });
function state() { handleMcpServersState({ slug: 'preview', servers: servers, hostConnected: false, extensionConnected: false }); }
setWs({ readyState: 1, send: function (payload) {
  var msg = JSON.parse(payload);
  if (msg.type === 'mcp_state_request') { setTimeout(state, 30); return; }
  if (msg.type !== 'mcp_connection_action') return;
  setTimeout(function () {
    var row = servers.find(function (item) { return item.id === msg.id; });
    if (msg.action === 'add') { row = { id: 'preview-connection', name: 'preview-connection', label: 'Example service', source: 'url', url: msg.url, status: 'auth_required', projectEnabled: false, extensionEnabled: true, toolCount: 0, tools: [], error: 'Sign in or provide an access token to connect.' }; servers.push(row); }
    if (msg.action === 'enable') row.projectEnabled = msg.enabled;
    if (msg.action === 'rename') row.label = msg.label;
    if (msg.action === 'remove') servers = servers.filter(function (item) { return item !== row; });
    if (msg.action === 'test' || msg.action === 'token') { row.status = 'ready'; row.error = ''; row.tools = [{name:'search_documents',description:'Search documents you can access.',inputSchema:{type:'object',properties:{query:{type:'string'}}}}];row.toolCount=1; }
    state(); handleMcpConnectionMessage({type:'mcp_action_result',requestId:msg.requestId,ok:true,id:row.id,action:msg.action});
  }, 400);
} });
initMcp(); initExtensionSettings(); state();
`;
var html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0}#main-panels{display:flex;height:100vh}#app{flex:1;padding:32px}#main-panels:has(.panel-fullscreen:not(.hidden))>#app{display:none}.preview-label{opacity:.6;max-width:34em;margin-top:20px;line-height:1.7}</style></head><body><div id="main-panels"><main id="app"><button id="mcp-btn">MCP / Skills</button><p class="preview-label">MCP connection screen preview. Sample data only; no real connections are made.</p></main></div>' + sections + '<script>window.addEventListener("error", function(event){var p=document.createElement("pre");p.textContent=event.message;document.body.appendChild(p);});</script><script src="https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js"></script><script type="module">' + script + '</script></body></html>';
var server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  var file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (error, data) { if (error) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(data); });
});
server.listen(0, '127.0.0.1', function () { console.log('Preview: http://127.0.0.1:' + server.address().port); });
