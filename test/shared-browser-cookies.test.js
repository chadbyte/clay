var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cookies = require('../lib/shared-browser-cookies');
function cookie(value, extra) {
  return Object.assign({ name: 'login', value: value, domain: 'example.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }, extra);
}
test('personal cookies survive a new store instance, remain encrypted and belong to one user', function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-cookies-'));
  try {
    var store = cookies.attachCookieStore(root);
    store.exchange('alice', [], [cookie('private-token')]);
    var restored = cookies.attachCookieStore(root);
    assert.deepEqual(restored.read('alice'), [cookie('private-token')]);
    assert.deepEqual(restored.read('bob'), []);
    var dir = path.join(root, 'browser-cookies');
    fs.readdirSync(dir).forEach(function (name) {
      assert.equal(fs.readFileSync(path.join(dir, name), 'utf8').includes('private-token'), false);
      if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, name)).mode & 0o777, 0o600);
    });
    assert.throws(function () { store.read(''); }, /owner/);
    var file = fs.readdirSync(dir).find(function (name) { return name.endsWith('.json'); });
    fs.writeFileSync(path.join(dir, file), 'broken');
    assert.throws(function () { restored.read('alice'); }, /decrypt/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('idle tabs do not resurrect logged-out cookies or overwrite newer logins', function () {
  var old = cookie('old'), fresh = cookie('fresh');
  assert.deepEqual(cookies.mergeCookies([], [old], [old]), []);
  assert.deepEqual(cookies.mergeCookies([fresh], [old], [old]), [fresh]);
  assert.deepEqual(cookies.mergeCookies([fresh], [old], []), [fresh], 'stale deletion cannot delete a changed cookie');
  assert.deepEqual(cookies.mergeCookies([old], [old], []), []);
  var other = cookie('second', { name: 'other' });
  assert.deepEqual(cookies.mergeCookies([other], [], [fresh]), [other, fresh]);
  assert.deepEqual(cookies.mergeCookies([], [], [cookie('expired', { expires: 1 })]), []);
  assert.throws(function () { cookies.mergeCookies([], [], [{}]); }, /Invalid/);
});
test('partitioned cookies have separate identities', function () {
  var first = cookie('one', { partitionKey: 'https://first.test' });
  var second = cookie('two', { partitionKey: 'https://second.test' });
  assert.equal(cookies.mergeCookies([first], [], [second]).length, 2);
});

test('failed cookie application retains the acknowledged baseline and ignores unrelated replies', async function () {
  var attachSync = require('../lib/shared-browser-cookie-sync').attachCookieSync;
  var requests = [], shouldFail = true, current = [];
  var sync = attachSync({
    cookies: async function () { return current; },
    addCookies: async function (values) { if (shouldFail) throw new Error('Apply failed'); current = values; },
  }, [], function (message) {
    requests.push(message);
    sync.receive({ id: message.id + 1, cookies: [] });
    sync.receive({ id: message.id, cookies: [cookie('remote')] });
  });
  await assert.rejects(sync.sync(), /Apply failed/);
  shouldFail = false;
  await sync.sync();
  assert.deepEqual(requests[1].previous, [], 'an unapplied remote cookie cannot become a local deletion');
  assert.deepEqual(current, [cookie('remote')]);
  await sync.sync();
  assert.deepEqual(requests[2].previous, [cookie('remote')]);
});
