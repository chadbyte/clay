var test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),chromium=require('playwright').chromium;
test('View expansion and session focus persist through reload and return to the saved layout', {timeout:120000}, async function(t){
  var child=cp.fork(path.join(__dirname,'fixtures/pane-reuse-server.cjs'),[],{env:Object.assign({},process.env,{CLAY_PANE_PRESENTATION:'1',CLAY_PANE_FILES:'1',CLAY_PANE_BROWSER:'1',CLAY_PANE_WORKBENCH:'1'}),stdio:['ignore','pipe','pipe','ipc']});
  t.after(function(){child.kill('SIGTERM');});child.stdout.resume();child.stderr.resume();
  var info=await new Promise(function(resolve,reject){child.once('message',resolve);child.once('error',reject);}),base='http://127.0.0.1:'+info.port;
  var browser=await chromium.launch();t.after(function(){return browser.close();});var page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[],assets=[];
  page.on('pageerror',function(e){errors.push(e.message);});page.on('response',function(r){if(/pane-assets\/app-/.test(r.url()))assets.push({url:r.url(),status:r.status()});});
  if(process.env.CLAY_FOCUS_COMPILED){var cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});}
  if(!process.env.CLAY_FOCUS_COMPILED)await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(base+'/fixture/login');var data=await(await page.request.get(base+'/fixture/state')).json(),viewId=data.restoreView.id;
  await page.locator('[data-split-view-id="'+viewId+'"] .split-view-group-open').click();
  await page.waitForFunction(function(){return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached)').length===2;});
  async function saved(predicate){var last;for(var i=0;i<150;i++){var data=await(await page.request.get(base+'/fixture/state')).json();assert.ok(data.savedViews.ok,JSON.stringify(data.savedViews));last=data.savedViews.views.find(function(v){return v.id===viewId;});if(last&&predicate(last))return last;await new Promise(function(resolve){setTimeout(resolve,50);});}assert.fail('Saved View did not settle: '+JSON.stringify(last));}
  await page.locator('#terminal-sidebar-btn').click();await page.waitForSelector('#terminal-container .xterm-helper-textarea',{state:'attached'});await page.locator('#terminal-container .workbench-layout-toggle').click();
  await saved(function(v){return v.workspace.panes.some(function(p){return p.kind==='terminal'&&p.placement==='docked';});});
  await page.locator('#shared-browser-btn').click();await page.waitForSelector('#shared-browser-panel:not(.hidden)');await page.locator('#shared-browser-panel .workbench-layout-toggle').click();
  await saved(function(v){return v.workspace.panes.some(function(p){return p.kind==='browser'&&p.placement==='docked';});});
  await page.locator('#file-browser-btn').click();await page.locator('.file-tree-item[data-path="a.md"]').first().click();await page.getByText('ALPHA_FILE_CONTENT',{exact:true}).waitFor();
  await page.locator('.file-instance .workbench-layout-toggle').click();await page.locator('.file-instance').getByRole('button',{name:'Pin this file',exact:true}).click();
  var initial=await saved(function(v){return v.workspace.panes.length===5&&v.workspace.panes.some(function(p){return p.kind==='file'&&p.placement==='docked'&&p.resource.mode==='pin';});});
  var tree=initial.workspace.tree;
  for(var kind of ['terminal','browser','file']){
    var pane=initial.workspace.panes.find(function(p){return p.kind===kind;}),selector=kind==='file'?'#file-'+pane.instanceId:kind==='terminal'?'#terminal-container':'#shared-browser-panel';
    var button=kind==='file'?'button[aria-label="Expand file pane"]':kind==='terminal'?'#terminal-fullscreen':'[data-action="fullscreen"]';
    await page.locator(selector+' '+button).click();
    await saved(function(v){return v.workspace.presentation&&v.workspace.presentation.expandedPaneId===pane.instanceId;});
    await page.reload();try { await page.waitForSelector(selector+'.panel-fullscreen'); } catch (error) { throw new Error(error.message + '\n' + JSON.stringify({errors:errors, saved:await saved(function(){return true;}), panels:await page.locator('#main-panels > section, #terminal-container, #shared-browser-panel').evaluateAll(function(els){return els.map(function(el){return {id:el.id,className:el.className};});})})); }await page.waitForSelector(selector+' '+button);
    var style=await page.locator(selector).evaluate(function(el){var r=el.getBoundingClientRect(),main=document.getElementById('main-panels').getBoundingClientRect(),s=getComputedStyle(el);return {inset:Math.round(r.x-main.x),radius:s.borderRadius,border:s.borderTopWidth,width:Math.round(r.width),main:Math.round(main.width),terminal:getComputedStyle(document.getElementById('terminal-body')).backgroundColor};});
    assert.equal(style.inset,7);assert.equal(style.radius,'9px');assert.equal(style.border,'1px');assert.equal(style.width,style.main-14);assert.equal(style.terminal,'rgb(20, 20, 18)');
    await page.locator(selector+' '+button).click();await saved(function(v){return v.workspace.presentation&&v.workspace.presentation.expandedPaneId===null;});
    await page.waitForFunction(function(){return document.querySelectorAll('.tool-pane-window').length===3;});
    var after=await saved(function(v){return !v.workspace.presentation.expandedPaneId;});assert.deepEqual(after.workspace.tree,tree);assert.deepEqual(after.workspace.panes,initial.workspace.panes);
  }
  await page.locator('#split-host > .split-pane:not(.split-pane-cached) .split-view-arrange-trigger').first().click();await page.getByRole('button',{name:'Focus selected session',exact:true}).click();
  var focused=await saved(function(v){return v.workspace.presentation&&v.workspace.presentation.focusedSessionOriginId;});
  await page.reload();await page.waitForFunction(function(){return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached):not([hidden])').length===1;});
  await page.locator('#split-host > .split-pane:not([hidden]) .split-view-arrange-trigger').click();await page.getByRole('button',{name:'Restore layout',exact:true}).click();await saved(function(v){return v.workspace.presentation.focusedSessionOriginId===null;});
  for(var composition of ['one','zero']) {
    var filePane=initial.workspace.panes.find(function(p){return p.kind==='file';}),fileSelector='#file-'+filePane.instanceId;
    var changed=await(await page.request.post(base+'/fixture/workspace-file?view='+viewId+'&instance='+filePane.instanceId+'&action='+composition)).json();assert.equal(changed.ok,true,JSON.stringify(changed));
    await page.locator(fileSelector).getByText('ALPHA_FILE_CONTENT',{exact:true}).waitFor();
    await page.locator(fileSelector+' button[aria-label="Expand file pane"]').click();await saved(function(v){return v.workspace.presentation.expandedPaneId===filePane.instanceId;});
    await page.reload();await page.waitForSelector(fileSelector+'.panel-fullscreen');await page.locator(fileSelector+' button[aria-label="Expand file pane"]').click();await saved(function(v){return v.workspace.presentation.expandedPaneId===null;});
  }
  data=await(await page.request.get(base+'/fixture/state')).json();assert.equal(data.terminalStats.length,1);assert.deepEqual(data.terminalStats[0].writes,[]);assert.deepEqual(errors,[]);
  if(process.env.CLAY_FOCUS_COMPILED){
    assert.ok(assets.length>=5,JSON.stringify(assets));
    assert.ok(assets.every(function(a){return a.status===200;}),JSON.stringify(assets));
    // Only authenticated pane documents use the compiled entry; the outer shell uses app.js.
    var compiledShell=await page.request.get(base+'/p/reuse/?pane=1');
    assert.equal(compiledShell.status(),200);
    assert.match(await compiledShell.text(),/<script type="module" src="pane-assets\/app-[^"/]+\.js"><\/script>/);
  }
});
