// Ownership recovery changes project metadata only; session owners stay intact.
var fs = require("fs");
var path = require("path");

function isPersonal(project) {
  return project.isMate === true || /^mate-/.test(project.slug || "");
}

function verifiedPrivateOwner(project, accounts, resolveIdentity) {
  var root;
  var stat;
  try {
    root = fs.realpathSync(project.path);
    if (root !== path.resolve(project.path)) return null;
    stat = fs.statSync(root);
  } catch (e) { return null; }
  var matches = [];
  var identities = [];
  for (var i = 0; i < accounts.length; i++) {
    var account = accounts[i];
    if (!account.linuxUser) continue;
    try {
      var identity = resolveIdentity(account.linuxUser);
      var home = fs.realpathSync(identity.home);
      if (!Number.isInteger(identity.uid) || identity.uid < 0 || fs.statSync(home).uid !== identity.uid || home !== path.resolve(identity.home) || home === path.parse(home).root) continue;
      identities.push({ account: account, uid: identity.uid, home: home });
    } catch (e) { return null; }
  }
  for (var j = 0; j < identities.length; j++) {
    var candidate = identities[j];
    var relative = path.relative(candidate.home, root);
    if (candidate.uid !== stat.uid || relative === ".." || relative.indexOf(".." + path.sep) === 0 || path.isAbsolute(relative)) continue;
    // A shared UID or overlapping home is never authoritative evidence.
    var ambiguous = identities.some(function (other) {
      if (other === candidate) return false;
      var overlap = path.relative(other.home, root);
      return other.uid === candidate.uid || (!path.isAbsolute(overlap) && overlap !== ".." && overlap.indexOf(".." + path.sep) !== 0);
    });
    if (!ambiguous) matches.push(candidate.account.id);
  }
  return matches.length === 1 ? matches[0] : null;
}

function repair(config, accounts, persist, resolveIdentity) {
  var next = JSON.parse(JSON.stringify(config));
  var valid = Object.create(null);
  accounts.forEach(function (user) { if (typeof user.id === "string" && user.id) valid[user.id] = user; });
  if (!accounts.length) return config; // Pre-account setup is repaired after bootstrap.
  var admins = accounts.filter(function (user) { return user.role === "admin" && valid[user.id]; }).sort(function (a, b) { return a.id.localeCompare(b.id); });
  var preferred = next.ownershipRecoveryAdminId || next.singleUserMigratedUserId;
  var designated = valid[preferred] && valid[preferred].role === "admin" ? preferred : (admins[0] && admins[0].id);
  if (designated) next.ownershipRecoveryAdminId = designated;
  (next.projects || []).forEach(function (project) {
    if (isPersonal(project) || project.slug.indexOf("--") !== -1) return;
    if (valid[project.ownerId]) { delete project.ownershipRecovery; return; }
    var visibility = project.visibility || (next.osUsers ? "private" : "public");
    var recovered = visibility === "public" ? designated : verifiedPrivateOwner(project, accounts, resolveIdentity);
    if (recovered) {
      project.ownerId = recovered;
      delete project.ownershipRecovery;
    } else project.ownershipRecovery = "required";
  });
  if (JSON.stringify(next) === JSON.stringify(config)) return config;
  persist(next); // Publish only after atomic persistence succeeds; failures abort boot.
  return next;
}

function register(config, project, accounts, persist, resolveIdentity) {
  var next = JSON.parse(JSON.stringify(config));
  if (!next.projects) next.projects = [];
  next.projects.push(project);
  next = repair(next, accounts, function () {}, resolveIdentity);
  persist(next);
  return next;
}

module.exports = { repair: repair, register: register, verifiedPrivateOwner: verifiedPrivateOwner, isPersonal: isPersonal };
