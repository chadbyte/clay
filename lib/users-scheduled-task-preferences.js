function attachScheduledTaskPreferences(deps) {
  function normalize(value) {
    value = value && typeof value === "object" ? value : {};
    return {
      vendor: typeof value.vendor === "string" ? value.vendor.substring(0, 40) : "",
      model: typeof value.model === "string" ? value.model.substring(0, 200) : "",
      effort: typeof value.effort === "string" ? value.effort.substring(0, 40) : "",
    };
  }
  function single(load) {
    try {
      var config = deps.configModule || require("./config");
      var current = config.loadConfig() || {};
      if (load) return normalize(current.scheduledTaskInterviewEngine);
      return { config: config, current: current };
    } catch (e) { return load ? normalize(null) : null; }
  }
  function get(userId) {
    var data = deps.loadUsers();
    for (var i = 0; i < data.users.length; i++) if (data.users[i].id === userId) return normalize(data.users[i].scheduledTaskInterviewEngine);
    return userId === "default" ? single(true) : normalize(null);
  }
  function set(userId, value) {
    var next = normalize(value);
    try {
      var data = deps.loadUsers();
      for (var i = 0; i < data.users.length; i++) {
        if (data.users[i].id !== userId) continue;
        data.users[i].scheduledTaskInterviewEngine = next; deps.saveUsers(data); return { ok: true, preference: next };
      }
      if (userId === "default") {
        var target = single(false);
        if (!target) return { error: "Unable to save interview engine preference" };
        target.config.saveConfig(Object.assign({}, target.current, { scheduledTaskInterviewEngine: next }));
        return { ok: true, preference: next };
      }
      return { error: "User not found" };
    } catch (error) {
      return { error: "Unable to save interview engine preference: " + (error.message || error) };
    }
  }
  return { get: get, set: set };
}
module.exports = { attachScheduledTaskPreferences: attachScheduledTaskPreferences };
