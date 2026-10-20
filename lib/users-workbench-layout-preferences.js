// Account UI preferences are excluded from canonical Clay controls.
function validMode(mode) { return mode === 'overlay' || mode === 'docked'; }
function attachWorkbenchLayoutPreferences(deps) {
  var config = deps.configModule || require('./config');
  function context(accountId) {
    var data = deps.loadUsers();
    var user = data.users.find(function (entry) { return entry.id === accountId; });
    if (deps.isMultiUser() ? !user : accountId !== 'default') throw new Error('Account unavailable.');
    var settings = deps.isMultiUser() ? null : config.loadConfig() || {};
    return { data: data, user: user, settings: settings, saved: settings ? settings.workbenchLayoutPreference : user.workbenchLayoutPreference };
  }
  function value(accountId, saved) {
    if (saved === undefined) return { accountId: accountId, mode: 'overlay', revision: 0 };
    if (!saved || !validMode(saved.mode) || !Number.isSafeInteger(saved.revision) || saved.revision < 1) throw new Error('Invalid stored preference.');
    return { accountId: accountId, mode: saved.mode, revision: saved.revision };
  }
  function get(accountId) { return value(accountId, context(accountId).saved); }
  function set(accountId, mode, revision) {
    if (!validMode(mode) || !Number.isSafeInteger(revision) || revision < 0) return { status: 400, error: 'Invalid workbench layout.' };
    var current = context(accountId), prior = value(accountId, current.saved);
    if (prior.revision !== revision) return { status: 409, error: 'Workbench layout changed elsewhere. Reload the preference and try again.' };
    if (prior.mode === mode) return prior;
    if (revision === Number.MAX_SAFE_INTEGER) throw new Error('Preference revision exhausted.');
    var saved = { mode: mode, revision: revision + 1 };
    if (current.settings) config.saveConfig(Object.assign({}, current.settings, { workbenchLayoutPreference: saved }));
    else deps.saveUsers(Object.assign({}, current.data, { users: current.data.users.map(function (entry) {
      return entry === current.user ? Object.assign({}, entry, { workbenchLayoutPreference: saved }) : entry;
    }) }));
    return value(accountId, saved);
  }
  return { get: get, set: set };
}
module.exports = { attachWorkbenchLayoutPreferences: attachWorkbenchLayoutPreferences };
