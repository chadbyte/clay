var assert = require('node:assert/strict');

async function assertBounds(page) {
  var bounds = await page.locator('#icon-strip').evaluate(function (rail) {
    var rect = rail.getBoundingClientRect(), face = getComputedStyle(rail, '::before');
    var top = rect.top + parseFloat(face.top), bottom = rect.bottom - parseFloat(face.bottom);
    var sidebar = document.getElementById('sidebar-column').getBoundingClientRect();
    var brand = rail.querySelector('.icon-strip-home').getBoundingClientRect();
    var footer = document.getElementById('user-island');
    var last = footer.getBoundingClientRect();
    var group = document.getElementById('icon-strip-navigation');
    var short = getComputedStyle(group).display !== 'contents';
    var add = (short ? group : rail.querySelector('.icon-strip-add')).getBoundingClientRect();
    return { top: top, bottom: bottom, left: rect.left + parseFloat(face.left), right: rect.right - parseFloat(face.right),
      rail: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
      sidebar: sidebar.width ? { top: sidebar.top, bottom: sidebar.bottom } : null,
      firstClearance: brand.top - top, horizontalClearance: brand.left - rect.left,
      footerVisible: !!footer.getClientRects().length && getComputedStyle(footer).display !== 'none',
      lastClearance: bottom - last.bottom, footerGap: last.top - add.bottom };
  });
  assert.deepEqual({ top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right }, bounds.rail, 'visible Dock face fills its own rail');
  if (bounds.sidebar) {
    assert.equal(bounds.top, bounds.sidebar.top, 'painted Dock and sidebar tops align');
    assert.equal(bounds.bottom, bounds.sidebar.bottom, 'painted Dock and sidebar bottoms align');
  }
  assert.ok(bounds.firstClearance >= 8, 'first 48px control has top breathing room');
  assert.ok(bounds.horizontalClearance >= 12, 'first control fits comfortably across the face');
  if (bounds.footerVisible) {
    assert.ok(bounds.lastClearance >= 12, 'account controls clear the bottom of the face');
    assert.ok(bounds.footerGap >= 8, 'navigation controls clear the account footer');
  }
}

async function resizeAndSettle(page, viewport) {
  await page.setViewportSize(viewport);
  // The resize request can finish before Chromium updates viewport units and
  // media queries. Wait for the actual shell before testing its scroll region.
  await page.waitForFunction(function (expected) {
    if (innerWidth !== expected.width || innerHeight !== expected.height) return false;
    var short = matchMedia('(max-height: 500px)').matches;
    if (short !== (expected.height <= 500)) return false;
    var body = document.getElementById('layout-body'), rail = document.getElementById('icon-strip');
    var bodyBox = body.getBoundingClientRect(), railBox = rail.getBoundingClientRect();
    var bodyPadding = parseFloat(getComputedStyle(body).paddingBottom) || 0;
    if (Math.abs(bodyBox.bottom - expected.height) > .5 ||
        Math.abs(railBox.bottom - (bodyBox.bottom - bodyPadding)) > .5) return false;
    var group = document.getElementById('icon-strip-navigation');
    if (!short) return getComputedStyle(group).display === 'contents';
    var footerReserve = parseFloat(getComputedStyle(rail).paddingBottom) || 0;
    return getComputedStyle(group).display === 'flex' &&
      Math.abs(group.getBoundingClientRect().bottom - (railBox.bottom - footerReserve)) < .5;
  }, viewport);
}

async function assertShortRail(page) {
  var viewport = page.viewportSize();
  try {
    await resizeAndSettle(page, { width: 1280, height: 400 });
    await assertBounds(page);
    var list = page.locator('#icon-strip-navigation');
    var scroll = await list.evaluate(function (element) {
      element.scrollTop = element.scrollHeight;
      var rect = element.getBoundingClientRect();
      var last = element.lastElementChild.getBoundingClientRect();
      return { height: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop,
        lastBottom: last.bottom, bottom: rect.bottom };
    });
    assert.ok(scroll.height > 0 && scroll.scrollHeight > scroll.height, 'short Dock keeps a real scrolling navigation region: ' + JSON.stringify(scroll));
    assert.ok(scroll.scrollTop > 0 && scroll.lastBottom <= scroll.bottom + 1, 'last destination can scroll fully into view');
    await page.waitForFunction(function () {
      var list = document.getElementById('icon-strip-navigation');
      var items = document.querySelectorAll('#icon-strip-projects .icon-strip-item');
      var element = items[items.length - 1];
      if (!element) return false;
      element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      var r = element.getBoundingClientRect(), region = list.getBoundingClientRect();
      return r.y >= region.y && r.bottom <= region.bottom + 1 &&
        element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    await list.evaluate(function (element) { element.scrollTop = 0; });
    if (process.env.CLAY_MATERIAL_SHOTS) await page.screenshot({ path: process.env.CLAY_MATERIAL_SHOTS + '/dock-short-' + Date.now() + '.png' });
  } finally { await resizeAndSettle(page, viewport); }
}

module.exports = { assertBounds: assertBounds, assertShortRail: assertShortRail };
