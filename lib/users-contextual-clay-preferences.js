// Personal geometry is never a canonical product-control operation.
function validGeometry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  var keys = Object.keys(value);
  if (keys.length !== 4 || keys.some(function (key) { return ['left', 'top', 'width', 'height'].indexOf(key) < 0; })) return false;
  return keys.every(function (key) { return typeof value[key] === 'number' && Number.isFinite(value[key]); }) &&
    value.left >= 0 && value.left <= 16384 && value.top >= 0 && value.top <= 16384 &&
    value.width >= 340 && value.width <= 2560 && value.height >= 360 && value.height <= 2160;
}
function attachContextualClayPreferences(deps) {
  function get(userId) {
    var user = deps.loadUsers().users.find(function (entry) { return entry.id === userId; });
    var saved = user && user.contextualClayGeometry;
    if (!user && userId === 'default') saved = require('./config').loadConfig().contextualClayGeometry;
    return validGeometry(saved) ? Object.assign({}, saved) : null;
  }
  function set(userId, geometry) {
    if (!validGeometry(geometry)) return { error: 'Invalid popover geometry.' };
    var value = Object.assign({}, geometry);
    var data = deps.loadUsers();
    var user = data.users.find(function (entry) { return entry.id === userId; });
    if (user) { user.contextualClayGeometry = value; deps.saveUsers(data); }
    else if (userId === 'default') {
      var config = require('./config');
      config.saveConfig(Object.assign({}, config.loadConfig(), { contextualClayGeometry: value }));
    } else return { error: 'Account no longer available.' };
    return { geometry: value };
  }
  return { getContextualClayGeometry: get, setContextualClayGeometry: set };
}
module.exports = { attachContextualClayPreferences: attachContextualClayPreferences, validGeometry: validGeometry };
