var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var http = require('node:http');
var path = require('node:path');

function loadPlaywright() {
  try { return require('playwright'); } catch (error) { return null; }
}
function serveRepository() {
  var root = path.join(__dirname, '..');
  var server = http.createServer(function (request, response) {
    var relative = decodeURIComponent(request.url.split('?')[0]).replace(/^\/+/, '');
    var file = path.resolve(root, relative || 'test/fixtures/github-work-popover.html');
    if (file.indexOf(root + path.sep) !== 0 || !fs.existsSync(file)) { response.writeHead(404); response.end('not found'); return; }
    var extension = path.extname(file);
    response.setHeader('Content-Type', extension === '.js' ? 'text/javascript' : extension === '.css' ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
  });
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server); }); });
}

test('linked work popover dismisses reliably without swallowing outside or inside actions', async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright is not installed'); return; }
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (error) { t.skip('Chromium is not available: ' + error.message); return; }
  var server = await serveRepository();
  t.after(function () { server.close(); return browser.close(); });
  var page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port + '/test/fixtures/github-work-popover.html');

  async function opener(caseId) { return page.locator('#' + caseId + ' .github-work-more'); }
  async function open(caseId) {
    await (await opener(caseId)).click();
    await page.locator('#github-work-popover').waitFor();
    assert.equal(await (await opener(caseId)).getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await page.evaluate(function () { return ['pointerdown', 'touchstart', 'keydown', 'blur'].map(window.fixtureListenerCount); }), [1, 1, 1, 1]);
  }
  async function expectClosed(caseId) {
    assert.equal(await page.locator('#github-work-popover').count(), 0);
    assert.equal(await (await opener(caseId)).getAttribute('aria-expanded'), 'false');
    assert.deepEqual(await page.evaluate(function () { return ['pointerdown', 'touchstart', 'keydown', 'blur'].map(window.fixtureListenerCount); }), [0, 0, 0, 0]);
  }

  await open('github-case');
  assert.equal(await page.locator('#github-work-popover').getAttribute('aria-label'), 'Linked GitHub work');
  await page.locator('#plain').click();
  await expectClosed('github-case');
  assert.equal(await page.evaluate(function () { return window.fixtureClicks.plain; }), 1);
  assert.equal(await page.evaluate(function () { return document.activeElement.id; }), 'plain');

  await open('mixed-case');
  await page.locator('#blocked').click();
  await expectClosed('mixed-case');
  assert.equal(await page.evaluate(function () { return window.fixtureClicks.blocked; }), 1);

  await open('linear-case');
  await page.locator('#touch').dispatchEvent('touchstart', { bubbles: true, cancelable: true });
  await expectClosed('linear-case');
  assert.equal(await page.evaluate(function () { return window.fixtureClicks.touch; }), 1);

  await open('github-case');
  await page.keyboard.press('Escape');
  await expectClosed('github-case');
  assert.equal(await page.evaluate(function () { return document.activeElement.closest('.github-work-more') !== null; }), true);

  await open('mixed-case');
  await page.evaluate(function () { window.dispatchEvent(new Event('blur')); });
  await expectClosed('mixed-case');

  await open('github-case');
  await page.evaluate(function () {
    var button = document.querySelector('#mixed-case .github-work-more');
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    button.click();
  });
  assert.equal(await page.locator('#github-work-popover').count(), 1);
  assert.equal(await (await opener('github-case')).getAttribute('aria-expanded'), 'false');
  assert.equal(await (await opener('mixed-case')).getAttribute('aria-expanded'), 'true');
  await page.locator('#plain').click();
  await expectClosed('mixed-case');

  await open('github-case');
  await page.locator('#github-work-popover a[href^="https://github.com/"]').first().click();
  assert.equal(await page.locator('#github-work-popover').count(), 1);
  assert.equal(await page.evaluate(function () { return window.fixtureClicks.github; }), 1);
  assert.equal(await page.evaluate(function () { return window.fixtureGithubDefaultPrevented; }), false);
  await (await opener('github-case')).click();
  await expectClosed('github-case');

  await open('mixed-case');
  await page.locator('#github-work-popover .session-linear-link').first().click();
  await expectClosed('mixed-case');
  await page.locator('#linear-panel:not(.hidden)').waitFor();
  assert.equal(await page.evaluate(function () { return window.fixtureMessages.some(function (message) { return message.type === 'linear_read'; }); }), true);

  await open('linear-case');
  await page.evaluate(async function () {
    var store = (await import('/lib/public/modules/store.js')).store;
    store.set({ currentSlug: 'another-project' });
  });
  await expectClosed('linear-case');

  for (var i = 0; i < 5; i++) {
    await open('github-case');
    assert.equal(await page.locator('#github-work-popover').count(), 1);
    await page.locator('#plain').click();
    await expectClosed('github-case');
  }

  await open('linear-case');
  await page.evaluate(function () { document.getElementById('linear-case').remove(); });
  await page.waitForFunction(function () { return !document.getElementById('github-work-popover'); });
  assert.deepEqual(await page.evaluate(function () { return ['pointerdown', 'touchstart', 'keydown', 'blur'].map(window.fixtureListenerCount); }), [0, 0, 0, 0]);
});
