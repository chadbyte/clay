// Exact Clay catalogs: project-user-knowledge, session-notes/project-logs/issues-mcp-server,
// session-pair-mcp-server, mate-scheduling and the query-bound SDK bridge catalogs.
var definitions = Object.create(null);
var aliases = Object.create(null);

function register(server, name, running, completed, noun, subject, rule) {
  definitions[name] = { name: name, running: running, completed: completed, noun: noun, subject: subject, rule: rule };
  [name, server + '__' + name, 'mcp__' + server + '__' + name,
    'mcp__clay-session-tools__' + server + '__' + name].forEach(function (alias) { aliases[alias] = name; });
}
function rows(server, entries) {
  entries.forEach(function (entry) { register.apply(null, [server].concat(entry)); });
}
rows('clay-you', [
  ['search_user_knowledge', 'Checking your preferences', 'Preferences checked', 'Preference search', 'query'],
  ['read_user_knowledge', 'Reading your preference', 'Preference read', 'Preference'],
  ['report_user_observation', 'Submitting preference for review', 'Preference submitted for review', 'Preference submission', null, 'observation'],
  ['list_user_observations', 'Checking preferences awaiting review', 'Pending preferences checked', 'Preference review'],
  ['curate_user_knowledge', 'Reviewing preference', 'Preference review returned', 'Preference review', 'title', 'curation']
]);
rows('clay-notes', [
  ['list_notes', 'Checking sticky notes', 'Sticky notes checked', 'Sticky notes'],
  ['write_note', 'Adding sticky note', 'Sticky note added', 'Sticky note', 'note', 'note'],
  ['close_note', 'Closing sticky note', 'Sticky note closed', 'Sticky note'],
  ['remove_note', 'Closing sticky note', 'Sticky note closed', 'Sticky note'],
  ['reopen_note', 'Reopening sticky note', 'Sticky note reopened', 'Sticky note']
]);
rows('clay-logs', [
  ['list_logs', 'Checking project logs', 'Project logs checked', 'Project logs'],
  ['search_logs', 'Searching project logs', 'Project logs searched', 'Log search', 'query'],
  ['read_log', 'Reading project log', 'Project log read', 'Project log'],
  ['log_history', 'Reading log history', 'Log history read', 'Log history'],
  ['read_log_revision', 'Reading log revision', 'Log revision read', 'Log revision'],
  ['create_log', 'Adding project log', 'Project log added', 'Project log', 'title'],
  ['update_log', 'Updating project log', 'Project log updated', 'Project log', 'title'],
  ['link_log', 'Linking project log', 'Project log linked', 'Project log'],
  ['revert_log', 'Restoring log revision', 'Log revision restored', 'Log revision'],
  ['list_log_feedback', 'Checking log comments', 'Log comments checked', 'Log comments'],
  ['review_log_comment', 'Reviewing log comment', 'Log comment reviewed', 'Log comment'],
  ['list_project_logs', 'Checking project logs', 'Project logs checked', 'Project logs'],
  ['search_project_logs', 'Searching project logs', 'Project logs searched', 'Log search', 'query'],
  ['read_project_log', 'Reading project log', 'Project log read', 'Project log'],
  ['read_project_log_revision', 'Reading log revision', 'Log revision read', 'Log revision'],
  ['project_log_history', 'Reading log history', 'Log history read', 'Log history']
]);
rows('clay-issues', [
  ['list_issues', 'Checking project issues', 'Project issues checked', 'Project issues'],
  ['search_issues', 'Searching project issues', 'Project issues searched', 'Issue search', 'query'],
  ['read_issue', 'Reading project issue', 'Project issue read', 'Project issue'],
  ['create_issue', 'Adding project issue', 'Project issue added', 'Project issue', 'title'],
  ['update_issue', 'Updating project issue', 'Project issue updated', 'Project issue', 'title'],
  ['issue_history', 'Reading issue history', 'Issue history read', 'Issue history'],
  ['read_issue_revision', 'Reading issue revision', 'Issue revision read', 'Issue revision'],
  ['list_issue_feedback', 'Checking issue comments', 'Issue comments checked', 'Issue comments'],
  ['review_issue_comment', 'Reviewing issue comment', 'Issue comment reviewed', 'Issue comment']
]);
rows('clay-sessions', [
  ['send_to_partner', 'Sending task to Worker', 'Worker task request returned', 'Worker task', 'worker', 'worker'],
  ['message_partner', 'Sending message to Worker', 'Worker message request returned', 'Worker message', 'worker', 'message'],
  ['read_partner', 'Checking Worker conversation', 'Worker conversation checked', 'Worker conversation', 'worker'],
  ['partner_status', 'Checking Worker status', 'Worker status checked', 'Worker status', 'worker'],
  ['interrupt_partner', 'Requesting Worker stop', 'Worker stop requested', 'Worker stop', 'worker'],
  ['close_partner', 'Closing Worker pane', 'Worker pane closed', 'Worker pane', 'worker'],
  ['propose_worker', 'Proposing Worker', 'Worker proposal returned', 'Worker proposal', null, 'proposal'],
  ['replace_partner', 'Proposing Worker replacement', 'Worker replacement proposal returned', 'Worker replacement', 'worker', 'proposal'],
  ['inspect_worker_proposal', 'Checking Worker proposal', 'Worker proposal checked', 'Worker proposal'],
  ['cancel_worker_proposal', 'Cancelling Worker proposal', 'Worker proposal cancelled', 'Worker proposal'],
  ['worker_runtime_catalog', 'Checking Worker runtimes', 'Worker runtimes checked', 'Worker runtimes'],
  ['queue_partner_followup', 'Queuing Worker follow-up', 'Worker follow-up request returned', 'Worker follow-up', 'worker', 'message'],
  ['inspect_partner_followups', 'Checking Worker follow-ups', 'Worker follow-ups checked', 'Worker follow-ups', 'worker'],
  ['cancel_partner_followup', 'Cancelling Worker follow-up', 'Worker follow-up cancellation returned', 'Worker follow-up', 'worker'],
  ['replace_partner_task', 'Replacing Worker task', 'Worker task replacement returned', 'Worker task', 'worker'],
  ['resume_partner_task', 'Resuming Worker task', 'Worker task resume returned', 'Worker task', 'worker'],
  ['report_partner_outcome', 'Reporting Worker result', 'Worker result reported', 'Worker result'],
  ['record_partner_evaluation', 'Recording Worker assessment', 'Worker assessment recorded', 'Worker assessment', 'worker'],
  ['respond_to_worker_permission', 'Responding to Worker permission', 'Worker permission response returned', 'Worker permission', 'worker'],
  ['respond_to_worker_question', 'Responding to Worker question', 'Worker question response returned', 'Worker question', 'worker']
]);
rows('clay-shared-browser', [['shared_browser', 'Using browser', 'Browser action returned', 'Browser action', 'site', 'browser']]);
['github', 'linear'].forEach(function (provider) {
  var title = provider === 'github' ? 'GitHub work' : 'Linear issue';
  rows('clay-' + provider, [
    ['get_session_' + provider, 'Checking linked ' + title, 'Linked ' + title + ' checked', title],
    ['link_session_' + provider, 'Linking ' + title, title + ' linked', title],
    ['unlink_session_' + provider, 'Unlinking ' + title, title + ' unlinked', title]
  ]);
});
rows('clay-linear', [['search_linear_issues', 'Searching Linear issues', 'Linear issues searched', 'Linear search', 'query'], ['read_linear_issue', 'Reading Linear issue', 'Linear issue read', 'Linear issue']]);
['mate', 'scheduled_task'].forEach(function (kind) {
  var mate = kind === 'mate';
  var server = mate ? 'clay-mate-schedules' : 'clay-scheduled-tasks';
  var suffix = mate ? 'mate_schedule' : 'scheduled_task';
  rows(server, [
    ['begin_' + suffix + '_interview', 'Preparing schedule review', 'Schedule interview started', 'Schedule review'],
    ['propose_' + suffix, 'Proposing schedule for approval', 'Schedule proposal returned', 'Schedule proposal', mate ? null : 'name', 'schedule'],
    ['list_' + suffix + 's', 'Checking schedules', 'Schedules checked', 'Schedules'],
    ['read_' + suffix, 'Reading schedule', 'Schedule read', 'Schedule'],
    ['update_' + suffix, 'Proposing schedule changes', 'Schedule change proposal returned', 'Schedule changes', mate ? null : 'name', 'schedule']
  ]);
});
rows('clay-mate-schedules', [['cancel_mate_schedule', 'Requesting schedule cancellation', 'Schedule cancellation returned', 'Schedule cancellation', null, 'schedule']]);
rows('clay-scheduled-tasks', [['report_scheduled_task_outcome', 'Reporting scheduled task result', 'Scheduled task result reported', 'Scheduled task result']]);
rows('clay-knowledge', [
  ['list_knowledge', 'Checking Mate Knowledge', 'Mate Knowledge checked', 'Mate Knowledge'],
  ['search_knowledge', 'Searching Mate Knowledge', 'Mate Knowledge searched', 'Knowledge search', 'query'],
  ['read_knowledge', 'Reading Mate Knowledge', 'Mate Knowledge read', 'Mate Knowledge'],
  ['list_mate_knowledge', 'Checking Mate Knowledge', 'Mate Knowledge checked', 'Mate Knowledge'],
  ['search_mate_knowledge', 'Searching Mate Knowledge', 'Mate Knowledge searched', 'Knowledge search', 'query'],
  ['read_mate_knowledge', 'Reading Mate Knowledge', 'Mate Knowledge read', 'Mate Knowledge'],
  ['read_knowledge_document', 'Reading knowledge document', 'Knowledge document read', 'Knowledge document', 'name'],
  ['create_knowledge_document', 'Adding knowledge document', 'Knowledge document added', 'Knowledge document', 'name'],
  ['update_knowledge_document', 'Updating knowledge document', 'Knowledge document updated', 'Knowledge document', 'name'],
  ['list_knowledge_document_history', 'Reading knowledge history', 'Knowledge history read', 'Knowledge history', 'name'],
  ['restore_knowledge_document', 'Restoring knowledge document', 'Knowledge document restored', 'Knowledge document', 'name']
]);
rows('clay-knowledge', [
  ['list_databases', 'Checking knowledge databases', 'Knowledge databases checked', 'Knowledge databases'],
  ['create_database', 'Adding knowledge database', 'Knowledge database added', 'Knowledge database', 'name'],
  ['read_database', 'Reading knowledge database', 'Knowledge database read', 'Knowledge database'],
  ['update_database_schema', 'Updating database fields', 'Database fields updated', 'Database fields'],
  ['archive_database', 'Archiving knowledge database', 'Knowledge database archived', 'Knowledge database'],
  ['recover_database', 'Recovering knowledge database', 'Knowledge database recovered', 'Knowledge database'],
  ['save_table_view', 'Saving database view', 'Database view saved', 'Database view'],
  ['query_database', 'Searching database records', 'Database records searched', 'Database records'],
  ['create_database_record', 'Adding database record', 'Database record added', 'Database record'],
  ['read_database_record', 'Reading database record', 'Database record read', 'Database record'],
  ['update_database_record', 'Updating database record', 'Database record updated', 'Database record'],
  ['archive_database_record', 'Archiving database record', 'Database record archived', 'Database record'],
  ['recover_database_record', 'Recovering database record', 'Database record recovered', 'Database record'],
  ['retry_database_sync', 'Retrying knowledge sync', 'Knowledge sync retry returned', 'Knowledge sync'],
  ['import_database_records', 'Importing database records', 'Database record import returned', 'Database import'],
  ['read_database_import_progress', 'Checking database import', 'Database import checked', 'Database import']
]);
rows('clay-tools', [
  ['clay_tool_list', 'Checking Capsules', 'Capsules checked', 'Capsules'],
  ['clay_tool_snapshot', 'Reading Capsule state', 'Capsule state read', 'Capsule'],
  ['clay_tool_act', 'Requesting Capsule action', 'Capsule action returned', 'Capsule action'],
  ['clay_tool_set', 'Updating Capsule state', 'Capsule state update returned', 'Capsule'],
  ['clay_tool_source', 'Reading Capsule source', 'Capsule source read', 'Capsule'],
  ['clay_tool_install', 'Installing Capsule', 'Capsule installation returned', 'Capsule', 'name'],
  ['clay_tool_update', 'Updating Capsule', 'Capsule update returned', 'Capsule', 'name'],
  ['clay_tool_uninstall', 'Removing Capsule', 'Capsule removal returned', 'Capsule']
]);
rows('clay-email', [
  ['clay_send_email', 'Sending email', 'Email request returned', 'Email', null, 'email'],
  ['clay_reply_email', 'Replying to email', 'Email reply returned', 'Email reply', null, 'email'],
  ['clay_read_email', 'Checking email', 'Email checked', 'Email'],
  ['clay_read_email_body', 'Reading email', 'Email read', 'Email'],
  ['clay_search_email', 'Searching email', 'Email searched', 'Email search'],
  ['clay_list_labels', 'Checking email labels', 'Email labels checked', 'Email labels'],
  ['clay_mark_read', 'Updating email read status', 'Email read status updated', 'Email'],
  ['clay_move_email', 'Moving email', 'Email move returned', 'Email']
]);
rows('clay-history', [['search_clay_history', 'Searching conversations', 'Conversations searched', 'Conversation search', 'query'], ['read_session', 'Reading conversation', 'Conversation read', 'Conversation'], ['list_recent_decisions', 'Checking recent decisions', 'Recent decisions checked', 'Recent decisions']]);
rows('clay-workspace', [
  ['read_current_context', 'Checking shared context', 'Shared context checked', 'Shared context'],
  ['read_selected_context', 'Reading selected conversation', 'Selected conversation read', 'Selected conversation'],
  ['open_context_conversation', 'Requesting conversation navigation', 'Navigation request returned', 'Conversation navigation', 'why'],
  ['read_context_navigation_receipt', 'Checking navigation receipt', 'Navigation receipt checked', 'Navigation receipt'],
  ['read_owner_screen', 'Checking your screen context', 'Screen context request returned', 'Screen context'],
  ['inspect_owner_screen_change', 'Inspecting screen change', 'Screen change inspected', 'Screen control'],
  ['control_owner_screen', 'Requesting screen change', 'Screen change request returned', 'Screen control', 'why'],
  ['list_project_session_pull_requests', 'Checking conversation pull requests', 'Conversation pull requests checked', 'Conversation pull requests', 'projectSlug'],
  ['begin_schedule_control_interview', 'Preparing schedule interview', 'Schedule interview prepared', 'Scheduling'],
  ['read_schedule_controls', 'Reading schedules', 'Schedules read', 'Scheduling'],
  ['inspect_schedule_change', 'Inspecting schedule change', 'Schedule change inspected', 'Scheduling'],
  ['read_project_workspace', 'Reading selected project workspace', 'Selected project workspace read', 'Project workspace'],
  ['read_workspace_receipt', 'Checking workspace request receipt', 'Workspace receipt checked', 'Workspace receipt'],
  ['inspect_workspace_change', 'Inspecting project workspace change', 'Project workspace change inspected', 'Project workspace'],
  ['control_project_workspace', 'Requesting project workspace change', 'Workspace change request returned', 'Project workspace', 'why', 'workspace-control'],
  ['read_mate_chat_control', 'Checking Mate conversation', 'Mate conversation checked', 'Mate conversation'],
  ['inspect_mate_chat_change', 'Inspecting Mate conversation change', 'Mate conversation change inspected', 'Mate conversation'],
  ['control_mate_chat', 'Requesting Mate conversation change', 'Mate conversation request returned', 'Mate conversation', 'why', 'mate-chat'],
  ['control_schedules', 'Requesting schedule change', 'Schedule change request returned', 'Scheduling', 'why', 'schedule-control'],
  ['read_project_records', 'Reading project records', 'Project records read', 'Project records', 'projectSlug'],
  ['inspect_project_record_change', 'Inspecting record change', 'Record change inspected', 'Project records', 'projectSlug'],
  ['control_project_records', 'Requesting record change', 'Record change request returned', 'Project records', 'why'],
  ['read_mate_knowledge_control', 'Reading Mate Knowledge', 'Mate Knowledge read', 'Mate Knowledge', 'mateId'],
  ['inspect_mate_knowledge_change', 'Inspecting Knowledge change', 'Knowledge change inspected', 'Mate Knowledge', 'mateId'],
  ['control_mate_knowledge', 'Requesting Knowledge change', 'Knowledge change request returned', 'Mate Knowledge', 'why'],
  ['list_owned_mates', 'Checking your Mates', 'Your Mates checked', 'Mates'],
  ['inspect_mate_control', 'Inspecting Mate controls', 'Mate controls inspected', 'Mate controls', 'mateId'],
  ['control_mate_lifecycle', 'Requesting Mate change', 'Mate change request returned', 'Mate change', 'why'],
  ['discover_product_controls', 'Checking product controls', 'Product controls checked', 'Product controls'],
  ['inspect_project_control', 'Inspecting project change', 'Project change inspected', 'Project inspection', 'projectSlug'],
  ['control_project_lifecycle', 'Requesting project change', 'Project change request returned', 'Project change', 'why', 'project-lifecycle'],
  ['inspect_session_control', 'Inspecting conversation controls', 'Conversation controls inspected', 'Conversation controls'],
  ['control_project_session', 'Requesting conversation change', 'Conversation change request returned', 'Conversation change', 'why', 'product-control'],
  ['list_projects', 'Checking projects', 'Projects checked', 'Projects'],
  ['list_project_sessions', 'Checking project conversations', 'Project conversations checked', 'Project conversations'],
  ['search_project_history', 'Searching project conversations', 'Project conversations searched', 'Conversation search', 'query'],
  ['read_project_session', 'Reading project conversation', 'Project conversation read', 'Project conversation'],
  ['search_workspace_history', 'Searching conversations', 'Conversations searched', 'Conversation search', 'query'],
  ['list_workspace_activity', 'Checking workspace activity', 'Workspace activity checked', 'Workspace activity'],
  ['propose_project_assignment', 'Proposing project assignment', 'Project assignment proposal returned', 'Project assignment', 'title', 'proposal'],
  ['propose_project_follow_up', 'Proposing project follow-up', 'Project follow-up proposal returned', 'Project follow-up', 'title', 'proposal'],
  ['get_assignment_status', 'Checking assignment status', 'Assignment status checked', 'Assignment status']
]);
rows('clay-debate', [['propose_debate', 'Proposing debate', 'Debate proposal returned', 'Debate proposal', 'topic', 'proposal']]);
rows('clay-mate-creation', [['propose_mate', 'Proposing Mate', 'Mate proposal returned', 'Mate proposal', 'name', 'proposal']]);
rows('clay-documents', [['present_markdown_edit', 'Opening document', 'Document opened', 'Document'], ['present_wireframe', 'Showing wireframe', 'Wireframe shown', 'Wireframe', 'title']]);
rows('clay-handoff', [['read_handoff_source', 'Reading handoff context', 'Handoff context read', 'Handoff context'], ['list_other_driver_sessions', 'Checking other Driver sessions', 'Driver sessions checked', 'Driver sessions'], ['search_other_driver_sessions', 'Searching Driver sessions', 'Driver sessions searched', 'Driver search', 'query'], ['read_other_driver_session', 'Reading Driver conversation', 'Driver conversation read', 'Driver conversation']]);

export function clayToolDefinition(name) {
  return typeof name === 'string' && aliases[name] ? definitions[aliases[name]] : null;
}

function safeSubject(value) {
  if (typeof value !== 'string') return '';
  value = value.slice(0, 200).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  // Subjects come only from declared display fields, never bodies, evidence or tool output.
  if (/secret|password|token|api[ _-]?key|bearer|https?:\/\/|@|[A-Za-z0-9_/-]{32,}/i.test(value)) return '';
  return value.length > 72 ? value.slice(0, 71).trimEnd() + '…' : value;
}
function subjectFor(def, input) {
  input = input || {};
  if (def.subject === 'note') return safeSubject(typeof input.text === 'string' ? input.text.split('\n', 1)[0] : '');
  if (def.subject === 'worker') return Number.isSafeInteger(input.workerId) ? 'Worker ' + input.workerId : '';
  if (def.subject === 'site') {
    try { return safeSubject(new URL(input.url).hostname); } catch (error) { return ''; }
  }
  return safeSubject(input[def.subject]);
}

// Called once per terminal result, never per streaming delta. Large results stay opaque.
export function clayToolOutcome(content, isError, level) {
  level = level || 0;
  if (level >= 3) return { phase: 'returned' };
  if (isError) return { phase: 'error' };
  var value = content;
  if (typeof value === 'string') {
    if (/^\s*(?:Error:|Error\b|Rejected\b|Cancelled\b|Canceled\b)/i.test(value)) return { phase: /^\s*Cancel/i.test(value) ? 'cancelled' : 'error' };
    if (value.length > 65536) return { phase: 'returned' };
    try { value = JSON.parse(value); } catch (error) { return { phase: 'returned' }; }
  }
  for (var depth = 0; depth < 3 && value && typeof value === 'object'; depth++) {
    if (value.isError || value.is_error || value.error || value.rejected === true || (Array.isArray(value.errors) && value.errors.length > 0)) return { phase: 'error' };
    var status = typeof value.status === 'string' ? value.status.toLowerCase() : '';
    if (['error', 'failed', 'rejected', 'declined', 'denied', 'blocked', 'expired', 'unavailable'].indexOf(status) !== -1) return { phase: 'error', status: status };
    if (value.cancelled === true || value.canceled === true || ['cancelled', 'canceled', 'interrupted', 'stopped', 'killed', 'abandoned'].indexOf(status) !== -1) return { phase: 'cancelled', status: status, value: value };
    if (value.ok === false || value.success === false) return { phase: 'error' };
    if (Array.isArray(value.content)) {
      var text = value.content.filter(function (block) { return block && block.type === 'text'; });
      if (text.length !== 1) return { phase: 'returned' };
      return clayToolOutcome(text[0].text, false, level + 1);
    }
    if (value.result && typeof value.result === 'object') { value = value.result; continue; }
    return { phase: 'done', status: status, value: value };
  }
  return { phase: 'returned' };
}

export function clayToolPresentation(name, input, outcome) {
  var def = clayToolDefinition(name);
  if (!def) return null;
  input = input || {};
  var phase = outcome ? outcome.phase : 'running';
  var label = outcome ? def.completed : def.running;
  if (name && def.name === 'update_scheduled_task') label = outcome ? 'Scheduled task update returned' : 'Updating scheduled task';
  var noun = def.noun;
  if (def.rule === 'browser') {
    var browserActions = {
      open: ['Opening browser page', 'Browser page opened'], navigate: ['Opening browser page', 'Browser page opened'],
      inspect: ['Checking browser page', 'Browser page checked'], status: ['Checking browser tabs', 'Browser tabs checked'],
      click: ['Clicking browser control', 'Browser control clicked'], text: ['Entering browser text', 'Browser text entered'],
      select: ['Selecting browser option', 'Browser option selected'], key: ['Pressing browser key', 'Browser key pressed'],
      wheel: ['Scrolling browser page', 'Browser page scrolled'], resize: ['Resizing browser viewport', 'Browser viewport resized'],
      reload: ['Refreshing browser page', 'Browser page refreshed'], back: ['Going to previous browser page', 'Previous browser page opened'],
      forward: ['Going to next browser page', 'Next browser page opened'], finish: ['Finishing browser activity', 'Browser activity finished']
    };
    var browserAction = browserActions[input.action];
    if (browserAction) label = browserAction[outcome ? 1 : 0];
  }
  if (def.rule === 'note' && input.id) label = outcome ? 'Sticky note updated' : 'Updating sticky note';
  if (phase === 'error') label = noun + (outcome.status === 'rejected' || outcome.status === 'declined' || outcome.status === 'denied' ? ' rejected' : ' failed');
  else if (phase === 'cancelled') label = noun + ' cancelled';
  else if (phase === 'returned') label = noun + (outcome.status === 'result_unavailable' ? ' result unavailable' : ' request returned');
  else if (outcome) {
    var status = outcome.status;
    if (def.rule === 'workspace-control') {
      if (status === 'completed') label = outcome.value.runtimeEffect === 'closed' ? 'Terminal exit confirmed' : 'Project workspace change completed';
    } else if (def.rule === 'mate-chat') {
      if (status === 'queued') { phase = 'pending'; label = outcome.value.action === 'stop' ? 'Mate Stop requested · runtime pending' : 'Mate message queued'; }
      else if (status === 'started') { phase = 'pending'; label = 'Mate message admitted · completion pending'; }
      else if (status === 'completed') label = 'Mate conversation change completed';
    } else if (def.rule === 'schedule-control') {
      if (status === 'proposed') { phase = 'pending'; label = 'Task draft awaiting Create task'; }
      else if (status === 'queued') { phase = 'pending'; label = 'Scheduled run queued'; }
      else if (status === 'completed') label = 'Schedule change saved';
      else { phase = 'returned'; label = 'Schedule change request returned'; }
    } else if (def.rule === 'project-lifecycle') {
      if (status === 'completed') label = 'Project change completed';
      else { phase = 'returned'; label = 'Project change request returned'; }
    } else if (def.rule === 'product-control') {
      if (status === 'queued') { phase = 'pending'; label = input.action === 'stop' ? 'Stop requested · runtime pending' : input.action === 'queue_add' ? 'Message queued for project Driver' : 'Conversation change queued'; }
      else if (status === 'completed') label = input.action === 'queue_add' ? 'Message delivered to project Driver' : input.action === 'queue_edit' ? 'Queued message updated' : input.action === 'queue_cancel' ? 'Queued message cancelled' : input.action === 'queue_reorder' ? 'Message queue reordered' : input.action === 'vendor' ? 'Driver provider selected' : 'Conversation change completed';
      else { phase = 'returned'; label = 'Conversation change request returned'; }
    } else if (def.rule === 'observation') {
      if (status !== 'pending') { label = 'Preference submission returned'; phase = 'returned'; }
    } else if (def.rule === 'email') {
      if (status === 'sent') label = 'Email sent';
      else phase = 'returned';
    } else if (def.rule === 'worker' || def.rule === 'message') {
      if (status === 'queued') label = def.rule === 'worker' ? 'Task queued for Worker' : 'Message queued for Worker';
      else if (status === 'running') label = 'Task sent to Worker';
      else if (status === 'complete' || status === 'completed') label = 'Worker task completed';
      else phase = 'returned';
    } else if (def.rule === 'proposal' || def.rule === 'schedule') {
      phase = 'returned'; label = noun + ' returned';
      if (['pending', 'proposed', 'awaiting_approval', 'approval_required'].indexOf(status) !== -1) { phase = 'pending'; label = noun + ' awaiting approval'; }
      if (status === 'created' && def.rule === 'schedule') { phase = 'done'; label = 'Schedule created'; }
      else if (status === 'updated' && def.rule === 'schedule') { phase = 'done'; label = 'Schedule updated'; }
      else if (status === 'unchanged') { phase = 'returned'; label = 'Schedule unchanged'; }
      else if (status && ['pending', 'proposed', 'awaiting_approval', 'approval_required'].indexOf(status) === -1) { phase = 'returned'; label = noun + ' returned'; }
    } else if (status && ['pending', 'queued', 'submitted', 'capture_pending'].indexOf(status) !== -1) { phase = 'pending'; label = noun + ' pending'; }
    if (outcome.value && (outcome.value.indexSyncPending || outcome.value.projectionPending)) label += ' · sync pending';
  }
  if (def.name === 'cancel_mate_schedule' && phase === 'cancelled' && outcome.value && outcome.value.schedule) { phase = 'done'; label = 'Schedule cancelled'; }
  if (def.name === 'update_scheduled_task' && outcome && outcome.phase === 'done' && outcome.value && outcome.value.ok === true) { phase = 'done'; label = 'Scheduled task updated'; }
  return { label: label, subject: subjectFor(def, input), phase: phase, name: def.name };
}

export function clayToolGroupSummary(group, tools) {
  if (!group.toolNames.some(function (name) { return !!clayToolDefinition(name); })) { group.clayActivityPhase = null; return null; }
  var items = (group.toolIds || []).map(function (id) { return group.toolRecords ? group.toolRecords[id] : tools[id]; }).filter(function (tool) { return tool && tool.groupId === group.id && !tool.hidden; });
  if (!items.some(function (tool) { return !!tool.clayActivity; })) return null;
  if (items.length === 1 && items[0].clayActivity) {
    var one = items[0].clayActivity;
    group.clayActivityPhase = one.phase;
    return one.label + (one.subject ? ' · ' + one.subject : '');
  }
  var failed = 0, pending = 0, running = 0, returned = 0;
  items.forEach(function (tool) {
    var phase = tool.clayActivity ? tool.clayActivity.phase : (tool.done ? (tool.el && tool.el.classList.contains('error') ? 'error' : 'done') : 'running');
    if (phase === 'error' || phase === 'cancelled') failed++;
    if (phase === 'pending') pending++;
    if (phase === 'running') running++;
    if (phase === 'returned') returned++;
  });
  group.clayActivityPhase = failed ? 'error' : pending ? 'pending' : running ? 'running' : returned ? 'returned' : 'done';
  return items.length + ' activities' + (running ? ' · ' + running + ' running' : '') + (failed ? ' · ' + failed + ' failed or cancelled' : '') + (pending ? ' · ' + pending + ' awaiting review' : '');
}
