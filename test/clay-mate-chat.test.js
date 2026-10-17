var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
test('canonical Mate conversations use exact reviewed production services and retain delivery receipts', function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mate-chat-'));
  try {
    var result = cp.spawnSync(process.execPath, [path.join(__dirname, 'fixtures/clay-product-control.cjs'), root, '--mate-chat'], {
      env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, '.clay'), CLAY_CONFIG: path.join(root, '.clay/daemon.json'), CODEX_HOME: path.join(root, '.codex'), SUDO_USER: '', SUDO_HOME: '' }), encoding: 'utf8', timeout: 60000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /\d+ production Mate chat scenarios passed/);
    t.diagnostic(result.stdout.match(/\d+ production Mate chat scenarios passed/)[0]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
