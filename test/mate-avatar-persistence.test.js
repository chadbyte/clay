var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var EventEmitter = require('node:events');
var attachSettings = require('../lib/server-settings').attachSettings;

function uploadAvatar(settings, mateId, bytes) {
  return new Promise(function (resolve) {
    var req = new EventEmitter();
    req.method = 'POST';
    var result = { status: 0, body: '' };
    var res = {
      writeHead: function (status) { result.status = status; },
      end: function (body) { result.body = String(body || ''); resolve(result); },
    };
    settings.handleRequest(req, res, '/api/mate-avatar/' + mateId);
    req.emit('data', bytes);
    req.emit('end');
  });
}

function getGeneratedAvatar(settings, requestUrl) {
  return new Promise(function (resolve) {
    var result = { status: 0, headers: {}, body: '' };
    var res = {
      writeHead: function (status, headers) { result.status = status; result.headers = headers || {}; },
      end: function (body) { result.body = String(body || ''); resolve(result); },
    };
    settings.handleRequest({ method: 'GET', url: requestUrl }, res, requestUrl.split('?')[0]);
  });
}

test('Mate avatar profiles persist across reload and locked artwork cannot be replaced', function (t) {
  var clayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mate-avatar-'));
  t.after(function () { fs.rmSync(clayHome, { recursive: true, force: true }); });
  var script = [
    "var mates = require('./lib/mates');",
    "var attachMates = require('./lib/server-mates').attachMates;",
    "var ctx = { userId: null, multiUser: false, linuxUser: null };",
    "var mate = mates.createMate(ctx, { vendor: 'codex' });",
    "var messages = [];",
    "var handler = attachMates({ users: { isMultiUser: function () { return false; } }, mates: mates, projects: new Map(), addProject: function () {}, removeProject: function () {} });",
    "handler.handleMessage({ readyState: 1, send: function (raw) { messages.push(JSON.parse(raw)); } }, { type: 'mate_update', mateId: mate.id, updates: { profile: Object.assign({}, mate.profile, { displayName: 'Ada', avatarStyle: 'bottts', avatarSeed: 'seed-a', avatarCustom: '' }) } });",
    "var saved = messages[0].mate;",
    "var reloaded = mates.getMate(ctx, mate.id);",
    "if (reloaded.profile.avatarStyle !== 'bottts' || reloaded.profile.avatarSeed !== 'seed-a') process.exit(2);",
    "var locked = Object.assign({}, reloaded.profile, { avatarLocked: true, avatarCustom: '/locked.png' });",
    "mates.updateMate(ctx, mate.id, { profile: locked });",
    "mates.updateMate(ctx, mate.id, { profile: Object.assign({}, locked, { avatarStyle: 'pixel-art', avatarSeed: 'attacker', avatarCustom: '/replacement.png', avatarLocked: false }) });",
    "var protectedMate = mates.getMate(ctx, mate.id);",
    "process.stdout.write(JSON.stringify({ saved: saved.profile, reloaded: reloaded.profile, protected: protectedMate.profile }));",
  ].join('\n');
  var result = childProcess.spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { CLAY_HOME: clayHome, CLAY_CONFIG: path.join(clayHome, 'daemon.json'), CLAY_DEV: '' }),
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  var output = JSON.parse(result.stdout);
  assert.strictEqual(output.reloaded.avatarStyle, 'bottts');
  assert.strictEqual(output.reloaded.avatarSeed, 'seed-a');
  assert.strictEqual(output.protected.avatarStyle, 'bottts');
  assert.strictEqual(output.protected.avatarSeed, 'seed-a');
  assert.strictEqual(output.protected.avatarCustom, '/locked.png');
  assert.strictEqual(output.protected.avatarLocked, true);
});

test('custom Mate avatar upload uses the existing bounded server path and refuses locked artwork', async function (t) {
  var clayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mate-upload-'));
  t.after(function () { fs.rmSync(clayHome, { recursive: true, force: true }); });
  var records = {
    'mate-open': { id: 'mate-open', profile: { displayName: 'Open' } },
    'mate-locked': { id: 'mate-locked', profile: { displayName: 'Locked', avatarLocked: true, avatarCustom: '/locked.png' } },
  };
  var settings = attachSettings({
    CONFIG_DIR: clayHome,
    users: { isMultiUser: function () { return false; } },
    mates: {
      buildMateCtx: function () { return {}; },
      getMate: function (ctx, id) { return records[id] || null; },
      updateMate: function (ctx, id, updates) { records[id] = Object.assign({}, records[id], updates); return records[id]; },
    },
    getMultiUserFromReq: function () { return null; },
    projects: new Map(),
    opts: {},
  });
  var png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  var saved = await uploadAvatar(settings, 'mate-open', png);
  assert.strictEqual(saved.status, 200);
  assert.match(records['mate-open'].profile.avatarCustom, /^\/api\/mate-avatar\/mate-open\?v=\d+$/);
  assert.strictEqual(fs.existsSync(path.join(clayHome, 'mate-avatars', 'mate-open.png')), true);

  var locked = await uploadAvatar(settings, 'mate-locked', png);
  assert.strictEqual(locked.status, 403);
  assert.strictEqual(records['mate-locked'].profile.avatarCustom, '/locked.png');
  assert.strictEqual(fs.existsSync(path.join(clayHome, 'mate-avatars', 'mate-locked.png')), false);
});

test('historical avatars are generated through the local server without external requests', async function (t) {
  var clayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-generated-avatar-'));
  t.after(function () { fs.rmSync(clayHome, { recursive: true, force: true }); });
  var settings = attachSettings({
    CONFIG_DIR: clayHome,
    users: { isMultiUser: function () { return false; } },
    mates: {},
    getMultiUserFromReq: function () { return null; },
    projects: new Map(),
    opts: {},
  });
  var generated = await getGeneratedAvatar(settings, '/api/generated-avatar?style=bottts&seed=private-seed&size=52');
  assert.strictEqual(generated.status, 200);
  assert.strictEqual(generated.headers['Content-Type'], 'image/svg+xml; charset=utf-8');
  assert.match(generated.body, /^<svg[^>]+width="52" height="52"/);
  assert.doesNotMatch(generated.body, /private-seed|https?:\/\/api\.dicebear\.com/i);

  var unknown = await getGeneratedAvatar(settings, '/api/generated-avatar?style=lorelei&seed=x&size=52');
  assert.strictEqual(unknown.status, 404);
  assert.match(unknown.body, /Unknown avatar style/);
});
