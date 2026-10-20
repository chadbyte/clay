var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
// Pure filesystem helper only: no HTTP listener, account storage or providers.
var create = require('../lib/server-pane-bootstrap').createPaneBootstrap;
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-pane-bootstrap-'));
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
var shell = '<head><script>window.appearance = true</script></head><body><script src="vendor/a.js"></script><script src="https://example.invalid/b.js"></script><script type="module" src="app.js?v=exact"></script></body>';
test('large module graphs add zero preload hints and leave parent, entry and vendor order unchanged', function () {
  var imports = [];
  for (var i = 0; i < 600; i++) {
    imports.push("import './module-" + i + ".js';");
    fs.writeFileSync(path.join(root, 'module-' + i + '.js'), 'export var value = 1;');
  }
  fs.writeFileSync(path.join(root, 'app.js'), imports.join('\n'));
  var prepare = create(root), result = prepare(shell, '/p/test/?pane=1');
  assert.equal(prepare(shell, '/p/test/'), shell);
  assert.equal(result, shell);
  assert.equal((result.match(/rel="modulepreload"/g) || []).length, 0);
  // Changed, missing and hostile imports cannot introduce hints or break boot.
  fs.writeFileSync(path.join(root, 'app.js'), "import '../outside.js';\nimport 'https://foreign.invalid/code.js';\nimport './missing.js';");
  assert.equal(prepare(shell, '/p/test/?pane=1'), shell);
  fs.unlinkSync(path.join(root, 'app.js'));
  assert.equal(prepare(shell, '/p/test/?pane=1'), shell);
});
test('missing bundle falls back without compilation or preload hints', function () {
  var prepare = create('/nonexistent');
  assert.equal(prepare(shell, '/p/test/?pane=1'), shell);
});
function deferred(pane) {
  var tasks = [], context = vm.createContext({ setTimeout: function (fn) { tasks.push(fn); } });
  ['store', 'pane-deferred-bootstrap'].forEach(function (name) {
    vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, ''), context);
  });
  context.store.set({ paneMode: pane, connected: true, paneReady: false });
  return { context: context, tasks: tasks, store: context.store };
}
test('parent initializes synchronously; panes wait for readiness and yield between jobs', function () {
  var parent = deferred(false), calls = [];
  parent.context.initializeAfterPaneReady([function () { calls.push('parent'); }]);
  assert.deepEqual(calls, ['parent']); assert.equal(parent.tasks.length, 0);
  var f = deferred(true);
  f.context.initializeAfterPaneReady([function () { calls.push('a'); }, function () { calls.push('b'); }]);
  f.context.initializeAfterPaneReady([function () { calls.push('c'); }]);
  assert.equal(f.tasks.length, 0);
  assert.ok(f.store.get('paneDeferredBootstrap').jobs.every(function (id) { return typeof id === 'number'; }));
  f.store.set({ paneReady: true }); assert.equal(f.tasks.length, 1);
  f.tasks.shift()(); assert.deepEqual(calls, ['parent', 'a']); assert.equal(f.tasks.length, 1);
  f.store.set({ connected: false }); f.tasks.shift()(); assert.equal(f.tasks.length, 0);
  f.store.set({ connected: true }); f.tasks.shift()(); f.tasks.shift()();
  assert.deepEqual(calls, ['parent', 'a', 'b', 'c']);
  f.store.set({ paneReady: false }); f.store.set({ paneReady: true }); assert.equal(f.tasks.length, 0);
});
test('suspension retains jobs; failed initializer is surfaced once without replay', function () {
  var f = deferred(true), calls = 0;
  f.context.initializeAfterPaneReady([function () { calls++; throw new Error('initializer failed'); }, function () { calls++; }]);
  f.store.set({ paneReady: true, paneSuspended: true }); assert.equal(f.tasks.length, 0);
  f.store.set({ paneSuspended: false }); assert.throws(function () { f.tasks.shift()(); }, /initializer failed/);
  f.tasks.shift()(); assert.equal(calls, 2); assert.equal(f.tasks.length, 0);
});
test('production sidebar entry preserves exact pane session cache without rendering hidden lists', function () {
  var source = fs.readFileSync('lib/public/modules/sidebar-sessions.js', 'utf8');
  var start = source.indexOf('export function renderSessionList(sessions)');
  var body = source.slice(start, source.indexOf('  // Remember the inline folder draft', start));
  var paints = 0, context = vm.createContext({ store: { get: function () { return true; } }, cachedSessions: [], lastRenderFingerprint: null,
    sessionRenderFingerprint: function () { return 'new'; }, cancelSessionInlineRename: function () { paints++; } });
  vm.runInContext(body.replace('export ', '') + '\n}', context);
  [1, 4, 8].forEach(function (count) {
    var sessions = Array.from({ length: 3000 }, function (_, i) { return { id: i, sessionOriginId: 'origin-' + i }; });
    for (var p = 0; p < count; p++) context.renderSessionList(sessions);
    assert.equal(context.cachedSessions, sessions); assert.equal(paints, 0);
  });
  context.store.get = function () { return false; }; context.renderSessionList([{ id: 1 }]); assert.equal(paints, 1);
});
test('benchmark requires exact rendered origin, enabled composer and two stable ready frames', function () {
  var callbacks = [], clock = 0, doc = {}, win = { performance: { timeOrigin: 0, getEntriesByType: function () { return []; } } };
  var input = { disabled: true, closest: function () { return null; }, getBoundingClientRect: function () { return { height: 40, width: 100 }; } };
  var messages = { textContent: 'Recorded answer', dataset: { controlSessionOrigin: 'old' }, getBoundingClientRect: function () { return { height: 100, width: 100 }; } };
  doc.getElementById = function (id) { return id === 'messages' ? messages : input; };
  var identity = { ready: true, binding: { sessionOriginId: 'current', generation: 1 } };
  var frame = { dataset: { sessionOriginId: 'current' }, contentDocument: doc, contentWindow: win, clayPane: { document: doc, source: win, identity: function () { return identity; } } };
  var elements = [], windowListeners = {};
  function element() { var node = { style: {}, listeners: {}, appendChild: function () {}, setAttribute: function () {}, addEventListener: function (type, fn) { this.listeners[type] = fn; }, contains: function () { return false; } }; elements.push(node); return node; }
  var context = vm.createContext({ URLSearchParams: URLSearchParams, location: { search: '?pane_count=1' }, window: { addEventListener: function (type, fn, capture) { windowListeners[type] = { fn: fn, capture: capture }; } },
    performance: { timeOrigin: 0, now: function () { return clock; } }, requestAnimationFrame: function (fn) { callbacks.push(fn); },
    document: { createElement: element, body: { prepend: function () {} }, addEventListener: function () {}, querySelectorAll: function () { return [frame]; } } });
  vm.runInContext(fs.readFileSync('test/fixtures/pane-open-benchmark-browser.js', 'utf8').replace(/^import .*;\n/gm, ''), context);
  function tick() { clock += 16; callbacks.shift()(); }
  tick(); assert.equal(context.window.paneOpenBenchmarkResult, undefined);
  messages.dataset.controlSessionOrigin = 'current'; tick(); assert.equal(context.window.paneOpenBenchmarkResult, undefined);
  input.disabled = false; tick(); assert.equal(context.window.paneOpenBenchmarkResult, undefined);
  identity.binding.generation = 2; tick(); assert.equal(context.window.paneOpenBenchmarkResult, undefined);
  tick(); assert.equal(context.window.paneOpenBenchmarkResult.allInteractiveMs, 80);
  assert.equal(context.window.paneOpenBenchmarkResult.panes[0].firstContentMs, 32);
  assert.equal(callbacks.length, 0);
  assert.equal(windowListeners.click.capture, true);
  // Preparation may have introduced a document absent from any completed run.
  var preparedDoc = { getElementById: doc.getElementById };
  frame.contentDocument = preparedDoc; frame.clayPane.document = preparedDoc;
  elements[2].listeners.click();
  windowListeners.click.fn({ target: { closest: function () { return {}; } } });
  assert.equal(callbacks.length, 1, 'window capture arms before product document propagation can stop');
  tick(); tick();
  assert.equal(context.window.paneOpenBenchmarkResult.label, 'sidebar action');
  assert.equal(context.window.paneOpenBenchmarkResult.panes[0].reusedDocument, true);
  assert.match(elements[3].textContent, /Previous: full document navigation/);
  elements[2].listeners.click(); windowListeners.click.fn({ target: { closest: function () { return {}; } } });
  frame.contentDocument = doc; frame.clayPane.document = doc;
  input.getBoundingClientRect = function () { return { width: 0, height: 40 }; };
  tick(); tick(); assert.equal(callbacks.length, 1, 'zero-width composer cannot complete');
  input.getBoundingClientRect = function () { return { width: 100, height: 40 }; };
  messages.getBoundingClientRect = function () { return { width: 0, height: 100 }; };
  tick(); tick(); assert.equal(callbacks.length, 1, 'zero-width content cannot complete');
  messages.getBoundingClientRect = function () { return { width: 100, height: 100 }; };
  tick(); tick(); assert.equal(callbacks.length, 0);
  assert.equal(context.window.paneOpenBenchmarkResult.panes[0].reusedDocument, false, 'replacement after action start is a new document');
});
test('fixture sets a 4096-entry timing buffer first in parent and pane heads', function () {
  var source = fs.readFileSync('test/fixtures/split-view-production-server.cjs', 'utf8');
  var line = source.split('\n').find(function (value) { return value.includes("body = body.replace('<head>'"); });
  var context = vm.createContext({ fs: fs, path: path, __dirname: path.resolve('test/fixtures'), body: '<html><head><link href="asset.css"><script src="app.js"></script></head></html>' });
  vm.runInContext(line.trim(), context);
  assert.ok(context.body.startsWith('<html><head><script>'));
  assert.ok(context.body.indexOf('performance.setResourceTimingBufferSize(4096)') < context.body.indexOf('asset.css'));
  assert.ok(context.body.indexOf('resourcetimingbufferfull') < context.body.indexOf('asset.css'));
  var wrapper = source.slice(source.indexOf("if (url.pathname.indexOf('/fixture/')"), source.indexOf("var end = res.end;"));
  assert.ok(wrapper.includes("url.pathname === '/p/reuse/' && req.headers.cookie"));
  assert.ok(!wrapper.includes('split_view_fixture'));
});
test('early diagnostics capture resource/runtime/rejection failures, redact URL queries and remain bounded', function () {
  var listeners = {}, capacity = 0;
  var win = { addEventListener: function (type, callback, capture) { listeners[type] = callback; if (type === 'error') assert.equal(capture, true); } };
  var context = vm.createContext({ window: win, URL: URL, location: { href: 'http://fixture/p/reuse/' }, performance: {
    setResourceTimingBufferSize: function (value) { capacity = value; }, addEventListener: function (type, callback) { listeners[type] = callback; }, now: function () { return 12; }
  } });
  vm.runInContext(fs.readFileSync('test/fixtures/pane-startup-diagnostics.js', 'utf8'), context);
  listeners.error({ target: { tagName: 'SCRIPT', src: 'https://cdn.invalid/marked.js?private=secret' } });
  listeners.error({ target: win, message: 'marked is not defined', filename: 'http://fixture/modules/markdown.js', lineno: 20 });
  listeners.unhandledrejection({ reason: new Error('Import failed') });
  assert.equal(capacity, 4096); assert.equal(win.__paneFixtureErrors.length, 3);
  assert.equal(win.__paneFixtureErrors[0].source, 'https://cdn.invalid/marked.js');
  assert.equal(win.__paneFixtureErrors[1].message, 'marked is not defined');
  assert.equal(win.__paneFixtureErrors[2].kind, 'rejection');
  for (var i = 0; i < 30; i++) listeners.error({ target: win, message: 'x'.repeat(400) });
  assert.equal(win.__paneFixtureErrors.length, 20); assert.equal(win.__paneFixtureErrors[19].message.length, 240);
  listeners.resourcetimingbufferfull(); assert.equal(win.__paneFixtureTimingOverflow, true);
});
