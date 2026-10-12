// Server administration messages. Every mutation returns an acknowledgement.
var SETTINGS = {
  set_pin: { callback: 'onSetPin', field: 'pin', valid: function (value) { return value === null || typeof value === 'string' && /^\d{6}$/.test(value); }, timing: 'Applies to new sign-ins.' },
  set_keep_awake: { callback: 'onSetKeepAwake', field: 'value', timing: 'Applies while the daemon is running.' },
  set_inherit_groups: { callback: 'onSetInheritGroups', field: 'value', timing: 'Applies to newly spawned agent and terminal processes.' },
  set_image_retention: { callback: 'onSetImageRetention', field: 'days', valid: function (value) { return Number.isInteger(value) && value >= 0 && value <= 36500; }, timing: 'The next cleanup applies this period to existing images.' }
};
function handleServerSettings(ctx, ws, msg) {
  var entry = SETTINGS[msg.type];
  if (!entry) return false;
  function reply(data) { ctx.sendTo(ws, Object.assign({ type: msg.type + '_result' }, data)); }
  if (ctx.usersModule.isMultiUser()) {
    var id = ws._clayUser && ws._clayUser.id;
    var user = id && ctx.usersModule.findUserById(id);
    if (!user || user.role !== 'admin') { reply({ ok: false, error: 'Administrator access required.' }); return true; }
    if (msg.type === 'set_pin') { reply({ ok: false, error: 'Server PIN is unavailable while account authentication is enabled. Manage account credentials in Personal settings or Users.' }); return true; }
  }
  var value = msg[entry.field];
  if (entry.valid ? !entry.valid(value) : typeof value !== 'boolean') { reply({ ok: false, error: 'Invalid setting value.' }); return true; }
  var opts = ctx.opts;
  try {
    var config = opts.onGetDaemonConfig ? opts.onGetDaemonConfig() : {};
    if (msg.type === 'set_keep_awake' && config.platform !== 'darwin') throw new Error('Keep awake requires macOS.');
    if (msg.type === 'set_inherit_groups') throw new Error('Group inheritance is automatic in OS-user mode and is no longer configurable.');
    if (typeof opts[entry.callback] !== 'function') throw new Error('This runtime does not support saving this setting.');
    var result = opts[entry.callback](value);
    reply(Object.assign({}, result, { timing: entry.timing }));
    if (result.ok && msg.type === 'set_keep_awake') ctx.send({ type: 'keep_awake_changed', keepAwake: result.keepAwake });
  } catch (error) { reply({ ok: false, error: error.message || 'Could not save this setting.' }); }
  return true;
}
module.exports = { handleServerSettings: handleServerSettings };
