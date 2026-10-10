var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var path = require('node:path');

function loadPlaywright() { try { return require('playwright'); } catch (error) { return null; } }

async function iconFace(page) {
  return page.locator('.icon-strip-brand').evaluate(function (el) {
    var face = getComputedStyle(el, '::before');
    var logo = el.querySelector('img');
    var box = logo.getBoundingClientRect();
    return { background: face.backgroundColor, shadow: face.boxShadow, border: face.border, image: logo.getAttribute('src'), width: box.width, height: box.height };
  });
}
async function geometry(page) {
  return page.evaluate(function () {
    return ['#main-area', '#sidebar-column', '.title-bar-content', '.header-worker-history-btn'].map(function (selector) {
      var box = document.querySelector(selector).getBoundingClientRect();
      return {selector: selector, x: box.x, y: box.y, width: box.width, height: box.height};
    });
  });
}
async function readingGeometry(page) {
  return page.evaluate(function () {
    return ['.msg-assistant .md-content', '#input', '#input-row', '#session-list .session-item-title'].map(function (selector) {
      var style = getComputedStyle(document.querySelector(selector));
      return {selector: selector, font: style.fontSize, line: style.lineHeight, padding: style.padding};
    });
  });
}
async function toolGrid(page) {
  return page.locator('#session-actions .palette-tile').evaluateAll(function (elements) {
    return elements.filter(function (element) { return element.getBoundingClientRect().width > 0; }).map(function (element) {
      var box = element.getBoundingClientRect();
      var label = element.querySelector('.tool-btn-label');
      var caption = label.getBoundingClientRect();
      var style = getComputedStyle(label);
      var icon = element.querySelector('.lucide').getBoundingClientRect();
      var text = document.createRange();
      text.selectNodeContents(label);
      return {
        label: label.textContent, x: box.x, y: box.y,
        iconWidth: icon.width, iconHeight: icon.height, font: style.fontSize,
        lines: caption.height / parseFloat(style.lineHeight),
        textFits: text.getBoundingClientRect().width <= caption.width + 0.5
      };
    });
  });
}
async function assertCanvasInset(page) {
  var inset = await page.evaluate(function () {
    var column = document.querySelector('#main-column').getBoundingClientRect();
    var canvas = document.querySelector('#main-panels').getBoundingClientRect();
    var header = document.querySelector('.title-bar-content').getBoundingClientRect();
    return {left: canvas.left - column.left, right: column.right - canvas.right, top: canvas.top - header.bottom, bottom: column.bottom - canvas.bottom, mobile: innerWidth <= 768};
  });
  assert.deepEqual(inset, {left: inset.mobile ? 4 : 0, right: inset.mobile ? 4 : 6, top: 0, bottom: inset.mobile ? 4 : 6, mobile: inset.mobile});
}
async function surface(page, selector) {
  return page.locator(selector).evaluate(function (el) {
    while (el) {
      var background = getComputedStyle(el).backgroundColor;
      if (background !== 'rgba(0, 0, 0, 0)') return background;
      el = el.parentElement;
    }
    return 'transparent';
  });
}
async function assertReachable(page, selector) {
  var visible = await page.locator(selector).evaluate(function (el) {
    var box = el.getBoundingClientRect();
    var target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.width > 0 && box.height > 0 && box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight && (target === el || el.contains(target));
  });
  assert.equal(visible, true, selector + ' must remain visible and unobscured');
}
async function chromeContrast(page) {
  return page.evaluate(function () {
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    var context = canvas.getContext('2d', {willReadFrequently: true});
    function luminance(color) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      var rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(function (value) {
        value /= 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }
    return ['.title-bar-project-name', '.title-bar-project-default', '#session-list .session-item-title', '#header-title'].map(function (selector) {
      var element = document.querySelector(selector);
      var style = getComputedStyle(element);
      var elementBackground = style.backgroundColor;
      if (elementBackground === 'rgba(0, 0, 0, 0)') elementBackground = getComputedStyle(document.querySelector('#sidebar-column')).backgroundColor;
      var background = luminance(elementBackground);
      var foreground = luminance(style.color);
      return {selector: selector, ratio: (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)};
    });
  });
}
async function roleLabelContrast(page) {
  return page.locator('.clay-role-label').evaluate(function (element) {
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    var context = canvas.getContext('2d', {willReadFrequently: true});
    function luminance(color) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      var rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(function (value) {
        value /= 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }
    var style = getComputedStyle(element);
    var background = style.backgroundColor;
    var ancestor = element.parentElement;
    while (background === 'rgba(0, 0, 0, 0)' && ancestor) {
      background = getComputedStyle(ancestor).backgroundColor;
      ancestor = ancestor.parentElement;
    }
    var foreground = style.color;
    var backgroundLuminance = luminance(background);
    var foregroundLuminance = luminance(foreground);
    return {background: background, foreground: foreground, ratio: (Math.max(backgroundLuminance, foregroundLuminance) + 0.05) / (Math.min(backgroundLuminance, foregroundLuminance) + 0.05)};
  });
}

test('production Clay workspace DOM: identity, native button access, scoped surfaces and compact geometry', async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright is not installed'); return; }
  var port = 33000 + process.pid % 10000;
  var server = childProcess.spawn(process.execPath, [path.join(__dirname, 'fixtures/session-folders-dom/serve.js'), String(port)], {stdio: ['ignore', 'pipe', 'pipe']});
  t.after(function () { if (!server.killed) server.kill('SIGTERM'); });
  await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('fixture server did not start')); }, 5000);
    server.stdout.on('data', function (chunk) { if (String(chunk).indexOf('DOM harness on') !== -1) { clearTimeout(timer); resolve(); } });
    server.on('exit', function (code) { clearTimeout(timer); reject(new Error('fixture server exited ' + code)); });
  });
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (error) { t.skip('Chromium is not available: ' + error.message); return; }
  t.after(async function () { await browser.close(); });
  var page = await browser.newPage({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  var pageErrors = [];
  page.on('pageerror', function (error) { pageErrors.push(error.message); });
  var base = 'http://127.0.0.1:' + port + '/clay-primary.html';
  async function open(query) {
    await page.goto(base + (query || ''), {waitUntil: 'networkidle'});
    await page.waitForSelector('body[data-ready="true"]');
  }
  await open();
  var entry = page.locator('.icon-strip-brand');

  await t.test('click, Enter and Space open the exact built-in with distinct active artwork', async function () {
    var face = await iconFace(page);
    await entry.click();
    assert.deepEqual(await page.evaluate(function () { return window.__opened; }), ['mate-clay-built-in']);
    assert.deepEqual(await page.evaluate(function () { return window.__panelCloses; }), ['terminal', 'files']);
    assert.equal(await entry.getAttribute('aria-current'), 'page');
    var activeFace = await iconFace(page);
    assert.notEqual(activeFace.background, face.background);
    assert.notEqual(activeFace.shadow, face.shadow);
    assert.equal(activeFace.border, face.border);
    assert.equal(activeFace.image, face.image);
    assert.equal(face.image, 'clay-studio-symbol.png');
    assert.equal(face.width, 38);
    assert.equal(await page.locator('[data-mate-id="clay-built-in"]').count(), 0);
    assert.equal(await page.locator('#clay-primary-agent-label').count(), 0);
    assert.equal(await page.locator('.title-bar-mate-avatar').count(), 0);
    assert.equal(await page.locator('.title-bar-project-icon').evaluate(function (el) { return getComputedStyle(el).display; }), 'none');
    var roleBadge = page.locator('#title-bar-project-default');
    assert.equal(await roleBadge.textContent(), 'Lead Mate');
    assert.equal(parseFloat(await roleBadge.evaluate(function (el) { return getComputedStyle(el).fontSize; })), 10);
    assert.equal((await roleBadge.boundingBox()).height, 18);
    assert.equal(await roleBadge.evaluate(function (el) { return getComputedStyle(el).borderRadius; }), '5px');
    assert.equal(await roleBadge.locator('.clay-role-insignia').count(), 1);
    assert.equal((await roleBadge.locator('.clay-role-insignia').boundingBox()).width, 12);
    assert.equal(parseFloat(await roleBadge.locator('.clay-role-insignia').evaluate(function (el) { return getComputedStyle(el).paddingLeft; })), 0);
    for (var part of ['.clay-role-insignia', '.clay-role-label']) {
      assert.equal(await roleBadge.locator(part).evaluate(function (el) { return getComputedStyle(el).backgroundColor; }), 'rgba(0, 0, 0, 0)', 'Badge contents share one surface');
    }
    assert.equal(await roleBadge.locator('.clay-role-insignia').evaluate(function (el) { return getComputedStyle(el).color; }), 'rgb(224, 180, 91)');
    assert.equal(await roleBadge.locator('.clay-role-label').evaluate(function (el) { return getComputedStyle(el).color; }), 'rgb(255, 255, 255)');
    assert.equal(await roleBadge.locator('.clay-role-label').count(), 1);
    await roleBadge.locator('svg').waitFor({state: 'attached'});
    assert.equal(await roleBadge.locator('svg').count(), 1);
    assert.equal(await page.locator('#title-bar-project-default').isVisible(), true);
    for (var key of ['Enter', 'Space']) {
      await page.getByRole('button', {name: 'Open Studio project', exact: true}).click();
      await entry.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await entry.evaluate(function (el) { return el === document.activeElement && el.matches(':focus-visible'); }), true);
      await page.keyboard.press(key);
      assert.equal(await entry.getAttribute('aria-current'), 'page');
    }
    assert.deepEqual(await page.evaluate(function () { return window.__opened; }), ['mate-clay-built-in', 'mate-clay-built-in', 'mate-clay-built-in']);
  });

  await t.test('light and dark materials preserve reading geometry and are isolated to Clay', async function () {
    for (var theme of ['light-theme', 'dark-theme']) {
      await open('?workspace=clay&theme=' + (theme === 'light-theme' ? 'light' : 'dark'));
      await page.locator('[data-mate-id="designer"]').click();
      var normal = await surface(page, '#sidebar-column');
      var reading = await surface(page, '#main-panels');
      var composer = await surface(page, '#input-row');
      var before = await geometry(page);
      var typography = await readingGeometry(page);
      var face = await iconFace(page);
      await entry.click();
      assert.notEqual(await surface(page, '#sidebar-column'), normal);
      assert.equal(await surface(page, '.title-bar-content'), await surface(page, '#sidebar-column'));
      assert.equal(await surface(page, '#main-panels'), reading);
      assert.notEqual(await surface(page, '#input-row'), composer);
      assert.deepEqual(await geometry(page), before);
      assert.deepEqual(await readingGeometry(page), typography);
      await assertCanvasInset(page);
      var activeFace = await iconFace(page);
      assert.notEqual(activeFace.background, face.background);
      assert.notEqual(activeFace.shadow, face.shadow);
      assert.equal(activeFace.image, face.image);
      var contrasts = await chromeContrast(page);
      contrasts.forEach(function (result) { assert.ok(result.ratio >= 4.5, result.selector + ' contrast ' + result.ratio); });
      var labelContrast = await roleLabelContrast(page);
      assert.notEqual(labelContrast.background, 'rgba(0, 0, 0, 0)', 'Lead Mate label background is composited');
      assert.ok(labelContrast.ratio >= 4.5, 'Lead Mate label contrast ' + labelContrast.ratio);
      await page.locator('.header-worker-history-btn').click();
      assert.equal(await page.getByRole('menu', {name: /Worker history for/}).isVisible(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.header-worker-history-btn').evaluate(function (el) { return el === document.activeElement; }), true);
      await page.locator('[data-mate-id="designer"]').click();
      assert.equal(await surface(page, '#sidebar-column'), normal);
      assert.equal(await surface(page, '#input-row'), composer);
      assert.equal(await entry.getAttribute('aria-current'), null);
      assert.equal(await page.locator('.title-bar-mate-avatar').count(), 1);
      assert.equal(await page.locator('.title-bar-project-icon.is-clay-identity').count(), 0);
      assert.match(await page.locator('#title-bar-project-default').textContent(), /Product design/);
    }
  });

  await t.test('direct Clay transitions clear mutually exclusive identity styling', async function () {
    await open('?workspace=clay');
    await page.locator('[data-mate-id="designer"]').click();
    assert.equal(await page.locator('#title-bar-project-dropdown').getAttribute('data-clay-identity'), null);
    assert.equal(await page.locator('#title-bar-project-dropdown').getAttribute('data-mate-bio'), 'true');
    assert.equal(await page.locator('#title-bar-project-default').evaluate(function (el) { return getComputedStyle(el).display; }), 'block');
    assert.equal(await page.locator('.title-bar-mate-avatar').count(), 1);

    await entry.click();
    await page.locator('[data-mate-id="quiet"]').click();
    assert.equal(await page.locator('#title-bar-project-dropdown').getAttribute('data-clay-identity'), null);
    assert.equal(await page.locator('#title-bar-project-dropdown').getAttribute('data-mate-bio'), null);
    assert.equal(await page.locator('#title-bar-project-default').evaluate(function (el) { return getComputedStyle(el).display; }), 'none');
    assert.equal(await page.locator('#title-bar-project-default').textContent(), '');
    assert.equal(await page.locator('.title-bar-mate-avatar').count(), 1);

    await entry.click();
    await page.locator('[data-mate-id="named-clay"]').click();
    assert.equal(await page.locator('#title-bar-project-dropdown').getAttribute('data-clay-identity'), null);
    assert.equal(await page.locator('#title-bar-project-dropdown').getAttribute('data-mate-bio'), 'true');
    assert.equal(await page.locator('.title-bar-mate-avatar').count(), 1);
    assert.equal(await page.locator('.title-bar-project-icon.is-clay-identity').count(), 0);
  });

  await t.test('settled Clay identity screenshots', async function () {
    await page.setViewportSize({width: 1280, height: 800});
    await open('?workspace=clay&theme=light');
    await page.screenshot({path: '/tmp/clay-identity-desktop-light.png'});
    await open('?workspace=clay&theme=dark');
    await page.screenshot({path: '/tmp/clay-identity-desktop-dark.png'});
    await page.setViewportSize({width: 1280, height: 800});
    await open('?workspace=clay&theme=light&sidebar=192');
    var sidebarBadge = page.locator('#title-bar-project-default');
    var sidebarBadgeBox = await sidebarBadge.boundingBox();
    assert.equal(sidebarBadgeBox.height, 18);
    assert.ok(sidebarBadgeBox.x >= 0 && sidebarBadgeBox.x + sidebarBadgeBox.width <= 192, 'Lead Mate badge fits the 192px sidebar');
    assert.equal((await page.locator('.title-bar-sidebar').boundingBox()).height, 48);
    await page.screenshot({path: '/tmp/clay-identity-sidebar-192-light.png'});
    await page.setViewportSize({width: 390, height: 800});
    await open('?workspace=clay&theme=light');
    await page.screenshot({path: '/tmp/clay-identity-narrow-light.png'});
    await page.setViewportSize({width: 1280, height: 800});
  });

  await t.test('late metadata, renaming, archived and unavailable built-ins cannot misidentify Clay', async function () {
    await open('?workspace=clay&late=1');
    assert.equal(await entry.isDisabled(), true);
    assert.equal(await page.locator('body').evaluate(function (el) { return el.classList.contains('clay-workspace-active'); }), false);
    await page.evaluate(function () { window.__loadMates(); });
    assert.equal(await entry.isEnabled(), true);
    assert.equal(await entry.getAttribute('aria-current'), 'page');
    await page.evaluate(function () {
      window.__store.set({cachedMatesList: [{id: 'clay-built-in', builtinKey: 'clay', name: 'Renamed', profile: {bio: 'A renamed companion'}}, {id: 'fake', name: 'Clay'}]});
    });
    assert.equal(await page.locator('#title-bar-project-name').textContent(), 'Renamed');
    assert.equal(await entry.getAttribute('aria-current'), 'page');
    await page.locator('[data-mate-id="fake"]').click();
    assert.equal(await entry.getAttribute('aria-current'), null);
    await entry.click();
    assert.equal(await page.evaluate(function () { return window.__store.get('currentSlug'); }), 'mate-clay-built-in');
    for (var unavailable of [[], [{id: 'clay-built-in', builtinKey: 'clay', archived: true}], [{id: 'fake', name: 'Clay'}]]) {
      await page.evaluate(function (mates) { window.__store.set({cachedMatesList: mates}); }, unavailable);
      assert.equal(await entry.isDisabled(), true);
      assert.equal(await entry.getAttribute('aria-current'), null);
      assert.equal(await entry.getAttribute('aria-label'), 'Clay is unavailable');
      assert.equal(await page.locator('body').evaluate(function (el) { return el.classList.contains('clay-workspace-active'); }), false);
    }
    await page.evaluate(function () { window.__loadMates(); });
    for (var state of [{homeShellVisible: true}, {homeShellVisible: false, dmMode: true}]) {
      await page.evaluate(function (next) { window.__store.set(next); }, state);
      assert.equal(await entry.getAttribute('aria-current'), null);
      assert.equal(await page.locator('body').evaluate(function (el) { return el.classList.contains('clay-workspace-active'); }), false);
    }
  });

  await t.test('desktop, narrow sidebar and mobile keep input and header controls reachable', async function () {
    for (var theme of ['light', 'dark']) {
      await open('?workspace=clay&theme=' + theme);
      for (var width of [1280, 980, 769, 390, 320]) {
        await page.setViewportSize({width: width, height: 900});
        if (width === 980) {
          await page.locator('#sidebar-column').evaluate(function (el) { el.style.width = '192px'; });
          await page.waitForFunction(function () { return document.querySelector('#sidebar-column').getBoundingClientRect().width === 192; });
        }
        assert.equal(await page.evaluate(function () { return document.documentElement.scrollWidth <= innerWidth; }), true, 'no horizontal overflow at ' + width);
        await assertReachable(page, '#send-btn');
        await assertReachable(page, '#input');
        await assertReachable(page, '.header-worker-history-btn');
        await assertReachable(page, '#find-in-session-btn');
        if (width > 768) await assertReachable(page, '.icon-strip-brand');
        await assertCanvasInset(page);
        var before = await geometry(page);
        await page.evaluate(function () { window.__store.set({currentSlug: 'mate-designer'}); });
        assert.deepEqual(await geometry(page), before, 'surface switching preserves layout at ' + width);
        await page.evaluate(function () { window.__store.set({currentSlug: 'mate-clay-built-in'}); });
      }
    }
  });

  await t.test('Mate tools stay in a compact 3 by 2 grid at 192px and sidebar actions remain operable', async function () {
    await page.setViewportSize({width: 1280, height: 900});
    await open('?workspace=project&sidebar=192');
    var projectTools = await toolGrid(page);
    assert.equal(new Set(projectTools.map(function (tool) { return tool.x; })).size, 4);
    for (var mate of ['.icon-strip-brand', '[data-mate-id="designer"]']) {
      await page.locator(mate).click();
      var mateTools = await toolGrid(page);
      assert.equal(mateTools.length, 6);
      assert.equal(new Set(mateTools.map(function (tool) { return tool.x; })).size, 3);
      assert.equal(new Set(mateTools.map(function (tool) { return tool.y; })).size, 2);
      mateTools.forEach(function (tool) {
        assert.equal(tool.iconWidth, 28, tool.label + ' keeps its compact icon face');
        assert.equal(tool.iconHeight, 28);
        assert.equal(tool.font, '10.5px');
        if (['Knowledge', 'Scheduled', 'Browser', 'Debates'].indexOf(tool.label) !== -1) {
          assert.ok(tool.lines <= 1.1, tool.label + ' stays on one line');
          assert.equal(tool.textFits, true, tool.label + ' is not clipped');
        }
      });
    }
    await page.getByRole('button', {name: 'Open Studio project', exact: true}).click();
    assert.deepEqual(await toolGrid(page), projectTools, 'ordinary project tools retain their original layout');
    await entry.click();
    var sidebar = page.locator('#sidebar-column');
    var width = (await sidebar.boundingBox()).width;
    await page.locator('#sidebar-toggle-btn').click();
    await page.waitForFunction(function () { return document.querySelector('#sidebar-column').getBoundingClientRect().width === 0; });
    await assertReachable(page, '#sidebar-expand-btn');
    await page.locator('#sidebar-expand-btn').click();
    await page.waitForFunction(function (expected) { return document.querySelector('#sidebar-column').getBoundingClientRect().width === expected; }, width);
    var row = page.locator('#session-list .session-item.active');
    assert.equal((await row.boundingBox()).height, 36);
    await row.hover();
    var star = row.locator('.session-folder-star-btn');
    await assertReachable(page, '#session-list .session-item.active .session-folder-star-btn');
    await star.focus();
    assert.equal(await star.evaluate(function (el) { return el === document.activeElement; }), true);
    await page.locator('.header-worker-history-btn').click();
    assert.equal(await page.getByRole('menu', {name: /Worker history for/}).getByRole('menuitem').count(), 2);
    await page.keyboard.press('Escape');
  });

  await t.test('split preview keeps both production canvases and the Worker status clear', async function () {
    await page.setViewportSize({width: 1440, height: 1000});
    for (var theme of ['light', 'dark']) {
      await open('?workspace=clay&theme=' + theme + '&split=1');
      await page.frameLocator('iframe').locator('body[data-ready="true"]').waitFor();
      assert.equal(await page.locator('.split-pane').count(), 2);
      assert.equal(await page.frameLocator('iframe').locator('#input-wrapper').isVisible(), false);
      assert.equal(await page.frameLocator('iframe').locator('.worker-pane-status').isVisible(), true);
      assert.equal(await page.frameLocator('iframe').locator('#input').isDisabled(), true);
      assert.equal(await page.locator('#input').isEnabled(), true);
      assert.equal(await page.locator('#input').inputValue(), 'Let’s start with the workspace.');
      await assertReachable(page, '#send-btn');
      await assertReachable(page, '.header-worker-history-btn');
      await page.locator('.header-worker-history-btn').click();
      assert.equal(await page.getByRole('menu', {name: /Worker history for/}).getByRole('menuitem').count(), 2);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', {name: 'Close Worker preview'}).click();
    assert.equal(await page.locator('.split-pane').count(), 1);
    await assertReachable(page, '#send-btn');
  });
  assert.deepEqual(pageErrors, []);
});
