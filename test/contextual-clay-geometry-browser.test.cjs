var test = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var path = require('node:path');
var fs = require('node:fs');
var playwright = require('playwright');

async function waitForSettledReviewPaint(target) {
  await target.evaluate(async function () {
    // Flush theme styles before enumerating finite CSS transitions.
    document.querySelectorAll('.ask-user-option').forEach(function (button) { getComputedStyle(button).backgroundColor; });
    await new Promise(function (resolve) { requestAnimationFrame(resolve); });
    var animations = document.getAnimations().filter(function (animation) { return animation.effect && animation.effect.getComputedTiming().iterations !== Infinity; });
    await Promise.all(animations.map(function (animation) { return animation.finished.catch(function () {}); }));
    await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  });
}
async function reviewPaint(target) {
  return target.evaluate(function () {
    function luminance(color) {
      var channels = color.match(/[\d.]+/g).slice(0, 3).map(function (value) { var channel = Number(value) / 255; return channel <= .04045 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4); });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    }
    var probe = document.createElement('span'); probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-alt');
    return { light: document.documentElement.classList.contains('light-theme'), expectedBackground: probe.style.backgroundColor, buttons: Array.from(document.querySelectorAll('.ask-user-container:not(.answered) .ask-user-option')).map(function (button) {
      var background = getComputedStyle(button).backgroundColor;
      var color = getComputedStyle(button.querySelector('.option-label')).color;
      var a = luminance(background); var b = luminance(color);
      return { text: button.textContent.trim(), background: background, color: color, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    }) };
  });
}
function assertSettledReview(paint, light) {
  assert.equal(paint.light, light); assert.equal(paint.buttons.length, 2);
  paint.buttons.forEach(function (button) { assert.equal(button.background, paint.expectedBackground, 'Settled option uses the active theme background'); assert.ok(button.contrast >= 4.5, button.text + ' contrast: ' + button.contrast); });
}

test('production popover geometry: drag, resize, continuity, cancellation, keyboard and owner persistence', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var output = ''; child.stdout.on('data', function (v) { output += v; }); child.stderr.on('data', function (v) { output += v; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(async function () { await browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(10000);
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  var origin = 'http://127.0.0.1:' + info.port;
  await page.goto(origin + '/fixture/login?to=alpha');
  var trigger = page.locator('.icon-strip-brand'); await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  await trigger.click();
  var shell = page.locator('#contextual-clay'); var header = shell.locator('header');
  var frame = page.frameLocator('#contextual-clay iframe');
  await frame.locator('#messages').getByText('Isolated canonical integration conversation.', { exact: true }).waitFor();
  await frame.locator('#input-wrapper:not([inert])').waitFor();
  var input = frame.locator('#input'); var draft = 'Help me organise this project. Keep my current session open while we review the next steps.'; await input.fill(draft);
  var context = page.frames().find(function (item) { return item.url().includes('contextual=1'); });
  var session = await context.evaluate(async function () { window.geometryMarker = 'same renderer'; window.geometryStore = (await import('./modules/store.js')).store; return window.geometryStore.get('paneSessionId'); });
  // Real wheel input disarms the native history-replay sticky-bottom window.
  await frame.locator('#messages').hover(); await page.mouse.wheel(0, -500);
  await context.evaluate(async function () { window.geometryScroll = await import('./modules/chat-render-runtime.js'); });
  await context.waitForFunction(function () { return !window.geometryScroll.getStickyBottom(); });
  var scrollPosition = await context.evaluate(function () { var scroll = document.getElementById('messages'); scroll.scrollTop = 45; document.getElementById('input').setSelectionRange(12, 20); return scroll.scrollTop; });
  assert.ok(scrollPosition > 0, 'Real transcript is scrolled away from the latest message');
  await page.evaluate(async function () { window.geometryState = (await import('/p/alpha/modules/store.js')).store; });
  var initial = await shell.boundingBox(); var heading = await header.boundingBox();
  var saves = 0; page.on('request', function (request) { if (request.method() === 'PUT' && request.url().endsWith('/api/user/contextual-clay-geometry')) saves++; });
  await page.mouse.move(heading.x + 45, heading.y + 16); await page.mouse.down();
  await page.mouse.move(heading.x + 210, heading.y + 85, { steps: 8 });
  assert.equal(saves, 0, 'Do not write during pointer movement');
  await page.mouse.up();
  var moved = await shell.boundingBox(); assert.ok(moved.x > initial.x + 140); assert.ok(moved.y > initial.y + 50);
  assert.equal(await context.evaluate(function () { return document.getElementById('messages').scrollTop; }), scrollPosition);
  assert.deepEqual(await input.evaluate(function (el) { return [el.selectionStart, el.selectionEnd]; }), [12, 20]);
  await page.waitForFunction(function () { var value = window.geometryState.get('contextualClayGeometry'); return !value.saving && !value.pending; });
  assert.equal(saves, 1);
  var corner = await shell.locator('[data-clay-resize="se"]').boundingBox();
  await page.mouse.move(corner.x + 9, corner.y + 9); await page.mouse.down(); await page.mouse.move(corner.x + 125, corner.y + 89, { steps: 8 }); await page.mouse.up();
  var resized = await shell.boundingBox(); assert.ok(resized.width > moved.width + 100); assert.ok(resized.height > moved.height + 60);
  assert.ok(await context.evaluate(function () { var el = document.getElementById('messages'); return el.scrollTop < el.scrollHeight - el.clientHeight - 150; }), 'Resizing retains the reader position rather than forcing latest');
  assert.equal(await input.inputValue(), draft); assert.equal(await context.evaluate(function () { return window.geometryMarker; }), 'same renderer');
  assert.equal(await context.evaluate(function () { return window.geometryStore.get('paneSessionId'); }), session);
  var review = page.request.get(origin + '/fixture/propose?viewer=alpha&target=beta');
  var card = frame.locator('.ask-user-container:not(.answered)'); await card.waitFor(); var reviewId = await card.getAttribute('data-tool-id');
  await header.focus(); await page.keyboard.press('ArrowRight'); await shell.locator('[data-clay-resize="se"]').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await card.getAttribute('data-tool-id'), reviewId); assert.equal(await input.inputValue(), draft);
  await page.request.get(origin + '/fixture/stream'); await frame.locator('#generation-stop').waitFor({ state: 'visible' });
  var beforeCancel = await shell.boundingBox(); heading = await header.boundingBox();
  await page.mouse.move(heading.x + 45, heading.y + 16); await page.mouse.down(); await page.mouse.move(900, 500); await page.keyboard.press('Escape'); await page.mouse.up();
  var cancelled = await shell.boundingBox(); assert.ok(Math.abs(cancelled.x - beforeCancel.x) < 2); assert.equal(await shell.isVisible(), true);
  assert.equal(await shell.evaluate(function (el) { return el.classList.contains('contextual-clay-manipulating'); }), false);
  heading = await header.boundingBox(); await page.mouse.move(heading.x + 45, heading.y + 16); await page.mouse.down(); await page.mouse.move(heading.x + 70, heading.y + 30);
  await header.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  assert.equal(await shell.evaluate(function (el) { return el.classList.contains('contextual-clay-manipulating'); }), false);
  assert.ok(Math.abs((await shell.boundingBox()).x - beforeCancel.x) < 2);
  var handle = shell.locator('[data-clay-resize="se"]'); corner = await handle.boundingBox();
  await page.mouse.move(corner.x + 9, corner.y + 9); await page.mouse.down(); await page.mouse.move(0, 0); await page.mouse.up();
  var minimum = await shell.boundingBox(); assert.equal(Math.round(minimum.width), 340); assert.equal(Math.round(minimum.height), 360);
  corner = await handle.boundingBox(); await page.mouse.move(corner.x + 9, corner.y + 9); await page.mouse.down(); await page.mouse.move(3000, 2500); await page.mouse.up();
  var maximum = await shell.boundingBox(); assert.ok(maximum.x + maximum.width <= 1273); assert.ok(maximum.y + maximum.height <= 893);
  // Choose a readable final rectangle and wait for the serialized final save.
  await page.evaluate(async function () { window.geometryState = (await import('/p/alpha/modules/store.js')).store; });
  await page.waitForFunction(function () { var value = window.geometryState.get('contextualClayGeometry'); return !value.saving && !value.pending; });
  var saved = (await page.request.get(origin + '/api/user/contextual-clay-geometry')).json(); saved = (await saved).geometry;
  var foreign = await browser.newContext();
  var foreignResponse = await foreign.request.get(origin + '/api/user/contextual-clay-geometry', { headers: { Cookie: 'relay_auth_user=fixture-foreign-token' } });
  assert.equal(foreignResponse.status(), 200); assert.equal((await foreignResponse.json()).geometry, null);
  assert.equal((await foreign.request.put(origin + '/api/user/contextual-clay-geometry', { headers: { Cookie: 'relay_auth_user=fixture-foreign-token', 'X-Clay-Settings': '1' }, data: { left: 20, top: 20, width: 400, height: 500 } })).status(), 200);
  assert.deepEqual((await (await page.request.get(origin + '/api/user/contextual-clay-geometry')).json()).geometry, saved);
  assert.equal((await foreign.request.put(origin + '/api/user/contextual-clay-geometry', { headers: { Cookie: 'relay_auth_user=fixture-foreign-token', 'X-Clay-Settings': '1' }, data: { left: -1, top: 0, width: 400, height: 500 } })).status(), 400);
  assert.equal((await foreign.request.get(origin + '/api/user/contextual-clay-geometry')).status(), 401);
  await foreign.close();
  await page.getByRole('button', { name: 'Close Clay conversation', exact: true }).click(); await trigger.click();
  assert.equal(await input.inputValue(), draft); assert.equal(await card.getAttribute('data-tool-id'), reviewId);
  var reopen = await shell.boundingBox(); assert.ok(Math.abs(reopen.width - maximum.width) < 2);
  await page.setViewportSize({ width: 390, height: 844 }); var mobile = await shell.boundingBox(); assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390); assert.equal(await handle.isVisible(), false);
  await frame.locator('#contextual-attach-btn').click();
  assert.equal(await frame.locator('#attach-image-btn').isVisible(), true);
  await frame.locator('#attach-image-btn').press('Escape');
  await page.setViewportSize({ width: 800, height: 600 });
  var clamped = await shell.boundingBox(); assert.ok(clamped.width <= 784 && clamped.height <= 584);
  var savesBeforeClick = saves; heading = await header.boundingBox(); await page.mouse.click(heading.x + 45, heading.y + 16); assert.equal(saves, savesBeforeClick);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(function (width) { return Math.abs(document.getElementById('contextual-clay').getBoundingClientRect().width - width) < 2; }, maximum.width);
  var restored = await shell.boundingBox(); assert.ok(Math.abs(restored.width - maximum.width) < 2);
  assert.deepEqual((await (await page.request.get(origin + '/api/user/contextual-clay-geometry')).json()).geometry, saved);
  var beforeHeaderClick = saves; heading = await header.boundingBox(); await page.mouse.click(heading.x + 45, heading.y + 16); assert.equal(saves, beforeHeaderClick);
  assert.equal(await frame.locator('#generation-stop').isVisible(), true);
  await page.screenshot({ path: '/tmp/contextual-geometry-desktop.png' });
  await page.evaluate(async function () { (await import('/p/alpha/modules/theme.js')).applyTheme('clay-dark'); });
  await context.evaluate(async function () { (await import('./modules/theme.js')).applyTheme('clay-dark'); });
  await waitForSettledReviewPaint(page); await waitForSettledReviewPaint(context);
  var darkPaint = await reviewPaint(context); assertSettledReview(darkPaint, false);
  await page.screenshot({ path: '/tmp/contextual-geometry-desktop-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: '/tmp/contextual-geometry-mobile.png' });
  await page.evaluate(async function () { (await import('/p/alpha/modules/theme.js')).applyTheme('clay-light'); });
  await context.evaluate(async function () { (await import('./modules/theme.js')).applyTheme('clay-light'); });
  var immediateLightPaint = await reviewPaint(context);
  await waitForSettledReviewPaint(page); await waitForSettledReviewPaint(context);
  var settledLightPaint = await reviewPaint(context); assertSettledReview(settledLightPaint, true);
  t.diagnostic('Dark-to-light review paint: ' + JSON.stringify({ immediate: immediateLightPaint, settled: settledLightPaint }));
  await page.screenshot({ path: '/tmp/contextual-review-theme-settled-light.png' });
  var capturedLightPaint = await reviewPaint(context); assertSettledReview(capturedLightPaint, true);
  fs.writeFileSync('/tmp/contextual-review-theme-paint.json', JSON.stringify({ capturedAt: new Date().toISOString(), cause: 'The option background has a 150 ms CSS transition; label colour changes immediately.', dark: darkPaint, immediateLight: immediateLightPaint, settledLight: settledLightPaint, afterScreenshot: capturedLightPaint, screenshot: '/tmp/contextual-review-theme-settled-light.png' }, null, 2));
  await page.screenshot({ path: '/tmp/contextual-geometry-mobile-light.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await card.getByText('Keep unchanged', { exact: true }).click(); await card.locator('.ask-user-submit').click(); assert.equal((await (await review).json()).status, 'cancelled');
  await page.reload(); await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; }); await trigger.click();
  await page.evaluate(async function () { window.geometryState = (await import('/p/alpha/modules/store.js')).store; });
  await page.waitForFunction(function () { return !!window.geometryState.get('contextualClayGeometry').desired; });
  var reloaded = await shell.boundingBox(); assert.ok(Math.abs(reloaded.width - saved.width) < 2); assert.ok(Math.abs(reloaded.height - saved.height) < 2);
  await shell.getByLabel('What this Mate can see', { exact: true }).click(); assert.equal(await shell.locator('.contextual-clay-context').getAttribute('open'), ''); await page.keyboard.press('Escape'); assert.equal(await shell.isVisible(), true);
  await frame.locator('#messages').getByText('Isolated canonical integration conversation.', { exact: true }).waitFor();
  await frame.locator('#input-wrapper:not([inert])').waitFor();
  await page.getByRole('button', { name: 'Open Clay', exact: true }).click(); await page.waitForURL('**/p/' + info.sourceSlug + '/');
  assert.deepEqual(errors, []);
  t.diagnostic('Observed real pointer drag/resize, 340×360 minimum, viewport maximum, Escape cancellation, keyboard controls, persisted reload, mobile restoration, and unchanged draft/session/review/Stop.');
});
