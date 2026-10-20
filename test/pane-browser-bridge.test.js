var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

test('browser links from panes require a current same-origin, same-project frame association', async function () {
  var code = fs.readFileSync(path.join(__dirname, '../lib/public/modules/pane-browser-bridge.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '').replace("import('./shared-browser.js')", 'loadBrowser()');
  var opened = [], source = {}, state = { connected: true, currentSlug: 'demo', splitPanes: { panes: [{ slug: 'demo', sessionId: 2 }] } };
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

function liveFixture() {
  var code = fs.readFileSync(path.join(__dirname, '../lib/public/modules/pane-browser-bridge.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '').replace("import('./shared-browser.js')", 'loadBrowser()');
  var opened = [], source = {}, document = {}, binding = { requestId: 'activation', sessionId: 2 }, resolve;
  var state = { connected: true, currentSlug: 'demo', myUserId: 'owner', currentProjectOwnerId: 'owner', projectSplitViewSocketGeneration: 1, splitPanes: null };
  var frame = { contentWindow: source, contentDocument: document, dataset: { projectSlug: 'demo', sessionId: '2' },
    clayPane: { identity: function () { return { ready: true, binding: binding }; } } };
  var frames = [frame], current = true;
  var host = { querySelectorAll: function () { return frames; } };
  var sandbox = { URL: URL, window: { location: { origin: 'http://clay.test', href: 'http://clay.test/p/demo/' } }, store: { snap: function () { return state; } },
    showToast: function () {}, livePaneBinding: function () { return current; }, loadBrowser: function () { return new Promise(function (done) { resolve = done; }); } };
  vm.runInNewContext(code, sandbox);
  var event = { origin: 'http://clay.test', source: source, data: { type: 'clay-pane-open-browser', projectSlug: 'demo', sessionId: '2', paneBinding: binding, url: 'http://localhost:4000/' } };
  return { state: state, frame: frame, host: host, event: event, api: sandbox, opened: opened, unbind: function () { current = false; }, remove: function () { frames = []; },
    release: async function () { resolve({ openSharedBrowserAt: function (url) { opened.push(url); } }); await new Promise(function (done) { setImmediate(done); }); } };
}
test('exact live singleton or saved-view pane opens the parent browser without legacy split state', async function () {
  var f = liveFixture();
  assert.equal(f.api.handlePaneBrowserMessage(f.event, f.host), true);
  await f.release(); assert.deepEqual(f.opened, ['http://localhost:4000/']);
});
['disconnect', 'owner', 'project owner', 'project', 'socket', 'binding', 'document', 'window', 'removal'].forEach(function (change) {
  test('browser link refuses changed ' + change + ' while loading its panel module', async function () {
    var f = liveFixture(); f.api.handlePaneBrowserMessage(f.event, f.host);
    if (change === 'disconnect') f.state.connected = false;
    if (change === 'owner') f.state.myUserId = 'foreign';
    if (change === 'project owner') f.state.currentProjectOwnerId = 'foreign';
    if (change === 'project') f.state.currentSlug = 'foreign';
    if (change === 'socket') f.state.projectSplitViewSocketGeneration++;
    if (change === 'binding') f.unbind();
    if (change === 'document') f.frame.contentDocument = {};
    if (change === 'window') f.frame.contentWindow = {};
    if (change === 'removal') f.remove();
    await f.release(); assert.deepEqual(f.opened, []);
  });
});
