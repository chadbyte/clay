var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');

test('only a visible, open, rendered memory is acknowledged; stale count replies cannot restore a badge', function () {
  var data = { you: {}, youSequence: 0 };
  var sent = [];
  var elements = {};
  function element(id) {
    if (!elements[id]) {
      var classes = new Set();
      elements[id] = { hidden: false, scrollTop: 0, textContent: '', setAttribute: function () {}, focus: function () { context.document.activeElement = this; },
        classList: { add: function (name) { classes.add(name); }, remove: function (name) { classes.delete(name); }, toggle: function () {} },
        querySelector: function () { return { disabled: false, focus: function () {}, textContent: '' }; }, querySelectorAll: function () { return []; } };
    }
    return elements[id];
  }
  var context = {
    store: { get: function (key) { return data[key]; }, set: function (values) { Object.assign(data, values); } },
    getWs: function () { return { readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } }; },
    document: { visibilityState: 'visible', activeElement: null, getElementById: element },
    requestAnimationFrame: function (fn) { fn(); },
    renderList: function () {}, renderDetail: function () {}, categoryLabel: function (value) { return value; },
  };
  vm.createContext(context);
  var source = fs.readFileSync('lib/public/modules/you.js','utf8').replace(/^import .*;\n/gm,'').replace(/export function/g,'function');
  vm.runInContext(source,context);
  assert.match(source, /deleteLabel: 'Delete memory'/);
  assert.match(source, /Disconnected\. Reconnect before deleting\./);
  assert.match(source, /msg\.activity && msg\.activity\.deleted/);
  assert.match(source, /deleteDialog\.querySelector\('\[data-action="cancel"\]'\)/);
  data.you = { open: true, selected: null, renderedRef: 'you:a', renderedRevision: 1 };
  context.acknowledgeVisible(); assert.equal(sent.length,0,'list views do not acknowledge');
  data.you.selected = 'you:a'; context.document.visibilityState = 'hidden';
  context.acknowledgeVisible(); assert.equal(sent.length,0,'background tabs do not acknowledge');
  context.document.visibilityState = 'visible'; data.you.open = false;
  context.acknowledgeVisible(); assert.equal(sent.length,0,'closed panels do not acknowledge');
  data.you.open = true; context.acknowledgeVisible();
  assert.equal(sent[0].type,'you_seen'); assert.equal(sent[0].revision,1);
  context.acknowledgeVisible(); assert.equal(sent.length,1,'one in-flight acknowledgement');
  context.showAttention({unread:0,version:5});
  context.showAttention({unread:1,version:4});
  assert.equal(element('me-unread-badge').hidden,true);
});

test('deletion notifications invalidate reads and refresh the cached list in both tabs', function () {
  var data = { you: {}, youSequence: 0 };
  var sent = [];
  var elements = {};
  var context;
  function node() {
    var classes = new Set();
    return { hidden: false, scrollTop: 0, textContent: '', setAttribute: function () {}, focus: function () { context.document.activeElement = this; },
      classList: { add: function (name) { classes.add(name); }, remove: function (name) { classes.delete(name); }, toggle: function () {} },
      querySelector: function () { return { disabled: false, focus: function () {}, textContent: '' }; }, querySelectorAll: function () { return []; } };
  }
  function element(id) { if (!elements[id]) elements[id] = node(); return elements[id]; }
  context = {
    store: { get: function (key) { return data[key]; }, set: function (values) { Object.assign(data, values); } },
    getWs: function () { return { readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } }; },
    document: { visibilityState: 'visible', activeElement: null, getElementById: element },
    requestAnimationFrame: function (fn) { fn(); }, renderList: function () {}, renderDetail: function () {}, categoryLabel: function (value) { return value; },
  };
  vm.createContext(context);
  var source = fs.readFileSync('lib/public/modules/you.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export function/g, 'function');
  vm.runInContext(source, context);
  data.you = { open: true, selected: 'you:a', readId: 'read-old', renderedRef: 'you:a', renderedRevision: 2, entries: [{ ref: 'you:a' }], query: '', category: '' };
  context.handleYouMessage({ type: 'you_changed', activity: { id: 'delete-a', ref: 'you:a', deleted: true } });
  assert.equal(data.you.selected, null);
  assert.equal(data.you.readId, null);
  assert.equal(sent.filter(function (message) { return message.type === 'you_list'; }).length, 1, 'same-tab deletion refreshes the cached list');
  assert.equal(sent.filter(function (message) { return message.type === 'you_read'; }).length, 0, 'deleted reads are not reissued');

  sent.length = 0;
  data.you = { open: true, selected: null, readId: 'read-other', entries: [{ ref: 'you:a' }], query: '', category: '' };
  context.handleYouMessage({ type: 'you_changed', activity: { id: 'delete-a-remote', ref: 'you:a', deleted: true } });
  assert.equal(sent.filter(function (message) { return message.type === 'you_list'; }).length, 1, 'other-tab deletion refreshes the cached list');
  assert.equal(sent.filter(function (message) { return message.type === 'you_read'; }).length, 0);
});

test('Me delete request protects pending state and recovers from error and cancel', function () {
  var data = { you: { deleteEntry: { ref: 'you:a', revisions: 2 }, deleteId: null }, youSequence: 0 };
  var sent = [];
  var buttons = { cancel: { disabled: false, focus: function () {} }, delete: { disabled: false, focus: function () {} } };
  var status = { textContent: '' };
  var dialog = { tabIndex: -1, focus: function () {}, classList: { add: function () {}, remove: function () {} }, querySelector: function (selector) {
    if (selector === '[data-action="cancel"]') return buttons.cancel;
    if (selector === '[data-action="delete"]') return buttons.delete;
    return status;
  } };
  var elements = {};
  var context;
  function element(id) { if (!elements[id]) elements[id] = { hidden: false, classList: { add: function () {}, remove: function () {}, toggle: function () {} }, setAttribute: function () {}, focus: function () {}, querySelector: function () { return { disabled: false, textContent: '' }; }, querySelectorAll: function () { return []; } }; return elements[id]; }
  context = { store: { get: function (key) { return data[key]; }, set: function (values) { if (values.you) data.you = values.you; else Object.assign(data, values); } }, getWs: function () { return { readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } }; }, document: { activeElement: null, visibilityState: 'visible', getElementById: element }, requestAnimationFrame: function (fn) { fn(); }, renderList: function () {}, renderDetail: function () {}, categoryLabel: function (value) { return value; } };
  vm.createContext(context);
  var source = fs.readFileSync('lib/public/modules/you.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export function/g, 'function');
  vm.runInContext(source, context);
  context.deleteDialog = dialog;
  context.sendDelete();
  assert.equal(sent[0].type, 'you_delete');
  assert.equal(buttons.delete.disabled, true);
  context.sendDelete();
  assert.equal(sent.length, 1, 'a pending delete cannot be duplicated');
  context.handleYouMessage({ operation: 'you_delete', requestId: sent[0].requestId, ok: false, error: 'Stale memory revision.' });
  assert.equal(buttons.delete.disabled, false);
  assert.equal(status.textContent, 'Stale memory revision.');
  context.closeDeleteDialog(false);
  assert.equal(data.you.deleteEntry, null, 'cancel clears the pending draft');
});
