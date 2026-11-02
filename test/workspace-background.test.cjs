var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

[false, true].forEach(function (solo) {
  test('persisted missing and invalid colors default to Sky without migration (' + (solo ? 'solo' : 'account') + ')', function (t) {
    var fs = require('node:fs'), os = require('node:os');
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-sky-'));
    t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
    var user = { id: 'fixture-owner' };
    var route = require('../lib/server-appearance-settings').attachAppearanceSettings({
      CONFIG_DIR: dir, users: { isMultiUser: function () { return !solo; } },
      isRequestAuthed: function () { return true; }, getMultiUserFromReq: function () { return user; }
    });
    var catalog = require('../lib/public/workspace-background-catalog');
    var custom = { id: 'custom-test', name: 'Test', light: '#123456', dark: '#654321' };
    [undefined, null, 'invalid', 'custom-missing'].concat(catalog.colors.map(function (color) { return color.id; }), [custom.id]).forEach(function (id) {
      var saved = { background: 'workshop', customBackgroundColors: [custom] };
      if (id !== undefined) saved.backgroundColor = id;
      var before = JSON.stringify(saved);
      user.appearancePreferences = saved;
      var file = path.join(dir, 'appearance-preferences.json');
      if (solo) fs.writeFileSync(file, before);
      var seed = route.getInitialAppearance({});
      assert.equal(seed.backgroundColor, catalog.isColor(id, [custom]) ? id : 'sky');
      assert.equal(seed.background, 'workshop');
      assert.equal(solo ? fs.readFileSync(file, 'utf8') : JSON.stringify(user.appearancePreferences), before);
    });
  });
});

async function fixture(t, args) {
  var child = cp.fork(path.join(__dirname, 'fixtures/server-settings-server.js'), args || [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  return 'http://127.0.0.1:' + info.port;
}
[false, true].forEach(function (solo) {
  test('background persistence, partial saves and shell seed (' + (solo ? 'solo' : 'account') + ')', async function (t) {
    var base = await fixture(t, solo ? ['--solo'] : []), url = base + '/api/user/appearance';
    var headers = { 'Content-Type': 'application/json', 'X-Clay-Settings': '1' };
    if (!solo) headers.Cookie = 'relay_auth_user=network-admin';
    async function get() { return (await fetch(url, { headers: headers })).json(); }
    async function put(value) { return fetch(url, { method: 'PUT', headers: headers, body: JSON.stringify(value) }); }
    assert.equal((await get()).background, 'plain');
    assert.equal((await get()).backgroundColor, 'sky');
    var pair = { theme: 'clay-dark', mode: null, lightTheme: 'clay-light', darkTheme: 'clay-dark' };
    assert.equal((await put(pair)).status, 200);
    assert.equal((await put({ background: 'workshop' })).status, 200);
    assert.deepEqual(await get(), Object.assign({ customBackgroundColors: [], configured: true, background: 'workshop', backgroundColor: 'sky' }, pair));
    // An older client omits the new field and still preserves the background.
    assert.equal((await put({ theme: 'clay-light', mode: 'light' })).status, 200);
    assert.equal((await get()).background, 'workshop');
    for (var invalid of ['other', null, 1, {}, ['plain']]) assert.equal((await put({ background: invalid })).status, 400);
    assert.equal((await put('plain')).status, 400);
    assert.equal((await get()).background, 'workshop');
    var catalog = require('../lib/public/workspace-background-catalog');
    for (var color of catalog.colors) {
      assert.equal((await put({ backgroundColor: color.id })).status, 200);
      assert.equal((await get()).backgroundColor, color.id);
      assert.equal((await get()).background, 'workshop');
    }
    for (var bad of ['#ffffff', 'url(https://invalid)', 'CLAY', '__proto__', null, {}, 1]) assert.equal((await put({ backgroundColor: bad })).status, 400);
    await put({ backgroundColor: 'sage' });
    await put({ theme: 'clay-light', mode: 'light' });
    assert.equal((await get()).backgroundColor, 'sage');
    var html = await (await fetch(base + '/p/sample/', { headers: headers })).text();
    var seed = JSON.parse(html.match(/window\.__clayAppearanceSeed=(.*?);<\/script>/)[1]);
    assert.equal(seed.backgroundColor, 'sage'); assert.equal(seed.background, 'workshop'); assert.equal(seed.mode, 'light');
    assert.equal(seed.lightTheme, pair.lightTheme); assert.equal(seed.darkTheme, pair.darkTheme);
    if (!solo) {
      var member = await (await fetch(url, { headers: { Cookie: 'relay_auth_user=network-member' } })).json();
      assert.equal(member.backgroundColor, 'sky'); assert.equal(member.background, 'plain'); assert.equal(member.configured, false);
    }
  });
});

async function open(page) {
  await page.waitForFunction(function () { return document.querySelector('#user-account-trigger'); });
  await page.locator('#user-account-trigger').click();
  await page.locator('.account-settings-button').click();
  await page.locator('#settings-page-nav [data-section="us-appearance"]').click();
  await page.locator('#us-workspace-background').waitFor({ state: 'attached' });
}
async function choose(page, id, name) {
  if (id === 'us-workspace-background') return page.getByRole('radio', { name: name, exact: true }).click();
  await page.locator('#' + id + ' + .settings-picker .settings-picker-trigger').click();
  await page.getByRole('option', { name: name, exact: true }).click();
}
[false, true].forEach(function (built) {
  test('Sky default first paint, queued saves and snapshots (' + (built ? 'built' : 'source') + ')', { timeout: 30000 }, async function (t) {
    var base = await fixture(t, built ? ['--built-settings'] : []);
    var browser = await chromium.launch(); t.after(function () { return browser.close(); });
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage();
    if (!built) await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.route('**/api/user/appearance', function (route) {
      if (route.request().method() === 'GET') return route.fulfill({ status: 503, json: { error: 'Hold hydration to inspect the shell seed' } });
      return route.continue();
    });
    for (var scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(base + '/__fixture/admin');
      await page.waitForFunction(function () { return document.querySelector('#layout-body') && document.documentElement.dataset.workspaceColor === 'sky'; });
      assert.equal(await page.locator('html').getAttribute('data-workspace-background'), 'plain');
      assert.equal(await page.locator('#layout').evaluate(function (el) { return getComputedStyle(el).backgroundColor; }), scheme === 'light' ? 'rgb(203, 223, 233)' : 'rgb(46, 63, 75)');
    }
    if (!built) {
      await page.unroute('**/api/user/appearance');
      var result = await page.evaluate(async function () {
        var store = (await import('./modules/store.js')).store;
        var theme = await import('./modules/theme.js');
        var appearance = await import('./modules/appearance-preferences.js');
        store.set({ appearanceDraft: null, appearancePreference: { backgroundColor: 'invalid' } });
        var invalid = theme.getAppearanceSnapshot().preference.backgroundColor;
        store.set({ appearancePreference: {} });
        var missing = theme.getAppearanceSnapshot().preference.backgroundColor;
        var saved = await appearance.queueAppearanceSave({ mode: 'dark' });
        return { invalid: invalid, missing: missing, saved: saved, color: store.get('appearancePreference').backgroundColor };
      });
      assert.deepEqual(result, { invalid: 'sky', missing: 'sky', saved: true, color: 'sky' });
    }
  });

  test('background selector, reload, system, failure/retry and rapid choices (' + (built ? 'built' : 'source') + ')', { timeout: 60000 }, async function (t) {
    var base = await fixture(t, built ? ['--built-settings'] : []);
    var browser = await chromium.launch(); t.after(function () { return browser.close(); });
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage(), errors = []; page.setDefaultTimeout(10000);
    page.on('pageerror', function (error) { errors.push(error.message); });
    if (!built) await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(base + '/__fixture/admin'); await open(page);
    assert.equal(await page.getByRole('radio', { name: 'Sky', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#layout').evaluate(function (el) { return getComputedStyle(el).backgroundImage; }), 'none');
    var contentColor = await page.locator('#app').evaluate(function (el) { return getComputedStyle(el).getPropertyValue('--bg'); });
    var catalog = require('../lib/public/workspace-background-catalog');
    for (var color of catalog.colors) {
      await choose(page, 'us-workspace-background', color.name);
      for (var scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForFunction(function (scheme) { return document.documentElement.classList.contains(scheme + '-theme'); }, scheme);
        var expected = await page.evaluate(function (hex) { var el = document.createElement('div'); el.style.color = hex; document.body.appendChild(el); var result = getComputedStyle(el).color; el.remove(); return result; }, color[scheme]);
        assert.equal(await page.locator('#layout').evaluate(function (el) { return getComputedStyle(el).backgroundColor; }), expected);
        assert.equal(await page.locator('#us-workspace-background [aria-checked="true"]').count(), 1);
      }
    }
    assert.equal(await page.locator('#app').evaluate(function (el) { return getComputedStyle(el).getPropertyValue('--bg'); }), contentColor);
    var paper = page.getByRole('radio', { name: 'Paper', exact: true });
    await paper.focus(); await paper.press('ArrowRight');
    assert.equal(await page.getByRole('radio', { name: 'Workshop', exact: true }).evaluate(function (el) { return el === document.activeElement; }), true);
    await page.getByRole('radio', { name: 'Workshop', exact: true }).press('ArrowLeft');
    assert.equal(await paper.getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByRole('radiogroup', { name: 'Workspace background' }).locator('[title]').count(), 0);
    await choose(page, 'us-workspace-background', 'Workshop');
    await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    // Hold hydration so the first rendered background must come from the shell seed.
    await page.route('**/api/user/appearance', function (route) {
      if (route.request().method() === 'GET') return route.fulfill({ status: 503, json: { error: 'Hydration held for seed verification' } });
      return route.continue();
    });
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-workspace-color'), 'paper');
    assert.equal(await page.locator('html').getAttribute('data-workspace-background'), 'workshop');
    assert.match(await page.locator('#layout').evaluate(function (el) { return getComputedStyle(el).backgroundImage; }), /workshop-dark/);
    await page.unroute('**/api/user/appearance');
    await open(page); assert.equal(await page.getByRole('radio', { name: 'Workshop', exact: true }).getAttribute('aria-checked'), 'true');
    for (var scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForFunction(function (scheme) { return document.documentElement.classList.contains(scheme + '-theme'); }, scheme);
      assert.match(await page.locator('#layout').evaluate(function (el) { return getComputedStyle(el).backgroundImage; }), new RegExp('workshop-' + scheme + '\\.webp'));
    }
    await choose(page, 'us-theme-mode', 'Light'); await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    assert.equal(await page.locator('html.light-theme').count(), 1);
    await choose(page, 'us-theme-mode', 'Dark'); await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    var fail = true, releases = [];
    await page.route('**/api/user/appearance', function (route) {
      if (route.request().method() !== 'PUT') return route.continue();
      if (fail) return route.fulfill({ status: 503, json: { error: 'Fixture failure' } });
      return new Promise(function (resolve) { releases.push(function () { resolve(route.continue()); }); });
    });
    await choose(page, 'us-workspace-background', 'Clay');
    await page.locator('#us-appearance-status').filter({ hasText: 'Could not save' }).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-workspace-background'), 'plain');
    assert.equal((await (await page.request.get(base + '/api/user/appearance')).json()).background, 'workshop');
    fail = false;
    await page.getByRole('button', { name: 'Retry save', exact: true }).first().click();
    await page.waitForTimeout(100); assert.equal(releases.length, 1); releases.shift()();
    await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    await choose(page, 'us-workspace-background', 'Workshop');
    await page.waitForTimeout(100);
    await choose(page, 'us-workspace-background', 'Clay');
    releases.shift()();
    await page.waitForTimeout(150);
    assert.match(await page.locator('#us-appearance-status').innerText(), /Saving/);
    assert.equal(await page.getByRole('radio', { name: 'Clay', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(releases.length, 1); releases.shift()();
    await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    await page.unroute('**/api/user/appearance'); await page.reload(); await open(page);
    assert.equal(await page.getByRole('radio', { name: 'Clay', exact: true }).getAttribute('aria-checked'), 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await choose(page, 'us-workspace-background', 'Workshop');
    await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    assert.equal(await page.locator('#settings-shell-content').evaluate(function (el) { return el.scrollWidth <= el.clientWidth; }), true);
    assert.deepEqual(errors, []);
  });
});

[false, true].forEach(function (built) {
  test('Worker row stays opaque over Workshop in split and locked presentations (' + (built ? 'built' : 'source') + ')', { timeout: 60000 }, async function (t) {
    var child = cp.fork(path.join(__dirname, 'fixtures/appearance-pane-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
    var info = await new Promise(function (resolve) { child.once('message', resolve); });
    var base = 'http://127.0.0.1:' + info.port, browser = await chromium.launch(); t.after(function () { return browser.close(); });
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage(); page.setDefaultTimeout(10000);
    if (!built) await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(base + '/fixture/login'); await page.locator('.session-item').first().waitFor();
    var data = await (await page.request.get(base + '/fixture/info')).json();
    await open(page); await choose(page, 'us-workspace-background', 'Workshop');
    await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    if (process.env.CLAY_BACKGROUND_CAPTURES) await page.screenshot({ path: path.join(process.env.CLAY_BACKGROUND_CAPTURES, 'appearance-' + (built ? 'built' : 'source') + '.png') });
    await page.locator('#settings-shell-close').click();
    await page.getByRole('button', { name: /^Open Split view Driver/ }).click();
    var row = page.locator('.split-view-workers:visible').first(); await row.waitFor();
    await page.waitForFunction(function () {
      return Array.from(document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached) iframe')).every(function (frame) {
        var overlay = frame.contentDocument && frame.contentDocument.querySelector('#connect-overlay');
        return overlay && overlay.classList.contains('hidden') && getComputedStyle(overlay).opacity === '0';
      });
    });
    await open(page); await choose(page, 'us-workspace-background', 'Sage');
    await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    await page.locator('#settings-shell-close').click();
    await page.waitForFunction(function () {
      return Array.from(document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached) iframe')).every(function (frame) {
        return frame.contentDocument.documentElement.dataset.workspaceColor === 'sage' && frame.contentDocument.documentElement.dataset.workspaceBackground === 'plain';
      });
    });
    await open(page);
    await page.locator('#us-add-color').click();
    await page.getByRole('button', { name: 'Light color', exact: true }).click();
    await page.locator('#us-color-hex').fill('#EACCD5');
    await page.getByRole('button', { name: 'Dark color', exact: true }).click();
    await page.locator('#us-color-hex').fill('#38212C');
    await page.locator('#us-color-save').click();
    await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    var customId = await page.getByRole('radio', { name: '#EACCD5 / #38212C', exact: true }).getAttribute('data-background-choice');
    await page.waitForFunction(function (id) {
      return Array.from(document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached) iframe')).every(function (frame) {
        var root = frame.contentDocument.documentElement;
        return root.dataset.workspaceColor === id && root.style.getPropertyValue('--workspace-solid-light') === '#EACCD5' && root.style.getPropertyValue('--workspace-solid-dark') === '#38212C';
      });
    }, customId);
    await choose(page, 'us-workspace-background', 'Workshop');
    await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-workspace-color'), customId);
    await page.locator('#settings-shell-close').click();
    for (var mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction(function (mode) { return document.documentElement.classList.contains(mode + '-theme'); }, mode);
      var actual = await row.evaluate(function (element) {
        var style = getComputedStyle(element), chip = element.querySelector('.split-view-worker-chip');
        var probe = document.createElement('div'); probe.style.background = 'var(--bg)'; element.appendChild(probe);
        var expected = getComputedStyle(probe).backgroundColor; probe.remove();
        var paint = document.createElement('canvas').getContext('2d'); paint.fillStyle = style.backgroundColor; paint.fillRect(0, 0, 1, 1);
        return { fill: style.backgroundColor, expected: expected, alpha: paint.getImageData(0, 0, 1, 1).data[3],
          blur: style.backdropFilter, gap: style.gap, padding: style.padding, chipHeight: getComputedStyle(chip).height };
      });
      assert.equal(actual.alpha, 255); assert.equal(actual.fill, actual.expected); assert.equal(actual.blur, 'none');
      assert.equal(actual.gap, '5px'); assert.equal(actual.padding, '4px 11px'); assert.equal(actual.chipHeight, '20px');
      assert.match(await page.locator('#layout').evaluate(function (el) { return getComputedStyle(el).backgroundImage; }), /workshop-/);
      await require('./fixtures/chrome-material-assertions.cjs').assertMaterial(page, '#split-host .split-pane-header');
      if (process.env.CLAY_BACKGROUND_CAPTURES) await page.screenshot({ path: path.join(process.env.CLAY_BACKGROUND_CAPTURES, 'worker-workshop-' + mode + '-' + (built ? 'built' : 'source') + '.png') });
    }
    await page.locator('#split-host > .split-pane:not(.split-pane-cached)').filter({ has: page.locator('.split-pane-title', { hasText: 'Companion' }) }).getByRole('button', { name: 'Close pane', exact: true }).click();
    await page.waitForFunction(function () { return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached)').length === 1; });
    await row.waitFor();
    assert.equal(await row.evaluate(function (el) { var paint = document.createElement('canvas').getContext('2d'); paint.fillStyle = getComputedStyle(el).backgroundColor; paint.fillRect(0, 0, 1, 1); return paint.getImageData(0, 0, 1, 1).data[3]; }), 255);
    if (process.env.CLAY_BACKGROUND_CAPTURES) await page.screenshot({ path: path.join(process.env.CLAY_BACKGROUND_CAPTURES, 'worker-single-' + (built ? 'built' : 'source') + '.png') });
    await row.locator('.split-view-worker-chip').first().click();
    await page.locator('#split-view-worker-popover').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Close Worker conversation', exact: true }).click();
    // A locked Worker is a read-only child, with no nested Worker list of its own.
    var locked = await context.newPage();
    if (!built) await require('./fixtures/source-module-runtime.cjs').install(locked);
    await locked.goto(base + '/p/reuse/?pane=1&session=' + data.workerId);
    await locked.locator('body.worker-pane-locked').waitFor();
    assert.equal(await locked.locator('.split-view-workers:visible').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await row.evaluate(function (element) { return getComputedStyle(element).backgroundColor; }), await row.evaluate(function (element) { var probe = document.createElement('div'); probe.style.background = 'var(--bg)'; element.appendChild(probe); var color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; }));
  });
});
