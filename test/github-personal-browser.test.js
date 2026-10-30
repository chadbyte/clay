var test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fork=require('node:child_process').fork,chromium=require('playwright').chromium;
async function fixture(t,built){
  var child=fork(path.join(__dirname,'fixtures/server-settings-server.js'),['--github'].concat(built?['--built-settings']:[]),{stdio:['ignore','ignore','pipe','ipc']});
  var stderr='';child.stderr.on('data',function(data){stderr+=data;});t.after(function(){child.kill('SIGTERM');});
  var url=await new Promise(function(resolve,reject){child.once('error',reject);child.once('exit',function(code){reject(new Error('Fixture exited '+code+' '+stderr.slice(-1500)));});child.on('message',function(msg){if(msg.port)resolve('http://127.0.0.1:'+msg.port);});});
  var browser=await chromium.launch({headless:true});t.after(function(){return browser.close();});var page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});page.setDefaultTimeout(10000);
  var errors=[],messages=[];page.on('pageerror',function(error){errors.push(error.message);});page.on('websocket',function(ws){ws.on('framesent',function(frame){try{messages.push(JSON.parse(frame.payload));}catch(error){}});});t.after(function(){assert.deepEqual(errors,[]);});
  await page.goto(url+'/__fixture/admin');await page.waitForFunction(async function(){var module=await import('./modules/store.js');return module.store.get('connected')&&module.store.get('myUserId');});
  await page.locator('#server-settings-btn').click();await page.locator('#settings-page-nav [data-section=us-integrations]').click();await page.locator('#us-github-add').waitFor();
  async function state(value){return page.request.get(url+'/__fixture/github?'+value);}
  return {page:page,url:url,messages:messages,state:state};
}
async function checkSetupLink(page,hover) {
  var link=page.locator('#us-github-editor a.settings-link');
  if(hover)await link.hover();else await page.mouse.move(0,0);
  var colors=await link.evaluate(function(el,token){
    var reference=document.createElement('span');reference.style.color='var('+token+')';el.parentElement.appendChild(reference);
    var result={actual:getComputedStyle(el).color,expected:getComputedStyle(reference).color};reference.remove();return result;
  },hover?'--link-hover':'--link');
  assert.equal(colors.actual,colors.expected,'Official setup link uses the current settings theme token');
}
[false,true].forEach(function(built){test('GitHub Personal Integrations '+(built?'built':'source')+' real authenticated WS collection, exact review, failures, cancel and disconnect',{timeout:90000},async function(t){
  var f=await fixture(t,built),page=f.page;
  await page.locator('#us-github-add').click();var editor=page.locator('#us-github-editor');
  await editor.getByRole('button',{name:'Connect octo-fixture',exact:true}).waitFor();assert.match(await editor.innerText(),/ID 123.*github.com/);assert.match(await editor.innerText(),/shares GitHub CLI credentials/);
  assert.equal(await page.locator('#us-github-connections [data-connection-id]').count(),0);assert.equal(await editor.evaluate(function(el){return el===document.activeElement;}),true);
  await checkSetupLink(page,false);await checkSetupLink(page,true);await page.mouse.move(0,0);
  // An account switch after review refuses the old target.
  await f.state('account=other');await editor.getByRole('button',{name:'Connect octo-fixture',exact:true}).click();await page.locator('#us-github-status').filter({hasText:'account changed'}).waitFor();assert.equal(await page.locator('#us-github-add').isVisible(),true);
  await editor.getByRole('button',{name:'Refresh',exact:true}).click();await editor.getByRole('button',{name:'Connect other-fixture',exact:true}).waitFor();
  await f.state('failSave=true');await editor.getByRole('button',{name:'Connect other-fixture',exact:true}).click();await page.locator('#us-github-status').filter({hasText:'storage unavailable'}).waitFor();assert.equal(await editor.isVisible(),true);assert.equal(await page.locator('#us-github-connections [data-connection-id]').count(),0);
  await f.state('failSave=false');await editor.getByRole('button',{name:'Refresh',exact:true}).click();await editor.getByRole('button',{name:'Connect other-fixture',exact:true}).click();await page.locator('#us-github-connections strong').filter({hasText:'other-fixture'}).waitFor();assert.equal(await page.locator('#us-github-add').isVisible(),false);assert.equal(await page.locator('#us-connections-empty').isVisible(),false);
  assert.equal(await page.locator('#us-github-connections button').evaluate(function(el){return el===document.activeElement;}),true);
  await page.reload();await page.waitForFunction(async function(){return(await import('./modules/store.js')).store.get('connected');});await page.locator('#server-settings-btn').click();await page.locator('#settings-page-nav [data-section=us-integrations]').click();await page.locator('#us-github-connections strong').filter({hasText:'other-fixture'}).waitFor();
  await page.locator('#us-github-connections button').click();await f.state('state=unknown');await editor.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('#us-github-connections .us-integration-state').filter({hasText:'Verification unknown'}).waitFor();assert.equal(await editor.getByRole('button',{name:/Confirm account/}).count(),0);
  await f.state('state=authenticated&account=default');await editor.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('#us-github-connections .us-integration-state').filter({hasText:'Account or runtime changed'}).waitFor();assert.match(await editor.innerText(),/Saved account: other-fixture/);
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await checkSetupLink(page,false);
  var overflow=await page.locator('#settings-shell-content').evaluate(function(el){return el.scrollWidth-el.clientWidth;});assert.ok(overflow<=1,'Narrow content overflow '+overflow);
  // Disconnect removes only the saved Clay association and retains CLI identity.
  await editor.getByRole('button',{name:'Disconnect',exact:true}).click();await page.getByRole('button',{name:'Disconnect',exact:true}).last().click();await page.locator('#us-github-add').waitFor();assert.equal(await page.locator('#us-github-connections [data-connection-id]').count(),0);
  var effective=await(await f.state('')).json();assert.equal(effective.account.id,123);assert.equal(effective.calls.some(function(args){return args.indexOf('logout')>=0||args.indexOf('token')>=0;}),false);
  // Device login stays an explicit, cancellable terminal effect.
  await f.state('state=unauthenticated');await page.locator('#us-github-add').click();await editor.getByRole('button',{name:'Refresh',exact:true}).click();await editor.getByRole('button',{name:'Sign in with browser',exact:true}).click();assert.equal((await(await f.state('')).json()).terminals,0);
  await page.getByRole('button',{name:'Start GitHub login',exact:true}).click();await page.locator('.tui-modal-backdrop:not(.hidden)').waitFor();assert.equal((await(await f.state('')).json()).terminals,1);
  await page.locator('.tui-modal-close').click();await page.locator('#us-github-status').filter({hasText:'Login terminal exited'}).waitFor();assert.equal((await(await f.state('')).json()).terminals,0);
  await editor.getByRole('button',{name:'Refresh',exact:true}).click();await editor.getByRole('button',{name:'Sign in with browser',exact:true}).click();await page.getByRole('button',{name:'Start GitHub login',exact:true}).click();await page.locator('.tui-modal-backdrop:not(.hidden)').waitFor();
  await f.state('state=authenticated&finish=true');await editor.getByRole('button',{name:'Connect octo-fixture',exact:true}).waitFor();assert.equal(await page.locator('.tui-modal-backdrop:not(.hidden)').count(),0);assert.equal(await page.locator('#us-github-add').isVisible(),true);
  // Leaving settings stops the exact active terminal and delivers its exit acknowledgement.
  await editor.getByRole('button',{name:'Sign in with browser',exact:true}).click();await page.getByRole('button',{name:'Start GitHub login',exact:true}).click();await page.locator('.tui-modal-backdrop:not(.hidden)').waitFor();
  await page.locator('.tui-modal-close').click();await page.locator('#us-github-status').filter({hasText:'Login terminal exited'}).waitFor();
  await editor.getByRole('button',{name:'Refresh',exact:true}).click();await editor.getByRole('button',{name:'Sign in with browser',exact:true}).click();await page.getByRole('button',{name:'Start GitHub login',exact:true}).click();await page.locator('.tui-modal-backdrop:not(.hidden)').waitFor();
  await page.locator('#settings-page-select').selectOption('us-account');
  await page.waitForFunction(function(){return document.body.innerText.includes('Login terminal exited.');});assert.equal((await(await f.state('')).json()).terminals,0);
  await page.locator('#settings-page-select').selectOption('us-integrations');await page.locator('#us-github-add').click();await editor.getByRole('button',{name:'Connect octo-fixture',exact:true}).waitFor();
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('#us-github-add').evaluate(function(el){return el===document.activeElement;}),true);
  await page.emulateMedia({colorScheme:'light'});assert.equal(f.messages.some(function(msg){return msg.type==='user_message'||msg.type==='message'||msg.type==='vendor_login_start';}),false);
  // Switching protects a Linear draft, then shows only the selected editor.
  assert.equal(await page.locator('[data-email-provider]').count(),4);assert.equal(await page.locator('#us-linear-add').count(),1);await page.locator('#us-linear-add').click();await page.locator('#us-linear-name').fill('Retained draft');await page.locator('#us-github-add').click();await page.locator('#settings-confirm [data-cancel]').click();assert.equal(await page.locator('#us-linear-name').inputValue(),'Retained draft');assert.equal(await editor.isVisible(),false);await page.locator('#us-github-add').click();await page.locator('#settings-confirm [data-confirm]').click();await editor.waitFor();assert.equal(await page.locator('#us-linear-editor').isVisible(),false);assert.equal(await page.locator('#us-linear-name').inputValue(),'');
});});
