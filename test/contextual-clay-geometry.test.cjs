var test = require('node:test');
var assert = require('node:assert/strict');
var events = require('node:events');
var attachPreferences = require('../lib/users-contextual-clay-preferences').attachContextualClayPreferences;
var attachSettings = require('../lib/server-contextual-clay-settings').attachContextualClaySettings;

test('authenticated geometry service validates bounds and persists only the live account', async function () {
  var data = { users: [{ id: 'owner' }, { id: 'other' }] }; var writes = 0;
  var preferences = attachPreferences({ loadUsers: function () { return structuredClone(data); }, saveUsers: function (next) { data = next; writes++; } });
  var identity = { id: 'owner' };
  var handler = attachSettings({ users: Object.assign({ isMultiUser: function () { return true; } }, preferences), isRequestAuthed: function () { return !!identity; }, getMultiUserFromReq: function () { return identity; } });
  function request(method, body, headers, afterStart) {
    return new Promise(function (resolve) {
      var req = new events.EventEmitter(); req.method = method; req.headers = Object.assign({ 'x-clay-settings': '1' }, headers); req.setEncoding = function () {};
      var status;
      var res = { writeHead: function (code) { status = code; }, end: function (value) { resolve({ status: status, data: JSON.parse(value) }); } };
      assert.equal(handler.handleRequest(req, res, '/api/user/contextual-clay-geometry'), true);
      if (afterStart) afterStart();
      if (body !== undefined) req.emit('data', JSON.stringify(body));
      req.emit('end');
    });
  }
  var geometry = { left: 145, top: 40, width: 620, height: 590 };
  assert.equal((await request('PUT', geometry)).status, 200);
  assert.deepEqual(preferences.getContextualClayGeometry('owner'), geometry);
  assert.equal(preferences.getContextualClayGeometry('other'), null);
  identity = { id: 'other' };
  assert.equal((await request('GET')).data.geometry, null);
  assert.equal((await request('PUT', Object.assign({ userId: 'owner' }, geometry))).status, 400);
  assert.deepEqual(preferences.getContextualClayGeometry('owner'), geometry);
  for (var invalid of [null, [], { left: 1, top: 1, width: 339, height: 360 }, { left: -1, top: 1, width: 340, height: 360 }, { left: 1, top: 1, width: 2561, height: 360 }, { left: 1, top: 1, width: Infinity, height: 360 }]) {
    assert.equal((await request('PUT', invalid)).status, 400);
  }
  assert.equal((await request('PUT', geometry, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request('PUT', geometry, { 'x-clay-settings': '' })).status, 403);
  assert.equal((await request('PUT', geometry, {}, function () { identity = null; })).status, 401);
  assert.equal((await request('GET')).status, 401);
  assert.equal(writes, 1);
});
