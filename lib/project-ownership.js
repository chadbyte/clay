// Ownership recovery changes project metadata only; session owners stay intact.

function isPersonal(project) {
  return project.isMate === true || /^mate-/.test(project.slug || "");
}

function verifiedPrivateOwner(project, accounts, resolveIdentity) {
  return require('./project-ownership-diagnostics').inspectPrivateOwner(project, accounts, resolveIdentity).ownerId;
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
