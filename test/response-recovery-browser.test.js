var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var childProcess = require('node:child_process');
var chromium = require('playwright').chromium;

// Opt in because this exercises Chromium and the complete production browser app.
test('Claude recovery through production UI, WS, session replay and Stop', { skip: !process.env.RUN_RESPONSE_RECOVERY_BROWSER, timeout: 60000 }, async function(t) {
  var server = childProcess.fork(path.join(__dirname, 'fixtures/response-recovery-server.cjs'), [], { silent: true });
  var logs = '';
  server.stdout.on('data', function(bytes) { logs += bytes; });
  server.stderr.on('data', function(bytes) { logs += bytes; });
  var browser;
  try {
    var url = await new Promise(function(resolve, reject) {
      server.once('message', function(message) { resolve(message.url); });
      server.once('exit', function(code) { reject(new Error('Fixture exited ' + code + '\n' + logs)); });
    });
    browser = await chromium.launch({ headless: true });
    var page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10000);
    var errors = [];
    page.on('pageerror', function(error) { errors.push(error.message); });
    await page.goto(url);
    await page.waitForFunction(function() { return window.recoveryFixture && window.recoveryFixture.store.get('connected') && window.recoveryFixture.store.get('activeSessionId'); });
    async function state() { return page.evaluate(function() { return window.recoveryFixture.state(); }); }
    async function fresh() {
      var previous = await page.evaluate(function() { return window.recoveryFixture.store.get('activeSessionId'); });
      await page.locator('#fixture-fresh').click();
      await page.waitForFunction(function(id) { return window.recoveryFixture.store.get('activeSessionId') !== id && !window.recoveryFixture.store.get('processing'); }, previous);
      await page.locator('#input').fill('Please answer this isolated recovery check.');
      await page.locator('#send-btn').click();
      await page.waitForFunction(function() { return window.recoveryFixture.store.get('processing'); });
      await page.waitForFunction(async function() { var s = await window.recoveryFixture.state(); return s.timers.includes(180000); });
      assert.equal(await page.locator('#send-btn.stop:visible, #generation-stop:visible').count(), 1);
      await page.locator('#messages .activity-inline .mate-thinking-dots').waitFor({ state: 'visible' });
    }
    async function advance() {
      await page.locator('#fixture-advance').click();
      await page.locator('#messages').getByText('Stopping this attempt safely before retrying.', { exact: false }).last().waitFor();
      await page.waitForFunction(async function() { return (await window.recoveryFixture.state()).stopping; });
    }
    async function confirm() {
      await page.locator('#fixture-confirm').click();
      await page.waitForFunction(async function() { return !(await window.recoveryFixture.state()).stopping; });
    }
    await t.test('accepted silent request visibly stops, retries once, then clears spinner terminally', async function() {
      await fresh();
      await advance();
      await confirm();
      await page.locator('#messages').getByText('Retrying your original message once.', { exact: false }).waitFor();
      var retry = await state();
      assert.equal(retry.attempts.filter(function(attempt) { return attempt.sessionId === retry.sessionId; }).length, 2);
      await advance();
      await confirm();
      await page.locator('#messages').getByText('Claude still has not responded after one automatic retry.', { exact: false }).waitFor();
      await page.waitForFunction(function() { return !window.recoveryFixture.store.get('processing'); });
      assert.equal(await page.locator('#generation-stop').isVisible(), false);
      assert.equal((await state()).processing, false);
      assert.equal(await page.locator('#messages .activity-inline').count(), 0);
    });
    await t.test('successful replacement renders real assistant output and clears processing', async function() {
      await fresh();
      await advance(); await confirm();
      await page.locator('#fixture-reply').click();
      await page.locator('#messages').getByText('Fixture Claude received your message and responded successfully.').waitFor();
      await page.waitForFunction(function() { return !window.recoveryFixture.store.get('processing'); });
      assert.equal((await state()).timers.length, 0);
    });
    await t.test('actual WS disconnect restores processing and recovery history from server snapshot', async function() {
      await fresh();
      var before = await state();
      await page.locator('#fixture-disconnect-recover').click();
      await page.waitForFunction(function() { return !window.recoveryFixture.store.get('connected'); });
      await page.waitForFunction(function() { return window.recoveryFixture.store.get('connected') && window.recoveryFixture.store.get('activeProjectSlug') && window.recoveryFixture.store.get('processing'); });
      await page.locator('#messages').getByText('Retrying your original message once.', { exact: false }).waitFor();
      var after = await state();
      assert.ok(after.connections > before.connections);
      assert.equal(after.processing, true);
      await page.locator('#messages .activity-inline .mate-thinking-dots').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#send-btn.stop:visible, #generation-stop:visible').count(), 1);
      assert.equal(await page.locator('#messages .msg-user').count(), 1, 'replay keeps one original prompt');
      await page.locator('#fixture-reply').click();
      await page.waitForFunction(function() { return !window.recoveryFixture.store.get('processing'); });
      await page.locator('#fixture-disconnect').click();
      await page.waitForFunction(function() { return !window.recoveryFixture.store.get('connected'); });
      await page.waitForFunction(function() { return window.recoveryFixture.store.get('connected') && window.recoveryFixture.store.get('activeProjectSlug'); });
      await page.locator('#messages').getByText('Fixture Claude received your message and responded successfully.').waitFor();
      assert.equal(await page.locator('#generation-stop').isVisible(), false);
      assert.equal(await page.locator('#messages .msg-user').count(), 1);
    });
    await t.test('human Stop while automatic stop is pending prevents replacement', async function() {
      await fresh(); await advance();
      var before = await state();
      await page.locator('#send-btn.stop:visible, #generation-stop:visible').click();
      await confirm();
      await page.waitForFunction(function() { return !window.recoveryFixture.store.get('processing'); });
      var after = await state();
      assert.equal(after.attempts.length, before.attempts.length);
      assert.equal(after.timers.length, 0);
      assert.equal(await page.locator('#generation-stop').isVisible(), false);
      assert.equal(await page.locator('#messages').getByText('Retrying your original message once.', { exact: false }).count(), 0);
      await fresh();
      await page.locator('#send-btn.stop:visible, #generation-stop:visible').click();
      await page.waitForFunction(function() { return !window.recoveryFixture.store.get('processing'); });
      var stoppedBeforeDeadline = await state();
      assert.equal(stoppedBeforeDeadline.timers.length, 0, 'Stop before the deadline cancels its timer');
      assert.equal(stoppedBeforeDeadline.attempts.filter(function(attempt) { return attempt.sessionId === stoppedBeforeDeadline.sessionId; }).length, 1);
    });
    assert.deepEqual(errors, [], 'production UI has no browser exceptions');
    assert.deepEqual(await page.evaluate(function() { return window.fixtureErrors; }), []);
  } catch (error) {
    error.message += '\nFixture log tail:\n' + logs.slice(-5000);
    throw error;
  } finally {
    if (browser) await browser.close();
    var exited = new Promise(function(resolve) { server.once('exit', resolve); });
    server.kill('SIGTERM');
    await exited;
  }
});
