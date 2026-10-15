var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

// Exercise the production renderer and keyboard controller with a small DOM;
// no sockets, server, provider or personal storage are imported.
function fixture(vendors, selected, projectDefault) {
  var document = { activeElement: null };
  function Element() {
    this.children = []; this.dataset = {}; this.style = {}; this.attributes = {};
    this.listeners = {}; this.className = ''; this.disabled = false;
    this.classList = { contains: function () { return false; } };
  }
  Element.prototype.appendChild = function (child) { this.children.push(child); return child; };
  Element.prototype.setAttribute = function (key, value) { this.attributes[key] = value; };
  Element.prototype.getAttribute = function (key) { return this.attributes[key]; };
  Element.prototype.addEventListener = function (key, callback) { this.listeners[key] = callback; };
  Element.prototype.getClientRects = function () { return [1]; };
  Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, bottom: 20, height: 20 }; };
  Element.prototype.focus = function () { if (!this.disabled) document.activeElement = this; };
  Element.prototype.contains = function (target) {
    return this === target || this.children.some(function (child) { return child.contains(target); });
  };
  Element.prototype.querySelectorAll = function (selector) {
    var matches = [];
    function visit(node) {
      node.children.forEach(function (child) {
        var focus = selector.match(/^\[data-focus-key="(.*)"\]$/);
        if (focus ? child.dataset.focusKey === focus[1]
            : selector.indexOf('[role="menuitem"]') !== -1 ? child.attributes.role === 'menuitem' && !child.disabled
            : child.className.split(' ').indexOf(selector.slice(1)) !== -1) matches.push(child);
        visit(child);
      });
    }
    visit(this); return matches;
  };
  Element.prototype.querySelector = function (selector) { return this.querySelectorAll(selector)[0] || null; };
  Object.defineProperty(Element.prototype, 'innerHTML', { set: function (html) {
    this.html = html;
    this.children = [];
    var classes = Array.from(html.matchAll(/<span(?: class="([^"]+)")?[^>]*>/g));
    var self = this;
    classes.forEach(function (match) { var child = new Element(); child.className = match[1] || ''; self.appendChild(child); });
  } });
  Object.defineProperty(Element.prototype, 'firstChild', { get: function () { return this.children[0]; } });
  var root = new Element();
  var state = {
    sessionCreate: { vendor: selected, phase: 'ready', menuOpen: true, folderId: 'work' },
    sessionCreateOptions: { loaded: true, vendors: vendors, projectDefault: projectDefault, canSetProjectDefault: true },
  };
  document.createElement = function () { return new Element(); };
  document.querySelectorAll = function (selector) {
    return selector === '.session-create-row' ? [root] : selector === '.session-folder-new-btn' ? [] : root.querySelectorAll(selector);
  };
  var subscriber;
  var context = vm.createContext({
    document: document, window: { innerWidth: 1000, innerHeight: 1000 }, encodeURIComponent: encodeURIComponent,
    store: { subscribe: function (fn) { subscriber = fn; }, set: function (patch) {
      var previous = Object.assign({}, state); Object.assign(state, patch); subscriber(state, previous);
    } },
    createState: function () { return state.sessionCreate; },
    createOptions: function () { return state.sessionCreateOptions; },
    installedVendorIds: function () { return state.sessionCreateOptions.vendors.filter(function (v) { return v.installed; }).map(function (v) { return v.id; }); },
    iconHtml: function () { return ''; }, refreshIcons: function () {},
    chooseVendor: function (id) { state.sessionCreate.vendor = id; state.sessionCreate.menuOpen = false; },
    saveProjectDefault: function (id) { state.savedDefault = id; },
  });
  var base = path.join(__dirname, '../lib/public/modules/');
  vm.runInContext(fs.readFileSync(base + 'chat-render-runtime.js', 'utf8').replace(/^import[^\n]+\n/gm, '').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync(base + 'vendor-priority.js', 'utf8').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync(base + 'session-create-form.js', 'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replace(/export /g, ''), context);
  function paint() { context.paintRow(root); }
  function key(name) { context.onMenuKey({ key: name, preventDefault: function () {}, stopPropagation: function () {} }, state.sessionCreate); }
  function ids() { return root.querySelectorAll('.session-create-menu-item').filter(function (item) { return item.dataset.focusKey.indexOf('item:') === 0; }).map(function (item) { return decodeURIComponent(item.dataset.focusKey.slice(5)); }); }
  paint();
  return { root: root, state: state, document: document, ids: ids, key: key, metadata: context, openAt: function (index) {
    context.store.set({ sessionCreate: Object.assign({}, state.sessionCreate, { menuIndex: index, menuFocus: true }) });
  }, refresh: function (vendors) {
    context.store.set({ sessionCreateOptions: Object.assign({}, state.sessionCreateOptions, { vendors: vendors }) });
  } };
}

function vendor(id, installed) { return { id: id, installed: installed, displayName: id }; }
function item(h, id) { return h.root.querySelector('[data-focus-key="item:' + encodeURIComponent(id) + '"]'); }

test('production Muse identity metadata reaches both selected picker and menu without a Claude fallback', function () {
  var h = fixture([vendor('muse', true)], 'muse', 'muse');
  assert.equal(h.metadata.VENDOR_NAMES.muse, 'Muse Code');
  assert.equal(h.metadata.VENDOR_AVATARS.muse, '/muse-avatar.svg');
  assert.equal(h.metadata.VENDOR_HOMEPAGES.muse, 'https://dev.meta.ai/docs/muse-code');
  assert.equal(h.root.querySelector('.session-create-icon').src, '/muse-avatar.svg');
  assert.equal(h.root.querySelector('.session-create-picker').firstChild.textContent, 'Muse Code');
  assert.match(item(h, 'muse').html, /src="\/muse-avatar\.svg"/);
  assert.equal(item(h, 'muse').querySelector('.session-create-menu-name').textContent, 'Muse Code');
  assert.ok(fs.existsSync(path.join(__dirname, '../lib/public', h.metadata.VENDOR_AVATARS.muse.slice(1))));
});

test('picker renders installed Claude, Codex, Muse first without promoting the selected project default', function () {
  var h = fixture([vendor('kiro', true), vendor('muse', true), vendor('codex', true), vendor('claude', true)], 'kiro', 'kiro');
  assert.deepEqual(h.ids().slice(0, 4), ['claude', 'codex', 'muse', 'kiro']);
  assert.equal(item(h, 'kiro').attributes['aria-current'], 'true');
  assert.equal(item(h, 'kiro').attributes['aria-checked'], 'true');
  assert.equal(item(h, 'grok').disabled, true);
  item(h, 'muse').listeners.click({ stopPropagation: function () {} });
  assert.equal(h.state.sessionCreate.vendor, 'muse');
  assert.equal(h.state.sessionCreateOptions.projectDefault, 'kiro');
  assert.equal(h.state.savedDefault, undefined);
});

test('all-uninstalled picker keeps canonical priority and stable unknowns disabled', function () {
  var h = fixture([vendor('future-b', false), vendor('muse', false), vendor('future-a', false)], '', null);
  assert.deepEqual(h.ids(), ['claude', 'codex', 'muse', 'grok', 'kimi', 'copilot', 'qwen', 'junie', 'antigravity', 'opencode', 'kiro', 'future-b', 'future-a']);
  h.ids().forEach(function (id) { assert.equal(item(h, id).disabled, true); });
});

test('server refresh reorders groups while keeping exact vendor and default-action focus and keyboard targets', function () {
  var h = fixture([vendor('muse', true), vendor('kiro', true), vendor('future-b', true), vendor('future-a', true)], 'kiro', 'kiro');
  assert.deepEqual(h.ids().slice(0, 4), ['muse', 'kiro', 'future-b', 'future-a']);
  item(h, 'muse').focus();
  h.refresh([vendor('future-b', true), vendor('claude', true), vendor('muse', true), vendor('kiro', true), vendor('future-a', false)]);
  assert.deepEqual(h.ids().slice(0, 4), ['claude', 'muse', 'kiro', 'future-b']);
  assert.equal(h.document.activeElement.dataset.focusKey, 'item:muse');
  h.key('ArrowDown');
  assert.equal(h.document.activeElement.dataset.focusKey, 'default:muse');
  h.refresh([vendor('future-b', true), vendor('claude', true), vendor('codex', true), vendor('muse', true), vendor('kiro', true)]);
  assert.equal(h.document.activeElement.dataset.focusKey, 'default:muse');
  h.key('ArrowDown');
  assert.equal(h.document.activeElement.dataset.focusKey, 'item:kiro');
  assert.equal(h.state.sessionCreate.vendor, 'kiro');
  assert.equal(h.state.sessionCreateOptions.projectDefault, 'kiro');
  h.key('End');
  assert.equal(h.document.activeElement.dataset.focusKey, 'default:future-b');
  h.key('ArrowDown');
  assert.equal(h.document.activeElement.dataset.focusKey, 'item:claude', 'disabled entries are skipped');
});

test('opening the sorted menu focuses its selected index and default actions retain exact vendor identity', function () {
  var h = fixture([vendor('muse', true), vendor('claude', true), vendor('codex', true)], 'muse', 'codex');
  h.openAt(2);
  assert.equal(h.document.activeElement.dataset.focusKey, 'item:muse');
  h.root.querySelector('[data-focus-key="default:muse"]').listeners.click({ stopPropagation: function () {} });
  assert.equal(h.state.savedDefault, 'muse');
  assert.equal(h.state.sessionCreate.vendor, 'muse');
});

test('unknown provider focus keys remain selector-safe and refreshed availability comes only from the new catalog', function () {
  var id = 'future"provider';
  var h = fixture([vendor(id, true), vendor('muse', true)], id, id);
  item(h, id).focus();
  h.refresh([vendor('claude', true), vendor(id, true), vendor('muse', false)]);
  assert.equal(h.document.activeElement.dataset.focusKey, 'item:' + encodeURIComponent(id));
  assert.deepEqual(h.ids().slice(0, 2), ['claude', id]);
  assert.equal(item(h, 'muse').disabled, true);
});
