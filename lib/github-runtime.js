// Shared GitHub credential context for Personal settings and session work.
var crypto = require('crypto');
function environment(identity) {
  var env = Object.assign({}, identity ? require('./build-user-env').buildUserEnv(identity) : process.env, { GH_PROMPT_DISABLED: '1', GH_HOST: 'github.com' });
  if (identity) {
    ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME'].forEach(function (key) { delete env[key]; });
    env.HOME = identity.home; env.USER = identity.user; env.LOGNAME = identity.user;
  }
  return env;
}
function binding(identity) {
  var env = environment(identity);
  return crypto.createHash('sha256').update(JSON.stringify([identity || null, env.HOME, env.PATH, env.GH_CONFIG_DIR, env.XDG_CONFIG_HOME, env.GH_TOKEN, env.GITHUB_TOKEN])).digest('hex');
}
function overridden(identity) { var env = environment(identity); return !!(env.GH_TOKEN || env.GITHUB_TOKEN); }
function run(identity, args) {
  return new Promise(function (resolve, reject) {
    var opts = { cwd: environment(identity).HOME, env: environment(identity), timeout: 15000, maxBuffer: 16384, encoding: 'utf8' };
    if (identity) { opts.uid = identity.uid; opts.gid = identity.gid; }
    var wrapped = require('./os-users').wrapSpawnAsUser('gh', args, opts);
    var child = require('child_process').execFile(wrapped.command, wrapped.args, wrapped.options, function (error, stdout) {
      if (!error) return resolve(stdout);
      var failure = new Error('GitHub verification is unavailable.');
      failure.kind = error.code === 'ENOENT' || error.code === 127 && args[0] === '--version' ? 'missing' : error.code === 4 ? 'unauthenticated' : 'unknown';
      try { if (Number(JSON.parse(stdout).status) === 401) failure.kind = 'unauthenticated'; } catch (ignored) {}
      reject(failure);
    });
    child.stdin.on('error', function () {}); child.stdin.end();
  });
}
async function inspect(identity, execute) {
  execute = execute || run;
  var result = { status: 'unknown', overridden: overridden(identity), checkedAt: Date.now(), account: null };
  try { await execute(identity, ['--version']); }
  catch (error) { result.status = error.kind === 'missing' ? 'missing' : 'unknown'; return result; }
  try {
    var data = JSON.parse(await execute(identity, ['api', '--hostname', 'github.com', 'user', '--jq', '{id: .id, login: .login}']));
    if (!data || !Number.isSafeInteger(data.id) || data.id <= 0 || typeof data.login !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(data.login)) throw new Error('Invalid identity.');
    result.account = { id: data.id, login: data.login, host: 'github.com' }; result.status = 'authenticated';
  } catch (error) { result.status = error.kind === 'unauthenticated' ? 'unauthenticated' : 'unknown'; }
  result.checkedAt = Date.now(); return result;
}
module.exports = { environment: environment, binding: binding, overridden: overridden, inspect: inspect };
