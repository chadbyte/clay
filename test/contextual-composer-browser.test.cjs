var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');
test('floating composers contain attachment/model controls and use real chooser and model acknowledgement paths', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); var output = '';
  child.stdout.on('data', function (data) { output += data; }); child.stderr.on('data', function (data) { output += data; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(async function () { await browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(10000);
  await page.addInitScript(function () {
    // Exercise the production speech lifecycle without opening a microphone or
    // contacting a recognition provider.
    window.AudioContext = undefined; window.webkitAudioContext = undefined;
    window.SpeechRecognition = function () { window.composerRecognition = this; };
    window.SpeechRecognition.prototype.start = function () { if (this.onstart) this.onstart(); };
    window.SpeechRecognition.prototype.abort = function () {};
  });
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login?to=alpha');
  assert.equal(await page.locator('#contextual-attach-btn').count(), 0, 'Native project composer is unchanged');
  var mates = [{ id: info.sourceSlug.slice(5), slug: info.sourceSlug, canonical: true }, info.ordinaryMates[0]];
  for (var mate of mates) {
    await page.setViewportSize({ width: 1280, height: 800 });
    var icon = mate.canonical ? page.locator('.icon-strip-brand') : page.locator('.icon-strip-project-mate[data-mate-id="' + mate.id + '"]');
    await icon.click();
    var pane = page.frameLocator('#contextual-clay iframe[data-mate-id="' + mate.id + '"]');
    await page.waitForFunction(function (id) { var f = document.querySelector('#contextual-clay iframe[data-mate-id="' + id + '"]'); return f && f.conversation && f.conversation.identity().ready; }, mate.id);
    var windowFrame = page.frames().find(function (frame) { return frame.url().includes(mate.slug); });
    var input = pane.locator('#input');
    await input.fill('A multiline draft\nwith its caret and attachments retained.');
    for (var width of [1280, 390]) {
      await page.setViewportSize({ width: width, height: 844 });
      await pane.locator('#contextual-attach-btn').focus(); await page.keyboard.press('Enter');
      await pane.getByRole('dialog', { name: 'Attachments and context' }).waitFor();
      assert.equal(await pane.locator('#attach-file-btn').evaluate(function (node) { return node === document.activeElement; }), true);
      await page.keyboard.press('ArrowDown');
      assert.equal(await pane.locator('#attach-image-btn').evaluate(function (node) { return node === document.activeElement; }), true);
      var bounds = await pane.locator('#contextual-attach-popover').evaluate(function (node) { var r = node.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
      assert.equal(bounds, true, 'Attachment popover stays within iframe');
      await page.keyboard.press('Escape');
      assert.equal(await pane.locator('#contextual-attach-btn').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#contextual-clay').isVisible(), true, 'Menu Escape leaves chat open');
      await pane.locator('#contextual-attach-btn').click();
      await pane.locator('#context-sources-add').focus(); await page.keyboard.press('Tab');
      await pane.locator('#contextual-attach-popover').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#contextual-clay').isVisible(), true, 'Tab exits the menu without dismissing chat');
      var geometry = await windowFrame.evaluate(function () {
        var area = document.getElementById('input-row').getBoundingClientRect();
        return ['contextual-attach-btn', 'config-chip', 'stt-btn', 'send-btn'].map(function (id) { var r = document.getElementById(id).getBoundingClientRect(); return { id: id, inside: r.left >= area.left && r.right <= area.right + 1 && r.top >= area.top && r.bottom <= area.bottom + 1 }; });
      });
      geometry.forEach(function (entry) { assert.equal(entry.inside, true, entry.id + ' is inside composer at ' + width); });
      await pane.locator('#config-chip').click(); await pane.locator('#config-popover:not(.hidden)').waitFor();
      assert.match(await pane.locator('#config-chip-label').textContent(), /Fixture/);
      assert.equal(await pane.locator('#config-popover').evaluate(function (node) { var r = node.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), true);
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#contextual-clay').isVisible(), true);
      await page.screenshot({ path: '/tmp/contextual-composer-' + (mate.canonical ? 'clay' : 'ordinary') + '-' + width + '.png', animations: 'disabled' });
    }
    for (var kind of ['file', 'image']) {
      t.diagnostic('Chooser: ' + mate.id + ' / ' + kind);
      await pane.locator('#contextual-attach-btn').click();
      var chooser = page.waitForEvent('filechooser'); await pane.locator('#attach-' + kind + '-btn').click();
      await (await chooser).setFiles(kind === 'file' ? { name: 'composer-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Composer attachment') } : { name: 'composer-pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64') });
      assert.equal(await pane.locator('#contextual-attach-btn').getAttribute('aria-expanded'), 'false');
    }
    await pane.locator('#image-preview-bar img').waitFor();
    await pane.locator('#image-preview-bar').getByText('composer-note.txt', { exact: false }).waitFor();
    await windowFrame.evaluate(async function () { (await import('./modules/ws-ref.js')).getWs().addEventListener('message', function (event) { var msg = JSON.parse(event.data); if (msg.type === 'model_selection_result') window.composerModelAck = msg; }); });
    await pane.locator('#config-chip').click();
    await pane.locator('#config-model-list button[data-model="fixture-model-alternative"]').click();
    await windowFrame.waitForFunction(function () { return window.composerModelAck && window.composerModelAck.ok && window.composerModelAck.model === 'fixture-model-alternative'; });
    assert.match(await pane.locator('#config-chip-label').textContent(), /Fixture alternative/);
    assert.equal(await input.inputValue(), 'A multiline draft\nwith its caret and attachments retained.');
    await pane.locator('#stt-btn-picker').click(); await pane.locator('#speech-picker').waitFor();
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#contextual-clay').isVisible(), true);
    await pane.locator('#stt-btn').click(); await pane.locator('#input-row.stt-recording').waitFor();
    await windowFrame.evaluate(function () { window.composerRecognition.onresult({ results: [[{ transcript: 'Voice continuation' }]] }); });
    assert.match(await input.inputValue(), /retained\. Voice continuation$/);
    assert.equal(await pane.locator('.stt-cancel').evaluate(function (node) { var r = node.getBoundingClientRect(), row = document.getElementById('input-row').getBoundingClientRect(); return r.left >= row.left && r.right <= row.right && r.bottom <= row.bottom; }), true);
    await page.screenshot({ path: '/tmp/contextual-composer-voice-' + (mate.canonical ? 'clay' : 'ordinary') + '.png', animations: 'disabled' });
    await pane.locator('#stt-btn').click();
    assert.equal(await pane.locator('#input-row.stt-recording').count(), 0);
    assert.match(await input.inputValue(), /Voice continuation$/);
    await input.fill('A multiline draft\nwith its caret and attachments retained.');
    await input.press('Escape'); await page.setViewportSize({ width: 1280, height: 800 }); await icon.click();
    assert.equal(await input.inputValue(), 'A multiline draft\nwith its caret and attachments retained.');
    assert.match(await pane.locator('#config-chip-label').textContent(), /Fixture alternative/);
    await page.locator('[data-clay-close]').click();
  }
  assert.deepEqual(errors, []);
  t.diagnostic('Canonical and ordinary: inside-composer geometry at desktop/narrow, keyboard attachment menu, bounded model menu, native File/Image chooser, actual alternative-model ACK, draft/attachment/voice and dismissal continuity; native project composer unchanged.');
});
