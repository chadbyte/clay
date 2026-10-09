import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { isMateWorkspace } from './project-mate-navigation.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';
import {
  documentIdentity, blankKnowledgeState, selectKnowledgeDocument, editKnowledgeDraft,
  failKnowledgeOffline, closeKnowledgeTab,
  beginKnowledgeRead, applyKnowledgeRead, beginKnowledgeSave, applyKnowledgeSave,
  beginKnowledgeRename, applyKnowledgeRename, beginKnowledgeDelete, applyKnowledgeDelete,
  failKnowledgeRequest,
} from './mate-knowledge-workbench-state.js';

var panel = null;
var requestCounter = 0;
var pending = {};
var searchTimer = null;
var searchTimerKey = null;
var returnFocus = null;
var narrowInert = [];
var deleteTarget = null;

function workspaceKey() { return store.get('currentSlug') || ''; }
function allStates() { return store.get('mateKnowledgeWorkspaces') || {}; }
function stateFor(key) { return allStates()[key] || blankKnowledgeState(); }
function setState(key, next) {
  var states = Object.assign({}, allStates());
  states[key] = next;
  store.set({ mateKnowledgeWorkspaces: states });
}
function patchState(key, patch) { setState(key, Object.assign({}, stateFor(key), patch)); }
function patchDraft(key, id, patch) {
  var state = stateFor(key); var draft = state.drafts[id]; if (!draft) return;
  var drafts = Object.assign({}, state.drafts); drafts[id] = Object.assign({}, draft, patch); setState(key, Object.assign({}, state, { drafts: drafts }));
}
function currentDraft(state) { return state.selected ? state.drafts[state.selected] || null : null; }
function fileForId(state, id) {
  for (var i = 0; i < state.files.length; i++) if (documentIdentity(state.files[i]) === id) return state.files[i];
  var draft = state.drafts[id]; return draft ? draft.file : null;
}
function nextRequestId() { requestCounter += 1; return 'knowledge-' + Date.now() + '-' + requestCounter; }
function readySocket(key) {
  if (key !== workspaceKey()) return null;
  var ws = getWs();
  if (ws && ws.readyState === 1) return ws;
  patchState(key, { error: 'Reconnect to use Knowledge.' }); render(); return null;
}
function sendPrepared(key, type, details, tracked, nextState) {
  var ws = readySocket(key); if (!ws) return false;
  pending[tracked.requestId] = Object.assign({ key: key, type: type }, tracked);
  if (nextState) setState(key, nextState);
  try { ws.send(JSON.stringify(Object.assign({ type: type, requestId: tracked.requestId }, details || {}))); }
  catch (error) {
    delete pending[tracked.requestId]; setState(key, failKnowledgeRequest(stateFor(key), tracked, { error: error.message })); render(); return false;
  }
  return true;
}
function simpleRequest(type, details, tracked) {
  var key = workspaceKey(); var requestId = nextRequestId();
  return sendPrepared(key, type, details, Object.assign({ requestId: requestId }, tracked || {}), null) ? requestId : null;
}
function safeName(value) {
  var name = String(value || '').trim(); if (!name) return '';
  if (!/\.md$/i.test(name)) name += '.md';
  return /^[^/\\\x00-\x1f\x7f]{1,120}\.md$/i.test(name) ? name : '';
}
function saveScroll(keyOverride) {
  if (!panel) return; var key = keyOverride || workspaceKey(); var state = stateFor(key); var id = state.selected; if (!id) return;
  var draft = state.drafts[id]; if (!draft) return;
  var editor = panel.querySelector('[data-knowledge-editor]'); var preview = panel.querySelector('[data-knowledge-preview]');
  patchDraft(key, id, { editScroll: editor ? editor.scrollTop : draft.editScroll || 0, readScroll: preview ? preview.scrollTop : draft.readScroll || 0 });
  patchState(key, { explorerScroll: panel.querySelector('.knowledge-explorer-list').scrollTop });
}
function headings(content) {
  var lines = String(content || '').split('\n'); var out = [];
  for (var i = 0; i < lines.length; i++) { var match = /^(#{1,4})\s+(.+?)\s*$/.exec(lines[i]); if (match) out.push({ depth: match[1].length, text: match[2].replace(/[*_`]/g, '') }); }
  return out;
}
function links(content) {
  var out = []; var seen = {}; var pattern = /\[([^\]]+)\]\(([^)]+)\)|\[\[([^\]]+)\]\]/g; var match;
  while ((match = pattern.exec(String(content || '')))) { var label = match[1] || match[3]; var href = match[2] || match[3]; if (!seen[href]) { seen[href] = true; out.push({ label: label, href: href }); } }
  return out;
}
function internalTarget(state, href) {
  var raw = String(href || '').split('#')[0].split('?')[0];
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.indexOf('/') !== -1 || raw.indexOf('\\') !== -1) return null;
  try { raw = decodeURIComponent(raw); } catch (error) {}
  if (!/\.md$/i.test(raw)) raw += '.md';
  var candidates = state.files.filter(function (file) { return file.name.toLowerCase() === raw.toLowerCase(); });
  var local = candidates.filter(function (file) { return !file.common; });
  if (local.length) return documentIdentity(local[0]);
  return candidates.length === 1 ? documentIdentity(candidates[0]) : null;
}
function backlinks(state, selected) {
  var draft = state.drafts[selected]; var base = draft && draft.file ? draft.file.name.replace(/\.md$/i, '') : ''; var fileName = draft && draft.file ? draft.file.name : ''; var out = [];
  Object.keys(state.drafts).forEach(function (id) { if (id === selected) return; var body = state.drafts[id].content || ''; if (body.indexOf('[[' + base + ']]') !== -1 || body.indexOf('](' + fileName + ')') !== -1) out.push(id); });
  return out;
}

function ensurePanel() {
  if (panel) return; var host = document.getElementById('main-panels'); if (!host) return;
  panel = document.createElement('section'); panel.id = 'mate-knowledge-workbench'; panel.className = 'hidden'; panel.setAttribute('aria-label', 'Mate Knowledge');
  panel.innerHTML = '<header class="knowledge-topbar"><span class="knowledge-title">' + iconHtml('book-open') + 'Knowledge</span><span class="knowledge-subtitle">Documents in this Mate project</span><button type="button" data-knowledge-new title="New document" aria-label="New document">' + iconHtml('file-plus-2') + '</button><button type="button" data-knowledge-wide title="Widen Knowledge" aria-label="Widen Knowledge" aria-pressed="false">' + iconHtml('chevrons-left-right') + '</button><button type="button" data-knowledge-full title="Toggle fullscreen" aria-label="Toggle Knowledge fullscreen" aria-pressed="false">' + iconHtml('maximize-2') + '</button><button type="button" data-knowledge-close title="Close Knowledge" aria-label="Close Knowledge">' + iconHtml('x') + '</button></header><div class="knowledge-status" role="status"></div><div class="knowledge-layout"><aside class="knowledge-explorer"><label class="knowledge-search">' + iconHtml('search') + '<input type="search" placeholder="Search names and contents" aria-label="Search Knowledge document names and contents"></label><div class="knowledge-explorer-heading"><span>Documents</span><span data-knowledge-count></span></div><div class="knowledge-explorer-list" role="list"></div></aside><main class="knowledge-document"><div class="knowledge-tabs" role="tablist" aria-label="Open Knowledge documents"></div><div class="knowledge-document-toolbar"></div><div class="knowledge-document-body"></div></main><aside class="knowledge-details"><div class="knowledge-detail-section"><button type="button" class="knowledge-detail-heading" aria-expanded="true" data-detail-toggle="outline">Outline' + iconHtml('chevron-down') + '</button><div data-detail-content="outline"></div></div><div class="knowledge-detail-section"><button type="button" class="knowledge-detail-heading" aria-expanded="true" data-detail-toggle="links">Links' + iconHtml('chevron-down') + '</button><div data-detail-content="links"></div></div></aside></div><div class="knowledge-delete-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="knowledge-delete-title"><div><h2 id="knowledge-delete-title">Delete this document?</h2><p>The file will be removed from this Mate project. Existing record history remains available to shared Knowledge.</p><div><button type="button" data-delete-cancel>Cancel</button><button type="button" class="danger" data-delete-confirm>Delete</button></div></div></div>';
  host.appendChild(panel); bindPanel(); refreshIcons(panel);
}
function ensureButton() {
  var button = document.getElementById('knowledge-workbench-btn'); if (button) return button;
  var tools = document.getElementById('session-actions'); if (!tools) return null;
  button = document.createElement('button'); button.id = 'knowledge-workbench-btn'; button.type = 'button'; button.className = 'palette-tile'; button.title = 'Knowledge'; button.setAttribute('aria-label', 'Knowledge'); button.innerHTML = '<i data-lucide="book-open"></i><span class="tool-btn-label">Knowledge</span>';
  tools.insertBefore(button, tools.firstChild); refreshIcons(button); return button;
}
function bindPanel() {
  panel.querySelector('[data-knowledge-close]').addEventListener('click', closeKnowledgeWorkbench);
  panel.querySelector('[data-knowledge-new]').addEventListener('click', createDocument);
  panel.querySelector('.knowledge-search input').addEventListener('input', scheduleSearch);
  panel.querySelector('[data-knowledge-wide]').addEventListener('click', function () { var key = workspaceKey(); patchState(key, { wide: !stateFor(key).wide }); renderShell(); });
  panel.querySelector('[data-knowledge-full]').addEventListener('click', function () { var key = workspaceKey(); patchState(key, { fullscreen: !stateFor(key).fullscreen }); renderShell(); });
  panel.querySelector('[data-delete-cancel]').addEventListener('click', closeDelete);
  panel.querySelector('[data-delete-confirm]').addEventListener('click', confirmDelete);
  panel.addEventListener('click', handlePanelClick);
  panel.addEventListener('input', function (event) {
    var key = workspaceKey(); var state = stateFor(key); var id = state.selected;
    if (event.target.matches('[data-knowledge-editor]')) { setState(key, editKnowledgeDraft(state, id, { content: event.target.value, dirty: true, error: '' })); renderDetails(); renderToolbar(); }
    else if (event.target.matches('[data-document-name]')) patchDraft(key, id, { name: event.target.value });
  });
  panel.addEventListener('keydown', handlePanelKeydown);
}
function handlePanelClick(event) {
  var close = event.target.closest('[data-close-tab]'); if (close) { closeTab(close.dataset.closeTab); return; }
  var select = event.target.closest('[data-select-tab]'); if (select) { selectTab(select.dataset.selectTab, true); return; }
  var open = event.target.closest('[data-open-document]'); if (open) { openDocument(open.dataset.openDocument); return; }
  var action = event.target.closest('[data-document-action]'); if (action) { handleAction(action.dataset.documentAction, action); return; }
  var toggle = event.target.closest('[data-detail-toggle]'); if (toggle) { var content = panel.querySelector('[data-detail-content="' + toggle.dataset.detailToggle + '"]'); var expanded = toggle.getAttribute('aria-expanded') !== 'false'; toggle.setAttribute('aria-expanded', String(!expanded)); content.hidden = expanded; return; }
  if (event.target.closest('[data-sync-retry]')) retrySync();
}
function handlePanelKeydown(event) {
  if (deleteTarget) { trapDeleteFocus(event); return; }
  var tab = event.target.closest('[data-select-tab]');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) !== -1) { event.preventDefault(); moveTabFocus(tab.dataset.selectTab, event.key); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveDocument(); }
  else if (event.key === 'Escape' && window.matchMedia('(max-width: 1023px)').matches) closeKnowledgeWorkbench();
}
function trapDeleteFocus(event) {
  if (event.key === 'Escape') { event.preventDefault(); closeDelete(); return; }
  if (event.key !== 'Tab') return;
  var controls = panel.querySelectorAll('.knowledge-delete-dialog button:not(:disabled)'); if (!controls.length) return;
  var first = controls[0]; var last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function moveTabFocus(id, keyName) {
  var state = stateFor(workspaceKey()); var index = state.tabs.indexOf(id); if (index === -1) return;
  if (keyName === 'Home') index = 0; else if (keyName === 'End') index = state.tabs.length - 1; else index = (index + (keyName === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length;
  selectTab(state.tabs[index], true);
}
function cancelScheduledSearch(key) {
  if (!searchTimer || (key && searchTimerKey !== key)) return;
  clearTimeout(searchTimer); searchTimer = null;
  var cancelledKey = searchTimerKey; searchTimerKey = null;
  if (cancelledKey) patchState(cancelledKey, { searching: false });
}
function requestSearch(key, query) {
  if (key !== workspaceKey() || !panel || panel.classList.contains('hidden')) { patchState(key, { searching: false }); return; }
  var requestId = nextRequestId(); var tracked = { requestId: requestId, query: query };
  if (!sendPrepared(key, 'knowledge_search', { query: query }, tracked, null)) patchState(key, { searching: false });
}
function scheduleSearch(event) {
  var key = workspaceKey(); var query = event.target.value; cancelScheduledSearch();
  patchState(key, { query: query, searchFiles: query.trim() ? stateFor(key).searchFiles : [], searching: !!query.trim() }); renderExplorer();
  if (!query.trim()) return;
  searchTimerKey = key;
  searchTimer = setTimeout(function () { searchTimer = null; searchTimerKey = null; if (key !== workspaceKey() || stateFor(key).query !== query) { patchState(key, { searching: false }); return; } requestSearch(key, query); }, 160);
}
function createDocument() {
  saveScroll(); var key = workspaceKey(); var state = stateFor(key); var id = 'draft:' + Date.now() + ':' + requestCounter; var drafts = Object.assign({}, state.drafts);
  drafts[id] = { file: { name: '', common: false }, content: '', savedContent: '', revision: null, dirty: true, writable: true, newDocument: true, mode: 'edit', name: '', version: 0, error: '' };
  setState(key, Object.assign({}, state, { drafts: drafts, tabs: state.tabs.concat([id]), selected: id, selectionVersion: state.selectionVersion + 1, error: '' })); render();
  setTimeout(function () { var input = panel.querySelector('[data-document-name]'); if (input) input.focus(); }, 0);
}
function openDocument(id, replace) {
  saveScroll(); var key = workspaceKey(); var state = stateFor(key);
  if (state.drafts[id] && !replace) { setState(key, selectKnowledgeDocument(state, id)); render(); return; }
  var file = fileForId(state, id); if (!file) return; var ws = readySocket(key); if (!ws) return;
  var requestId = nextRequestId(); var begun = beginKnowledgeRead(state, file, requestId, replace === true);
  sendPrepared(key, 'knowledge_read', { name: file.name, common: !!file.common, ownMateId: file.ownMateId || null }, begun.pending, begun.state); render();
}
function selectTab(id, focusAfter) {
  saveScroll(); var key = workspaceKey(); setState(key, selectKnowledgeDocument(stateFor(key), id)); render();
  if (focusAfter) setTimeout(function () { var target = panel.querySelector('[data-select-tab="' + escapeAttr(id) + '"]'); if (target) target.focus(); }, 0);
}
function closeTab(id) {
  var key = workspaceKey(); var state = stateFor(key); var draft = state.drafts[id];
  var restoreFocus = document.activeElement && document.activeElement.closest('[data-close-tab]');
  if (state.selected === id && (!draft || !draft.dirty)) saveScroll(); var next = closeKnowledgeTab(state, id); setState(key, next); render();
  if (restoreFocus) setTimeout(function () { var target = next.selected && panel.querySelector('[data-select-tab="' + escapeAttr(next.selected) + '"]'); if (!target) target = panel.querySelector('[data-open-document], .knowledge-search input'); if (target) target.focus(); }, 0);
}
function handleAction(action, control) {
  var key = workspaceKey(); var state = stateFor(key); var draft = currentDraft(state); if (!draft) return;
  if (action === 'edit' || action === 'read') { saveScroll(); patchDraft(key, state.selected, { mode: action }); renderDocument(); renderToolbar(); }
  else if (action === 'save') saveDocument(); else if (action === 'rename') renameDocument();
  else if (action === 'delete') openDelete(control); else if (action === 'reload') openDocument(state.selected, true);
}
function saveDocument() {
  var key = workspaceKey(); var state = stateFor(key); var draft = currentDraft(state); if (!draft || !draft.writable || draft.savingRequest) return;
  var input = panel.querySelector('[data-document-name]'); var name = draft.newDocument ? safeName(input && input.value) : draft.file.name;
  if (!name) { patchDraft(key, state.selected, { error: 'Use a filename without folders or control characters.' }); renderToolbar(); return; }
  var ws = readySocket(key); if (!ws) { setState(key, failKnowledgeOffline(stateFor(key), state.selected, 'Reconnect to save this document.')); renderToolbar(); return; }
  var requestId = nextRequestId(); var begun = beginKnowledgeSave(state, state.selected, requestId, name);
  sendPrepared(key, 'knowledge_save', { name: name, content: draft.content, expectedRevision: draft.revision }, begun.pending, begun.state); renderToolbar();
}
function renameDocument() {
  var key = workspaceKey(); var state = stateFor(key); var draft = currentDraft(state); var input = panel.querySelector('[data-document-name]'); var name = safeName(input && input.value);
  if (!draft || !draft.writable || draft.newDocument || draft.savingRequest || !name || name === draft.file.name) return;
  if (!readySocket(key)) { setState(key, failKnowledgeOffline(stateFor(key), state.selected, 'Reconnect to rename this document.')); renderToolbar(); return; }
  var requestId = nextRequestId(); var begun = beginKnowledgeRename(state, state.selected, requestId, name);
  sendPrepared(key, 'knowledge_rename', { from: draft.file.name, name: name, expectedRevision: draft.revision }, begun.pending, begun.state); renderToolbar();
}
function openDelete(control) {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); if (!draft || !draft.writable || draft.newDocument) return;
  deleteTarget = { key: workspaceKey(), documentId: state.selected, name: draft.file.name, revision: draft.revision, returnFocus: control };
  panel.querySelector('.knowledge-topbar').inert = true; panel.querySelector('.knowledge-status').inert = true; panel.querySelector('.knowledge-layout').inert = true;
  var dialog = panel.querySelector('.knowledge-delete-dialog'); dialog.classList.remove('hidden'); dialog.querySelector('[data-delete-cancel]').focus();
}
function closeDelete() {
  if (!deleteTarget) return; var focus = deleteTarget.returnFocus; deleteTarget = null;
  panel.querySelector('.knowledge-topbar').inert = false; panel.querySelector('.knowledge-status').inert = false; panel.querySelector('.knowledge-layout').inert = false; panel.querySelector('.knowledge-delete-dialog').classList.add('hidden');
  if (focus && focus.isConnected) focus.focus();
}
function confirmDelete() {
  if (!deleteTarget) return; var target = deleteTarget; var key = target.key;
  if (!readySocket(key)) { closeDelete(); return; }
  var requestId = nextRequestId(); var begun = beginKnowledgeDelete(stateFor(key), target.documentId, requestId, target.revision);
  closeDelete(); sendPrepared(key, 'knowledge_delete', { name: target.name, expectedRevision: target.revision }, begun.pending, begun.state);
}
function retrySync() {
  var key = workspaceKey(); var retry = stateFor(key).syncRetry; if (!retry || !retry.names) return;
  simpleRequest('knowledge_sync', { names: retry.names }, { syncRetry: retry });
}

function renderShell() {
  var state = stateFor(workspaceKey()); panel.classList.toggle('knowledge-wide', state.wide); panel.classList.toggle('panel-fullscreen', state.fullscreen);
  panel.querySelector('[data-knowledge-wide]').setAttribute('aria-pressed', String(state.wide)); panel.querySelector('[data-knowledge-full]').setAttribute('aria-pressed', String(state.fullscreen));
}
function renderStatus() {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); var message = state.error || draft && draft.syncWarning || '';
  var status = panel.querySelector('.knowledge-status'); status.innerHTML = message ? escapeText(message) + (state.syncRetry ? ' <button type="button" data-sync-retry>Retry index sync</button>' : '') : '';
}
function renderExplorer() {
  if (!panel) return; var state = stateFor(workspaceKey()); var list = panel.querySelector('.knowledge-explorer-list'); var files = state.query.trim() ? state.searchFiles : state.files; list.innerHTML = '';
  panel.querySelector('[data-knowledge-count]').textContent = String(files.length);
  if ((state.loading && !state.files.length) || state.searching) list.innerHTML = '<p class="knowledge-empty">' + (state.searching ? 'Searching document text…' : 'Reading project documents…') + '</p>';
  else if (!files.length) list.innerHTML = '<p class="knowledge-empty">' + (state.query.trim() ? 'No matching names or document text' : 'No documents yet') + '</p>';
  files.forEach(function (file) { var id = documentIdentity(file); var button = document.createElement('button'); button.type = 'button'; button.className = 'knowledge-file-row'; button.dataset.openDocument = id; if (id === state.selected) button.setAttribute('aria-current', 'true'); button.innerHTML = iconHtml(file.name.endsWith('.jsonl') ? 'database' : 'file-text') + '<span>' + escapeText(file.name.replace(/\.(md|jsonl)$/i, '')) + '</span>' + (file.common ? '<small>shared</small>' : ''); list.appendChild(button); });
  list.scrollTop = state.explorerScroll || 0; refreshIcons(list);
}
function renderTabs() {
  var state = stateFor(workspaceKey()); var tabs = panel.querySelector('.knowledge-tabs'); tabs.innerHTML = '';
  state.tabs.forEach(function (id) { var draft = state.drafts[id]; if (!draft) return; var shell = document.createElement('div'); shell.className = 'knowledge-tab-shell';
    var label = draft.newDocument ? 'Untitled' : draft.file.name.replace(/\.md$/i, '');
    shell.innerHTML = '<button type="button" class="knowledge-tab" data-select-tab="' + escapeAttr(id) + '" role="tab" aria-selected="' + String(id === state.selected) + '" tabindex="' + (id === state.selected ? '0' : '-1') + '"><span>' + escapeText(label) + (draft.dirty ? ' •' : '') + '</span></button><button type="button" class="knowledge-tab-close" data-close-tab="' + escapeAttr(id) + '" aria-label="Close ' + escapeAttr(label) + ' tab">×</button>'; tabs.appendChild(shell); });
}
function renderToolbar() {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); var bar = panel.querySelector('.knowledge-document-toolbar'); bar.innerHTML = ''; if (!draft) return;
  var readOnly = !draft.writable; var suffix = draft.file.name && draft.file.name.endsWith('.jsonl') ? '.jsonl' : '.md'; var shownName = draft.name != null ? draft.name : (draft.newDocument ? '' : draft.file.name.replace(/\.(md|jsonl)$/i, ''));
  bar.innerHTML = '<label class="knowledge-name"><span class="sr-only">Document name</span><input data-document-name value="' + escapeAttr(shownName) + '" ' + (readOnly ? 'readonly' : '') + (draft.savingRequest ? ' disabled' : '') + '><span>' + suffix + '</span></label><div class="knowledge-view-toggle"><button type="button" data-document-action="edit" aria-pressed="' + String(draft.mode !== 'read') + '" ' + (readOnly ? 'disabled' : '') + '>Edit</button><button type="button" data-document-action="read" aria-pressed="' + String(draft.mode === 'read') + '">Read</button></div>' + (!readOnly ? '<button type="button" data-document-action="rename" ' + (draft.newDocument || draft.savingRequest ? 'disabled' : '') + '>Rename</button><button type="button" data-document-action="save" class="primary" ' + (!draft.dirty || draft.savingRequest ? 'disabled' : '') + '>' + (draft.savingRequest ? 'Saving…' : 'Save') + '</button><button type="button" data-document-action="delete" class="danger" ' + (draft.newDocument || draft.savingRequest ? 'disabled' : '') + ' aria-label="Delete document">' + iconHtml('trash-2') + '</button>' : '<span class="knowledge-readonly">Read only</span>');
  if (draft.error) bar.insertAdjacentHTML('beforeend', '<span class="knowledge-inline-error">' + escapeText(draft.error) + (draft.conflict ? ' <button type="button" data-document-action="reload">Reload disk version</button>' : '') + '</span>'); refreshIcons(bar);
}
function renderDocument(forceReplace, preserveFromId) {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); var body = panel.querySelector('.knowledge-document-body'); var mode = draft && (draft.mode === 'read' || !draft.writable) ? 'read' : 'edit';
  var sameDocument = draft && (body.dataset.knowledgeDocumentId === state.selected || body.dataset.knowledgeDocumentId === preserveFromId);
  if (!forceReplace && sameDocument && body.dataset.knowledgeDocumentMode === mode && body.dataset.knowledgeDocumentWritable === String(!!draft.writable)) {
    body.dataset.knowledgeDocumentId = state.selected; return;
  }
  body.innerHTML = ''; body.dataset.knowledgeDocumentId = draft ? state.selected : ''; body.dataset.knowledgeDocumentMode = draft ? mode : ''; body.dataset.knowledgeDocumentWritable = draft ? String(!!draft.writable) : '';
  if (!draft) { body.innerHTML = '<div class="knowledge-welcome"><i data-lucide="book-open"></i><h2>Knowledge</h2><p>Open a document from the explorer or create a new Markdown note.</p></div>'; refreshIcons(body); return; }
  if (draft.mode === 'read' || !draft.writable) { var preview = document.createElement('article'); preview.className = 'knowledge-preview md-content'; preview.dataset.knowledgePreview = ''; preview.innerHTML = renderMarkdown(draft.content || ''); body.appendChild(preview); highlightCodeBlocks(preview); preview.scrollTop = draft.readScroll || 0; }
  else { var editor = document.createElement('textarea'); editor.className = 'knowledge-editor'; editor.dataset.knowledgeEditor = ''; editor.spellcheck = true; editor.value = draft.content || ''; body.appendChild(editor); editor.scrollTop = draft.editScroll || 0; }
}
function renderDetails() {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); var outline = panel.querySelector('[data-detail-content="outline"]'); var linkBox = panel.querySelector('[data-detail-content="links"]'); outline.innerHTML = ''; linkBox.innerHTML = '';
  if (!draft) { outline.innerHTML = '<p>Open a document to see its outline.</p>'; linkBox.innerHTML = '<p>Document links appear here.</p>'; return; }
  var outlineItems = headings(draft.content); outline.innerHTML = outlineItems.length ? outlineItems.map(function (item) { return '<div class="knowledge-outline-item depth-' + item.depth + '">' + escapeText(item.text) + '</div>'; }).join('') : '<p>No headings</p>';
  var outbound = links(draft.content); var inbound = backlinks(state, state.selected); var parts = [];
  if (outbound.length) parts.push('<small>OUTGOING</small>' + outbound.map(function (item) { var target = internalTarget(state, item.href); return target ? '<button type="button" class="knowledge-link-item" data-open-document="' + escapeAttr(target) + '">' + iconHtml('link-2') + '<span>' + escapeText(item.label) + '</span></button>' : '<div class="knowledge-link-item">' + iconHtml('link-2') + '<span>' + escapeText(item.label) + '</span></div>'; }).join(''));
  if (inbound.length) parts.push('<small>BACKLINKS FROM LOADED DOCUMENTS</small>' + inbound.map(function (id) { var linked = state.drafts[id]; var label = linked.file.name.replace(/\.md$/i, ''); return '<button type="button" class="knowledge-link-item" data-select-tab="' + escapeAttr(id) + '">' + iconHtml('corner-up-left') + '<span>' + escapeText(label) + '</span></button>'; }).join(''));
  linkBox.innerHTML = parts.join('') || '<p>No document links</p>'; refreshIcons(linkBox);
}
function render(options) { if (!panel || panel.classList.contains('hidden')) return; var state = stateFor(workspaceKey()); var settings = options || {}; renderShell(); renderStatus(); panel.querySelector('.knowledge-search input').value = state.query; renderExplorer(); renderTabs(); renderToolbar(); renderDocument(settings.forceDocument === true, settings.preserveFromId); renderDetails(); }
function escapeText(value) { var span = document.createElement('span'); span.textContent = String(value || ''); return span.innerHTML; }
function escapeAttr(value) { return escapeText(value).replace(/"/g, '&quot;'); }

function setNarrowBackground(active) {
  if (!panel) return; var narrow = active && window.matchMedia('(max-width: 1023px)').matches;
  if (narrow && !narrowInert.length) {
    var branch = panel;
    while (branch.parentElement && branch.parentElement !== document.body) {
      Array.prototype.forEach.call(branch.parentElement.children, function (child) { if (child === branch) return; narrowInert.push({ element: child, inert: child.inert, ariaHidden: child.getAttribute('aria-hidden') }); child.inert = true; child.setAttribute('aria-hidden', 'true'); });
      branch = branch.parentElement;
    }
  }
  if (!narrow && narrowInert.length) { narrowInert.forEach(function (item) { item.element.inert = item.inert; if (item.ariaHidden == null) item.element.removeAttribute('aria-hidden'); else item.element.setAttribute('aria-hidden', item.ariaHidden); }); narrowInert = []; }
}
export function openKnowledgeWorkbench() {
  ensurePanel(); if (!panel || !isMateWorkspace(store.snap())) return; returnFocus = document.activeElement;
  claimRightWorkbench('mate-knowledge'); panel.classList.remove('hidden'); setNarrowBackground(true); var button = document.getElementById('knowledge-workbench-btn'); if (button) button.classList.add('active');
  var key = workspaceKey(); patchState(key, { loading: true, error: '' }); simpleRequest('knowledge_list'); if (stateFor(key).query.trim()) { patchState(key, { searching: true }); requestSearch(key, stateFor(key).query); } render(); setTimeout(function () { var search = panel.querySelector('.knowledge-search input'); if (search) search.focus(); }, 0);
}
export function closeKnowledgeWorkbench(skipSave) {
  if (!panel) return; var active = document.activeElement; var shouldReturn = skipSave !== true && (!active || active === document.body || panel.contains(active));
  cancelScheduledSearch(); if (deleteTarget) closeDelete(); if (skipSave !== true) saveScroll(); panel.classList.add('hidden'); setNarrowBackground(false); releaseRightWorkbench('mate-knowledge');
  var button = document.getElementById('knowledge-workbench-btn'); if (button) button.classList.remove('active'); if (shouldReturn && returnFocus && returnFocus.isConnected) returnFocus.focus(); returnFocus = null;
}
export function initMateKnowledgeWorkbench() {
  ensurePanel(); registerRightWorkbench('mate-knowledge', closeKnowledgeWorkbench); var button = ensureButton(); if (button) button.addEventListener('click', function () { if (panel.classList.contains('hidden')) openKnowledgeWorkbench(); else closeKnowledgeWorkbench(); });
  store.subscribe(function (state, previous) { if (state.currentSlug !== previous.currentSlug) { saveScroll(previous.currentSlug); closeKnowledgeWorkbench(true); } });
  window.addEventListener('resize', function () { if (panel && !panel.classList.contains('hidden')) setNarrowBackground(true); });
}
export function handleKnowledgeWorkbenchMessage(msg) {
  var tracked = msg.requestId && pending[msg.requestId]; if (!tracked) return false; delete pending[msg.requestId]; var key = tracked.key; var state = stateFor(key); var forceDocument = false;
  if (msg.type === 'knowledge_list') { setState(key, Object.assign({}, state, { files: msg.files || [], loading: false, error: '' })); if (key === workspaceKey()) render(); return true; }
  if (msg.type === 'knowledge_search_results') { if (state.query === tracked.query) setState(key, Object.assign({}, state, { searchFiles: msg.files || [], searching: false })); if (key === workspaceKey()) render(); return true; }
  if (msg.type === 'knowledge_content') { var beforeRead = state.drafts[tracked.documentId]; var readState = applyKnowledgeRead(state, tracked, msg); forceDocument = tracked.replace === true && readState.drafts[tracked.documentId] !== beforeRead; setState(key, readState); }
  else if (msg.type === 'knowledge_saved') setState(key, applyKnowledgeSave(state, tracked, msg));
  else if (msg.type === 'knowledge_renamed') setState(key, applyKnowledgeRename(state, tracked, msg));
  else if (msg.type === 'knowledge_deleted') setState(key, applyKnowledgeDelete(state, tracked, msg));
  else if (msg.type === 'knowledge_synced') { var drafts = Object.assign({}, state.drafts); Object.keys(drafts).forEach(function (id) { if (drafts[id].syncWarning) drafts[id] = Object.assign({}, drafts[id], { syncWarning: '' }); }); setState(key, Object.assign({}, state, { drafts: drafts, syncRetry: null, error: '' })); }
  else if (msg.type === 'knowledge_error') { if (tracked.type === 'knowledge_sync') setState(key, Object.assign({}, state, { error: msg.error || 'Knowledge index synchronization is still pending.' })); else setState(key, failKnowledgeRequest(state, tracked, msg)); }
  else return false;
  if (key === workspaceKey()) { if (['knowledge_saved', 'knowledge_renamed', 'knowledge_deleted'].indexOf(msg.type) !== -1) simpleRequest('knowledge_list'); render({ forceDocument: forceDocument, preserveFromId: ['knowledge_saved', 'knowledge_renamed'].indexOf(msg.type) !== -1 ? tracked.documentId : null }); }
  return true;
}
