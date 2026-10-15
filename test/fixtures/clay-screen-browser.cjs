var http = require('node:http'), fs = require('node:fs'), path = require('node:path');
var WebSocketServer = require('ws').WebSocketServer;
function start(ctx) {
  var root = path.resolve(__dirname, '../../lib/public'), sequence = 0;
  var next = ctx.source.sm.createSession({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' }); next.title = 'Navigation destination';
  var html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head>
<body><script src="https://cdn.jsdelivr.net/npm/marked@14/marked.min.js"></script><script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script><script src="https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js"></script><main style="max-width:660px;margin:24px auto"><h1>Owner navigation fixture</h1><p>Production review, navigator, project and WebSocket handlers with isolated storage.</p>
<button id="request" disabled>Request exact navigation</button><button id="change">Change context before apply</button><div id="review"></div><p id="result" role="status">Starting</p><p id="active">Original conversation</p></main>
<script>window.addEventListener("error",function(event){document.getElementById("result").textContent=event.message;});window.addEventListener("unhandledrejection",function(event){document.getElementById("result").textContent=String(event.reason);});</script><script type="module">
import { createStore, store } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';
import { initCommandPalette } from '/modules/command-palette.js';
import { handleOwnerNavigation } from '/modules/clay-owner-navigation.js';
import { createHomeDebateQuestionCard, markHomeDebateQuestionSubmitting } from '/modules/home-debate-planning.js';
createStore({ currentSlug:'clay-source', activeSessionId:${ctx.sourceSession.localId} });
var socket = new WebSocket(location.origin.replace('http','ws')); setWs(socket);
initCommandPalette({ currentSlug:function(){ return 'clay-source'; }, selectSession:function(id){ socket.send(JSON.stringify({type:'switch_session',id:id})); }, switchProject:function(){ throw new Error('This fixture uses same-project navigation'); } });
var question, change = false;
function render(){ document.getElementById('review').replaceChildren(createHomeDebateQuestionCard(question,respond)); }
function respond(item,action,button,answers){ markHomeDebateQuestionSubmitting(item,button); socket.send(JSON.stringify({type:'answer',toolId:item.toolId,answers:answers})); }
socket.onopen = function(){ socket.send(JSON.stringify({type:'clay_ui_ready',version:1})); };
socket.onmessage = function(event){
 var msg = JSON.parse(event.data);
 if (msg.type === 'clay_navigation_apply' && change) { store.set({activeSessionId:999}); change=false; }
 if (handleOwnerNavigation(msg)) return;
 if(msg.type==='ready') document.getElementById('request').disabled=false;
 if(msg.type==='tool_executing' && msg.source==='product-control'){ question={role:'question',flow:'mate_question',toolId:msg.id,status:'pending',questions:msg.input.questions};render(); }
 if(msg.type==='ask_user_answered'){ question.status='answered';question.answers=msg.answers;render(); }
 if(msg.type==='session_switched'){ store.set({activeSessionId:msg.id});document.getElementById('active').textContent='Active conversation: '+msg.id; }
 if(msg.type==='result') document.getElementById('result').textContent=JSON.stringify(msg.result);
 if(msg.type==='ack') document.getElementById('result').textContent=JSON.stringify(msg.result);
};
document.getElementById('request').onclick=function(){socket.send(JSON.stringify({type:'request'}));};
document.getElementById('change').onclick=function(){change=true;document.getElementById('result').textContent='Next navigation will detect changed context';};
</script></body></html>`;
  var server = http.createServer(function (req, res) {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    var file = path.resolve(root, '.' + req.url.split('?')[0]);
    if (file.indexOf(root + path.sep) !== 0) { res.writeHead(404); res.end(); return; }
    fs.readFile(file, function (error, bytes) { if (error) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(bytes); });
  });
  var wss = new WebSocketServer({ server: server });
  wss.on('connection', function (ws) {
    ws._clayUser = ctx.users.findUserById('owner'); ws._clayActiveSession = ctx.sourceSession.localId; ctx.source.clients.add(ws);
    ws.send(JSON.stringify({ type: 'ready' }));
    ws.on('close', function () { ctx.source.clients.delete(ws); });
    ws.on('message', async function (buffer) {
      var msg = JSON.parse(String(buffer));
      try {
        if (['clay_ui_ready', 'clay_navigation_claim', 'clay_navigation_ack'].indexOf(msg.type) >= 0) {
          ctx.source.handleMessage(ws, msg);
          if (msg.type === 'clay_navigation_ack') ws.send(JSON.stringify({ type: 'ack', result: await ctx.call('read_owner_screen', { action: 'delivery', deliveryId: msg.deliveryId }) }));
          return;
        }
        if (msg.type === 'answer') { ctx.source.handleHomeAskUserResponse({ toolId: msg.toolId, answers: msg.answers }, ctx.sourceSession, ws); return; }
        if (msg.type === 'switch_session') { ctx.source.handleMessage(ws, msg); return; }
        if (msg.type === 'request') {
          var selected = (await ctx.call('read_owner_screen', { action: 'screen_context' })).viewers.find(function (item) { return ctx.ownerUi.inspect('owner', item.viewerRef).ws === ws; });
          var inspected = await ctx.call('inspect_owner_screen_change', { operation: { action: 'navigate', viewerRef: selected.viewerRef, projectSlug: 'clay-source', sessionRef: require('../../lib/workspace-query-service').sessionRef('clay-source', next) } });
          var result = await ctx.call('control_owner_screen', { targetToken: inspected.targetToken, requestId: 'browser-' + (++sequence), why: 'Open the exact isolated destination conversation' });
          ws.send(JSON.stringify({ type: 'result', result: result }));
        }
      } catch (error) { ws.send(JSON.stringify({ type: 'result', result: { status: 'failed', error: error.message } })); }
    });
  });
  server.listen(Number(process.env.CLAY_SCREEN_FIXTURE_PORT || 0), '127.0.0.1', function () { console.log('Screen fixture: http://127.0.0.1:' + server.address().port + ' PID ' + process.pid); });
}
module.exports = { start: start };
