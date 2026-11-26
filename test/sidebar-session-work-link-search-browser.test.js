var test = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var path = require('node:path');
var chromium = require('playwright').chromium;

test('sidebar searches multiple scopes and exact saved work links through the authenticated session search path', { timeout: 45000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {
    env: Object.assign({}, process.env, { CLAY_PANE_SESSION_FILTERS: '1', CLAY_PANE_HIDE_BENCHMARK: '1' }),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(function () { child.kill('SIGTERM'); });
  child.stdout.resume(); child.stderr.resume();
  var info = await new Promise(function (resolve, reject) {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', function (code) { reject(new Error('Fixture exited with code ' + code)); });
  });
  var browser = await chromium.launch();
  t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  var socket, errors = [], base = 'http://127.0.0.1:' + info.port;
  async function loadFixture(target) {
    target.setDefaultTimeout(8000);
    socket = null;
    target.on('pageerror', function (error) { errors.push(error.message); });
    target.on('websocket', function (ws) { if (!socket) socket = ws; });
    await require('./fixtures/source-module-runtime.cjs').install(target);
    await target.goto(base + '/fixture/login?account=replacement');
  }
  await loadFixture(page);
  var sidebar = page.locator('#session-list');
  var rows = sidebar.locator('.session-item-title');
  var app = 'Linked app work 1067', tools = 'Linked tools work';
  var fullList = [app, tools, 'Mention only', 'Nearby links'];
  async function assertRows(titles) {
    await page.waitForFunction(function (expected) {
      var visible = Array.from(document.querySelectorAll('#session-list .session-item-title')).filter(function (el) { return el.getClientRects().length > 0; });
      return JSON.stringify(visible.map(function (el) { return el.textContent.trim(); }).sort()) === JSON.stringify(expected);
    }, titles.slice().sort());
  }
  await assertRows(fullList);
  var toolbar = sidebar.locator('.session-folder-toolbar');
  var original = await toolbar.boundingBox();
  var opener = toolbar.getByRole('button', { name: 'Search sessions', exact: true });
  await opener.click();
  var input = toolbar.getByRole('searchbox', { name: 'Search sessions', exact: true });
  assert.equal(await input.getAttribute('placeholder'), 'Search titles and messages');
  assert.match(await input.getAttribute('aria-description'), /titles and messages/);
  assert.deepEqual(await toolbar.boundingBox(), original);
  var chooser = sidebar.getByRole('button', { name: /^Search in:/ });
  var filters = page.getByRole('dialog', { name: 'Search scopes' });
  var allScopes = ['Title', 'Messages', 'PR', 'Issue', 'Linear'];
  assert.equal(await chooser.getAttribute('aria-label'), 'Search in: Default: Title + Messages');
  assert.equal(await chooser.getAttribute('aria-expanded'), 'false');
  assert.equal(await filters.count(), 0);
  assert.equal((await page.locator('#sidebar-column').boundingBox()).width, 240);
  await page.evaluate(function () { return document.fonts.ready.then(function () {}); });

  function scope(name) { return filters.getByRole('checkbox', { name: name, exact: true }); }
  function action(name) { return filters.getByRole('button', { name: name, exact: true }); }
  async function openChooser() {
    if (!await filters.count()) await chooser.click();
    assert.equal(await chooser.getAttribute('aria-expanded'), 'true');
  }
  async function assertFocused(control) {
    assert.ok(await control.evaluate(function (el) { return el === document.activeElement; }),
      'focus should be on ' + await control.getAttribute('aria-label'));
  }
  async function assertPickerClosed(query) {
    await filters.waitFor({ state: 'detached' });
    assert.equal(await chooser.getAttribute('aria-expanded'), 'false');
    await assertFocused(chooser);
    assert.equal(await input.inputValue(), query);
  }
  async function closeSearchWithEscape() {
    await page.keyboard.press('Escape');
    await input.waitFor({ state: 'detached' });
    await assertFocused(opener);
  }
  async function assertPickerFits(picker, trigger, touch) {
    var anchor = await trigger.boundingBox();
    assert.ok(await picker.evaluate(function (el, data) {
      var panel = el.getBoundingClientRect();
      var anchor = data.anchor;
      var rows = Array.from(el.querySelectorAll('label')).map(function (row) { return row.getBoundingClientRect(); });
      var buttons = Array.from(el.querySelectorAll('button')).map(function (button) { return button.getBoundingClientRect(); });
      return panel.x === anchor.x && panel.y === anchor.y + anchor.height + 4 &&
        panel.left >= 8 && panel.right <= innerWidth - 8 && panel.bottom <= innerHeight - 8 &&
        el.scrollHeight <= el.clientHeight && rows.every(function (row, index) {
          return row.left === rows[0].left && (!index || row.top >= rows[index - 1].bottom);
        }) && buttons[0].top === buttons[1].top && buttons[0].right <= buttons[1].left &&
        (!data.touch || rows.concat(buttons).every(function (control) {
          return control.width >= 44 && control.height >= 44;
        }));
    }, { anchor: anchor, touch: touch }), 'picker is anchored, aligned, fully visible and usable');
  }
  async function assertScopes(expected) {
    assert.deepEqual(await filters.getByRole('checkbox', { checked: true }).evaluateAll(function (checks) {
      return checks.map(function (check) { return check.labels[0].textContent; });
    }), expected);
  }
  async function assertPlaceholderFits(field) {
    assert.ok(await field.evaluate(function (el) {
      var style = getComputedStyle(el, '::placeholder');
      var measure = document.createElement('canvas').getContext('2d');
      measure.font = style.fontSize + ' ' + style.fontFamily;
      var inputStyle = getComputedStyle(el);
      return measure.measureText(el.placeholder).width <= el.clientWidth -
        parseFloat(inputStyle.paddingLeft) - parseFloat(inputStyle.paddingRight);
    }));
  }
  await assertPlaceholderFits(input);
  function responseFor(query) {
    return socket.waitForEvent('framereceived', { predicate: function (frame) {
      var message = JSON.parse(frame.payload);
      return message.type === 'search_results' && message.query === query;
    } }).then(function (frame) { return JSON.parse(frame.payload); });
  }
  async function search(query, titles, enter) {
    var response = responseFor(query);
    if (enter) await enter();
    else await input.fill(query);
    var message = await response;
    assert.ok(message.requestId, 'sidebar reply echoes the request ID');
    assert.deepEqual(message.results.map(function (result) { return result.title; }).sort(), titles.slice().sort());
    await assertRows(titles);
    return message;
  }
  async function toggle(name, query, titles) {
    await openChooser();
    var check = scope(name);
    await search(query, titles, function () { return check.click(); });
    assert.equal(await input.inputValue(), query);
    assert.equal(await chooser.getAttribute('aria-expanded'), 'true');
    assert.ok(await check.evaluate(function (el) { return document.activeElement === el; }));
  }

  await chooser.click();
  assert.ok(await input.isVisible());
  assert.equal(await chooser.getAttribute('aria-expanded'), 'true');
  assert.ok(await scope('Title').evaluate(function (el) { return el === document.activeElement; }));
  await chooser.click();

  // Model a pointer press whose native focus action blurs the input without
  // focusing the button. Hold the press until the empty-search blur timer runs.
  await input.focus();
  await chooser.evaluate(function (button) {
    button.addEventListener('mousedown', function (event) {
      event.preventDefault();
      document.activeElement.blur();
    }, { once: true });
  });
  var triggerBox = await chooser.boundingBox();
  await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
  await page.mouse.down();
  await page.evaluate(function () {
    return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  });
  await page.mouse.up();
  assert.ok(await input.isVisible(), 'an empty search stays open from press to click');
  assert.equal(await chooser.getAttribute('aria-expanded'), 'true');
  assert.ok(await scope('Title').evaluate(function (el) { return el === document.activeElement; }));
  await page.keyboard.press('Escape');

  await input.press('Tab');
  assert.ok(await chooser.evaluate(function (el) { return el === document.activeElement; }));
  var fieldBox = await input.boundingBox();
  await page.keyboard.press('Enter');
  assert.deepEqual(await input.boundingBox(), fieldBox);
  assert.equal(await scope('Title').evaluate(function (el) { return el === document.activeElement ? 'focused' : document.activeElement.tagName; }), 'focused', JSON.stringify(errors));
  assert.deepEqual(await filters.locator('label').allTextContents(), allScopes);
  await assertPickerFits(filters, chooser, false);
  await assertScopes([]);
  assert.match(await filters.getAttribute('aria-describedby'), /default/);
  await page.keyboard.press('Space');
  await assertScopes(['Title']);
  assert.equal(await input.getAttribute('placeholder'), 'Search sessions');
  assert.equal(await chooser.getAttribute('aria-label'), 'Search in: Title');
  await page.keyboard.press('Escape');
  await assertPickerClosed('');
  await closeSearchWithEscape();
  await opener.click();

  function row(title) {
    return sidebar.locator('.session-item').filter({ has: page.locator('.session-item-title').filter({ hasText: title }) });
  }
  var appRow = row(app);
  var both = await search('tools', [app, tools]);
  var countLayouts = [];
  async function measureCounts(surface, target) {
    var layouts = await target.locator('.session-search-field').evaluate(function (field) {
      var input = field.querySelector('input');
      var count = field.querySelector('.session-search-count');
      var clear = field.querySelector('.session-search-clear');
      var shownCount = count.textContent;
      return [shownCount, '12500'].map(function (digits) {
        count.textContent = digits;
        var inputBox = input.getBoundingClientRect();
        var countBox = count.getBoundingClientRect();
        var clearBox = clear.getBoundingClientRect();
        var fieldBox = field.getBoundingClientRect();
        var inputStyle = getComputedStyle(input);
        var textRight = inputBox.right - parseFloat(inputStyle.paddingRight) - parseFloat(inputStyle.borderRightWidth);
        var range = new Range();
        range.selectNodeContents(count);
        var layout = {
          digits: digits,
          width: countBox.width,
          textWidth: range.getBoundingClientRect().width,
          queryWidth: textRight - inputBox.left - parseFloat(inputStyle.paddingLeft),
          inputGap: countBox.left - textRight,
          clearGap: clearBox.left - countBox.right,
          fieldGap: fieldBox.right - clearBox.right,
        };
        count.textContent = shownCount;
        return layout;
      });
    });
    countLayouts.push({ surface: surface, layouts: layouts });
  }
  await measureCounts('240px desktop', toolbar);
  var sidebarColumn = page.locator('#sidebar-column');
  var originalWidth = await sidebarColumn.evaluate(function (el) { var width = el.style.width; el.style.width = '192px'; return width; });
  assert.equal((await sidebarColumn.boundingBox()).width, 192);
  await measureCounts('192px desktop', toolbar);
  await openChooser();
  await assertPickerFits(filters, chooser, false);
  await input.click();
  assert.equal(await filters.count(), 0);
  assert.ok(await input.evaluate(function (el) { return el === document.activeElement; }));
  await sidebarColumn.evaluate(function (el, width) { el.style.width = width; }, originalWidth);
  assert.equal(await appRow.getByText('Message match', { exact: true }).count(), 1);
  assert.equal(await sidebar.locator('.session-item-title mark').textContent(), 'tools');

  await toggle('Title', 'tools', [tools]);
  await assertScopes(['Title']);
  await toggle('Title', 'tools', []);
  assert.equal(await chooser.getAttribute('aria-label'), 'Search in: No scopes selected');
  assert.equal(await input.getAttribute('placeholder'), 'Search sessions');
  await toggle('Messages', 'tools', [app]);
  await assertScopes(['Messages']);

  var stale = responseFor('tools');
  await page.evaluate(async function (requestId) {
    (await import('/p/reuse/modules/ws-ref.js')).getWs().send(JSON.stringify({
      type: 'search_sessions', source: 'sidebar', query: 'tools', scopes: ['title', 'chat'], requestId: requestId,
    }));
  }, both.requestId);
  assert.equal((await stale).results.length, 2);
  await page.evaluate(function () {
    return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  });
  await assertRows([app]);

  // Escape in the same browser task as a toolbar replacement, before the
  // picker's observer has had a chance to re-anchor to the new trigger.
  var replaced = await page.evaluate(async function () {
    var sidebar = await import('/p/reuse/modules/sidebar-sessions.js');
    var oldTrigger = document.querySelector('[data-search-scope-trigger="desktop"]');
    sidebar.renderSessionList(null);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    }));
    return !oldTrigger.isConnected;
  });
  assert.ok(replaced, 'the test replaced the toolbar before dismissing the picker');
  await assertPickerClosed('tools');
  await closeSearchWithEscape();
  await opener.click();
  assert.equal(await chooser.getAttribute('aria-label'), 'Search in: Default: Title + Messages');
  await search('1067', [app, 'Mention only']);
  await openChooser();
  await scope('Linear').focus();
  await page.keyboard.press('Tab');
  assert.ok(await action('Select all').evaluate(function (el) { return document.activeElement === el; }));
  await page.keyboard.press('Tab');
  assert.ok(await action('Clear all').evaluate(function (el) { return document.activeElement === el; }));
  await search('1067', [], function () { return page.keyboard.press('Space'); });
  assert.ok(await action('Clear all').evaluate(function (el) { return document.activeElement === el; }));
  assert.equal(await input.inputValue(), '1067');
  await assertScopes([]);
  assert.equal(await input.getAttribute('placeholder'), 'Search sessions');
  assert.equal(await chooser.getAttribute('aria-label'), 'Search in: No scopes selected');

  await page.keyboard.press('Shift+Tab');
  assert.ok(await action('Select all').evaluate(function (el) { return document.activeElement === el; }));
  await search('1067', [app, tools, 'Mention only'], function () { return page.keyboard.press('Enter'); });
  assert.ok(await action('Select all').evaluate(function (el) { return document.activeElement === el; }));
  assert.equal(await input.inputValue(), '1067');
  await assertScopes(allScopes);
  assert.equal(await chooser.getAttribute('aria-label'), 'Search in: All scopes');
  assert.equal(await appRow.locator('.session-item-title mark').textContent(), '1067');
  assert.equal(await appRow.locator('a.session-work-search-match').count(), 2);
  assert.equal(await row('Mention only').getByText('Message match', { exact: true }).count(), 1);

  await page.keyboard.press('Escape');
  await assertPickerClosed('1067');
  await closeSearchWithEscape();
  await opener.click();
  assert.equal(await chooser.getAttribute('aria-label'), 'Search in: Default: Title + Messages');
  await search('1067', [app, 'Mention only']);
  await toggle('PR', '1067', [app]);
  await assertScopes(['PR']);
  assert.equal(await sidebar.locator('.session-item-title mark').count(), 0);
  var combined = await search('1067', [app, tools], function () { return scope('Linear').click(); });
  await assertScopes(['PR', 'Linear']);
  var matches = combined.results.find(function (result) { return result.title === app; }).matches;
  assert.deepEqual(matches, { title: false, chat: false, links: [
    { kind: 'pr', url: 'https://github.com/Acme/App/pull/1067' },
    { kind: 'pr', url: 'https://github.com/Acme/More/pull/1067' },
    { kind: 'linear', url: 'https://linear.app/acme/issue/TLE-1067' },
    { kind: 'linear', url: 'https://linear.app/acme/issue/ALT-1067' },
  ] });
  assert.equal(await appRow.locator('a.session-work-search-match').count(), 2);
  await page.keyboard.press('Escape');
  assert.equal(await chooser.getAttribute('aria-expanded'), 'false');
  await appRow.getByRole('button', { name: /2 additional search matches/ }).click();
  var popover = page.locator('.github-work-popover');
  await popover.waitFor();
  assert.equal(await popover.locator('a.session-work-search-match').count(), 4);
  assert.equal(await popover.locator('a.session-work-search-match[href$="10670"]').count(), 0);
  await page.keyboard.press('Escape');

  await toggle('Title', '1067', [app, tools]);
  assert.equal(await appRow.locator('.session-item-title mark').textContent(), '1067');
  assert.equal(await appRow.locator('a.session-work-search-match').count(), 2);
  await toggle('Title', '1067', [app, tools]);
  await search('ACME/more#1067', [app]);
  await search('acme/tools#1067', []);
  await toggle('Issue', 'acme/tools#1067', [tools]);
  assert.equal(await sidebar.locator('.github-kind-issue.session-work-search-match').count(), 1);
  await search('10670', [app, 'Nearby links']);
  await search('106', []);
  await search('tle-1067', [app]);
  await search('alt-1067', [app, tools]);
  await search('pr:1067', []);

  var legacy = responseFor('pr:1067');
  await page.evaluate(async function () {
    (await import('/p/reuse/modules/ws-ref.js')).getWs().send(JSON.stringify({ type: 'search_sessions', query: 'pr:1067' }));
  });
  var legacyResults = (await legacy).results;
  assert.deepEqual(legacyResults.map(function (result) { return result.title; }), ['Mention only']);
  assert.equal(legacyResults[0].matches, undefined);
  await assertRows([]);
  await toolbar.getByRole('button', { name: 'Clear search text' }).click();
  await assertRows(fullList);
  assert.equal(await input.inputValue(), '');
  assert.equal(await chooser.getAttribute('aria-label'), 'Search in: PR, Issue, Linear');
  await input.press('Escape');
  await input.waitFor({ state: 'detached' });
  assert.equal(await filters.count(), 0);
  assert.equal(await rows.count(), fullList.length);

  var mobilePage = await browser.newPage({ viewport: { width: 320, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  await loadFixture(mobilePage);
  await mobilePage.locator('#mob-tab-chat').tap();
  var sheet = mobilePage.locator('#mobile-sheet');
  await sheet.getByRole('button', { name: 'Search sessions', exact: true }).tap();
  var mobileFilters = mobilePage.getByRole('dialog', { name: 'Search scopes' });
  var mobileChooser = sheet.getByRole('button', { name: /^Search in:/ });
  var mobileInput = sheet.getByRole('searchbox', { name: 'Search sessions' });
  assert.equal(await mobileInput.getAttribute('placeholder'), 'Search titles and messages');
  await assertPlaceholderFits(mobileInput);
  assert.ok((await mobileChooser.boundingBox()).height >= 44);
  await mobileChooser.tap();
  await assertPickerFits(mobileFilters, mobileChooser, true);
  assert.equal(await mobileFilters.getByRole('checkbox', { checked: true }).count(), 0);
  var mobileLinear = mobileFilters.getByRole('checkbox', { name: 'Linear', exact: true });
  await mobileFilters.locator('label').filter({ hasText: 'Linear' }).tap();
  assert.equal(await mobileInput.getAttribute('placeholder'), 'Search sessions');
  assert.ok(await mobileLinear.isChecked());
  await mobileInput.tap();
  assert.equal(await mobileFilters.count(), 0);
  var mobileResponse = responseFor('1067');
  await mobileInput.fill('1067');
  assert.deepEqual((await mobileResponse).results.map(function (result) { return result.title; }).sort(), [app, tools]);
  await sheet.getByRole('button', { name: app, exact: true }).waitFor();
  assert.equal(await sheet.locator('.session-linear-link.session-work-search-match').count(), 2);
  assert.equal(await sheet.getByRole('button', { name: 'Mention only', exact: true }).count(), 0);
  await measureCounts('320px mobile', sheet);
  await mobileChooser.tap();
  var mobileAll = responseFor('1067');
  await mobileFilters.getByRole('button', { name: 'Select all', exact: true }).tap();
  assert.equal((await mobileAll).results.length, 3);
  await sheet.getByRole('button', { name: 'Mention only', exact: true }).waitFor();
  assert.equal(await mobileFilters.getByRole('checkbox', { checked: true }).count(), 5);
  assert.equal(await mobileInput.inputValue(), '1067');
  var mobileNone = responseFor('1067');
  await mobileFilters.getByRole('button', { name: 'Clear all', exact: true }).tap();
  assert.equal((await mobileNone).results.length, 0);
  await sheet.getByRole('button', { name: app, exact: true }).waitFor({ state: 'detached' });
  assert.equal(await mobileFilters.getByRole('checkbox', { checked: true }).count(), 0);
  assert.equal(await mobileInput.inputValue(), '1067');
  for (var measurement of countLayouts) {
    for (var layout of measurement.layouts) {
      assert.ok(layout.width - layout.textWidth >= 6 && layout.width - layout.textWidth <= 12 &&
        layout.queryWidth >= 40 && layout.inputGap >= 2 && layout.clearGap >= 2 && layout.fieldGap >= 0,
        JSON.stringify(countLayouts));
    }
  }
  assert.deepEqual(errors, []);
});
