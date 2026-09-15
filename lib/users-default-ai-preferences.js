// Durable user-scoped Default AI preference storage.

var PREFERENCE_KEY = "defaultAiPreference";
var LEGACY_KEY = "scheduledTaskInterviewEngine";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function validatePreference(value) {
  if (!isPlainObject(value)) return { ok: false, error: "Default AI preference must be an object." };
  if (!validText(value.vendor, 40) || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(value.vendor)) return { ok: false, error: "Default AI vendor is invalid." };
  if (value.model !== undefined && (!validText(value.model, 200) || (value.model !== "" && (value.model.trim() !== value.model || value.model.trim() === "")))) return { ok: false, error: "Default AI model is invalid." };
  if (value.effort !== undefined && (!validText(value.effort, 40) || (value.effort !== "" && (value.effort.trim() !== value.effort || !/^[a-zA-Z0-9_-]{1,40}$/.test(value.effort))))) return { ok: false, error: "Default AI effort is invalid." };
  return { ok: true, preference: { vendor: value.vendor, model: value.model === undefined ? "" : value.model, effort: value.effort === undefined ? "" : value.effort } };
}

function attachDefaultAiPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;
  var isMultiUser = deps.isMultiUser || function () { return false; };
  var configModule = deps.configModule || require("./config");

  function userRecord(data, userId) {
    var users = Array.isArray(data.users) ? data.users : [];
    for (var i = 0; i < users.length; i++) if (users[i] && users[i].id === userId) return users[i];
    return null;
  }

  function readValue(value, source) {
    if (value === undefined) return { present: false, preference: null, source: null };
    var checked = validatePreference(value);
    if (!checked.ok) return { present: true, preference: null, source: source, error: checked.error };
    return { present: true, preference: checked.preference, source: source };
  }

  function getDefaultAiPreference(userId) {
    var data;
    try { data = loadUsers(); } catch (error) { return { present: false, preference: null, source: null, error: "Unable to read Default AI preference: " + (error.message || error) }; }
    var record = userRecord(data, userId);
    if (isMultiUser() && !record) return { present: false, preference: null, source: null, error: "User not found." };
    if (record && Object.prototype.hasOwnProperty.call(record, PREFERENCE_KEY)) return readValue(record[PREFERENCE_KEY], "explicit");
    if (record && Object.prototype.hasOwnProperty.call(record, LEGACY_KEY)) return readValue(record[LEGACY_KEY], "legacy");
    if (userId === "default") {
      var config;
      try { config = configModule.loadConfig() || {}; } catch (configError) { return { present: false, preference: null, source: null, error: "Unable to read Default AI preference: " + (configError.message || configError) }; }
      if (Object.prototype.hasOwnProperty.call(config, PREFERENCE_KEY)) return readValue(config[PREFERENCE_KEY], "explicit");
      if (Object.prototype.hasOwnProperty.call(config, LEGACY_KEY)) return readValue(config[LEGACY_KEY], "legacy");
    }
    return { present: false, preference: null, source: null };
  }

  function setDefaultAiPreference(userId, value) {
    var checked = validatePreference(value);
    if (!checked.ok) return { ok: false, error: checked.error };
    var data;
    try { data = loadUsers(); } catch (error3) { return { ok: false, error: "Unable to read Default AI preference: " + (error3.message || error3) }; }
    var record = userRecord(data, userId);
    if (isMultiUser() && !record) return { ok: false, error: "User not found." };
    if (record) {
      var nextData = Object.assign({}, data, { users: (data.users || []).map(function (item) { return item === record ? Object.assign({}, item, { defaultAiPreference: checked.preference }) : item; }) });
      try { saveUsers(nextData); } catch (error) { return { ok: false, error: "Unable to save Default AI preference: " + (error.message || error) }; }
      return { ok: true, preference: checked.preference };
    }
    if (userId !== "default") return { ok: false, error: "User not found." };
    try {
      var current = configModule.loadConfig() || {};
      configModule.saveConfig(Object.assign({}, current, { defaultAiPreference: checked.preference }));
      return { ok: true, preference: checked.preference };
    } catch (error2) { return { ok: false, error: "Unable to save Default AI preference: " + (error2.message || error2) }; }
  }

  return { getDefaultAiPreference: getDefaultAiPreference, setDefaultAiPreference: setDefaultAiPreference, validatePreference: validatePreference };
}

module.exports = { attachDefaultAiPreferences: attachDefaultAiPreferences, validatePreference: validatePreference, PREFERENCE_KEY: PREFERENCE_KEY };
