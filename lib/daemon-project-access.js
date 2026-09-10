// Persisted Clay-level access rules for parent projects and exact worktrees.
// Filesystem and Git permissions are deliberately outside this module.

function parentSlugFor(slug) {
  if (typeof slug !== "string") return null;
  var marker = slug.indexOf("--");
  return marker > 0 ? slug.substring(0, marker) : null;
}

function findProject(config, slug) {
  var projects = config && Array.isArray(config.projects) ? config.projects : [];
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].slug === slug) return projects[i];
  }
  return null;
}

function uniqueUsers(values) {
  var source = Array.isArray(values) ? values : [];
  var seen = {};
  var out = [];
  for (var i = 0; i < source.length; i++) {
    if (typeof source[i] !== "string" || !source[i] || seen[source[i]]) continue;
    seen[source[i]] = true;
    out.push(source[i]);
  }
  return out;
}

function getProjectAccess(config, slug, osUsers) {
  var parentSlug = parentSlugFor(slug);
  var project = findProject(config, parentSlug || slug);
  if (!project) return { error: "Project not found" };

  var isMateProject = project.slug.indexOf("mate-") === 0;
  var visibility = isMateProject ? "private" : (project.visibility || (osUsers ? "private" : "public"));
  var parentAllowedUsers = uniqueUsers(project.allowedUsers);
  if (!parentSlug) {
    return {
      slug: slug,
      visibility: visibility,
      allowedUsers: parentAllowedUsers,
      ownerId: project.ownerId || null,
      isWorktree: false,
    };
  }

  var grants = project.worktreeAllowedUsers && project.worktreeAllowedUsers[slug];
  var worktreeAllowedUsers = uniqueUsers(grants);
  return {
    slug: slug,
    visibility: visibility,
    allowedUsers: uniqueUsers(parentAllowedUsers.concat(worktreeAllowedUsers)),
    ownerId: project.ownerId || null,
    isWorktree: true,
    parentSlug: parentSlug,
    parentAllowedUsers: parentAllowedUsers,
    worktreeAllowedUsers: worktreeAllowedUsers,
    parentAccess: {
      slug: parentSlug,
      visibility: visibility,
      allowedUsers: parentAllowedUsers,
      ownerId: project.ownerId || null,
    },
  };
}

function setAllowedUsers(config, slug, allowedUsers) {
  var parentSlug = parentSlugFor(slug);
  var project = findProject(config, parentSlug || slug);
  if (!project) return { error: "Project not found" };
  var clean = uniqueUsers(allowedUsers);
  if (!parentSlug) {
    project.allowedUsers = clean;
    return { ok: true, isWorktree: false, allowedUsers: clean };
  }

  if (!project.worktreeAllowedUsers || typeof project.worktreeAllowedUsers !== "object" || Array.isArray(project.worktreeAllowedUsers)) {
    project.worktreeAllowedUsers = {};
  }
  if (clean.length > 0) project.worktreeAllowedUsers[slug] = clean;
  else delete project.worktreeAllowedUsers[slug];
  if (Object.keys(project.worktreeAllowedUsers).length === 0) delete project.worktreeAllowedUsers;
  return { ok: true, isWorktree: true, allowedUsers: clean };
}

function clearWorktreeGrant(config, slug) {
  var parentSlug = parentSlugFor(slug);
  var project = parentSlug ? findProject(config, parentSlug) : null;
  if (!project || !project.worktreeAllowedUsers || !Object.prototype.hasOwnProperty.call(project.worktreeAllowedUsers, slug)) return false;
  delete project.worktreeAllowedUsers[slug];
  if (Object.keys(project.worktreeAllowedUsers).length === 0) delete project.worktreeAllowedUsers;
  return true;
}

function reconcileWorktreeGrants(config, parentSlug, existingSlugs) {
  var project = findProject(config, parentSlug);
  if (!project || !project.worktreeAllowedUsers) return false;
  var existing = {};
  for (var i = 0; i < existingSlugs.length; i++) existing[existingSlugs[i]] = true;
  var changed = false;
  var granted = Object.keys(project.worktreeAllowedUsers);
  for (var j = 0; j < granted.length; j++) {
    if (existing[granted[j]]) continue;
    delete project.worktreeAllowedUsers[granted[j]];
    changed = true;
  }
  if (Object.keys(project.worktreeAllowedUsers).length === 0) delete project.worktreeAllowedUsers;
  return changed;
}

module.exports = {
  parentSlugFor: parentSlugFor,
  getProjectAccess: getProjectAccess,
  setAllowedUsers: setAllowedUsers,
  clearWorktreeGrant: clearWorktreeGrant,
  reconcileWorktreeGrants: reconcileWorktreeGrants,
};
