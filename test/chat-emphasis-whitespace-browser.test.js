var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var path = require('node:path');
var chromium = require('playwright').chromium;

test('chat preserves authored spaces and punctuation around emphasis in streaming and history', { timeout: 45000 }, async function (t) {
  var child = childProcess.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  child.stdout.resume(); child.stderr.resume();
  var info = await new Promise(function (resolve, reject) {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', function (code) { reject(new Error('Fixture exited with code ' + code)); });
  });
  var browser = await chromium.launch();
  t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  var errors = [], base = 'http://127.0.0.1:' + info.port;
  page.on('pageerror', function (error) { errors.push(error.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(base + '/fixture/login');
  var data = await (await page.request.get(base + '/fixture/state')).json();
  var id = data.standaloneId;
  var session = page.locator('.session-item[data-session-id="' + id + '"]').first();
  var pane = page.frameLocator('#split-host iframe[data-session-id="' + id + '"]');
  var paragraph = pane.locator('.msg-assistant .md-content p').filter({ hasText: 'Search sessions' });
  await session.click();
  await pane.getByText('EXACT_TRANSCRIPT_' + id, { exact: false }).waitFor();
  async function delta(text, kind) {
    var params = new URLSearchParams({ id: String(id), text: text, kind: kind });
    assert.ok((await page.request.post(base + '/fixture/live?' + params)).ok());
  }
  var intro = 'Search sessions now lets you select any combination of Title';
  await delta('**Search sessions** now lets you select any combination of **Ti', 'delta');
  await paragraph.getByText('Search sessions', { exact: true }).waitFor();
  await delta('tle**', 'delta');
  await paragraph.getByText('Title', { exact: true }).waitFor();
  assert.equal(await paragraph.textContent(), intro);
  assert.equal(await paragraph.innerText(), intro);
  assert.deepEqual(await paragraph.locator('strong').allTextContents(), ['Search sessions', 'Title']);

  var expected = intro + ', Chat content, PR, Issue, and Linear. Boldsuffix; "quoted?"에. Padded and nested text.';
  await delta(', **Chat content**, **PR**, **Issue**, and **Linear**. **Bold**suffix; **"quoted?"**에. ** Padded ** and **nested *text***.', 'turn');
  async function assertFinal() {
    await paragraph.getByText('Linear', { exact: true }).waitFor();
    assert.equal(await paragraph.textContent(), expected);
    assert.equal((await paragraph.innerText()).replace(/\n/g, ' '), expected);
    assert.deepEqual(await paragraph.locator('strong').allTextContents(), ['Search sessions', 'Title', 'Chat content', 'PR', 'Issue', 'Linear', 'Bold', '"quoted?"', 'Padded', 'nested text']);
    assert.equal(await paragraph.locator('em').textContent(), 'text');
    assert.equal(await paragraph.locator('strong').first().evaluate(function (el) { return getComputedStyle(el).display; }), 'inline');
  }
  await assertFinal();
  await page.reload();
  await page.locator('.session-item[data-session-id="' + id + '"]').first().waitFor();
  if (!await paragraph.isVisible()) {
    var reloadedFrame = page.locator('#split-host iframe[data-session-id="' + id + '"]');
    if (!await reloadedFrame.count()) await session.click();
  }
  await assertFinal();
  assert.deepEqual(errors, []);
});
