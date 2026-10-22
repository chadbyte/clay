var test = require('node:test');
var assert = require('node:assert/strict');
var fork = require('node:child_process').fork;
var path = require('node:path');
var chromium = require('playwright').chromium;

function fixture(t) {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname,'fixtures/server-settings-server.js'),[],{stdio:['ignore','ignore','pipe','ipc']});
    t.after(function(){child.kill('SIGTERM');});
    child.once('error',reject);
    child.on('message',function(msg){if(msg.port)resolve({url:'http://127.0.0.1:'+msg.port});});
  });
}
async function openSettings(page, section) {
  await page.locator('body.is-multi-user').waitFor();
  await page.waitForFunction(async function(){var module=await import('/modules/store.js');return module.store.get('connected') && module.store.get('myUserId');});
  for (var attempt=0;attempt<3;attempt++) {
    if(await page.locator('#user-account-trigger').getAttribute('aria-expanded')!=='true')await page.locator('#user-account-trigger').click();
    try {await page.locator('.account-settings-button').click({timeout:1500});break;}
    catch(error){if(attempt===2)throw error;}
  }
  if(section)await page.locator('#settings-page-nav [data-section="'+section+'"]').click();
}

test('appearance persistence enforces account isolation, authentication and write validation', {timeout:20000}, async function(t){
  var f=await fixture(t);
  var headers={'Cookie':'relay_auth_user=network-admin','Content-Type':'application/json','X-Clay-Settings':'1'};
  var url=f.url+'/api/user/appearance';
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{method:'PUT',headers:headers,body:JSON.stringify({theme:'../bad',mode:'dark'})})).status,400);
  assert.equal((await fetch(url,{method:'PUT',headers:Object.assign({},headers,{'Sec-Fetch-Site':'cross-site'}),body:'{}'})).status,403);
  assert.equal((await fetch(url,{method:'PUT',headers:headers,body:JSON.stringify({theme:'clay-dark',mode:'dark'})})).status,200);
  assert.equal((await (await fetch(url,{headers:headers})).json()).theme,'clay-dark');
  var member=await (await fetch(url,{headers:{Cookie:'relay_auth_user=network-member'}})).json();
  assert.equal(member.configured,false);
  assert.equal((await fetch(url,{method:'PUT',headers:headers,body:JSON.stringify({theme:'clay-dark',mode:'dark',lightTheme:'clay-light',darkTheme:'clay-dark'})})).status,200);
  await fetch(url,{method:'PUT',headers:headers,body:JSON.stringify({theme:'clay-light',mode:'light'})});
  var paired=await (await fetch(url,{headers:headers})).json();
  assert.equal(paired.lightTheme,'clay-light');assert.equal(paired.darkTheme,'clay-dark');
  assert.equal((await fetch(url,{method:'PUT',headers:headers,body:JSON.stringify({theme:'clay-dark',mode:'dark',lightTheme:'../bad'})})).status,400);

});

test('personal settings keep drafts, persist appearance, share voice and expose one narrow navigation', {timeout:60000}, async function(t){
  var f=await fixture(t);var browser=await chromium.launch({headless:true});t.after(function(){return browser.close();});
  var page=await browser.newPage({viewport:{width:1280,height:800}});var errors=[];page.setDefaultTimeout(8000);
  page.on('pageerror',function(error){errors.push(error.message);});
  await page.goto(f.url+'/__fixture/admin', { waitUntil: 'domcontentloaded' });
  await openSettings(page,'us-appearance');
  assert.deepEqual(await page.locator('#settings-page-nav button').allTextContents(),['Account','Appearance','Conversation','Notifications','AI preferences','Agent behavior','Integrations']);
  assert.equal(await page.locator('#settings-page-nav .us-config-group').count(),0);
  await page.locator('#us-theme-mode + .settings-picker .settings-picker-trigger').click();
  await page.getByRole('option',{name:'Dark',exact:true}).click();
  await page.locator('#us-appearance-status').filter({hasText:'Saved.'}).waitFor();
  await page.reload();await openSettings(page,'us-appearance');
  assert.equal(await page.locator('html.dark-theme').count(),1);
  assert.equal(await page.locator('.us-theme-preview').count(),2);
  assert.equal(await page.locator('.us-layout-preview').count(),2);
  assert.ok(await page.getByText('Centered messages in separate bubbles.',{exact:true}).isVisible());
  await page.locator('#us-theme-light').selectOption({index:1},{force:true});
  await page.locator('#us-appearance-status').filter({hasText:'Saved.'}).waitFor();
  var lightChoice=await page.locator('#us-theme-light').inputValue();
  await page.reload();await openSettings(page,'us-appearance');
  assert.equal(await page.locator('#us-theme-light').inputValue(),lightChoice);
  await page.locator('#us-theme-mode + .settings-picker .settings-picker-trigger').click();
  await page.getByRole('option',{name:'Light',exact:true}).click();
  await page.locator('#us-appearance-status').filter({hasText:'Saved.'}).waitFor();
  assert.equal(await page.locator('html.light-theme').count(),1);
  assert.equal(await page.locator('#us-theme-light').inputValue(),lightChoice);
  await page.locator('#us-theme-mode + .settings-picker .settings-picker-trigger').click();
  await page.getByRole('option',{name:'Dark',exact:true}).click();
  await page.locator('#us-appearance-status').filter({hasText:'Saved.'}).waitFor();

  assert.equal(await page.locator('html.dark-theme').count(),1);

  await page.locator('#settings-page-nav [data-section="us-account"]').click();
  await page.locator('#us-profile-edit').click();await page.locator('#us-profile-name').fill('Draft name');
  await page.route('**/api/profile',function(route){if(route.request().method()==='PUT')return route.fulfill({status:500,contentType:'application/json',body:'{"error":"Disk unavailable"}'});return route.continue();});
  await page.locator('#us-profile-name').locator('..').locator('[type=submit]').click();
  await page.getByText('Disk unavailable',{exact:true}).waitFor();
  assert.equal(await page.locator('#us-profile-name').inputValue(),'Draft name');
  await page.locator('#settings-shell-close').click();await page.getByRole('button',{name:'Keep draft and leave',exact:true}).click();
  await openSettings(page);
  assert.equal(await page.locator('#us-profile-name').inputValue(),'Draft name');
  await page.locator('#us-profile-name').locator('..').locator('[data-cancel]').click();await page.getByRole('button',{name:'Discard',exact:true}).click();
  await page.locator('#settings-page-nav [data-section="us-chat"]').click();
  assert.equal(await page.locator('#us-voice-settings select').count(),0);
  assert.equal(await page.locator('[data-voice-provider]').count(),5);
  await page.locator('[data-voice-key="openai"]').click();
  await page.waitForFunction(function () {
    var frame = document.querySelector('#split-host .split-pane:not(.split-pane-cached) iframe.split-pane-frame');
    var live = frame && frame.clayPane && frame.clayPane.identity();
    return live && live.ready && !frame.dataset.requestedSessionId && live.sessionId === Number(frame.dataset.sessionId) &&
      live.binding.sessionOriginId === frame.dataset.sessionOriginId && frame.clayPane.source === frame.contentWindow && frame.clayPane.document === frame.contentDocument;
  });
  var composer = page.frameLocator('#split-host .split-pane:not(.split-pane-cached) iframe.split-pane-frame').first();
  assert.equal(await composer.locator('#speech-picker').count(),0);
  await page.locator('#us-voice-key').fill('fixture-unsaved-key');
  await page.route('**/api/speech/settings',function(route){if(route.request().method()==='PUT')return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Fixture voice unavailable"}'});return route.continue();});
  await page.locator('#us-voice-key-form [type=submit]').click();
  await page.locator('#us-voice-status').filter({hasText:'Fixture voice unavailable'}).waitFor();
  assert.equal(await page.locator('#us-voice-key').inputValue(),'fixture-unsaved-key');
  await page.locator('#us-voice-key-cancel').click();
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  assert.equal(await page.locator('#us-voice-key').inputValue(),'fixture-unsaved-key');
  await page.locator('#us-voice-key-cancel').click();
  await page.getByRole('button',{name:'Discard',exact:true}).click();

  await page.unroute('**/api/speech/settings');
  await page.locator('[data-voice-key="elevenlabs"]').click();
  assert.equal(await page.locator('[data-voice-provider="elevenlabs"] #us-voice-key-form').isVisible(),true);
  assert.equal(await page.evaluate(async function(){return (await (await fetch('/api/speech/settings')).json()).selected;}),'browser');
  await page.locator('#us-voice-key').fill('fixture-only-secret');
  await page.locator('#us-voice-key-form [type=submit]').click();
  await page.locator('#us-voice-status').filter({hasText:'Key saved.'}).waitFor();
  assert.equal(await page.evaluate(async function(){return (await (await fetch('/api/speech/settings')).json()).selected;}),'browser');
  assert.equal(await page.locator('[data-voice-key="elevenlabs"]').textContent(),'API key');
  await page.locator('[data-voice-key="elevenlabs"]').click();
  await page.locator('#us-voice-remove').click();
  await page.getByRole('button',{name:'Remove key',exact:true}).click();
  await page.locator('#us-voice-status').filter({hasText:'Key removed.'}).waitFor();
  assert.equal(await page.locator('[data-voice-key="elevenlabs"]').textContent(),'Connect');
  await page.locator('#settings-shell-close').click();
  await composer.getByRole('button',{name:'Choose voice model',exact:true}).click();
  await composer.locator('#speech-picker .settings-picker-trigger').click();
  await composer.locator('#speech-picker [role=option]').filter({hasText:'Korean'}).click();
  await composer.locator('#speech-picker .settings-picker-trigger').filter({hasText:'Korean'}).waitFor();
  await composer.locator('#speech-picker [data-action=close]').click();
  await openSettings(page,'us-integrations');
  assert.equal(await page.locator('#us-linear-form').count(),0);
  assert.equal(await page.locator('#settings-page-nav [data-section="us-email"]').count(),0);
  assert.deepEqual(await page.locator('.us-integration-tile').allTextContents(),['Gmail','Outlook Mail','Yahoo Mail','Custom email','Linear']);
  assert.equal(await page.locator('#us-mates-enabled').count(),0);
  assert.equal(await page.locator('#us-claude-open-mode').count(),0);
  assert.equal(await page.locator('body.project-mate-dms-disabled').count(),0);
  await page.locator('[data-email-provider="gmail"]').click();
  assert.equal(await page.locator('select#email-setup-provider').count(),0);
  assert.equal(await page.locator('#us-integration-setup .email-setup-inline').count(),1);
  assert.equal(await page.locator('#email-setup-modal [role=dialog]').count(),0);
  assert.equal(await page.locator('#user-settings').evaluate(function(el){return el.inert;}),false);
  await page.locator('#email-setup-cancel').click();
  await page.locator('#email-setup-modal').waitFor({state:'detached'});
  await page.locator('[data-email-provider="custom"]').click();
  assert.ok(await page.locator('#email-setup-imap-host').isVisible());
  await page.locator('#email-setup-address').fill('draft@example.com');
  await page.locator('#settings-page-nav [data-section="us-account"]').click();
  await page.getByRole('button',{name:'Keep draft and leave',exact:true}).click();
  await page.locator('#settings-page-nav [data-section="us-integrations"]').click();
  assert.equal(await page.locator('#email-setup-address').inputValue(),'draft@example.com');
  await page.locator('#email-setup-cancel').click();
  assert.equal(await page.locator('#settings-confirm').evaluate(function(el) {return document.elementFromPoint(innerWidth/2,innerHeight/2).closest('#settings-confirm') === el;}),true);
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  assert.equal(await page.locator('#email-setup-address').inputValue(),'draft@example.com');
  await page.locator('#email-setup-cancel').click();await page.getByRole('button',{name:'Discard',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#settings-page-nav').isVisible(),false);
  assert.equal(await page.locator('#settings-page-select').isVisible(),true);
  await page.locator('#settings-page-select').selectOption('us-notifications');
  assert.ok(await page.getByRole('heading',{name:'This device',exact:true}).isVisible());
  assert.equal(await page.evaluate(function(){var el=document.querySelector('#settings-shell-content');return el.scrollWidth<=el.clientWidth;}),true);
  await page.locator('#settings-shell-close').focus();await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(function(){return document.querySelector('#settings-shell').contains(document.activeElement);}),true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#settings-shell.hidden').count(),1);
  assert.equal(await page.locator('#user-account-trigger').evaluate(function(el){return document.activeElement===el;}),true);
  assert.deepEqual(errors,[]);
});

test('local appearance survives a new handler and preserves saved state after invalid writes', async function(t){
  var fs=require('node:fs');var os=require('node:os');var http=require('node:http');
  var dir=fs.mkdtempSync(path.join(os.tmpdir(),'clay-appearance-'));
  t.after(function(){fs.rmSync(dir,{recursive:true,force:true});});
  var attach=require('../lib/server-appearance-settings').attachAppearanceSettings;
  var ctx={CONFIG_DIR:dir,users:{isMultiUser:function(){return false;}},isRequestAuthed:function(req){return req.headers.authorization==='fixture';}};
  var route=attach(ctx);var server=http.createServer(function(req,res){route.handleRequest(req,res,req.url);});
  t.after(function(){server.close();});
  await new Promise(function(resolve){server.listen(0,'127.0.0.1',resolve);});
  var url='http://127.0.0.1:'+server.address().port+'/api/user/appearance';
  var headers={Authorization:'fixture','X-Clay-Settings':'1','Content-Type':'application/json'};
  assert.equal((await fetch(url,{method:'PUT',headers:headers,body:JSON.stringify({theme:'clay-light',mode:'light'})})).status,200);
  route=attach(ctx);
  assert.deepEqual(await (await fetch(url,{headers:headers})).json(),{theme:'clay-light',mode:'light',configured:true});
  assert.equal(fs.statSync(path.join(dir,'appearance-preferences.json')).mode & 0o777,0o600);
  assert.equal((await fetch(url,{method:'PUT',headers:headers,body:'invalid'})).status,400);
  assert.equal((await (await fetch(url,{headers:headers})).json()).theme,'clay-light');
});

test('personal Linear collection retains failed drafts and keeps row actions scoped', {timeout:25000}, async function(t) {
  var f=await fixture(t), browser=await chromium.launch({headless:true});t.after(function(){return browser.close();});
  var page=await browser.newPage(), entries=[{id:'default',name:'Existing connection',connected:true,legacy:true,workspace:{name:'Work'}}], fail=false, writes=[];
  page.setDefaultTimeout(3500);
  await page.route('**/api/linear/connections**',function(route){
    var request=route.request(), id=request.url().split('/').pop();
    if(request.method()==='GET')return route.fulfill({json:{connections:entries}});
    writes.push({id:id,method:request.method()});
    if(fail)return route.fulfill({status:500,json:{error:'Storage unavailable'}});
    var body=request.postDataJSON();
    entries=entries.filter(function(entry){return entry.id!==id;});
    if(request.method()==='PUT')entries.push({id:id,name:body.name,connected:true,workspace:{name:'Personal workspace'}});
    return route.fulfill({json:{connected:request.method()==='PUT',workspace:{name:'Personal workspace'}}});
  });
  await page.routeWebSocket('**', function (socket) {
    var server=socket.connectToServer();
    server.onMessage(function (message) {
      var data=JSON.parse(String(message));
      if(data.type==='email_accounts_list')data.accounts=[{id:'mail-test',email:'alex@example.com',provider:'gmail',label:'Work'}];
      socket.send(JSON.stringify(data));
    });
  });
  await page.goto(f.url+'/__fixture/admin', { waitUntil: 'domcontentloaded' });await openSettings(page,'us-integrations');
  await page.getByRole('button',{name:'Manage alex@example.com',exact:true}).click();
  assert.ok(await page.locator('.us-email-manage').isVisible());
  assert.equal(await page.locator('.us-integration-email-row .us-integration-state').textContent(),'Account saved');
  await page.getByRole('button',{name:'Manage alex@example.com',exact:true}).click();
  await page.getByRole('button',{name:'Manage Existing connection',exact:true}).click();
  assert.equal(await page.locator('#us-linear-key').inputValue(),'');
  await page.locator('#us-linear-cancel').click();
  await page.locator('#us-linear-add').click();await page.locator('#us-linear-name').fill('Personal');await page.locator('#us-linear-key').fill('test-only-key');
  fail=true;await page.locator('#us-linear-editor [type=submit]').click();await page.getByText('Storage unavailable',{exact:true}).waitFor();
  assert.equal(await page.locator('#us-linear-key').inputValue(),'test-only-key');
  await page.locator('#settings-page-nav [data-section="us-account"]').click();await page.getByRole('button',{name:'Keep draft and leave',exact:true}).click();
  await page.locator('#settings-page-nav [data-section="us-integrations"]').click();assert.equal(await page.locator('#us-linear-name').inputValue(),'Personal');
  fail=false;await page.locator('#us-linear-editor [type=submit]').click();await page.getByText('Connection saved.',{exact:true}).waitFor();
  assert.equal(writes[0].id,writes[1].id);
  assert.equal(await page.locator('#us-linear-key').inputValue(),'');
  await page.reload();await openSettings(page,'us-integrations');
  await page.getByRole('button',{name:'Manage Personal',exact:true}).click();
  await page.locator('#us-linear-remove').click();await page.locator('#settings-confirm').getByRole('button',{name:'Disconnect',exact:true}).click();
  await page.getByText('Connection removed.',{exact:true}).waitFor();
  assert.equal(entries.length,1);assert.equal(entries[0].id,'default');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#us-linear-add').click();
  assert.ok(await page.locator('#us-linear-name').isVisible());
  assert.ok(await page.locator('#us-linear-key').isVisible());
  var bounds=await page.locator('#us-linear-editor').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=390);
});
