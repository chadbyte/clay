var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
// Import only the pure static helper; no daemon/project/storage/network imports.
var create = require('../lib/server-static-assets').createStaticAssets;
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-static-'));
var serve = create(root);
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
function response() {
  return { headers: {}, setHeader: function (key, value) { this.headers[key] = value; },
    writeHead: function (status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end: function (body) { this.body = body; } };
}
function asset(file, validator, method) {
  var res = response(); res.found = serve(file, { method: method || 'GET', headers: { 'if-none-match': validator } }, res); return res;
}
test('JS/CSS validators preserve exact bytes and detect same-length edits, including empty files', function () {
  ['.js', '.css'].forEach(function (ext) {
    var file = '/a' + ext, bytes = Buffer.from('a\u0000b\n'); fs.writeFileSync(path.join(root, file), bytes);
    var first = asset(file); assert.equal(first.status, 200); assert.deepEqual(first.body, bytes);
    assert.equal(first.headers['Cache-Control'], 'no-cache'); assert.match(first.headers.ETag, /^"[a-f0-9]{64}"$/);
    assert.equal(asset(file).headers.ETag, first.headers.ETag);
    var cached = asset(file, first.headers.ETag); assert.equal(cached.status, 304); assert.equal(cached.body, undefined);
    assert.equal(cached.headers['Content-Type'], first.headers['Content-Type']); assert.equal(cached.headers['Cache-Control'], 'no-cache');
    fs.writeFileSync(path.join(root, file), Buffer.from('a\u0000c\n'));
    var changed = asset(file, first.headers.ETag); assert.equal(changed.status, 200); assert.notEqual(changed.headers.ETag, first.headers.ETag);
    fs.writeFileSync(path.join(root, '/other' + ext), 'different'); assert.equal(asset('/other' + ext, changed.headers.ETag).status, 200);
  });
  fs.writeFileSync(path.join(root, 'empty.js'), ''); var empty = asset('/empty.js');
  assert.equal(empty.status, 200); assert.equal(empty.body.length, 0); assert.equal(asset('/empty.js', empty.headers.ETag).status, 304);
});
test('GET validators accept weak/list/wildcard matches but reject malformed or unrelated tags', function () {
  var tag = asset('/a.js').headers.ETag;
  [tag, 'W/' + tag, '"other", W/' + tag, ' "a,b", ' + tag + ' ', '*'].forEach(function (header) { assert.equal(asset('/a.js', header).status, 304, header); });
  ['"other"', 'garbage ' + tag, tag + ' garbage', 'W/' + tag.slice(0, -1), tag + tag, '*,' + tag].forEach(function (header) { assert.equal(asset('/a.js', header).status, 200, header); });
  assert.equal(asset('/a.js', tag, 'POST').status, 200);
});
test('HTML/JSON/images retain original headers and never return conditional 304', function () {
  ['html', 'json', 'png', 'bmp'].forEach(function (ext) {
    fs.writeFileSync(path.join(root, 'asset.' + ext), 'body');
    var res = asset('/asset.' + ext, '*'); assert.equal(res.status, 200); assert.equal(res.headers.ETag, undefined);
    assert.equal(res.headers['Cache-Control'], ext === 'png' ? 'public, max-age=86400, immutable' : 'no-cache');
  });
  assert.equal(asset('/missing.js', '*').found, false);
  assert.equal(asset('/../outside.js', '*').status, 403);
});
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
  vm.createContext(context); vm.runInContext(helpers + security + handler, context);
  return function (url, cookie, validator) {
    var res = response(); context.appHandler({ method: 'GET', url: url, headers: { host: 'localhost', cookie: cookie, 'if-none-match': validator }, socket: { remoteAddress: '127.0.0.1' } }, res); return res;
  };
}
test('production routing keeps authentication/project checks before validators, security headers and query behavior', function () {
  var handle = productionHandler(), initial = handle('/p/allowed/a.js?v=one', 'owner');
  assert.equal(initial.status, 200); assert.ok(initial.headers.ETag);
  var tag = initial.headers.ETag, cached = handle('/p/allowed/a.js?v=two', 'owner', tag);
  assert.equal(cached.status, 304); assert.equal(cached.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(cached.headers['Content-Security-Policy'], initial.headers['Content-Security-Policy']);
  assert.equal(handle('/p/allowed/a.js', null, tag).body, 'Sign in');
  assert.equal(handle('/p/foreign/a.js', 'owner', tag).status, 403);
  assert.equal(handle('/p/missing/a.js', 'owner', tag).status, 302);
  var shell = handle('/p/allowed/', 'owner', '*'); assert.equal(shell.status, 200); assert.equal(shell.headers.ETag, undefined);
  var api = handle('/p/allowed/api/personal.js', 'owner', '*'); assert.equal(api.status, 200); assert.equal(api.headers.ETag, undefined);
  var rootAsset = handle('/a.js?version=2', null, tag); assert.equal(rootAsset.status, 304, 'existing public static route stays unchanged');
  assert.equal(handle('/api/not-an-asset.js', 'owner', '*').status, 404);
});
