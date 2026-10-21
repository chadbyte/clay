var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
// Production authentication, sockets and View persistence; fixture isolates all
// storage and provider/PTY/browser transports before importing product modules.
test('fresh Terminal then Browser docking survives settled server reads and three cache-disabled refreshes', {timeout:90000}, async function(t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {env:Object.assign({},process.env,{CLAY_PANE_PRESENTATION:'1',CLAY_PANE_WORKBENCH:'1',CLAY_PANE_BROWSER:'1'}),stdio:['ignore','pipe','pipe','ipc']});
  t.after(function(){child.kill('SIGTERM');});child.stdout.resume();child.stderr.resume();
  var info = await new Promise(function(resolve,reject){child.once('message',resolve);child.once('error',reject);});
  var browser = await chromium.launch();t.after(function(){return browser.close();});
  var page = await browser.newPage({viewport:{width:1800,height:1000}}), errors=[];
  page.on('pageerror',function(error){errors.push(error.message);});
  await require('./fixtures/source-module-runtime.cjs').install(page);
  var base='http://127.0.0.1:'+info.port;
  await page.goto(base+'/fixture/login');
  var data=await(await page.request.get(base+'/fixture/state')).json(), id=data.restoreView.id;
  await page.locator('[data-split-view-id="'+id+'"] .split-view-group-open').click();
  await page.waitForFunction(function(){return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached) iframe').length===2;});
  async function dock(id) {
    var panel=page.locator('#'+id);
    await page.waitForFunction(function(id){var b=document.querySelector('#'+id+' .workbench-layout-toggle');return b&&!b.disabled;},id);
    await panel.locator('.workbench-layout-toggle').click();
    try { await page.waitForFunction(function(id){return document.getElementById(id).dataset.workbenchPlacement==='docked';},id); }
    catch(error) {
      var state=await page.evaluate(async function(id){var s=(await import('/p/reuse/modules/store.js')).store;var p=document.getElementById(id);return {placement:p.dataset.workbenchPlacement,hidden:p.classList.contains('hidden'),owner:s.get('rightWorkbenchOwner'),docks:s.get('rightWorkbenchDockedOwners'),runtime:s.get('savedWorkspaceRuntime'),pending:s.get('projectSplitViewPending'),error:s.get('projectSplitViewError')};},id);
      throw new Error(error.message+'; docking state: '+JSON.stringify(state));
    }
  }
  async function readView() {
    return page.evaluate(async function(id){
      var ws=(await import('/p/reuse/modules/ws-ref.js')).getWs();
      return new Promise(function(resolve,reject){
        var timer=setTimeout(function(){ws.removeEventListener('message',onMessage);reject(new Error('No authoritative View read receipt'));},5000);
        function onMessage(event){var msg=JSON.parse(event.data);if(msg.type!=='project_split_views'||msg.projectSlug!=='reuse')return;clearTimeout(timer);ws.removeEventListener('message',onMessage);resolve(msg.views.find(function(v){return v.id===id;}));}
        ws.addEventListener('message',onMessage);ws.send(JSON.stringify({type:'project_split_views_request'}));
      });
    },id);
  }
  function tools(view){return view.workspace.panes.filter(function(p){return p.kind!=='session';});}
  function bothDocked(view){return view&&['terminal','browser'].every(function(kind){return tools(view).some(function(p){return p.kind===kind&&p.open&&p.placement==='docked';});});}
  await page.locator('#terminal-sidebar-btn').click();await page.locator('#terminal-container .xterm').waitFor();await dock('terminal-container');
  await page.locator('#shared-browser-btn').click();await page.locator('#shared-browser-panel').waitFor({state:'visible'});await dock('shared-browser-panel');
  var deadline=Date.now()+15000, before;
  do { before=await readView();if(bothDocked(before))break;await page.waitForTimeout(25); } while(Date.now()<deadline);
  assert.ok(bothDocked(before),'both bindings must be in an authoritative saved View response');
  await page.waitForTimeout(1000);
  assert.deepEqual(tools(await readView()),tools(before),'settling cannot erase either saved binding');
  var cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  for(var i=0;i<3;i++){
    await page.reload();
    await page.waitForFunction(function(){return ['terminal-container','shared-browser-panel'].every(function(id){var p=document.getElementById(id);return p&&!p.classList.contains('hidden')&&!!p.dataset.toolWindowId;});});
    var after=await readView();assert.equal(after.id,id);assert.equal(after.sessions.length,2);assert.deepEqual(tools(after),tools(before));assert.deepEqual(after.workspace.tree,before.workspace.tree);
    assert.equal((await(await page.request.get(base+'/fixture/state')).json()).terminalStats.length,1);
  }
  await page.locator('#terminal-container').getByRole('button',{name:'Close terminal pane',exact:true}).click();
  deadline=Date.now()+15000;
  do { var closed=await readView();if(tools(closed).some(function(p){return p.kind==='terminal'&&!p.open;}))break;await page.waitForTimeout(25); } while(Date.now()<deadline);
  assert.equal(tools(closed).find(function(p){return p.kind==='browser';}).open,true);
  await page.waitForTimeout(1000);assert.deepEqual(tools(await readView()),tools(closed));
  await page.reload();await page.waitForFunction(function(){var p=document.getElementById('shared-browser-panel');return p&&!p.classList.contains('hidden')&&p.dataset.toolWindowId;});
  assert.equal(await page.locator('#terminal-container').isVisible(),false);assert.deepEqual(tools(await readView()),tools(closed));assert.deepEqual(errors,[]);
  // A save starting between pointer-down and pointer-up must not swallow docking.
  await page.locator('#terminal-sidebar-btn').click();
  await page.evaluate(async function(){
    var s=(await import('/p/reuse/modules/store.js')).store,mutation=(await import('/p/reuse/modules/view-mutations.js')).mutation;
    document.querySelector('#terminal-container .workbench-layout-toggle').addEventListener('pointerdown',function(){
      var v=s.get('projectSplitViews').find(function(v){return v.id===s.get('projectSplitViewActiveId');});
      mutation('project_split_view_update',{id:v.id,sessionOrigins:v.sessions.map(function(ref){return ref.sessionOriginId;}),tree:v.tree,layout:v.layout,activeSessionOriginId:v.activeSessionOriginId,workspace:v.workspace});
      this.dataset.gesturePending=String(!!s.get('projectSplitViewPending'));
      if(s.get('projectSplitViewPending')&&this.disabled)throw new Error('A pending View save disabled an active docking gesture');
    },{once:true});
  });
  await dock('terminal-container');
  assert.equal(await page.locator('#terminal-container .workbench-layout-toggle').getAttribute('data-gesture-pending'),'true');
  deadline=Date.now()+15000;
  do { var redocked=await readView();if(bothDocked(redocked))break;await page.waitForTimeout(25); } while(Date.now()<deadline);
  assert.ok(bothDocked(redocked));assert.deepEqual(errors,[]);
});
