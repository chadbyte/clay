var test = require('node:test');
var assert = require('node:assert/strict');
var attachPreferences = require('../lib/users-project-mate-filter-preferences').attachProjectMateFilterPreferences;
var attachSettings = require('../lib/server-settings').attachSettings;

function fixture(users, config) {
  var data = { users: users };
  var daemon = config || {};
  var saves = 0;
  var configSaves = 0;
  var preferences = attachPreferences({
    loadUsers: function () { return data; },
    saveUsers: function (next) { data = next; saves++; },
    config: {
      loadConfig: function () { return daemon; },
      saveConfig: function (next) { daemon = next; configSaves++; }
    }
  });
  return { preferences: preferences, data: function () { return data; }, daemon: function () { return daemon; }, saves: function () { return saves; }, configSaves: function () { return configSaves; } };
}

test('project and Mate filter persists per authenticated user and defaults invalid stored values to all', function () {
  var f = fixture([{ id: 'u1', projectMateFilterMode: 'broken', untouched: 1 }, { id: 'u2', projectMateFilterMode: 'mates' }]);
  assert.equal(f.preferences.get('u1'), 'all');
  assert.equal(f.preferences.get('u2'), 'mates');
  assert.deepEqual(f.preferences.set('u1', 'projects'), { ok: true, projectMateFilterMode: 'projects' });
  assert.equal(f.data().users[0].projectMateFilterMode, 'projects');
  assert.equal(f.data().users[0].untouched, 1);
  assert.equal(f.data().users[1].projectMateFilterMode, 'mates');
  assert.equal(f.saves(), 1);
  assert.match(f.preferences.set('u1', 'invalid').error, /Invalid/);
  assert.equal(f.saves(), 1);
});

test('single-user project and Mate filter retains unrelated daemon settings', function () {
  var f = fixture([], { port: 2633, nested: { keep: true }, projectMateFilterMode: 'wrong' });
  assert.equal(f.preferences.get(null), 'all');
  assert.deepEqual(f.preferences.set(null, 'mates'), { ok: true, projectMateFilterMode: 'mates' });
  assert.deepEqual(f.daemon(), { port: 2633, nested: { keep: true }, projectMateFilterMode: 'mates' });
  assert.equal(f.configSaves(), 1);
});

function request(body) {
  return {
    method: 'PUT',
    on: function (event, callback) {
      if (event === 'data') callback(JSON.stringify(body));
      if (event === 'end') callback();
    }
  };
}

function response() {
  return {
    status: null,
    body: null,
    writeHead: function (status) { this.status = status; },
    end: function (body) { this.body = JSON.parse(body); }
  };
}

test('authenticated filter route accepts only the three modes', function () {
  var saved = [];
  var user = { id: 'u1' };
  var settings = attachSettings({
    users: {
      isMultiUser: function () { return true; },
      setProjectMateFilterMode: function (userId, mode) {
        if (['all', 'projects', 'mates'].indexOf(mode) === -1) return { error: 'Invalid project and Mate filter mode' };
        saved.push({ userId: userId, mode: mode });
        return { ok: true, projectMateFilterMode: mode };
      }
    },
    mates: {},
    getMultiUserFromReq: function () { return user; },
    projects: new Map(),
    opts: {},
    CONFIG_DIR: '/tmp'
  });
  var good = response();
  assert.equal(settings.handleRequest(request({ mode: 'mates' }), good, '/api/user/project-mate-filter'), true);
  assert.equal(good.status, 200);
  assert.deepEqual(saved, [{ userId: 'u1', mode: 'mates' }]);
  var bad = response();
  settings.handleRequest(request({ mode: 'everything' }), bad, '/api/user/project-mate-filter');
  assert.equal(bad.status, 400);
  assert.deepEqual(saved, [{ userId: 'u1', mode: 'mates' }]);
});

test('filter route rejects an unauthenticated multi-user request before persistence', function () {
  var called = false;
  var settings = attachSettings({
    users: {
      isMultiUser: function () { return true; },
      setProjectMateFilterMode: function () { called = true; }
    },
    mates: {},
    getMultiUserFromReq: function () { return null; },
    projects: new Map(),
    opts: {},
    CONFIG_DIR: '/tmp'
  });
  var res = response();
  assert.equal(settings.handleRequest(request({ mode: 'projects' }), res, '/api/user/project-mate-filter'), true);
  assert.equal(res.status, 401);
  assert.equal(called, false);
});
