// Isolated production HTTP/WS app. Provider execution is fenced by the fixture.
var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('session citation pills and repeated native question deliveries retain exact identity', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_BENCH: '' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login');
  await page.waitForFunction(function () {
    var frame = document.querySelector('#split-host .split-pane:not(.split-pane-cached) iframe');
    var live = frame && frame.clayPane && frame.clayPane.identity();
    return live && live.ready;
  });
  var frame = await (await page.locator('#split-host .split-pane:not(.split-pane-cached) iframe').elementHandle()).contentFrame();
  var result = await frame.evaluate(async function () {
    var messages = await import('/p/reuse/modules/app-messages.js');
    var markdown = await import('/p/reuse/modules/markdown.js');
    var raw = { questions: [{ question: 'Which outcome?', options: [{ label: 'Ship' }, { label: 'Wait' }] }] };
    var normalized = { questions: [{ id: 'question_1', header: '', question: 'Which outcome?', multiSelect: false, allowOther: true, required: true, secret: false, options: [{ label: 'Ship', description: '' }, { label: 'Wait', description: '' }] }] };
    var ref = 'session:AAAAAAAAAAAAAAAAAAAAAAAA';
    messages.processMessage({ type: 'delta', text: '[firststep-studio-2/' + ref + ' · Oct 18]\n\n[Named](session:BBBBBBBBBBBBBBBBBBBBBBBB#entry-42)\n\n```\n[firststep-studio-2/' + ref + ' · Oct 18]\n```\n\n[firststep-studio-2/session:CCCC · Oct 18]' });
    messages.processMessage({ type: 'done', code: 0 });
    var root = document.getElementById('messages');
    markdown.enhanceClaySessionLinks(root); markdown.enhanceClaySessionLinks(root);
    var chips = Array.from(root.querySelectorAll('.clayos-session-link'));
    var pill = chips.find(function (item) { return item.dataset.sessionRef === ref; });
    var pills = { count: chips.length, label: pill && pill.textContent, ref: pill && pill.dataset.sessionRef,
      entry: chips.find(function (item) { return item.dataset.sessionEntryIndex === '42'; }) && true,
      codeLiteral: !root.querySelector('pre .clayos-session-link'), shortLiteral: root.textContent.includes('session:CCCC · Oct 18') };
    messages.processMessage({ type: 'tool_start', id: 'native-one', name: 'AskUserQuestion' });
    messages.processMessage({ type: 'tool_executing', id: 'native-one', name: 'AskUserQuestion', input: raw });
    var card = root.querySelector('.ask-user-container'), other = card.querySelector('.ask-user-other input');
    other.value = 'Keep my draft'; other.dispatchEvent(new Event('input', { bubbles: true }));
    messages.processMessage({ type: 'tool_executing', id: 'native-one', name: 'AskUserQuestion', input: normalized });
    messages.processMessage({ type: 'ask_user_pending', toolId: 'native-one', input: normalized });
    var question = { count: root.querySelectorAll('.ask-user-container').length, fields: card.querySelectorAll('.ask-user-question').length,
      sameNode: root.querySelector('.ask-user-container') === card, draft: other.value };
    messages.processMessage({ type: 'ask_user_answered', toolId: 'native-one', answers: { 0: 'Ship' } });
    messages.processMessage({ type: 'ask_user_pending', toolId: 'native-one', input: normalized });
    question.answered = card.classList.contains('answered');
    question.afterAnswer = root.querySelectorAll('.ask-user-container').length;
    messages.processMessage({ type: 'ask_user_pending', toolId: 'native-two', input: normalized });
    question.distinctRequests = root.querySelectorAll('.ask-user-container').length;
    return { pills: pills, question: question };
  });
  assert.deepEqual(result.pills, { count: 2, label: 'SessionOct 18', ref: 'session:AAAAAAAAAAAAAAAAAAAAAAAA', entry: true, codeLiteral: true, shortLiteral: true });
  assert.deepEqual(result.question, { count: 1, fields: 1, sameNode: true, draft: 'Keep my draft', answered: true, afterAnswer: 1, distinctRequests: 2 });
});
