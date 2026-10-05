// Real browser UI, authenticated-session coordinator, WebSocket and isolated browser worker.
// Only the outer Clay shell and the website under test are fixtures. No accounts are used.
var http = require('http');
var fs = require('fs');
var path = require('path');
var assert = require('node:assert/strict');
var chromium = require('playwright').chromium;
var WebSocketServer = require('ws').WebSocketServer;
var attach = require('../../lib/project-shared-browser').attachSharedBrowser;
var root = path.resolve(__dirname, '../../lib/public');
var clients = new Set();
var session = { localId: 1, ownerId: 'owner' };
var sent = [];
var controller = attach({ slug: 'fixture', sm: { sessions: new Map([[1, session]]) }, clients: clients,
  usersModule: { isMultiUser: function () { return true; }, findUserById: function () { return { id: 'owner' }; } },
  requestAccess: { canAccessProject: function () { return true; }, hasPermission: function () { return true; } },
  getIdentity: function () { return null; }, getSessionForWs: function () { return session; },
  sendTo: function (ws, msg) { if (msg.type !== 'shared_browser_frame') sent.push(msg); if (ws.readyState === 1) ws.send(JSON.stringify(msg)); },
});
var html = '<!doctype html><html><head><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/shared-browser.css"><link rel="stylesheet" href="/css/home-sidebar.css"><style>body{margin:0}#main-panels{display:flex;height:100vh}#app{flex:1;min-width:0;display:flex;flex-direction:column;padding:24px}#conversation{flex:1;padding:24px}#input-area{border:1px solid var(--border);border-radius:12px;padding:8px}#input-area>textarea{width:100%;height:80px;background:transparent;color:var(--text);border:0;padding:12px}#main-panels:has(.panel-fullscreen:not(.hidden))>#app{display:none}</style></head><body><div id="main-panels"><main id="app"><header>Clay / Shared browser</header><section id="conversation"><h2>Browse together</h2><p>Open the settings page and check the form.</p><p>The same page is visible to you and your Driver.</p></section><div id="input-area"><textarea aria-label="Message Driver" placeholder="Message Driver…"></textarea></div></main></div><script src="/lucide.js"></script><script type="module">' +
  'import {createStore,store} from "/modules/store.js";import {setWs} from "/modules/ws-ref.js";import {initSharedBrowser,handleSharedBrowserMessage} from "/modules/shared-browser.js";import {claimRightWorkbench} from "/modules/right-workbench.js";' +
  'createStore({currentSlug:"fixture",activeSessionId:1,connected:false,permissions:{terminal:true},sharedBrowserUi:{}});window.store=store;window.claim=claimRightWorkbench;' +
  'window.connect=function(){var ws=new WebSocket("ws://"+location.host);window.socket=ws;setWs(ws);ws.onopen=function(){store.set({connected:true});};ws.onclose=function(){store.set({connected:false});};ws.onmessage=function(e){handleSharedBrowserMessage(JSON.parse(e.data));};};initSharedBrowser();window.connect();</script></body></html>';
var target = '<!doctype html><html><head><style>body{margin:0;background:#faf9f6;color:#252520;font:16px system-ui}main{padding:80px 100px}h1{font-size:32px}input{display:block;width:300px;padding:12px;font:inherit;margin:8px 0 20px}button{padding:12px 24px;background:#252520;color:white;border:0;border-radius:6px}output{display:block;margin-top:20px}</style></head><body><main><h1>Account settings</h1><label for="name">Display name</label><input id="name"><button id="save" onclick="document.querySelector(\'output\').textContent=\'Saved \'+document.querySelector(\'input\').value">Save changes</button><output></output></main></body></html>';
var lucide;
var server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  if (url.pathname === '/target') { res.setHeader('Content-Type', 'text/html'); res.end(target); return; }
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
async function main() {
  lucide = await (await fetch('https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js')).text();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  var base = 'http://127.0.0.1:' + server.address().port;
  var browser = await chromium.launch({ channel: 'chrome', headless: true });
  var page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  var tool = controller.getToolDefs(session)[0].handler;
  try {
    await page.goto(base);
    await page.getByRole('button', { name: 'Open browser', exact: true }).click();
    await page.waitForFunction(function () { var s=window.store.get('sharedBrowser');return s && s.phase === 'live'; });
    var id = await page.evaluate(function () { return window.store.get('sharedBrowser').id; });
    await page.getByLabel('Browser address').fill(base + '/target?token=do-not-display');
    await page.getByLabel('Browser address').press('Enter');
    await page.waitForFunction(function () { return window.store.get('sharedBrowser').url.endsWith('/target') && window.store.get('sharedBrowserUi').hasFrame; });
    assert.equal((await page.getByLabel('Browser address').inputValue()).includes('token'), true, 'typed address is retained while the user is editing');
    await page.getByRole('heading', { name: 'Browse together' }).click();
    var canvas = page.locator('#shared-browser-panel canvas');
    var box = await canvas.boundingBox();
    await page.waitForFunction(function(){var c=document.querySelector('#shared-browser-panel canvas');var b=c.getBoundingClientRect();return Math.abs(c.width/c.height-b.width/b.height)<0.005;});
    var dimensions = await canvas.evaluate(function(c){return {width:c.width,height:c.height};});
    var scale = Math.min(box.width/dimensions.width, box.height/dimensions.height);
    var x = box.x+(box.width-dimensions.width*scale)/2+180*scale;
    var y = box.y+(box.height-dimensions.height*scale)/2+210*scale;
    await page.mouse.click(x,y);
    await page.keyboard.type('Human');
    var inspected;
    for (var i=0;i<15;i++) { inspected=await tool({action:'inspect'}); if(JSON.stringify(inspected).includes('Human'))break; await new Promise(function(resolve){setTimeout(resolve,100);}); }
    assert.ok(JSON.stringify(inspected).includes('Human'), 'human input reaches the same browser the tool inspects');
    assert.equal(inspected.content[1].type,'image');
    assert.equal((await tool({action:'click',selector:'#save',intent:'I’ll save the display name now so we can check that the change sticks.'})).isError,true);
    var ownTab = JSON.parse((await tool({action:'open',url:base+'/target',intent:'I’ll open my own tab so you can keep using yours.'})).content[0].text);
    await page.waitForFunction(function(){return window.store.get('sharedBrowsers').length===2;});
    assert.equal(await page.evaluate(function(){return window.store.get('sharedBrowser').id;}),id,'agent tab does not steal the human selection');
    assert.equal((await tool({action:'text',browserId:ownTab.id,selector:'#name',text:'Independent'})).isError,undefined);
    await page.getByRole('tab').nth(1).click();
    await page.waitForFunction(function(tabId){return window.store.get('sharedBrowser').id===tabId && window.store.get('sharedBrowserUi').hasFrame;},ownTab.id);
    assert.equal(await page.getByRole('button',{name:'Take control',exact:true}).isVisible(),true);
    await page.locator('#shared-browser-panel').screenshot({path:'/tmp/clay-browser-tabs.png'});
    await page.getByRole('tab').nth(0).click();
    assert.ok(JSON.stringify(await tool({action:'inspect',browserId:id})).includes('Human'),'the original tab keeps its page state');
    await page.getByRole('button',{name:'Close browser tab 2',exact:true}).click();
    await page.waitForFunction(function(){return window.store.get('sharedBrowsers').length===1;});
    await page.getByRole('button',{name:'Give control',exact:true}).click();
    await page.waitForFunction(function(){return window.store.get('sharedBrowser').control==='agent';});
    assert.equal((await tool({action:'text',selector:'#name',text:'Driver'})).isError,undefined);
    assert.equal((await tool({action:'click',selector:'#save',intent:'I’ll save the display name now so we can check that the change sticks.'})).isError,undefined);
    await page.waitForFunction(function(){var b=window.store.get('sharedBrowser');return b.activity && b.activity.phase==='complete' && b.pointer;});
    assert.equal(await page.locator('.shared-browser-activity-text').last().textContent(),'I’ll save the display name now so we can check that the change sticks.');
    assert.equal(await page.locator('.shared-browser-pointer').isVisible(),true);
    await page.locator('#shared-browser-panel').screenshot({path:'/tmp/clay-browser-activity.png'});
    assert.ok(sent.some(function(m){return m.browser && m.browser.activity && m.browser.activity.phase==='running';}));
    assert.ok(JSON.stringify(await tool({action:'inspect',intent:'I’ll check the page again to make sure it shows the name we saved.'})).includes('Saved Driver'));
    for (var captionIndex = 0; captionIndex < 5; captionIndex++) {
      await tool({action:'inspect',intent:'I’ll take another look at the saved name so we can confirm it is still there. Check ' + (captionIndex + 1) + '.'});
    }
    await page.waitForFunction(function(){return document.querySelectorAll('.shared-browser-caption-row').length >= 8;});
    var history = page.getByRole('log',{name:'Browser caption history'});
    await history.evaluate(function(el){el.scrollTop=0;});
    await page.waitForFunction(function(){return window.store.get('sharedBrowserUi').captionPinned===false;});
    await tool({action:'inspect',intent:'I’ll check the form once more before handing the browser back to you.'});
    await page.waitForFunction(function(){return document.querySelectorAll('.shared-browser-caption-row').length >= 9;});
    assert.equal(await history.evaluate(function(el){return el.scrollTop;}),0,'new captions preserve the history reading position');
    await page.getByRole('button',{name:'Back to live ↓',exact:true}).click();
    assert.ok(await history.evaluate(function(el){return el.scrollHeight-el.clientHeight-el.scrollTop<2;}));
    await page.locator('#shared-browser-panel').screenshot({path:'/tmp/clay-browser-captions.png'});
    await page.getByRole('button',{name:'Widen browser panel',exact:true}).click();
    await page.waitForFunction(function(){var c=document.querySelector('#shared-browser-panel canvas');var b=c.getBoundingClientRect();return Math.abs(c.width/c.height-b.width/b.height)<0.005;});
    assert.equal((await tool({action:'resize',width:1280,height:800})).isError,undefined);
    await page.waitForFunction(function(){return window.store.get('sharedBrowser').width===1280;});
    await page.getByRole('button',{name:'Widen browser panel',exact:true}).click();
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(function(){return window.store.get('sharedBrowser').width;}),1280);
    await page.screenshot({path:'/tmp/clay-shared-browser-desktop.png'});
    await page.getByRole('button',{name:'Hide browser panel',exact:true}).click();
    await page.getByRole('button',{name:'View browser',exact:true}).click();
    assert.equal(await page.evaluate(function(){return window.store.get('sharedBrowser').id;}),id);
    await page.evaluate(function(){window.claim('files');});
    assert.equal(await page.locator('#shared-browser-panel').isVisible(),false);
    await page.getByRole('button',{name:'View browser',exact:true}).click();
    await page.getByRole('button',{name:'Take control',exact:true}).click();
    await page.waitForFunction(function(){return window.store.get('sharedBrowser').control==='user';});
    assert.equal((await tool({action:'navigate',url:base})).isError,true);
    assert.equal(await page.locator('.shared-browser-pointer').isVisible(),false);
    assert.equal(await page.locator('.shared-browser-activity').isVisible(),true);
    await page.evaluate(function(){window.socket.close();});
    await page.waitForFunction(function(){return !window.store.get('connected');});
    assert.equal(await page.getByLabel('Browser address').isDisabled(),true);
    await page.evaluate(function(){window.connect();});
    await page.waitForFunction(function(){return window.store.get('connected');});
    await page.waitForFunction(function(){return !document.querySelector('.shared-browser-address input').disabled;});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#shared-browser-entry').isVisible(),false);
    assert.equal(await page.locator('#shared-browser-panel').isVisible(),false);
    await page.setViewportSize({width:1440,height:960});
    await page.getByRole('button',{name:'View browser',exact:true}).click();
    assert.equal(await page.evaluate(function(){return window.store.get('sharedBrowser').width;}),1280);
    await page.setViewportSize({width:1440,height:1365});
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(function(){return window.store.get('sharedBrowser').width;}),1280);
    assert.equal(await page.getByLabel('Browser viewport').innerText(),'1280 × 800');
    await page.screenshot({path:'/tmp/clay-shared-browser-monitor.png'});
    await page.getByLabel('Browser viewport').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('menu',{name:'Browser resolutions'}).isVisible(),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByLabel('Browser viewport').getAttribute('aria-expanded'),'false');
    await page.getByLabel('Browser viewport').click();
    await page.locator('.shared-browser-title').click();
    assert.equal(await page.getByLabel('Browser viewport').getAttribute('aria-expanded'),'false');
    var presets = [['1280,800','laptop'],['1024,768','crt'],['800,600','mac'],['375,667','phone']];
    for (var preset of presets) {
      await page.getByLabel('Browser viewport').click();
      await page.getByRole('menuitemradio',{name:preset[0].replace(',', ' × '),exact:true}).click();
      await page.waitForFunction(function(size){var c=document.querySelector('#shared-browser-panel canvas');return c.width+','+c.height===size;},preset[0]);
      assert.equal(await page.locator('.shared-browser-viewport').getAttribute('data-skin'),preset[1]);
      await page.evaluate(function(){return document.fonts.ready;});
      await page.locator('#shared-browser-panel').screenshot({path:'/tmp/clay-browser-skin-'+preset[1]+'.png'});
    }
    await page.getByRole('button',{name:'End browser',exact:true}).click();
    await page.waitForFunction(function(){return window.store.get('sharedBrowser').phase==='ended';});
    await page.getByRole('button',{name:'Hide browser panel',exact:true}).click();
    await page.getByRole('button',{name:'View browser',exact:true}).click();
    assert.equal(await page.evaluate(function(){return window.store.get('sharedBrowser').phase;}),'ended');
    assert.equal(await page.getByRole('button',{name:'New browser',exact:true}).isVisible(),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: real shared browser, user URL/input, Driver inspection/control, handoff, hide/reopen, panel arbitration, reconnect, mobile hiding and retained ended frame');
  } finally { await browser.close(); }
}
main().catch(function(error){console.error(error);process.exitCode=1;}).finally(function(){controller.destroy();wss.clients.forEach(function(ws){ws.terminate();});wss.close();server.close();});
