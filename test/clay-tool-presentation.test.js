var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var source = fs.readFileSync('lib/public/modules/clay-tool-presentation.js', 'utf8');
var loaded = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('workspace control labels distinguish confirmed terminal exit and failed partial effects', async function () {
  var closed = await projection('control_project_workspace', {}, { status: 'completed', runtimeEffect: 'closed', exitAcknowledged: true });
  assert.equal(closed.phase, 'done'); assert.equal(closed.label, 'Terminal exit confirmed');
  var partial = await projection('control_project_workspace', {}, { status: 'failed', runtimeEffect: 'index_updated', persisted: true });
  assert.equal(partial.phase, 'error'); assert.match(partial.label, /failed/);
  assert.equal((await projection('control_project_workspace', {}, { status: 'cancelled' })).phase, 'cancelled');
});

test('Mate conversation activity distinguishes provider admission, Stop and completed configuration', async function () {
  var queued = await projection('control_mate_chat', {}, { status: 'queued', action: 'send' });
  assert.equal(queued.phase, 'pending'); assert.equal(queued.label, 'Mate message queued');
  var started = await projection('control_mate_chat', {}, { status: 'started', action: 'send' });
  assert.equal(started.phase, 'pending'); assert.match(started.label, /completion pending/);
  var stop = await projection('control_mate_chat', {}, { status: 'queued', action: 'stop' });
  assert.match(stop.label, /Stop requested/);
  assert.equal((await projection('control_mate_chat', {}, { status: 'completed', action: 'model' })).phase, 'done');
  assert.equal((await projection('control_mate_chat', {}, { status: 'failed', runtimeEffect: 'applied' })).phase, 'error');
});

async function projection(name, input, result, error) {
  var api = await loaded;
  return api.clayToolPresentation(name, input, result === undefined && !error ? null : api.clayToolOutcome(result, error));
}

test('exact catalog aliases match Claude, Codex and resumed bridge tools without suffix matching', async function () {
  var api = await loaded;
  for (var name of ['report_user_observation', 'mcp__clay-you__report_user_observation', 'clay-you__report_user_observation', 'mcp__clay-session-tools__clay-you__report_user_observation']) {
    assert.equal((await projection(name, {})).label, 'Submitting preference for review');
  }
  for (var name of ['mcp__external__report_user_observation', 'mcp__clay-you-evil__report_user_observation', 'mcp__clay-you__unknown', 'mcp__clay-notes__report_user_observation', 'prefix_report_user_observation', 'Read']) assert.equal(api.clayToolDefinition(name), null);
});

test('observation completion means submitted for review, never saved knowledge', async function () {
  var item = await projection('report_user_observation', { observation: 'secret token', evidence: 'private@example.com' }, { ref: 'observation:synthetic', status: 'pending' });
  assert.equal(item.label, 'Preference submitted for review');
  assert.equal(item.subject, '');
  assert.equal(item.phase, 'done');
});

test('note creation/update and log completion use bounded intended subjects', async function () {
  assert.equal((await projection('write_note', { text: 'Remember browser checks\nprivate content' })).label, 'Adding sticky note');
  assert.equal((await projection('write_note', { id: 'n1', text: 'Remember browser checks' }, { id: 'n1' })).label, 'Sticky note updated');
  var item = await projection('create_log', { title: 'Browser performance', body: 'secret body' }, { ref: 'log:synthetic' });
  assert.equal(item.label, 'Project log added');
  assert.equal(item.subject, 'Browser performance');
  assert.equal((await projection('create_log', { title: 'API key abc123' }, { ref: 'log:x' })).subject, '');
  assert.ok((await projection('create_log', { title: 'Readable title '.repeat(20) })).subject.length <= 72);
});

test('Worker outcome distinguishes queued, running, complete and unknown delivery', async function () {
  assert.equal((await projection('send_to_partner', { message: 'do not show raw task', workerId: 7 }, { status: 'queued' })).label, 'Task queued for Worker');
  assert.equal((await projection('send_to_partner', {}, { status: 'running' })).label, 'Task sent to Worker');
  assert.equal((await projection('send_to_partner', {}, { status: 'complete' })).label, 'Worker task completed');
  assert.equal((await projection('send_to_partner', {}, {})).label, 'Worker task request returned');
  assert.equal((await projection('send_to_partner', {}, { status: 'capture_pending' })).phase, 'returned');
});

test('envelope and domain errors, rejection and cancellation override success', async function () {
  for (var result of [{ isError: true, content: [{ type: 'text', text: '{"ref":"log:x"}' }] }, { content: [{ type: 'text', text: '{"status":"rejected"}' }] }, { result: { ok: false } }, { error: 'private failure' }, { status: 'failed' }]) {
    var item = await projection('create_log', {}, result);
    assert.equal(item.phase, 'error');
    assert.doesNotMatch(item.label, /added/);
  }
  assert.equal((await projection('create_log', {}, { status: 'cancelled' })).phase, 'cancelled');
  assert.equal((await projection('create_log', {}, { ref: 'log:x' }, true)).phase, 'error');
});

test('schedule proposals require an actual created/updated outcome, cancellation is explicit', async function () {
  assert.equal((await projection('propose_scheduled_task', {}, { status: 'proposed' })).phase, 'pending');
  assert.doesNotMatch((await projection('propose_scheduled_task', {}, { status: 'proposed' })).label, /created/);
  assert.equal((await projection('propose_mate_schedule', {}, { status: 'created', schedule: {} })).label, 'Schedule created');
  assert.equal((await projection('update_mate_schedule', {}, { status: 'cancelled' })).label, 'Schedule changes cancelled');
  assert.equal((await projection('cancel_mate_schedule', {}, { status: 'cancelled', schedule: { state: 'cancelled' } })).label, 'Schedule cancelled');
  assert.equal((await projection('update_scheduled_task', {}, { ok: true, record: {} })).label, 'Scheduled task updated');
});

test('opaque large outputs stay unparsed and arbitrary output never becomes a collapsed subject', async function () {
  var api = await loaded;
  var large = '{"ref":"log:x","body":"' + 'x'.repeat(100000) + '"}';
  assert.equal(api.clayToolOutcome(large, false).phase, 'returned');
  assert.equal((await projection('create_log', {}, large)).subject, '');
  assert.equal((await projection('shared_browser', { url: 'https://example.com/private?token=secret', action: 'open' }, { url: 'https://example.com' })).subject, 'example.com');
  var nested = { content: [{ type: 'text', text: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ content: [{ type: 'text', text: '{"ref":"log:x"}' }] }) }] }) }] };
  assert.equal(api.clayToolOutcome(nested, false).phase, 'returned');
});

test('mixed groups stay concise and expose pending/failure rather than claiming all actions ran', async function () {
  var api = await loaded;
  var tools = {
    a: { groupId: 'g1', clayActivity: await projection('create_log', {}, { ref: 'log:x' }) },
    b: { groupId: 'g1', clayActivity: await projection('propose_scheduled_task', {}, { status: 'proposed' }) },
    c: { groupId: 'g1', clayActivity: await projection('write_note', {}, { status: 'rejected' }) }
  };
  var group = { id: 'g1', toolNames: ['create_log', 'propose_scheduled_task', 'write_note'], toolIds: ['a', 'b', 'c'] };
  assert.equal(api.clayToolGroupSummary(group, tools), '3 activities · 1 failed or cancelled · 1 awaiting review');
  assert.equal(group.clayActivityPhase, 'error');
  assert.equal(api.clayToolGroupSummary({ id: 'g2', toolNames: ['Read'], toolIds: [] }, tools), null);
});


test('browser actions describe the actual action without copying text, credentials or URL queries', async function () {
  var opening = await projection('mcp__clay-shared-browser__shared_browser', { action: 'open', url: 'https://example.com/private?token=secret' });
  assert.equal(opening.label, 'Opening browser page');
  assert.equal(opening.subject, 'example.com');
  assert.equal((await projection('shared_browser', { action: 'text', text: 'private-token' }, { error: '', phase: 'live' })).label, 'Browser text entered');
  assert.equal((await projection('shared_browser', { action: 'open' }, { error: 'navigation failed' })).label, 'Browser action failed');
});


test('missing tool results have a neutral unavailable projection without asserting completion', async function () {
  var api = await loaded;
  var item = api.clayToolPresentation('create_log', { title: 'Lifecycle check' }, { phase: 'returned', status: 'result_unavailable' });
  assert.equal(item.label, 'Project log result unavailable');
  assert.equal(item.phase, 'returned');
  assert.equal(item.subject, 'Lifecycle check');
});

test('boolean cancellation aliases remain cancellation unless a real failure overrides them', async function () {
  var api = await loaded;
  for (var value of [{ cancelled: true }, { canceled: true }, { cancelled: true, ok: false }, { canceled: true, success: false }]) {
    assert.equal(api.clayToolOutcome(value, false).phase, 'cancelled');
    assert.equal((await projection('write_note', {}, value)).label, 'Sticky note cancelled');
  }
  for (var value of [{ cancelled: true, error: 'failed transport' }, { canceled: true, isError: true }, { cancelled: true, status: 'failed' }]) assert.equal(api.clayToolOutcome(value, false).phase, 'error');
  assert.equal(api.clayToolOutcome({ cancelled: true }, true).phase, 'error');
});


test('canonical product control activity distinguishes queued Stop, completed, cancelled and failed effects', async function () {
  var item = await projection('mcp__clay-workspace__control_project_session', { action: 'stop', why: 'Stop the current task' }, { status: 'queued' });
  assert.equal(item.label, 'Stop requested · runtime pending');
  assert.equal(item.phase, 'pending');
  assert.equal((await projection('control_project_session', {}, { status: 'completed' })).label, 'Conversation change completed');
  assert.equal((await projection('control_project_session', {}, { status: 'failed', error: 'Runtime refused' })).phase, 'error');
  assert.equal((await projection('control_project_session', {}, { status: 'cancelled' })).phase, 'cancelled');
});

test('Driver queue activity describes delivery and persisted edits truthfully', async function () {
  assert.equal((await projection('control_project_session', { action: 'queue_add' }, { status: 'queued' })).label, 'Message queued for project Driver');
  assert.equal((await projection('control_project_session', { action: 'queue_add' }, { status: 'completed' })).label, 'Message delivered to project Driver');
  for (var entry of [['queue_edit', 'Queued message updated'], ['queue_cancel', 'Queued message cancelled'], ['queue_reorder', 'Message queue reordered'], ['vendor', 'Driver provider selected']]) assert.equal((await projection('control_project_session', { action: entry[0] }, { status: 'completed' })).label, entry[1]);
});


test('project lifecycle labels expose purpose and distinguish completion from uncertain effects', async function () {
  assert.equal((await projection('inspect_project_control', { projectSlug: 'sample' })).label, 'Inspecting project change');
  var item = await projection('mcp__clay-workspace__control_project_lifecycle', { why: 'Make the project easier to recognize' }, { status: 'completed', slug: 'sample' });
  assert.equal(item.label, 'Project change completed'); assert.equal(item.subject, 'Make the project easier to recognize');
  assert.equal((await projection('control_project_lifecycle', {}, { status: 'failed', outcome: 'registration_saved_runtime_pending' })).phase, 'error');
  assert.equal((await projection('control_project_lifecycle', {}, { status: 'cancelled' })).label, 'Project change cancelled');
});

test('Mate lifecycle activity names the operation and keeps partial cleanup failures visible', async function () {
  assert.equal((await projection('list_owned_mates', {})).label, 'Checking your Mates');
  assert.equal((await projection('inspect_mate_control', { mateId: 'private' })).label, 'Inspecting Mate controls');
  var item = await projection('mcp__clay-workspace__control_mate_lifecycle', { why: 'Keep the Mate recognizable' }, { status: 'failed', persisted: true, runtimeClosed: false });
  assert.equal(item.phase, 'error');
  assert.equal((await projection('control_mate_lifecycle', {}, { status: 'cancelled' })).phase, 'cancelled');
});

test('Mate Knowledge control labels retain mutation failures and cancellation', async function () {
  assert.equal((await projection('read_mate_knowledge_control', { mateId: 'private' })).label, 'Reading Mate Knowledge');
  assert.equal((await projection('inspect_mate_knowledge_change', { mateId: 'private' })).label, 'Inspecting Knowledge change');
  assert.equal((await projection('mcp__clay-workspace__control_mate_knowledge', { why: 'Save the reviewed document' }, { status: 'failed', persisted: 'unknown' })).phase, 'error');
  assert.equal((await projection('control_mate_knowledge', {}, { status: 'cancelled' })).phase, 'cancelled');
});

test('project record tools show friendly labels and retain uncertain saves and cancellation', async function () {
  assert.equal((await projection('read_project_records', { projectSlug: 'target' })).label, 'Reading project records');
  assert.equal((await projection('inspect_project_record_change', { projectSlug: 'target' })).label, 'Inspecting record change');
  assert.equal((await projection('mcp__clay-workspace__control_project_records', {}, { status: 'failed', persisted: 'unknown' })).phase, 'error');
  assert.equal((await projection('control_project_records', {}, { status: 'cancelled' })).phase, 'cancelled');
});


test('canonical scheduling activity preserves draft approval and queued execution distinctions', async function () {
  assert.equal((await projection('control_schedules', {}, { status: 'proposed' })).label, 'Task draft awaiting Create task');
  assert.equal((await projection('mcp__clay-workspace__control_schedules', {}, { status: 'queued' })).label, 'Scheduled run queued');
  assert.equal((await projection('control_schedules', {}, { status: 'completed', delivery: 'queued' })).label, 'Schedule change saved');
  assert.equal((await projection('control_schedules', {}, { status: 'failed', persisted: 'unknown' })).phase, 'error');
  assert.equal((await projection('control_schedules', {}, { status: 'cancelled' })).phase, 'cancelled');
});
