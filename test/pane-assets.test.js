var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
// Pure build/filesystem helpers and extracted production routing: no listener,
// provider, account storage or project lifecycle is imported or started.
var build = require('../scripts/build-pane-assets').buildPaneAssets;
var create = require('../lib/server-pane-bootstrap').createPaneBootstrap;
var contract = require('../lib/pane-asset-manifest');
var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-pane-assets-')));
var serve = require('../lib/server-static-assets').createStaticAssets(root);
var shell = '<head><link rel="stylesheet" href="style.css?v=1"></head><script src="vendor/marked.js"></script><script src="https://cdn/mermaid@1/index.js"></script><script type="module" src="app.js?v=1"></script>';
function put(name, value) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), value); }
function seed() {
  put('index.html', shell);
  put('app.js', "import { store } from './store.js'; window.state = store; window.load = function () { return import('./lazy.js'); }; ");
  put('store.js', 'export var store = { value: 1 };');
  put('lazy.js', "import { store } from './store.js'; export function value() { return store; }");
  put('style.css', '@import "css/first.css"; @import "css/last.css"; .end { color: blue; }');
  put('css/first.css', '.first { color: red; background: url(../image.svg?v=1); }');
  put('css/last.css', '.first { color: green; } .hidden { display: none; }');
  put('image.svg', '<svg/>');
}
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
function response() {
  return { headers: {}, setHeader: function (key, value) { this.headers[key] = value; },
    writeHead: function (status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end: function (body) { this.body = body; } };
}
function productionHandler() {
  // Execute the unmodified production HTTP routing and security-header functions
  // without constructing a server or importing project/provider lifecycles.
  var source = fs.readFileSync(path.join(__dirname, '../lib/server.js'), 'utf8');
  var security = source.slice(source.indexOf('  var securityHeaders ='), source.indexOf('  // --- HTTP handler ---'));
  var handler = source.slice(source.indexOf('  var appHandler = function'), source.indexOf('  // --- Server setup ---'));
  var helpers = source.slice(source.indexOf('function extractSlug('), source.indexOf('function injectRootProjectSlug('));
  var noRoute = { handleRequest: function () { return false; } };
  var context = { URL: URL, tlsOptions: null, serveStatic: serve, console: console,
    auth: { handleRequest: function () { return false; }, getAuthPage: function () { return 'Sign in'; } },
    users: { isMultiUser: function () { return true; } }, isRequestAuthed: function (req) { return req.headers.cookie === 'owner'; },
    getMultiUserFromReq: function (req) { return req.headers.cookie === 'owner' ? { id: 'owner' } : null; },
    canUserAccessSlug: function (id, slug) { return id === 'owner' && slug === 'allowed'; }, administrativeMetadata: function () { return null; },
    projects: new Map(), sendAppShell: function (req, res) { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' }); res.end('personalized shell'); } };
  ['linear', 'speech', 'githubStars', 'networkSettings', 'storageSettings', 'settings', 'admin', 'palette', 'skills'].forEach(function (key) { context[key] = noRoute; });
  var project = { handleHTTP: function (req, res, url) {
    if (url.indexOf('/api/') !== 0) return false;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"personal":true}'); return true;
  } };
  context.projects.set('allowed', project); context.projects.set('foreign', project);
  context.fs = fs; context.path = path; context.publicDir = root;
  context.preparePaneShell = create(root);
  context.injectRootProjectSlug = function (html) { return html; };
  context.injectAppearanceSeed = function (html) { return html; };
  var shellHandler = source.slice(source.indexOf('  function sendAppShell('), source.indexOf('  var palette ='));
  vm.createContext(context); vm.runInContext(shellHandler, context); vm.runInContext(helpers + security + handler, context);
  return function (url, cookie, validator) {
    var res = response(); context.appHandler({ method: 'GET', url: url, headers: { host: 'localhost', cookie: cookie, 'if-none-match': validator }, socket: { remoteAddress: '127.0.0.1' } }, res); return res;
  };
}
test('real build selects only pane assets, preserves CSS order/URLs and split store identity', async function () {
  seed(); var manifest = await build(root), prepare = create(root);
  assert.equal(prepare(shell, '/p/allowed/'), shell);
  var pane = prepare(shell, '/p/allowed/?pane=1');
  assert.ok(pane.includes(manifest.js)); assert.ok(pane.includes(manifest.css));
  assert.ok(pane.indexOf('vendor/marked.js') < pane.indexOf(manifest.js));
  assert.ok(pane.includes('data-pane-asset-group="mermaid"')); assert.ok(!pane.includes('modulepreload'));
  var css = fs.readFileSync(path.join(root, manifest.css), 'utf8');
  assert.ok(css.indexOf('red') < css.indexOf('green')); assert.match(css, /display:none/);
  assert.match(css, /\.\.\/image\.svg\?v=1/);
  assert.equal(new URL('../image.svg?v=1', 'http://local/p/allowed/' + manifest.css).pathname, '/p/allowed/image.svg');
  var files = Object.keys(manifest.outputs).filter(function (name) { return name.endsWith('.js'); });
  var all = files.map(function (name) { return fs.readFileSync(path.join(root, name), 'utf8'); }).join('\n');
  assert.equal((all.match(/value:1/g) || []).length, 1, 'single shared store in each frame module graph');
  assert.match(all, /import\("\.\/chunk-/);
  files.forEach(function (name) {
    var code = fs.readFileSync(path.join(root, name), 'utf8');
    Array.from(code.matchAll(/(?:from|import\()\s*["'](\.\/[^"']+)["']/g)).forEach(function (match) {
      var resolved = new URL(match[1], 'http://local/p/allowed/' + name);
      assert.ok(resolved.pathname.startsWith('/p/allowed/pane-assets/'));
      assert.ok(manifest.outputs[resolved.pathname.slice('/p/allowed/'.length)]);
    });
  });
  assert.ok(!all.includes('window.parent'));
  var second = await build(root); assert.deepEqual(second, manifest, 'reproducible bytes and names');
  // A deployment changes timestamps, not content.
  Object.keys(manifest.inputs).concat(Object.keys(manifest.outputs)).forEach(function (name) { fs.utimesSync(path.join(root, name), new Date(0), new Date(0)); });
  assert.ok(prepare(shell, '/?pane=1').includes(manifest.js));
});
test('source, new imports, missing chunks and corrupt manifests fall back even after cached validation', async function () {
  seed(); var manifest = await build(root), prepare = create(root);
  function bundled() { return prepare(shell, '/?pane=1').includes(manifest.js); }
  assert.ok(bundled());
  var source = fs.readFileSync(path.join(root, 'store.js'), 'utf8'), stat = fs.statSync(path.join(root, 'store.js'));
  put('store.js', source.replace('1', '2')); fs.utimesSync(path.join(root, 'store.js'), stat.atime, stat.mtime);
  assert.equal(bundled(), false, 'same length and restored mtime cannot mask edit');
  put('store.js', source); assert.ok(bundled());
  var app = fs.readFileSync(path.join(root, 'app.js'), 'utf8'); put('new.js', 'export var fresh = true;');
  put('app.js', app + "import('./new.js');"); assert.equal(bundled(), false);
  put('app.js', app); assert.ok(bundled());
  var output = path.join(root, manifest.js), bytes = fs.readFileSync(output);
  fs.writeFileSync(output, Buffer.alloc(bytes.length, 32)); assert.equal(bundled(), false);
  fs.writeFileSync(output, bytes); assert.ok(bundled());
  var chunk = Object.keys(manifest.outputs).find(function (name) { return name.includes('chunk-'); });
  var chunkBytes = fs.readFileSync(path.join(root, chunk)); fs.unlinkSync(path.join(root, chunk)); assert.equal(bundled(), false);
  put(chunk, chunkBytes); assert.ok(bundled());
  var json = JSON.stringify(manifest);
  ['{', JSON.stringify(Object.assign({}, manifest, { js: '../outside.js' })), ' '.repeat(contract.maxBytes + 1)].forEach(function (invalid) {
    put('pane-assets/manifest.json', invalid); assert.equal(bundled(), false);
  });
  put('pane-assets/manifest.json', json); assert.ok(bundled());
  fs.unlinkSync(path.join(root, 'pane-assets/manifest.json')); assert.equal(bundled(), false);
  put('pane-assets/manifest.json', json); fs.unlinkSync(path.join(root, 'lazy.js')); assert.equal(bundled(), false);
});
test('production shell and asset routes retain auth, exact project, CSP, nosniff and HTML/API no-304', async function () {
  seed(); var manifest = await build(root), handle = productionHandler();
  var pane = handle('/p/allowed/?pane=1', 'owner', '*');
  assert.equal(pane.status, 200); assert.ok(pane.body.includes(manifest.js));
  assert.equal(pane.headers['Cache-Control'], 'private, no-store'); assert.equal(pane.headers.ETag, undefined);
  assert.equal(handle('/p/allowed/', 'owner', '*').body, shell);
  Object.keys(manifest.outputs).forEach(function (name) {
    var url = '/p/allowed/' + name, initial = handle(url, 'owner');
    assert.equal(initial.status, 200); assert.ok(initial.headers.ETag);
    var cached = handle(url, 'owner', initial.headers.ETag);
    assert.equal(cached.status, 304); assert.equal(cached.headers['X-Content-Type-Options'], 'nosniff');
    assert.match(cached.headers['Content-Security-Policy'], /script-src 'self'/);
    assert.equal(handle(url, null, initial.headers.ETag).body, 'Sign in');
    assert.equal(handle('/p/foreign/' + name, 'owner', initial.headers.ETag).status, 403);
  });
  assert.equal(handle('/p/allowed/?pane=1', null, '*').body, 'Sign in');
  assert.equal(handle('/p/foreign/?pane=1', 'owner', '*').status, 403);
  var api = handle('/p/allowed/api/private.js', 'owner', '*'); assert.equal(api.status, 200); assert.equal(api.headers.ETag, undefined);
});
