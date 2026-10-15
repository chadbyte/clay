var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
['queue-lifecycle', 'queue-safety', 'vendor'].forEach(function (group) {
  test('production canonical controls: ' + group, function (t) {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-control-1b-'));
    try {
      var result = cp.spawnSync(process.execPath, [path.join(__dirname, 'fixtures/clay-product-control.cjs'), root, '--milestone1b', group], { env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, '.clay'), CLAY_CONFIG: path.join(root, '.clay/daemon.json'), CODEX_HOME: path.join(root, '.codex') }), encoding: 'utf8', timeout: 60000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /milestone 1b checks passed/);
      t.diagnostic(result.stdout.trim());
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
