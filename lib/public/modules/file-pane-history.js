import { historicalSnapshot, historicalScope } from './file-history-snapshot.js';
import { filePaneState, updateFilePaneState, sendFilePaneRequest, repaintFilePane } from './file-pane-instances.js';
import { renderSplitDiff, renderUnifiedDiff, reconstructPatchSources } from './diff.js';
import { renderCodeWithLineNumbers, mapExtToLanguage } from './file-viewer-source.js';
import { navigateToEdit } from './filebrowser.js';

function control(label, action) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', action); return b; }
function current(state) { var live = filePaneState(state.instanceId); return live && live.requestId === state.requestId; }
function change(state, patch) { if (!current(state)) return; updateFilePaneState(state.instanceId, patch); repaintFilePane(state.instanceId); }
function entryContent(state, entry, before) { return entry.source === 'git' ? (state.historyContents || {})[entry.hash] : historicalSnapshot(entry, before); }
function requestEntry(state, entry) { if (entry.source === 'git') sendFilePaneRequest(state, 'fs_file_at', { hash: entry.hash }); }
export function paintFileHistory(body, state) {
  body.replaceChildren();
  var target = state.historyTarget;
  if (target) {
    var bar = document.createElement('div'); bar.className = 'file-history-view-bar';
    bar.appendChild(control('Back to timeline', function () { change(state, { historyTarget: null }); }));
    ['Split', 'Unified', 'Source'].forEach(function (mode) { bar.appendChild(control(mode, function () { change(state, { historyMode: mode.toLowerCase() }); })); });
    body.appendChild(bar);
    var content = document.createElement('div'); body.appendChild(content);
    var before, after;
    if (target.kind === 'git') {
      if (state.historyDiffHash !== target.entry.hash) { content.textContent = 'Loading revision…'; return; }
      if (state.historyError) { content.textContent = state.historyError; return; }
      var parsed = reconstructPatchSources(state.historyDiff || ''); before = parsed.oldStr; after = parsed.newStr;
      if (state.historyMode === 'source') after = entryContent(state, target.entry);
    } else if (target.kind === 'compare') { before = entryContent(state, target.entries[0], true); after = entryContent(state, target.entries[1]); }
    else { before = historicalSnapshot(target.entry, true); after = historicalSnapshot(target.entry, false); }
    var entries = target.entries || [target.entry], historical = entries.some(function (entry) { return entry.source !== 'git'; });
    var note = entries.map(historicalScope).filter(Boolean).join(' ');
    if (note) { var notice = document.createElement('p'); notice.textContent = note; body.insertBefore(notice, content); }
    if (after === undefined || before === undefined && state.historyMode !== 'source') {
      content.textContent = state.historyError || (historical ? 'This historical snapshot was not recorded. Use Source to inspect the recorded content, when available.' : 'Loading revision…'); return;
    }
    var ext = state.resource.path.split('.').pop();
    if (state.historyMode === 'source') renderCodeWithLineNumbers(content, after, ext);
    else content.appendChild((state.historyMode === 'unified' ? renderUnifiedDiff : renderSplitDiff)(before, after, mapExtToLanguage(ext)));
    return;
  }
  if (!state.entries) { body.textContent = 'Loading history…'; return; }
  if (!state.entries.length) { body.textContent = 'No file history'; return; }
  var selected = state.historySelected || [], comparison = document.createElement('div'); comparison.className = 'file-history-view-bar';
  comparison.textContent = 'Compare revisions (' + selected.length + '/2)';
  var compare = control('Compare', function () {
    if (!current(state) || selected.length !== 2) return;
    change(state, { historyTarget: { kind: 'compare', entries: selected }, historyError: null });
    selected.forEach(function (entry) { requestEntry(state, entry); });
  }); compare.disabled = selected.length !== 2; comparison.appendChild(compare); body.appendChild(comparison);
  state.entries.forEach(function (entry) {
    var row = document.createElement('div'); row.className = 'file-history-entry';
    var title = document.createElement('div'); title.className = 'file-history-title'; title.textContent = entry.message || entry.assistantSnippet || entry.toolName || 'Edit'; row.appendChild(title);
    var meta = document.createElement('div'); meta.className = 'file-history-meta'; meta.textContent = entry.source === 'git' ? entry.hash.slice(0, 7) + ' · ' + (entry.author || '') : entry.sessionTitle || 'Conversation'; row.appendChild(meta);
    if (entry.source !== 'git' && entry.toolName === 'Edit') row.appendChild(renderUnifiedDiff(entry.old_string || '', entry.new_string || '', mapExtToLanguage(state.resource.path.split('.').pop())));
    var select = control(selected.indexOf(entry) >= 0 ? 'Deselect' : 'Select for comparison', function () {
      var next = selected.filter(function (item) { return item !== entry; });
      if (next.length === selected.length) next = next.slice(-1).concat(entry);
      change(state, { historySelected: next });
    }); row.appendChild(select);
    row.appendChild(control('View change', function () {
      change(state, { historyTarget: { kind: entry.source === 'git' ? 'git' : 'session', entry: entry }, historyError: null });
      if (entry.source === 'git') { sendFilePaneRequest(state, 'fs_git_diff', { hash: entry.hash }); requestEntry(state, entry); }
    }));
    if (entry.source === 'session') row.appendChild(control('Go to conversation', function () { if (current(state)) navigateToEdit(entry); }));
    body.appendChild(row);
  });
}
export function receiveFileHistory(state, msg) {
  if (msg.type === 'fs_file_history_result') updateFilePaneState(state.instanceId, { entries: msg.entries || [], historyError: msg.error || null });
  else if (msg.type === 'fs_git_diff_result') {
    var target = state.historyTarget;
    if (!target || target.kind !== 'git' || target.entry.hash !== msg.hash) return;
    updateFilePaneState(state.instanceId, { historyDiff: msg.diff, historyDiffHash: msg.hash, historyError: msg.error || null });
  } else if (msg.type === 'fs_file_at_result') {
    var contents = Object.assign({}, state.historyContents || {}); contents[msg.hash] = msg.content;
    updateFilePaneState(state.instanceId, { historyContents: contents, historyError: msg.error || null });
  } else return;
  if (state.historyVisible) repaintFilePane(state.instanceId);
}
