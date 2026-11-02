// Isolated production auth transport with synthetic providers, PTYs and pages.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-worker-login-ui-'));
process.env.HOME = temporary; process.env.CLAY_HOME = path.join(temporary, '.clay'); process.env.CODEX_HOME = path.join(temporary, '.codex');
require('../helpers/yoke-no-provider-processes.cjs');
var root = path.resolve(__dirname, '../..'), http = require('node:http');
var clients = new Set(), terminals = new Map(), nextId = 1, assets = {}, auth, login;
var users = require('../../lib/users');
users.isMultiUser = function () { return true; };
var owner = { id: 'fixture-owner', role: 'admin' };
users.findUserById = function (id) { return id === owner.id ? owner : null; };
function sendTo(ws, message) { if (ws.readyState === 1) ws.send(JSON.stringify(message)); }
var sm = require('../../lib/sessions').createSessionManager({ cwd: temporary, send: function () {},
  sendEach: function (fn) { clients.forEach(function (ws) { fn(ws); }); }, onAuthRequired: function (session, msg) { return auth.emit(session, msg); } });
var driver = sm.createSessionRaw({ vendor: 'claude', ownerId: owner.id });
var worker = sm.createSessionRaw({ vendor: 'codex', ownerId: owner.id });
require('../../lib/session-provenance').markWorker(driver, worker, sm.sessions);
worker._pairGeneration = worker.sessionProvenance.generation; worker._queryGeneration = 1;
var group = { id: 'fixture-pair', members: [driver.localId, worker.localId], pair: { driverId: driver.localId, workerId: worker.localId } };
var access = { canAccessProject: function () { return true; }, hasPermission: function () { return true; } };
var reader = require('../../lib/project-worker-conversation').attachProjectWorkerConversation({ sm: sm, clients: clients, slug: 'fixture', usersModule: users,
  getWorkerGroup: function () { return group; }, canAccessProject: access.canAccessProject,
  canAccessSession: function (ws, session) { return ws._clayUser.id === session.ownerId; }, sendTo: sendTo });
auth = require('../../lib/project-worker-auth').attach({ sm: sm, clients: clients, slug: 'fixture', currentPair: reader.currentPair, requestAccess: access, sendTo: sendTo });
var processor = require('../../lib/sdk-message-processor').attachMessageProcessor({ sm: sm, opts: {}, onProcessingChanged: function () {}, onTurnDone: function () {} });
var tm = { create: function (cols, rows, identity, ws, options) { var term = { id: nextId++, options: options }; terminals.set(term.id, term); return term; },
  has: function (id) { return terminals.has(id); }, list: function () { return []; }, close: function (id) { terminals.delete(id); },
  attach: function (id, ws) { if (terminals.has(id)) sendTo(ws, { type: 'term_output', id: id, data: 'Synthetic provider sign-in. No account is used.\r\n' }); } };
login = require('../../lib/project-vendor-login').attachVendorLogin({ sm: sm, clients: clients, slug: 'fixture', usersModule: users, tm: tm, workerAuth: auth,
  requestAccess: access, sendTo: sendTo, send: function () {}, refreshVendorAuthEverywhere: function () { return Promise.resolve(true); },
  createLoginBrowser: function () { return { id: 'synthetic-browser-' + nextId, env: {}, output: function () {}, close: function () {},
    input: function () {}, attach: function (ws) { sendTo(ws, { type: 'vendor_login_browser_status', browserId: 'synthetic-browser-' + (nextId - 1), phase: 'ready', text: 'Synthetic sign-in page. No account is used.' }); } }; } });
var stubTheme = 'export function getTerminalTheme(){return {background:"#171717",foreground:"#f2f2ef"};}';
var stubPane = 'export function forwardPaneAuthRequired(){return false;}';
var entry = 'export {createStore,store} from "./modules/store.js";export {setWs} from "./modules/ws-ref.js";export * from "./modules/vendor-login.js";export {handleLoginBrowserMessage} from "./modules/vendor-login-browser.js";';
var script = `import * as api from "ENTRY";
api.createStore({currentSlug:'fixture',activeSessionId:${driver.localId},connected:true,vendorInfo:${JSON.stringify(require('../../lib/yoke/vendor-registry').publicInfo())}});
window.store=api.store;window.events=[];
var ws=new WebSocket('ws://'+location.host+'/p/fixture/ws');api.setWs(ws);
ws.onmessage=function(event){var msg=JSON.parse(event.data);window.events.push(msg);if(msg.type==='worker_auth_required')api.handleWorkerAuthRequired(msg);
if(msg.type==='vendor_login_ready')api.handleVendorLoginReady(msg);if(msg.type==='vendor_login_state')api.handleVendorLoginState(msg);
if(msg.type==='vendor_login_error')api.handleVendorLoginError(msg);if(msg.type==='auth_refreshed')api.handleAuthRefreshed(msg);
if(msg.type==='vendor_login_browser_status'){api.handleLoginBrowserMessage(msg);var canvas=document.createElement('canvas');var viewport=document.querySelector('.login-browser-viewport');canvas.width=Math.max(320,Math.min(1000,Math.round(viewport.clientWidth)));canvas.height=Math.max(360,Math.min(720,Math.round(viewport.clientHeight)));var c=canvas.getContext('2d');c.fillStyle='#f2f2ef';c.fillRect(0,0,800,600);c.fillStyle='#171717';c.font='26px system-ui';c.fillText('Synthetic provider sign-in',50,120);c.font='18px system-ui';c.fillText('No real account or credentials are used.',50,170);api.handleLoginBrowserMessage({type:'vendor_login_browser_frame',browserId:msg.browserId,origin:'https://fixture.example',data:canvas.toDataURL('image/jpeg').split(',')[1]});}};
document.querySelectorAll('[data-action]').forEach(function(button){button.onclick=function(){ws.send(JSON.stringify({type:'fixture_action',action:button.dataset.action}));};});
`;
var server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://localhost'), route = url.pathname;
  if (route === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/vendor-login-browser.css"><link rel="stylesheet" href="/css/tui-attention.css"><link rel="stylesheet" href="/fixture/xterm.css"><style>body{background:#f2f2ef;color:#171717;font:14px system-ui;padding:16px}button{margin:4px;padding:8px}.notif-banner-container{position:fixed;bottom:16px;right:16px;max-width:350px}.notif-banner{background:white;border:1px solid #ccc;padding:10px}</style></head><body><h1>Worker authentication fixture</h1><p>Claude Driver selected · Codex Worker conversation closed</p><button data-action="auth">Trigger Worker authentication</button><button data-action="later">Later delegated task</button><button data-action="stop">Stop Worker</button><button data-action="success">Synthetic success</button><div class="notif-banner-container"></div><script src="/fixture/lucide.js"></script><script src="/fixture/xterm.js"></script><script src="/fixture/fit.js"></script><script type="module">'+script.replace('ENTRY', url.searchParams.has('built') ? '/fixture/built.js' : '/fixture/source.js')+'</script></body></html>'); return;
  }
  if (route === '/fixture/source.js') { res.setHeader('Content-Type','text/javascript'); res.end(entry.replaceAll('./modules/', '/modules/')); return; }
  if (assets[route]) { res.setHeader('Content-Type',route.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(assets[route]); return; }
  if (route === '/modules/theme.js' || route === '/modules/pane-bridge.js') { res.setHeader('Content-Type','text/javascript');res.end(route.includes('theme') ? stubTheme : stubPane);return; }
  var file = path.resolve(root,'lib/public','.'+route);
  if (!file.startsWith(path.join(root,'lib/public')+path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file,function(error,data){if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',route.endsWith('.js')?'text/javascript':route.endsWith('.css')?'text/css':'application/octet-stream');res.end(data);});
});
new (require('ws').WebSocketServer)({server:server}).on('connection',function(ws){
  ws._clayUser=owner;ws._clayActiveSession=driver.localId;clients.add(ws);ws.on('close',function(){clients.delete(ws);});
  ws.on('message',function(raw){var msg=JSON.parse(raw);if(msg.type==='fixture_action'){
    if(msg.action==='auth'||msg.action==='later'){if(msg.action==='later'){worker._queryGeneration++;worker.taskStopRequested=false;}processor.processSDKMessage(worker,{yokeType:'auth_required'});}
    if(msg.action==='stop'){worker.taskStopRequested=true;worker._forceStopRevision=(worker._forceStopRevision||0)+1;}
    if(msg.action==='success')terminals.forEach(function(term){term.options.onData('Successfully logged in.');term.options.onExit();});
    return;
  }if(login.handleVendorLoginMessage(ws,msg))return;if(msg.type==='term_attach')tm.attach(msg.id,ws);});
});
(async function(){
  var resources={'lucide.js':'lucide@0.468.0/dist/umd/lucide.min.js','xterm.js':'@xterm/xterm@5/lib/xterm.min.js','xterm.css':'@xterm/xterm@5/css/xterm.min.css','fit.js':'@xterm/addon-fit@0/lib/addon-fit.min.js'};
  await Promise.all(Object.keys(resources).map(async function(name){var response=await fetch('https://cdn.jsdelivr.net/npm/'+resources[name]);if(!response.ok)throw new Error('Fixture library unavailable');assets['/fixture/'+name]=await response.text();}));
  var built=await require('esbuild').build({stdin:{contents:entry,resolveDir:path.join(root,'lib/public'),sourcefile:'fixture.js'},bundle:true,format:'esm',write:false,plugins:[{name:'fixture-transport',setup:function(build){build.onLoad({filter:/\/modules\/(theme|pane-bridge)\.js$/},function(args){return {contents:args.path.endsWith('/theme.js')?stubTheme:stubPane,loader:'js'};});}}]});
  assets['/fixture/built.js']=built.outputFiles[0].text;
  server.listen(0,'127.0.0.1',function(){console.log('Worker auth fixture: http://127.0.0.1:'+server.address().port);});
})().catch(function(error){console.error(error);process.exitCode=1;});
process.on('SIGTERM',function(){login.destroy();server.close();fs.rmSync(temporary,{recursive:true,force:true});process.exit();});
