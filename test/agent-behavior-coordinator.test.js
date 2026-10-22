// Production coordinator coverage for the Personal Agent behavior policy. The
// fixture runs the real project coordinator and real Notes, Logs, Issues and
// User Knowledge services in a child process with an isolated HOME; no provider
// query, login or account is used.
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

['solo', 'accounts'].forEach(function (mode) {
  test('actual project coordinator enforces the Agent behavior policy for ' + mode + ' installations', function (t) {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-agent-behavior-'));
    t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
    var run = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'fixtures/agent-behavior-coordinator.cjs'), root, mode], {
      env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, 'config'), CLAY_CONFIG: '', CODEX_HOME: path.join(root, '.codex'), SUDO_USER: '' }),
      timeout: 90000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, new RegExp('agent behavior coordinator ' + mode + ' passed'));
  });
});
