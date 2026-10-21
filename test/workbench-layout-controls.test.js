var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');

function fixture() {
  var value = { myUserId: 'owner', currentSlug: 'project', workbenchLayoutPreference: { mode: 'overlay', revision: 3, ready: true } };
  var subscriptions = [], loads = [], writes = [], notices = [], confirmations = [];
  var store = { get: function (key) { return value[key]; }, subscribe: function (fn) { subscriptions.push(fn); },
    set: function (update) { var previous = value; value = Object.assign({}, value, update); subscriptions.forEach(function (fn) { fn(value, previous); }); } };
  function node() {
    return { dataset: {}, attrs: {}, isConnected: true, listeners: {}, children: [],
      addEventListener: function (type, fn) { this.listeners[type] = fn; },
      setAttribute: function (key, val) { this.attrs[key] = val; }, getAttribute: function (key) { return this.attrs[key]; },
      insertBefore: function (child) { this.children.unshift(child); }, querySelector: function () { return null; } };
  }
  var main = node(), actions = node(), header = node(), panel = node();
  header.querySelector = function () { return actions; };
  panel.querySelector = function (selector) { return selector === '.workbench-layout-toggle' ? actions.children[0] || null : header; };
  var context = vm.createContext({ store: store, Promise: Promise,
    document: { getElementById: function (id) { return id === 'main-panels' ? main : id === 'terminal-container' ? panel : null; }, createElement: node },
    requestAnimationFrame: function (fn) { fn(); }, iconHtml: function (name) { return name; }, refreshIcons: function () {},
    renderToolPaneChrome: function () {}, showToast: function (message) { notices.push(message); },
    loadPreference: function () { return new Promise(function (resolve) { loads.push(resolve); }); } });
  var source = fs.readFileSync('lib/public/modules/right-workbench.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '')
    .replace(/import\('\.\/workbench-layout-preference\.js'\)/g, 'loadPreference()');
  vm.runInContext(source, context);
  context.claimRightWorkbench('terminal');
  var api = { ensureWorkbenchLayoutPreference: function () { return Promise.resolve(true); },
    saveWorkbenchLayoutMode: function (mode) { writes.push(mode); return new Promise(function (resolve) { confirmations.push(resolve); }); } };
  return { store: store, main: main, button: actions.children[0], loads: loads, writes: writes, confirmations: confirmations, api: api };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

test('a delayed layout-control import cannot save into a changed account or project', async function () {
  for (var change of [{ myUserId: 'other' }, { currentSlug: 'other' }]) {
    var f = fixture();
    f.button.listeners.click();
    f.store.set(change);
    f.loads[1](f.api); await settle();
    assert.equal(f.writes.length, 0);
  }
});
test('layout controls reject a newer revision or an in-flight save before invoking persistence', async function () {
  for (var patch of [{ revision: 4 }, { saving: true }]) {
    var f = fixture(); f.button.listeners.click();
    f.store.set({ workbenchLayoutPreference: Object.assign({}, f.store.get('workbenchLayoutPreference'), patch) });
    f.loads[1](f.api); await settle();
    assert.equal(f.writes.length, 0);
  }
});
test('a current layout control invokes the shared service and waits for confirmed mode state', async function () {
  var f = fixture(); f.button.listeners.click();
  f.loads[1](f.api); await settle();
  assert.deepEqual(f.writes, ['docked']);
  assert.equal(f.main.dataset.workbenchMode, 'overlay');
  f.store.set({ workbenchLayoutPreference: { mode: 'docked', revision: 4, ready: true } });
  assert.equal(f.main.dataset.workbenchMode, 'overlay', 'saved metadata alone does not promote a panel before the correlated save resolves');
  f.confirmations[0](true); await settle();
  assert.equal(f.main.dataset.workbenchMode, 'docked');
  assert.equal(f.button.attrs['aria-pressed'], 'true');
});

test('failed save leaves the panel floating and its draft layout intact', async function () {
  var f = fixture(); f.button.listeners.click(); f.loads[1](f.api); await settle();
  f.confirmations[0](false); await settle();
  assert.equal(f.main.dataset.workbenchMode, 'overlay');
  assert.equal(f.button.attrs['aria-pressed'], 'false');
});
