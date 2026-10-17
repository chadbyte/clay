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
    var file = path.resolve(root, relative);
    if (file.indexOf(root + path.sep) !== 0 || !fs.existsSync(file)) { response.writeHead(404); response.end('not found'); return; }
    var extension = path.extname(file);
    var type = extension === '.js' ? 'text/javascript' : extension === '.css' ? 'text/css' : 'text/html';
    response.writeHead(200, { 'Content-Type': type });
    response.end(fs.readFileSync(file));
  });
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server); }); });
}

test('GitHub review fixture renders all review and lifecycle icons across themes and widths', async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright is not installed'); return; }
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (error) { t.skip('Chromium is not available: ' + error.message); return; }
  var server = await serveRepository();
  t.after(function () { server.close(); return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('http://127.0.0.1:' + server.address().port + '/test/fixtures/github-work-density-preview.html');
  await page.waitForFunction(function () { return document.querySelectorAll('svg.lucide').length >= 10; });
  var desktop = await page.evaluate(function () {
    return {
      changes: document.querySelectorAll('.github-review-changes svg.lucide-message-square-warning').length,
      approved: document.querySelectorAll('.github-review-approved svg.lucide-badge-check').length,
      requested: document.querySelectorAll('.github-review-requested svg.lucide-user-round-check').length,
      merged: document.querySelectorAll('.github-state-merged svg.lucide-git-merge').length,
      draft: document.querySelectorAll('.github-state-draft svg.lucide-git-pull-request-draft').length,
      visibleLabels: Array.from(document.querySelectorAll('.github-work-status')).map(function (item) { return item.textContent.trim(); }),
      desktopWidth: document.querySelector('.preview-panel.wide').getBoundingClientRect().width
    };
  });
  assert.equal(desktop.changes, 2);
  assert.equal(desktop.approved, 2);
  assert.equal(desktop.requested, 2);
  assert.equal(desktop.merged, 2);
  assert.equal(desktop.draft, 2);
  assert.deepEqual(desktop.visibleLabels, ['', '', '', '', '', '', '', '', '', '']);
  assert.ok(desktop.desktopWidth > 400);
  await page.locator('#theme-toggle').click();
  await page.setViewportSize({ width: 600, height: 900 });
  var narrow = await page.evaluate(function () {
    return { dark: !document.documentElement.classList.contains('light-theme'), narrowVisible: document.querySelector('.preview-panel.narrow').getBoundingClientRect().width, wideHidden: getComputedStyle(document.querySelector('.preview-panel.wide')).display === 'none' };
  });
  assert.equal(narrow.dark, true);
  assert.ok(narrow.narrowVisible >= 300);
  assert.equal(narrow.wideHidden, true);
});
