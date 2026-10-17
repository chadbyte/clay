var test = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var path = require('node:path');
var playwright = require('playwright');
var browser, child, origin, page, frame, input, surface, trigger, sourceSlug;
var draft = 'Help me organise this project. Keep my current session open while we review the next steps.';

test.before(async function () {
  child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  var output = '';
  child.stdout.on('data', function (value) { output += value; });
  child.stderr.on('data', function (value) { output += value; });
  var info = await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error(output)); }, 15000);
    child.once('message', function (value) { clearTimeout(timer); resolve(value); });
    child.once('exit', function () { clearTimeout(timer); reject(new Error(output)); });
  });
  origin = 'http://127.0.0.1:' + info.port; sourceSlug = info.sourceSlug;
  browser = await playwright.chromium.launch();
});
test.after(async function () { if (browser) await browser.close(); if (child) child.kill('SIGTERM'); });
test.beforeEach(async function () {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(5000);
  await page.goto(origin + '/fixture/login?to=alpha');
  trigger = page.locator('.icon-strip-brand');
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  surface = page.locator('#contextual-clay');
  frame = page.frameLocator('#contextual-clay iframe');
  input = frame.locator('#input');
});
test.afterEach(async function () { await page.close(); });
async function open() {
  await trigger.click();
  await frame.locator('#messages').getByText('Isolated canonical integration conversation.', { exact: true }).waitFor();
  await input.waitFor();
  await frame.locator('#input-wrapper:not([inert])').waitFor();
}
async function geometry(t, label) {
  var result = await input.evaluate(function (element) {
    var stop = document.getElementById('generation-stop').getBoundingClientRect();
    var controls = ['stt-btn', 'stt-btn-picker', 'send-btn'].map(function (id) { var r = document.getElementById(id).getBoundingClientRect(); return { id: id, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    return { tracks: getComputedStyle(document.getElementById('input-row')).gridTemplateColumns, voiceArea: getComputedStyle(document.querySelector('.stt-controls')).gridArea, height: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, overflow: getComputedStyle(element).overflowY, caret: element.selectionEnd, value: element.value, stop: { left: stop.left, right: stop.right, top: stop.top, bottom: stop.bottom }, controls: controls };
  });
  t.diagnostic(label + ': ' + JSON.stringify(result));
  assert.equal(result.value, draft);
  assert.equal(result.caret, draft.length);
  assert.ok(result.scrollHeight <= result.height + 1 || result.overflow === 'auto', 'Capped draft has actual scrolling');
  assert.ok(result.scrollHeight - result.height - result.scrollTop <= 1, 'The final line and caret remain visible after resize');
  if (label.includes('running')) result.controls.forEach(function (r) {
    var stop = result.stop;
    assert.ok(stop.right <= r.left || stop.left >= r.right || stop.bottom <= r.top || stop.top >= r.bottom, 'Stop does not overlap ' + r.id);
  });
}

test('1: exact desktop draft retains its final line and separate running controls at 390x844', async function (t) {
  await open();
  await input.fill(draft);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await geometry(t, 'narrow idle');
  await page.request.get(origin + '/fixture/stream');
  await frame.locator('#generation-stop').waitFor({ state: 'visible' });
  await page.waitForTimeout(100);
  await geometry(t, 'narrow running');
  await input.fill(Array(20).fill(draft).join('\n'));
  assert.equal(await input.evaluate(function (element) { return getComputedStyle(element).overflowY === 'auto' && element.scrollHeight > element.clientHeight && element.offsetHeight <= 121; }), true);
});

test('2: Open Clay navigates to native Mate shell and Back restores the project', async function (t) {
  await open();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open Clay', exact: true }).click();
  await page.waitForURL('**/p/' + sourceSlug + '/');
  await page.locator('#contextual-workspace-back').waitFor();
  assert.equal(await page.locator('body').evaluate(function (body) { return body.classList.contains('mate-workspace-active'); }), true);
  assert.equal(await surface.isVisible(), false);
  await page.getByRole('button', { name: 'Back to project', exact: true }).click();
  await page.waitForURL('**/p/alpha/');
  await page.locator('#header-title').getByText('Alpha destination', { exact: true }).waitFor();
  assert.equal(await page.locator('#header-full-access-btn').isVisible(), true);
  t.diagnostic('Actual canonical Mate route/shell, hidden popover, Back to original project verified.');
});

test('3: real authenticated review leads with named intent, with the unchanged exact payload initially collapsed', async function (t) {
  await open();
  var proposal = page.request.get(origin + '/fixture/propose?viewer=alpha&target=beta');
  var review = frame.locator('.ask-user-container:not(.answered)').last();
  await review.locator('.product-review-action').waitFor();
  assert.equal(await review.locator('.product-review-action').textContent(), 'Open conversation: Beta destination');
  assert.equal(await review.locator('.product-review pre').isVisible(), false);
  assert.doesNotMatch(await review.locator('.product-review-action, .product-review > p').allTextContents().then(function (items) { return items.join('\n'); }), /viewer:|session:|"action"/);
  var exact = await review.locator('.product-review pre').textContent();
  assert.match(exact, /Selected viewer: viewer:/);
  assert.match(exact, /"action":"navigate"/);
  await review.locator('summary').click();
  assert.equal(await review.locator('pre').isVisible(), true);
  assert.equal(await review.locator('pre').textContent(), exact);
  var reviewId = await review.getAttribute('data-tool-id');
  await review.getByText('Keep unchanged', { exact: true }).click();
  await review.locator('.ask-user-submit').click();
  assert.equal((await (await proposal).json()).status, 'cancelled');
  assert.equal(await frame.locator('.ask-user-container[data-tool-id=\"' + reviewId + '\"]').locator('.ask-user-answer-label').textContent(), 'Open conversation');
  t.diagnostic('Named action and target visible; exact viewer/session/action payload retained; real authenticated decline cancelled operation.');
});

test('4: mouse/keyboard opens enter the ready composer; delayed loading does not steal focus; inner Escape wins', async function (t) {
  var release;
  var gate = new Promise(function (resolve) { release = resolve; });
  await page.route('**/*contextual=1*', async function (route) { await gate; await route.continue(); });
  await trigger.click();
  await page.locator('#input').focus();
  release();
  await frame.locator('#messages').getByText('Isolated canonical integration conversation.', { exact: true }).waitFor();
  await frame.locator('#input-wrapper:not([inert])').waitFor();
  assert.equal(await page.locator('#input').evaluate(function (element) { return document.activeElement === element; }), true, 'Readiness must not take focus back after the user moves away');
  await surface.locator('[data-clay-close]').click();
  await trigger.click();
  assert.equal(await input.evaluate(function (element) { return document.activeElement === element; }), true, 'Mouse opening enters the ready composer');
  await page.keyboard.press('Escape');
  assert.equal(await surface.isVisible(), false, 'Composer Escape closed the popover before keyboard reopening');
  await trigger.focus(); await page.keyboard.press('Enter');
  t.diagnostic('Keyboard mode: ' + await surface.getAttribute('data-mode'));
  assert.equal(await input.evaluate(function (element) { return document.activeElement === element; }), true, 'Keyboard opening enters the ready composer');
  await frame.locator('#stt-btn-picker').click();
  await frame.locator('#speech-picker').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await frame.locator('#speech-picker').count(), 0);
  assert.equal(await surface.isVisible(), true);
  await input.focus(); await page.keyboard.press('Escape');
  assert.equal(await surface.isVisible(), false);
  await trigger.click(); await trigger.click();
  await page.waitForURL('**/p/' + sourceSlug + '/');
  await page.locator('#contextual-workspace-back').waitFor();
  await trigger.click();
  await page.waitForURL('**/p/alpha/');
  t.diagnostic('Delayed readiness preserved project focus; both entry methods focus the composer; inner voice menu consumes Escape; rapid cycle closes.');
});
