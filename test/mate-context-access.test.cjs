var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
test('restricted Mate context uses live owner sources, redacted selected history and exact reviewed navigation', function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mate-context-'));
  try {
    var result = cp.spawnSync(process.execPath, [path.join(__dirname, 'fixtures/clay-product-control.cjs'), root, '--mate-context'], {
      env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, '.clay'), CLAY_CONFIG: path.join(root, '.clay/daemon.json'), CODEX_HOME: path.join(root, '.codex'), SUDO_USER: '', SUDO_HOME: '' }), encoding: 'utf8', timeout: 60000
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    t.diagnostic(result.stdout.match(/\d+ restricted context production scenarios passed/)[0]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
