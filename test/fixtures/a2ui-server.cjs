// Isolated fixture using the production chat enhancer and official renderer.
var http = require('http');
var fs = require('fs');
var path = require('path');
var serverSource = fs.readFileSync(path.resolve(__dirname, '../../lib/server.js'), 'utf8');
var policy = serverSource.match(/"Content-Security-Policy": "([^"]+)"/)[1];
var root = path.resolve(__dirname, '../../lib/public');
var skill = fs.readFileSync(path.resolve(__dirname, '../../lib/bundled-skills/clay-a2ui/SKILL.md'), 'utf8');
var sample = JSON.parse(skill.match(/```clay-a2ui\n([\s\S]*?)\n```/)[1]);
var budget = require('./a2ui-budget.cjs');
var html = '<!doctype html><html class="light-theme"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/a2ui.css"><style>body{font:15px/1.6 system-ui;margin:24px auto;padding:0 16px;max-width:760px;background:#f2f2ef;color:#262626}pre{white-space:pre-wrap}button{font:inherit;margin-right:8px}body.dark{background:#171717;color:#eee}</style></head><body><h1>Interactive answer</h1><p>Production renderer fixture · supplied examples, no live model</p><button id="replay">Reopen history</button><button id="budget">Explore budget</button><button id="theme">Change theme</button><main id="messages"></main><script type="module" src="/fixture.js"></script></body></html>';
var js = "import {createStore,store} from '/modules/store.js'; import {renderA2uiBlocks} from '/modules/a2ui-chat.js';\n" +
  "window.budget=" + JSON.stringify(budget) + "; createStore({replayingHistory:false}); window.sample=" + JSON.stringify(sample) + "; window.render=function(doc,kind){var main=document.getElementById('messages'); main.replaceChildren(); var row=document.createElement('div'); row.className=kind||'msg-assistant'; var pre=document.createElement('pre');var code=document.createElement('code');code.className='language-clay-a2ui';code.textContent=JSON.stringify(doc);pre.appendChild(code);row.appendChild(pre);main.appendChild(row);renderA2uiBlocks(main);}; window.render(window.sample);document.getElementById('budget').onclick=function(){window.render(window.budget);};document.getElementById('replay').onclick=function(){window.render(window.sample);}; document.getElementById('theme').onclick=function(){document.documentElement.classList.toggle('light-theme');document.body.classList.toggle('dark');}; window.replayTest=function(){store.set({replayingHistory:true});window.render(window.sample);store.set({replayingHistory:false});renderA2uiBlocks(document.getElementById('messages'));};";
function start(port) {
  var requests = [];
  var server = http.createServer(function (req, res) {
    requests.push(req.url);
    res.setHeader('Content-Security-Policy', policy + " frame-src 'self';");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    var pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    if (pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
    var file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  return new Promise(function (resolve) { server.listen(port || 0, '127.0.0.1', function () { resolve({server:server,requests:requests,url:'http://127.0.0.1:'+server.address().port}); }); });
}
if (require.main === module) start(Number(process.argv[2]) || 4784).then(function (fixture) { console.log(fixture.url); });
module.exports = { start:start, sample:sample };
