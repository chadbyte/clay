var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var fs = require('node:fs');
var vm = require('node:vm');
function load() { return import('file://' + path.join(__dirname, '../lib/public/modules/clay-browser-links.js')); }
test('browser pills accept explicit web destinations and preserve port, query and fragment', async function () {
  var links = await load();
  assert.equal(links.browserLinkTarget('browser:http://localhost:3000/preview?tab=one#section'), 'http://localhost:3000/preview?tab=one#section');
  ['https://example.test/', 'browser:javascript:alert(1)', 'browser:file:///tmp/test', 'browser:data:text/html,x', 'browser:https://user:pass@example.test/', 'browser:https://example.test/\n', 'browser://example.test', 'browser:https://'].forEach(function (value) { assert.equal(links.browserLinkTarget(value), null, value); });
});
test('browser pills render compact accessible buttons and escape URL and label attributes', async function () {
  var links = await load();
  var html = links.renderBrowserLink('browser:https://example.test/?q=%22&x=1', '', 'Preview "page" <img src=x>');
  assert.match(html, /class="clay-browser-link clayos-record-link"/);
  assert.match(html, /data-lucide="globe"/);
  assert.match(html, /aria-label="Open in Clay Browser:/);
  assert.match(html, /Preview &quot;page&quot;/);
  assert.match(html, /&amp;x=1/);
  assert.equal(html.includes('<img'), false);
  assert.equal(links.renderBrowserLink('https://example.test', '', 'External'), null);
});
test('browser pill activation opens only on click and reports failures', async function () {
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/clay-browser-links.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '').replace("import('./shared-browser.js')", 'loadBrowser()');
  var listener, opened = [], notices = [], state = { currentSlug: 'demo' };
  var sandbox = { URL: URL, store: { get: function (key) { return state[key]; }, set: function (patch) { Object.assign(state, patch); } },
    document: { addEventListener: function (kind, fn) { listener = fn; } }, iconHtml: function () { return ''; },
    forwardPaneBrowserLink: function () { return false; }, showToast: function (message) { notices.push(message); },
    loadBrowser: function () { return Promise.resolve({ openSharedBrowserAt: function (url) { opened.push(url); } }); } };
  vm.runInNewContext(source, sandbox); sandbox.initBrowserLinks();
  assert.deepEqual(opened, []);
  var button = { dataset: { browserUrl: 'https://example.test/', browserProject: 'demo' } };
  listener({ target: { closest: function () { return button; } }, preventDefault: function () {}, stopPropagation: function () {} });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepEqual(opened, ['https://example.test/']);
  button.dataset.browserUrl = 'javascript:alert(1)';
  listener({ target: { closest: function () { return button; } }, preventDefault: function () {}, stopPropagation: function () {} });
  assert.equal(notices.length, 1); assert.equal(opened.length, 1);
});
