var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('a delayed attach size cannot push the Terminal bottom rows outside its visible pane', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_PRESENTATION: '1', CLAY_PANE_WORKBENCH: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], hold = false, held = [], sizes = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  if (!process.env.CLAY_TERMINAL_VIEWPORT_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.routeWebSocket(/\/ws(?:\?|$)/, function (socket) {
    var server = socket.connectToServer();
    socket.onMessage(function (data) { var msg; try { msg = JSON.parse(String(data)); } catch (e) {} if (msg && msg.type === 'term_resize') sizes.push(msg); server.send(data); });
    server.onMessage(function (data) { var msg; try { msg = JSON.parse(String(data)); } catch (e) {} if (hold && msg && msg.type === 'term_resized') held.push(function () { socket.send(data); }); else socket.send(data); });
  });
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  await page.waitForFunction(function () { var header = document.querySelector('#split-host > .split-pane:not(.split-pane-cached) > header'); return header && !header.inert; });
  var terminal = page.locator('#terminal-container');
  await page.locator('#terminal-sidebar-btn').click(); await terminal.locator('.xterm-screen').waitFor();
  await page.waitForFunction(function () { var body = document.querySelector('#terminal-body').getBoundingClientRect(), screen = document.querySelector('.terminal-tab-body:not([style*="display: none"]) .xterm-screen').getBoundingClientRect(); return screen.height > 100 && screen.bottom <= body.bottom + 1; });
  var oldSize = sizes[sizes.length - 1]; assert.ok(oldSize && oldSize.rows > 10);
  await terminal.getByRole('button', { name: 'Close terminal pane', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 930 }); hold = true;
  await page.locator('#terminal-sidebar-btn').click(); await terminal.waitFor({ state: 'visible' });
  var deadline = Date.now() + 10000;
  while ((!held.length || !sizes.some(function (size) { return size.id === oldSize.id && size.rows < oldSize.rows; })) && Date.now() < deadline) await page.waitForTimeout(20);
  assert.ok(held.length, 'Delay the real authoritative attach-size response');
  assert.ok(sizes.some(function (size) { return size.id === oldSize.id && size.rows < oldSize.rows; }), 'The visible pane has already fitted its smaller viewport');
  // Model network latency longer than activation's existing 50ms follow-up fit.
  await page.waitForTimeout(250);
  hold = false; held.splice(0).forEach(function (deliver) { deliver(); });
  await page.evaluate(function () { return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); }); });
  var measured = await terminal.evaluate(function (el) {
    var body = el.querySelector('#terminal-body').getBoundingClientRect(), screen = el.querySelector('.terminal-tab-body:not([style*="display: none"]) .xterm-screen').getBoundingClientRect();
    return { bodyHeight: body.height, screenHeight: screen.height, clipped: screen.bottom - body.bottom };
  });
  assert.ok(measured.clipped <= 1, JSON.stringify(measured));
  assert.equal((await (await page.request.get(base + '/fixture/state')).json()).terminalStats.length, 1);
  assert.deepEqual(errors, []);
});
