var http = require('http');
var fs = require('fs');
var path = require('path');
var assert = require('node:assert/strict');
var chromium = require('playwright').chromium;
var root = path.resolve(__dirname, '../../lib/public');
var index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var sections = index.slice(index.indexOf('<div id="skills-modal"'), index.indexOf('<!-- Debate Modal'));
var html = '<!doctype html><html><head><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/overlays.css"><link rel="stylesheet" href="/css/skills.css"><link rel="stylesheet" href="/css/filebrowser.css"><link rel="stylesheet" href="/css/mcp-skills-workbench.css"><link rel="stylesheet" href="/css/right-workbench.css"><style>body{margin:0}#main-panels{display:flex;height:100vh}#app{flex:1;padding:24px}#main-panels:has(.panel-fullscreen:not(.hidden))>#app{display:none}</style></head><body><div id="main-panels"><main id="app"><button id="mcp-btn">MCP / Skills</button><textarea aria-label="Message">Keep talking here</textarea></main></div>' + sections + '<script src="/lucide.js"></script><script type="module">import {createStore,store} from "/modules/store.js";import {setWs} from "/modules/ws-ref.js";import {initMcp,handleMcpServersState} from "/modules/mcp-ui.js";import {initSkills,handleSkillInstalled} from "/modules/skills.js";import {initExtensionSettings} from "/modules/extension-settings.js";import {claimRightWorkbench} from "/modules/right-workbench.js";createStore({currentSlug:"demo",myUserId:"owner",activeSessionId:1,connected:true,permissions:{skills:true},mcpSkillsWorkbench:{}});window.store=store;window.sent=[];setWs({readyState:1,send:function(text){window.sent.push(JSON.parse(text));}});window.claim=claimRightWorkbench;window.installed=handleSkillInstalled;initMcp();initSkills();initExtensionSettings();handleMcpServersState({servers:[{name:"Example MCP",extensionEnabled:true,projectEnabled:true,transport:"http",toolCount:3}],hostConnected:true});</script></body></html>';
var requests = [];
var lucide;
var server = http.createServer(function(req,res){
  var url = new URL(req.url,'http://localhost');
  if(url.pathname==='/lucide.js'){res.setHeader('Content-Type','text/javascript');res.end(lucide);return;}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(url.pathname.indexOf('/api/')===0){
    requests.push(url.pathname);res.setHeader('Content-Type','application/json');
    if(url.pathname==='/api/installed-skills')res.end(JSON.stringify({installed:{'clay-agent-browser':{scope:'global',source:'clay-builtin',description:'Browse together with your Driver.'}}}));
    else if(url.pathname==='/api/skills/detail')res.end(JSON.stringify({name:'Example skill',description:'Test a website together.',skillMd:'<p>Example instructions.</p>'}));
    else if(url.pathname==='/api/install-skill')res.end('{"ok":true}');
    else res.end(JSON.stringify({skills:[{name:'Example skill',skillId:'example-skill',source:'example/skills',installs:42}]}));
    return;
  }
  var file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,function(error,data){if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(data);});
});
async function main(){
  lucide = await (await fetch('https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js')).text();
  await new Promise(function(resolve){server.listen(0,'127.0.0.1',resolve);});
  var browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    var page=await browser.newPage({viewport:{width:1440,height:960}});var errors=[];page.on('pageerror',function(error){errors.push(error.message);});
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'MCP / Skills',exact:true}).click();
    assert.equal(await page.locator('#mcp-skills-workbench').isVisible(),true);
    var effects = await page.evaluate(function () {
      var terminal = document.createElement('div'); terminal.id = 'terminal-container'; document.body.appendChild(terminal);
      var reference = getComputedStyle(terminal); var panel = getComputedStyle(document.getElementById('mcp-skills-workbench'));
      var result = { sameShadow: reference.boxShadow === panel.boxShadow, shadow: panel.boxShadow, animation: panel.animationName };
      terminal.remove(); return result;
    });
    assert.equal(effects.sameShadow,true); assert.notEqual(effects.shadow,'none'); assert.equal(effects.animation,'workbench-panel-in');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('#mcp-skills-workbench').evaluate(function(el){return getComputedStyle(el).animationName;}),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(await page.getByText('Example MCP',{exact:true}).isVisible(),true);
    assert.equal(await page.locator('#mcp-modal #ext-pill').count(),1);
    await page.locator('#ext-pill').click();
    assert.equal(await page.locator('#ext-popover').isVisible(),true);
    assert.equal(await page.locator('#ext-pill').getAttribute('aria-expanded'),'true');
    await page.locator('#ext-pill').click();
    assert.equal(await page.locator('#ext-popover').isVisible(),false);
    await page.locator('#mcp-content input[type=checkbox]').uncheck();
    assert.ok(await page.evaluate(function(){return window.sent.some(function(msg){return msg.type==='mcp_toggle_server' && msg.enabled===false;});}));
    await page.getByRole('tab',{name:'Skills',exact:true}).click();
    await page.getByText('clay-agent-browser',{exact:true}).waitFor();
    assert.equal(await page.locator('.skills-uninstall-btn').count(),0,'built-in skills cannot be removed');
    await page.getByRole('textbox',{name:'Message',exact:true}).fill('');
    await page.getByRole('textbox',{name:'Message',exact:true}).press('/');
    assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'/');
    await page.locator('#skills-search-input').fill('example');
    await page.getByText('Example skill',{exact:true}).click();
    await page.locator('.skills-detail-name').waitFor();
    await page.getByRole('tab',{name:'MCP Servers',exact:true}).click();
    await page.getByRole('tab',{name:'Skills',exact:true}).click();
    assert.equal(await page.locator('.skills-detail-name').isVisible(),true,'tab switches retain the Skills detail');
    await page.getByRole('button',{name:'Install (Project)',exact:true}).click();
    await page.waitForFunction(function(){return document.querySelector('.skills-install-btn.installing');});
    await page.evaluate(function(){window.installed({skill:'example-skill',scope:'project',success:true});});
    await page.getByText('Installed (Project)',{exact:true}).waitFor();
    await page.screenshot({path:'/tmp/clay-mcp-skills-desktop.png'});
    await page.getByRole('button',{name:'Close MCP / Skills',exact:true}).click();
    await page.getByRole('button',{name:'MCP / Skills',exact:true}).click();
    await page.getByRole('tab',{name:'Skills',exact:true}).click();
    assert.equal(await page.locator('.skills-detail-name').isVisible(),true);
    await page.evaluate(function(){window.claim('files');});
    assert.equal(await page.locator('#mcp-skills-workbench').isVisible(),false);
    await page.getByRole('button',{name:'MCP / Skills',exact:true}).click();
    await page.getByRole('button',{name:'Widen MCP / Skills',exact:true}).click();
    assert.equal(await page.locator('#mcp-skills-workbench').evaluate(function(el){return el.classList.contains('workbench-wide');}),true);
    await page.setViewportSize({width:390,height:844});
    var box=await page.locator('#mcp-skills-workbench').boundingBox();assert.equal(Math.round(box.width),390);
    await page.screenshot({path:'/tmp/clay-mcp-skills-mobile.png'});
    await page.evaluate(function(){window.postMessage({source:'clay-chrome-extension'},'*');});
    await page.waitForFunction(function(){return document.getElementById('ext-pill').classList.contains('ext-connected');});
    await page.locator('#ext-pill').click();
    assert.equal(await page.locator('#ext-connected-banner').isVisible(),true);
    assert.equal(await page.locator('#ext-download-btn').isVisible(),false);
    await page.evaluate(function(){window.store.set({permissions:{skills:false}});});
    assert.equal(await page.getByRole('tab',{name:'Skills',exact:true}).isVisible(),false);
    assert.equal(await page.getByRole('tab',{name:'MCP Servers',exact:true}).isVisible(),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: combined workbench, MCP toggle, installed skills, search/detail/install, retained navigation, arbitration, sizing, mobile and permissions');
  }finally{await browser.close();server.close();}
}
main().catch(function(error){console.error(error);process.exitCode=1;server.close();});
