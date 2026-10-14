var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var createRuntime = require('../lib/shared-browser-runtime').createRuntime;
var attachCookieStore = require('../lib/shared-browser-cookies').attachCookieStore;

test('real browser workers restore personal cookies and synchronize login/logout without leaking to incognito or another owner', { timeout: 90000 }, async function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-cookie-runtime-'));
  var store = attachCookieStore(root), runtimes = [], errors = [], publicEvents = [];
  var server = http.createServer(function (req, res) {
    if (req.url === '/login') res.setHeader('Set-Cookie', 'login=fixture; HttpOnly; Path=/; SameSite=Lax');
    if (req.url === '/logout') res.setHeader('Set-Cookie', 'login=; Max-Age=0; HttpOnly; Path=/');
    res.setHeader('Content-Type', 'text/html');
    res.end('<h1>' + (req.headers.cookie === 'login=fixture' ? 'Signed in' : 'Signed out') + '</h1>');
  });
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  var base = 'http://127.0.0.1:' + server.address().port;
  async function open(owner) {
    var ready, reject;
    var started = new Promise(function (resolve, fail) { ready = resolve; reject = fail; });
    var runtime = createRuntime({ cookies: owner ? {
      read: function () { return store.read(owner); },
      exchange: function (before, after) { return store.exchange(owner, before, after); },
    } : null, onEvent: function (message) {
      if (message.type === 'ready') ready();
      if (message.type === 'error') { errors.push(message.error); reject(new Error(message.error)); }
      publicEvents.push(message.type);
    } });
    runtimes.push(runtime); await started; return runtime;
  }
  async function visit(runtime, page) {
    await runtime.request('action', { kind: 'navigate', url: base + page }, 0);
    return (await runtime.request('inspect', null, 0)).snapshot;
  }
  try {
    var first;
    try { first = await open('alice'); }
    catch (error) {
      if (error.message.indexOf('Install Chrome or run npx playwright install chromium') >= 0) { t.skip('No supported browser installed'); return; }
      throw error;
    }
    await visit(first, '/login');
    assert.match(await visit(first, '/'), /Signed in/);
    await first.close();
    store = attachCookieStore(root);
    var restored = await open('alice');
    assert.match(await visit(restored, '/'), /Signed in/, 'a new process restores session cookies');
    var sibling = await open('alice');
    assert.match(await visit(sibling, '/'), /Signed in/, 'another Mate uses the same user cookies');
    var incognito = await open(null);
    assert.match(await visit(incognito, '/'), /Signed out/);
    await visit(incognito, '/login');
    await incognito.close();
    var bob = await open('bob');
    assert.match(await visit(bob, '/'), /Signed out/);
    await bob.close();
    await visit(restored, '/logout');
    assert.match(await visit(sibling, '/'), /Signed out/, 'an existing sibling learns logout');
    assert.deepEqual(store.read('alice'), [], 'stale tabs do not restore the deleted cookie');
    var privateAgain = await open(null);
    assert.match(await visit(privateAgain, '/'), /Signed out/, 'incognito cookies are discarded');
    assert.deepEqual(errors, []);
    assert.equal(publicEvents.includes('cookies'), false, 'cookie IPC is never forwarded to public events');
  } finally {
    await Promise.all(runtimes.map(function (runtime) { return runtime.close(); }));
    await new Promise(function (resolve) { server.close(resolve); });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
