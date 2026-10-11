// Persist before publishing a setting to live daemon state.
function saveDaemonSetting(config, key, value, saveConfig) {
  var overrides = {}; overrides[key] = value;
  var next = Object.assign({}, config, overrides);
  if (value === undefined) delete next[key];
  saveConfig(next);
  if (value === undefined) delete config[key];
  Object.assign(config, next);
  return next;
}
module.exports = { saveDaemonSetting: saveDaemonSetting };
