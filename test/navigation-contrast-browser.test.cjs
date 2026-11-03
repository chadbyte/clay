var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

async function contrast(page, locator, selector) {
  var paint = await locator.evaluate(function (element) {
    var style = getComputedStyle(element), opacity = 1;
    for (var parent = element; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
    var canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    var context = canvas.getContext('2d'); context.fillStyle = style.color; context.fillRect(0, 0, 1, 1);
    var color = Array.from(context.getImageData(0, 0, 1, 1).data);
    return { color: color, opacity: opacity, faceWidth: parseFloat(getComputedStyle(element, '::before').width) };
  });
  // Hide only foreground paint through a selector so icon refreshes cannot
  // replace the measured node with an unmasked glyph during capture.
  var mask = await page.addStyleTag({ content: selector + ' { color: transparent !important; }' }), screenshot;
  try {
    var box = await locator.boundingBox();
    screenshot = await page.screenshot({ clip: box, animations: 'disabled' });
  }
  finally { await mask.evaluate(function (element) { element.remove(); }); }
  return page.evaluate(async function (input) {
    var raw = atob(input.image), bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    var canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    var context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
    function luminance(rgb) {
      var linear = rgb.map(function (value) { value /= 255; return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4); });
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    }
    var alpha = input.paint.color[3] / 255 * input.paint.opacity, minimum = Infinity, sample;
    for (var y of [.35, .5, .65]) for (var x of [.35, .5, .65]) {
      var background = Array.from(context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data).slice(0, 3);
      var foreground = background.map(function (value, index) { return input.paint.color[index] * alpha + value * (1 - alpha); });
      var a = luminance(foreground), b = luminance(background), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      if (ratio < minimum) { minimum = ratio; sample = { foreground: foreground.map(Math.round), background: background }; }
    }
    var result = { ratio: minimum, foreground: sample.foreground, background: sample.background };
    return result;
  }, { image: screenshot.toString('base64'), paint: paint });
}

test('navigation text and meaningful icons contrast with composited gray and vivid workspaces', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/appearance-pane-server.cjs'), ['--navigation-contrast'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await require('./fixtures/offline-cdn-routes.cjs').install(context);
  var page = await context.newPage(), base = 'http://127.0.0.1:' + info.port;
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.route(/\/pane-assets\/style-[^/]+\.css(?:\?.*)?$/, function (route) {
    var url = new URL(route.request().url());
    return route.fulfill({ contentType: 'text/css', body: '@import url(' + JSON.stringify(url.pathname.replace(/pane-assets\/[^/]+$/, 'style.css')) + ');' });
  });
  await page.goto(base + '/fixture/login');
  var sessions = await (await page.request.get(base + '/fixture/info')).json();
  for (var theme of ['light', 'dark']) for (var background of ['plain', 'clay-silicon', 'clay-clouds']) {
    assert.equal((await page.request.put(base + '/api/user/appearance', { headers: { 'X-Clay-Settings': '1' }, data: { theme: 'clay-' + theme, mode: theme, background: background, backgroundColor: 'clay-gray' } })).status(), 200);
    await page.reload(); await page.locator('.session-item').first().waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.session-item[data-session-id="' + sessions.standaloneId + '"]').first().click();
    await page.waitForFunction(function () { return Array.from(document.querySelectorAll('#split-host iframe')).some(function (frame) { var identity = frame.clayPane && frame.clayPane.identity(); return identity && identity.ready; }); });
    await page.evaluate(function () { return document.fonts.ready; });
    await page.waitForFunction(function (theme) { return document.documentElement.classList.contains(theme + '-theme'); }, theme);
    await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
    await page.evaluate(async function () {
      var renderer = await import('/p/reuse/modules/git-placard.js');
      renderer.renderGitPlacard({ isRepository: true, name: 'Navigation review', branch: 'fix/readable-navigation', changed: 3, ahead: 1, hasUpstream: true, remote: 'github.com/example/review' });
      var badge = document.getElementById('terminal-sidebar-count'); badge.textContent = '7'; badge.classList.remove('hidden');
    });
    await page.locator('#project-logs-btn > svg.lucide').waitFor();
    var samples = [
      ['tool label', '#project-logs-btn .tool-btn-label', 4.5], ['tool icon', '#project-logs-btn > .lucide', 3],
      ['tool count', '#terminal-sidebar-count', 4.5], ['folder heading', '.session-folder-label', 4.5],
      ['folder count', '.session-folder-count', 4.5], ['empty text', '.session-folder-empty, .session-favorites-empty', 4.5],
      ['branch', '.git-placard-branch', 4.5], ['remote', '.git-placard-remote span', 4.5], ['More', '#git-placard-more', 4.5],
      ['New folder', '.session-folder-tool', 4.5], ['New session', '.session-folder-new-btn', 4.5],
      ['initials', '#icon-strip .icon-strip-item[data-slug="review-cl"]', 4.5]
    ];
    for (var sample of samples) {
      var value = await contrast(page, page.locator(sample[1]).first(), sample[1]);
      t.diagnostic(theme + ' ' + background + ' ' + sample[0] + ': ' + value.ratio.toFixed(2) + ':1 ' + JSON.stringify(value));
      assert.ok(value.ratio >= sample[2], theme + ' ' + background + ' ' + sample[0] + ' contrast ' + value.ratio.toFixed(2));
    }
    var tile = page.locator('#icon-strip .icon-strip-item[data-slug="review-cl"]');
    var initialBounds = await tile.boundingBox();
    for (var state of ['hover', 'active', 'focus']) {
      if (state === 'hover') await tile.hover();
      if (state === 'active') await tile.evaluate(function (element) { element.classList.add('active'); });
      if (state === 'focus') { await page.mouse.move(900, 850); await tile.focus(); }
      var value = await contrast(page, tile, '#icon-strip .icon-strip-item[data-slug="review-cl"]'); assert.ok(value.ratio >= 4.5, state + ': initials stay readable');
      assert.deepEqual(await tile.boundingBox(), initialBounds, state + ': tile geometry stays fixed');
      if (state === 'focus') assert.notEqual(await tile.evaluate(function (element) { return getComputedStyle(element).outlineStyle; }), 'none');
    }
    await page.mouse.move(900, 850);
  }
});
