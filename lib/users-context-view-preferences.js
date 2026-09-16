// Durable user-scoped context display preference storage.

var PREFERENCE_KEY = "contextViewPreference";
var MODES = ["off", "mini", "panel"];

function validMode(value) {
  return MODES.indexOf(value) !== -1;
}

function attachContextViewPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;
  var isMultiUser = deps.isMultiUser || function () { return false; };
  var configModule = deps.configModule || require("./config");

  function findRecord(data, userId) {
    var records = Array.isArray(data.users) ? data.users : [];
    for (var i = 0; i < records.length; i++) if (records[i] && records[i].id === userId) return records[i];
    return null;
  }

  function result(value, source) {
    if (value === undefined) return { present: false, mode: "off", source: null };
    if (!validMode(value)) return { present: true, mode: "off", source: source, error: "Context display preference is invalid." };
    return { present: true, mode: value, source: source };
  }

  function get(userId) {
    var data;
    try { data = loadUsers(); } catch (error) { return { present: false, mode: "off", source: null, error: "Unable to read context display preference: " + (error.message || error) }; }
    var record = findRecord(data, userId);
    if (isMultiUser() && !record) return { present: false, mode: "off", source: null, error: "User not found." };
    if (record && Object.prototype.hasOwnProperty.call(record, PREFERENCE_KEY)) return result(record[PREFERENCE_KEY], "explicit");
    if (record) return { present: false, mode: "off", source: null };
    if (userId === "default") {
      var config;
      try { config = configModule.loadConfig() || {}; } catch (configError) { return { present: false, mode: "off", source: null, error: "Unable to read context display preference: " + (configError.message || configError) }; }
      if (Object.prototype.hasOwnProperty.call(config, PREFERENCE_KEY)) return result(config[PREFERENCE_KEY], "explicit");
    }
    return { present: false, mode: "off", source: null };
  }

  function set(userId, mode) {
    if (!validMode(mode)) return { ok: false, error: "Context display preference is invalid." };
    var data;
    try { data = loadUsers(); } catch (error) { return { ok: false, error: "Unable to read context display preference: " + (error.message || error) }; }
    var record = findRecord(data, userId);
    if (isMultiUser() && !record) return { ok: false, error: "User not found." };
    if (record) {
      var nextData = Object.assign({}, data, { users: (data.users || []).map(function (item) { return item === record ? Object.assign({}, item, { contextViewPreference: mode }) : item; }) });
      try { saveUsers(nextData); } catch (saveError) { return { ok: false, error: "Unable to save context display preference: " + (saveError.message || saveError) }; }
      return { ok: true, mode: mode };
    }
    if (userId !== "default") return { ok: false, error: "User not found." };
    try {
      var current = configModule.loadConfig() || {};
      configModule.saveConfig(Object.assign({}, current, { contextViewPreference: mode }));
      return { ok: true, mode: mode };
    } catch (configSaveError) { return { ok: false, error: "Unable to save context display preference: " + (configSaveError.message || configSaveError) }; }
  }

  return { get: get, set: set, validMode: validMode, MODES: MODES };
}

module.exports = { attachContextViewPreferences: attachContextViewPreferences, validMode: validMode, MODES: MODES, PREFERENCE_KEY: PREFERENCE_KEY };
