var domains = { session: 'conversation', project: 'project', mate: 'Mate profile', knowledge: 'Mate Knowledge', records: 'project record', schedule: 'schedule', conversation: 'Mate conversation', workspace: 'workspace', screen: 'screen', assignment: 'Driver work', studio: 'Studio workbench' };
var actions = {
  force_stop: 'force terminate supported session and Worker runtimes and pause queued messages',
  rename: 'rename this conversation so it is easier to find', stop: 'request Stop so this work can settle',
  model: 'change the model for this conversation', effort: 'adjust reasoning effort for this conversation',
  permission: 'change the reviewed permission mode', delete: 'remove the reviewed item',
  fork: 'fork the conversation at the reviewed checkpoint', rewind: 'restore the reviewed conversation checkpoint',
  vendor: 'select the provider for this conversation', vendor_new_session: 'prepare a new conversation with the reviewed provider',
  runtime: 'return this conversation to GUI chat', queue_add: 'queue the reviewed message for the Driver',
  queue_edit: 'update the reviewed queued message', queue_cancel: 'cancel the reviewed queued message',
  queue_reorder: 'reorder the reviewed message queue', navigate: 'open the reviewed conversation so we can continue there',
  split_view: 'change the reviewed Split view',
  dismiss_notifications: 'dismiss the reviewed notifications', profile: 'update the reviewed Mate profile',
  send: 'deliver the reviewed message to this Mate', assign: 'prepare the requested Driver work for your review', follow_up: 'prepare a follow-up for the existing Driver', document: 'open the requested document for editing', sketch: 'present the requested sketch', browser: 'operate the requested shared browser tab'
};
export function activityCopy(msg) {
  var purpose = (['session', 'conversation', 'screen', 'mate', 'assignment', 'studio'].indexOf(msg.domain) >= 0 && Object.hasOwn(actions, msg.action) && actions[msg.action]) || 'apply the reviewed change to this ' + (domains[msg.domain] || 'item');
  var endings = { review: 'I’m waiting for your review before I ' + purpose + '.', running: 'I’m working to ' + purpose + '.',
    proposed: 'I saved the task proposal. Use Create task in Scheduled Tasks to create it; execution has not started.',
    persisted: 'I saved the reviewed change.', completed: 'The service finished the reviewed change.', queued: 'I queued the request. The work has not finished yet.',
    delivered: 'I sent the navigation request. I cannot yet confirm what is visible.', acknowledged: 'I started opening the conversation. Its visible result is still unconfirmed.',
    rendered: 'The reviewed conversation is visibly open in the selected window.',
    cancelled: 'I left the change unapplied.', failed: 'I could not finish this change. Please check the result before trying again.',
    partial: 'Part of this change took effect, but the operation failed. Please check the result.', unknown: 'I cannot confirm the outcome. Please check before trying again.' };
  if (msg.domain === 'screen' && msg.action === 'split_view' && msg.phase === 'acknowledged') return 'I started opening the reviewed Split view. Its visible result is still unconfirmed.';
  if (msg.domain === 'screen' && msg.action === 'split_view' && msg.phase === 'rendered') return 'The reviewed Split view and ready panes are visibly open in the selected window.';
  if (msg.domain === 'assignment') { var work = { review: 'I prepared the Driver work. Please review its proposal before it starts.', queued: 'I submitted the approved Driver work for dispatch.', running: 'The Driver is working on the approved request.', completed: 'The Driver finished this request.', cancelled: 'I left this Driver request unapplied.', unknown: 'I cannot confirm the Driver outcome. Please inspect the work before retrying.' }; return work[msg.phase] || endings[msg.phase] || null; }
  if (msg.domain === 'studio' && msg.phase === 'rendered') return 'The requested workbench content is visibly rendered in this window.';
  if (msg.domain === 'studio' && msg.phase === 'render_unknown') return 'The service returned, but I could not confirm that the workbench content is visible.';
  if (msg.domain === 'studio' && msg.phase === 'delivered') return 'I sent the requested content to the workbench. Its visible result is unconfirmed.';
  if (msg.domain === 'studio' && msg.phase === 'completed') return 'I finished the requested workbench operation.';
  return endings[msg.phase] || null;
}
export function validActivity(msg) {
  return msg && msg.version === 1 && typeof msg.id === 'string' && /^activity:[\w-]{36}$/.test(msg.id) &&
    typeof msg.sourceSessionOriginId === 'string' && !!msg.sourceSessionOriginId && typeof msg.sourceMateStamp === 'string' &&
    typeof msg.recipientViewerRef === 'string' && /^viewer:[\w-]{36}$/.test(msg.recipientViewerRef) && Number.isSafeInteger(msg.sourceQueryGeneration) &&
    Number.isSafeInteger(msg.order) && msg.order > 0 && Number.isSafeInteger(msg.sequence) && msg.sequence > 0 &&
    (msg.phase === 'clear' || Object.hasOwn(domains, msg.domain) && !!activityCopy(msg));
}
