var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');
test('ordinary Mate message shares real context; selected read, review and navigation use production services', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); var output = '';
  child.stdout.on('data', function (v) { output += v; }); child.stderr.on('data', function (v) { output += v; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (v) { clearTimeout(timer); resolve(v); }); });
  var browser = await playwright.chromium.launch(); t.after(async function () { await browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(10000);
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  var origin = 'http://127.0.0.1:' + info.port, mate = info.ordinaryMates[0];
  await page.goto(origin + '/fixture/login?to=alpha', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.locator('.icon-strip-project-mate[data-mate-id="' + mate.id + '"]').click();
  var frame = page.frameLocator('#contextual-clay iframe[data-mate-id="' + mate.id + '"]');
  await frame.locator('#input-wrapper:not([inert])').waitFor();
  await page.locator('[data-clay-context]').filter({ hasText: 'Alpha integration · Next message' }).waitFor();
  assert.equal(await page.getByRole('note', { name: 'Clay capabilities', exact: true }).count(), 0, 'Ordinary Mates do not receive the canonical capability summary');
  var help = page.getByLabel('What this Mate can see', { exact: true });
  var beforeHelp = await page.locator('#contextual-clay').boundingBox(); await help.click();
  assert.deepEqual(await page.locator('#contextual-clay').boundingBox(), beforeHelp);
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /Alpha destination/);
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /read up to 20 text turns.*after your review/);
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /Issues, documents, other tabs, files and settings are unavailable/);
  assert.equal(await help.locator('svg').count(), 1);
  await page.screenshot({ path: '/tmp/mate-context-help-light.png', animations: 'disabled' });
  await page.evaluate(async function () { (await import('/p/alpha/modules/theme.js')).applyTheme('clay-dark'); });
  await page.setViewportSize({ width: 390, height: 844 });
  var narrowHelp = await page.locator('.contextual-clay-context p').boundingBox();
  assert.ok(narrowHelp.x >= 0 && narrowHelp.x + narrowHelp.width <= 390);
  await page.screenshot({ path: '/tmp/mate-context-help-narrow-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(async function () { (await import('/p/alpha/modules/theme.js')).applyTheme('clay-light'); });
  await help.press('Escape'); await page.locator('[data-clay-context]').waitFor();
  await frame.locator('#input').fill('Read the current selected conversation context.'); await frame.locator('#send-btn').click();
  await page.locator('[data-clay-context]').filter({ hasText: 'Alpha integration · Shared' }).waitFor();
  async function call(name, args) { return (await page.request.get(origin + '/fixture/context-tool?name=' + name + '&args=' + encodeURIComponent(JSON.stringify(args || {})))).json(); }
  var current = await call('read_current_context'); assert.equal(current.status, 'shared_snapshot', JSON.stringify(current));
  var read = await call('read_selected_context', { contextRef: current.contextRef }); assert.match(JSON.stringify(read), /ALPHA_RENDERED_DESTINATION/);
  var navigation = call('open_context_conversation', { contextRef: current.contextRef, requestId: 'browser-open', why: 'Open the conversation I am reviewing' });
  var review = frame.locator('.ask-user-container:not(.answered)'); await review.waitFor();
  await review.getByText('Apply exact change', { exact: true }).click(); await review.locator('.ask-user-submit').click();
  var delivery = await navigation; assert.equal(delivery.delivered, true, JSON.stringify(delivery));
  await page.waitForFunction(function () { return !document.getElementById('contextual-clay') || document.getElementById('contextual-clay').hidden; });
  await page.locator('#messages').getByText('ALPHA_RENDERED_DESTINATION', { exact: true }).waitFor();
  // Reopen on the same authoritative conversation; a changed project must not
  // silently grant the old query a new selected target.
  await page.locator('.icon-strip-project-mate[data-mate-id="' + mate.id + '"]').click();
  await frame.locator('#input-wrapper:not([inert])').waitFor();
  await page.evaluate(async function () { (await import('/p/alpha/modules/store.js')).store.set({ rightWorkbenchOwner: 'issues', rightWorkbenchRevision: 99 }); });
  await page.locator('[data-clay-context]').filter({ hasText: 'Unavailable' }).waitFor();
  await help.click(); assert.match(await page.locator('.contextual-clay-context p').textContent(), /context is stale/);
  assert.equal((await call('read_selected_context', { contextRef: current.contextRef })).status, 'failed');
  await page.evaluate(async function () { (await import('/p/alpha/modules/store.js')).store.set({ rightWorkbenchOwner: null, rightWorkbenchRevision: 100 }); });
  await page.locator('.icon-strip-brand').click();
  var canonical = page.frameLocator('#contextual-clay iframe[data-canonical="true"]');
  await canonical.locator('#messages').getByText('Isolated canonical integration conversation.', { exact: true }).waitFor();
  await canonical.locator('#input-wrapper:not([inert])').waitFor();
  var canonicalSummary = page.getByRole('note', { name: 'Clay capabilities', exact: true });
  assert.equal(await canonicalSummary.count(), 1);
  assert.equal(await canonicalSummary.textContent(), 'I can control Clay Studio for you—manage projects, coordinate work, set up schedules, and navigate your workspace. Just tell me what you’d like done.');
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /I can help manage your projects, coordinate work with Drivers.*I’ll ask you to review actions when needed/);
  assert.equal(await page.getByRole('note', { name: 'Shared context capabilities', exact: true }).count(), 0);
  assert.equal(await help.count(), 1);
  assert.ok((await canonicalSummary.boundingBox()).height <= 64);
  if (await page.locator('.contextual-clay-context').getAttribute('open') !== null) await help.click();
  for (var variant of [{ width: 1280, theme: 'light' }, { width: 1280, theme: 'dark' }, { width: 390, theme: 'light' }, { width: 390, theme: 'dark' }]) {
    await page.setViewportSize({ width: variant.width, height: variant.width === 390 ? 844 : 800 });
    for (var themedFrame of page.frames()) await themedFrame.evaluate(async function (theme) { (await import('./modules/theme.js')).applyTheme('clay-' + theme); await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); }); }, variant.theme);
    var appearance = await canonicalSummary.evaluate(function (element) {
      var style = getComputedStyle(element), canvas = document.createElement('canvas'), context = canvas.getContext('2d');
      function rgb(color) { context.fillStyle = color; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3); }
      function luminance(color) { var values = color.map(function (channel) { var value = channel / 255; return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4); }); return .2126 * values[0] + .7152 * values[1] + .0722 * values[2]; }
      var foreground = rgb(style.color), background = rgb(style.backgroundColor), first = luminance(foreground), second = luminance(background);
      return { foreground: foreground, background: background, contrast: (Math.max(first, second) + .05) / (Math.min(first, second) + .05), height: element.getBoundingClientRect().height };
    });
    assert.ok(appearance.contrast >= 4.5, 'Capability copy remains readable: ' + JSON.stringify(appearance));
    assert.ok(appearance.height <= (variant.width === 390 ? 80 : 64), 'The approved introduction wraps without crowding the conversation');
    for (var action of ['[data-mate-new]', '[data-clay-expand]']) { var button = page.locator(action); assert.equal((await button.innerText()).trim(), ''); assert.ok(await button.getAttribute('aria-label')); assert.ok(await button.getAttribute('title')); assert.ok((await button.boundingBox()).width >= 28); }
    assert.equal(await canonical.locator('#messages .msg-assistant .md-content').first().evaluate(function (element) { return getComputedStyle(element).fontSize; }), '15px');
    t.diagnostic('Capability ' + variant.width + ' ' + variant.theme + ': ' + JSON.stringify(appearance));
    await page.screenshot({ path: '/tmp/clay-capabilities-' + (variant.width === 390 ? 'narrow' : 'desktop') + '-' + variant.theme + '.png', animations: 'disabled' });
  }

  await page.evaluate(async function () {
    var store = (await import('/p/alpha/modules/store.js')).store;
    window.headerOriginalProjects = store.get('projectsHubList');
    store.set({ projectsHubList: window.headerOriginalProjects.map(function (project) { return project.slug === 'alpha' ? Object.assign({}, project, { title: 'Alpha project with a deliberately long and detailed human name for the header' }) : project; }) });
  });
  var projectLabel = page.locator('[data-context-project]'), stateLabel = page.locator('[data-context-status]');
  assert.ok((await projectLabel.boundingBox()).width < await projectLabel.evaluate(function (node) { return node.scrollWidth; }));
  var stateBounds = await stateLabel.boundingBox(), headerBounds = await page.locator('#contextual-clay header').boundingBox();
  assert.ok(stateBounds.x + stateBounds.width <= headerBounds.x + headerBounds.width);
  assert.match(await stateLabel.textContent(), /Next message/);
  await help.click();
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /Alpha project with a deliberately long and detailed human name/);
  await page.screenshot({ path: '/tmp/clay-header-long-project-narrow.png', animations: 'disabled' });
  await help.press('Escape'); assert.equal(await page.locator('#contextual-clay').isVisible(), true);
  await page.evaluate(async function () { (await import('/p/alpha/modules/store.js')).store.set({ projectsHubList: window.headerOriginalProjects }); });
  await page.evaluate(async function () { (await import('/p/alpha/modules/theme.js')).applyTheme('clay-dark'); });
  await page.setViewportSize({ width: 390, height: 844 });
  var capabilityBox = await canonicalSummary.boundingBox();
  var conversationBox = await page.locator('#contextual-clay iframe:visible').boundingBox();
  assert.ok(capabilityBox.x >= 0 && capabilityBox.x + capabilityBox.width <= 390 && capabilityBox.height <= 80);
  assert.ok(conversationBox.height >= 400, 'The summary preserves the narrow conversation space');
  assert.ok(capabilityBox.y + capabilityBox.height <= conversationBox.y + 1, 'Summary precedes the transcript');
  assert.equal(await canonicalSummary.evaluate(function (element) { return element.scrollWidth <= element.clientWidth; }), true);
  if (await page.locator('.contextual-clay-context').getAttribute('open') === null) await help.click();
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /not continuous screen capture/);
  await page.screenshot({ path: '/tmp/clay-capabilities-narrow-dark-help.png', animations: 'disabled' });
  await help.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(async function () { (await import('/p/alpha/modules/theme.js')).applyTheme('clay-light'); });

  var canonicalWindow = page.frames().find(function (frame) { return frame.url().includes(info.sourceSlug); });
  await canonicalWindow.evaluate(async function () {
    var ws = (await import('./modules/ws-ref.js')).getWs();
    var original = ws.send.bind(ws);
    window.contextFixtureSend = original;
    ws.send = function (data) {
      var value = JSON.parse(data);
      if (value.type === 'message') { window.contextFixtureHeld = data; return; }
      return original(data);
    };
    ws.addEventListener('message', function (event) { var value = JSON.parse(event.data); if (value.type === 'message_ack') window.contextFixtureAck = value; });
  });
  await canonical.locator('#input').fill('Record the current metadata reference.'); await canonical.locator('#send-btn').click();
  await canonicalWindow.waitForFunction(function () { return !!window.contextFixtureHeld; });
  var emitted = await canonicalWindow.evaluate(function () {
    var message = JSON.parse(window.contextFixtureHeld);
    return message.contextualSnapshot;
  });
  var preparedView = await page.evaluate(async function () {
    var current = (await import('/p/alpha/modules/store.js')).store.get('contextualPrepared');
    return { prepared: current.requestId, reference: JSON.parse(document.getElementById('contextual-clay').dataset.screenReference).viewId };
  });
  assert.equal(emitted.viewId, preparedView.prepared);
  assert.equal(emitted.viewId, preparedView.reference);
  assert.match(await page.locator('[data-clay-context]').textContent(), /Next message/);
  assert.doesNotMatch(await page.locator('[data-clay-context]').textContent(), /Shared/);
  await canonicalWindow.evaluate(function () { window.contextFixtureSend(window.contextFixtureHeld); });
  await canonicalWindow.waitForFunction(function () { return !!window.contextFixtureAck; });
  assert.deepEqual(await canonicalWindow.evaluate(function () { return window.contextFixtureAck.message.contextualSnapshot; }), emitted);
  assert.equal(await canonicalWindow.evaluate(function () { return window.contextFixtureAck.message.pastes; }), undefined);
  await page.waitForFunction(function () { return /Shared/.test(document.querySelector('[data-clay-context]').textContent); });
  var acknowledged = await page.evaluate(async function (mateId) { return (await import('/p/alpha/modules/store.js')).store.get('contextualSubmitted')[mateId]; }, info.sourceSlug.slice(5));
  assert.equal(acknowledged.viewId, emitted.viewId);
  assert.match(await page.locator('[data-clay-context]').textContent(), /Alpha integration · Shared/);
  assert.doesNotMatch(await page.locator('[data-clay-context]').textContent(), /Alpha destination|metadata/);
  await page.screenshot({ path: '/tmp/clay-context-ack-desktop.png', animations: 'disabled' });
  await canonicalWindow.evaluate(async function () { window.contextFixtureSocket = (await import('./modules/ws-ref.js')).getWs(); });
  await canonicalWindow.evaluate(function () { window.contextFixtureSocket.close(); });
  await page.locator('[data-clay-context]').filter({ hasText: 'Disconnected' }).waitFor();
  assert.equal(await page.evaluate(async function () { return (await import('/p/alpha/modules/store.js')).store.get('connected'); }), true, 'The iframe disconnect is distinct from the main page connection');
  assert.doesNotMatch(await page.locator('[data-clay-context]').textContent(), /Shared|Next message/);
  await help.click();
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /Reconnect before sharing a new snapshot.*\nLast submitted: Alpha integration \/ Alpha destination.*stale/);
  await help.press('Escape');
  await canonical.locator('#input-wrapper:not([inert])').waitFor();
  await page.locator('[data-clay-context]').filter({ hasText: 'Alpha integration · New view' }).waitFor();
  await page.getByRole('link', { name: 'BI', exact: true }).click();
  await page.waitForURL('**/p/beta/');
  await page.locator('#messages').getByText('BETA_RENDERED_DESTINATION', { exact: true }).waitFor();
  await page.locator('.icon-strip-brand').click();
  await canonical.locator('#input-wrapper:not([inert])').waitFor();
  await page.locator('[data-clay-context]').filter({ hasText: 'Beta integration · New view' }).waitFor();
  if (await page.locator('.contextual-clay-context').getAttribute('open') === null) await help.click();
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /Current view: Beta integration \/ Beta destination/);
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /Last submitted: Alpha integration \/ Alpha destination.*stale/);
  assert.equal(await canonicalSummary.count(), 1);
  await page.screenshot({ path: '/tmp/clay-context-stale-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/clay-context-stale-narrow.png', animations: 'disabled' });
  await page.evaluate(async function () { window.contextFixtureParentSocket = (await import('/p/alpha/modules/ws-ref.js')).getWs(); });
  await page.context().setOffline(true);
  await page.evaluate(function () { window.contextFixtureParentSocket.close(); });
  await page.locator('[data-clay-context]').filter({ hasText: 'Disconnected' }).waitFor();
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /Reconnect before sharing a new snapshot/);
  assert.match(await page.locator('.contextual-clay-context p').textContent(), /Last submitted: Alpha integration/);
  await page.context().setOffline(false);
  assert.deepEqual(errors, []);
  t.diagnostic('Canonical metadata: held pre-ACK message stays unshared; actual ACK matches the prepared view; iframe-only disconnection removes shared-current claims; reconnection and project navigation require a new snapshot; parent disconnection retains the stale prior submission. Desktop/narrow capability and help checks passed.');
});
