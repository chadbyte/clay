var test = require('node:test'), assert = require('node:assert/strict');
var path = require('node:path'), fork = require('node:child_process').fork, chromium = require('playwright').chromium;
async function fixture(t, built) {
  var child = fork(path.join(__dirname,'fixtures/server-settings-server.js'), ['--integration-editors'].concat(built ? ['--built-settings'] : []), {stdio:['ignore','ignore','pipe','ipc']});
  var stderr = ''; child.stderr.on('data',function (data) { stderr += data; });
  t.after(function () { child.kill('SIGTERM'); });
  var url = await new Promise(function (resolve,reject) {
    child.once('error',reject);child.once('exit',function (code) {reject(new Error('Fixture exit '+code+' '+stderr.slice(-1500)));});
    child.on('message',function (msg) { if (msg.port) resolve('http://127.0.0.1:'+msg.port); });
  });
  var browser = await chromium.launch({headless:true}); t.after(function () { return browser.close(); });
  var page = await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'}); page.setDefaultTimeout(10000);
  var errors = [], messages = [];page.on('pageerror',function (error) {errors.push(error.message);});
  page.on('websocket',function (ws) {ws.on('framesent',function (frame) {try {messages.push(JSON.parse(frame.payload));} catch (error) {}});});
  t.after(function () {assert.deepEqual(errors,[]);});
  await page.goto(url+'/__fixture/admin'); await page.locator('#server-settings-btn').click();
  await page.locator('#settings-page-nav [data-section=us-integrations]').click();await page.locator('#us-github-add').waitFor();
  await page.request.put(url+'/api/linear/connections/fixture-one',{data:{name:'Saved Linear',key:'synthetic-linear-key'}});
  // Reload collection through the normal page lifecycle.
  await page.locator('#settings-page-select').selectOption('us-account',{force:true});await page.locator('#settings-page-select').selectOption('us-integrations',{force:true});
  await page.getByRole('button',{name:'Manage Saved Linear',exact:true}).waitFor();
  return {page:page,messages:messages,url:url,set:function (query) {return page.request.get(url+'/__fixture/integrations?'+query);},github:function (query) {return page.request.get(url+'/__fixture/github?'+query);}};
}
async function one(page, selector) {
  await page.locator(selector).waitFor({state:'visible'});
  var visible = await page.locator('#us-github-editor:visible, #us-linear-editor:visible, #email-setup-modal:visible, .us-email-manage:visible').count();
  assert.equal(visible,1,'Only the selected integration editor is visible');
  assert.equal(await page.locator(selector).evaluate(function (el) {return el.contains(document.activeElement);}),true,'Focus enters selected editor');
}
async function discard(page) {await page.locator('#settings-confirm [data-confirm]').click();}
[false,true].forEach(function (built) {
  test('Personal integration single editor '+(built?'built':'source')+' clean switches, Manage, keyboard, dirty and pending recovery',{timeout:90000},async function (t) {
    var f = await fixture(t,built), page = f.page;
    var choices = [
      ['#us-github-add','#us-github-editor'], ['#us-linear-add','#us-linear-editor'],
      ['[data-email-provider=gmail]','#email-setup-modal'], ['[data-email-provider=outlook]','#email-setup-modal'],
      ['[data-email-provider=yahoo]','#email-setup-modal'], ['[data-email-provider=custom]','#email-setup-modal'],
      ['[aria-label="Manage saved@example.invalid"]','.us-email-manage'], ['[aria-label="Manage Saved Linear"]','#us-linear-editor']
    ];
    // All ordered pairs include Add/Manage and email provider A/B in both directions.
    for (var a = 0; a < choices.length; a++) {
      for (var b = 0; b < choices.length; b++) {
        await page.locator(choices[a][0]).click();await one(page,choices[a][1]);
        await page.locator(choices[b][0]).click();await one(page,choices[b][1]);
        assert.equal(await page.locator('#settings-confirm').count(),0);
      }
    }
    // Saved GitHub Manage shares the same switching contract as its Add tile.
    await page.locator('#us-github-add').click();
    await page.locator('#us-github-editor').getByRole('button',{name:'Connect octo-fixture',exact:true}).click();
    await page.locator('#us-github-connections .us-voice-row-controls > button').waitFor();
    for (var c = 1; c < choices.length; c++) {
      await page.locator('#us-github-connections .us-voice-row-controls > button').click();await one(page,'#us-github-editor');
      await page.locator(choices[c][0]).click();await one(page,choices[c][1]);
      await page.locator('#us-github-connections .us-voice-row-controls > button').click();await one(page,'#us-github-editor');
    }
    await page.locator('#us-github-editor').getByRole('button',{name:'Disconnect',exact:true}).click();await discard(page);
    await page.locator('#us-github-add').waitFor();
    assert.equal(await page.locator('#us-email-list .us-integration-email-row').count(),1);
    assert.equal(await page.locator('#us-linear-connections [data-connection-id]').count(),1);
    await page.locator('#us-linear-add').click();await page.locator('#us-linear-name').fill('Private draft');await page.locator('#us-linear-key').fill('synthetic-secret');
    await page.locator('#us-linear-add').click();assert.equal(await page.locator('#settings-confirm').count(),0);assert.equal(await page.locator('#us-linear-key').inputValue(),'synthetic-secret');
    await page.locator('#us-github-add').click();assert.equal(await page.locator('#settings-confirm').count(),1);await page.keyboard.press('Escape');
    await one(page,'#us-linear-editor');assert.equal(await page.locator('#us-linear-key').inputValue(),'synthetic-secret');
    await page.locator('#us-github-add').click();await discard(page);await one(page,'#us-github-editor');assert.equal(await page.locator('#us-linear-key').inputValue(),'');
    // Keyboard activation follows the same path and moves focus.
    await page.locator('[data-email-provider=gmail]').focus();await page.keyboard.press('Enter');await one(page,'#email-setup-modal');
    await page.locator('#email-setup-address').fill('draft@example.invalid');await page.locator('#email-setup-password').fill('synthetic-password');
    await page.locator('[data-email-provider=outlook]').click();await page.locator('#settings-confirm [data-cancel]').click();await one(page,'#email-setup-modal');
    assert.equal(await page.locator('#email-setup-provider').inputValue(),'gmail');assert.equal(await page.locator('#email-setup-password').inputValue(),'synthetic-password');
    await page.locator('[data-email-provider=outlook]').click();await discard(page);await one(page,'#email-setup-modal');
    assert.equal(await page.locator('#email-setup-provider').inputValue(),'outlook');assert.equal(await page.locator('#email-setup-password').inputValue(),'');assert.equal(await page.locator('#email-setup-address').inputValue(),'');
    await page.locator('#email-setup-address').fill('failed@example.invalid');await page.locator('#email-setup-password').fill('synthetic-password');
    await f.set('delay=true&failEmailSave=true');await page.locator('#email-setup-save').click();
    await page.locator('#us-github-add').click();await one(page,'#email-setup-modal');assert.equal(await page.locator('#settings-confirm').count(),0);
    await page.locator('#settings-page-select').selectOption('us-account',{force:true});assert.equal(await page.locator('#email-setup-modal').isVisible(),true);
    await f.set('release=true');await page.locator('#email-setup-status').filter({hasText:'storage failure'}).waitFor();
    assert.equal(await page.locator('#email-setup-password').inputValue(),'synthetic-password');
    await page.locator('#us-linear-add').click();await discard(page);await one(page,'#us-linear-editor');assert.equal(await page.locator('#email-setup-modal').count(),0);
    await page.locator('#us-linear-name').fill('Failed Linear draft');await page.locator('#us-linear-key').fill('synthetic-key');
    await f.set('delay=true&failLinear=true');await page.locator('#us-linear-editor [type=submit]').click();
    // Programmatic activation proves the guard also applies beyond disabled buttons.
    await page.locator('#us-github-add').dispatchEvent('click');await one(page,'#us-linear-editor');
    await f.set('release=true');await page.locator('#us-linear-collection-status').filter({hasText:'Could not update'}).waitFor();
    assert.equal(await page.locator('#us-linear-name').inputValue(),'Failed Linear draft');
    await page.locator('[aria-label="Manage saved@example.invalid"]').click();await page.locator('#settings-confirm [data-cancel]').click();await one(page,'#us-linear-editor');
    await page.locator('[aria-label="Manage saved@example.invalid"]').click();await discard(page);await one(page,'.us-email-manage');
    await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});
    await page.locator('[data-email-provider=custom]').click();await one(page,'#email-setup-modal');
    assert.ok(await page.locator('#settings-shell-content').evaluate(function (el) {return el.scrollWidth-el.clientWidth <= 1;}));
    await page.locator('#email-setup-cancel').click();assert.equal(await page.locator('#email-setup-modal').count(),0);
    assert.equal(await page.locator('[data-email-provider=custom]').evaluate(function (el) {return el===document.activeElement;}),true);
    await page.locator('#settings-page-select').selectOption('us-account',{force:true});await page.locator('#settings-page-select').selectOption('us-integrations',{force:true});
    await page.locator('#us-linear-add').click();await page.locator('#us-linear-name').fill('Retain across pages');
    await page.locator('#settings-page-select').selectOption('us-account',{force:true});await discard(page);await page.locator('#settings-page-select').selectOption('us-integrations',{force:true});
    await page.locator('#us-linear-editor').waitFor();assert.equal(await page.locator('#us-github-editor').isVisible(),false);assert.equal(await page.locator('#us-linear-name').inputValue(),'Retain across pages');
    await page.locator('[data-email-provider=gmail]').click();await discard(page);await one(page,'#email-setup-modal');
    await page.locator('#email-setup-address').fill('retry@example.invalid');await page.locator('#email-setup-password').fill('synthetic-retry-password');
    await f.set('failEmailSave=false');await page.locator('#email-setup-save').click();
    await page.getByRole('button',{name:'Manage retry@example.invalid',exact:true}).waitFor();assert.equal(await page.locator('#email-setup-modal').count(),0);
    await page.locator('[data-email-provider=yahoo]').click();await one(page,'#email-setup-modal');
    assert.equal(await page.locator('#email-setup-address').inputValue(),'');
    assert.equal(f.messages.filter(function (m) {return m.type==='email_account_test';}).length,2,'No duplicate email listeners or tests');
    assert.equal(f.messages.filter(function (m) {return m.type==='email_account_add';}).length,2);
  });
  test('GitHub active sign-in switching '+(built?'built':'source')+' waits for exact Stop acknowledgement and retains unknown closure',{timeout:60000},async function (t) {
    var f = await fixture(t,built), page = f.page;
    await f.github('state=unauthenticated');await page.locator('#us-github-add').click();
    await page.locator('#us-github-editor').getByRole('button',{name:'Refresh',exact:true}).click();
    await page.locator('#us-github-editor').getByRole('button',{name:'Sign in with browser',exact:true}).click();await page.locator('#settings-confirm [data-confirm]').click();
    await page.locator('.tui-modal-backdrop:not(.hidden)').waitFor();await f.github('holdStop=true');
    // The modal covers ordinary clicks; exact control activation exercises shared navigation while login is active.
    await page.locator('#us-linear-add').dispatchEvent('click');
    await page.locator('#us-github-status').filter({hasText:'Waiting for the GitHub login terminal to exit'}).waitFor();
    assert.equal(await page.locator('#us-linear-editor').isVisible(),false);assert.equal((await(await f.github('')).json()).terminals,1);
    await f.github('finish=true&holdStop=false');await one(page,'#us-linear-editor');assert.equal((await(await f.github('')).json()).terminals,0);
    await page.locator('#us-github-add').click();await one(page,'#us-github-editor');
    await page.locator('#us-github-editor').getByRole('button',{name:'Sign in with browser',exact:true}).click();await page.locator('#settings-confirm [data-confirm]').click();
    await page.locator('.tui-modal-backdrop:not(.hidden)').waitFor();await f.github('holdStop=true');await page.locator('[data-email-provider=gmail]').dispatchEvent('click');
    await page.locator('#us-github-status').filter({hasText:'shutdown could not be confirmed'}).waitFor();
    assert.equal(await page.locator('#us-github-editor').isVisible(),true);assert.equal(await page.locator('#email-setup-modal').count(),0);
    assert.equal((await(await f.github('')).json()).terminals,1);
    assert.equal(f.messages.filter(function (m) {return m.type==='personal_github_login';}).length,2,'No automatic login replay');
    await f.github('finish=true&holdStop=false');
  });
});
