var test = require('node:test');
var assert = require('node:assert/strict');
var child = require('node:child_process');
var path = require('node:path');
var pw = require('playwright');

test('production Mate settings preserve drafts and acknowledge prompt/model saves', async function (t) {
  var port = 35000 + process.pid % 10000;
  var server = child.spawn(process.execPath, [path.join(__dirname,'fixtures/session-folders-dom/serve.js'), String(port)], {stdio:['ignore','pipe','pipe']});
  var browser; t.after(async function () { if (browser) await browser.close(); server.kill(); });
  await new Promise(function (resolve, reject) { server.stdout.once('data',resolve); server.once('error',reject); });
  browser = await pw.chromium.launch();
  var page = await browser.newPage({viewport:{width:1280,height:900}, reducedMotion:'reduce'});
  var errors = []; page.on('pageerror',function (e) { errors.push(e.message); });
  await page.goto('http://127.0.0.1:' + port + '/mate-settings.html');
  await page.waitForFunction(function () { return window.__ready; });
  var dialog = page.getByRole('dialog', {name:'Mate settings'});
  var prompt = page.getByRole('textbox', {name:'Mate prompt'});
  assert.equal(await prompt.count(), 0);
  await page.waitForFunction(function () { return Array.from(document.querySelectorAll('.mate-settings-profile-avatar img')).every(function (img) { return img.complete && img.naturalWidth > 0; }); });
  assert.equal(await page.getByRole('button',{name:'Model: Luna',exact:true}).count(), 0);
  assert.equal(await page.getByRole('button',{name:'Upload image',exact:true}).count(), 0);
  await t.test('identity is readable until Edit, with cancel, retained drafts and acknowledged save', async function () {
    assert.equal(await page.getByRole('textbox',{name:'Name',exact:true}).count(),0);
    assert.equal(await page.getByText('A thoughtful partner for product design.',{exact:true}).isVisible(),true);
    await page.getByRole('button',{name:'Edit Mate identity'}).click();
    await page.getByRole('textbox',{name:'Name',exact:true}).fill('Ari revised');
    await page.getByRole('textbox',{name:'Introduction',exact:true}).fill('A concise design partner.');
    await dialog.getByRole('button',{name:'Prompt',exact:true}).click();
    await dialog.getByRole('button',{name:'General',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Name',exact:true}).inputValue(),'Ari revised');
    await dialog.getByRole('button',{name:'Close Mate settings'}).click();
    await page.locator('#confirm-cancel').click();
    await page.evaluate(function () { window.__fail = 'Identity save failed.'; });
    await page.getByRole('button',{name:'Save identity'}).click();
    await page.getByRole('alert').filter({hasText:'Identity save failed.'}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Name',exact:true}).inputValue(),'Ari revised');
    await page.evaluate(function () { window.__fail = ''; });
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Name',exact:true}).count(),0);
    await page.getByRole('button',{name:'Edit Mate identity'}).click();
    await page.getByRole('textbox',{name:'Introduction',exact:true}).fill('A concise design partner.');
    await page.getByRole('button',{name:'Save identity'}).click();
    await page.getByText('A concise design partner.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Name',exact:true}).count(),0);
    var saved = await page.evaluate(function () { return window.__sent.filter(function (m) { return m.type === 'mate_update'; }).pop(); });
    assert.equal(saved.updates.profile.avatarStyle,'bottts');
    assert.equal(saved.updates.profile.displayName,'Ari');
    assert.equal(saved.updates.bio,'A concise design partner.');
  });
  await dialog.getByRole('button',{name:'Prompt',exact:true}).click();
  await prompt.waitFor();
  var original = await prompt.inputValue();
  await t.test('Prompt shows actual instructions and retains a draft across pages', async function () {
    assert.match(original, /thoughtful design partner/);
    await prompt.fill(original + '\nAsk before changing direction.');
    await dialog.getByRole('button',{name:'Model',exact:true}).click();
    await page.getByRole('button',{name:'Model: Luna',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Prompt',exact:true}).click();
    assert.match(await prompt.inputValue(), /Ask before changing direction/);
    await dialog.getByRole('button',{name:'Close Mate settings'}).click();
    assert.equal(await page.locator('#confirm-modal').isVisible(), true);
    await page.locator('#confirm-cancel').click();
    assert.equal(await dialog.isVisible(), true);
    await page.getByRole('button',{name:'Save prompt',exact:true}).click();
    await page.getByText('Prompt saved. New conversations use these instructions.').waitFor();
    assert.equal(await page.getByRole('button',{name:'Save prompt',exact:true}).count(), 0);
  });
  await t.test('prompt save failure, conflict, offline and stale response retain intent', async function () {
    await prompt.fill(original + '\nA revised draft remains visible until acknowledged.');
    await page.evaluate(function () { window.__fail = 'Disk is read-only.'; });
    await page.getByRole('button',{name:'Save prompt',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Disk is read-only.'}).waitFor();
    assert.match(await prompt.inputValue(), /revised draft/);
    await page.evaluate(function () { window.__fail = 'Changed elsewhere.'; });
    await page.getByRole('button',{name:'Save prompt',exact:true}).click();
    await page.getByRole('button',{name:'Reload saved prompt'}).waitFor();
    assert.match(await prompt.inputValue(), /revised draft/);
    await page.evaluate(function () { window.__fail = ''; });
    await page.getByRole('button',{name:'Reload saved prompt'}).click();
    await page.waitForFunction(function () { return !document.querySelector('.mate-instructions-input').disabled; });
    assert.match(await prompt.inputValue(), /Ask before changing direction/);
    await page.evaluate(function () { window.__instructions({mateId:'mate_preview',requestId:'stale',ok:true,content:'wrong'}); window.__offline(true); });
    await prompt.fill(original + '\nOffline changes remain in the editor.');
    await page.getByRole('button',{name:'Save prompt',exact:true}).click();
    await page.getByText('Clay is offline. Reconnect and try again.',{exact:true}).waitFor();
    assert.match(await prompt.inputValue(), /Offline changes/);
    await page.evaluate(function () { window.__offline(false); });
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
  });
  await t.test('compact model draft, keyboard picker, failure retry and acknowledged save', async function () {
    await dialog.getByRole('button',{name:'Model',exact:true}).click();
    await page.getByRole('button',{name:'Provider: Codex',exact:true}).click();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true);
    await page.getByRole('button',{name:'Provider: Codex',exact:true}).click();
    await page.getByRole('option',{name:'Claude Code',exact:true}).click();
    await page.getByRole('button',{name:'Model: Choose a model',exact:true}).waitFor();
    await page.getByRole('button',{name:'Model: Choose a model',exact:true}).click();
    await page.getByRole('option',{name:'Sol',exact:true}).click();
    assert.equal(await page.evaluate(function () { return window.__sent.filter(function (m) { return m.type === 'home_mate_model_set'; }).length; }), 0);
    await dialog.getByRole('button',{name:'Prompt',exact:true}).click();
    await dialog.getByRole('button',{name:'Model',exact:true}).click();
    assert.equal(await page.locator('#mate-settings-model').inputValue(), 'sol');
    await page.evaluate(function () { window.__fail = 'Model save failed.'; });
    await page.getByRole('button',{name:'Save model',exact:true}).click();
    await page.getByText('Model save failed.',{exact:true}).waitFor();
    assert.equal(await page.locator('#mate-settings-model').inputValue(), 'sol');
    await page.evaluate(function () { window.__fail = ''; });
    await page.getByRole('button',{name:'Save model',exact:true}).click();
    await page.getByText('Model saved.',{exact:true}).waitFor();
    var saved = await page.evaluate(function () { return window.__sent.filter(function (m) { return m.type === 'home_mate_model_set'; }).pop(); });
    assert.equal(saved.vendor,'claude'); assert.equal(saved.model,'sol'); assert.equal(saved.sessionId,1);
  });
  await t.test('appearance controls and focus return remain available', async function () {
    await dialog.getByRole('button',{name:'General',exact:true}).click();
    await page.getByRole('button',{name:'Change Mate avatar'}).click();
    assert.equal(await page.getByRole('button',{name:'Upload image',exact:true}).isVisible(), true);
    await page.getByRole('button',{name:'Pixel avatar',exact:true}).click();
    await page.getByText('Avatar saved.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Upload image',exact:true}).count(),0);
    await dialog.getByRole('button',{name:'Close Mate settings'}).click();
    assert.equal(await page.getByRole('button',{name:'Actions for Ari'}).evaluate(function (el) { return el === document.activeElement; }), true);
    await page.getByRole('button',{name:'Actions for Ari'}).click();
    await page.getByRole('menuitem',{name:'Mate settings'}).click();
    await dialog.getByRole('button',{name:'Model',exact:true}).click();
    await page.getByRole('button',{name:'Model: Sol',exact:true}).waitFor();
  });
  await t.test('light/dark and narrow settings fit, with reachable model controls', async function () {
    for (var theme of ['light','dark']) {
      for (var width of [1280,390]) {
        await page.setViewportSize({width:width,height:width === 1280 ? 720 : 900});
        await page.evaluate(function (theme) { document.documentElement.classList.toggle('light-theme',theme === 'light'); }, theme);
        for (var section of ['General','Model','Prompt']) {
          await dialog.getByRole('button',{name:section,exact:true}).click();
          var fits = await dialog.evaluate(function (el) { var r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && el.scrollWidth <= el.clientWidth + 1; });
          assert.equal(fits,true);
          if (section === 'Prompt') {
            var geometry = await prompt.evaluate(function (el) {
              var r = el.getBoundingClientRect(); var body = el.closest('.home-mate-settings-body').getBoundingClientRect();
              return {height:r.height, available:body.height, bottomGap:body.bottom-r.bottom};
            });
            assert.ok(geometry.height > geometry.available * .7);
            assert.ok(geometry.bottomGap <= 28);
          }
          if (section === 'Model') {
            if (width === 1280) assert.equal(await dialog.locator('.home-mate-settings-content').evaluate(function (el) { return el.scrollHeight <= el.clientHeight + 1; }),true);
            await page.getByRole('button',{name:/^Model: /}).scrollIntoViewIfNeeded();
            assert.equal(await page.getByRole('button',{name:/^Model: /}).isVisible(), true);
            await dialog.locator('.home-mate-settings-content').evaluate(function (el) { el.scrollTop = 0; });
          }
          await page.screenshot({path:'/tmp/mate-settings-' + section.toLowerCase() + '-' + theme + '-' + width + '.png'});
        }
      }
    }
  });
  await t.test('permanent deletion requires exact typed acknowledgement and cancels safely', async function () {
    await dialog.getByRole('button',{name:'General',exact:true}).click();
    var remove = page.getByRole('button',{name:'Delete Mate',exact:true});
    await remove.click();
    var confirmation = page.getByRole('alertdialog');
    var input = page.getByRole('textbox',{name:'Type understand to confirm permanent deletion'});
    var confirm = page.getByRole('button',{name:'Delete permanently',exact:true});
    assert.equal(await confirm.isDisabled(),true);
    assert.match(await confirmation.innerText(),/cannot be undone/);
    await input.fill('UNDERSTAND'); assert.equal(await confirm.isDisabled(),true);
    await input.fill('understand '); assert.equal(await confirm.isDisabled(),true);
    await page.keyboard.press('Escape');
    assert.equal(await confirmation.count(),0);
    assert.equal(await remove.evaluate(function (el) { return el === document.activeElement; }),true);
    assert.equal(await page.evaluate(function () { return window.__sent.filter(function (m) { return m.type === 'mate_delete'; }).length; }),0);
    await remove.click(); await input.fill('understand');
    assert.equal(await confirm.isEnabled(),true);
    await page.locator('#confirm-cancel').click();
    await remove.click(); assert.equal(await input.inputValue(),''); assert.equal(await confirm.isDisabled(),true);
    await input.fill('understand');
    await page.screenshot({path:'/tmp/mate-delete-confirm-narrow-dark.png'});
    await confirm.click();
    assert.equal(await page.evaluate(function () { return window.__sent.filter(function (m) { return m.type === 'mate_delete'; }).length; }),1);
    assert.equal(await dialog.count(),0);
    assert.equal(await page.locator('.mate-delete-challenge').count(),0);
    assert.equal(await page.locator('#confirm-ok').isDisabled(),false);
  });
  assert.deepEqual(errors,[]);
});
