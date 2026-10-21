import { workerActivityNames } from './split-view-worker-activity.js';
import { createAssistantBubble, createUserBubble, renderAssistantBubbleText } from './chat-bubble-renderer.js';
import { createSessionToolItem, createSessionToolGroup, sessionToolGroupSummary } from './session-tool-item.js';
import { applyClayToolItem, bindToolGroupDisclosure } from './clay-tool-activity.js';
import { iconHtml } from './icons.js';
import { VENDOR_AVATARS } from './chat-render-runtime.js';

// Reassemble bounded record fragments and contiguous streaming deltas before
// parsing Markdown, including fences and lists that cross a page boundary.
export function workerTranscriptRows(messages) {
  var rows = [];
  (messages || []).forEach(function (message) {
    if (!message || typeof message.text !== 'string' || ['user', 'assistant', 'tool'].indexOf(message.role) < 0) return;
    var last = rows[rows.length - 1];
    var fragment = last && Number.isInteger(message.recordIndex) && last.recordIndex === message.recordIndex && last.end === message.start;
    var delta = last && message.recordType === 'delta' && last.recordType === 'delta' && message.start === 0 && message.recordIndex === last.recordIndex + 1;
    if (last && last.role === message.role && (fragment || delta)) {
      last.text += message.text; last.end = message.end; last.recordIndex = message.recordIndex;
    } else rows.push(Object.assign({}, message));
  });
  return rows;
}

function inputFor(message) {
  if (message.recordType !== 'tool_use' && message.recordType !== 'tool_executing') return null;
  try { var start = message.text.indexOf('{'); return start >= 0 ? JSON.parse(message.text.slice(start)) : null; } catch (error) { return null; }
}
export function appendWorkerMessage(body, message, names, options) {
  options = options || {};
  if (message.role === 'tool') {
    var name = message.toolName || names && names[message.toolId] && names[message.toolId].name || 'Tool activity';
    var el = createSessionToolItem(message.toolId, name);
    el.classList.add('worker-readonly-message', 'worker-tool-message'); el.dataset.recordIndex = String(message.recordIndex);
    el.dataset.phase = message.isError ? 'failed' : message.recordType === 'tool_result' ? 'returned' : 'recorded';
    var input = inputFor(message), output = message.resultText;
    var tool = { el: el, name: name, input: input, clayRawResult: output, clayOutcome: output !== undefined ? { phase: message.isError ? 'error' : 'done' } : { phase: 'returned', status: 'result_unavailable' } };
    var header = el.querySelector('.tool-header'); header.dataset.disclosureKey = 'record-' + message.recordIndex;
    if (!applyClayToolItem(tool)) {
      var terminal = message.isError ? 'Failed' : output !== undefined || message.recordType === 'tool_result' ? 'Result returned' : 'Call recorded';
      el.querySelector('.tool-desc').textContent = input && (input.file_path || input.command || input.pattern) || '';
      el.querySelector('.tool-subtitle-text').textContent = terminal;
      el.querySelector('.tool-status-icon').innerHTML = iconHtml(message.isError ? 'alert-triangle' : output !== undefined ? 'check' : 'circle-help');
      el.classList.toggle('done', output !== undefined); el.classList.toggle('error', !!message.isError);
      var block = document.createElement('div'); block.className = 'tool-result-block collapsed';
      var pre = document.createElement('pre'); pre.textContent = output !== undefined ? output : message.text; block.appendChild(pre); el.appendChild(block);
      header.setAttribute('role', 'button'); header.tabIndex = 0; header.setAttribute('aria-expanded', 'false');
      function toggle() { var expanded = el.classList.toggle('expanded'); block.classList.toggle('collapsed', !expanded); header.setAttribute('aria-expanded', String(expanded)); }
      header.addEventListener('click', toggle); header.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
    }
    body.appendChild(el); return;
  }
  var user = message.role === 'user';
  var label = message.authorLabel || (user ? options.userName || 'Driver' : options.assistantName || 'Worker');
  var config = { tagName: 'article', name: label, avatarUrl: user ? options.userAvatar || '/icon-192.png' : VENDOR_AVATARS[options.vendor || 'claude'], text: message.text };
  var article = user ? createUserBubble(config) : createAssistantBubble(config);
  article.classList.add('worker-readonly-message'); article.dataset.recordIndex = String(message.recordIndex);
  if (!user) renderAssistantBubbleText(article, message.text, true, { readOnly: true });
  body.appendChild(article);
}
export function appendWorkerTranscript(body, messages, options) {
  var rows = workerTranscriptRows(messages), names = workerActivityNames(rows), consumed = new Set(), visible = [];
  rows.forEach(function (message, index) {
    if (consumed.has(index)) return;
    var row = message;
    if (message.role === 'tool' && names[message.toolId] && names[message.toolId].index === message.recordIndex) {
      var later = rows.slice(index + 1), executing = later.find(function (item) { return item.toolId === message.toolId && item.recordType === 'tool_executing'; });
      var result = later.find(function (item) { return item.toolId === message.toolId && item.recordType === 'tool_result'; });
      row = Object.assign({}, message, executing ? { text: executing.text, recordType: executing.recordType } : {}, result ? { resultText: result.text, isError: result.isError } : {});
      [executing, result].forEach(function (item) { if (item) consumed.add(rows.indexOf(item)); });
    }
    visible.push(row);
  });
  var group = null, groupRows = [];
  function finish() {
    if (!group) return;
    var header = group.querySelector('.tool-group-header'), done = groupRows.every(function (row) { return row.resultText !== undefined || row.recordType === 'tool_result'; });
    var meta = { toolNames: groupRows.map(function (row) { return row.toolName || names[row.toolId] && names[row.toolId].name || 'Tool'; }), doneCount: done ? groupRows.length : 0 };
    header.style.display = groupRows.length > 1 ? '' : 'none';
    header.dataset.disclosureKey = 'group-' + groupRows[0].recordIndex;
    group.querySelector('.tool-group-label').textContent = done ? sessionToolGroupSummary(meta, {}) : groupRows.length + ' tool calls recorded';
    group.classList.toggle('done', done); group.classList.toggle('collapsed', groupRows.length > 1);
    group.querySelector('.tool-group-status-icon').innerHTML = iconHtml(done ? 'check' : 'circle-help');
    bindToolGroupDisclosure(group, function () {}); group = null; groupRows = [];
  }
  visible.forEach(function (row) {
    if (row.role !== 'tool') { finish(); appendWorkerMessage(body, row, names, options); return; }
    if (!group) { group = createSessionToolGroup(); body.appendChild(group); }
    groupRows.push(row); appendWorkerMessage(group.querySelector('.tool-group-items'), row, names, options);
  });
  finish();
}
