var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');

test('different Mate popovers preserve native workspace ownership and nested Back in both directions', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var output = ''; child.stdout.on('data', function (data) { output += data; }); child.stderr.on('data', function (data) { output += data; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(async function () { await browser.close(); });
  var origin = 'http://127.0.0.1:' + info.port;
  var clay = { id: info.sourceSlug.slice(5), slug: info.sourceSlug, canonical: true };
  var pairs = [[clay, info.ordinaryMates[0]], [info.ordinaryMates[0], clay], [info.ordinaryMates[0], info.ordinaryMates[1]]];
  for (var pair of pairs) {
    var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(10000);
    var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
    var from = pair[0], to = pair[1];
    function icon(mate) { return mate.canonical ? page.locator('.icon-strip-brand') : page.locator('.icon-strip-project-mate[data-mate-id="' + mate.id + '"]'); }
    function pane(mate) { return page.frameLocator('#contextual-clay iframe[data-mate-id="' + mate.id + '"]'); }
    async function ready(mate) {
      await page.waitForFunction(function (id) { var f = document.querySelector('#contextual-clay iframe[data-mate-id="' + id + '"]'); return f && f.conversation && f.conversation.identity().ready; }, mate.id);
      await pane(mate).locator('#input-wrapper:not([inert])').waitFor();
    }
    async function native(mate) {
      await page.waitForURL('**/p/' + mate.slug + '/');
      await page.waitForFunction(function (slug) { var s = window.overlayStore; return s.get('currentSlug') === slug && s.get('contextualWorkspace') && s.get('contextualWorkspace').stage === 'workspace' && !document.getElementById('input-wrapper').inert; }, mate.slug);
    }
    await page.goto(origin + '/fixture/login?to=alpha');
    await page.evaluate(async function () { window.overlayStore = (await import('/p/alpha/modules/store.js')).store; });
    await page.locator('#input').fill('Origin project draft');
    await icon(from).click(); await ready(from);
    await pane(from).locator('#input').fill('Native owner ' + from.id);
    await icon(from).click();
    await native(from);
    var session = await page.evaluate(function () { return window.overlayStore.get('activeSessionId'); });
    var header = await page.locator('#header-left').textContent();
    var chooser = page.waitForEvent('filechooser'); await page.locator('#attach-file-btn').click();
    await (await chooser).setFiles({ name: 'native-owner.txt', mimeType: 'text/plain', buffer: Buffer.from('Native attachment') });
    await page.locator('#image-preview-bar').getByText('native-owner.txt', { exact: false }).waitFor();
    var review, reviewId;
    if (from.canonical) {
      await page.request.get(origin + '/fixture/stream');
      await page.locator('#messages').getByText('CONTEXTUAL_STREAM_CONTINUES', { exact: false }).waitFor();
    } else {
      review = page.request.get(origin + '/fixture/ordinary-question?index=0');
      await page.locator('.ask-user-container:not(.answered)').waitFor();
      reviewId = await page.locator('.ask-user-container:not(.answered)').getAttribute('data-tool-id');
    }
    await icon(to).focus(); await page.keyboard.press('Enter');
    await ready(to);
    assert.equal(new URL(page.url()).pathname, '/p/' + from.slug + '/');
    assert.equal(await page.evaluate(function () { return window.overlayStore.get('activeSessionId'); }), session);
    assert.equal(await page.locator('#header-left').textContent(), header);
    assert.equal(await page.locator('#input').inputValue(), 'Native owner ' + from.id);
    assert.equal(await page.locator('#input-wrapper').evaluate(function (node) { return node.inert; }), false);
    assert.equal(await pane(from).locator('#input').inputValue(), '', 'Hidden source pane does not own the native draft');
    assert.equal(await pane(from).locator('#input').evaluate(function (node) { return node.readOnly; }), true);
    assert.equal(await pane(to).locator('#image-preview-bar').getByText('native-owner.txt').count(), 0);
    await pane(to).locator('#input').fill('Separate overlay ' + to.id);
    if (!to.canonical) {
      await page.locator('[data-clay-context]').filter({ hasText: 'Conversation context unavailable' }).waitFor();
      var targetFrame = page.frames().find(function (frame) { return frame.url().includes(to.slug); });
      assert.equal(await targetFrame.evaluate(async function () { return (await import('./modules/contextual-mate-context.js')).contextualAccessReference(); }), null, 'Private background Mate does not become an ordinary context grant');
    }
    if (from.canonical) assert.match(await page.locator('#messages').textContent(), /CONTEXTUAL_STREAM_CONTINUES/);
    else assert.equal(await page.locator('.ask-user-container:not(.answered)').getAttribute('data-tool-id'), reviewId);
    await pane(to).locator('#input').press('Escape');
    assert.equal(await page.locator('#contextual-clay').isVisible(), false);
    assert.equal(new URL(page.url()).pathname, '/p/' + from.slug + '/');
    assert.equal(await page.locator('#input').inputValue(), 'Native owner ' + from.id);
    await icon(to).click(); await ready(to);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await pane(to).locator('#input').inputValue(), 'Separate overlay ' + to.id);
    await page.locator('[data-clay-close]').click();
    assert.equal(new URL(page.url()).pathname, '/p/' + from.slug + '/');
    await page.setViewportSize({ width: 1280, height: 800 });
    await icon(to).click(); await ready(to);
    if (to.canonical) await icon(to).click();
    else await page.locator('[data-clay-expand]').click();
    await native(to);
    assert.match(await page.locator('#contextual-workspace-back').textContent(), from.canonical ? /Back to Clay/ : /Back to Arch/);
    assert.equal(await page.locator('#input').inputValue(), 'Separate overlay ' + to.id);
    await page.locator('#input').fill('Edited destination ' + to.id);
    await page.locator('#contextual-workspace-back').click(); await native(from);
    assert.equal(await page.locator('#input').inputValue(), 'Native owner ' + from.id);
    assert.match(await page.locator('#image-preview-bar').textContent(), /native-owner/);
    assert.equal(await pane(to).locator('#input').inputValue(), 'Edited destination ' + to.id);
    if (review) {
      var card = page.locator('.ask-user-container[data-tool-id="' + reviewId + '"]');
      await card.getByText('Tests', { exact: true }).click(); await card.locator('.ask-user-submit').click();
      assert.equal((await (await review).json()).status, 'submitted');
    }
    await page.locator('#contextual-workspace-back').click(); await page.waitForURL('**/p/alpha/');
    await page.waitForFunction(function () { return !window.overlayStore.get('contextualWorkspace') && document.getElementById('input').value === 'Origin project draft'; });
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (var pair of pairs.slice(0, 2)) {
    var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(10000);
    var from = pair[0], to = pair[1];
    function directIcon(mate) { return mate.canonical ? page.locator('.icon-strip-brand') : page.locator('.icon-strip-project-mate[data-mate-id="' + mate.id + '"]'); }
    await page.goto(origin + '/fixture/login?to=alpha');
    await page.goto(origin + '/p/' + from.slug + '/');
    await page.locator('#messages').getByText(from.canonical ? 'Isolated canonical integration conversation.' : 'ORDINARY_MATE_0_PRIVATE_HISTORY', { exact: false }).waitFor();
    await page.evaluate(async function () { window.directStore = (await import('./modules/store.js')).store; });
    await page.waitForFunction(function () { return window.directStore.get('activeSessionId') && !window.directStore.get('replayingHistory'); });
    var session = await page.evaluate(function () { return window.directStore.get('activeSessionId'); });
    await page.locator('#input').fill('Direct native owner');
    await directIcon(to).click();
    var overlay = page.frameLocator('#contextual-clay iframe[data-mate-id="' + to.id + '"]');
    await page.waitForFunction(function (id) { var frame = document.querySelector('#contextual-clay iframe[data-mate-id="' + id + '"]'); return frame && frame.conversation && frame.conversation.identity().ready; }, to.id);
    assert.equal(new URL(page.url()).pathname, '/p/' + from.slug + '/');
    assert.equal(await page.locator('#input').inputValue(), 'Direct native owner');
    assert.equal(await page.evaluate(function () { return window.directStore.get('activeSessionId'); }), session);
    await overlay.locator('#input').fill('Direct overlay owner');
    await overlay.locator('#input').press('Escape');
    assert.equal(new URL(page.url()).pathname, '/p/' + from.slug + '/');
    await directIcon(to).click(); await directIcon(to).click();
    await page.waitForURL('**/p/' + to.slug + '/');
    await page.waitForFunction(function () { return window.directStore.get('contextualWorkspace').stage === 'workspace'; });
    assert.equal(await page.locator('#input').inputValue(), 'Direct overlay owner');
    await page.locator('#contextual-workspace-back').click(); await page.waitForURL('**/p/' + from.slug + '/');
    await page.waitForFunction(function () { return !window.directStore.get('contextualWorkspace') && !document.getElementById('input-wrapper').inert && document.getElementById('input').value === 'Direct native owner'; });
    assert.equal(await page.evaluate(function () { return window.directStore.get('activeSessionId'); }), session);
    await page.close();
  }
  t.diagnostic('Clay → Arch, Arch → Clay and Arch → ordinary: first keyboard click and Escape/close preserve native route/session/header/draft/attachment and pending stream/review; explicit Open transfers exact draft; Back restores native owner then project. Private Mate context grants remain unavailable.');
});
