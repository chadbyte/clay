var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
function invoke(root, group, reload) {
  var args = [path.join(__dirname, 'fixtures/clay-project-lifecycle.cjs'), root, '--correction', group]; if (reload) args.push('--reload');
  return cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, '.clay'), CLAY_CONFIG: path.join(root, '.clay/daemon.json'), CODEX_HOME: path.join(root, '.codex'), SUDO_USER: '', SUDO_HOME: '', CLAY_DEV: '' }), encoding: 'utf8', timeout: 60000 });
}
['recovery', 'publication', 'compatibility', 'linux', 'restart'].forEach(function (group) {
  test('production lifecycle correction: ' + group, function (t) {
    var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-lifecycle-correction-')));
    try {
      if (group === 'restart') { var prepared = invoke(root, 'restart-prepare', false); assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr); }
      var result = invoke(root, group === 'restart' ? 'restart-recover' : group, group === 'restart');
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /production lifecycle correction scenarios passed/); t.diagnostic(result.stdout.match(/[^\n]*production lifecycle correction scenarios passed/)[0]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
