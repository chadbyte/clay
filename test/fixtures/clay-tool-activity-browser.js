import '/app.js';
import { store } from '/modules/store.js';
import { processMessage } from '/modules/app-message-router.js';
import { getTools, closeToolGroup } from '/modules/tools.js';
import { applyTheme } from '/modules/theme.js';
import { disarmStickyBottom } from '/modules/chat-render-runtime.js';

// Keep the isolated transport healthy while a person reviews the fixture.
(window.fixtureSockets || []).forEach(function (socket) {
  function pong() { if (socket.readyState === 1 && socket.onmessage) socket.onmessage({ data: '{"type":"pong"}' }); }
  socket.send = function (raw) {
    try { if (JSON.parse(raw).type === 'ping') setTimeout(pong, 0); } catch (error) {}
  };
  setTimeout(pong, 0);
});

var examples = [
  { id: 'observation', name: 'mcp__clay-you__report_user_observation', input: { observation: 'Respectful pushback is useful.', evidence: 'Synthetic private evidence; never in collapsed summary.' }, result: { ref: 'observation:fixture', status: 'pending' }, label: 'Preference submitted for review' },
  { id: 'note', name: 'write_note', input: { text: 'Review browser performance\nSynthetic private note body.' }, result: { id: 'note-fixture' }, label: 'Sticky note added' },
  { id: 'log', name: 'mcp__clay-session-tools__clay-logs__create_log', input: { title: 'Improve transcript responsiveness', body: 'Synthetic private log body.' }, result: { ref: 'log:fixture' }, label: 'Project log added' },
  { id: 'worker', name: 'mcp__clay-sessions__send_to_partner', input: { workerId: 23, message: 'Synthetic long delegated task: '.repeat(1000) }, result: { status: 'queued', taskId: 'fixture-task' }, label: 'Task queued for Worker' },
  { id: 'schedule', name: 'propose_scheduled_task', input: { name: 'Review project each week', instructions: 'Synthetic scheduling instructions', cron: null }, result: { status: 'proposed', draft: {} }, label: 'Schedule proposal awaiting approval' },
  { id: 'failed', name: 'mcp__clay-notes__write_note', input: { id: 'note-fixture', text: 'Review browser performance' }, result: { status: 'rejected', reason: 'Synthetic revision conflict' }, label: 'Sticky note rejected' },
  { id: 'cancelled', name: 'update_mate_schedule', input: { id: 'schedule-fixture' }, result: { status: 'cancelled' }, label: 'Schedule changes cancelled' },
  { id: 'unknown', name: 'mcp__external__report_user_observation', input: { synthetic: 'Third-party fallback' }, result: { ok: true }, label: 'mcp__external__report_user_observation' }
];
function check(value, label) { if (!value) throw new Error(label); }
function frame() { return new Promise(function (resolve) { requestAnimationFrame(resolve); }); }
function toolEvents(example) {
  processMessage({ type: 'tool_start', id: example.id, name: example.name });
  processMessage({ type: 'tool_executing', id: example.id, name: example.name, input: example.input });
  processMessage({ type: 'tool_result', id: example.id, content: JSON.stringify(example.result), is_error: false });
}
var controls = document.createElement('div');
controls.style.cssText = 'position:fixed;top:0;right:0;z-index:99999;background:white;color:black;max-width:380px;max-height:28vh;overflow:auto';
controls.innerHTML = '<button id="activity-project">Project</button><button id="activity-clay">Clay</button><button id="activity-mate">Mate</button><button id="activity-worker">Worker pane</button><button id="activity-replay">Replay checks</button><button id="activity-light">Light</button><button id="activity-dark">Dark</button><pre id="activity-result"></pre>';
document.body.appendChild(controls);

window.showClayActivityFixture = function (surface, replay) {
  var mate = surface === 'clay' || surface === 'mate';
  store.set({ currentSlug: 'fixture', activeProjectSlug: 'fixture', dmMode: false, pendingOutboundMessages: [], deliveryReceipts: {}, activeProjectMateId: mate ? surface + '-fixture' : null, activeProjectMateName: mate ? (surface === 'clay' ? 'Clay' : 'Fixture Mate') : '', cachedMatesList: [{ id: 'clay-fixture', builtinKey: 'clay', name: 'Clay' }, { id: 'mate-fixture', name: 'Fixture Mate' }] });
  document.body.classList.toggle('mate-workspace-active', mate);
  document.body.classList.toggle('pane-mode', surface === 'worker');
  processMessage({ type: 'session_switched', id: 101, sessionRole: surface === 'worker' ? 'worker' : 'driver', vendor: 'claude', hasHistory: true, isProcessing: true, capabilities: {}, model: 'fixture' });
  document.getElementById('connect-overlay').classList.add('hidden');
  var hub = document.getElementById('home-hub');
  if (hub) hub.classList.add('hidden');
  if (replay) processMessage({ type: 'history_meta', from: 0, total: 30 });
  processMessage({ type: 'user_message', text: 'Synthetic internal Clay tool activity. Expand a row to inspect original evidence.' });
  examples.forEach(function (example) { closeToolGroup(); toolEvents(example); });
  closeToolGroup();
  toolEvents(Object.assign({}, examples[2], { id: 'mixed-log' }));
  toolEvents(Object.assign({}, examples[4], { id: 'mixed-schedule' }));
  toolEvents(Object.assign({}, examples[5], { id: 'mixed-error' }));
  if (replay) processMessage({ type: 'history_done' });
  disarmStickyBottom();
  document.getElementById('messages').scrollTop = 0;
  document.getElementById('activity-result').textContent = surface + (replay ? ' · restored transcript' : ' · live transcript');
};
window.runClayActivityChecks = async function () {
  var checks = 0;
  for (var surface of ['project', 'clay', 'mate', 'worker']) {
    for (var replay of [false, true]) {
      window.showClayActivityFixture(surface, replay);
      await frame();
      var tools = getTools();
      examples.forEach(function (example) {
        var tool = tools[example.id];
        check(tool && tool.name === example.name, 'original tool identity retained');
        check(tool.el.querySelector('.tool-name').textContent === example.label, 'label: ' + example.id);
        if (example.id !== 'unknown') {
          check(!tool.el.querySelector('.clay-tool-evidence'), 'technical DOM is lazy');
          check(tool.el.querySelector('.tool-subtitle').hidden, 'duplicate subtitle hidden');
          check(!tool.el.querySelector('.tool-header').textContent.includes('Synthetic private'), 'private bodies not previewed');
          if (!replay && (surface === 'clay' || surface === 'mate')) {
            check(tool.el.closest('.tool-group').querySelector('.tool-group-label').textContent.includes(example.label), 'single Mate group label describes action');
          }
        }
        checks++;
      });
      var failed = tools.failed.el;
      check(failed.classList.contains('error'), 'domain rejection visible without provider is_error flag');
      check(tools.schedule.clayActivity.phase === 'pending', 'proposal remains pending');
      var group = tools['mixed-log'].el.closest('.tool-group');
      check(group.querySelector('.tool-group-label').textContent === (replay ? '11 activities · 3 failed or cancelled · 2 awaiting review' : '3 activities · 1 failed or cancelled · 1 awaiting review'), 'mixed header is truthful: ' + surface + '/' + replay + ': ' + group.querySelector('.tool-group-label').textContent);
      group.querySelector('.tool-group-header').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      check(!group.classList.contains('collapsed'), 'keyboard group expansion');
      var row = tools['mixed-log'].el.querySelector('.tool-header');
      row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      check(row.getAttribute('aria-expanded') === 'true', 'keyboard row expansion');
      check(tools['mixed-log'].el.querySelector('.clay-tool-evidence').textContent.includes('Synthetic private log body.'), 'raw evidence preserved');
      row.click();
      check(row.getAttribute('aria-expanded') === 'false', 'click/touch disclosure closes');
      processMessage({ type: 'permission_request', requestId: 'permission-fixture', toolName: 'mcp__clay-notes__write_note', toolInput: { text: 'Synthetic permission sample' }, decisionReason: 'Synthetic permission review', vendor: 'claude' });
      check(document.querySelectorAll('[data-request-id="permission-fixture"] button:not(:disabled)').length > 0, 'permission controls remain actionable');
      processMessage({ type: 'tool_start', id: 'approval-fixture', name: 'AskUserQuestion' });
      processMessage({ type: 'tool_executing', id: 'approval-fixture', name: 'AskUserQuestion', input: { source: 'mate-schedule', questions: [{ header: 'Schedule', question: 'Approve this synthetic schedule?', options: [{ label: 'Create schedule' }, { label: 'Keep draft' }] }] } });
      check(document.querySelectorAll('[data-tool-id="approval-fixture"] .ask-user-option:not(:disabled)').length === 2, 'approval controls remain separate and actionable');
      checks += 8;
    }
  }
  check(window.fixtureErrors.length === 0, 'no production browser exceptions');
  var report = { checks: checks, status: 'passed', errors: window.fixtureErrors };
  await fetch('/report', { method: 'POST', body: JSON.stringify(report) });
  window.showClayActivityFixture('project', false);
  document.getElementById('activity-result').textContent = JSON.stringify(report);
  return report;
};
['project', 'clay', 'mate', 'worker'].forEach(function (surface) { document.getElementById('activity-' + surface).onclick = function () { window.showClayActivityFixture(surface, false); }; });
document.getElementById('activity-replay').onclick = function () { window.runClayActivityChecks().catch(function (error) { document.getElementById('activity-result').textContent = 'FAIL: ' + error.message; fetch('/report', { method: 'POST', body: JSON.stringify({ error: error.message }) }); }); };
window.showClayActivityFixture('project', false);

document.getElementById('activity-light').onclick = function () { applyTheme('clay-light', false); };
document.getElementById('activity-dark').onclick = function () { applyTheme('clay-dark', false); };


window.runClayTerminalChecks = async function () {
  var cases = [
    { type: 'result' }, { type: 'done' }, { type: 'done', interrupted: true },
    { type: 'session_writer_conflict' }, { type: 'done', replay: true },
    { type: 'auth_required', replay: true }, { type: 'history_done', replay: true }
  ];
  for (var entry of cases) {
    window.showClayActivityFixture('clay', false);
    store.set({ sessionIsProcessing: !entry.replay });
    if (entry.replay) processMessage({ type: 'history_meta', from: 0, total: 5 });
    processMessage({ type: 'tool_start', id: 'terminal-pending', name: 'propose_scheduled_task' });
    processMessage({ type: 'tool_executing', id: 'terminal-pending', name: 'propose_scheduled_task', input: { name: 'Approval remains pending' } });
    processMessage({ type: 'tool_result', id: 'terminal-pending', content: '{"status":"proposed"}' });
    closeToolGroup();
    processMessage({ type: 'tool_start', id: 'terminal-missing', name: 'mcp__clay-logs__create_log' });
    processMessage({ type: 'tool_executing', id: 'terminal-missing', name: 'mcp__clay-logs__create_log', input: { title: 'Unconfirmed log' } });
    if (!entry.replay) check(getTools()['terminal-missing'].clayActivity.phase === 'running', 'call starts running');
    processMessage({ type: entry.type, code: entry.interrupted ? -1 : 0, interrupted: !!entry.interrupted, text: 'Synthetic terminal event' });
    if (entry.replay && entry.type !== 'history_done') processMessage({ type: 'history_done' });
    await frame();
    var row = document.querySelector('[data-tool-id="terminal-missing"]');
    var pending = document.querySelector('[data-tool-id="terminal-pending"]');
    check(row.querySelector('.tool-name').textContent === 'Project log result unavailable', entry.type + ': missing result is unconfirmed');
    check(row.dataset.activityPhase === 'returned', 'unknown result is neutral');
    check(!row.querySelector('.tool-status-icon .icon-spin'), 'finished row has no spinner');
    var group = row.closest('.tool-group');
    check(!group.querySelector('.tool-group-status-icon .icon-spin'), 'finished group has no spinner');
    check(!group.querySelector('.tool-group-label').textContent.includes('running'), 'group no longer claims running');
    check(pending.dataset.activityPhase === 'pending', 'actual pending proposal preserved');
    check(pending.querySelector('.tool-name').textContent === 'Schedule proposal awaiting approval', 'pending label preserved');
    if (entry.type === 'done') {
      // New turns reuse group counters; late results must update the retained old group.
      processMessage({ type: 'tool_start', id: 'new-group', name: 'search_user_knowledge' });
      processMessage({ type: 'tool_executing', id: 'new-group', name: 'search_user_knowledge', input: {} });
    }
    processMessage({ type: 'tool_result', id: 'terminal-missing', content: '{"ref":"log:late-fixture"}' });
    check(row.querySelector('.tool-name').textContent === 'Project log added', 'late actual result replaces unknown projection');
    check(row.dataset.activityPhase === 'done', 'late success is confirmed');
    check(group.querySelector('.tool-group-label').textContent.indexOf('unavailable') === -1, 'late result updates original group');
    row.querySelector('.tool-header').click();
    check(row.querySelector('.clay-tool-evidence').textContent.includes('log:late-fixture'), 'late evidence retained');
  }
  // An authoritative active replay must continue to show a genuinely running call.
  window.showClayActivityFixture('project', false);
  processMessage({ type: 'history_meta', from: 0, total: 2 });
  processMessage({ type: 'tool_start', id: 'active-replay', name: 'create_log' });
  processMessage({ type: 'tool_executing', id: 'active-replay', name: 'create_log', input: { title: 'Active call' } });
  processMessage({ type: 'history_done' });
  check(getTools()['active-replay'].clayActivity.phase === 'running', 'active replay keeps running state');
  check(window.fixtureErrors.length === 0, 'no terminal router exceptions');
  return { cases: cases.length, activeReplay: true, errors: window.fixtureErrors };
};
