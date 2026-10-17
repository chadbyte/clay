// The top-bar usage popovers must paint above the chat surface and below the
// contextual Clay window and modals. Uses the production stylesheet with a
// synthetic DOM served from an isolated in-process static server (no accounts,
// providers or daemon).
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var http = require('node:http');
var path = require('node:path');
var chromium = require('playwright').chromium;

var PUBLIC = path.join(__dirname, '../lib/public');
var TYPES = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
var PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body class="capsules-disabled">' +
  '<div id="layout"><div id="top-bar"><div class="top-bar-actions">' +
  '<div class="vendor-usage-overview">' +
  '<div class="vendor-usage-item" id="item-one"><button class="vendor-usage-chip" id="chip-one" aria-expanded="true">Claude 40%</button>' +
  '<div class="vendor-usage-popover" id="pop-one"><div class="vendor-usage-popover-title">Claude</div><div class="vendor-usage-row">Weekly 40%</div></div></div>' +
  '<div class="vendor-usage-item" id="item-all"><button class="vendor-usage-chip" id="chip-all" aria-expanded="false">All</button>' +
  '<div class="vendor-usage-popover vendor-usage-list-popover" id="pop-all" hidden><div class="vendor-usage-popover-title">Usage by vendor</div><div class="vendor-usage-list-row">Codex 12%</div></div></div>' +
  '</div><button id="server-settings-btn">S</button></div></div>' +
  '<div id="layout-body"><div id="main-area"><div id="main-column"><div id="chat-surface" style="position:relative;z-index:100;height:600px;background:#fff">chat</div></div></div></div></div>' +
  '<div id="contextual-clay" style="left:900px;top:20px;width:300px;height:300px;background:#eee">clay</div>' +
  '<div id="confirm-modal"><div id="confirm-box" style="width:200px;height:100px;background:#fff">modal</div></div>' +
  '</body></html>';

function serve() {
  var server = http.createServer(function (req, res) {
    var url = req.url.split('?')[0];
    if (url === '/__layer') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
    var file = path.join(PUBLIC, url);
    if (file.indexOf(PUBLIC) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
  });
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server); }); });
}

// What the user would hit at the centre of the popover's overlap with chat.
function topmost(page, id) {
  return page.evaluate(function (target) {
    var el = document.getElementById(target); var r = el.getBoundingClientRect();
    var bar = document.getElementById('top-bar').getBoundingClientRect();
    var y = Math.max(r.top, bar.bottom + 4) + 4; var x = r.left + 20;
    var hit = document.elementFromPoint(x, y);
    return { inside: !!hit && el.contains(hit), overChat: r.bottom > bar.bottom, tag: hit && (hit.id || hit.className) };
  }, id);
}

test('usage popovers paint above chat, below the contextual Clay window and modals', { timeout: 60000 }, async function (t) {
  var server = await serve(); t.after(function () { server.close(); });
  var browser = await chromium.launch({ headless: true }); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:' + server.address().port + '/__layer');
  await page.evaluate(function () { document.getElementById('contextual-clay').hidden = true; document.getElementById('confirm-modal').style.display = 'none'; });

  var one = await topmost(page, 'pop-one');
  assert.equal(one.overChat, true, 'individual popover overlaps the chat surface');
  assert.equal(one.inside, true, 'individual popover is hit-testable above chat, hit ' + one.tag);

  await page.evaluate(function () { document.getElementById('pop-one').hidden = true; document.getElementById('pop-all').hidden = false; });
  var all = await topmost(page, 'pop-all');
  assert.equal(all.overChat, true);
  assert.equal(all.inside, true, 'all-vendors popover is hit-testable above chat, hit ' + all.tag);

  // Contextual Clay (desktop z160) and modals keep precedence over the popover.
  await page.evaluate(function () {
    var c = document.getElementById('contextual-clay'); c.hidden = false;
    var p = document.getElementById('pop-all').getBoundingClientRect();
    c.style.left = (p.left - 10) + 'px'; c.style.top = '0px'; c.style.width = (p.width + 20) + 'px'; c.style.height = '400px';
  });
  var under = await page.evaluate(function () {
    var p = document.getElementById('pop-all').getBoundingClientRect();
    return document.getElementById('contextual-clay').contains(document.elementFromPoint(p.left + 20, p.top + 10));
  });
  assert.equal(under, true, 'contextual Clay stays above the popover');
  await page.evaluate(function () { document.getElementById('contextual-clay').hidden = true; document.getElementById('confirm-modal').style.display = 'flex'; });
  var modal = await page.evaluate(function () {
    var p = document.getElementById('pop-all').getBoundingClientRect();
    return document.getElementById('confirm-modal').contains(document.elementFromPoint(p.left + 20, p.top + 10));
  });
  assert.equal(modal, true, 'a modal stays above the popover');
});

test('narrow viewports hide the top bar so no popover can sit behind chat', { timeout: 60000 }, async function (t) {
  var server = await serve(); t.after(function () { server.close(); });
  var browser = await chromium.launch({ headless: true }); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 600, height: 800 } });
  await page.goto('http://127.0.0.1:' + server.address().port + '/__layer');
  assert.equal(await page.evaluate(function () { return getComputedStyle(document.getElementById('top-bar')).display; }), 'none');
});
