var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var childProcess = require('node:child_process');
var playwright = require('playwright');

test('checklist presentation fits all stationery colours, themes, narrow and touch surfaces', async function (t) {
  var port = 28500 + process.pid % 400;
  var fixture = path.join(__dirname, 'fixtures/sticky-note-checklist-server.cjs');
  var server = childProcess.spawn(process.execPath, [fixture], { env: Object.assign({}, process.env, { STICKY_NOTE_FIXTURE_PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(function () { return new Promise(function (resolve) { server.once('exit', resolve); server.kill(); }); });
  await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('preview server timeout')); }, 5000);
    server.stdout.on('data', function (data) { if (String(data).includes('http://127.0.0.1:' + port)) { clearTimeout(timer); resolve(); } });
    server.on('error', reject);
  });
  var browser = await playwright.chromium.launch({ headless: true });
  t.after(function () { return browser.close(); });
  var context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  var page = await context.newPage();
  var errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  var origin = 'http://127.0.0.1:' + port;
  await page.goto(origin + '/test/fixtures/sticky-note-checklist-design.html');
  await page.locator('.sn-task-form').first().waitFor();
  await page.locator('.sn-task-remove svg').first().waitFor();
  assert.equal(await page.locator('.sn-task-form').count(), 6);
  async function layout(label) {
    var geometry = await page.locator('.sn-task-form').evaluateAll(function (forms) {
      return forms.map(function (form) {
        return {
          overflow: form.scrollWidth > form.clientWidth + 2,
          fields: Array.from(form.querySelectorAll('textarea')).map(function (el) { return { h: el.clientHeight, scroll: el.scrollHeight, width: el.clientWidth, scrollWidth: el.scrollWidth }; }),
          checks: Array.from(form.querySelectorAll('.sn-check')).map(function (el) { var box = el.getBoundingClientRect(); var text = el.nextElementSibling.getBoundingClientRect(); return Math.abs(box.top - text.top); })
        };
      });
    });
    geometry.forEach(function (item) {
      assert.equal(item.overflow, false, label + ': form fits note');
      item.fields.forEach(function (field) { assert.ok(field.scroll <= field.h + 2, label + ': text visible'); assert.ok(field.scrollWidth <= field.width + 2, label + ': text wraps'); });
      item.checks.forEach(function (offset) { assert.ok(offset < 2, label + ': first line alignment'); });
    });
    await page.screenshot({ path: '/tmp/clay-checklist-' + label + '.png', fullPage: true });
  }
  await layout('design-light');
  await page.click('#theme'); await layout('design-dark');
  await page.setViewportSize({ width: 360, height: 850 }); await layout('design-narrow-dark');
  await page.click('#theme'); await layout('design-narrow-light');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  var card = page.locator('[data-note-id="sample-0"]');
  var entry = card.getByLabel('New task', { exact: true });
  await entry.fill('Keyboard addition'); await entry.press('Enter');
  await page.waitForFunction(function () { return document.querySelector('[data-note-id="sample-0"] .sn-task-form').getAttribute('aria-busy') === 'false'; });
  assert.equal(await entry.evaluate(function (el) { return document.activeElement === el; }), true);
  assert.equal(await card.locator('.sn-task-row').count(), 4);
  var task = card.getByLabel('Task 1', { exact: true });
  await task.focus(); await page.keyboard.press('Tab');
  assert.equal(await card.getByRole('button', { name: 'Remove task 1' }).evaluate(function (el) { return document.activeElement === el; }), true);
  assert.equal(await card.getByRole('button', { name: 'Remove task 1' }).evaluate(function (el) { return getComputedStyle(el).outlineStyle; }), 'solid');
  await page.click('#failure'); await entry.fill('Keep this failed draft'); await entry.press('Enter');
  await page.waitForFunction(function () { return document.querySelector('[data-note-id="sample-0"] .sn-task-feedback').textContent.includes('Draft kept.'); });
  assert.equal(await entry.inputValue(), 'Keep this failed draft');
  await page.screenshot({ path: '/tmp/clay-checklist-design-error.png', fullPage: true });
  assert.deepEqual(errors, []);
  // Only the isolated fixture's initial seeded note exists on the server: preview mutations stay in memory.
  var serverNotes = await (await page.request.get(origin + '/fixture-state')).json();
  assert.equal(serverNotes.length, 1);
  assert.equal(serverNotes[0].checklistMode, false);
  var touch = await browser.newContext({ viewport: { width: 360, height: 850 }, isMobile: true, hasTouch: true });
  var touchPage = await touch.newPage();
  await touchPage.goto(origin + '/test/fixtures/sticky-note-checklist-design.html?theme=dark');
  var remove = touchPage.locator('.sn-task-remove').first(); await remove.locator('svg').waitFor();
  var touchSize = await remove.evaluate(function (el) { var rect = el.getBoundingClientRect(); return { w: rect.width, h: rect.height, opacity: getComputedStyle(el).opacity }; });
  assert.ok(touchSize.w >= 36 && touchSize.h >= 36);
  assert.notEqual(touchSize.opacity, '0');
  await touchPage.screenshot({ path: '/tmp/clay-checklist-design-touch.png', fullPage: true });
});
