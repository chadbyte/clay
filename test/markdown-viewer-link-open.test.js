// Real chat Markdown link -> exact pane/shell file viewer. Uses synthetic
// Markdown only, in a temp project served by the isolated pane fixture
// (isolated HOME/CLAY_HOME, provider and Git-write fences set before imports).
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process');
var fs = require('node:fs'), path = require('node:path');
var chromium = require('playwright').chromium;
var hasSavedViews = fs.existsSync(path.join(__dirname, '../lib/public/modules/split-view-presentations.js'));

test('markdown view mode defaults to rendered, honors line/diff targets and project-scoped choices', async function () {
  global.navigator = { userAgent: 'node', platform: '', maxTouchPoints: 0 };
  var store = await import('file://' + path.join(__dirname, '../lib/public/modules/store.js'));
  store.createStore({ fileViewerMarkdownModes: {} });
  var mode = await import('file://' + path.join(__dirname, '../lib/public/modules/markdown-view-mode.js'));
  ['a.md', 'constructor', '__proto__.md', 'toString.md', 'hasOwnProperty'].forEach(function (name) {
    assert.equal(mode.initialMarkdownRendered('p1', name, null, null), true, name);
  });
  assert.equal(mode.initialMarkdownRendered('p1', 'a.md', { path: 'a.md', line: 3 }, null), false);
  assert.equal(mode.initialMarkdownRendered('p1', 'a.md', { path: 'other.md', line: 3 }, null), true);
  assert.equal(mode.initialMarkdownRendered('p1', 'a.md', null, { type: 'diff' }), false);
  mode.rememberMarkdownViewMode('p1', 'docs/a.md', false);
  assert.equal(mode.initialMarkdownRendered('p1', 'docs/a.md', null, null), false);
  assert.equal(mode.initialMarkdownRendered('p2', 'docs/a.md', null, null), true, 'same relative path in another project is independent');
  mode.rememberMarkdownViewMode('p1', '__proto__.md', false);
  assert.equal(mode.initialMarkdownRendered('p1', '__proto__.md', null, null), false);
  assert.equal(mode.initialMarkdownRendered('p1', 'constructor', null, null), true);
  mode.resetMarkdownViewModes();
  assert.equal(mode.initialMarkdownRendered('p1', 'docs/a.md', null, null), true);
  delete global.navigator;
});

async function startFixture(t, env) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_BENCH: '' }, env), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var cwd = path.join(info.root, 'reuse');
  fs.mkdirSync(path.join(cwd, 'docs'));
  fs.writeFileSync(path.join(cwd, 'docs/SYNTH.ko.md'), '# Synthetic heading\n\nBody **bold** text.\n\n- item\n');
  fs.writeFileSync(path.join(cwd, 'plain.js'), 'var synthetic = 1;\n');
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage(), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  var origin = 'http://127.0.0.1:' + info.port;
  await page.goto(origin + '/fixture/login');
  var data = await (await page.request.get(origin + '/fixture/state')).json();
  function viewer() {
    return page.evaluate(function () {
      var el = document.getElementById('file-viewer');
      return { hidden: el.classList.contains('hidden'), rendered: !!el.querySelector('.file-viewer-markdown h1'),
        source: !!el.querySelector('code.language-markdown'), toggle: !document.getElementById('file-viewer-render').classList.contains('hidden') };
    });
  }
  return { page: page, origin: origin, cwd: cwd, data: data, errors: errors, viewer: viewer,
    absolute: path.join(cwd, 'docs/SYNTH.ko.md'),
    say: function (id, text) { return page.request.post(origin + '/fixture/live?kind=turn&id=' + id + '&text=' + encodeURIComponent(text)); },
    closeViewer: async function () { await page.click('#file-viewer-close'); await page.waitForFunction(function () { return document.getElementById('file-viewer').classList.contains('hidden'); }); },
    clickIn: async function (scope, label, expect) {
      await scope.getByRole('button', { name: label, exact: true }).last().click();
      await page.waitForFunction(function (kind) {
        var el = document.getElementById('file-viewer');
        if (el.classList.contains('hidden')) return false;
        if (kind === 'markdown') return !!el.querySelector('.file-viewer-markdown h1');
        if (kind === 'source') return !!el.querySelector('code.language-markdown');
        return !!el.querySelector('#file-viewer-body .file-viewer-code-content, #file-viewer-body pre');
      }, expect, { timeout: 10000 });
    },
    panesReady: function (count, ids) {
      return page.waitForFunction(function (args) {
        var frames = Array.from(document.querySelectorAll('#split-host .split-pane-frame'));
        return frames.length === args.count && args.ids.every(function (id) {
          var frame = frames.find(function (item) { return Number(item.dataset.sessionId) === id; });
          var live = frame && frame.clayPane && frame.clayPane.identity();
          return live && live.ready && live.sessionId === id && !frame.dataset.requestedSessionId;
        });
      }, { count: count, ids: ids }, { timeout: 30000 });
    },
    pane: function (id) { return page.frameLocator('.split-pane-frame[data-session-id="' + id + '"]'); } };
}

async function exerciseLinks(f, scope, label) {
  await f.clickIn(scope, 'Open file ' + f.absolute, 'markdown');
  var state = await f.viewer();
  assert.deepEqual([state.rendered, state.source, state.toggle], [true, false, true], label + ': absolute link opens rendered first');
  await f.page.click('#file-viewer-render');
  assert.equal((await f.viewer()).source, true, label + ': source toggle');
  await f.page.evaluate(function () { document.querySelector('.file-viewer-tab').click(); });
  await f.page.waitForTimeout(400);
  assert.equal((await f.viewer()).source, true, label + ': explicit source choice survives tab refocus');
  await f.page.click('#file-viewer-render');
  assert.equal((await f.viewer()).rendered, true);
  await f.closeViewer();
  await f.clickIn(scope, 'Open file docs/SYNTH.ko.md', 'markdown');
  assert.equal((await f.viewer()).rendered, true, label + ': relative link opens rendered first');
  await f.closeViewer();
  await f.clickIn(scope, 'Open file docs/SYNTH.ko.md:3', 'source');
  assert.equal((await f.viewer()).source, true, label + ': explicit line target opens source rows');
  await f.closeViewer();
  await f.clickIn(scope, 'Open file plain.js', 'code');
  state = await f.viewer();
  assert.deepEqual([state.rendered, state.source, state.toggle], [false, false, false], label + ': non-Markdown unchanged');
  await f.closeViewer();
}

var links = 'Absolute [a](ABS) relative [rel](docs/SYNTH.ko.md) lined [lined](docs/SYNTH.ko.md:3) code [plain.js](plain.js)';

test('real chat links open in a legacy split pair', { timeout: 120000 }, async function (t) {
  var f = await startFixture(t, {});
  var group = f.data.groups[0];
  await f.page.evaluate(async function (g) { (await import('/p/reuse/modules/split-view.js')).openGroup(g); }, group);
  await f.panesReady(2, [group.pair.driverId, group.pair.workerId]);
  await f.say(group.pair.driverId, links.replace('ABS', f.absolute));
  await f.say(group.pair.workerId, 'Worker [w](' + f.absolute + ')');
  await exerciseLinks(f, f.pane(group.pair.driverId), 'driver pane');
  await f.clickIn(f.pane(group.pair.workerId), 'Open file ' + f.absolute, 'markdown');
  assert.equal((await f.viewer()).rendered, true, 'worker pane link');
  assert.deepEqual(f.errors, []);
});

test('real chat links open from the ordinary single-session view', { timeout: 120000 }, async function (t) {
  var f = await startFixture(t, {});
  var id = f.data.standaloneId;
  await f.page.request.post(f.origin + '/fixture/switch?id=' + id);
  await f.page.waitForFunction(function (id) { return document.getElementById('messages').dataset.controlSessionId === String(id) || !!document.querySelector('.split-pane-frame[data-session-id="' + id + '"]'); }, id, { timeout: 30000 });
  await f.say(id, links.replace('ABS', f.absolute));
  var paned = await f.page.locator('.split-pane-frame[data-session-id="' + id + '"]').count();
  await exerciseLinks(f, paned ? f.pane(id) : f.page.locator('#messages'), paned ? 'single-session pane' : 'native shell');
  assert.deepEqual(f.errors, []);
});

test('saved-view pane links open, and stale or forged pane messages are rejected', { timeout: 120000, skip: !hasSavedViews && 'requires the saved-view (PR599) UI' }, async function (t) {
  var f = await startFixture(t, { CLAY_PANE_PRESENTATION: '1' });
  var view = f.data.restoreView;
  assert.ok(view, 'fixture created a real saved view');
  await f.say(view.pair.driverId, links.replace('ABS', f.absolute));
  await f.page.locator('[data-split-view-id="' + view.id + '"] .split-view-group-open').first().click();
  await f.panesReady(view.members.length, view.members);
  var pane = f.pane(view.pair.driverId);
  // Forged and stale messages from the live pane window must not open anything.
  async function forge(patch) {
    await f.page.evaluate(function (args) {
      var frame = document.querySelector('.split-pane-frame[data-session-id="' + args.id + '"]');
      var binding = frame.clayPane.identity().binding;
      var message = Object.assign({ type: 'clay-pane-open-file', paneBinding: binding, path: 'docs/SYNTH.ko.md', line: null, column: null,
        projectSlug: frame.dataset.projectSlug, sessionId: String(args.id) }, args.patch);
      frame.contentWindow.parent.postMessage(message, location.origin);
    }, { id: view.pair.driverId, patch: patch });
    await f.page.waitForTimeout(500);
    assert.equal((await f.viewer()).hidden, true, 'rejected: ' + JSON.stringify(Object.keys(patch)));
  }
  await forge({ paneBinding: null });
  await forge({ paneBinding: { requestId: 'stale', generation: -1 } });
  await forge({ sessionId: String(view.pair.driverId + 100) });
  await forge({ projectSlug: 'other-project' });
  await forge({ path: '' });
  await f.page.evaluate(function (id) { document.querySelector('.split-pane-frame[data-session-id="' + id + '"]').clayPane.suspend(); }, view.pair.driverId);
  await forge({});
  await f.page.reload({ waitUntil: 'domcontentloaded' });
  await f.panesReady(view.members.length, view.members);
  await exerciseLinks(f, f.pane(view.pair.driverId), 'saved view after reload');
  assert.deepEqual(f.errors, []);
});
