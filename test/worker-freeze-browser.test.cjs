var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var path = require('node:path');
var chromium = require('playwright').chromium;

// Real app/router, Markdown, layout, tools and frame scheduling. No models or live sockets.
test('long Claude and Codex reasoning preserves output with bounded collapsed rendering in single and split panes', { timeout: 60000 }, async function () {
  var server = childProcess.fork(path.join(__dirname, 'fixtures/worker-freeze-browser-server.cjs'), [], { silent: true });
  var browser;
  try {
    var url = await new Promise(function (resolve, reject) {
      server.once('message', function (message) { resolve(message.url); });
      server.once('error', reject);
      server.once('exit', function (code) { reject(new Error('Fixture exited ' + code)); });
    });
    browser = await chromium.launch({ headless: true });
    var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    var errors = [];
    page.on('pageerror', function (error) { errors.push(error.message); });
    await page.goto(url);
    await page.waitForFunction(function () { return typeof window.runFreezeFixture === 'function'; });
    for (var vendor of ['claude', 'codex']) {
      var report = await page.evaluate(function (name) { return window.runFreezeFixture(name); }, vendor);
      assert.equal(report.checks, 'passed');
      assert.equal(report.markdownCalls, 0);
      assert.deepEqual(report.errors, []);
      console.log('single ' + JSON.stringify(report));
    }
    await page.goto(url + '/split');
    await page.waitForFunction(function () { return !document.getElementById('run').disabled; });
    var split = await page.evaluate(function () { return window.runSplitFixture(); });
    assert.equal(split.length, 2);
    split.forEach(function (report) {
      assert.equal(report.checks, 'passed');
      assert.equal(report.markdownCalls, 0);
      assert.deepEqual(report.errors, []);
      console.log('split ' + JSON.stringify(report));
    });
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    var exited = new Promise(function (resolve) { server.once('exit', resolve); });
    server.kill('SIGTERM');
    await exited;
  }
});
