var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var path = require('node:path');

function loadPlaywright() { try { return require('playwright'); } catch (error) { return null; } }
function isIdentityTransform(value) { return value === 'none' || value === 'matrix(1, 0, 0, 1, 0, 0)'; }

test('Clay rail uses production faces and restores only the coherent project session', async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright is not installed'); return; }
  var port = 36000 + process.pid % 10000;
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
  var page = await browser.newPage({viewport: {width: 1280, height: 900}, reducedMotion: 'no-preference'});
  page.setDefaultTimeout(10000);
  var base = 'http://127.0.0.1:' + port + '/clay-primary.html';
  await page.goto(base, {waitUntil: 'networkidle'});
  await page.waitForSelector('body[data-ready="true"]');
  var entry = page.locator('.icon-strip-brand');

  await t.test('two-face markup flips the icon without moving the logo geometry', async function () {
    assert.equal(await entry.locator('.clay-brand-flip').count(), 1);
    assert.equal(await entry.locator('.clay-brand-face').count(), 2);
    var geometry = await entry.evaluate(function (el) {
      var logo = el.querySelector('.clay-brand-logo');
      var face = getComputedStyle(logo);
      var box = logo.getBoundingClientRect();
      var flip = getComputedStyle(el.querySelector('.clay-brand-flip'));
      return {position: face.position, inset: face.inset, width: box.width, height: box.height, transform: flip.transform, transition: flip.transitionDuration};
    });
    assert.equal(geometry.position, 'absolute');
    assert.equal(geometry.inset, '0px');
    assert.deepEqual([geometry.width, geometry.height], [38, 38]);
    var avatarImage = await entry.locator('.clay-brand-avatar').evaluate(function (image) {
      return {source: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight};
    });
    assert.equal(avatarImage.source, '/mate-avatars/lead-clay.png?v=2');
    assert.ok(avatarImage.width > 0 && avatarImage.height > 0, 'canonical Clay portrait must load');
    assert.equal(isIdentityTransform(geometry.transform), true);
    await entry.hover();
    await page.waitForTimeout(260);
    var projectHover = await entry.locator('.clay-brand-flip').evaluate(function (el) { return getComputedStyle(el).transform; });
    assert.equal(isIdentityTransform(projectHover), false);
    await entry.click();
    await page.waitForTimeout(260);
    await page.mouse.move(500, 500);
    await page.waitForTimeout(260);
    var mateDefault = await entry.locator('.clay-brand-flip').evaluate(function (el) { return {transform: getComputedStyle(el).transform, mode: el.parentElement.dataset.clayMode, hover: el.parentElement.matches(':hover')}; });
    assert.equal(isIdentityTransform(mateDefault.transform), false, JSON.stringify(mateDefault));
    await entry.hover();
    await page.waitForTimeout(260);
    var mateHover = await entry.locator('.clay-brand-flip').evaluate(function (el) { return getComputedStyle(el).transform; });
    assert.equal(isIdentityTransform(mateHover), true);
  });

  await t.test('tooltip and speech precedence follow the exact Clay state', async function () {
    await page.locator('[data-slug="project"]').click();
    await page.mouse.move(500, 500);
    await entry.hover();
    await page.waitForTimeout(260);
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.icon-strip-tooltip-label').textContent(), 'Open Clay');
    await page.evaluate(function () { window.__store.set({currentSlug: 'mate-designer', activeProjectSlug: 'mate-designer', sessionActivatedProjectSlug: 'mate-designer'}); });
    await page.mouse.move(500, 500);
    await entry.hover();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.icon-strip-tooltip-label').textContent(), 'Open Clay');
    await page.evaluate(function () { window.__store.set({youActivity: {active: true}}); });
    assert.equal(await entry.evaluate(function (el) { return el.classList.contains('clay-speaking'); }), true);
    var speakingProject = await entry.locator('.clay-brand-flip').evaluate(function (el) { return getComputedStyle(el).transform; });
    assert.equal(isIdentityTransform(speakingProject), false);
    await entry.click();
    await page.evaluate(function () { window.__store.set({youActivity: {active: true}}); });
    await entry.hover();
    var speakingMate = await entry.locator('.clay-brand-flip').evaluate(function (el) { return getComputedStyle(el).transform; });
    assert.equal(isIdentityTransform(speakingMate), false);
    await page.evaluate(function () { window.__store.set({youActivity: {active: false}}); });
    await page.mouse.move(500, 500);
    await entry.hover();
    await page.waitForTimeout(260);
    var quietMate = await entry.locator('.clay-brand-flip').evaluate(function (el) { return getComputedStyle(el).transform; });
    assert.equal(isIdentityTransform(quietMate), true);
  });

  await t.test('valid sessions use the real project-session-navigation WS path', async function () {
    await page.evaluate(function () {
      window.__opened.length = 0;
      window.__sent.length = 0;
      window.__store.set({currentSlug: 'project', activeProjectSlug: 'project', sessionActivatedProjectSlug: 'project', activeSessionId: 824, homeShellVisible: false, dmMode: false, youActivity: {active: false}});
    });
    await entry.click();
    await entry.click();
    var state = await page.evaluate(function () { return {opened: window.__opened.slice(), sent: window.__sent.slice(), target: window.__store.get('clayReturnTarget')}; });
    assert.deepEqual(state.opened, ['mate-clay-built-in', 'project']);
    assert.deepEqual(state.sent.filter(function (message) { return message.type === 'switch_session'; }), [{type: 'switch_session', id: 824}]);
    assert.equal(state.target, null);
  });

  await t.test('deleted sources drop the session and fall back safely', async function () {
    await page.evaluate(function () {
      window.__opened.length = 0;
      window.__sent.length = 0;
      window.__store.set({projectsHubList: [{slug: 'fallback', title: 'Fallback'}], currentSlug: 'mate-clay-built-in', activeProjectSlug: 'mate-clay-built-in', sessionActivatedProjectSlug: 'mate-clay-built-in', clayReturnTarget: {projectSlug: 'deleted', sessionId: 824}, pendingProjectSessionNavigation: null});
    });
    await entry.click();
    var result = await page.evaluate(function () { return {opened: window.__opened.slice(), sent: window.__sent.slice(), pending: window.__store.get('pendingProjectSessionNavigation')}; });
    assert.deepEqual(result.opened, ['fallback']);
    assert.deepEqual(result.sent.filter(function (message) { return message.type === 'switch_session'; }), []);
    assert.equal(result.pending, null);
  });

  await t.test('entry path captures the latest coherent project and cancels stale return navigation', async function () {
    await page.evaluate(function () {
      window.__opened.length = 0;
      window.__sent.length = 0;
      window.__store.set({projectsHubList: [{slug: 'project', title: 'Studio'}, {slug: 'other', title: 'Other'}], currentSlug: 'project', activeProjectSlug: 'project', sessionActivatedProjectSlug: 'project', activeSessionId: 831, clayReturnTarget: null, pendingProjectSessionNavigation: null, clayReturnPendingProjectSlug: null});
      window.__store.set({currentSlug: 'other'});
    });
    assert.equal(await page.evaluate(function () { return window.__store.get('clayReturnTarget'); }), null);
    await page.evaluate(function () { window.__store.set({activeProjectSlug: 'other', sessionActivatedProjectSlug: 'other', activeSessionId: 832}); });
    await page.evaluate(function () { return window.__openMateWorkspace('clay-built-in'); });
    var captured = await page.evaluate(function () { return window.__store.get('clayReturnTarget'); });
    assert.deepEqual(captured, {projectSlug: 'other', sessionId: 832});
    await page.evaluate(function () {
      window.__holdProjectActivation = true;
      window.__store.set({currentSlug: 'mate-clay-built-in', activeProjectSlug: 'mate-clay-built-in', sessionActivatedProjectSlug: 'mate-clay-built-in', clayReturnTarget: {projectSlug: 'other', sessionId: 832}});
    });
    await entry.click();
    await page.evaluate(function () { window.__store.set({currentSlug: 'project', activeProjectSlug: 'project', sessionActivatedProjectSlug: 'project'}); });
    var pending = await page.evaluate(function () { return window.__store.get('pendingProjectSessionNavigation'); });
    assert.equal(pending, null);
  });

  var reduceContext = await browser.newContext({viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
  var reduced = await reduceContext.newPage();
  await reduced.goto(base, {waitUntil: 'networkidle'});
  await reduced.waitForSelector('body[data-ready="true"]');
  assert.equal(await reduced.locator('.clay-brand-flip').evaluate(function (el) { return getComputedStyle(el).transitionDuration; }), '0s');
  await reduceContext.close();
});
