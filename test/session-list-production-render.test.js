var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var path = require('node:path');

function loadPlaywright() { try { return require('playwright'); } catch (error) { return null; } }

test('production desktop and mobile session render survives presence, Mate creation, and debate filtering', async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright is not installed'); return; }
  var port = 31000 + process.pid % 10000;
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
  var page = await browser.newPage({ viewport: { width: 520, height: 700 } });
  var pageErrors = [];
  page.on('pageerror', function (error) { pageErrors.push(error.message); });
  await page.goto('http://127.0.0.1:' + port + '/session-list-production.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(function () { return document.body.dataset.result; });
  assert.equal(await page.locator('body').getAttribute('data-result'), 'pass', await page.locator('#result').innerText());
  assert.deepEqual(pageErrors, []);

  var desktopRow = page.locator('#session-list .session-item').first();
  var geometry = await desktopRow.evaluate(function (row) {
    var title = row.querySelector('.session-item-text');
    var trailing = row.querySelector('.session-row-trailing');
    var current = title.getBoundingClientRect().width;
    var originalPosition = trailing.style.position;
    var originalWidth = trailing.style.width;
    var originalFlex = trailing.style.flex;
    var actions = trailing.querySelector('.session-row-actions');
    var originalActionsPosition = actions.style.position;
    trailing.style.position = 'static';
    trailing.style.width = 'auto';
    trailing.style.flex = '0 0 auto';
    actions.style.position = 'static';
    var controlsReserved = title.getBoundingClientRect().width;
    trailing.style.position = originalPosition;
    trailing.style.width = originalWidth;
    trailing.style.flex = originalFlex;
    actions.style.position = originalActionsPosition;
    return {
      current: current,
      controlsReserved: controlsReserved,
      age: !!row.querySelector('.session-item-age'),
      nativeTitle: title.getAttribute('title'),
      presence: !!row.querySelector('.session-presence')
    };
  });
  assert.equal(geometry.age, false);
  assert.equal(geometry.nativeTitle, null);
  assert.equal(geometry.presence, true);
  assert.ok(geometry.current > geometry.controlsReserved + 1, 'title does not reclaim action width at rest');
  assert.equal(await desktopRow.locator('.session-item-text').getAttribute('aria-label'), 'A deliberately long session title that should scroll smoothly to reveal every word');
  assert.equal(await desktopRow.locator(':scope > .session-vendor-icon').count(), 0, 'desktop row retained a leading vendor icon');
  var ordinaryTitleLefts = await page.locator('#session-list .session-item[data-session-id="701"], #session-list .session-item[data-session-id="703"]').evaluateAll(function (rows) {
    return rows.map(function (row) { return Math.round(row.querySelector('.session-item-title').getBoundingClientRect().left); });
  });
  assert.equal(new Set(ordinaryTitleLefts).size, 1, 'ordinary linked and unlinked title insets differ');
  assert.equal(await page.locator('.session-vendor-hover-icon, .mobile-vendor-hover-icon, .split-group-vendor-actions').count(), 0, 'session list retained vendor identity markup');

  await desktopRow.hover();
  await page.waitForTimeout(100);
  assert.equal(await desktopRow.evaluate(function (row) { return row.classList.contains('session-title-marquee'); }), true, 'long title did not activate marquee');
  assert.match(await desktopRow.locator('.session-item-title').getAttribute('title'), /^Last activity:/);
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.session-activity-tooltip').count(), 0, 'date still uses a scripted tooltip');
  var visibleControls = await desktopRow.evaluate(function (row) {
    var presence = row.querySelector('.session-presence').getBoundingClientRect();
    var actions = row.querySelector('.session-row-actions').getBoundingClientRect();
    var title = row.querySelector('.session-item-text').getBoundingClientRect();
    var linked = row.querySelector('.session-github-link').getBoundingClientRect();
    return {
      star: getComputedStyle(row.querySelector('.session-folder-star-btn')).opacity,
      close: getComputedStyle(row.querySelector('.session-close-btn')).opacity,
      presence: { left: presence.left, right: presence.right },
      actions: { left: actions.left, right: actions.right },
      title: { top: title.top, bottom: title.bottom },
      linked: { top: linked.top, bottom: linked.bottom },
      presenceActionsOverlap: !(actions.right <= presence.left || actions.left >= presence.right),
      linkedActionsOverlap: !(actions.bottom <= linked.top || actions.top >= linked.bottom),
      titleCenterDelta: Math.abs((actions.top + actions.bottom) / 2 - (title.top + title.bottom) / 2)
    };
  });
  assert.ok(Number(visibleControls.star) > 0);
  assert.ok(Number(visibleControls.close) > 0);
  assert.equal(visibleControls.presenceActionsOverlap, false, 'action overlay overlaps presence: ' + JSON.stringify(visibleControls));
  assert.equal(visibleControls.linkedActionsOverlap, false, 'action overlay overlaps linked work: ' + JSON.stringify(visibleControls));
  assert.ok(visibleControls.titleCenterDelta < 3, 'actions are not aligned with title line: ' + JSON.stringify(visibleControls));

  await page.mouse.move(2, 2);
  await page.waitForTimeout(50);
  await desktopRow.locator('.session-folder-star-btn').focus();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await desktopRow.hover();
  await page.waitForTimeout(100);
  assert.deepEqual(await desktopRow.evaluate(function (row) { return { marquee: row.classList.contains('session-title-marquee'), animation: getComputedStyle(row.querySelector('.session-item-title')).animationName, label: row.querySelector('.session-item-text').getAttribute('aria-label') }; }), { marquee: true, animation: 'none', label: 'A deliberately long session title that should scroll smoothly to reveal every word' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(2, 2);
  var shortRow = page.locator('#session-list .session-item[data-session-id="703"]');
  await shortRow.hover();
  await page.waitForTimeout(100);
  assert.equal(await shortRow.evaluate(function (row) { return row.classList.contains('session-title-marquee'); }), false, 'short title moved');
  await desktopRow.hover();
  await page.waitForTimeout(500);
  assert.equal(await desktopRow.evaluate(function (row) { return row.classList.contains('session-title-marquee'); }), true);
  await desktopRow.evaluate(function (row) { row.remove(); });
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#session-list .session-item[data-session-id="701"]').count(), 0);

  var mobileRow = page.locator('#mobile-host .mobile-session-item').first();
  assert.match(await mobileRow.locator('.mobile-session-title').getAttribute('title'), /^Last activity:/);
  assert.equal(await mobileRow.locator(':scope > .mobile-session-vendor-icon').count(), 0, 'mobile row retained a leading vendor icon');
  await mobileRow.hover();
  assert.equal(await mobileRow.locator('.mobile-vendor-hover-icon').count(), 0, 'mobile row retained vendor identity');
  assert.ok(Number(await mobileRow.locator('.mobile-session-actions').evaluate(function (actions) { return getComputedStyle(actions).opacity; })) > 0, 'mobile star action stayed hidden on hover');
  await page.evaluate(function () { window.__renderWorkerScenario(true, 703); });
  assert.equal(await page.locator('#session-list .session-worker-item').count(), 0, 'dedicated Worker rows leaked into desktop list');
  var workerParent = page.locator('#session-list .session-item[data-session-id="704"]').first();
  assert.equal(await workerParent.count(), 1, 'Worker parent row missing');
  var parentTitleLeft = await workerParent.locator('.session-item-title').evaluate(function (title) { return Math.round(title.getBoundingClientRect().left); });
  var ordinaryTitleLeft = await page.locator('#session-list .session-item[data-session-id="703"] .session-item-title').evaluate(function (title) { return Math.round(title.getBoundingClientRect().left); });
  assert.equal(parentTitleLeft, ordinaryTitleLeft, 'parent and ordinary session titles have inconsistent left insets');
  var desktopProcessingBounds = await workerParent.evaluate(function (row) {
    var dot = row.querySelector('.session-processing').getBoundingClientRect();
    var title = row.querySelector('.session-item-title').getBoundingClientRect();
    return { dotRight: dot.right, titleLeft: title.left, dotTop: dot.top, titleTop: title.top };
  });
  assert.ok(desktopProcessingBounds.dotRight <= desktopProcessingBounds.titleLeft, 'processing dot overlaps parent title: ' + JSON.stringify(desktopProcessingBounds));
  assert.equal(await page.locator('#session-list .session-item[data-session-id="703"] .session-item-title').evaluate(function (title) { return Math.round(title.getBoundingClientRect().left); }), ordinaryTitleLeft, 'idle desktop title inset changed');
  assert.equal(await workerParent.locator('.session-processing').count(), 1, 'Worker processing was not promoted to parent');
  assert.equal(await workerParent.evaluate(function (row) { return row.classList.contains('active'); }), false, 'background Worker processing selected an unrelated parent');
  assert.equal(await workerParent.locator('.session-unread-badge').textContent(), '1', 'idle Worker unread was not promoted to parent');
  assert.equal(await page.locator('#mobile-host .mobile-worker-item').count(), 0, 'dedicated Worker rows leaked into mobile list');
  var mobileProcessingBounds = await page.locator('#mobile-host .mobile-session-item[data-session-id="704"]').evaluate(function (row) {
    var dot = row.querySelector('.mobile-session-processing').getBoundingClientRect();
    var title = row.querySelector('.mobile-session-title').getBoundingClientRect();
    return { dotRight: dot.right, titleLeft: title.left, dotBottom: dot.bottom, titleTop: title.top };
  });
  assert.ok(mobileProcessingBounds.dotRight <= mobileProcessingBounds.titleLeft, 'processing mobile dot overlaps parent title: ' + JSON.stringify(mobileProcessingBounds));
  var idleMobileTitleLeft = await page.locator('#mobile-host .mobile-session-item[data-session-id="703"] .mobile-session-title').evaluate(function (title) { return Math.round(title.getBoundingClientRect().left); });
  assert.equal(Math.round(mobileProcessingBounds.titleLeft), idleMobileTitleLeft, 'processing mobile title inset changed');
  for (var mobileId of ['701', '703']) {
    var mobileMixedRow = page.locator('#mobile-host .mobile-session-item[data-session-id="' + mobileId + '"]');
    var mobileBounds = await mobileMixedRow.evaluate(function (row) {
    var title = row.querySelector('.mobile-session-title').getBoundingClientRect();
    var actions = row.querySelector('.mobile-session-actions').getBoundingClientRect();
    var pill = row.querySelector('.mobile-session-github-link');
    var pillRect = pill ? pill.getBoundingClientRect() : null;
      var rowRect = row.getBoundingClientRect();
      return { rowRight: rowRect.right, title: { left: title.left, right: title.right }, actions: { left: actions.left, right: actions.right, top: actions.top, bottom: actions.bottom }, pill: pillRect && { top: pillRect.top, bottom: pillRect.bottom } };
    });
    assert.ok(mobileBounds.actions.right <= mobileBounds.rowRight, 'mobile action cluster escaped row bounds for ' + mobileId);
    assert.ok(mobileBounds.actions.left >= mobileBounds.title.left, 'mobile action cluster intruded into title inset for ' + mobileId);
    if (mobileBounds.pill) assert.ok(mobileBounds.actions.bottom <= mobileBounds.pill.top || mobileBounds.actions.top >= mobileBounds.pill.bottom, 'mobile action cluster overlaps linked pill for ' + mobileId);
  }
  assert.equal(await page.locator('#session-list .session-worker-history-btn').count(), 0, 'sidebar retained a Worker history icon');
  await page.evaluate(function () { window.__renderWorkerScenario(false, 704); });
  workerParent = page.locator('#session-list .session-item[data-session-id="704"]').first();
  assert.equal(await workerParent.evaluate(function (row) { return row.classList.contains('active'); }), true, 'selected Worker parent did not become active');
  assert.equal(await page.locator('#in-session-controls .session-worker-history-in-session').count(), 1, 'selected parent lost in-session Worker history control');
  await page.locator('#in-session-controls .session-worker-history-in-session').dispatchEvent('click');
  assert.equal(await page.locator('.session-worker-history-menu').count(), 1, 'Worker history menu did not open');
  assert.deepEqual(await page.locator('.session-worker-history-item').evaluateAll(function (items) { return items.map(function (item) { return item.querySelector('.session-worker-history-label').textContent; }); }), ['Generation 2 · Current', 'Generation 1 · History']);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.session-worker-history-menu').count(), 0, 'Escape did not close Worker history');
  assert.equal(await page.locator('#in-session-controls .session-worker-history-in-session').evaluate(function (button) { return document.activeElement === button; }), true, 'Worker history focus did not return to its opener');
  await page.locator('#in-session-controls .session-worker-history-in-session').dispatchEvent('click');
  await page.mouse.click(4, 4);
  assert.equal(await page.locator('.session-worker-history-menu').count(), 0, 'outside click did not close Worker history');
  await page.locator('#in-session-controls .session-worker-history-in-session').dispatchEvent('click');
  await page.evaluate(function () { window.__renderWorkerScenario(false, 703); });
  assert.equal(await page.locator('.session-worker-history-menu').count(), 0, 'session switch left stale Worker history open');
  await page.evaluate(function () { window.__renderWorkerScenario(false, 704); });
  await page.locator('#in-session-controls .session-worker-history-in-session').dispatchEvent('click');
  await page.locator('.session-worker-history-item').nth(1).dispatchEvent('click');
  assert.deepEqual(await page.evaluate(function () { return window.__fixtureSent[window.__fixtureSent.length - 1]; }), { type: 'switch_session', id: 706 }, 'history opened the exact read-only Worker session route');
  await page.evaluate(function () { window.__renderWorkerScenario(false, 703); });
  assert.equal(await page.locator('#session-list .session-item[data-session-id="704"]').evaluate(function (row) { return row.classList.contains('active'); }), false, 'parent stayed active after all Workers became idle');
  assert.equal(await page.locator('#session-list .session-item[data-session-id="704"] .session-processing').count(), 0, 'stale Worker processing remained on parent');
});
