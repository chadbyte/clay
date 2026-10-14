var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var createRuntime = require('../lib/shared-browser-runtime').createRuntime;
var attachStore = require('../lib/shared-browser-storage').attachStorageStore;

test('real Mate state restores localStorage and IndexedDB, synchronizes deletions and isolates incognito', { timeout: 90000 }, async function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-state-runtime-'));
  var store = attachStore(root), runtimes = [], errors = [], events = [];
  var server = http.createServer(function (req, res) {
    res.setHeader('Content-Type', 'text/html');
    res.end('<h1>Loading</h1><script>(async function(){' +
      'var login=location.pathname==="/login";' +
      'if(login){localStorage.setItem("auth","local-token");sessionStorage.setItem("tab","temporary");document.cookie="login=cookie-token; Path=/";}' +
      'var db=await new Promise(function(resolve,reject){var r=indexedDB.open("auth",1);r.onupgradeneeded=function(){r.result.createObjectStore("tokens")};r.onsuccess=function(){resolve(r.result)};r.onerror=reject;});' +
      'var token=await new Promise(function(resolve,reject){var tx=db.transaction("tokens",login?"readwrite":"readonly");var table=tx.objectStore("tokens");if(login)table.put("db-token","auth");var r=table.get("auth");tx.oncomplete=function(){resolve(r.result||"empty")};tx.onerror=reject;});if(location.pathname!=="/held")db.close();else window.heldDatabase=db;' +
      'document.querySelector("h1").textContent="Local "+(localStorage.getItem("auth")||"empty")+" Database "+token+" Session "+(sessionStorage.getItem("tab")||"empty");' +
      '})()</script>');
  });
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  var base = 'http://127.0.0.1:' + server.address().port;
  async function open(owner) {
    var ready, reject;
    var started = new Promise(function (resolve, fail) { ready = resolve; reject = fail; });
    var runtime = createRuntime({ storage: owner ? {
      read: function () { return store.read(owner); },
      exchange: function (before, after) { return store.exchange(owner, before, after); },
    } : null, onEvent: function (message) {
      if (message.type === 'ready') ready();
      if (message.type === 'error') { errors.push(message.error); reject(new Error(message.error)); }
      events.push(message.type);
    } });
    runtimes.push(runtime); await started; return runtime;
  }
  async function visit(runtime, route) {
    await runtime.request('action', { kind: 'navigate', url: base + route }, 0);
    for (var i = 0; i < 30; i++) {
      var snapshot = (await runtime.request('inspect', null, 0)).snapshot;
      if (!snapshot.includes('Loading')) return snapshot;
      await new Promise(function (resolve) { setTimeout(resolve, 30); });
    }
    throw new Error('Fixture did not finish loading');
  }
  try {
    var first;
    try { first = await open('alice'); } catch (error) {
      if (error.message.includes('Install Chrome or run npx playwright install chromium')) { t.skip('No supported browser installed'); return; } throw error;
    }
    assert.match(await visit(first, '/login'), /local-token Database db-token Session temporary/);
    await first.close(); store = attachStore(root);
    var restored = await open('alice');
    assert.match(await visit(restored, '/'), /local-token Database db-token Session empty/);
    var sibling = await open('alice');
    assert.match(await visit(sibling, '/'), /local-token Database db-token Session empty/);
    var incognito = await open(null);
    assert.match(await visit(incognito, '/'), /Local empty Database empty Session empty/);
    await visit(incognito, '/login'); await incognito.close();
    var bob = await open('bob');
    assert.match(await visit(bob, '/'), /Local empty Database empty/); await bob.close();
    assert.match(await visit(sibling, '/held'), /local-token Database db-token/);
    store.manage('alice', 'clear_data');
    assert.match(await visit(sibling, '/'), /Local empty Database empty/);
    assert.match(await visit(restored, '/'), /Local empty Database empty/);
    assert.equal(store.read('alice').cookies.length, 0);
    assert.equal(store.read('alice').origins[0].localStorage.length, 0);
    assert.deepEqual(errors, []);
    assert.equal(events.includes('storage'), false);
  } finally {
    await Promise.all(runtimes.map(function (runtime) { return runtime.close(); }));
    await new Promise(function (resolve) { server.close(resolve); });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
