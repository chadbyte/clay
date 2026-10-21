var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var pathToFileURL = require('node:url').pathToFileURL;
var popupModule = import(pathToFileURL(path.join(__dirname, '../lib/public/modules/popup-chat-rendering.js')).href);

function classList(initial) {
  var values = new Set(initial || []);
  return {
    add: function (value) { values.add(value); },
    remove: function (value) { values.delete(value); },
    contains: function (value) { return values.has(value); },
    toggle: function (value, force) {
      var next = force === undefined ? !values.has(value) : !!force;
      if (next) values.add(value); else values.delete(value);
      return next;
    },
  };
}

function makeRow(control) {
  var row = { hidden: false, classList: classList(), controls: [] };
  row.disclosure = { classList: classList(), closest: function () { return row.disclosure; } };
  row.controls.push(row.disclosure);
  if (control) row.controls.push({ closest: function () { return null; }, classList: classList() });
  row.querySelectorAll = function () { return row.controls; };
  row.querySelector = function (selector) { return selector === '.tool-header' ? row.disclosure : selector === '.tool-desc-link' && row.filePill ? row.filePill : null; };
  return row;
}

function makeGroup(rows) {
  var header = { attrs: {}, title: '', setAttribute: function (name, value) { this.attrs[name] = value; } };
  var count = { textContent: '', attrs: {}, dataset: {}, setAttribute: function (name, value) { this.attrs[name] = value; } };
  var items = { children: rows, inert: true, attrs: {}, setAttribute: function (name, value) { this.attrs[name] = value; } };
  var groupEl = {
    classList: classList(['collapsed']),
    querySelector: function (selector) {
      if (selector === '.tool-group-header') return header;
      if (selector === '.tool-group-items') return items;
      if (selector === '.popup-chat-activity-count') return count;
      return null;
    },
  };
  return { el: groupEl, toolCount: rows.length, popupChat: true, header: header, count: count, items: items };
}

test('popup chat presentation requires the established contextual pane and exact Mate session binding', async function () {
  var api = await popupModule;
  var body = { classList: classList(['contextual-chat-pane']) };
  var frame = { dataset: { mateId: 'mate-7', expectedSessionOrigin: 'origin-7' } };
  var state = { paneMode: true, myUserId: 'owner-1', sessionOriginId: 'origin-7', paneSessionId: 42, activeSessionId: 42 };
  var mate = { kind: 'mate', mateId: 'mate-7' };
  assert.equal(api.shouldEnablePopupChatRendering(body, state, frame, mate), true);
  assert.equal(api.shouldEnablePopupChatRendering(body, Object.assign({}, state, { activeSessionId: 43 }), frame, mate), false);
  assert.equal(api.shouldEnablePopupChatRendering(body, Object.assign({}, state, { sessionOriginId: 'origin-old' }), frame, mate), false);
  assert.equal(api.shouldEnablePopupChatRendering(body, state, { dataset: { mateId: 'mate-other' } }, mate), false);
  assert.equal(api.shouldEnablePopupChatRendering(body, state, frame, { kind: 'provider' }), false);
  body.classList.remove('contextual-chat-pane');
  assert.equal(api.shouldEnablePopupChatRendering(body, state, frame, mate), false, 'the URL alone never enables popup presentation');
});

test('popup presentation waits for the exact ready Mate frame in the visible popover and restores on native expansion', async function () {
  var api = await popupModule;
  var body = { classList: classList(['contextual-chat-pane']) };
  var frame = { hidden: false, inert: false, dataset: { mateId: 'mate-7', ownerId: 'owner-1', sessionId: '42', expectedSessionOrigin: 'origin-7' } };
  var surface = { dataset: { mode: 'popover' }, contains: function (candidate) { return candidate === frame; } };
  var state = { paneMode: true, connected: true, myUserId: 'owner-1', contextualSessionReady: true, sessionOriginId: 'origin-7', paneSessionId: 42, activeSessionId: 42, activeProjectMateId: 'mate-7' };
  var mate = { kind: 'mate', mateId: 'mate-7' };
  assert.equal(api.popupChatContextIsReady(body, state, frame, mate, surface), true);
  assert.equal(api.popupChatContextIsReady(body, Object.assign({}, state, { contextualSessionReady: false }), frame, mate, surface), false);
  assert.equal(api.popupChatContextIsReady(body, state, Object.assign({}, frame, { inert: true }), mate, surface), false);
  assert.equal(api.popupChatContextIsReady(body, state, frame, mate, { dataset: { mode: 'expanded' }, contains: function () { return true; } }), false);
  assert.equal(api.popupChatContextIsReady(body, state, Object.assign({}, frame, { dataset: Object.assign({}, frame.dataset, { sessionId: '41' }) }), mate, surface), false);
});

test('popup activity keeps the newest two and interactive older rows reachable, then reveals all on disclosure', async function () {
  var api = await popupModule;
  var rows = [makeRow(false), makeRow(true), makeRow(false), makeRow(false), makeRow(false)];
  var group = makeGroup(rows);
  assert.equal(api.syncPopupActivityGroup(group), true);
  assert.deepEqual(rows.map(function (row) { return row.hidden; }), [true, false, true, false, false]);
  assert.equal(group.items.inert, false, 'visible recent rows remain keyboard-operable in the collapsed summary');
  assert.equal(group.items.attrs['aria-hidden'], 'false');
  assert.equal(group.header.attrs['aria-expanded'], 'false');
  assert.equal(group.count.textContent, '5');
  assert.equal(group.count.attrs['aria-label'], '5 recorded events');

  group.el.classList.remove('collapsed');
  api.syncPopupActivityGroup(group);
  assert.deepEqual(rows.map(function (row) { return row.hidden; }), [false, false, false, false, false]);
  assert.equal(group.header.attrs['aria-expanded'], 'true');

  rows.push(makeRow(false));
  group.toolCount++;
  group.el.classList.add('collapsed');
  api.syncPopupActivityGroup(group);
  assert.deepEqual(rows.map(function (row) { return row.hidden; }), [true, false, true, true, false, false]);
  assert.equal(group.count.textContent, '6', 'the count follows recorded events as streaming appends tools');
});

test('the row disclosure does not pin routine activity, but a late file pill unhides and releases inertness', async function () {
  var api = await popupModule;
  var rows = [makeRow(false), makeRow(false), makeRow(false), makeRow(false), makeRow(false)];
  var group = makeGroup(rows);
  assert.equal(api.syncPopupActivityGroup(group), true);
  assert.deepEqual(rows.map(function (row) { return row.hidden; }), [true, true, true, false, false]);
  assert.deepEqual(rows.map(function (row) { return row.inert; }), [true, true, true, false, false]);

  rows[0].filePill = { classList: classList(['tool-desc-link']) };
  rows[0].controls.push({ closest: function () { return rows[0].disclosure; }, classList: classList() });
  api.syncPopupActivityGroup(group);
  assert.equal(rows[0].hidden, false, 'a real nested action keeps the older row visible');
  assert.equal(rows[0].inert, false, 'a newly pinned row becomes operable immediately');
  assert.deepEqual(rows.slice(1).map(function (row) { return row.hidden; }), [true, true, false, false]);
});

test('popup scope removal restores rows and ordinary tool details never serialize unknown inputs', async function () {
  var api = await popupModule;
  var hiddenRow = makeRow(false); hiddenRow.hidden = true; hiddenRow.classList.add('popup-chat-activity-row');
  var body = { classList: classList(['popup-chat-rendering']) };
  global.document = { body: body, querySelectorAll: function (selector) { return selector === '.popup-chat-activity-row[hidden]' || selector === '.popup-chat-activity-row' ? [hiddenRow] : []; } };
  try {
    api.setPopupChatRendering(false);
    assert.equal(body.classList.contains('popup-chat-rendering'), false);
    assert.equal(hiddenRow.hidden, false);
  } finally { delete global.document; }

  assert.equal(api.popupToolActionLabel('Read'), 'Read');
  assert.equal(api.popupToolDescription('Read', { file_path: '/work/src/file.js' }), '…/work/src/file.js');
  assert.equal(api.popupToolDescription('Bash', { command: 'private command', description: 'Build tests' }), 'Build tests');
  assert.equal(api.popupToolDescription('mcp__external__tool', { secret: 'never preview this' }), '');
  assert.equal(api.popupToolDescription('WebFetch', { url: 'https://user:secret@example.com/private?token=hidden' }), 'example.com');
});

test('late history bootstrap decorates existing native groups in place and restores them across presentation changes', async function () {
  var api = await popupModule;
  var originalDocument = global.document;
  function node() {
    var result = { children: [], attrs: {}, dataset: {}, style: {}, classList: classList(), textContent: '', innerHTML: '', title: '', setAttribute: function (key, value) { this.attrs[key] = String(value); }, getAttribute: function (key) { return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null; }, removeAttribute: function (key) { delete this.attrs[key]; }, appendChild: function (child) { child.parentNode = this; this.children.push(child); return child; }, insertBefore: function (child, before) { child.parentNode = this; var index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); return child; }, querySelector: function (selector) { return selector === 'a[href], button, [role="button"]' && this.hasInteractiveLink ? this.interactiveLink : null; }, remove: function () { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); } };
    return result;
  }
  function makeTool(name, description, fileLink) {
    var row = makeRow(false);
    var nameNode = node(); nameNode.textContent = name;
    var descriptionNode = node(); descriptionNode.textContent = description; descriptionNode.innerHTML = description;
    if (fileLink) { descriptionNode.classList.add('tool-desc-link'); descriptionNode.innerHTML = '<span class="tool-desc-link-icon">file</span>'; }
    row.hidden = false; row.inert = false; row.nameNode = nameNode; row.descriptionNode = descriptionNode;
    row.querySelector = function (selector) { return selector === '.tool-name' ? nameNode : selector === '.tool-desc' ? descriptionNode : null; };
    row.querySelectorAll = function () { return []; };
    return { el: row, name: name, input: null };
  }
  var rows = [makeTool('Read', '/fixture/a.js', true), makeTool('Edit', '/fixture/b.js'), makeTool('Write', '/fixture/c.js')];
  var originalFilePill = rows[0].el.querySelector('.tool-desc');
  var originalFilePillMarkup = originalFilePill.innerHTML;
  var itemNodes = rows.map(function (tool) { return tool.el; });
  var items = node(); items.children = itemNodes;
  var label = node(); label.textContent = 'Screen context request returned';
  var status = node(); status.className = 'tool-group-status-icon';
  var header = node(); header.style.display = 'none'; header.children = [label, status];
  header.querySelector = function (selector) { return this.children.find(function (child) { return selector === '.tool-group-status-icon' ? child.className === 'tool-group-status-icon' : selector === '.popup-chat-activity-icon' ? child.className === 'popup-chat-activity-icon' : selector === '.popup-chat-activity-count' ? child.className === 'popup-chat-activity-count' : false; }) || null; };
  var groupEl = node(); groupEl.classList.add('collapsed');
  groupEl.querySelector = function (selector) { return selector === '.tool-group-header' ? header : selector === '.tool-group-label' ? label : selector === '.tool-group-items' ? items : selector === '.popup-chat-activity-count' ? header.querySelector(selector) : null; };
  var group = { el: groupEl, toolCount: 3, doneCount: 3, errorCount: 0, toolIds: ['a', 'b', 'c'], toolRecords: { a: rows[0], b: rows[1], c: rows[2] }, userToggled: false };
  var originalGroup = group;
  var body = { classList: classList(['popup-chat-rendering']) };
  global.document = { body: body, createElement: function () { return node(); } };
  try {
    api.syncPopupChatToolGroups(true, [group], { kind: 'mate' });
    assert.strictEqual(group, originalGroup, 'late activation decorates the already-rendered group object');
    assert.equal(groupEl.classList.contains('popup-chat-activity'), true);
    assert.equal(label.children[0].textContent, 'Activity');
    assert.deepEqual(itemNodes.map(function (row) { return row.hidden; }), [true, false, false]);
    assert.equal(originalFilePill.classList.contains('tool-desc-link'), true);
    assert.equal(originalFilePill.innerHTML, originalFilePillMarkup, 'popup decoration preserves the existing file pill DOM');

    body.classList.remove('popup-chat-rendering');
    api.syncPopupChatToolGroups(false, [group], { kind: 'mate' });
    assert.equal(label.textContent, 'Screen context request returned');
    assert.equal(header.style.display, 'none');
    assert.equal(groupEl.classList.contains('collapsed'), true);
    assert.equal(groupEl.classList.contains('popup-chat-activity'), false);
    assert.deepEqual(itemNodes.map(function (row) { return row.hidden; }), [false, false, false]);
    assert.equal(itemNodes[0].nameNode.textContent, 'Read');
    assert.equal(itemNodes[0].descriptionNode.innerHTML, originalFilePillMarkup, 'native restoration keeps the same linked file pill markup');

    body.classList.add('popup-chat-rendering');
    api.syncPopupChatToolGroups(true, [group], { kind: 'mate' });
    assert.strictEqual(group, originalGroup, 'reenabling presents history in place without transcript rebuild');
    assert.equal(groupEl.classList.contains('popup-chat-activity'), true);
  } finally { global.document = originalDocument; }
});
