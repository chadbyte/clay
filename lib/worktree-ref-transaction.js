// Fixed prepared Git ref transaction; validation runs while Git owns the ref locks.
var spawn = require('child_process').spawn;
var wrap = require('./os-users').wrapSpawnAsUser;
function remove(root, input, os, validate) {
  return new Promise(function (resolve, reject) {
    var env = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' });
    if (os && os.home) env.HOME = os.home;
    if (os && os.user) { env.USER = os.user; env.LOGNAME = os.user; }
    var options = { cwd: root, env: env, stdio: ['pipe', 'pipe', 'pipe'] };
    if (os) { options.uid = os.uid; options.gid = os.gid; }
    var wrapped = wrap('git', ['update-ref', '--stdin'], options);
    var child = spawn(wrapped.command, wrapped.args, wrapped.options);
    var output = '', detail = '', failure = null, prepared = false, committed = false;
    var timer = setTimeout(function () { failure = new Error('Local branch transaction timed out; inspect the branch before recovery.'); child.kill('SIGTERM'); }, 15000);
    child.on('error', function (error) { failure = error; });
    child.stdin.on('error', function (error) { failure = failure || error; });
    child.stderr.on('data', function (chunk) { detail = (detail + chunk).slice(-4096); });
    child.stdout.on('data', function (chunk) {
      output = (output + chunk).slice(-4096);
      if (!prepared && output.indexOf('prepare: ok\n') >= 0) {
        prepared = true;
        if (failure) { child.stdin.end('abort\n'); return; }
        try { validate(); child.stdin.end('commit\n'); }
        catch (error) { failure = error; child.stdin.end('abort\n'); }
      }
      if (output.indexOf('commit: ok\n') >= 0) committed = true;
    });
    child.on('close', function (code) {
      clearTimeout(timer);
      if (failure || code !== 0 || !committed) reject(failure || new Error('Local branch transaction was not confirmed: ' + detail.trim()));
      else resolve(true);
    });
    child.stdin.write(input);
  });
}
module.exports = { remove: remove };
