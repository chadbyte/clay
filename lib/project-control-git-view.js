var fs = require('fs'), path = require('path');
var projection = require('./clay-control-target-projection');
function project(service, principal, status, manager) {
  var before = service.rootIdentity(principal, 'git');
  var directory = fs.realpathSync(status.gitDir), stat = fs.statSync(directory), indexPath = path.join(directory, 'index');
  var index = fs.existsSync(indexPath) ? require('crypto').createHash('sha256').update(fs.readFileSync(indexPath)).digest('hex') : null;
  var view = { runtimeId: projection.runtime(manager), repository: projection.digest([directory, [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid]]),
    files: status.files.slice(0, 200).map(function (file) { return { path: file.path, revision: projection.digest([status.oid, index, file]) }; }) };
  if (service.rootIdentity(principal, 'git') !== before) throw new Error('Workspace identity changed during projection.');
  return view;
}
module.exports = { project: project };
