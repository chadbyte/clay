function attachPolicy(users) {
  function enabled() { return users.loadUsers().accountAuthMethod === 'password'; }
  function available() {
    if (!users.isMultiUser() || users.getSoloNoPinUser()) return false;
    var data = users.loadUsers();
    var config = require('./config').loadConfig();
    return !(data.users.length === 1 && config.pinHash && config.singleUserMigratedUserId === data.users[0].id);
  }
  function requiresPassword(user) { return !!user && enabled(); }
  function activate() {
    if (!available()) throw new Error('Account password policy does not apply to solo or Server PIN access.');
    var data = users.loadUsers();
    if (data.users.some(function (user) { return !user.pinHash && !user.passwordHash; })) {
      throw new Error('Some accounts have no account PIN. Set a temporary account PIN for them before enabling passwords.');
    }
    data.accountAuthMethod = 'password';
    users.saveUsers(data);
  }
  return { enabled: enabled, available: available, requiresPassword: requiresPassword, activate: activate };
}
module.exports = { attachPolicy: attachPolicy };
