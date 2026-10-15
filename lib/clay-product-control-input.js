var ACTIONS = ['rename', 'stop', 'model', 'effort', 'permission', 'delete', 'fork', 'rewind', 'vendor', 'vendor_new_session', 'runtime', 'queue_add', 'queue_edit', 'queue_cancel', 'queue_reorder'];
var KEYS = ['targetToken', 'action', 'value', 'why', 'requestId', 'text', 'messageId', 'ids'];
function string(value, max) { return typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function messageId(value) { return typeof value === 'string' && /^pm_[1-9][0-9]{0,15}$/.test(value); }
function validate(args) {
  if (!args || Object.keys(args).some(function (key) { return KEYS.indexOf(key) < 0; }) || ACTIONS.indexOf(args.action) < 0 || !string(args.targetToken, 100) || !string(args.why, 1000) || !string(args.requestId, 128)) throw new Error('Use a typed allowlisted action, exact targetToken, why and requestId. Model confirmation flags cannot authorize changes.');
  var allowed = ['targetToken', 'action', 'why', 'requestId'];
  if (['rename', 'model', 'effort', 'permission', 'fork', 'rewind', 'vendor', 'vendor_new_session', 'runtime'].indexOf(args.action) >= 0) {
    allowed.push('value');
    if (!string(args.value, args.action === 'rename' ? 100 : 200)) throw new Error('Invalid action value.');
  }
  if (args.action === 'queue_add' || args.action === 'queue_edit') {
    allowed.push('text');
    if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 1200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(args.text)) throw new Error('Queue text must contain 1–1200 characters without control codes.');
  }
  if (args.action === 'queue_edit' || args.action === 'queue_cancel') { allowed.push('messageId'); if (!messageId(args.messageId)) throw new Error('Choose an exact messageId from queue inspection.'); }
  if (args.action === 'queue_reorder') {
    allowed.push('ids');
    if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 100 || args.ids.some(function (id, i) { return !messageId(id) || args.ids.indexOf(id) !== i; })) throw new Error('Provide every owned pending message ID once in the desired order.');
  }
  if (Object.keys(args).some(function (key) { return allowed.indexOf(key) < 0; })) throw new Error('Fields do not match the selected action.');
}
function description(args) {
  if (args.action === 'vendor_new_session') return 'Create a new private GUI session using provider ' + args.value + '. The original conversation and its provider thread remain unchanged. No history is migrated and no model execution is started.';
  if (args.action === 'runtime') return 'Return this legacy terminal session to GUI chat: ' + args.value + '. Wait for confirmed terminal shutdown, retain the same provider thread, and start no execution. New terminal presentation is unavailable.';
  var labels = { rename: 'Rename this conversation to ', model: "Change this conversation's model to ", effort: 'Change reasoning effort to ', permission: 'Change the permission mode to ', delete: 'Permanently delete this Driver and its owned Worker history', fork: 'Fork this conversation at checkpoint ', rewind: 'Rewind conversation history to checkpoint ', vendor: 'Select the provider for this fresh GUI Driver: ' };
  if (args.action === 'queue_add') return 'Queue this exact message for the project Driver. It may run immediately when idle; it will not resume a stopped Driver.\nMessage:\n' + args.text;
  if (args.action === 'queue_edit') return 'Replace the text of queued message ' + args.messageId + '. Existing attachments are preserved.\nNew message:\n' + args.text;
  if (args.action === 'queue_cancel') return 'Cancel queued message ' + args.messageId + '. Already delivered work is not undone.';
  if (args.action === 'queue_reorder') return 'Reorder owned pending messages into this exact order:\n' + args.ids.join(', ');
  return labels[args.action] + (args.value || '');
}
module.exports = { ACTIONS: ACTIONS, KEYS: KEYS, validate: validate, description: description };
