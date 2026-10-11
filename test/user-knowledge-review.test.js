var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var attach = require('../lib/server-user-knowledge').attachServerUserKnowledge;

function fixture(t, options) {
  options = options || {};
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'you-review-'));
  t.after(function () { fs.rmSync(root, { force: true, recursive: true }); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var sessions = new Map();
  var notices = [];
  var calls = [];
  var nextId = 1;
  var clay = { id: 'clay', builtinKey: 'clay', createdBy: 'alice' };
  var project = {
    sm: { sessions: sessions, saveSessionFile: function () {}, createSessionRaw: function (args) { var s = Object.assign({ localId: nextId++ }, args); sessions.set(s.localId, s); return s; }, deleteSessionQuiet: function (id) { sessions.delete(id); } },
    getStatus: function () { return { isMate: true, mateId: 'clay' }; },
    getYouLinuxUser: function () { return options.noOsUser ? null : 'alice'; },
    forEachClient: function (fn) {
      ['alice', 'bob'].forEach(function (id) { fn({ readyState: 1, _clayUser: { id: id }, send: function (data) { notices.push({ owner: id, message: JSON.parse(data) }); } }); });
    },
    sdk: { startQuery: async function (session) {
      calls.push(session);
      if (options.fail) throw new Error('Provider unavailable');
      var bound = runtime.service.bind({ projectSlug: 'mate-clay', session: session });
      if (!options.noProgress) bound.pending({ limit: 30 }).items.forEach(function (item) {
        bound.curate({ reportRef: item.ref, action: 'decline', reason: 'Temporary observation in this test.' });
      });
      session.onQueryComplete();
      return true;
    } },
  };
  var projects = new Map([['mate-clay', project]]);
  var runtime = attach({ baseDir: root, osUsers: options.noOsUser,
    users: { isMultiUser: function () { return true; }, findUserById: function (id) { return id === 'alice' ? { id: id } : null; }, getAllUsers: function () { return [{ id: 'alice' }]; } },
    mates: { buildMateCtx: function () { return {}; }, getMate: function () { return clay; }, getAllMates: function () { return [clay]; } },
    projects: projects, canAccess: function () { return true; }, resolveDefaultAi: async function () { return { ready: true, vendor: 'codex', model: 'test' }; },
  });
  t.after(function () { runtime.stop(); });
  function report(number) { runtime.service.report('alice', { observation: 'Observation ' + number, evidence: 'User evidence ' + number }, { session: 'source', project: 'source' }); }
  async function advance(ms) {
    t.mock.timers.tick(ms);
    await new Promise(function (resolve) { setImmediate(resolve); });
    await new Promise(function (resolve) { setImmediate(resolve); });
  }
  return { runtime: runtime, report: report, advance: advance, calls: calls, notices: notices, sessions: sessions };
}

test('Clay drains multiple bounded batches and removes temporary review sessions', async function (t) {
  var f = fixture(t);
  for (var i = 0; i < 65; i++) f.report(i);
  await f.advance(1500);
  assert.equal(f.calls.length, 1);
  assert.equal(f.runtime.service.pendingCount('alice'), 35);
  await f.advance(1500);
  await f.advance(1500);
  assert.equal(f.calls.length, 3);
  assert.equal(f.runtime.service.pendingCount('alice'), 0);
  assert.equal(f.sessions.size, 0);
  assert.ok(f.calls.every(function (s) { return s.hidden && s.youCurator && s.ownerId === 'alice'; }));
});

test('failed or non-progressing review preserves observations and has bounded retries', async function (t) {
  var f = fixture(t, { fail: true });
  f.report(1);
  await f.advance(1500);
  await f.advance(60000);
  await f.advance(120000);
  await f.advance(600000);
  assert.equal(f.calls.length, 3);
  assert.equal(f.runtime.service.pendingCount('alice'), 1);
  assert.equal(f.sessions.size, 0);
  assert.ok(f.notices.length > 0);
  assert.ok(f.notices.every(function (notice) { return notice.owner === 'alice'; }));
  f.runtime.schedule('alice');
  await f.advance(1500);
  assert.equal(f.calls.length, 4, 'explicit retry can resume after exhaustion');
});

test('OS-isolated review never falls back to the daemon identity', async function (t) {
  var f = fixture(t, { noOsUser: true });
  f.report(1);
  await f.advance(1500);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sessions.size, 0);
  assert.equal(f.runtime.service.pendingCount('alice'), 1);
});
