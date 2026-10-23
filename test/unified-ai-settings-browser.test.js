// Real settings shell and controls, isolated storage and synthetic transports.
var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var fork = require('node:child_process').fork;
var chromium = require('playwright').chromium;
var anchors = ['coding-agents', 'ai-defaults', 'execution-behavior', 'api-connections', 'experimental-features'];

async function fixture(t, built) {
  var child = fork(path.join(__dirname, 'fixtures/server-settings-server.js'), ['--providers'].concat(built ? ['--built-settings'] : []), { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var url = await new Promise(function (resolve, reject) {
    child.once('error', reject); child.on('message', function (msg) { if (msg.port) resolve('http://127.0.0.1:' + msg.port); });
  });
  var browser = await chromium.launch({ headless: true }); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(8000);
  var errors = [], messages = [], control = { failAi: false, failRules: false };
  page.on('pageerror', function (error) { errors.push(error.message); }); t.after(function () { assert.deepEqual(errors, []); });
  var selection = { vendor: 'codex', model: 'fixture-model', effort: 'medium' }, rules = [];
  await page.routeWebSocket('**', function (socket) {
    var server = socket.connectToServer();
    socket.onMessage(function (message) {
      var data = JSON.parse(String(message)); messages.push(data);
      if (data.type === 'default_ai_get' || data.type === 'default_ai_set') {
        var saving = data.type === 'default_ai_set';
        if (saving && !control.failAi) selection = { vendor: data.vendor, model: data.model, effort: data.effort };
        socket.send(JSON.stringify({ type: 'default_ai_state', requestId: data.requestId, accountId: 'admin', ready: !saving || !control.failAi,
          installedVendors: ['codex'], preference: selection, selection: selection, error: saving && control.failAi ? 'Synthetic Apply failure' : '',
          catalog: { models: [{ value: 'fixture-model', supportedEffortLevels: ['medium', 'high'] }] } }));
      } else if (data.type === 'get_claude_allow_list') socket.send(JSON.stringify({ type: 'claude_allow_list', user: rules, managed: [] }));
      else if (data.type === 'set_claude_user_allow_list') {
        if (!control.failRules) rules = data.patterns;
        socket.send(JSON.stringify({ type: 'set_claude_user_allow_list_result', ok: !control.failRules, patterns: rules, error: control.failRules ? 'Synthetic rules failure' : '' }));
      } else server.send(message);
    });
    server.onMessage(function (message) {
      var type = JSON.parse(String(message)).type;
      if (['default_ai_state', 'default_ai_catalog', 'claude_allow_list', 'set_claude_user_allow_list_result'].indexOf(type) < 0) socket.send(message);
    });
  });
  await page.goto(url + '/__fixture/admin');
  await page.waitForFunction(async function () { var s = (await import('./modules/store.js')).store; return s.get('connected') && s.get('myUserId'); });
  page.built = built;
  await page.locator('#server-settings-btn').click(); await page.locator('#settings-scope-tabs [data-scope=server]').waitFor();
  await route(page, 'us-providers'); await page.locator('[data-coding-provider=codex]').waitFor();
  return { page: page, url: url, messages: messages, control: control };
}
function route(page, id) {
  if (!page.built) return page.evaluate(async function (id) { await (await import('./modules/settings-shell.js')).openSettings({ scope: 'personal', page: id }); }, id);
  // Feed legacy destinations into the compiled shell's real route callback,
  // rather than importing a second unbundled store into the built app.
  return page.evaluate(function (id) {
    var select = document.getElementById('settings-page-select');
    var option = document.createElement('option'); option.value = id; select.appendChild(option);
    select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); option.remove();
  }, id);
}
async function leaveDraft(page) {
  await page.locator('#settings-page-nav [data-section=us-account]').click();
  await page.getByRole('button', { name: 'Keep draft and leave', exact: true }).click();
  await page.locator('#settings-page-nav [data-section=us-providers]').click();
}

[false, true].forEach(function (built) {
  test('unified AI ' + (built ? 'built' : 'source') + ' navigation, aliases, lifecycle and all five groups', { timeout: 60000 }, async function (t) {
    var f = await fixture(t, built), page = f.page;
    assert.equal(await page.locator('.us-section[data-section=us-ai]').count(), 0);
    assert.deepEqual(await page.locator('#settings-page-nav > button').allTextContents(), ['Account', 'Appearance', 'Notifications', 'AI providers', 'Agent behavior', 'Integrations']);
    assert.deepEqual(await page.locator('#settings-page-nav .settings-nav-category').allTextContents(), ['Personal', 'AI', 'Connections']);
    assert.deepEqual(await page.locator('.us-section[data-section=us-providers] [data-settings-section]').evaluateAll(function (nodes) { return nodes.map(function (node) { return node.id; }); }), anchors);
    assert.deepEqual(await page.locator('#settings-page-nav [data-section=us-providers] + nav a').allTextContents(), ['Coding agents', 'AI defaults', 'Execution & permissions', 'API connections', 'Experimental features']);
    for (var id of ['us-default-ai', 'us-auto-continue', 'us-claude-allow-list', 'us-voice-settings', 'us-capsules-enabled']) assert.equal(await page.locator('.us-section[data-section=us-providers] #' + id).count(), 1);
    var counts = function (type) { return f.messages.filter(function (msg) { return msg.type === type; }).length; };
    var before = counts('default_ai_get'), catalogs = counts('vendor_login_catalog_request'), allow = counts('get_claude_allow_list');
    await route(page, 'us-ai'); await page.locator('#settings-page-nav [data-section=us-providers]').click();
    assert.equal(counts('default_ai_get'), before); assert.equal(counts('vendor_login_catalog_request'), catalogs); assert.equal(counts('get_claude_allow_list'), allow);
    for (var id of anchors) {
      var link = page.locator('[data-settings-anchor="' + id + '"]'); await link.focus(); await page.keyboard.press('Enter');
      assert.equal(await link.getAttribute('aria-current'), 'location');
      assert.equal(await page.evaluate(function () { return document.activeElement.id; }), id);
    }
    assert.equal(await page.locator('#us-experimental-settings details').getAttribute('open'), '');
    assert.equal(await page.locator('#us-capsules-enabled').isVisible(), true);
    assert.equal(await page.locator('#experimental-features').textContent(), 'Experimental features');
    await page.locator('#settings-shell-content').evaluate(function (el) { el.dispatchEvent(new WheelEvent('wheel')); el.scrollTop = 0; });
    await page.waitForFunction(function () { return document.querySelector('[data-settings-anchor=coding-agents]').getAttribute('aria-current') === 'location'; });
    for (var pair of [['us-ai', 'ai-defaults'], ['us-mates', 'execution-behavior'], ['us-experimental', 'experimental-features'], ['us-ai#experimental-features', 'experimental-features'], ['us-ai#execution-behavior', 'execution-behavior'], ['us-chat', 'api-connections']]) {
      if (pair[1] === 'experimental-features') await page.locator('#us-experimental-settings details').evaluate(function (el) { el.open = false; });
      await route(page, pair[0]); assert.equal(await page.locator('[data-settings-anchor="' + pair[1] + '"]').getAttribute('aria-current'), 'location');
      assert.equal(await page.evaluate(function () { return document.activeElement.id; }), pair[1]);
      if (pair[1] === 'experimental-features') assert.equal(await page.locator('#us-capsules-enabled').isVisible(), true);
    }
    await page.locator('#settings-page-nav [data-section=us-agent]').click(); await page.locator('#us-agent-behavior .ab-layout').waitFor();
    assert.equal(await page.locator('nav[aria-label="AI providers sections"]').count(), 0);
    assert.equal(await page.locator('#settings-page-nav [data-section=us-agent] + nav a').count(), 4);
    await page.locator('#settings-page-nav [data-section=us-providers]').click();
    assert.equal(await page.locator('#us-agent-behavior .ab-layout').count(), 0); assert.equal(await page.locator('nav.ab-nav').count(), 1);
    assert.ok(counts('vendor_login_personal_release') > 0); assert.equal(counts('default_ai_get'), before + 1);
    await page.setViewportSize({ width: 390, height: 844 });
    var nav = page.locator('.us-section[data-section=us-providers] > nav'); await nav.waitFor();
    assert.equal(await nav.evaluate(function (el) { return getComputedStyle(el).position; }), 'sticky');
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    for (var id of anchors) {
      await page.locator('[data-settings-anchor="' + id + '"]').click();
      var gap = await page.locator('#' + id).evaluate(function (el) { return el.getBoundingClientRect().top - document.querySelector('nav[aria-label="AI providers sections"]').getBoundingClientRect().bottom; });
      assert.ok(gap >= 0, id + ' clears sticky anchors: ' + gap);
    }
    assert.equal(await page.locator('#settings-shell-content').evaluate(function (el) { return el.scrollWidth <= el.clientWidth + 1; }), true);
    await page.locator('#us-capsules-enabled').locator('..').click();
    await page.waitForFunction(async function () { return (await (await fetch('/api/profile')).json()).capsulesEnabled === true; });
    assert.equal(f.messages.some(function (msg) { return ['user_message', 'vendor_login_start', 'personal_provider_install_start'].indexOf(msg.type) >= 0; }), false);
  });

  test('unified AI ' + (built ? 'built' : 'source') + ' Default AI and rule drafts survive failure, navigation and cancel', { timeout: 60000 }, async function (t) {
    var f = await fixture(t, built), page = f.page;
    await page.locator('[data-settings-anchor=ai-defaults]').click(); await page.locator('#account-ai-summary').click();
    var effort = page.locator('select[aria-label="Default AI reasoning effort"]'); await effort.selectOption('high', { force: true }); f.control.failAi = true;
    await page.getByRole('button', { name: 'Apply', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'Synthetic Apply failure' }).waitFor();
    await leaveDraft(page); assert.equal(await effort.inputValue(), 'high');
    await page.getByRole('button', { name: 'Cancel Default AI editing', exact: true }).click(); await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); assert.equal(await effort.inputValue(), 'high');
    f.control.failAi = false; await page.getByRole('button', { name: 'Apply', exact: true }).click(); await page.locator('#account-ai-summary').waitFor();
    await page.locator('[data-settings-anchor=execution-behavior]').click();
    var group = page.locator('.us-config-group').filter({ has: page.locator('#us-claude-allow-list') }); await group.getByRole('button', { name: 'Edit', exact: true }).click();
    var rules = page.locator('#us-claude-allow-list'); await rules.fill('Read(synthetic-fixture)'); f.control.failRules = true;
    await page.locator('#us-claude-allow-save').click(); await page.locator('#us-claude-allow-list-receipt').filter({ hasText: 'Synthetic rules failure' }).waitFor();
    await leaveDraft(page); assert.equal(await rules.inputValue(), 'Read(synthetic-fixture)');
    await group.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); assert.equal(await rules.inputValue(), 'Read(synthetic-fixture)');
    f.control.failRules = false; await page.locator('#us-claude-allow-save').click(); await page.locator('#us-claude-allow-list-receipt').filter({ hasText: 'Saved.' }).waitFor({ state: 'attached' });
    await group.getByRole('button', { name: 'Edit', exact: true }).click(); await rules.fill('Unsaved fixture');
    await group.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.locator('[data-settings-anchor=ai-defaults]').click(); await page.locator('#account-ai-summary').click(); await effort.selectOption('medium', { force: true });
    await page.getByRole('button', { name: 'Cancel Default AI editing', exact: true }).click(); await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.locator('#settings-page-nav [data-section=us-account]').click(); assert.equal(await page.locator('#settings-confirm').count(), 0);
  });
});
