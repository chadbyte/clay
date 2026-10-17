var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
['normal', 'long-turn'].forEach(function (benchmark) {
  test('real sidebar ' + benchmark + ': 30 genuine first visits and 30 cached pairs', { timeout: 120000 }, async function (t) {
    var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {
      env: Object.assign({}, process.env, { CLAY_PANE_BENCH: benchmark }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    t.after(function () { child.kill('SIGTERM'); });
    var logs = '';
    child.stdout.on('data', function (data) { logs += data; }); child.stderr.on('data', function (data) { logs += data; });
    var info = await new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('Fixture startup timeout: ' + logs)); }, 20000);
      child.once('message', function (value) { clearTimeout(timer); resolve(value); });
      child.once('exit', function (code) { if (code) { clearTimeout(timer); reject(new Error(logs)); } });
    });
    var browser = await chromium.launch(); t.after(function () { return browser.close(); });
    var page = await browser.newPage(); var errors = [];
    page.on('pageerror', function (error) { errors.push(error.message); });
    await page.goto('http://127.0.0.1:' + info.port + '/fixture/login');
    await page.getByRole('button', { name: 'Run pane benchmark' }).click();
    await page.waitForFunction(function () {
      var status = document.querySelector('[aria-label="Pane performance fixture"] [role="status"]');
      return window.paneReuseBenchResult || status && status.textContent.startsWith('Benchmark error:');
    }, null, { timeout: 100000 });
    var result = await page.evaluate(function () { return window.paneReuseBenchResult; });
    assert.ok(result, await page.getByRole('status').last().textContent());
    console.log(JSON.stringify(result));
    await page.screenshot({ path: '/tmp/clay-pane-bench-' + benchmark + '.png' });
    assert.deepEqual(errors, [], 'no browser errors');
    ['firstVisit', 'cached'].forEach(function (cohort) {
      assert.equal(result[cohort].samples.length, 30);
      assert.ok(result[cohort].max < 1000, cohort + ' max exceeded 1000 ms: ' + result[cohort].max);
    });
  });
});
