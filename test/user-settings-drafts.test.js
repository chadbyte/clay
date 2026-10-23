var test = require('node:test');
var assert = require('node:assert/strict');
var fork = require('node:child_process').fork;
var path = require('node:path');
var chromium = require('playwright').chromium;

async function fixture(t, args) {
  var child = fork(path.join(__dirname, 'fixtures/server-settings-server.js'), ['--personal-drafts'].concat(args || []), {stdio:['ignore','ignore','pipe','ipc']});
  t.after(function () {child.kill('SIGTERM');});
  var url = await new Promise(function (resolve, reject) {
    child.once('error', reject);
    child.on('message', function (msg) {if (msg.port) resolve('http://127.0.0.1:' + msg.port);});
  });
  var browser = await chromium.launch({headless:true});
  t.after(function () {return browser.close();});
  var page = await browser.newPage({viewport:{width:1280,height:800}});
  page.setDefaultTimeout(6000);
  var errors = [];
  page.on('pageerror', function (error) {errors.push(error.message);});
  t.after(function () {assert.deepEqual(errors, []);});
  // Readiness is the authenticated store below, rather than unrelated image/font loads.
  await page.goto(url + '/__fixture/admin', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(async function () {
    var state = (await import('./modules/store.js')).store.snap();
    var frame = document.querySelector('#split-host .split-pane:not(.split-pane-cached) iframe');
    var live = frame && frame.clayPane && frame.clayPane.identity();
    return state.connected && state.myUserId && live && live.ready && live.ownerId === state.myUserId &&
      live.projectSlug === state.currentSlug && live.sessionId === state.activeSessionId &&
      frame.clayPane.source === frame.contentWindow && frame.clayPane.document === frame.contentDocument;
  });
  // Let the bound pane's initial focus settle before opening the account menu.
  await page.evaluate(function () {return new Promise(function (resolve) {requestAnimationFrame(function () {requestAnimationFrame(resolve);});});});
  return {page:page,url:url};
}
async function open(page) {
  for (var attempt=0;attempt<3;attempt++) {
    if (await page.locator('#user-account-trigger').getAttribute('aria-expanded') !== 'true') await page.locator('#user-account-trigger').click();
    try { await page.locator('.account-settings-button').click({timeout:1500}); break; }
    catch (error) { if (attempt === 2) throw error; }
  }
  await page.locator('#us-account-name').filter({hasText:'Alex Fixture'}).waitFor({state:'attached'});
}
async function tab(page, name) {await page.locator('#settings-page-nav [data-section="us-' + name + '"]').click();}
async function noDialog(page) {assert.equal(await page.locator('#settings-confirm').count(), 0);}
async function close(page) {
  await page.locator('#settings-shell-close').click();
  await page.locator('#settings-shell.hidden').waitFor({state:'attached'});
  await noDialog(page);
}
async function discardName(page) {
  await page.locator('.us-profile-form [data-cancel]').click();
  await page.getByRole('button', {name:'Discard',exact:true}).click();
}

test('failed appearance hydration never creates a pristine draft; all pages navigate and close', {timeout:40000}, async function (t) {
  var f = await fixture(t, ['--appearance-load-error']), page = f.page;
  await open(page);
  await page.waitForFunction(async function () {return (await import('./modules/store.js')).store.get('appearanceSaveError') === true;});
  for (var name of ['appearance','providers','notifications','ai','integrations','account']) {
    await tab(page, name); await noDialog(page);
    assert.equal(await page.locator('.us-section.active').getAttribute('data-section'), 'us-' + name);
  }
  await close(page);
  await open(page); await close(page);
});

test('profile and PIN editors distinguish pristine, reverted, failed and acknowledged drafts', {timeout:40000}, async function (t) {
  var f = await fixture(t), page = f.page;
  await open(page);
  await page.locator('#us-profile-edit').click();
  await page.locator('.us-profile-form [data-cancel]').click(); await noDialog(page);
  await page.locator('#us-pin-set-btn').click();
  await page.locator('#us-pin-cancel').click(); await noDialog(page);
  await page.locator('#us-pin-set-btn').click();
  await page.locator('#us-pin-input').fill('123');
  await page.locator('#settings-shell-close').click();
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await page.locator('#us-pin-input').fill('');
  await page.locator('#us-pin-cancel').click(); await noDialog(page);
  await page.locator('#us-profile-edit').click();
  await page.locator('#us-profile-name').fill('Changed');
  await page.locator('#us-profile-name').fill('Alex Fixture');
  await page.locator('.us-profile-form [data-cancel]').click(); await noDialog(page);
  await page.locator('#us-profile-edit').click();
  await page.locator('#us-profile-name').fill('Retained draft');
  await tab(page, 'account'); await noDialog(page);
  await tab(page, 'appearance');
  await page.getByRole('button', {name:'Keep editing',exact:true}).click();
  assert.equal(await page.locator('.us-section.active').getAttribute('data-section'), 'us-account');
  await tab(page, 'appearance');
  await page.getByRole('button', {name:'Keep draft and leave',exact:true}).click();
  await tab(page, 'notifications'); await noDialog(page);
  await tab(page, 'account'); await noDialog(page);
  assert.equal(await page.locator('#us-profile-name').inputValue(), 'Retained draft');
  await fetch(f.url + '/__fixture/profile-save-error');
  await page.locator('.us-profile-form [type=submit]').click();
  await page.locator('.us-profile-form [role=status]').filter({hasText:'Fixture storage unavailable'}).waitFor();
  await page.locator('#settings-shell-close').click();
  await page.getByRole('button', {name:'Keep draft and leave',exact:true}).click();
  await open(page);
  assert.equal(await page.locator('#us-profile-name').inputValue(), 'Retained draft');
  await fetch(f.url + '/__fixture/profile-save-recover');
  await page.locator('.us-profile-form [type=submit]').click();
  await page.locator('#us-profile-edit').waitFor();
  await page.locator('#us-account-name').filter({hasText:'Retained draft'}).waitFor();
  await close(page);
});

test('delayed profile hydration preserves genuine input and refreshes pristine editor baselines', {timeout:40000}, async function (t) {
  var f = await fixture(t), page = f.page, release, received;
  var intercepted = new Promise(function (resolve) {received = resolve;});
  await open(page); await close(page);
  await page.route('**/api/profile', async function (route) {
    await new Promise(function (resolve) {release = resolve; received();});
    await route.fulfill({json:{name:'Hydrated name',username:'admin',pinEnabled:true,terminalFont:{family:'ui-monospace, monospace',size:18}}});
  });
  await page.locator('#user-account-trigger').click(); await page.locator('.account-settings-button').click();
  await page.locator('#us-profile-edit').click();
  await page.waitForFunction(function () {return document.querySelector('#us-profile-name') && !document.querySelector('.us-profile-form').hidden;});
  await intercepted; release();
  await page.locator('#us-profile-name').waitFor();
  await page.waitForFunction(function () {return document.querySelector('#us-profile-name').value === 'Hydrated name';});
  await page.locator('#us-profile-name').fill('Typing before refresh');
  await page.locator('#settings-shell-close').click(); await page.getByRole('button',{name:'Keep draft and leave',exact:true}).click();
  intercepted = new Promise(function (resolve) {received = resolve;});
  await page.locator('#user-account-trigger').click(); await page.locator('.account-settings-button').click();
  await intercepted;
  release();
  assert.equal(await page.locator('#us-profile-name').inputValue(),'Typing before refresh');
  await discardName(page); await close(page);
});

test('reverted command, terminal, mailbox and voice values leave no false drafts', {timeout:40000}, async function (t) {
  var f = await fixture(t), page = f.page;
  await open(page); await tab(page,'ai');
  var group = page.locator('.us-config-group').filter({hasText:'Personal allow rules'});
  await group.getByRole('button',{name:'Edit',exact:true}).click();
  var allow = page.locator('#us-claude-allow-list'), original = await allow.inputValue();
  await allow.fill('Bash(fixture:*)'); await allow.fill(original);
  await group.getByRole('button',{name:'Cancel',exact:true}).click(); await noDialog(page);
  await group.getByRole('button',{name:'Edit',exact:true}).click();
  await allow.fill('Bash(fixture:*)');
  await page.locator('#us-claude-allow-save').click();
  await page.locator('#us-claude-allow-list-receipt').filter({hasText:'Saved. Applies'}).waitFor({state:'attached'});
  await tab(page,'appearance'); await noDialog(page);
  var size = page.locator('#us-terminal-size'), saved = await size.inputValue();
  await size.fill('23'); await size.fill(saved);
  await tab(page,'integrations'); await noDialog(page);
  await page.locator('[data-email-provider=custom]').click();
  await page.locator('#email-setup-address').fill('draft@example.com');
  await page.locator('#email-setup-address').fill('');
  await page.locator('#email-setup-imap-port').fill('111');
  await page.locator('#email-setup-imap-port').fill('993');
  await page.locator('#email-setup-cancel').click(); await noDialog(page);
  await tab(page,'providers');
  await page.locator('[data-voice-key=openai]').click();
  await page.locator('#us-voice-key').fill('test-draft'); await page.locator('#us-voice-key').fill('');
  await page.locator('#us-voice-key-cancel').click(); await noDialog(page);
  await close(page);
});

test('failed autosaves warn and retain values until a successful retry clears the draft', {timeout:40000}, async function (t) {
  var f = await fixture(t), page = f.page, fail = true;
  await page.route('**/api/user/appearance', function (route) {
    if (route.request().method() === 'PUT' && fail) return route.fulfill({status:503,json:{error:'Fixture appearance failure'}});
    return route.continue();
  });
  await open(page); await tab(page,'appearance');
  await page.locator('#us-theme-mode').selectOption('dark',{force:true});
  await page.locator('#us-appearance-status').filter({hasText:'Could not save'}).waitFor();
  await page.locator('#settings-shell-close').click();
  await page.getByRole('button',{name:'Keep draft and leave',exact:true}).click();
  await open(page); await tab(page,'appearance');
  assert.equal(await page.locator('#us-theme-mode').inputValue(),'dark');
  fail = false;
  await page.locator('.us-section[data-section=us-appearance]').getByRole('button',{name:'Retry save',exact:true}).first().click();
  await page.locator('#us-appearance-status').filter({hasText:'Saved.'}).waitFor();
  await close(page);
  await page.route('**/api/user/terminal-font', function (route) {
    if (route.request().method() === 'PUT' && fail) return route.fulfill({status:503,json:{error:'Fixture terminal failure'}});
    return route.continue();
  });
  await open(page); await tab(page,'appearance'); fail = true;
  await page.locator('#us-terminal-size').fill('22'); await page.locator('#us-terminal-size').press('Tab');
  await page.locator('#us-terminal-retry').waitFor();
  await page.locator('#settings-shell-close').click(); await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  fail = false; await page.locator('#us-terminal-retry').click();
  await page.locator('#us-terminal-status').filter({hasText:'Saved.'}).waitFor(); await close(page);
  await page.route('**/api/user/notifications', function (route) {
    if (route.request().method() === 'PUT' && fail) return route.fulfill({status:503,json:{error:'Fixture notifications failure'}});
    return route.continue();
  });
  await open(page); await tab(page,'notifications');
  await page.locator('#personal-notification-status').filter({hasText:'Preferences saved'}).waitFor();
  fail = true; await page.locator('#settings-notif-alert').locator('..').click();
  await page.locator('#notification-save-retry').waitFor();
  await page.locator('#settings-shell-close').click(); await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  fail = false; await page.locator('#notification-save-retry').click();
  await page.locator('#personal-notification-status').filter({hasText:'Saved.'}).waitFor(); await close(page);
});

test('AI selections compare canonical values and preserve failed Apply drafts', {timeout:40000}, async function (t) {
  var f = await fixture(t), page = f.page, fail = false;
  var selection = {vendor:'codex',model:'fixture-model',effort:'medium'};
  await page.routeWebSocket('**', function (socket) {
    var server = socket.connectToServer();
    socket.onMessage(function (message) {
      var data = JSON.parse(String(message));
      if (data.type === 'default_ai_get' || data.type === 'default_ai_set') {
        var saving = data.type === 'default_ai_set';
        if (saving && !fail) selection = {vendor:data.vendor,model:data.model,effort:data.effort};
        socket.send(JSON.stringify({type:'default_ai_state',requestId:data.requestId,accountId:'admin',ready:!saving || !fail,
          installedVendors:['codex'],preference:selection,selection:selection,error:saving && fail ? 'Fixture Apply failure' : '',
          catalog:{models:[{value:'fixture-model',supportedEffortLevels:['medium','high']}]}}));
      } else server.send(message);
    });
    server.onMessage(function (message) {
      var data = JSON.parse(String(message));
      if (data.type !== 'default_ai_state' && data.type !== 'default_ai_catalog') socket.send(message);
    });
  });
  await page.reload(); await open(page); await tab(page,'ai');
  await page.locator('#account-ai-summary').click();
  var effort = page.locator('select[aria-label="Default AI reasoning effort"]');
  await effort.selectOption('high',{force:true}); await effort.selectOption('medium',{force:true});
  await page.getByRole('button',{name:'Cancel Default AI editing',exact:true}).click(); await noDialog(page);
  await page.locator('#account-ai-summary').click();
  await effort.selectOption('high',{force:true}); fail = true;
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Fixture Apply failure'}).waitFor();
  await page.locator('#settings-shell-close').click(); await page.getByRole('button',{name:'Keep draft and leave',exact:true}).click();
  await open(page); await tab(page,'ai');
  if (await page.locator('#account-ai-summary').isVisible()) await page.locator('#account-ai-summary').click();
  assert.equal(await effort.inputValue(),'high');
  fail = false; await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.locator('#account-ai-summary').waitFor(); await close(page);
});
