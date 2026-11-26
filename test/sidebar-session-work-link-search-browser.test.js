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
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  var socket, errors = [], base = 'http://127.0.0.1:' + info.port;
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('websocket', function (ws) { if (!socket) socket = ws; });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(base + '/fixture/login?account=replacement');
  var sidebar = page.locator('#session-list');
  var rows = sidebar.locator('.session-item-title');
  var fullList = ['Linked app work', 'Linked tools work', 'Mention only pr:123', 'Nearby links'];
  async function assertRows(titles) {
    await page.waitForFunction(function (expected) {
      var visible = Array.from(document.querySelectorAll('#session-list .session-item-title')).filter(function (el) { return el.getClientRects().length > 0; });
      return JSON.stringify(visible.map(function (el) { return el.textContent.trim(); }).sort()) === JSON.stringify(expected);
    }, titles.slice().sort());
  }
  await assertRows(fullList);
  var toolbar = sidebar.locator('.session-folder-toolbar');
  var original = await toolbar.boundingBox();
  await toolbar.getByRole('button', { name: 'Search sessions', exact: true }).click();
  var input = toolbar.getByRole('searchbox', { name: 'Search sessions', exact: true });
  assert.equal(await input.getAttribute('placeholder'), 'pr:123 or linear:CLAY-123');
  assert.deepEqual(await toolbar.boundingBox(), original);
  var filters = sidebar.getByRole('group', { name: 'Search scopes' });
  assert.deepEqual(await filters.getByRole('button').allTextContents(), ['Title', 'Chat content', 'PR', 'Issue', 'Linear']);
  assert.equal((await page.locator('#sidebar-column').boundingBox()).width, 240);
  await page.evaluate(function () { return document.fonts.ready.then(function () {}); });
  assert.ok(await filters.getByRole('button').evaluateAll(function (buttons) {
    var row = buttons[0].parentElement.getBoundingClientRect();
    var top = buttons[0].getBoundingClientRect().top;
    return buttons.every(function (button) {
      var box = button.getBoundingClientRect();
      return box.top === top && box.left >= row.left && box.right <= row.right;
    });
  }), 'pills fit on one row at the default desktop sidebar width');
  function scope(name) { return filters.getByRole('button', { name: name, exact: true }); }
  async function assertScopes(expected) {
    assert.deepEqual(await filters.locator('[aria-pressed="true"]').allTextContents(), expected);
  }
  await assertScopes(['Title', 'Chat content']);
  assert.match(await scope('GitHub issue').getAttribute('aria-description'), /owner\/repo#123/);
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
    var button = scope(name);
    await search(query, titles, function () { return button.click(); });
    assert.equal(await input.inputValue(), query);
    assert.ok(await button.evaluate(function (el) { return document.activeElement === el; }));
  }

  await input.press('Tab');
  assert.ok(await scope('Title').evaluate(function (el) { return el === document.activeElement; }));
  await page.keyboard.press('Space');
  await assertScopes(['Chat content']);
  await page.keyboard.press('Enter');
  await assertScopes(['Title', 'Chat content']);
  var both = await search('tools', ['Linked app work', 'Linked tools work']);
  await toggle('Chat content', 'tools', ['Linked tools work']);
  await assertScopes(['Title']);
  await toggle('Title', 'tools', []);
  assert.ok(await sidebar.getByText('Select a scope or type a link prefix.').isVisible());
  await toggle('Chat content', 'tools', ['Linked app work']);
  await assertScopes(['Chat content']);

  // Deliver an actual reply for the same query and former scopes after the newer result.
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
  await assertRows(['Linked app work']);

  await search('123', ['Mention only pr:123']);
  await toggle('PR', '123', ['Mention only pr:123', 'Linked app work', 'Linked tools work']);
  await toggle('GitHub issue', '123', ['Mention only pr:123', 'Linked app work', 'Linked tools work', 'Nearby links']);
  await toggle('Chat content', '123', ['Linked app work', 'Linked tools work', 'Nearby links']);
  await search('ACME/app#123', ['Linked app work', 'Nearby links']);
  await toggle('PR', 'ACME/app#123', ['Nearby links']);
  await toggle('GitHub issue', 'ACME/app#123', []);
  await search('Issue:123', ['Linked tools work', 'Nearby links']);
  await search('issue:acme/tools#123', ['Linked tools work']);
  await search('issue:12', []);
  await search('issue:1234', []);
  await search(' Pr:123 ', ['Linked app work', 'Linked tools work']);
  await search('pr:acme/missing#123', []);
  await search('pr:12', []);
  await search('pr:1234', ['Nearby links']);
  await search('linear:clay-123', ['Linked app work']);
  await search('LINEAR:CLAY-1234', ['Nearby links']);
  await search('linear:CLAY-12', []);
  await search('CLAY-123', []);
  await toggle('Linear', 'CLAY-123', ['Linked app work']);
  await search('clay-1234', ['Nearby links']);
  await search('clay-12', []);

  var legacy = responseFor('pr:123');
  await page.evaluate(async function () {
    (await import('/p/reuse/modules/ws-ref.js')).getWs().send(JSON.stringify({ type: 'search_sessions', query: 'pr:123' }));
  });
  assert.deepEqual((await legacy).results.map(function (result) { return result.title; }), ['Mention only pr:123']);
  await assertRows([]);
  await toolbar.getByRole('button', { name: 'Clear search text' }).click();
  await assertRows(fullList);
  assert.equal(await input.inputValue(), '');
  await assertScopes(['Linear']);
  await input.press('Escape');
  await input.waitFor({ state: 'detached' });
  assert.equal(await filters.count(), 0);
  assert.equal(await rows.count(), fullList.length);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mob-tab-chat').click();
  var sheet = page.locator('#mobile-sheet');
  await sheet.getByRole('button', { name: 'Search sessions', exact: true }).click();
  var mobileLinear = sheet.getByRole('button', { name: 'Linear', exact: true });
  assert.deepEqual(await sheet.locator('.session-search-filters [aria-pressed="true"]').allTextContents(), ['Title', 'Chat content']);
  assert.ok(await sheet.getByRole('group', { name: 'Search scopes' }).getByRole('button').evaluateAll(function (buttons) {
    return buttons.every(function (button) {
      var box = button.getBoundingClientRect();
      return box.width >= 44 && box.height >= 44;
    });
  }));
  await mobileLinear.click();
  await sheet.getByRole('button', { name: 'Chat content', exact: true }).click();
  var mobileInput = sheet.getByRole('searchbox', { name: 'Search sessions' });
  assert.equal(await mobileInput.getAttribute('placeholder'), 'pr:123 or linear:CLAY-123');
  assert.equal(await mobileInput.inputValue(), '');
  assert.equal(await mobileLinear.getAttribute('aria-pressed'), 'true');
  var mobileResponse = responseFor('CLAY-123');
  await mobileInput.pressSequentially('CLAY-123');
  assert.deepEqual((await mobileResponse).results.map(function (result) { return result.title; }), ['Linked app work']);
  await sheet.getByRole('button', { name: 'Linked app work', exact: true }).waitFor();
  assert.equal(await sheet.getByRole('button', { name: 'Nearby links', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});
