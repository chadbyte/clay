var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var storage = require('../lib/shared-browser-storage');
function origin(token) { return { origin: 'https://example.test', localStorage: [{ name: 'auth', value: token }], indexedDB: [{ name: 'auth', version: 1, stores: [] }] }; }
function state(token) { return Object.assign(storage.empty(), { origins: [origin(token)] }); }
test('site state is encrypted, restored per owner and summaries exclude values', function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-storage-'));
  try {
    var store = storage.attachStorageStore(root);
    store.exchange('alice', storage.empty(), state('private-token'));
    assert.equal(storage.attachStorageStore(root).read('alice').origins[0].localStorage[0].value, 'private-token');
    assert.deepEqual(store.read('bob').origins, []);
    var data = store.manage('alice', 'list');
    assert.equal(data.sites[0].origins[0].databases, 1);
    assert.equal(JSON.stringify(data).includes('private-token'), false);
    fs.readdirSync(path.join(root, 'browser-state')).forEach(function (name) {
      var file = path.join(root, 'browser-state', name);
      assert.equal(fs.readFileSync(file, 'utf8').includes('private-token'), false);
      if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    });
    store.visit('alice', 'https://user:secret@example.test/page#token');
    assert.equal(store.manage('alice', 'list').history[0].url, 'https://example.test/page');
    store.manage('alice', 'clear_history');
    assert.equal(store.manage('alice', 'list').history.length, 0);
    assert.equal(store.read('alice').origins.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('site deletion wins over dirty stale snapshots, without deleting other sites or owners', function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-storage-clear-'));
  try {
    var store = storage.attachStorageStore(root), initial = state('old');
    initial.origins.push({ origin: 'https://other.test', localStorage: [{ name: 'setting', value: 'keep' }], indexedDB: [] });
    var saved = store.exchange('alice', storage.empty(), initial);
    store.exchange('bob', storage.empty(), state('bob'));
    store.manage('alice', 'delete_site', 'example.test');
    var dirty = state('dirty');
    var result = store.exchange('alice', saved, dirty);
    assert.equal(result.origins.length, 1);
    assert.equal(result.origins[0].origin, 'https://other.test');
    assert.equal(store.read('bob').origins[0].localStorage[0].value, 'bob');
    store.manage('alice', 'clear_data');
    assert.deepEqual(store.exchange('alice', saved, initial).origins, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('localStorage merges independent keys and idle snapshots cannot undo logout', function () {
  var old = state('old'), saved = state('new'), current = state('old');
  current.origins[0].localStorage.push({ name: 'theme', value: 'dark' });
  var result = storage.mergeState(saved, old, current);
  assert.deepEqual(result.origins[0].localStorage, [{ name: 'auth', value: 'new' }, { name: 'theme', value: 'dark' }]);
  saved.origins[0].localStorage = [];
  assert.deepEqual(storage.mergeState(saved, old, old).origins[0].localStorage, []);
});
test('cookie removal exposes no values and leaves other cookies intact', function () {
  var value = storage.empty();
  value.cookies = ['one', 'two'].map(function (name) { return { name: name, value: 'secret', domain: '.example.test', path: '/', expires: -1 }; });
  var data = storage.summary(value);
  assert.equal(JSON.stringify(data).includes('secret'), false);
  var removed = storage.remove(value, 'delete_cookie', data.sites[0].cookies[0].id);
  assert.equal(removed.cookies.length, 1);
  assert.equal(removed.cookies[0].name, 'two');
  assert.equal(removed.generation, 1);
});
test('an origin disappearing from the snapshot removes its unchanged saved keys', function () {
  var previous = state('old');
  var result = storage.mergeState(previous, previous, storage.empty());
  assert.deepEqual(result.origins[0].localStorage, []);
  assert.deepEqual(result.origins[0].indexedDB, []);
});
