// Per-user persistence for durable Home conversation selections.

function attachHomeSurfacePreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;

  function defaults() {
    return { surface: null, projectSlug: null, activeMateId: null, activeSessionByMate: {}, sidebarCollapsed: false, matesCollapsed: false, chatScope: "all", subSurface: "chat" };
  }

  function validId(value) {
    return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
  }

  function validSessionReference(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value);
  }

  function validProjectSlug(value) {
    return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,127}$/.test(value);
  }

  function normalize(value) {
    var source = value && typeof value === "object" ? value : {};
    var sessions = source.activeSessionByMate && typeof source.activeSessionByMate === "object" && !Array.isArray(source.activeSessionByMate)
      ? source.activeSessionByMate
      : {};
    var normalizedSessions = {};
    var mateIds = Object.keys(sessions);
    for (var i = 0; i < mateIds.length; i++) {
      if (!validId(mateIds[i]) || !validSessionReference(sessions[mateIds[i]])) continue;
      normalizedSessions[mateIds[i]] = sessions[mateIds[i]];
    }
    return {
      surface: source.surface === "home" || source.surface === "project" ? source.surface : null,
      projectSlug: validProjectSlug(source.projectSlug) ? source.projectSlug : null,
      activeMateId: validId(source.activeMateId) ? source.activeMateId : null,
      activeSessionByMate: normalizedSessions,
      sidebarCollapsed: source.sidebarCollapsed === true,
      matesCollapsed: source.matesCollapsed === true,
      chatScope: source.chatScope === "current" ? "current" : "all",
      subSurface: source.subSurface === "debates" ? "debates" : "chat",
    };
  }

  function loadSingleUserPreference() {
    try {
      var config = require("./config");
      var current = config.loadConfig() || {};
      return normalize(current.homeSurfacePreference);
    } catch (e) {
      return defaults();
    }
  }

  function saveSingleUserPreference(preference) {
    try {
      var config = require("./config");
      var current = config.loadConfig() || {};
      config.saveConfig(Object.assign({}, current, { homeSurfacePreference: preference }));
      return { ok: true, preference: preference };
    } catch (e) {
      return { error: "Unable to save Home surface preference" };
    }
  }

  function getHomeSurfacePreference(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) return normalize(data.users[i].homeSurfacePreference);
    }
    if (userId === "default") return loadSingleUserPreference();
    return defaults();
  }

  function setHomeSurfacePreference(userId, patch) {
    var current = getHomeSurfacePreference(userId);
    var merged = Object.assign({}, current, patch || {});
    if (patch && patch.activeSessionByMate && typeof patch.activeSessionByMate === "object") {
      merged.activeSessionByMate = Object.assign({}, current.activeSessionByMate, patch.activeSessionByMate);
    }
    var next = normalize(merged);
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id !== userId) continue;
      data.users[i].homeSurfacePreference = next;
      saveUsers(data);
      return { ok: true, preference: next };
    }
    if (userId === "default") return saveSingleUserPreference(next);
    return { error: "User not found" };
  }

  return {
    getHomeSurfacePreference: getHomeSurfacePreference,
    setHomeSurfacePreference: setHomeSurfacePreference,
  };
}

module.exports = { attachHomeSurfacePreferences: attachHomeSurfacePreferences };
