// Fail closed on unmapped identities, aliases, foreign ownership or unacknowledged ACLs.
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var osUsers = require('./os-users');
function verify(projectPath, user, resolveIdentity) {
  if (!user || !user.linuxUser) throw new Error('A provisioned Linux account is required.');
  var identity = resolveIdentity(user.linuxUser), canonical = fs.realpathSync(projectPath), stat = fs.statSync(canonical);
  if (!Number.isInteger(identity.uid) || identity.uid < 0 || !Number.isInteger(identity.gid) || identity.gid < 0) throw new Error('Linux identity is unavailable.');
  if (canonical !== path.resolve(projectPath) || !stat.isDirectory() || stat.uid !== identity.uid) throw new Error('Registration requires a canonical directory owned by the mapped Linux account.');
  if (osUsers.grantProjectAccess(canonical, user.linuxUser, { force: true }) !== true) {
    var grantError = new Error('Linux filesystem access grant was not acknowledged.'); grantError.lifecycleResult = { persisted: false, retrySafe: true, filesystemAccess: 'grant_unconfirmed' }; throw grantError;
  }
  var script = "var fs = require('fs'); if (process.getuid() !== Number(process.argv[2]) || process.getgid() !== Number(process.argv[3])) throw new Error('Execution identity mismatch'); fs.accessSync(process.argv[1], fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK); fs.readdirSync(process.argv[1]);";
  var wrapped = osUsers.wrapSpawnAsUser(process.execPath, ['-e', script, canonical, String(identity.uid), String(identity.gid)], { uid: identity.uid, gid: identity.gid, stdio: 'pipe', timeout: 10000 });
  try { cp.execFileSync(wrapped.command, wrapped.args, wrapped.options); }
  catch (error) { error.lifecycleResult = { persisted: false, retrySafe: true, filesystemAccess: 'verification_failed' }; throw error; }
  var after = fs.statSync(canonical);
  if (after.dev !== stat.dev || after.ino !== stat.ino || after.uid !== identity.uid || fs.realpathSync(projectPath) !== canonical) throw new Error('The Linux project directory changed during access verification.');
  return true;
}
module.exports = { verify: verify };
