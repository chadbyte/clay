var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var http = require('node:http');
var path = require('node:path');

function loadPlaywright() {
  try { return require('playwright'); } catch (error) { return null; }
}

function serveRepository() {
  var root = path.join(__dirname, '..');
  var server = http.createServer(function (request, response) {
    var relative = decodeURIComponent(request.url.split('?')[0]).replace(/^\/+/, '');
    var file = path.resolve(root, relative || 'test/fixtures/sidebar-density.html');
    if (file.indexOf(root + path.sep) !== 0 || !fs.existsSync(file)) { response.writeHead(404); response.end('not found'); return; }
    var extension = path.extname(file);
    response.setHeader('Content-Type', extension === '.js' ? 'text/javascript' : extension === '.css' ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
  });
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server); }); });
}

test('linked work remains compact and complete at narrow desktop and mobile widths', async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright is not installed'); return; }
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (error) { t.skip('Chromium is not available: ' + error.message); return; }
  var server = await serveRepository();
  t.after(function () { server.close(); return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await page.goto('http://127.0.0.1:' + server.address().port + '/test/fixtures/sidebar-density.html');

  var desktop = await page.evaluate(function () {
    return ['desktop-280', 'desktop-280-long', 'desktop-320', 'desktop-320-long'].map(function (id) {
      var panel = document.getElementById(id).closest('.fixture-panel');
      var row = document.querySelector('#' + id + ' [data-session-id]');
      var links = row.querySelector('.session-row-github-links');
      var linear = row.querySelector('.session-linear-link');
      var linearId = row.querySelector('.linear-work-id');
      var linearTitle = row.querySelector('.linear-work-title');
      var linearState = row.querySelector('.linear-work-state');
      var compactState = row.querySelector('.linear-work-state-compact');
      var github = row.querySelector('.session-github-link:not(.session-linear-link)');
      var more = row.querySelector('.github-work-more');
      var bounds = links.getBoundingClientRect();
      var linearBounds = linear.getBoundingClientRect();
      function within(element, outer) {
        var rect = element.getBoundingClientRect();
        return !rect.width || rect.left >= outer.left - 0.5 && rect.right <= outer.right + 0.5 && rect.top >= outer.top - 0.5 && rect.bottom <= outer.bottom + 0.5;
      }
      return {
        id: id,
        panelWidth: panel.getBoundingClientRect().width,
        rowHeight: row.getBoundingClientRect().height,
        linkHeight: bounds.height,
        linearId: linearId.textContent,
        compactState: compactState.textContent,
        githubText: github.textContent,
        moreText: more.textContent,
        textWithinPill: [linearId, linearTitle, linearState, compactState].every(function (element) { return within(element, linearBounds); }),
        adjacentWithinLinks: within(github, bounds) && within(more, bounds),
        noRowOverflow: row.scrollWidth <= row.clientWidth,
        idTruncated: linearId.scrollWidth > linearId.clientWidth + 0.5,
        titleTruncated: linearTitle.scrollWidth > linearTitle.clientWidth + 0.5,
        stateTruncated: compactState.scrollWidth > compactState.clientWidth + 0.5,
        idOverflow: getComputedStyle(linearId).textOverflow,
        titleTextOverflow: getComputedStyle(linearTitle).textOverflow,
        stateOverflow: getComputedStyle(compactState).textOverflow,
        linearLabel: linear.getAttribute('aria-label'),
        linearTitle: linear.title,
        titleOverflow: getComputedStyle(row.querySelector('.session-item-text')).textOverflow,
      };
    });
  });
  assert.deepEqual(desktop.map(function (entry) { return entry.panelWidth; }), [280, 280, 320, 320]);
  desktop.forEach(function (entry) {
    assert.ok(entry.rowHeight <= 47, 'desktop row remains at most 47px: ' + JSON.stringify(entry));
    assert.ok(entry.linkHeight <= 19, 'linked work uses one compact line: ' + JSON.stringify(entry));
    assert.match(entry.githubText, /#602/);
    assert.equal(entry.moreText, '+1');
    assert.equal(entry.textWithinPill, true, 'Linear text stays inside its pill: ' + JSON.stringify(entry));
    assert.equal(entry.adjacentWithinLinks, true, 'adjacent actions stay inside linked-work row: ' + JSON.stringify(entry));
    assert.equal(entry.noRowOverflow, true, 'row has no horizontal overflow: ' + JSON.stringify(entry));
    assert.equal(entry.idOverflow, 'ellipsis');
    assert.equal(entry.titleTextOverflow, 'ellipsis');
    assert.equal(entry.stateOverflow, 'ellipsis');
    assert.equal(entry.titleOverflow, 'ellipsis');
  });
  desktop.filter(function (entry) { return entry.id.indexOf('-long') < 0; }).forEach(function (entry) {
    assert.equal(entry.linearId, 'TLE-458');
    assert.equal(entry.idTruncated, false, 'ordinary Linear identifier remains complete: ' + JSON.stringify(entry));
    assert.match(entry.compactState, /^Deployed/);
    assert.match(entry.linearLabel, /TLE-458.*Deployed to Staging/);
    assert.match(entry.linearTitle, /deliberately long Linear issue title/);
  });
  desktop.filter(function (entry) { return entry.id.indexOf('-long') >= 0; }).forEach(function (entry) {
    assert.equal(entry.linearId, 'PLATFORMOPS-10428');
    assert.equal(entry.idTruncated, true, 'long Linear identifier ellipsizes before leaving its pill: ' + JSON.stringify(entry));
    assert.match(entry.linearLabel, /PLATFORMOPS-10428.*Waiting for Customer Validation/);
  });
  var untouched = await page.evaluate(function () {
    var header = document.querySelector('#header-github-links .session-github-links');
    var headerLink = header.querySelector('.session-github-link');
    var details = document.querySelector('#density-details .github-work-details');
    return {
      headerFontSize: getComputedStyle(header).fontSize,
      headerLineHeight: getComputedStyle(header).lineHeight,
      headerGap: getComputedStyle(header).gap,
      headerLinkGap: getComputedStyle(headerLink).gap,
      headerLinkPaddingLeft: getComputedStyle(headerLink).paddingLeft,
      headerFullState: header.querySelector('.linear-work-state-full').textContent,
      headerCompactDisplay: getComputedStyle(header.querySelector('.linear-work-state-compact')).display,
      detailsGap: getComputedStyle(details).gap,
      detailsPaddingTop: getComputedStyle(details).paddingTop,
      detailsPaddingBottom: getComputedStyle(details).paddingBottom,
    };
  });
  assert.deepEqual(untouched, {
    headerFontSize: '11px', headerLineHeight: '18px', headerGap: '8px', headerLinkGap: '5px', headerLinkPaddingLeft: '5px',
    headerFullState: 'Deployed to Staging', headerCompactDisplay: 'none',
    detailsGap: '8px 12px', detailsPaddingTop: '8px', detailsPaddingBottom: '8px',
  });

  var restingSlot = await page.evaluate(function () {
    var row = document.querySelector('#desktop-280 [data-session-id]');
    var title = row.querySelector('.session-item-text');
    var slot = row.querySelector('.session-row-trailing');
    var actions = slot.querySelector('.session-row-actions');
    var star = slot.querySelector('.session-folder-star-btn');
    var remove = slot.querySelector('.session-close-btn');
    return {
      titleWidth: title.getBoundingClientRect().width,
      slotWidth: slot.getBoundingClientRect().width,
      actionWidth: actions.getBoundingClientRect().width,
      starOpacity: getComputedStyle(star).opacity,
      removeOpacity: getComputedStyle(remove).opacity,
    };
  });
  assert.match(await page.locator('#desktop-280 .session-item-title').getAttribute('title'), /Last active/);
  assert.equal(restingSlot.starOpacity, '0');
  assert.equal(restingSlot.removeOpacity, '0');
  assert.equal(restingSlot.slotWidth, 0, "overlay actions reserve no width at rest");

  await page.locator('#desktop-280 [data-session-id]').hover();
  await page.waitForTimeout(180);
  var hoverSlot = await page.evaluate(function () {
    var row = document.querySelector('#desktop-280 [data-session-id]');
    return {
      titleWidth: row.querySelector('.session-item-text').getBoundingClientRect().width,
      slotWidth: row.querySelector('.session-row-trailing').getBoundingClientRect().width,
      starOpacity: getComputedStyle(row.querySelector('.session-folder-star-btn')).opacity,
      removeOpacity: getComputedStyle(row.querySelector('.session-close-btn')).opacity,
    };
  });
  assert.ok(Number(hoverSlot.starOpacity) > 0);
  assert.ok(Number(hoverSlot.removeOpacity) > 0);
  assert.ok(Math.abs(hoverSlot.titleWidth - restingSlot.titleWidth) < 0.5);
  assert.ok(Math.abs(hoverSlot.slotWidth - restingSlot.slotWidth) < 0.5);

  await page.locator('#desktop-280 .session-folder-star-btn').focus();
  await page.waitForTimeout(180);
  var focusSlot = await page.evaluate(function () {
    var row = document.querySelector('#desktop-280 [data-session-id]');
    return {
      titleWidth: row.querySelector('.session-item-text').getBoundingClientRect().width,
      slotWidth: row.querySelector('.session-row-trailing').getBoundingClientRect().width,
      starOpacity: getComputedStyle(row.querySelector('.session-folder-star-btn')).opacity,
    };
  });
  assert.ok(Number(focusSlot.starOpacity) > 0);
  assert.ok(Math.abs(focusSlot.titleWidth - restingSlot.titleWidth) < 0.5);
  assert.ok(Math.abs(focusSlot.slotWidth - restingSlot.slotWidth) < 0.5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  var reducedMotion = await page.evaluate(function () {
    var row = document.querySelector('#desktop-280 [data-session-id]');
    return [row.querySelector('.session-row-actions'), row.querySelector('.session-folder-star-btn'), row.querySelector('.session-close-btn')].map(function (element) {
      return getComputedStyle(element).transitionDuration;
    });
  });
  assert.deepEqual(reducedMotion, ['0s', '0s', '0s']);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.locator('#desktop-280 .github-work-more').click();
  await page.locator('#github-work-popover').waitFor();
  assert.equal(await page.locator('#desktop-280 .github-work-more').getAttribute('aria-expanded'), 'true');
  var popoverLinear = page.locator('#github-work-popover .session-linear-link').first();
  assert.match(await popoverLinear.getAttribute('aria-label'), /TLE-458.*deliberately long Linear issue title.*Deployed to Staging/);
  assert.equal(await popoverLinear.locator('.linear-work-state-full').textContent(), 'Deployed to Staging');
  assert.equal(await popoverLinear.locator('.linear-work-state-full').evaluate(function (element) { return getComputedStyle(element).display; }), 'inline');
  assert.equal(await popoverLinear.locator('.linear-work-state-compact').evaluate(function (element) { return getComputedStyle(element).display; }), 'none');
  await page.locator('.fixture-label').first().click();
  assert.equal(await page.locator('#github-work-popover').count(), 0);
  assert.equal(await page.locator('#desktop-280 .github-work-more').getAttribute('aria-expanded'), 'false');

  var mobileResults = [];
  for (var viewportWidth of [320, 390]) {
    await page.setViewportSize({ width: viewportWidth, height: 700 });
    var mobile = await page.evaluate(function () {
      var panel = document.querySelector('.mobile-fixture');
      return ['mobile-320', 'mobile-320-long'].map(function (id) {
        var row = document.querySelector('#' + id + ' [data-session-id]');
        var links = row.querySelector('.session-row-github-links');
        var linear = row.querySelector('.session-linear-link');
        var linearBounds = linear.getBoundingClientRect();
        var targets = Array.prototype.slice.call(links.querySelectorAll('a, button'));
        var text = Array.prototype.slice.call(linear.querySelectorAll('.linear-work-id, .linear-work-title, .linear-work-state, .linear-work-state-compact'));
        var bounds = links.getBoundingClientRect();
        return {
          id: id,
          panelWidth: panel.getBoundingClientRect().width,
          rowHeight: row.getBoundingClientRect().height,
          linkHeight: bounds.height,
          linearId: row.querySelector('.linear-work-id').textContent,
          linearLabel: linear.getAttribute('aria-label'),
          idTruncated: row.querySelector('.linear-work-id').scrollWidth > row.querySelector('.linear-work-id').clientWidth + 0.5,
          githubText: row.querySelector('.session-github-link:not(.session-linear-link)').textContent,
          moreText: row.querySelector('.github-work-more').textContent,
          minTargetHeight: Math.min.apply(Math, targets.map(function (target) { return target.getBoundingClientRect().height; })),
          targetsWithin: targets.every(function (target) {
            var rect = target.getBoundingClientRect();
            return rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5;
          }),
          textWithinPill: text.every(function (element) {
            var rect = element.getBoundingClientRect();
            return !rect.width || rect.left >= linearBounds.left - 0.5 && rect.right <= linearBounds.right + 0.5;
          }),
          noHorizontalOverflow: row.scrollWidth <= row.clientWidth,
          starHeight: row.querySelector('.mobile-session-star').getBoundingClientRect().height,
          starOpacity: getComputedStyle(row.querySelector('.mobile-session-star')).opacity,
        };
      });
    });
    mobile.forEach(function (entry) { entry.viewportWidth = viewportWidth; mobileResults.push(entry); });
  }
  mobileResults.forEach(function (mobile) {
    assert.equal(mobile.panelWidth, mobile.viewportWidth - 24);
    assert.ok(mobile.rowHeight <= 70, 'mobile row remains bounded: ' + JSON.stringify(mobile));
    assert.ok(mobile.linkHeight <= 29, 'mobile linked work remains one line: ' + JSON.stringify(mobile));
    assert.match(mobile.githubText, /#602/);
    assert.equal(mobile.moreText, '+1');
    assert.ok(mobile.minTargetHeight >= 28);
    assert.equal(mobile.targetsWithin, true, 'mobile targets remain inside linked-work row: ' + JSON.stringify(mobile));
    assert.equal(mobile.textWithinPill, true, 'mobile Linear text remains inside pill: ' + JSON.stringify(mobile));
    assert.equal(mobile.noHorizontalOverflow, true);
    assert.ok(mobile.starHeight >= 28);
    assert.equal(mobile.starOpacity, '0');
    assert.match(mobile.linearLabel, /Linear issue title|Waiting for Customer Validation/);
  });
  mobileResults.filter(function (entry) { return entry.id.indexOf('-long') < 0; }).forEach(function (entry) {
    assert.equal(entry.linearId, 'TLE-458');
    assert.equal(entry.idTruncated, false, 'ordinary identifier remains complete on mobile: ' + JSON.stringify(entry));
  });
  mobileResults.filter(function (entry) { return entry.id.indexOf('-long') >= 0; }).forEach(function (entry) {
    assert.equal(entry.linearId, 'PLATFORMOPS-10428');
    assert.equal(entry.idTruncated, true, 'long identifier remains bounded on mobile: ' + JSON.stringify(entry));
  });
});
