// Shared read-only OS evidence for startup repair and reviewed live recovery.
var fs = require('fs');
var path = require('path');
function inspectPrivateOwner(project, accounts, resolveIdentity) {
  var evidence = [], identities = [], root, stat;
  function result(code, ownerId) { return { code: code, ownerId: ownerId || null, evidence: evidence }; }
  try {
    root = fs.realpathSync(project.path); stat = fs.statSync(root);
    evidence.push([root, stat.dev, stat.ino, stat.uid, stat.mode]);
    if (!stat.isDirectory() || root !== path.resolve(project.path)) return result('project_path_unverified');
  } catch (error) { return result('project_unavailable'); }
  for (var account of accounts) {
    if (!account.linuxUser) continue;
    try {
      var identity = resolveIdentity(account.linuxUser);
      var home = fs.realpathSync(identity.home), homeStat = fs.statSync(home);
      evidence.push([account.id, account.linuxUser, identity.uid, home, homeStat.dev, homeStat.ino, homeStat.uid]);
      if (!Number.isInteger(identity.uid) || identity.uid < 0 || homeStat.uid !== identity.uid || home !== path.resolve(identity.home) || home === path.parse(home).root) continue;
      identities.push({ account: account, uid: identity.uid, home: home });
    } catch (error) { evidence.push([account.id, 'unresolved']); return result('identity_unresolved'); }
  }
  if (!identities.length) return result('mapping_unavailable');
  var matches = identities.filter(function (candidate) {
    var relative = path.relative(candidate.home, root);
    return candidate.uid === stat.uid && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  });
  if (!matches.length) return result('owner_not_verified');
  var unique = matches.filter(function (candidate) {
    return !identities.some(function (other) {
      if (other === candidate) return false;
      var relative = path.relative(other.home, root);
      return other.uid === candidate.uid || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
    });
  });
  return unique.length === 1 ? result('verified', unique[0].account.id) : result('ambiguous_mapping');
}
module.exports = { inspectPrivateOwner: inspectPrivateOwner };
