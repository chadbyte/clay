// Isolated production card preview: choices only update sample data, never integrations.
var http = require('http');
var fs = require('fs');
var path = require('path');
var root = path.resolve(__dirname, '../../lib/public');
var script = `
import { createStore } from '/modules/store.js';
import { createHomeDebateQuestionCard, markHomeDebateQuestionSubmitting } from '/modules/home-debate-planning.js';
createStore({});
var message = { role: 'question', flow: 'mcp_import', toolId: 'sample-import', status: 'pending', questions: [{ header: 'Import MCP', allowOther: false, question: 'Import "Issue reader" from Copilot (user)?\\nSource: /home/fixture/.copilot/mcp-config.json\\nTransport: stdio\\nDependency: node\\nDestination: owner fixture — private MCP catalog shared across your Clay sessions, project sessions and Mates; other accounts cannot use it.\\nTool allowlist: ["read_issue"]\\nExcluded tools: ["delete_issue"]\\nRequired credential names: API_TOKEN\\nThe imported copy will be DISABLED. This approval only saves that exact copy. Enable, Test and Sign in require separate actions. Original vendor files stay unchanged. Enter credentials only in MCP management, never in chat.', options: [{label:'Keep unchanged'}, {label:'Import disabled copy'}] }] };
var host = document.getElementById('review');
function render() { host.replaceChildren(createHomeDebateQuestionCard(message, respond)); }
function respond(item, action, button, answers) {
  markHomeDebateQuestionSubmitting(item, button);
  setTimeout(function () { item.status = 'answered'; item.answers = answers; render(); document.getElementById('result').textContent = answers[0] === 'Import disabled copy' ? 'Fixture copy saved disabled. No real integration was imported.' : 'Kept unchanged. No import authorized.'; }, 250);
}
render();
`;
var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:var(--bg)}main{max-width:660px;margin:24px auto;padding:16px}h1{font-size:18px}#result{font-size:13px}</style></head><body><main><h1>Agent import review fixture</h1><p>Sample data only. Production consent card.</p><div id="review"></div><p id="result" role="status"></p></main><script type="module">' + script + '</script></body></html>';
var server = http.createServer(function (req, res) {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  var target = path.resolve(root, '.' + req.url.split('?')[0]);
  if (target.indexOf(root + path.sep) !== 0) { res.writeHead(404); res.end(); return; }
  fs.readFile(target, function (error, data) { if (error) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', target.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(data); });
});
server.listen(0, '127.0.0.1', function () { console.log('Consent fixture: http://127.0.0.1:' + server.address().port + ' PID ' + process.pid); });
