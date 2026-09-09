// --- Per-user RBAC permissions (default values for regular users) ---
var DEFAULT_PERMISSIONS = {
  terminal: false,
  fileBrowser: true,
  createProject: true,
  deleteProject: false,
  skills: true,
  sessionDelete: false,
  scheduledTasks: false,
  projectSettings: false,
};

var ALL_PERMISSIONS = {
  terminal: true,
  fileBrowser: true,
  createProject: true,
  deleteProject: true,
  skills: true,
  sessionDelete: true,
  scheduledTasks: true,
  projectSettings: true,
};

function attachPermissions(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;
  var findUserById = deps.findUserById;

  function getEffectivePermissions(user, osUsersMode) {
    // OS-mode users with linuxUser are exempt from RBAC (OS handles isolation)
    if (osUsersMode && user && user.linuxUser) return ALL_PERMISSIONS;
    // Admin always has full permissions
    if (user && user.role === "admin") return ALL_PERMISSIONS;
    // Merge stored permissions with defaults (handles missing keys for forward-compat)
    var stored = (user && user.permissions) || {};
    var result = {};
    var keys = Object.keys(DEFAULT_PERMISSIONS);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      result[k] = stored[k] !== undefined ? stored[k] : DEFAULT_PERMISSIONS[k];
    }
    return result;
  }

  function updateUserPermissions(userId, permissions) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        // Validate: only allow known permission keys with boolean values
        var clean = {};
        var keys = Object.keys(DEFAULT_PERMISSIONS);
        for (var j = 0; j < keys.length; j++) {
          var k = keys[j];
          clean[k] = permissions[k] === true;
        }
        data.users[i].permissions = clean;
        saveUsers(data);
        return { ok: true, permissions: clean };
      }
    }
    return { error: "User not found" };
  }

  // --- Project access helpers ---

  function canAccessProject(userId, project) {
    if (!project) return false;
    // Public projects are accessible to all authenticated users
    if (!project.visibility || project.visibility === "public") return true;
    // Admin always has access
    var user = findUserById(userId);
    if (user && user.role === "admin") return true;
    // Owner always has access to their own project
    if (project.ownerId && project.ownerId === userId) return true;
    // Private project -- check allowedUsers
    var allowed = project.allowedUsers || [];
    return allowed.indexOf(userId) >= 0;
  }

  function getAccessibleProjects(userId, projects) {
    if (!projects) return [];
    return projects.filter(function (p) {
      return canAccessProject(userId, p);
    });
  }

  // --- Session visibility helpers ---

  function canAccessSession(userId, session, project) {
    // Must have project access first
    if (!canAccessProject(userId, project)) return false;
    // Resolve the stored user record so client-supplied roles cannot elevate access.
    var user = findUserById(userId);
    if (user && user.role === "admin") return true;
    // Sessions without ownerId are legacy -- only admin can see them
    if (!session.ownerId) return false;
    // Owner can always see their own sessions
    if (session.ownerId === userId) return true;
    // Sharing is opt-in; missing or invalid visibility stays private.
    if (session.sessionVisibility === "shared") return true;
    // Private sessions are only visible to the owner
    return false;
  }

  return {
    getEffectivePermissions: getEffectivePermissions,
    updateUserPermissions: updateUserPermissions,
    canAccessProject: canAccessProject,
    getAccessibleProjects: getAccessibleProjects,
    canAccessSession: canAccessSession,
  };
}

module.exports = {
  DEFAULT_PERMISSIONS: DEFAULT_PERMISSIONS,
  ALL_PERMISSIONS: ALL_PERMISSIONS,
  attachPermissions: attachPermissions,
};
