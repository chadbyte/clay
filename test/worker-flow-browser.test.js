var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var path = require('node:path');
var playwright = require('playwright');

test('production Worker approval and delegation interactions', async function (t) {
  var port = 35000 + process.pid % 10000;
  var server = childProcess.spawn(process.execPath, [path.join(__dirname, 'fixtures/session-folders-dom/serve.js'), String(port)], {stdio: ['ignore', 'pipe', 'pipe']});
  var browser;
  t.after(async function () { if (browser) await browser.close(); server.kill(); });
  await new Promise(function (resolve, reject) { server.stdout.once('data', resolve); server.once('error', reject); });
  browser = await playwright.chromium.launch();
  var page = await browser.newPage({viewport: {width: 1000, height: 1000}, reducedMotion: 'reduce'});
  var errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  await page.goto('http://127.0.0.1:' + port + '/worker-flow.html');
  await page.waitForFunction(function () { return window.__ready; });
  var card = page.locator('[data-proposal-id="preview"]');
  await t.test('real icons, readable delegated Markdown, and one author', async function () {
    assert.equal(await card.locator('.worker-proposal-mark svg').count(), 1);
    assert.equal(await page.locator('.delegated-brief h2').textContent(), 'Account controls');
    assert.equal(await page.locator('.delegated-card-from').textContent(), 'Driver · Codex');
    assert.equal(await page.locator('.msg-user-delegated > .dm-bubble-avatar').isVisible(), false);
    assert.equal(await page.locator('.msg-user-delegated .dm-bubble-header').isVisible(), false);
  });
  await t.test('desktop picker supports keyboard selection, dismissal and Tab exit', async function () {
    var provider = card.getByRole('button', {name: 'Provider: Codex'});
    await provider.click();
    await page.keyboard.press('Escape');
    assert.equal(await provider.evaluate(function (el) { return el === document.activeElement; }), true);
    await provider.click();
    await page.keyboard.press('Tab');
    assert.equal(await card.getByRole('button', {name: 'Model: GPT-5.6 Luna'}).evaluate(function (el) { return el === document.activeElement; }), true);
    await provider.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await card.locator('.worker-proposal-vendor').inputValue(), 'claude');
    assert.equal(await card.locator('.worker-proposal-effort').isVisible(), false);
    await card.getByRole('button', {name: 'Model: Automatic'}).click();
    await page.getByRole('option', {name: 'Sonnet', exact: true}).click();
    await card.getByRole('button', {name: 'Provider: Claude Code'}).click();
    await card.locator('.worker-proposal-summary').click();
    assert.equal(await page.getByRole('listbox').count(), 0);
  });
  await t.test('accept sends exactly once and resolved receipt uses selected runtime', async function () {
    await card.getByRole('button', {name: 'Run with Split Worker'}).click();
    assert.deepEqual(await page.evaluate(function () { return window.__sent; }), [{type:'worker_proposal_response', proposalId:'preview', accepted:true, vendor:'claude', model:'sonnet', effort:''}]);
    assert.equal(await card.locator('.worker-proposal-config').isVisible(), false);
    assert.equal(await card.locator('.worker-proposal-actions').isVisible(), false);
    assert.match(await card.locator('.worker-proposal-runtime').innerText(), /Claude Code · Sonnet/);
    await page.evaluate(function () { window.__update({proposalId:'preview', status:'running', selectedVendor:'codex', selectedModel:'gpt-5.6-luna', selectedEffort:'high', autoAccepted:true}); });
    assert.match(await card.locator('.worker-proposal-runtime').innerText(), /GPT-5.6 Luna · High reasoning/);
    assert.match(await card.locator('.worker-proposal-decision').innerText(), /auto-accepted/);
    await card.locator('summary').click();
    assert.equal(await card.locator('.worker-proposal-plan').isVisible(), true);
    assert.equal(await page.evaluate(function () { return window.__sent.length; }), 1);
  });
  await t.test('replacement decline and error/cancelled/superseded receipts', async function () {
    await page.evaluate(function () { window.__render({proposalId:'replace', action:'replace'}); });
    await page.locator('[data-proposal-id="replace"]').getByRole('button', {name:'Keep current Worker'}).click();
    assert.equal(await page.evaluate(function () { return window.__sent[1].accepted; }), false);
    for (var status of ['error', 'cancelled', 'superseded', 'completed', 'interrupted']) {
      await page.evaluate(function (status) { window.__update({proposalId:'replace', status:status, error:status === 'error' ? 'Selected runtime is unavailable.' : ''}); }, status);
      assert.equal(await page.locator('[data-proposal-id="replace"] .worker-proposal-actions').isVisible(), false);
      assert.equal(await page.locator('[data-proposal-id="replace"] [role="alert"]').isVisible(), status === 'error');
    }
    await page.evaluate(function () { document.querySelector('[data-proposal-id="replace"]').remove(); window.__update({proposalId:'preview', status:'pending', autoAccepted:false}); });
  });
  await t.test('light/dark and narrow layouts stay within conversation bounds', async function () {
    for (var theme of ['light', 'dark']) {
      for (var width of [1000, 600, 320]) {
        await page.setViewportSize({width:width, height:1000});
        await page.evaluate(function (theme) { document.documentElement.classList.toggle('light-theme', theme === 'light'); document.getElementById('messages').scrollTop = 0; }, theme);
        await card.scrollIntoViewIfNeeded();
        var fits = await page.evaluate(function () {
          return Array.from(document.querySelectorAll('.worker-proposal-card, .msg-user-delegated .bubble, .worker-proposal-action, .worker-runtime-trigger')).every(function (el) {
            var rect = el.getBoundingClientRect();
            return rect.width === 0 || (rect.left >= 0 && rect.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1);
          });
        });
        assert.equal(fits, true, theme + ' at ' + width);
        assert.equal(await card.locator('.worker-proposal-status').isVisible(), true);
        assert.ok(await card.locator('.worker-proposal-heading strong').evaluate(function (el) { return el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) * 2 + 1; }), 'title stays readable without word-by-word wrapping');
        await page.screenshot({path:'/tmp/worker-flow-' + theme + '-' + width + '.png'});
      }
    }
  });
  await t.test('touch exposes the native selector', async function () {
    var touch = await browser.newPage({viewport:{width:390, height:844}, hasTouch:true, isMobile:true});
    await touch.goto('http://127.0.0.1:' + port + '/worker-flow.html');
    await touch.waitForFunction(function () { return window.__ready; });
    assert.equal(await touch.locator('.worker-proposal-vendor').isVisible(), true);
    assert.equal(await touch.locator('.worker-runtime-trigger').first().isVisible(), false);
    await touch.locator('.worker-proposal-vendor').selectOption('claude');
    assert.equal(await touch.locator('.worker-proposal-effort').isVisible(), false);
    await touch.close();
  });
  assert.deepEqual(errors, []);
});
