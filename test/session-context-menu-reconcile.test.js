var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

function fixture() {
  var document = { activeElement: null, addEventListener: function () {}, removeEventListener: function () {} };
  var socket = {}, context = vm.createContext({ document: document, window: { innerWidth: 320, innerHeight: 200,
    addEventListener: function () {}, removeEventListener: function () {} }, getWs: function () { return socket; }, showToast: function () {} });
  ['store', 'session-context-menu'].forEach(function (name) {
    var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/' + name + '.js'), 'utf8')
      .replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
  });
  context.createStore({ currentSlug: 'project', myUserId: 'owner', connected: true, sessionActionEpoch: 0 });
  function element() {
    var attributes = {};
    return { isConnected: true, style: {}, hidden: false,
      setAttribute: function (key, value) { attributes[key] = value; }, getAttribute: function (key) { return attributes[key] || null; },
      hasAttribute: function (key) { return Object.hasOwn(attributes, key); }, removeAttribute: function (key) { delete attributes[key]; },
      addEventListener: function () {}, remove: function () { this.isConnected = false; },
      focus: function () { document.activeElement = this; }, getBoundingClientRect: function () { return { left: 30, bottom: 70, width: 140, height: 80 }; } };
  }
  var buttons = [element(), element(), element()], menu = element();
  menu.querySelectorAll = function () { return buttons; }; menu.querySelector = function () { return buttons[0]; };
  menu.contains = function (item) { return buttons.indexOf(item) >= 0; };
  return { api: context, store: context.store, document: document, element: element, menu: menu, buttons: buttons };
}

test('routine sidebar replacement retains the popup and keyboard focus while rebinding its exact anchor', function () {
  var f = fixture(), original = f.element(), replacement = f.element();
  f.api.mountSessionContextMenu(f.menu, original, 7, { resolveAnchor: function () { return replacement; } });
  original.isConnected = false;
  f.api.reconcileSessionContextMenu();
  assert.equal(f.store.get('sessionContextMenu').el, f.menu);
  assert.equal(f.store.get('sessionContextMenu').anchor, replacement);
  assert.equal(f.document.activeElement, f.buttons[0]);
  var prevented = false;
  f.api.onMenuKey({ key: 'Escape', preventDefault: function () { prevented = true; }, stopPropagation: function () {} });
  assert.equal(prevented, true); assert.equal(f.document.activeElement, replacement);
  assert.equal(f.menu.isConnected, false); assert.equal(f.store.get('sessionContextMenu'), null);
});

test('removed or foreign targets close the popup instead of preserving stale controls', function () {
  var f = fixture();
  f.api.mountSessionContextMenu(f.menu, f.element(), 7, { resolveAnchor: function () { return null; } });
  f.api.reconcileSessionContextMenu();
  assert.equal(f.store.get('sessionContextMenu'), null);
  f = fixture(); f.api.mountSessionContextMenu(f.menu, f.element(), 7);
  f.store.set({ myUserId: 'other-owner' });
  assert.equal(f.store.get('sessionContextMenu'), null);
});

test('shared menus clamp pointer placement and provide arrow, Home and End navigation', function () {
  var f = fixture(), anchor = f.element();
  f.api.mountSessionContextMenu(f.menu, anchor, 7);
  f.api.positionSessionContextMenu(f.menu, anchor, { x: 310, y: 199 });
  assert.equal(f.menu.style.left, '172px'); assert.equal(f.menu.style.top, '112px');
  function key(value) { f.api.onMenuKey({ key: value, preventDefault: function () {}, stopPropagation: function () {} }); }
  key('ArrowDown'); assert.equal(f.document.activeElement, f.buttons[1]);
  key('End'); assert.equal(f.document.activeElement, f.buttons[2]);
  key('ArrowDown'); assert.equal(f.document.activeElement, f.buttons[0]);
  key('ArrowUp'); assert.equal(f.document.activeElement, f.buttons[2]);
  key('Home'); assert.equal(f.document.activeElement, f.buttons[0]);
});
