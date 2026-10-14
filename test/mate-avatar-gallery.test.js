var test = require('node:test');
var assert = require('node:assert/strict');
var child = require('node:child_process');
var path = require('node:path');
var pw = require('playwright');

test('production gallery renders every asset, persists, cancels and recovers with keyboard/mobile support', async function(t){
  var server=child.spawn(process.execPath,[path.join(__dirname,'fixtures/mate-avatar-catalog-server.cjs'),'0'],{stdio:['ignore','pipe','pipe']});
  var browser; t.after(async function(){if(browser)await browser.close();server.kill('SIGTERM');});
  var url=await new Promise(function(resolve,reject){server.stdout.once('data',function(data){resolve(String(data).match(/http:\/\/127\.0\.0\.1:\d+/)[0]);});server.once('error',reject);});
  browser=await pw.chromium.launch();var page=await browser.newPage({viewport:{width:1280,height:800}});
  var errors=[];page.on('pageerror',function(e){errors.push(e.message);});
  await page.goto(url+'/mate-settings.html');await page.waitForFunction(function(){return window.__ready;});
  await page.locator('#mate-profile-avatar').click();
  assert.equal(await page.locator('.home-mate-avatar-choice').count(),96);
  await page.waitForFunction(function(){return Array.from(document.querySelectorAll('.home-mate-avatar-choice img')).every(function(img){return img.complete && img.naturalWidth===192 && img.naturalHeight===192;});});
  assert.equal(await page.getByRole('button',{name:/Shuffle/}).count(),0);
  var initial=await (await page.request.get(url+'/fixture/mate')).json();assert.match(initial.profile.avatarCatalogId,/^[BC]\d{2}$/);
  await page.locator('#mate-avatar-B01').click();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#mate-avatar-B02').evaluate(function(el){return el===document.activeElement;}),true);
  await page.keyboard.press('Enter');assert.equal(await page.locator('#mate-avatar-B02').getAttribute('aria-pressed'),'true');
  await page.locator('#mate-avatar-cancel').click();assert.equal(await page.locator('.home-mate-avatar-choice').count(),0);
  assert.equal(await page.locator('#mate-profile-avatar').evaluate(function(el){return el===document.activeElement;}),true);
  var cancelled=await (await page.request.get(url+'/fixture/mate')).json();assert.deepEqual(cancelled.profile,initial.profile);
  await page.locator('#mate-profile-avatar').click();await page.locator('#mate-avatar-C48').click();
  await page.locator('#mate-avatar-save').click();await page.getByRole('status').filter({hasText:'Avatar saved.'}).waitFor();
  await page.reload();await page.waitForFunction(function(){return window.__ready;});await page.locator('#mate-profile-avatar').click();
  assert.equal(await page.locator('#mate-avatar-C48').getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Fixture invalid save',exact:true}).click();await page.locator('#mate-avatar-B01').click();await page.locator('#mate-avatar-save').click();
  await page.getByRole('alert').filter({hasText:'Choose an avatar from the Clay catalog.'}).waitFor();
  assert.equal(await page.locator('#mate-avatar-B01').getAttribute('aria-pressed'),'true');
  var failed=await (await page.request.get(url+'/fixture/mate')).json();assert.equal(failed.profile.avatarCatalogId,'C48');
  await page.getByRole('button',{name:'Fixture invalid save',exact:true}).click();await page.getByRole('button',{name:'Fixture offline',exact:true}).click();
  await page.locator('#mate-avatar-save').click();await page.getByRole('alert').filter({hasText:'Clay is offline.'}).waitFor();
  await page.getByRole('button',{name:'Fixture offline',exact:true}).click();await page.locator('#mate-avatar-save').click();await page.getByRole('status').filter({hasText:'Avatar saved.'}).waitFor();
  await page.locator('#mate-avatar-C13').click();await page.getByRole('button',{name:'Close Mate settings',exact:true}).click();
  await page.locator('#confirm-cancel').click();assert.equal(await page.locator('#mate-avatar-C13').getAttribute('aria-pressed'),'true');
  for(var width of [1280,390]){
    await page.setViewportSize({width:width,height:844});
    for(var theme of ['light','dark']){
      await page.evaluate(function(theme){document.documentElement.classList.toggle('light-theme',theme==='light');},theme);
      assert.equal(await page.getByRole('dialog',{name:'Mate settings'}).evaluate(function(el){var rect=el.getBoundingClientRect();return rect.left>=0 && rect.right<=innerWidth+1 && rect.bottom<=innerHeight+1 && el.scrollWidth<=el.clientWidth+1;}),true);
      await page.locator('#mate-avatar-C48').click();await page.locator('#mate-avatar-save').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#mate-avatar-save').isVisible(),true);
    }
  }
  await page.locator('#mate-avatar-cancel').click();assert.equal(errors.length,0,errors.join('\n'));
});
