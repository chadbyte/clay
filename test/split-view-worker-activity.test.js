var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), chromium = require('playwright').chromium;
test('Worker transcripts reuse session bubbles and tool chrome with safe read-only evidence and proportional fonts', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); child.stdout.resume(); child.stderr.resume(); var info = await new Promise(function (resolve) { child.once('message', resolve); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); }); var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await require('./fixtures/source-module-runtime.cjs').install(page); await page.goto('http://127.0.0.1:' + info.port + '/fixture/login');
  var result = await page.evaluate(async function () {
    var renderer = await import('/p/reuse/modules/split-view-worker-transcript.js'), activity = await import('/p/reuse/modules/split-view-worker-activity.js');
    var bubble = await import('/p/reuse/modules/chat-bubble-renderer.js'), tool = await import('/p/reuse/modules/session-tool-item.js');
    var body = document.createElement('section'); body.className = 'readonly-session-transcript'; document.body.appendChild(body);
    var rows = [{ role: 'user', text: 'Question', recordIndex: 0 }, { role: 'assistant', text: '**Answer**\n\n```js\nvar answer = 1;\n```', recordIndex: 1 },
      { role: 'tool', text: 'Used Read', recordType: 'tool_start', recordIndex: 2, toolId: 'a', toolName: 'Read' },
      { role: 'tool', text: '{"file_path":"fixture.txt"}', recordType: 'tool_executing', recordIndex: 3, toolId: 'a', toolName: 'Read' },
      { role: 'tool', text: '<img src=x onerror=evil()>', recordType: 'tool_result', recordIndex: 4, toolId: 'a' }];
    renderer.appendWorkerTranscript(body, rows);
    var expected = bubble.createAssistantBubble({ name: 'Worker', avatarUrl: '/claude-code-avatar.png' }); bubble.renderAssistantBubbleText(expected, rows[1].text, true, { readOnly: true });
    var actual = body.querySelector('.msg-assistant');
    var sameMarkup = actual.innerHTML === expected.innerHTML;
    var item = body.querySelector('.tool-item'), expectedTool = tool.createSessionToolItem('a', 'Read');
    var sameToolChrome = Array.from(expectedTool.querySelector('.tool-header').children).map(function (el) { return el.className; }).join(',') === Array.from(item.querySelector('.tool-header').children).map(function (el) { return el.className; }).join(',');
    item.querySelector('.tool-header').click(); var evidence = item.querySelector('pre').textContent;
    var saved = activity.captureWorkerDisclosures(body); body.textContent = ''; renderer.appendWorkerTranscript(body, rows); activity.restoreWorkerDisclosures(body, saved);
    var malicious = { role: 'assistant', recordIndex: 7, text: '<script>window.evil=true</script><input autofocus><iframe src="/bad"></iframe>' }; renderer.appendWorkerMessage(body, malicious);
    var values = { sameMarkup: sameMarkup, sameToolChrome: sameToolChrome, evidence: evidence, count: body.children.length,
      expanded: body.querySelector('.tool-header').getAttribute('aria-expanded'), proseSize: getComputedStyle(body.querySelector('.md-content')).fontSize,
      pillSize: getComputedStyle(body.querySelector('.tool-name')).fontSize, smallSize: getComputedStyle(body.querySelector('.tool-subtitle-text')).fontSize,
      unsafe: body.querySelectorAll('script,input,iframe').length, code: body.querySelector('code').textContent, userBubble: !!body.querySelector('.msg-user .bubble') };
    body.remove(); return values;
  });
  assert.equal(result.sameMarkup, true); assert.equal(result.sameToolChrome, true); assert.equal(result.userBubble, true); assert.equal(result.count, 4);
  assert.equal(result.evidence, '<img src=x onerror=evil()>'); assert.equal(result.expanded, 'true'); assert.equal(result.unsafe, 0);
  assert.equal(result.proseSize, '12px'); assert.equal(result.pillSize, '12px'); assert.ok(parseFloat(result.smallSize) < 12); assert.match(result.code, /var answer = 1/);
});
