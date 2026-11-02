// Metadata only. GitHub CLI owns credentials; Clay Studio never reads its stores.
var fs = require('fs'), path = require('path'), crypto = require('crypto');
function attach(root) {
  var directory = path.join(root, 'github-connections');
  function file(owner) {
    if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new Error('Invalid connection owner.');
    return path.join(directory, owner + '.json');
  }
  function read(owner) {
    try { return JSON.parse(fs.readFileSync(file(owner), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { revision: null, connection: null }; throw new Error('Could not read GitHub connection.'); }
  }
  function reserve(key) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    var target = path.join(directory, 'runtime-' + crypto.createHash('sha256').update(key).digest('hex') + '.lock');
    var fd;
    try { fd = fs.openSync(target, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ startedAt: Date.now(), pid: process.pid })); }
    catch (error) { throw new Error('A GitHub login is already running or its outcome needs operator inspection. No login was retried.'); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    return function () { fs.unlinkSync(target); };
  }
  function save(owner, revision, connection) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    var target = file(owner), fd, temp;
    try {
      fd = fs.openSync(target + '.lock', 'wx', 0o600);
      if (read(owner).revision !== revision) throw new Error('GitHub connection changed. Refresh before confirming again.');
      var next = { revision: crypto.randomUUID(), connection: connection };
      temp = target + '.' + crypto.randomUUID() + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600 }); fs.renameSync(temp, target);
      return next;
    } finally {
      if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
      if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(target + '.lock'); }
    }
  }
  return { read: read, save: save, reserve: reserve };
}
module.exports = { attach: attach };
