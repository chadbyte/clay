var windowLayouts = require('./workbench-window-layout');
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
    if (saved.layouts && !windowLayouts.validLayouts(saved.layouts)) throw new Error('Invalid stored window layout.');
    return Object.assign({ accountId: accountId, mode: saved.mode, revision: saved.revision }, saved.layouts ? { layouts: saved.layouts } : {});
  }
  function get(accountId) { return value(accountId, context(accountId).saved); }
  function set(accountId, mode, revision, layout) {
    if (layout !== undefined && !windowLayouts.validLayout(layout)) return { status: 400, error: 'Invalid window layout.' };
    if (!validMode(mode) || !Number.isSafeInteger(revision) || revision < 0) return { status: 400, error: 'Invalid workbench layout.' };
    var current = context(accountId), prior = value(accountId, current.saved);
    if (prior.revision !== revision) return { status: 409, error: 'Workbench layout changed elsewhere. Reload the preference and try again.' };
    var layouts = Object.assign({}, prior.layouts || {});
    var changed = layout && JSON.stringify(layouts[layout.key]) !== JSON.stringify({ base: layout.base, tree: layout.tree });
    if (prior.mode === mode && !changed) return prior;
    if (layout) {
      delete layouts[layout.key];
      if (Object.keys(layouts).length >= 32) delete layouts[Object.keys(layouts)[0]];
      layouts[layout.key] = { base: layout.base, tree: layout.tree };
    }
    if (revision === Number.MAX_SAFE_INTEGER) throw new Error('Preference revision exhausted.');
    var saved = Object.assign({ mode: mode, revision: revision + 1 }, Object.keys(layouts).length ? { layouts: layouts } : {});
    if (current.settings) config.saveConfig(Object.assign({}, current.settings, { workbenchLayoutPreference: saved }));
    else deps.saveUsers(Object.assign({}, current.data, { users: current.data.users.map(function (entry) {
      return entry === current.user ? Object.assign({}, entry, { workbenchLayoutPreference: saved }) : entry;
    }) }));
    return value(accountId, saved);
  }
  return { get: get, set: set };
}
module.exports = { attachWorkbenchLayoutPreferences: attachWorkbenchLayoutPreferences };
