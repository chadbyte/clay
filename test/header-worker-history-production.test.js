var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var path = require('node:path');

function loadPlaywright() { try { return require('playwright'); } catch (error) { return null; } }

test('real header action exposes Worker history for standalone and live split parents', async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright is not installed'); return; }
  var port = 32000 + process.pid % 10000;
  var server = childProcess.spawn(process.execPath, [path.join(__dirname, 'fixtures/session-folders-dom/serve.js'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(function () { if (!server.killed) server.kill('SIGTERM'); });
  await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('fixture server did not start')); }, 5000);
    server.stdout.on('data', function (chunk) { if (String(chunk).indexOf('DOM harness on') !== -1) { clearTimeout(timer); resolve(); } });
    server.on('exit', function (code) { clearTimeout(timer); reject(new Error('fixture server exited ' + code)); });
  });
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (error) { t.skip('Chromium is not available: ' + error.message); return; }
  t.after(async function () { await browser.close(); });
  var page = await browser.newPage({ viewport: { width: 700, height: 600 } });
  var pageErrors = [];
  page.on('pageerror', function (error) { pageErrors.push(error.message); });
  await page.goto('http://127.0.0.1:' + port + '/header-production.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(function () { return document.body.dataset.result; });
  assert.deepEqual(pageErrors, []);

  await page.evaluate(function () { window.__headerScenario(false); });
  var historyButton = page.locator('#find-in-session-btn + .header-worker-history-btn');
  assert.equal(await historyButton.count(), 1);
  var headerGeometry = await historyButton.evaluate(function (button) {
    var search = document.getElementById('find-in-session-btn');
    var buttonRect = button.getBoundingClientRect();
    var searchRect = search.getBoundingClientRect();
    var style = getComputedStyle(button);
    return { opacity: style.opacity, pointerEvents: style.pointerEvents, left: buttonRect.left, right: buttonRect.right, searchRight: searchRect.right, focusedOutline: getComputedStyle(button, ':focus-visible').outlineStyle };
  });
  assert.ok(Number(headerGeometry.opacity) > 0, 'header history action remained hidden');
  assert.equal(headerGeometry.pointerEvents, 'auto', 'header history action remained non-interactive');
  assert.ok(headerGeometry.left >= headerGeometry.searchRight && headerGeometry.left - headerGeometry.searchRight <= 12, 'header history action is not adjacent to search');
  await historyButton.focus();
  assert.equal(await historyButton.evaluate(function (button) { return document.activeElement === button; }), true);
  await historyButton.click();
  assert.equal(await page.locator('.session-worker-history-menu').count(), 1);
  assert.deepEqual(await page.locator('.session-worker-history-label').evaluateAll(function (items) { return items.map(function (item) { return item.textContent; }); }), ['Generation 3 · Current', 'Generation 2 · History', 'Generation 1 · History']);
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(function () { return document.activeElement.querySelector('.session-worker-history-label').textContent; }), 'Generation 1 · History');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(function () { return document.activeElement.querySelector('.session-worker-history-label').textContent; }), 'Generation 3 · Current');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(function () { return document.activeElement.querySelector('.session-worker-history-label').textContent; }), 'Generation 2 · History');
  await page.locator('.session-worker-history-item').filter({ hasText: 'Generation 2' }).click();
  assert.deepEqual(await page.evaluate(function () { return window.__headerState(); }), { sent: [{ type: 'switch_session', id: 806 }], opened: [], split: null });
  await page.locator('#header-info-btn').click();
  assert.equal(await page.locator('.session-info-popover .session-worker-history-item').count(), 0, 'Worker history leaked into the info popover');
  await page.locator('#header-info-btn').click();

  await page.evaluate(function () { window.__headerScenario(true); });
  historyButton = page.locator('#find-in-session-btn + .header-worker-history-btn');
  assert.equal(await historyButton.count(), 1);
  assert.equal(await historyButton.evaluate(function (button) { return getComputedStyle(button).pointerEvents; }), 'auto');
  await historyButton.click();
  await page.locator('.session-worker-history-item').filter({ hasText: 'Generation 2' }).click();
  assert.deepEqual(await page.evaluate(function () { return window.__headerState(); }), { sent: [], opened: ['/p/proj/?pane=1&session=806'], split: { groupId: 'worker-group', panes: [{ sessionId: 804, slug: 'proj', title: 'Worker parent' }, { sessionId: 805, slug: 'proj', title: 'Current Worker' }] } });

  await page.evaluate(function () { window.__headerScenario(true); });
  await page.locator('#find-in-session-btn + .header-worker-history-btn').click();
  await page.evaluate(function () { window.__replaceSocket(); });
  await page.locator('.session-worker-history-item').filter({ hasText: 'Generation 2' }).click();
  assert.deepEqual(await page.evaluate(function () { return window.__headerState(); }).then(function (state) { return { sent: state.sent, opened: state.opened }; }), { sent: [], opened: [] }, 'stale socket context was accepted');
  await page.evaluate(function () { window.__headerScenario(true); });
  await page.locator('#find-in-session-btn + .header-worker-history-btn').click();
  await page.evaluate(function () { window.__closeSplit(); });
  assert.equal(await page.locator('.session-worker-history-menu').count(), 0, 'split switch left the Worker history menu open');
});
