var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
test('production project lifecycle uses durable receipts, exact owner review, real Git and completed shutdown', function (t) {
  var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-project-lifecycle-')));
  try {
    var result = cp.spawnSync(process.execPath, [path.join(__dirname, 'fixtures/clay-project-lifecycle.cjs'), root], {
      env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, '.clay'), CLAY_CONFIG: path.join(root, '.clay/daemon.json'), CODEX_HOME: path.join(root, '.codex'), SUDO_USER: '', SUDO_HOME: '', CLAY_DEV: '' }), encoding: 'utf8', timeout: 60000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /production project lifecycle scenarios passed/);
    t.diagnostic(result.stdout.match(/\d+ production project lifecycle scenarios passed/)[0]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
