var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var cp = require('node:child_process');
['private-source', 'persistence', 'inflight', 'fork-save'].forEach(function (group) {
  test('production product control correction: ' + group, function (t) {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-control-correction-'));
    try {
      var result = cp.spawnSync(process.execPath, [path.join(__dirname, 'fixtures/clay-product-control.cjs'), root, '--corrections', group], {
        env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, '.clay'), CLAY_CONFIG: path.join(root, '.clay/daemon.json'), CODEX_HOME: path.join(root, '.codex') }), encoding: 'utf8', timeout: 60000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      var count = { 'private-source': 10, persistence: 15, inflight: 24, 'fork-save': 1 }[group];
      assert.ok(result.stdout.includes(group + ': ' + count + ' production correction checks passed'));
      t.diagnostic(group + ': ' + count + ' production scenarios passed');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
