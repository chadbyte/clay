var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('ordinary pane receives a live permission prompt and only a human decision resolves it', { timeout: 45000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var logs = '';
  child.stdout.on('data', function (data) { logs += data; }); child.stderr.on('data', function (data) { logs += data; });
  var info = await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('Fixture startup failed: ' + logs.slice(-2000))); }, 10000);
    child.once('message', function (value) { clearTimeout(timer); resolve(value); }); child.once('error', reject);
  });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  await page.waitForFunction(function () {
    var frame = document.querySelector('#split-host .split-pane:not(.split-pane-cached) iframe');
    return frame && frame.clayPane && frame.clayPane.identity() && frame.clayPane.identity().ready;
  });
  var element = await page.locator('#split-host .split-pane:not(.split-pane-cached) iframe').first().elementHandle();
  var frame = await element.contentFrame();
  var id = await frame.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('activeSessionId'); });
  await page.request.post(base + '/fixture/live-permission?id=' + id);
  var prompt = frame.locator('.permission-container');
  await prompt.waitFor({ state: 'visible', timeout: 5000 });
  var state = await (await page.request.get(base + '/fixture/state')).json();
  assert.deepEqual(state.reviews, [], 'request remains pending until the user answers');
  await prompt.locator('.permission-allow, .mate-permission-allow').click();
  await page.waitForFunction(async function (base) { return (await (await fetch(base + '/fixture/state')).json()).reviews.length === 1; }, base);
  state = await (await page.request.get(base + '/fixture/state')).json();
  assert.equal(state.reviews[0].sessionId, id);
  assert.equal(state.reviews[0].decision.behavior, 'allow');
  assert.deepEqual(errors, []);
});
