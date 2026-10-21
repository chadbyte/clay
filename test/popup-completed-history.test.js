var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
var element = require('./fixtures/popup-tool-dom.cjs').element;
function fixture(legacyRegistry) {
  var body = element('body'), transcript = element('section'), input = element('textarea'), state = { replayingHistory: true, activeSessionId: 7, sessionOriginId: 'origin-7', sessionIsProcessing: false }, opened = [], frames = [];
  body.appendChild(transcript); body.appendChild(input);
  var document = { body: body, hidden: false, activeElement: input, createElement: element,
    getElementById: function (id) { return id === 'messages' ? transcript : id === 'input' ? input : null; },
    querySelectorAll: function (selector) { return body.querySelectorAll(selector); } };
  var context = vm.createContext({ document: document, window: {}, URL: URL,
    store: { get: function (key) { return state[key]; }, set: function (patch) { Object.assign(state, patch); }, snap: function () { return state; } },
    iconHtml: function (name) { return '<i data-icon="' + name + '"></i>'; }, refreshIcons: function () {},
    resolveProjectAssistantIdentity: function () { return state.identity || { kind: 'provider' }; }, applyProjectAssistantIdentity: function () {},
    escapeHtml: function (value) { return value || ''; }, openFile: function (path) { opened.push(path); }, isDiffContent: function () { return false; },
    requestAnimationFrame: function (fn) { frames.push(fn); }, setTimeout: function () {}, clearTimeout: function () {} });
  function load(name) {
    var source = fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8');
    // Keep production tool/router functions; unrelated imported UI effects are isolated no-ops.
    source.replace(/import\s*\{([^}]+)\}\s*from\s*[^;]+;/g, function (_, names) {
      names.split(',').forEach(function (name) { var local = name.trim().split(/\s+as\s+/).pop(); if (!(local in context)) context[local] = function () {}; });
      return _;
    });
    if (legacyRegistry && name === 'tools') source = source.replace('var groups = transcriptToolGroups(ctx.messagesEl);', 'var groups = Object.keys(toolGroups).map(function (id) { return toolGroups[id]; });');
    vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context, { filename: name + '.js' });
  }
  ['clay-tool-presentation', 'clay-tool-activity', 'popup-chat-rendering', 'tools'].forEach(function (name) {
    load(name); if (name === 'popup-chat-rendering') context.syncPopupGroups = context.syncPopupChatToolGroups;
  });
  context.initTools({ messagesEl: transcript, inputEl: input, finalizeAssistantBlock: function () {}, addToMessages: function (node) { transcript.appendChild(node); }, setActivity: function () {}, scrollToBottom: function () {} });
  load('app-messages');
  return { api: context, body: body, transcript: transcript, state: state, opened: opened, document: document,
    mode: function (enabled) { context.setPopupChatRendering(enabled); context.syncPopupChatToolGroups(enabled); },
    flush: function () { frames.splice(0).forEach(function (fn) { fn(); }); } };
}
test('production message bootstrap reconciles mounted completed turns after done/history_done and late popup identity', function () {
  var f = fixture(), api = f.api, records = [], pills = [], evidence = [];
  for (var turn = 0; turn < 3; turn++) {
    api.processMessage({ type: 'tool_start', id: 'read', name: 'Read' });
    api.processMessage({ type: 'tool_executing', id: 'read', name: 'Read', input: { file_path: '/fixture/turn-' + turn + '.js' } });
    var row = api.getTools().read.el, pill = row.querySelector('.tool-desc');
    api.processMessage({ type: 'tool_result', id: 'read', content: 'evidence-' + turn, is_error: turn === 1 });
    row.querySelector('.tool-header').click();
    evidence.push(row.querySelector('.tool-result-block'));
    records.push(api.currentToolGroup); pills.push({ node: pill, handler: pill.onclick, icon: pill.children[0] });
    api.processMessage({ type: 'done' });
    assert.equal(Object.keys(api.getTools()).length, 0);
  }
  api.processMessage({ type: 'history_done', sessionId: 7, sessionOriginId: 'origin-7' }); f.flush();
  assert.equal(records.every(function (group) { return group.id === 'g1'; }), true, 'real done resets numeric IDs each turn');
  assert.equal(f.transcript.querySelectorAll('.popup-chat-activity').length, 0);
  f.state.identity = { kind: 'mate', mateId: 'clay' }; f.mode(true);
  assert.equal(f.transcript.querySelectorAll('.popup-chat-activity').length, 3);
  var firstHeader = records[0].el.querySelector('.tool-group-header'); firstHeader.click();
  assert.equal(records[0].userToggled, true); assert.notEqual(records[2].userToggled, true, 'disclosure binds DOM identity, not reused g1');
  f.document.activeElement = pills[0].node;
  for (var mode of [false, true, false, true, false]) f.mode(mode);
  records.forEach(function (group, i) {
    var row = group.toolRecords.read.el;
    assert.strictEqual(row.querySelector('.tool-desc'), pills[i].node);
    assert.strictEqual(pills[i].node.onclick, pills[i].handler); assert.strictEqual(pills[i].node.children[0], pills[i].icon);
    assert.strictEqual(row.querySelector('.tool-result-block'), evidence[i]);
    assert.equal(evidence[i].classList.contains('collapsed'), false);
    assert.equal(row.classList.contains('error'), i === 1);
    pills[i].node.click();
  });
  assert.strictEqual(f.document.activeElement, pills[0].node);
  assert.deepEqual(f.opened, ['/fixture/turn-0.js', '/fixture/turn-1.js', '/fixture/turn-2.js']);
  records[0].el.remove(); f.mode(true);
  assert.equal(f.transcript.querySelectorAll('.popup-chat-activity').length, 2);
  assert.equal(records[0].popupChat, false, 'removed history is never reconciled');
  assert.equal(api.transcriptToolGroups(f.transcript).length, 2);
  f.transcript.replaceChildren(); f.mode(false); assert.equal(api.transcriptToolGroups(f.transcript).length, 0);
});

test('counterfactual live-registry scan reproduces missing popup activity after production done', function () {
  var f = fixture(true);
  f.api.processMessage({ type: 'tool_start', id: 'old', name: 'Bash' });
  f.api.processMessage({ type: 'tool_result', id: 'old', content: 'complete' });
  f.api.processMessage({ type: 'done' });
  f.api.processMessage({ type: 'history_done', sessionId: 7, sessionOriginId: 'origin-7' });
  f.state.identity = { kind: 'mate', mateId: 'clay' }; f.mode(true);
  assert.equal(f.body.classList.contains('popup-chat-rendering'), true);
  assert.equal(f.transcript.querySelectorAll('.tool-group').length, 1);
  assert.equal(f.transcript.querySelectorAll('.popup-chat-activity').length, 0);
});
test('completed canonical outcomes survive repeated tool IDs, late activation and native restoration', function () {
  var f = fixture(), groups = [];
  for (var status of ['proposed', 'failed']) {
    f.api.processMessage({ type: 'tool_start', id: 'same', name: 'propose_scheduled_task' });
    f.api.processMessage({ type: 'tool_executing', id: 'same', name: 'propose_scheduled_task', input: { name: 'Review' } });
    f.api.processMessage({ type: 'tool_result', id: 'same', content: JSON.stringify({ status: status }), is_error: status === 'failed' });
    groups.push(f.api.currentToolGroup);
    f.api.processMessage({ type: 'done' });
  }
  f.api.processMessage({ type: 'history_done', sessionId: 7, sessionOriginId: 'origin-7' });
  f.state.identity = { kind: 'mate', mateId: 'clay' };
  for (var mode of [true, false, true, false]) {
    f.mode(mode);
    assert.equal(groups[0].el.dataset.activityPhase, 'pending');
    assert.equal(groups[1].el.dataset.activityPhase, 'error');
    assert.equal(groups[0].toolRecords.same.el.dataset.activityPhase, 'pending');
    assert.equal(groups[1].toolRecords.same.el.dataset.activityPhase, 'error');
  }
});
