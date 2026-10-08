// Per-user, per-project persistence for sidebar session folders. Multi-user
// installs store it on the user's own record; single-user installs use the
// daemon config. A user can only ever read or write their own entry.

var sessionFolders = require("./session-folders");

function validSlug(slug) {
  return typeof slug === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(slug);
}

function attachSessionFolderPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;

  function loadConfigState(slug) {
    try {
      var cfg = require("./config").loadConfig() || {};
      var all = cfg.sessionFolderPreferences;
      return all && typeof all === "object" && Object.prototype.hasOwnProperty.call(all, slug) ? all[slug] : null;
    } catch (e) {
      return null;
    }
  }

  function saveConfigState(slug, state) {
    try {
      var config = require("./config");
      var cfg = config.loadConfig() || {};
      var all = Object.assign({}, cfg.sessionFolderPreferences || {});
      all[slug] = state;
      config.saveConfig(Object.assign({}, cfg, { sessionFolderPreferences: all }));
      return { ok: true, state: state };
    } catch (e) {
      return { error: "Unable to save session folders" };
    }
  }

  function getSessionFolders(userId, slug) {
    if (!validSlug(slug)) return sessionFolders.defaultState();
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id !== userId) continue;
      var stored = data.users[i].sessionFolders;
      return sessionFolders.normalizeState(stored && typeof stored === "object" && Object.prototype.hasOwnProperty.call(stored, slug) ? stored[slug] : null);
    }
    if (userId === "default") return sessionFolders.normalizeState(loadConfigState(slug));
    return sessionFolders.defaultState();
  }

  function setSessionFolders(userId, slug, state) {
    if (!validSlug(slug)) return { error: "Invalid project" };
    var next = sessionFolders.normalizeState(state);
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id !== userId) continue;
      var all = data.users[i].sessionFolders && typeof data.users[i].sessionFolders === "object" ? data.users[i].sessionFolders : {};
      all[slug] = next;
      data.users[i].sessionFolders = all;
      saveUsers(data);
      return { ok: true, state: next };
    }
    if (userId === "default") return saveConfigState(slug, next);
    return { error: "User not found" };
  }

  return { getSessionFolders: getSessionFolders, setSessionFolders: setSessionFolders };
}

module.exports = { attachSessionFolderPreferences: attachSessionFolderPreferences };
