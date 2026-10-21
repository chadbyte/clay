var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');
var element = require('./fixtures/popup-tool-dom.cjs').element;
function fixture() {
  var body = element('body'), state = {}, opened = [];
  var context = vm.createContext({
    document: { body: body, createElement: element, querySelectorAll: function (selector) { return body.querySelectorAll(selector); } },
    store: { get: function (key) { return state[key]; }, set: function (patch) { Object.assign(state, patch); } },
    iconHtml: function (name) { return '<i data-icon="' + name + '"></i>'; }, refreshIcons: function () {},
    resolveProjectAssistantIdentity: function () { return { kind: 'mate', mateId: 'fixture' }; },
    applyProjectAssistantIdentity: function () {}, escapeHtml: function (value) { return value || ''; },
    stopThinkingSegment: function () {}, openFile: function (path) { opened.push(path); }, isDiffContent: function () { return false; }, URL: URL
  });
  ['clay-tool-presentation', 'clay-tool-activity', 'popup-chat-rendering', 'session-tool-item', 'tools'].forEach(function (name) {
    var source = fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
    if (name === 'popup-chat-rendering') context.syncPopupGroups = context.syncPopupChatToolGroups;
  });
  context.initTools({ messagesEl: body, finalizeAssistantBlock: function () {}, addToMessages: function (node) { body.appendChild(node); }, setActivity: function () {}, scrollToBottom: function () {} });
  context.mode = function (enabled) { body.classList.toggle('popup-chat-rendering', enabled); context.syncPopupChatToolGroups(enabled); };
  context.opened = opened;
  return context;
}

test('native history pills retain exact nodes and handlers through popup, late input, failure, native and Back', function () {
  var api = fixture();
  ['Read', 'Bash', 'Bash', 'Bash'].forEach(function (name, i) { api.createToolItem(String(i), name); });
  api.updateToolExecuting('0', 'Read', { file_path: '/fixture/original.js' });
  var row = api.tools['0'].el, pill = row.querySelector('.tool-desc'), icon = pill.children[0], handler = pill.onclick;
  var link = element('a'), clicks = 0; link.setAttribute('href', '#reference'); link.addEventListener('click', function () { clicks++; });
  api.tools['1'].el.querySelector('.tool-header').appendChild(link);
  api.mode(true);
  assert.equal(row.hidden, false); assert.equal(api.tools['1'].el.hidden, false, 'header links pin old rows');
  api.createToolItem('4', 'Read'); api.createToolItem('5', 'Bash'); api.createToolItem('6', 'Bash');
  assert.equal(api.tools['4'].el.hidden, true);
  api.updateToolExecuting('4', 'Read', { file_path: '/fixture/late.js' });
  assert.equal(api.tools['4'].el.hidden, false); assert.equal(api.tools['4'].el.inert, false);
  api.updateToolResult('0', 'file unavailable', true);
  assert.equal(row.classList.contains('error'), true);
  assert.equal(row.querySelector('.tool-subtitle-text').textContent, 'Read failed');
  var evidence = row.querySelector('.tool-result-block'); row.querySelector('.tool-header').click();
  assert.equal(evidence.classList.contains('collapsed'), false);
  api.mode(false); api.mode(true); api.mode(false);
  assert.strictEqual(row.querySelector('.tool-desc'), pill); assert.strictEqual(pill.children[0], icon); assert.strictEqual(pill.onclick, handler);
  pill.click(); link.click(); assert.deepEqual(api.opened, ['/fixture/original.js']); assert.equal(clicks, 1);
  assert.equal(evidence.classList.contains('collapsed'), false, 'open evidence survives mode changes');
  assert.equal(row.querySelector('.tool-subtitle-text').textContent, 'Read failed');
  assert.equal(api.currentToolGroup.el.querySelector('.tool-group-items').inert, true, 'native collapsed disclosure is restored');
});

test('canonical activity retains pending, failed and unavailable outcomes after late popup activation and Back', function () {
  var api = fixture();
  api.createToolItem('schedule', 'propose_scheduled_task');
  api.updateToolExecuting('schedule', 'propose_scheduled_task', { name: 'Weekly review' });
  api.mode(true);
  api.updateToolResult('schedule', JSON.stringify({ status: 'proposed' }), false);
  var row = api.tools.schedule.el;
  assert.equal(row.dataset.activityPhase, 'pending');
  assert.equal(api.currentToolGroup.el.dataset.activityPhase, 'pending', 'popup header follows pending approval');
  var pending = row.querySelector('.tool-name').textContent;
  api.mode(false); assert.equal(row.querySelector('.tool-name').textContent, pending);
  assert.match(api.currentToolGroup.el.querySelector('.tool-group-label').textContent, /awaiting/);
  api.mode(true);
  api.updateToolResult('schedule', JSON.stringify({ status: 'failed' }), true);
  var failed = row.querySelector('.tool-name').textContent;
  assert.equal(row.dataset.activityPhase, 'error');
  assert.equal(api.currentToolGroup.el.dataset.activityPhase, 'error', 'popup header follows failure before native restoration');
  api.mode(false); assert.equal(row.querySelector('.tool-name').textContent, failed);
  assert.match(api.currentToolGroup.el.querySelector('.tool-group-label').textContent, /failed/);
  api.createToolItem('log', 'create_log'); api.mode(true); api.markToolDone('log', false);
  assert.equal(api.tools.log.el.dataset.activityPhase, 'returned');
  api.mode(false); assert.match(api.tools.log.el.querySelector('.tool-name').textContent, /unavailable/);
});

test('sidebar has no Arrange entry and pane Arrange retains the real session picker route', function () {
  var sidebar = fs.readFileSync('lib/public/modules/sidebar-sessions.js', 'utf8');
  var renderer = fs.readFileSync('lib/public/modules/split-view-sidebar-renderer.js', 'utf8');
  assert.doesNotMatch(sidebar + renderer, /renderPresentationArrangeEntry|splitViewCreateTrigger/);
  var pane = fs.readFileSync('lib/public/modules/split-view-presentation-renderer.js', 'utf8');
  assert.match(pane, /dataset.arrangeMembership/); assert.match(pane, /dispatch\("clay-split-view-open-create", \{ anchor: anchor \}\)/);
});

test('pane membership action opens the existing picker at its actual trigger and returns focus there', function () {
  var anchor = element('button'), menu = element('section'), events = [], focused = 0;
  anchor.isConnected = true; anchor.focus = function () { focused++; };
  var context = vm.createContext({
    document: { getElementById: function () { return menu; } },
    store: { get: function () {}, set: function () {} },
    CustomEvent: function (type, options) { this.type = type; this.detail = options && options.detail; }
  });
  context.document.dispatchEvent = function (event) { events.push(event); };
  var source = fs.readFileSync('lib/public/modules/split-view-presentation-renderer.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, context);
  context.menuTrigger = anchor;
  var event = { target: { closest: function (selector) { return selector === '#split-view-arrange-menu' ? menu : selector === '[data-arrange-membership]' ? {} : null; } }, preventDefault: function () {}, stopImmediatePropagation: function () {} };
  context.onClick(event);
  assert.equal(menu.hidden, true); assert.equal(events[0].type, 'clay-split-view-open-create'); assert.strictEqual(events[0].detail.anchor, anchor);
  source = fs.readFileSync('lib/public/modules/split-view-create-menu.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, context);
  menu.clayCreateAnchor = anchor; menu.hidden = false; context.close(true);
  assert.equal(focused, 1); assert.equal(menu.hidden, true); assert.equal(menu.clayCreateAnchor, null);
});
