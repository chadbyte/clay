var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var childProcess = require('node:child_process');
var { chromium } = require('playwright');

test('Account island production fixture progressive disclosure', { skip: !process.env.RUN_ACCOUNT_ISLAND_BROWSER }, async function () {
  var root = path.join(__dirname, '..');
  var port = 52127;
  var server = childProcess.spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
  var browser = null;
  try {
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    browser = await chromium.launch({ headless: true });
    var page = await browser.newPage({ viewport: { width: 320, height: 700 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:' + port + '/test/fixtures/account-island-fixture.html?theme=light');
    assert.equal(await page.locator('#cursor-share-toggle svg').count(), 1);
    await page.locator('#user-account-trigger').click();
    assert.equal(await page.locator('#account-collapse').count(), 0);
    assert.equal(await page.locator('.account-settings-button').getAttribute('aria-label'), 'User Settings');
    assert.equal(await page.locator('.account-settings-button svg').count(), 1);
      assert.equal(await page.locator('.account-name-display svg').count(), 1);
      assert.equal(await page.locator('#account-ai-summary').count(), 1);
      var restingStyles = await page.evaluate(function () {
        var ai = document.getElementById('account-ai-section');
        return { borderBottomWidth: getComputedStyle(ai).borderBottomWidth };
      });
      assert.equal(restingStyles.borderBottomWidth, '0px');
    await page.locator('#account-name-edit').click();
    await page.locator('#account-profile-name').fill('Saved Fixture User');
    await page.locator('#account-profile-name').press('Enter');
    assert.equal(await page.locator('#account-name-edit span').textContent(), 'Saved Fixture User');
    assert.equal(await page.locator('#account-name-edit').evaluate(function (element) { return document.activeElement === element; }), true);
    await page.locator('#account-name-edit').click();
    await page.locator('#account-profile-name').fill('Cancelled Fixture User');
    await page.locator('#account-profile-name').press('Escape');
    assert.equal(await page.locator('#account-name-edit span').textContent(), 'Saved Fixture User');
    assert.equal(await page.locator('#account-name-edit').evaluate(function (element) { return document.activeElement === element; }), true);
    await page.locator('#account-avatar-edit').click();
    assert.equal(await page.locator('#account-avatar-upload').isVisible(), true);
    assert.equal(await page.locator('#account-avatar-generate').isVisible(), true);
    await page.locator('#account-avatar-file').setInputFiles(path.join(root, 'lib/public/clay-studio-symbol.png'));
    await page.locator('.avatar-positioner-overlay').waitFor({ state: 'visible' });
    await page.locator('.avatar-positioner-btn-cancel').click();
    assert.equal(await page.locator('#account-popover').count(), 1);
    await page.locator('#account-avatar-edit').click();
    await page.locator('#account-ai-summary').click();
    await page.getByLabel('Default AI reasoning effort').selectOption('high');
    assert.equal(await page.locator('.default-ai-save').isEnabled(), true);
    await page.locator('.default-ai-save').click();
    await page.locator('#account-ai-summary').waitFor({ state: 'visible' });
    assert.match(await page.locator('#account-ai-summary').getAttribute('aria-label'), /high/);
    await page.locator('.account-settings-button').click();
    assert.equal(await page.locator('#account-popover').count(), 0);
    await page.locator('#user-settings:not(.hidden)').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#user-settings').getAttribute('aria-label'), 'User Settings');
    await page.locator('#user-settings-close').click();
    await page.locator('#user-account-trigger').click();
    await page.locator('#account-ai-summary').click();
    await page.locator('.default-ai-cancel').click();
    await page.keyboard.press('Escape');
    await page.locator('#fixture-open-ai').click();
    assert.equal(await page.getByLabel('Default AI reasoning effort').count(), 1);
    await page.locator('#fixture-error').click();
    var cursor = page.locator('#cursor-share-toggle');
    assert.equal(await cursor.isDisabled(), false);
    assert.equal(await page.evaluate(function () { return window.accountFixture.store.get('cursorSharingHydrated'); }), false);
    assert.match(await cursor.getAttribute('aria-label'), /activate to retry/);
    assert.equal(await page.evaluate(function () { return getComputedStyle(document.getElementById('cursor-share-toggle'), '::after').content; }), 'none');
    await cursor.hover();
    await page.waitForTimeout(180);
    assert.equal(await page.locator('.tooltip.visible').textContent(), 'Cursor sharing is unavailable. Click to retry.');
    var refreshCount = await page.evaluate(function () { return window.accountFixture.ws.sent.filter(function (message) { return message.type === 'cursor_sharing_get'; }).length; });
    await cursor.click();
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(function () { return window.accountFixture.ws.sent.filter(function (message) { return message.type === 'cursor_sharing_get'; }).length; }), refreshCount + 1);
    assert.equal(await page.evaluate(function () { return window.accountFixture.store.get('cursorSharingHydrated'); }), true);
    assert.equal(await cursor.getAttribute('aria-pressed'), 'false');
    await cursor.click();
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(function () { return window.accountFixture.ws.sent.slice(-1)[0].type; }), 'cursor_sharing_set');
    assert.equal(await page.evaluate(function () { return window.accountFixture.ws.sent.slice(-1)[0].enabled; }), true);
    assert.equal(await cursor.getAttribute('aria-pressed'), 'true');
    await cursor.click();
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(function () { var messages = window.accountFixture.ws.sent.filter(function (message) { return message.type === 'cursor_sharing_set'; }); return messages[messages.length - 1].enabled; }), false);
    assert.equal(await cursor.getAttribute('aria-pressed'), 'false');
    var sentBeforeOffline = await page.evaluate(function () { return window.accountFixture.ws.sent.length; });
    await page.locator('#fixture-disconnect').click();
    assert.equal(await cursor.isDisabled(), true);
    await cursor.click({ force: true });
    assert.equal(await page.evaluate(function () { return window.accountFixture.ws.sent.length; }), sentBeforeOffline);

    var cases = [
      { width: 280, theme: 'light', collapsed: '0', name: 'light-280' },
      { width: 320, theme: 'dark', collapsed: '1', name: 'dark-320-collapsed' },
      { width: 375, theme: 'light', collapsed: '0', name: 'light-375-mobile' }
    ];
    for (var i = 0; i < cases.length; i++) {
      var item = cases[i];
      await page.setViewportSize({ width: item.width, height: 700 });
      await page.goto('http://127.0.0.1:' + port + '/test/fixtures/account-island-fixture.html?theme=' + item.theme + '&collapsed=' + item.collapsed);
      await page.locator('#user-account-trigger').click();
      await page.screenshot({ path: '/tmp/account-island-' + item.name + '-resting.png', animations: 'disabled' });
      var geometry = await page.evaluate(function () {
        var rail = document.getElementById('user-island').getBoundingClientRect();
        var avatar = document.querySelector('.user-island-avatar').getBoundingClientRect();
        var toggle = document.getElementById('cursor-share-toggle').getBoundingClientRect();
        var strip = document.getElementById('icon-strip').getBoundingClientRect();
        var panel = document.getElementById('account-popover').getBoundingClientRect();
        function overlap(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
        var add = document.getElementById('icon-strip-add').getBoundingClientRect();
        var users = document.getElementById('icon-strip-users').getBoundingClientRect();
        var mateSection = document.getElementById('icon-strip-mate-section').getBoundingClientRect();
        return { collapsed: document.getElementById('layout').classList.contains('sidebar-collapsed'), avatarCenterDelta: Math.abs((strip.left + strip.width / 2) - (avatar.left + avatar.width / 2)), toggleCenterDelta: Math.abs((strip.left + strip.width / 2) - (toggle.left + toggle.width / 2)), stripRight: strip.right, stripLeft: strip.left, toggleLeft: toggle.left, toggleRight: toggle.right, footerOverlap: overlap(rail, add) || overlap(rail, mateSection), panel: { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right }, svgCount: document.querySelectorAll('#account-popover svg, #cursor-share-toggle svg').length };
      });
      assert.ok(geometry.avatarCenterDelta <= 1);
      assert.ok(geometry.toggleCenterDelta <= 1);
      assert.ok(geometry.toggleLeft >= geometry.stripLeft - 1 && geometry.toggleRight <= geometry.stripRight + 1);
      assert.equal(geometry.footerOverlap, false);
      assert.ok(geometry.panel.top >= 0 && geometry.panel.bottom <= 700);
      assert.ok(geometry.svgCount >= 3);
      var sessionGeometry = await page.evaluate(function () {
        var column = document.getElementById('sidebar-column');
        var panel = document.getElementById('sidebar-panel-sessions');
        var list = document.getElementById('session-list');
        panel.scrollTop = panel.scrollHeight;
        var finalRow = list.lastElementChild.getBoundingClientRect();
        var panelRect = panel.getBoundingClientRect();
        return { legacyPadding: getComputedStyle(column).paddingBottom, columnBottomGap: column.getBoundingClientRect().bottom - panelRect.bottom, finalRowBottomGap: panelRect.bottom - finalRow.bottom, scrollable: panel.scrollHeight >= panel.clientHeight };
      });
      assert.equal(sessionGeometry.legacyPadding, '0px');
      assert.ok(sessionGeometry.columnBottomGap <= 1);
      assert.ok(sessionGeometry.finalRowBottomGap >= 0);
      assert.equal(sessionGeometry.scrollable, true);
      await page.locator('#fixture-ack-enabled').click();
      await page.waitForTimeout(200);
      var enabledStyles = await page.evaluate(function () {
        var button = document.getElementById('cursor-share-toggle');
        var icon = button.querySelector('svg');
        return { button: getComputedStyle(button).color, icon: getComputedStyle(icon).color, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height };
      });
      assert.equal(enabledStyles.button, 'rgb(88, 87, 252)');
      assert.equal(enabledStyles.icon, 'rgb(88, 87, 252)');
      assert.equal(enabledStyles.width, 28);
      assert.equal(enabledStyles.height, 28);
      assert.equal(await page.evaluate(function () { return getComputedStyle(document.getElementById('cursor-share-toggle'), '::after').content; }), 'none');
      await page.locator('#cursor-share-toggle').hover();
      await page.waitForTimeout(180);
      assert.equal(await page.locator('.tooltip.visible').textContent(), 'Your cursor is visible to others. Click to stop sharing.');
      await page.locator('#fixture-ack-disabled').click();
      await page.waitForTimeout(200);
      var offStyles = await page.evaluate(function () { var button = document.getElementById('cursor-share-toggle'); return { button: getComputedStyle(button).color, slash: getComputedStyle(button, '::after').content, duplicate: document.querySelectorAll('#icon-strip-me, .icon-strip-me-avatar').length }; });
      assert.notEqual(offStyles.button, 'rgb(88, 87, 252)');
      assert.notEqual(offStyles.slash, 'none');
      assert.equal(offStyles.duplicate, 0);
      await page.locator('#cursor-share-toggle').hover();
      await page.waitForTimeout(180);
      assert.equal(await page.locator('.tooltip.visible').textContent(), 'Cursor sharing is off. Click to share your cursor.');
      await page.locator('#user-account-trigger').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(function () { return document.activeElement.id; }), 'cursor-share-toggle');
      assert.notEqual(await page.locator('#cursor-share-toggle').evaluate(function (element) { return getComputedStyle(element).outlineStyle; }), 'none');
      await page.locator('#fixture-sidebar-toggle').click();
      await page.waitForTimeout(240);
      var toggledGeometry = await page.evaluate(function () {
        var strip = document.getElementById('icon-strip').getBoundingClientRect();
        var avatar = document.querySelector('.user-island-avatar').getBoundingClientRect();
        var toggle = document.getElementById('cursor-share-toggle').getBoundingClientRect();
        return { collapsed: document.getElementById('layout').classList.contains('sidebar-collapsed'), avatarCenterDelta: Math.abs((strip.left + strip.width / 2) - (avatar.left + avatar.width / 2)), toggleCenterDelta: Math.abs((strip.left + strip.width / 2) - (toggle.left + toggle.width / 2)) };
      });
      assert.notEqual(toggledGeometry.collapsed, geometry.collapsed);
      assert.ok(toggledGeometry.avatarCenterDelta <= 1);
      assert.ok(toggledGeometry.toggleCenterDelta <= 1);
      await page.evaluate(function () { document.getElementById('sidebar-column').style.width = '300px'; window.accountFixture.sidebarContext.syncResizeHandles(); });
      await page.waitForTimeout(30);
      var resizedGeometry = await page.evaluate(function () {
        var strip = document.getElementById('icon-strip').getBoundingClientRect();
        var avatar = document.querySelector('.user-island-avatar').getBoundingClientRect();
        return Math.abs((strip.left + strip.width / 2) - (avatar.left + avatar.width / 2));
      });
      assert.ok(resizedGeometry <= 1);
      if (await page.locator('#account-popover').count() === 0) await page.locator('#user-account-trigger').click();
      await page.locator('#account-ai-summary').click();
      await page.screenshot({ path: '/tmp/account-island-' + item.name + '-edit.png', animations: 'disabled' });
      var editGeometry = await page.locator('#account-popover').boundingBox();
      assert.ok(editGeometry.y >= 0 && editGeometry.y + editGeometry.height <= 700);
    }
    await page.setViewportSize({ width: 280, height: 280 });
    await page.goto('http://127.0.0.1:' + port + '/test/fixtures/account-island-fixture.html?theme=dark&collapsed=0');
    var shortRail = await page.evaluate(function () {
      document.body.classList.add('mate-dm-active');
      window.accountFixture.sidebarContext.syncResizeHandles();
      function overlap(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
      var strip = document.getElementById('icon-strip').getBoundingClientRect();
      var rail = document.getElementById('user-island').getBoundingClientRect();
      var avatar = document.querySelector('.user-island-avatar').getBoundingClientRect();
      var toggle = document.getElementById('cursor-share-toggle').getBoundingClientRect();
      var add = document.getElementById('icon-strip-add').getBoundingClientRect();
      var users = document.getElementById('icon-strip-users').getBoundingClientRect();
      var mateSection = document.getElementById('icon-strip-mate-section').getBoundingClientRect();
      return { centerDelta: Math.abs((strip.left + strip.width / 2) - (avatar.left + avatar.width / 2)), toggleDelta: Math.abs((strip.left + strip.width / 2) - (toggle.left + toggle.width / 2)), overlap: overlap(rail, add) || overlap(rail, mateSection), duplicate: document.querySelectorAll('#icon-strip-me, .icon-strip-me-avatar').length, addBottom: add.bottom, railTop: rail.top, strip: { top: strip.top, bottom: strip.bottom, height: strip.height, paddingBottom: getComputedStyle(document.getElementById('icon-strip')).paddingBottom }, users: { top: users.top, bottom: users.bottom }, mateSection: { top: mateSection.top, bottom: mateSection.bottom } };
    });
    assert.ok(shortRail.centerDelta <= 1);
    assert.ok(shortRail.toggleDelta <= 1);
    assert.equal(shortRail.overlap, false, JSON.stringify(shortRail));
    assert.equal(shortRail.duplicate, 0);
    assert.ok(shortRail.addBottom <= shortRail.railTop || shortRail.addBottom <= 280);
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
});
