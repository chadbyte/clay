var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

test('browser links from panes require a current same-origin, same-project frame association', async function () {
  var code = fs.readFileSync(path.join(__dirname, '../lib/public/modules/pane-browser-bridge.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '').replace("import('./shared-browser.js')", 'loadBrowser()');
  var opened = [], source = {}, state = { currentSlug: 'demo', splitPanes: { panes: [{ slug: 'demo', sessionId: 2 }] } };
  var frame = { contentWindow: source, src: 'http://clay.test/p/demo/?pane=1&session=2', dataset: { projectSlug: 'demo', sessionId: '2' } };
  var host = { querySelectorAll: function () { return [frame]; } };
  var sandbox = { URL: URL, window: { location: { origin: 'http://clay.test', href: 'http://clay.test/p/demo/' } }, store: { snap: function () { return state; } }, showToast: function () {}, loadBrowser: function () { return Promise.resolve({ openSharedBrowserAt: function (url) { opened.push(url); } }); } };
  vm.runInNewContext(code, sandbox);
  function event(extra) { return Object.assign({ origin: 'http://clay.test', source: source, data: { type: 'clay-pane-open-browser', projectSlug: 'demo', sessionId: '2', url: 'https://example.test/' } }, extra); }
  sandbox.handlePaneBrowserMessage(event({ origin: 'https://foreign.test' }), host);
  sandbox.handlePaneBrowserMessage(event({ source: {} }), host);
  frame.src = 'http://clay.test/p/demo/?pane=1&session=3';
  sandbox.handlePaneBrowserMessage(event(), host);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepEqual(opened, []);
  frame.src = 'http://clay.test/p/demo/?pane=1&session=2';
  assert.equal(sandbox.handlePaneBrowserMessage(event(), host), true);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepEqual(opened, ['https://example.test/']);
});
