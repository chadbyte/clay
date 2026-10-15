// A synthetic owner and temporary project exercise the production question card,
// WebSocket response handler and MCP action. No live model or real data is used.
var http = require('node:http'), fs = require('node:fs'), path = require('node:path');
var WebSocketServer = require('ws').WebSocketServer;
function start(ctx) {
  var publicRoot = path.resolve(__dirname, '../../lib/public');
  var script = `
import { createStore } from '/modules/store.js';
import { createHomeDebateQuestionCard, markHomeDebateQuestionSubmitting } from '/modules/home-debate-planning.js';
createStore({});
var socket = new WebSocket(location.origin.replace('http', 'ws'));
var question = null, host = document.getElementById('review');
function render() { if (question) host.replaceChildren(createHomeDebateQuestionCard(question, respond)); }
function respond(item, action, button, answers) { markHomeDebateQuestionSubmitting(item, button); socket.send(JSON.stringify({type:'answer',toolId:item.toolId,answers:answers})); }
socket.onmessage = function (event) {
  var data = JSON.parse(event.data);
  if (data.type === 'ready') document.getElementById('request').disabled = false;
  if (data.type === 'tool_executing' && data.source === 'product-control') { question = {role:'question',flow:'mate_question',toolId:data.id,status:'pending',questions:data.input.questions}; render(); }
  if (data.type === 'ask_user_answered') { question.status = 'answered'; question.answers = data.answers; render(); }
  if (data.type === 'expired') { question.status = 'expired'; question.error = 'This exact review is stale or already answered. Inspect and request again.'; render(); document.getElementById('request').disabled = false; }
  if (data.type === 'state') document.getElementById('result').textContent = data.title;
  if (data.type === 'result') { document.getElementById('result').textContent = data.result.status + ': ' + data.title; document.getElementById('request').disabled = false; }
};
if (document.getElementById('stale')) document.getElementById('stale').onclick = function () { socket.send(JSON.stringify({type:'stale'})); };
if (document.getElementById('late')) document.getElementById('late').onclick = function () { if (question) socket.send(JSON.stringify({type:'answer',toolId:question.toolId,answers:{0:'Apply exact change'}})); };
document.getElementById('request').onclick = function () { this.disabled = true; socket.send(JSON.stringify({type:'request'})); };
`;
  var extra = ctx.changeQueue ? '<button id="stale">' + (ctx.staleLabel || 'Change queue before answering') + '</button><button id="late">Replay previous answer</button>' : '';
  var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:var(--bg)}main{max-width:660px;margin:24px auto;padding:16px}h1{font-size:18px}#result{font-size:13px}</style></head><body><main><h1>Canonical Clay control review</h1><p>Isolated fixture. Uses production project services and the existing review card.</p><button id="request" disabled>' + (ctx.requestLabel || (ctx.changeQueue ? 'Request queued message' : 'Request sample rename')) + '</button>' + extra + '<div id="review"></div><p id="result" role="status">Original sample name</p></main><script type="module">' + script + '</script></body></html>';
  var server = http.createServer(function (req, res) {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    var target = path.resolve(publicRoot, '.' + req.url.split('?')[0]);
    if (target.indexOf(publicRoot + path.sep) !== 0) { res.writeHead(404); res.end(); return; }
    fs.readFile(target, function (error, data) { if (error) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', target.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(data); });
  });
  var wss = new WebSocketServer({ server: server });
  wss.on('connection', function (ws) {
    ws._clayUser = ctx.owner; ws._clayActiveSession = ctx.session.localId; ctx.source.clients.add(ws);
    ws.send(JSON.stringify({ type: 'ready' }));
    if (ctx.state) ws.send(JSON.stringify({ type: 'state', title: ctx.state() }));
    ws.on('message', async function (buffer) {
      try {
        var msg = JSON.parse(String(buffer));
        if (msg.type === 'answer') {
          var accepted = ctx.source.handleHomeAskUserResponse({ toolId: msg.toolId, answers: msg.answers }, ctx.session, ws);
          if (!accepted) ws.send(JSON.stringify({ type: 'expired' }));
        }
        if (msg.type === 'stale' && ctx.changeQueue) { ctx.changeQueue(); ws.send(JSON.stringify({ type: 'state', title: ctx.state() })); }
        if (msg.type === 'request') {
          var result = await ctx.request();
          ws.send(JSON.stringify({ type: 'result', result: result, title: ctx.state ? ctx.state() : ctx.target.title }));
        }
      } catch (error) { ws.send(JSON.stringify({ type: 'result', result: { status: 'failed' }, title: error.message })); }
    });
    ws.on('close', function () { ctx.source.clients.delete(ws); });
  });
  server.listen(0, '127.0.0.1', function () { console.log('Control fixture: http://127.0.0.1:' + server.address().port + ' PID ' + process.pid); });
}
module.exports = { start: start };
