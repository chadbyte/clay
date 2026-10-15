var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var cp = require('node:child_process');
test('canonical Clay controls use real project services, owner review and exact-query catalogs', function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-product-control-'));
  try {
    var result = cp.spawnSync(process.execPath, [path.join(__dirname, 'fixtures/clay-product-control.cjs'), root], {
      env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, '.clay'), CLAY_CONFIG: path.join(root, '.clay/daemon.json'), CODEX_HOME: path.join(root, '.codex') }), encoding: 'utf8', timeout: 60000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /production control checks passed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
