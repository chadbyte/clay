// Real browser UI, authenticated-session coordinator, WebSocket and isolated browser worker.
// Only the outer Clay shell and the website under test are fixtures. No accounts are used.
var http = require('http');
var fs = require('fs');
var path = require('path');
var WebSocketServer = require('ws').WebSocketServer;
var attach = require('../../lib/project-shared-browser').attachSharedBrowser;
var cookieRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'clay-mate-browser-ui-'));
var root = path.resolve(__dirname, '../../lib/public');
var clients = new Set();
var session = { localId: 1, ownerId: 'owner' };
var sent = [];
var storageStore = require('../../lib/shared-browser-storage').attachStorageStore(cookieRoot);
storageStore.exchange('owner', require('../../lib/shared-browser-storage').empty(), {
  cookies: [{ name: 'demo_session', value: 'fixture-only', domain: 'example.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }],
  origins: [{ origin: 'https://example.test', localStorage: [{ name: 'theme', value: 'dark' }], indexedDB: [] }],
});
storageStore.visit('owner', 'https://example.test/account');
storageStore.visit('owner', 'https://example.test/help');
var controller = attach({ slug: 'fixture', isMate: true, ownerId: 'owner', storageStore: storageStore, sm: { sessions: new Map([[1, session]]) }, clients: clients,
  usersModule: { isMultiUser: function () { return true; }, findUserById: function () { return { id: 'owner' }; } },
  requestAccess: { canAccessProject: function () { return true; }, hasPermission: function () { return true; } },
  getIdentity: function () { return null; }, getSessionForWs: function () { return session; },
  sendTo: function (ws, msg) { if (msg.type !== 'shared_browser_frame') sent.push(msg); if (ws.readyState === 1) ws.send(JSON.stringify(msg)); },
});
var html = '<!doctype html><html><head><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/command-palette.css"><link rel="stylesheet" href="/css/shared-browser.css"><link rel="stylesheet" href="/css/home-sidebar.css"><link rel="stylesheet" href="/css/right-workbench.css"><style>body{margin:0}#main-panels{display:flex;height:100vh}#app{flex:1;min-width:0;display:flex;flex-direction:column;padding:24px}#conversation{flex:1;padding:24px}#input-area{border:1px solid var(--border);border-radius:12px;padding:8px}#input-area>textarea{width:100%;height:80px;background:transparent;color:var(--text);border:0;padding:12px}#main-panels:has(.panel-fullscreen:not(.hidden))>#app{display:none}</style></head><body><div id="main-panels"><main id="app"><header>Mate browser cookie check</header><button onclick="document.documentElement.classList.toggle(&quot;light-theme&quot;)">Toggle theme</button><button id="shared-browser-btn">Browser</button><section id="conversation"><h2>Browse together</h2><p>Open the settings page and check the form.</p><p>The same page is visible to you and your Driver.</p></section><div id="input-area"><textarea aria-label="Message Driver" placeholder="Message Driver…"></textarea></div></main></div><script src="/lucide.js"></script><script src="https://cdn.jsdelivr.net/npm/marked@14/marked.min.js"></script><script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script><script type="module">' +
  'import {renderMarkdown,enhanceClaySessionLinks} from "/modules/markdown.js";import {createStore,store} from "/modules/store.js";import {setWs} from "/modules/ws-ref.js";import {initSharedBrowser,handleSharedBrowserMessage} from "/modules/shared-browser.js";import {claimRightWorkbench} from "/modules/right-workbench.js";' +
  'createStore({currentSlug:"fixture",activeSessionId:1,connected:false,permissions:{terminal:true},sharedBrowserUi:{}});window.store=store;window.claim=claimRightWorkbench;var chat=document.getElementById("conversation");chat.innerHTML=renderMarkdown("Open the preview here: [Account preview](browser:"+location.origin+"/target). Ordinary links still work: [Website](https://example.com).\\n\\n`[Code sample](browser:https://example.com)`");enhanceClaySessionLinks(chat);' +
  'window.connect=function(){var ws=new WebSocket("ws://"+location.host);window.socket=ws;setWs(ws);ws.onopen=function(){store.set({connected:true});};ws.onclose=function(){store.set({connected:false});};ws.onmessage=function(e){handleSharedBrowserMessage(JSON.parse(e.data));};};initSharedBrowser();window.connect();</script></body></html>';
var target = '<!doctype html><html><head><link rel="stylesheet" href="/css/right-workbench.css"><style>body{margin:0;background:#faf9f6;color:#252520;font:16px system-ui}main{padding:80px 100px}h1{font-size:32px}input{display:block;width:300px;padding:12px;font:inherit;margin:8px 0 20px}button{padding:12px 24px;background:#252520;color:white;border:0;border-radius:6px}output{display:block;margin-top:20px}</style></head><body><main><h1>Account settings</h1><label for="name">Display name</label><input id="name"><button id="save" onclick="document.querySelector(\'output\').textContent=\'Saved \'+document.querySelector(\'input\').value">Save changes</button><output></output><div id="pos" style="position:fixed;top:0;right:0">scrollY 0</div><div style="height:3000px"></div><script>addEventListener("scroll",function(){document.getElementById("pos").textContent="scrollY "+Math.round(scrollY)})</script></main></body></html>';
var lucide = '';
var server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  if (url.pathname === '/target') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(target); return; }
  if (url.pathname === '/lucide.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(lucide); return; }
  var file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, data) { if (err) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(data); });
});
var wss = new WebSocketServer({ server: server });
wss.on('connection', function (ws) {
  ws._clayUser = { id: 'owner' }; clients.add(ws);
  ws.on('close', function () { clients.delete(ws); });
  ws.on('message', function (data) { controller.handleMessage(ws, JSON.parse(data)); });
});
async function start() {
  lucide = await (await fetch('https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js')).text();
  server.listen(0, '127.0.0.1', function () { console.log('http://127.0.0.1:' + server.address().port); });
}
function stop() {
  controller.destroy();
  wss.clients.forEach(function (ws) { ws.terminate(); });
  wss.close(); server.close();
  setTimeout(function () { fs.rmSync(cookieRoot, { recursive: true, force: true }); process.exit(0); }, 1000);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
start().catch(function (error) { console.error(error); stop(); });
