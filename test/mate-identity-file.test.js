var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var resolve = require('../lib/mate-identity-file').resolveMateIdentityFile;
var instructions = require('../lib/yoke/instructions');

function fixture(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mate-identity-'));
  t.after(function () { fs.rmSync(dir, {recursive: true, force: true}); });
  return dir;
}

test('legacy identity migrates byte-for-byte with metadata and one active instruction source', function (t) {
  var dir = fixture(t);
  var legacy = path.join(dir, 'CLAUDE.md');
  var text = '# My identity\r\nCustom identity.\r\n\r\n<!-- SYSTEM -->\r\nManaged text.\r\n';
  fs.writeFileSync(legacy, text, {mode: 0o640});
  var before = fs.statSync(legacy);
  var canonical = resolve(dir);
  assert.equal(canonical, path.join(dir, 'AGENTS.md'));
  assert.equal(fs.readFileSync(canonical, 'utf8'), text);
  assert.equal(fs.existsSync(legacy), false);
  var after = fs.statSync(canonical);
  assert.equal(after.mode, before.mode);
  assert.equal(after.uid, before.uid);
  assert.equal(after.gid, before.gid);
  assert.equal(resolve(dir), canonical);
  assert.deepEqual(fs.readdirSync(dir), ['AGENTS.md']);
  assert.equal(instructions.scanAndMerge(dir, 'claude'), '--- Instructions from AGENTS.md ---\n' + text.trim());
  assert.equal(instructions.scanAndMerge(dir, 'codex'), ''); // Codex reads AGENTS.md natively.
});

test('existing AGENTS.md wins and conflicting legacy identity is retained outside discovery', function (t) {
  var dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Canonical identity');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Legacy custom identity');
  assert.equal(fs.readFileSync(resolve(dir), 'utf8'), 'Canonical identity');
  var backups = fs.readdirSync(dir).filter(function (file) { return file.startsWith('.identity-legacy-'); });
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), 'Legacy custom identity');
  resolve(dir);
  assert.equal(fs.readdirSync(dir).length, 2);
  assert.doesNotMatch(instructions.scanAndMerge(dir, 'claude'), /Legacy custom/);
});

test('missing identity resolves to AGENTS.md without creating a placeholder', function (t) {
  var dir = fixture(t);
  assert.equal(resolve(dir), path.join(dir, 'AGENTS.md'));
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('migration rejects symlinks without modifying either identity', function (t) {
  var dir = fixture(t);
  var outside = path.join(dir, 'outside.md');
  fs.writeFileSync(outside, 'Do not modify');
  fs.symlinkSync(outside, path.join(dir, 'AGENTS.md'));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Legacy identity');
  assert.throws(function () { resolve(dir); }, /regular file/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'Do not modify');
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'Legacy identity');
});

test('an interrupted migration retains identity and resumes without a conflict backup', function (t) {
  var dir = fixture(t);
  var legacy = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(legacy, 'Identity survives interruption');
  var unlink = fs.unlinkSync;
  fs.unlinkSync = function (file) {
    if (file === legacy) throw new Error('Simulated interruption');
    return unlink(file);
  };
  try { assert.throws(function () { resolve(dir); }, /Simulated interruption/); }
  finally { fs.unlinkSync = unlink; }
  assert.equal(fs.readFileSync(legacy, 'utf8'), 'Identity survives interruption');
  assert.equal(fs.readFileSync(resolve(dir), 'utf8'), 'Identity survives interruption');
  assert.deepEqual(fs.readdirSync(dir), ['AGENTS.md']);
});

test('new custom and built-in Mates create AGENTS.md in the owner directory', function (t) {
  var home = fixture(t);
  var script = [
    "var assert = require('node:assert/strict'); var fs = require('node:fs'); var path = require('node:path');",
    "var mates = require('./lib/mates'); var ctx = {userId: 'alice', multiUser: true};",
    "[mates.createMate(ctx, {vendor:'codex'}), mates.createBuiltinMate(ctx, 'clay')].forEach(function (mate) {",
    "var dir = mates.getMateDir(ctx, mate.id);",
    "assert.ok(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').length > 50);",
    "assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);",
    "assert.equal(mates.getMate({userId:'bob', multiUser:true}, mate.id), null);",
    "});"
  ].join('\n');
  var result = require('node:child_process').spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: Object.assign({}, process.env, {CLAY_HOME: home, CLAY_CONFIG: path.join(home, 'daemon.json'), CLAY_DEV: ''})
  });
  assert.equal(result.status, 0, result.stderr);
});
