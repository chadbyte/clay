var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
// Read/VM only. No server, browser, persistent account store or external transport.
function harness() {
  var tags = [], scripts = [], timers = [], context = vm.createContext({ Promise: Promise, window: {},
    document: { querySelectorAll: function () { return tags; }, createElement: function () { return { remove: function () { this.removed = true; } }; } },
    setTimeout: function (fn) { timers.push(fn); return timers.length; }, clearTimeout: function () {} });
  ['store', 'pane-feature-assets'].forEach(function (name) {
    var source = fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
  });
  function tag(src) { tags.push({ dataset: { src: src }, after: function (script) { scripts.push(script); } }); }
  return { context: context, tag: tag, tags: tags, scripts: scripts, timers: timers };
}
async function flush() { for (var i = 0; i < 8; i++) await Promise.resolve(); }
test('feature asset requests deduplicate and preserve vendor/addon execution order', async function () {
  var f = harness(); f.tag('editor.js'); f.tag('addon.js');
  var first = f.context.ensurePaneFeatureAssets('editor'), second = f.context.ensurePaneFeatureAssets('editor');
  assert.equal(first, second); await flush(); assert.equal(f.scripts.length, 1); assert.equal(f.scripts[0].src, 'editor.js');
  f.context.window.CodeMirror = {}; f.scripts[0].onload(); await flush();
  assert.equal(f.scripts.length, 2); assert.equal(f.scripts[1].src, 'addon.js'); f.scripts[1].onload(); await first;
  assert.ok(f.tags.every(function (tag) { return tag.dataset.loaded === 'true'; }));
  await f.context.ensurePaneFeatureAssets('editor'); assert.equal(f.scripts.length, 2);
});
test('failed assets retain successful predecessors and retry only on a new intentional request', async function () {
  var f = harness(); f.tag('editor.js'); f.tag('addon.js');
  var first = f.context.ensurePaneFeatureAssets('editor'); await flush(); f.context.window.CodeMirror = {}; f.scripts[0].onload(); await flush();
  var refused = assert.rejects(first, /Could not load editor/); f.scripts[1].onerror(); await refused;
  await flush(); assert.equal(f.scripts.length, 2);
  var retry = f.context.ensurePaneFeatureAssets('editor'); await flush(); assert.equal(f.scripts.length, 3);
  assert.equal(f.scripts[2].src, 'addon.js'); f.scripts[2].onload(); await retry;
});
test('missing globals and unknown groups fail without recursive import loops', async function () {
  var f = harness(); await assert.rejects(f.context.ensurePaneFeatureAssets('mermaid'), /Could not load/);
  await assert.rejects(f.context.ensurePaneFeatureAssets('arbitrary'), /Unknown/); assert.equal(f.scripts.length, 0);
});
function knowledge() {
  var handlers = [], resolveImport, opened = 0, initialized = 0, errors = [], ws = {};
  var button = { disabled: false, addEventListener: function (type, fn) { handlers.push(fn); }, removeEventListener: function (type, fn) { handlers.splice(handlers.indexOf(fn), 1); } };
  var context = vm.createContext({ Promise: Promise, getWs: function () { return ws; }, showToast: function (error) { errors.push(error); },
    ensurePaneFeatureAssets: function () { return Promise.resolve(); }, document: { getElementById: function () { return button; } },
    loadModule: function () { return new Promise(function (resolve) { resolveImport = resolve; }); } });
  ['store', 'knowledge-workbench-entry'].forEach(function (name) {
    var source = fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, '').replace("import('./mate-knowledge-workbench.js')", 'loadModule()');
    vm.runInContext(source, context);
  });
  context.store.set({ myUserId: 'owner', currentSlug: 'p', connected: true, projectSplitViewSocketGeneration: 1 });
  context.initMateKnowledgeWorkbench();
  return { context: context, button: button, handlers: handlers, errors: errors,
    open: function () { handlers[0]({ stopImmediatePropagation: function () {} }); },
    loaded: function () { resolveImport({ initMateKnowledgeWorkbench: function () { initialized++; }, openKnowledgeWorkbench: function () { opened++; }, handleKnowledgeWorkbenchMessage: function (msg) { return msg.type === 'owned'; } }); },
    counts: function () { return { opened: opened, initialized: initialized }; } };
}
test('Knowledge loads only on click, initializes once and dispatches through its original handler', async function () {
  var f = knowledge(); assert.deepEqual(f.counts(), { opened: 0, initialized: 0 });
  assert.equal(f.context.handleKnowledgeWorkbenchMessage({ type: 'owned' }), false);
  f.open(); f.open(); assert.equal(f.button.disabled, true); f.loaded(); await flush();
  assert.deepEqual(f.counts(), { opened: 1, initialized: 1 }); assert.equal(f.button.disabled, false);
  assert.equal(f.context.handleKnowledgeWorkbenchMessage({ type: 'owned' }), true);
  assert.equal(f.context.store.get('knowledgeWorkbenchModule'), undefined, 'module namespace is not store data');
  assert.equal(f.context.handleKnowledgeWorkbenchMessage({ type: 'foreign' }), false);
});
test('late Knowledge loads never open after changed account/project/socket generation or disconnect', async function () {
  var changes = [{ myUserId: 'foreign' }, { currentSlug: 'other' }, { projectSplitViewSocketGeneration: 2 }, { connected: false }, { paneCommittedBinding: {} }];
  for (var i = 0; i < changes.length; i++) {
    var f = knowledge(); f.open(); f.context.store.set(changes[i]); f.loaded(); await flush();
    assert.deepEqual(f.counts(), { opened: 0, initialized: 1 }); assert.equal(f.button.disabled, false);
  }
});
test('production pane shell keeps feature vendors lazy without adding preload requests', function () {
  var root = path.resolve('lib/public'), shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var prepare = require('../lib/server-pane-bootstrap').createPaneBootstrap(root), pane = prepare(shell, '/p/test/?pane=1');
  assert.equal(prepare(shell, '/p/test/'), shell);
  assert.equal((pane.match(/data-pane-asset-group=/g) || []).length, 6);
  assert.ok(pane.includes('data-pane-asset-group="mermaid"')); assert.ok(pane.includes('data-pane-asset-group="qr"'));
  ['mate-knowledge-workbench.js', 'knowledge-db-workbench.js', 'knowledge-markdown-editor.js'].forEach(function (name) {
    assert.ok(!pane.includes('rel="modulepreload" href="modules/' + name + '"'), name);
  });
  assert.equal((pane.match(/rel="modulepreload"/g) || []).length, 0);
  ['marked@', 'dompurify@', '@xterm/xterm@'].forEach(function (name) { assert.ok(pane.split('\n').some(function (line) { return line.includes('<script src=') && line.includes(name); })); });
});
test('lazy diagram continuation survives pending-to-committed binding but rejects replaced identity', async function () {
  var source = fs.readFileSync('lib/public/modules/markdown.js', 'utf8');
  source = source.slice(source.indexOf('export function renderMermaidBlocks'), source.indexOf('  blocks.forEach(function (codeEl)', source.indexOf('export function renderMermaidBlocks'))).replace('export ', '') + 'rendered++; }';
  async function check(change, expected) {
    var binding = {}, state = { panePendingBinding: binding, sessionOriginId: 'a', currentSlug: 'p', myUserId: 'owner', projectSplitViewSocketGeneration: 1 }, release;
    var context = vm.createContext({ rendered: 0, store: { get: function (key) { return state[key]; } }, renderWireframeBlocks: function () {},
      ensurePaneFeatureAssets: function () { return new Promise(function (resolve) { release = resolve; }); } });
    vm.runInContext(source, context);
    context.renderMermaidBlocks({ isConnected: true, querySelectorAll: function () { return [{}]; } });
    state.panePendingBinding = null; state.paneCommittedBinding = binding;
    Object.assign(state, change); context.mermaid = {}; release(); await flush(); assert.equal(context.rendered, expected);
  }
  await check({}, 1); await check({ paneCommittedBinding: {} }, 0); await check({ myUserId: 'foreign' }, 0);
  await check({ currentSlug: 'other' }, 0); await check({ projectSplitViewSocketGeneration: 2 }, 0);
});
