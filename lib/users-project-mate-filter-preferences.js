function attachProjectMateFilterPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;
  var configModule = deps.config || require("./config");

  function normalize(mode) {
    return mode === "projects" || mode === "mates" ? mode : "all";
  }

  function get(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) return normalize(data.users[i].projectMateFilterMode);
    }
    var current = configModule.loadConfig() || {};
    return normalize(current.projectMateFilterMode);
  }

  function set(userId, mode) {
    if (mode !== "all" && mode !== "projects" && mode !== "mates") {
      return { error: "Invalid project and Mate filter mode" };
    }
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].projectMateFilterMode = mode;
        saveUsers(data);
        return { ok: true, projectMateFilterMode: mode };
      }
    }
    var current = configModule.loadConfig() || {};
    configModule.saveConfig(Object.assign({}, current, { projectMateFilterMode: mode }));
    return { ok: true, projectMateFilterMode: mode };
  }

  return { get: get, set: set };
}

module.exports = { attachProjectMateFilterPreferences: attachProjectMateFilterPreferences };
