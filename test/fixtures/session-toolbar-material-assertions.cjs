var assert = require('node:assert/strict');
var material = require('./chrome-material-assertions.cjs');

async function assertToolbar(page, theme) {
  var row = page.locator('#session-list > .session-list-sticky-top');
  assert.equal(await row.evaluate(function (element) { return getComputedStyle(element).backgroundColor; }), 'rgba(0, 0, 0, 0)', 'toolbar has no second opaque or tinted backing');
  var before = await row.boundingBox();
  await page.locator('[data-view-button="desktop"]').click();
  var menu = page.locator('.session-folder-viewmenu'); await menu.waitFor();
  var button = await page.locator('[data-view-button="desktop"]').boundingBox(), popup = await menu.boundingBox();
  assert.equal(popup.y, button.y + button.height + 4, 'View options keeps its viewport anchor');
  assert.ok(popup.x >= 0 && popup.x + popup.width <= page.viewportSize().width);
  await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Search sessions', exact: true }).click();
  await page.waitForFunction(function () { return document.activeElement.matches('.session-search-input'); });
  assert.deepEqual(await row.boundingBox(), before, 'focused search retains toolbar geometry');
  await page.getByRole('button', { name: 'Close search', exact: true }).click();

  // Populate only the local rendered list, then use its real scroll container.
  // Strong alternating paint below the toolbar must never bleed into it.
  await page.locator('#session-list > .session-regular-drop').evaluate(function (content) {
    for (var i = 0; i < 20; i++) {
      var item = content.querySelector('.session-item').cloneNode(true);
      item.dataset.toolbarProbe = 'true'; content.appendChild(item);
    }
    content.parentElement.parentElement.scrollTop = 90;
  });
  try {
    await page.waitForFunction(function () {
      var content = document.querySelector('#session-list > .session-regular-drop');
      var toolbar = document.querySelector('#session-list > .session-list-sticky-top');
      var overlap = toolbar.getBoundingClientRect().bottom - content.getBoundingClientRect().top;
      return content.parentElement.parentElement.scrollTop > 0 && overlap > 0 &&
        Math.abs(parseFloat(content.style.getPropertyValue('--session-list-clip-top')) - overlap) < .5;
    });
    assert.deepEqual(await row.boundingBox(), before, 'toolbar remains seated while the actual list scrolls');
    var box = await row.boundingBox();
    var clip = { x: Math.ceil(box.x + 1), y: Math.ceil(box.y + 1), width: Math.floor(box.width - 2), height: Math.floor(box.height - 2) };
    var content = page.locator('#session-list > .session-regular-drop');
    await page.mouse.move(900, 250);
    await content.evaluate(function (element) { element.style.background = '#ff00ff'; });
    var first = await page.screenshot({ clip: clip });
    await content.evaluate(function (element) { element.style.background = '#00ff00'; });
    assert.ok(first.equals(await page.screenshot({ clip: clip })), 'scrolling content paint is fully clipped behind the transparent toolbar');
    var client = await page.context().newCDPSession(page);
    try {
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-transparency', value: 'reduce' }] });
      await material.assertMaterial(page, '#sidebar-column', true);
      assert.equal(await row.evaluate(function (element) { return getComputedStyle(element).backgroundColor; }), 'rgba(0, 0, 0, 0)', 'solid fallback comes from the one sidebar backing');
    } finally { await client.send('Emulation.setEmulatedMedia', { features: [] }); await client.detach(); await page.emulateMedia({ colorScheme: theme }); }
  } finally {
    await page.locator('#session-list > .session-regular-drop').evaluate(function (content) {
      content.querySelectorAll('[data-toolbar-probe]').forEach(function (item) { item.remove(); });
      content.style.removeProperty('background'); content.parentElement.parentElement.scrollTop = 0;
    });
  }
}

module.exports = { assertToolbar: assertToolbar };
