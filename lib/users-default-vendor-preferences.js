// Durable user-scoped New session vendor preference storage.

var PREFERENCE_KEY = "defaultVendorPreference";

function validVendor(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value);
}

function attachDefaultVendorPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;
  var isMultiUser = deps.isMultiUser || function () { return false; };
  var configModule = deps.configModule || require("./config");

  function getRecord(data, userId) {
    var records = Array.isArray(data.users) ? data.users : [];
    for (var i = 0; i < records.length; i++) if (records[i] && records[i].id === userId) return records[i];
    return null;
  }

  function readValue(value, source) {
    if (value === undefined || value === null || value === "") return { present: false, vendor: null, source: null };
    if (!validVendor(value)) return { present: true, vendor: null, source: source, error: "Default coding vendor is invalid." };
    return { present: true, vendor: value, source: source };
  }

  function getDefaultVendor(userId) {
    var data;
    try { data = loadUsers(); } catch (error) { return { present: false, vendor: null, source: null, error: "Unable to read default coding vendor: " + (error.message || error) }; }
    var record = getRecord(data, userId);
    if (isMultiUser() && !record) return { present: false, vendor: null, source: null, error: "User not found." };
    if (record && Object.prototype.hasOwnProperty.call(record, PREFERENCE_KEY)) return readValue(record[PREFERENCE_KEY], "explicit");
    if (record) return { present: false, vendor: null, source: null };
    if (userId === "default") {
      var config;
      try { config = configModule.loadConfig() || {}; } catch (configError) { return { present: false, vendor: null, source: null, error: "Unable to read default coding vendor: " + (configError.message || configError) }; }
      if (Object.prototype.hasOwnProperty.call(config, PREFERENCE_KEY)) return readValue(config[PREFERENCE_KEY], "explicit");
    }
    return { present: false, vendor: null, source: null };
  }

  function setDefaultVendor(userId, vendor) {
    if (vendor !== "" && !validVendor(vendor)) return { ok: false, error: "Default coding vendor is invalid." };
    var data;
    try { data = loadUsers(); } catch (error) { return { ok: false, error: "Unable to read default coding vendor: " + (error.message || error) }; }
    var record = getRecord(data, userId);
    if (isMultiUser() && !record) return { ok: false, error: "User not found." };
    if (record) {
      var nextData = Object.assign({}, data, { users: (data.users || []).map(function (item) {
        if (item !== record) return item;
        var next = Object.assign({}, item);
        if (vendor) next.defaultVendorPreference = vendor;
        else delete next.defaultVendorPreference;
        return next;
      }) });
      try { saveUsers(nextData); } catch (saveError) { return { ok: false, error: "Unable to save default coding vendor: " + (saveError.message || saveError) }; }
      if (!vendor && userId === "default") {
        try {
          var recordConfig = configModule.loadConfig() || {};
          delete recordConfig[PREFERENCE_KEY];
          configModule.saveConfig(Object.assign({}, recordConfig));
        } catch (recordConfigError) { return { ok: false, error: "Unable to clear default coding vendor: " + (recordConfigError.message || recordConfigError) }; }
      }
      return { ok: true, vendor: vendor };
    }
    if (userId !== "default") return { ok: false, error: "User not found." };
    try {
      var current = configModule.loadConfig() || {};
      var nextConfig = Object.assign({}, current);
      if (vendor) nextConfig.defaultVendorPreference = vendor;
      else delete nextConfig.defaultVendorPreference;
      configModule.saveConfig(nextConfig);
      return { ok: true, vendor: vendor };
    } catch (configSaveError) { return { ok: false, error: "Unable to save default coding vendor: " + (configSaveError.message || configSaveError) }; }
  }

  return { getDefaultVendor: getDefaultVendor, setDefaultVendor: setDefaultVendor, validVendor: validVendor };
}

module.exports = { attachDefaultVendorPreferences: attachDefaultVendorPreferences, validVendor: validVendor, PREFERENCE_KEY: PREFERENCE_KEY };
