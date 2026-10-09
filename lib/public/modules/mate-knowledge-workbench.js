import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { isMateWorkspace } from './project-mate-navigation.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';
import { mountKnowledgeEditor, captureKnowledgeEditor, destroyKnowledgeEditor, scrollKnowledgeEditor } from './knowledge-markdown-editor.js';
import { decorateKnowledgePreview } from './knowledge-preview-links.js';
import { setKnowledgeNarrowBackground } from './knowledge-workbench-shell.js';
import { configureKnowledgeDbWorkbench, openKnowledgeDatabase, showKnowledgeCreateMenu, beginKnowledgeDatabaseRecovery, handleKnowledgeDbClick, handleKnowledgeDbInput, handleKnowledgeDbKeydown, renderKnowledgeDatabase, handleKnowledgeDbMessage } from './knowledge-db-workbench.js';
import {
  liveHistoryTarget, deletedHistoryTarget, beginHistoryRequest, receiveHistoryVersions,
  beginHistoryPreview, receiveHistoryPreview, clearHistoryView, historyToolbarHtml, historyVersionsHtml,
} from './knowledge-history-state.js';
import {
  documentIdentity, blankKnowledgeState, selectKnowledgeDocument, editKnowledgeDraft,
  failKnowledgeOffline, closeKnowledgeTab,
  beginKnowledgeRead, applyKnowledgeRead, beginKnowledgeSave, applyKnowledgeSave,
  beginKnowledgeRename, applyKnowledgeRename, beginKnowledgeDelete, applyKnowledgeDelete,
  applyKnowledgeDiscard, failKnowledgeRequest,
} from './mate-knowledge-workbench-state.js';

var panel = null; var requestCounter = 0; var pending = {}; var searchTimer = null; var searchTimerKey = null;
var returnFocus = null; var deleteTarget = null; var draftSaveTimers = {}; var pendingHeading = null;

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
function requestForKey(key, type, details, tracked, nextState) {
  var requestId = nextRequestId();
  return sendPrepared(key, type, details, Object.assign({ requestId: requestId }, tracked || {}), nextState) ? requestId : null;
}
function safeName(value) {
  var name = String(value || '').trim(); if (!name) return '';
  if (!/\.md$/i.test(name)) name += '.md';
  return /^(?!\/)(?!.*(?:^|\/)\.\.?\/)(?!.*\/\.\.?$)[^\\\x00-\x1f\x7f]{1,500}\.md$/i.test(name) ? name.replace(/^\.\//, '') : '';
}
function saveScroll(keyOverride) {
  if (!panel) return; var key = keyOverride || workspaceKey(); var state = stateFor(key); var id = state.selected; if (!id) return;
  var draft = state.drafts[id]; if (!draft) return;
  var editorState = captureKnowledgeEditor(); var preview = panel.querySelector('[data-knowledge-preview]');
  patchDraft(key, id, { content: editorState ? editorState.content : draft.content, cursor: editorState ? editorState.cursor : draft.cursor,
    editorHistory: editorState ? editorState.history : draft.editorHistory, editScroll: editorState ? editorState.scroll : draft.editScroll || 0,
    readScroll: preview ? preview.scrollTop : draft.readScroll || 0 });
  patchState(key, { explorerScroll: panel.querySelector('.knowledge-explorer-list').scrollTop });
}
function headings(content) {
  var lines = String(content || '').split('\n'); var out = [];
  for (var i = 0; i < lines.length; i++) { var match = /^(#{1,4})\s+(.+?)\s*$/.exec(lines[i]); if (match) out.push({ depth: match[1].length, text: match[2].replace(/[*_`]/g, '') }); }
  return out;
}

function ensurePanel() {
  if (panel) return; var host = document.getElementById('main-panels'); if (!host) return;
  panel = document.createElement('section'); panel.id = 'mate-knowledge-workbench'; panel.className = 'hidden'; panel.setAttribute('aria-label', 'Mate Knowledge');
  panel.innerHTML = '<header class="knowledge-topbar"><span class="knowledge-title">' + iconHtml('book-open') + 'Knowledge</span><span class="knowledge-subtitle">Documents in this Mate project</span><button type="button" data-knowledge-deleted title="Recover deleted documents" aria-label="Recover deleted documents">' + iconHtml('history') + '</button><button type="button" data-knowledge-new title="New document" aria-label="New document">' + iconHtml('file-plus-2') + '</button><button type="button" data-knowledge-wide title="Widen Knowledge" aria-label="Widen Knowledge" aria-pressed="false">' + iconHtml('chevrons-left-right') + '</button><button type="button" data-knowledge-full title="Toggle fullscreen" aria-label="Toggle Knowledge fullscreen" aria-pressed="false">' + iconHtml('maximize-2') + '</button><button type="button" data-knowledge-close title="Close Knowledge" aria-label="Close Knowledge">' + iconHtml('x') + '</button></header><div class="knowledge-status" role="status"></div><div class="knowledge-layout"><aside class="knowledge-explorer"><label class="knowledge-search">' + iconHtml('search') + '<input type="search" placeholder="Search names and contents" aria-label="Search Knowledge document names and contents"></label><div class="knowledge-explorer-heading"><span>Documents</span><span data-knowledge-count></span></div><div class="knowledge-explorer-list" role="list"></div></aside><main class="knowledge-document"><div class="knowledge-tabs" role="tablist" aria-label="Open Knowledge documents"></div><div class="knowledge-document-toolbar"></div><div class="knowledge-document-body"></div></main><aside class="knowledge-details"><div class="knowledge-detail-section"><button type="button" class="knowledge-detail-heading" aria-expanded="true" data-detail-toggle="outline">Outline' + iconHtml('chevron-down') + '</button><div data-detail-content="outline"></div></div><div class="knowledge-detail-section"><button type="button" class="knowledge-detail-heading" aria-expanded="true" data-detail-toggle="links">Links' + iconHtml('chevron-down') + '</button><div data-detail-content="links"></div></div><div class="knowledge-detail-section"><button type="button" class="knowledge-detail-heading" aria-expanded="true" data-detail-toggle="history">History' + iconHtml('chevron-down') + '</button><div data-detail-content="history"></div></div></aside></div><div class="knowledge-delete-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="knowledge-delete-title"><div><h2 id="knowledge-delete-title">Delete this document?</h2><p>The file will be removed from this Mate project. Existing record history remains available to shared Knowledge.</p><div><button type="button" data-delete-cancel>Cancel</button><button type="button" class="danger" data-delete-confirm>Delete</button></div></div></div>';
  var newButton = panel.querySelector('[data-knowledge-new]'); newButton.insertAdjacentHTML('beforebegin', '<button type="button" data-knowledge-back title="Back" aria-label="Previous document">' + iconHtml('arrow-left') + '</button><button type="button" data-knowledge-forward title="Forward" aria-label="Next document">' + iconHtml('arrow-right') + '</button>');
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
  panel.querySelector('[data-knowledge-new]').addEventListener('click', function () { showKnowledgeCreateMenu(panel); });
  panel.querySelector('[data-knowledge-deleted]').addEventListener('click', function () { simpleRequest('knowledge_deleted_list'); });
  panel.querySelector('[data-knowledge-back]').addEventListener('click', function () { navigateHistory('back'); });
  panel.querySelector('[data-knowledge-forward]').addEventListener('click', function () { navigateHistory('forward'); });
  panel.querySelector('.knowledge-search input').addEventListener('input', scheduleSearch);
  panel.querySelector('[data-knowledge-wide]').addEventListener('click', function () { var key = workspaceKey(); patchState(key, { wide: !stateFor(key).wide }); renderShell(); });
  panel.querySelector('[data-knowledge-full]').addEventListener('click', exitEditor);
  panel.querySelector('[data-delete-cancel]').addEventListener('click', closeDelete);
  panel.querySelector('[data-delete-confirm]').addEventListener('click', confirmDelete);
  panel.addEventListener('click', handlePanelClick);
  panel.addEventListener('input', function (event) {
    if (handleKnowledgeDbInput(event)) return;
    var key = workspaceKey(); var state = stateFor(key); var id = state.selected;
    if (event.target.matches('[data-document-name]')) { setState(key, editKnowledgeDraft(state, id, { name: event.target.value })); scheduleDraftSave(key, id); }
  });
  panel.addEventListener('keydown', handlePanelKeydown);
}
function handlePanelClick(event) {
  var dbAction = handleKnowledgeDbClick(event, panel); if (dbAction === true) return; if (dbAction === 'document') { createDocument(); return; }
  var close = event.target.closest('[data-close-tab]'); if (close) { closeTab(close.dataset.closeTab); return; }
  var select = event.target.closest('[data-select-tab]'); if (select) { selectTab(select.dataset.selectTab, true); return; }
  var open = event.target.closest('[data-open-document]'); if (open) { pendingHeading = open.dataset.openHeading || null; openDocument(open.dataset.openDocument); if (pendingHeading) setTimeout(scrollPendingHeading, 0); return; }
  var outlineTarget = event.target.closest('[data-outline-heading]'); if (outlineTarget) { pendingHeading = outlineTarget.dataset.outlineHeading; scrollPendingHeading(); return; }
  var action = event.target.closest('[data-document-action]'); if (action) { handleAction(action.dataset.documentAction, action); return; }
  var createLink = event.target.closest('[data-create-linked]'); if (createLink) { createDocument(createLink.dataset.createLinked); return; }
  var historyLoad = event.target.closest('[data-history-load]'); if (historyLoad) { loadHistory(); return; }
  var historyPreview = event.target.closest('[data-history-preview]'); if (historyPreview) { previewHistory(historyPreview.dataset.historyPreview); return; }
  var historyRestore = event.target.closest('[data-history-restore]'); if (historyRestore) { restoreHistory(historyRestore.dataset.historyRestore); return; }
  var recoverDatabase = event.target.closest('[data-db-recover-database]'); if (recoverDatabase) { beginKnowledgeDatabaseRecovery(panel, { id: recoverDatabase.dataset.dbRecoverDatabase, name: recoverDatabase.dataset.dbRecoverName, revision: Number(recoverDatabase.dataset.dbRecoverRevision) }); return; }
  var deletedHistory = event.target.closest('[data-deleted-history]'); if (deletedHistory) { loadDeletedHistory(deletedHistory.dataset.deletedHistory, deletedHistory.dataset.deletedName); return; }
  if (event.target.closest('[data-search-more]')) { loadMoreSearch(); return; }
  if (event.target.closest('[data-history-review]')) { reviewHistoryRestore(); return; }
  var toggle = event.target.closest('[data-detail-toggle]'); if (toggle) { var content = panel.querySelector('[data-detail-content="' + toggle.dataset.detailToggle + '"]'); var expanded = toggle.getAttribute('aria-expanded') !== 'false'; toggle.setAttribute('aria-expanded', String(!expanded)); content.hidden = expanded; return; }
  if (event.target.closest('[data-sync-retry]')) retrySync();
}
function handlePanelKeydown(event) {
  if (handleKnowledgeDbKeydown(event, panel)) return;
  if (deleteTarget) { trapDeleteFocus(event); return; }
  var tab = event.target.closest('[data-select-tab]');
  if (event.target.matches('.knowledge-search input') && event.key === 'Enter') { var searchState = stateFor(workspaceKey()); var results = searchState.query.trim() ? searchState.searchFiles : searchState.files; if (results.length) { event.preventDefault(); openDocument(documentIdentity(results[0])); } return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); panel.querySelector('.knowledge-search input').focus(); return; }
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
function requestSearch(key, query, offset, append) {
  if (key !== workspaceKey() || !panel || panel.classList.contains('hidden')) { patchState(key, { searching: false }); return; }
  var requestId = nextRequestId(); var tracked = { requestId: requestId, query: query, offset: offset || 0, append: append === true };
  if (!sendPrepared(key, 'knowledge_search', { query: query, offset: offset || 0, limit: 50 }, tracked, null)) patchState(key, { searching: false });
}
function loadMoreSearch() {
  var key = workspaceKey(); var state = stateFor(key); if (state.searching || !state.query.trim() || state.searchFiles.length >= state.searchTotal) return;
  patchState(key, { searching: true }); requestSearch(key, state.query, state.searchFiles.length, true); renderExplorer();
}
function scheduleSearch(event) {
  var key = workspaceKey(); var query = event.target.value; cancelScheduledSearch();
  patchState(key, { query: query, searchFiles: query.trim() ? stateFor(key).searchFiles : [], searching: !!query.trim() }); renderExplorer();
  if (!query.trim()) return;
  searchTimerKey = key;
  searchTimer = setTimeout(function () { searchTimer = null; searchTimerKey = null; if (key !== workspaceKey() || stateFor(key).query !== query) { patchState(key, { searching: false }); return; } requestSearch(key, query, 0, false); }, 160);
}
function createDocument(suggestedName) {
  saveScroll(); var key = workspaceKey(); var state = stateFor(key); var id = 'draft:' + Date.now() + ':' + requestCounter; var drafts = Object.assign({}, state.drafts);
  var suggestion = typeof suggestedName === 'string' ? suggestedName.replace(/\.md$/i, '') : '';
  if (suggestion && state.selected && state.drafts[state.selected] && suggestion.indexOf('/') !== 0) {
    var currentName = state.drafts[state.selected].file.name || ''; var folder = currentName.indexOf('/') === -1 ? '' : currentName.slice(0, currentName.lastIndexOf('/') + 1);
    suggestion = new URL(folder + suggestion + '.md', 'https://clay.invalid/').pathname.replace(/^\//, '').replace(/\.md$/i, '');
  }
  drafts[id] = { file: { id: id, name: '', common: false, itemType: 'text' }, content: '', savedContent: '', revision: null, dirty: true, writable: true, newDocument: true, mode: 'edit', name: suggestion, version: 0, error: '' };
  setState(key, Object.assign({}, state, { drafts: drafts, tabs: state.tabs.concat([id]), selected: id, selectionVersion: state.selectionVersion + 1, fullscreen: true, error: '' })); render({ forceDocument: true });
  setTimeout(function () { var input = panel.querySelector('[data-document-name]'); if (input) input.focus(); }, 0);
}
function openDocument(id, replace, skipHistory) {
  saveScroll(); var key = workspaceKey(); var state = stateFor(key);
  var back = state.navigationBack || []; var forward = state.navigationForward || [];
  if (!skipHistory && state.selected && state.selected !== id) { back = back.concat([state.selected]).slice(-50); forward = []; }
  if (state.drafts[id] && !replace) { var selectedState = selectKnowledgeDocument(state, id); selectedState.fullscreen = false; selectedState.drafts[id].mode = 'read'; selectedState.navigationBack = back; selectedState.navigationForward = forward; setState(key, selectedState); render({ forceDocument: true }); return; }
  var file = fileForId(state, id); if (!file) return; var ws = readySocket(key); if (!ws) return;
  if (file.itemType === 'db') { var dbDrafts = Object.assign({}, state.drafts); dbDrafts[id] = dbDrafts[id] || { file: file, content: '', writable: file.writable !== false, dirty: false, mode: 'read' }; var dbTabs = state.tabs.indexOf(id) === -1 ? state.tabs.concat([id]) : state.tabs; setState(key, Object.assign({}, state, { drafts: dbDrafts, tabs: dbTabs, selected: id, fullscreen: false, navigationBack: back, navigationForward: forward })); openKnowledgeDatabase(file); render({ forceDocument: true }); return; }
  var requestId = nextRequestId(); var begun = beginKnowledgeRead(state, file, requestId, replace === true);
  begun.state.fullscreen = false; begun.state.navigationBack = back; begun.state.navigationForward = forward;
  sendPrepared(key, 'knowledge_read', { name: file.name, documentId: file.id || null, common: !!file.common, ownMateId: file.ownMateId || null }, begun.pending, begun.state); render();
}
function navigateHistory(direction) {
  var key = workspaceKey(); var state = stateFor(key); var back = state.navigationBack || []; var forward = state.navigationForward || [];
  var source = direction === 'back' ? back : forward; if (!source.length) return; var id = source[source.length - 1];
  if (direction === 'back') { back = back.slice(0, -1); if (state.selected) forward = forward.concat([state.selected]); }
  else { forward = forward.slice(0, -1); if (state.selected) back = back.concat([state.selected]); }
  setState(key, Object.assign({}, state, { navigationBack: back, navigationForward: forward })); openDocument(id, false, true);
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
  var key = workspaceKey(); var state = stateFor(key); var draft = currentDraft(state);
  if (action === 'history-exit') { setState(key, Object.assign({}, clearHistoryView(state), { fullscreen: false })); render({ forceDocument: true }); return; }
  if (!draft) return;
  if (action === 'edit') enterEditor(); else if (action === 'read') exitEditor();
  else if (action === 'save') saveDocument(); else if (action === 'rename') renameDocument();
  else if (action === 'delete') openDelete(control); else if (action === 'reload') discardDraft();
  else if (action === 'keep') { patchDraft(key, state.selected, { conflict: false, revision: draft.diskRevision || draft.revision, error: '' }); renderToolbar(); }
}

function loadHistory() {
  var key = workspaceKey(); var state = stateFor(key); var target = liveHistoryTarget(state.selected, currentDraft(state)); if (!target) return;
  var requestId = nextRequestId(); var tracked = { requestId: requestId, documentId: target.documentKey, historyTarget: target };
  sendPrepared(key, 'knowledge_history', { documentId: target.documentId }, tracked, beginHistoryRequest(state, target, requestId)); renderDetails();
}
function loadDeletedHistory(documentId, name) {
  var key = workspaceKey(); var state = stateFor(key); var target = deletedHistoryTarget(documentId, name); if (!target) return;
  var requestId = nextRequestId(); var tracked = { requestId: requestId, documentId: null, historyTarget: target };
  sendPrepared(key, 'knowledge_history', { documentId: target.documentId }, tracked, beginHistoryRequest(state, target, requestId)); renderDetails();
}
function previewHistory(version) {
  var key = workspaceKey(); var state = stateFor(key); var target = state.historyView; if (!target) return;
  var requestId = nextRequestId(); var tracked = { requestId: requestId, documentId: target.documentKey, historyTarget: Object.assign({}, target, { preview: null }), historyVersion: version };
  sendPrepared(key, 'knowledge_history_read', { documentId: target.documentId, version: version }, tracked, beginHistoryPreview(state, requestId)); renderDetails();
}
function reviewHistoryRestore() {
  var key = workspaceKey(); var state = stateFor(key); if (!state.historyView || !state.historyView.preview) return;
  patchState(key, { fullscreen: true }); render({ forceDocument: true });
}
function restoreHistory(version) {
  var key = workspaceKey(); var state = stateFor(key); var target = state.historyView; if (!state.fullscreen || !target || !target.preview || target.preview.version !== version) return;
  var targetDraft = target.documentKey && state.drafts[target.documentKey];
  if (targetDraft && targetDraft.dirty) { patchState(key, { error: 'Save or discard the current draft before restoring its history.' }); renderStatus(); return; }
  requestForKey(key, 'knowledge_restore', { documentId: target.documentId, version: version, name: target.name, expectedRevision: target.revision },
    { documentId: target.documentKey, historyRestore: true, historyTarget: target });
}
function readRestoredDocument(key, msg) {
  var previous = stateFor(key); var state = Object.assign({}, clearHistoryView(previous), { fullscreen: false, error: '', deletedFiles: (previous.deletedFiles || []).filter(function (item) { return item.id !== msg.id; }) });
  var file = { id: msg.id, name: msg.name, common: false, itemType: 'text', revision: msg.revision }; var id = documentIdentity(file); var files = state.files.slice(); var found = false;
  files = files.map(function (item) { if (documentIdentity(item) !== id) return item; found = true; return Object.assign({}, item, file); }); if (!found) files.push(file); state.files = files;
  if (key !== workspaceKey()) { setState(key, state); return; }
  var requestId = nextRequestId(); var begun = beginKnowledgeRead(state, file, requestId, true);
  sendPrepared(key, 'knowledge_read', { name: file.name, documentId: file.id, common: false, ownMateId: null }, begun.pending, begun.state);
}
function discardDraft() {
  var key = workspaceKey(); var state = stateFor(key); var draft = currentDraft(state); if (!draft || draft.newDocument) return;
  var requestId = nextRequestId(); sendPrepared(key, 'knowledge_discard_draft', { documentId: draft.file.id, name: draft.file.name,
    expectedRevision: draft.diskRevision || draft.revision, throughVersion: Math.max(draft.version || 0, draft.draftVersion || 0) }, { requestId: requestId, documentId: state.selected, submittedVersion: draft.version || 0 }, null);
}
function enterEditor() {
  var key = workspaceKey(); var state = stateFor(key); var draft = currentDraft(state); if (!draft || !draft.writable) return;
  saveScroll(); patchDraft(key, state.selected, { mode: 'edit' }); patchState(key, { fullscreen: true }); render({ forceDocument: true });
}
function exitEditor() {
  var key = workspaceKey(); var state = stateFor(key); if (!state.fullscreen) return;
  saveScroll(); patchDraft(key, state.selected, { mode: 'read' }); patchState(key, { fullscreen: false }); destroyKnowledgeEditor(); render({ forceDocument: true });
}
function scheduleDraftSave(key, id) {
  var timerKey = key + ':' + id; clearTimeout(draftSaveTimers[timerKey]);
  draftSaveTimers[timerKey] = setTimeout(function () { delete draftSaveTimers[timerKey]; saveDraftNow(key, id); }, 600);
}
function saveDraftNow(key, id) {
  var state = stateFor(key); var draft = state.drafts[id]; if (!draft || !draft.dirty || !draft.writable) return false;
  if (key !== workspaceKey() || !getWs() || getWs().readyState !== 1) { patchDraft(key, id, { draftState: 'retry', error: draft.error || 'Draft will retry after reconnect.' }); return false; }
  var requestId = nextRequestId(); var version = draft.version || 0; patchDraft(key, id, { draftState: 'pending' });
  return sendPrepared(key, 'knowledge_draft_save', { documentId: draft.file.id || id, name: draft.newDocument ? draft.name : draft.file.name, content: draft.content,
    baseRevision: draft.conflictRevision !== undefined ? draft.conflictRevision : draft.revision, cursor: draft.cursor || null,
    clientVersion: version, newDocument: draft.newDocument === true }, { requestId: requestId, documentId: id, submittedVersion: version }, null);
}
function cancelDraftSaves(key) {
  Object.keys(draftSaveTimers).forEach(function (timerKey) { if (timerKey.indexOf(key + ':') !== 0) return; clearTimeout(draftSaveTimers[timerKey]); delete draftSaveTimers[timerKey]; });
}
function saveDocument() {
  var key = workspaceKey(); var state = stateFor(key); var draft = currentDraft(state); if (!draft || !draft.writable || draft.savingRequest || draft.conflict) return;
  var input = panel.querySelector('[data-document-name]'); var name = draft.newDocument ? safeName(input && input.value) : draft.file.name;
  if (!name) { patchDraft(key, state.selected, { error: 'Use a valid Markdown path without traversal or control characters.' }); renderToolbar(); return; }
  var ws = readySocket(key); if (!ws) { setState(key, failKnowledgeOffline(stateFor(key), state.selected, 'Reconnect to save this document.')); renderToolbar(); return; }
  var requestId = nextRequestId(); var begun = beginKnowledgeSave(state, state.selected, requestId, name);
  sendPrepared(key, 'knowledge_save', { documentId: draft.file.id || state.selected, name: name, content: draft.content, expectedRevision: draft.revision,
    draftVersion: begun.pending.draftVersion }, begun.pending, begun.state); renderToolbar();
}
function renameDocument() {
  var key = workspaceKey(); var state = stateFor(key); var draft = currentDraft(state); var input = panel.querySelector('[data-document-name]'); var name = safeName(input && input.value);
  if (!draft || !draft.writable || draft.newDocument || draft.savingRequest || draft.dirty || !name || name === draft.file.name) return;
  if (!readySocket(key)) { setState(key, failKnowledgeOffline(stateFor(key), state.selected, 'Reconnect to rename this document.')); renderToolbar(); return; }
  var requestId = nextRequestId(); var begun = beginKnowledgeRename(state, state.selected, requestId, name);
  sendPrepared(key, 'knowledge_rename', { documentId: draft.file.id || null, from: draft.file.name, name: name, expectedRevision: draft.revision }, begun.pending, begun.state); renderToolbar();
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
  panel.querySelector('[data-knowledge-full]').hidden = !state.fullscreen; panel.querySelector('[data-knowledge-wide]').hidden = state.fullscreen;
  panel.querySelector('[data-knowledge-back]').disabled = !(state.navigationBack || []).length; panel.querySelector('[data-knowledge-forward]').disabled = !(state.navigationForward || []).length;
}
function renderStatus() {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); var message = state.error || draft && (draft.syncWarning || draft.indexWarning) || '';
  var status = panel.querySelector('.knowledge-status'); status.innerHTML = message ? escapeText(message) + (state.syncRetry ? ' <button type="button" data-sync-retry>Retry index sync</button>' : '') : '';
}
function renderExplorer() {
  if (!panel) return; var state = stateFor(workspaceKey()); var list = panel.querySelector('.knowledge-explorer-list'); var files = state.query.trim() ? state.searchFiles : state.files; list.innerHTML = '';
  panel.querySelector('[data-knowledge-count]').textContent = state.query.trim() && state.searchTotal > files.length ? files.length + ' of ' + state.searchTotal : String(files.length);
  if ((state.loading && !state.files.length) || state.searching) list.innerHTML = '<p class="knowledge-empty">' + (state.searching ? 'Searching document text…' : 'Reading project documents…') + '</p>';
  else if (!files.length) list.innerHTML = '<p class="knowledge-empty">' + (state.query.trim() ? 'No matching names or document text' : 'No documents yet') + '</p>';
  var lastFolder = null;
  files.forEach(function (file) {
    var parts = file.name.split('/'); var folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!state.query.trim() && folder !== lastFolder) { var folderRow = document.createElement('div'); folderRow.className = 'knowledge-folder-row'; folderRow.innerHTML = iconHtml('folder') + '<span>' + escapeText(folder || 'Top level') + '</span>'; list.appendChild(folderRow); lastFolder = folder; }
    var id = documentIdentity(file); var button = document.createElement('button'); button.type = 'button'; button.className = 'knowledge-file-row'; button.dataset.openDocument = id; button.style.setProperty('--knowledge-depth', String(Math.min(parts.length - 1, 6))); if (id === state.selected) button.setAttribute('aria-current', 'true');
    button.innerHTML = iconHtml(file.itemType === 'db' || file.name.endsWith('.jsonl') ? 'database' : 'file-text') + '<span>' + escapeText(parts[parts.length - 1].replace(/\.(md|jsonl)$/i, '')) + (file.snippet ? '<em>' + escapeText(file.snippet) + '</em>' : '') + '</span>' + (file.common ? '<small>shared</small>' : ''); list.appendChild(button);
  });
  if (state.query.trim() && state.searchFiles.length < state.searchTotal) { var more = document.createElement('button'); more.type = 'button'; more.className = 'knowledge-search-more'; more.dataset.searchMore = ''; more.disabled = state.searching; more.textContent = state.searching ? 'Loading more…' : 'Load more results'; list.appendChild(more); }
  list.scrollTop = state.explorerScroll || 0; refreshIcons(list);
}
function renderTabs() {
  var state = stateFor(workspaceKey()); var tabs = panel.querySelector('.knowledge-tabs'); tabs.innerHTML = '';
  state.tabs.forEach(function (id) { var draft = state.drafts[id]; if (!draft) return; var shell = document.createElement('div'); shell.className = 'knowledge-tab-shell';
    var label = draft.newDocument ? 'Untitled' : draft.file.name.replace(/\.md$/i, '');
    shell.innerHTML = '<button type="button" class="knowledge-tab" data-select-tab="' + escapeAttr(id) + '" role="tab" aria-selected="' + String(id === state.selected) + '" tabindex="' + (id === state.selected ? '0' : '-1') + '"><span>' + escapeText(label) + (draft.dirty ? ' •' : '') + '</span></button><button type="button" class="knowledge-tab-close" data-close-tab="' + escapeAttr(id) + '" aria-label="Close ' + escapeAttr(label) + ' tab">×</button>'; tabs.appendChild(shell); });
}
function renderToolbar() {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); var history = state.historyView; var bar = panel.querySelector('.knowledge-document-toolbar'); bar.innerHTML = '';
  if (renderKnowledgeDatabase(panel)) return;
  if (history && history.preview) {
    bar.innerHTML = historyToolbarHtml(history, state.fullscreen); return;
  }
  if (!draft) return;
  var readOnly = !draft.writable; var suffix = draft.file.name && draft.file.name.endsWith('.jsonl') ? '.jsonl' : '.md'; var shownName = draft.name != null ? draft.name : (draft.newDocument ? '' : draft.file.name.replace(/\.(md|jsonl)$/i, ''));
  if (!state.fullscreen) {
    bar.innerHTML = '<strong class="knowledge-preview-name">' + escapeText(draft.file.name || 'Untitled') + '</strong>' +
      (readOnly ? '<span class="knowledge-readonly">Read only</span>' : '<button type="button" data-document-action="edit">' + iconHtml('pencil') + 'Edit fullscreen</button>');
  } else {
    bar.innerHTML = '<label class="knowledge-name"><span class="sr-only">Document path</span><input data-document-name value="' + escapeAttr(shownName) + '" ' + (readOnly ? 'readonly' : '') + (draft.savingRequest ? ' disabled' : '') + '><span>' + suffix + '</span></label><span class="knowledge-save-state">' + (draft.savingRequest ? 'Saving…' : draft.draftState === 'pending' ? 'Saving draft…' : draft.draftState === 'retry' ? 'Draft waiting for reconnect' : draft.draftState === 'saved' ? 'Draft saved on server' : draft.dirty ? 'Unsaved changes' : 'Saved') + '</span>' + (!readOnly ? '<button type="button" data-document-action="rename" ' + (draft.newDocument || draft.savingRequest || draft.dirty ? 'disabled' : '') + '>Move / rename</button><button type="button" data-document-action="save" class="primary" ' + (!draft.dirty || draft.savingRequest || draft.conflict ? 'disabled' : '') + '>' + (draft.savingRequest ? 'Saving…' : 'Save') + '</button><button type="button" data-document-action="delete" class="danger" ' + (draft.newDocument || draft.savingRequest ? 'disabled' : '') + ' aria-label="Delete document">' + iconHtml('trash-2') + '</button><button type="button" data-document-action="read">Exit editor</button>' : '<span class="knowledge-readonly">Read only</span>');
  }
  if (draft.error) bar.insertAdjacentHTML('beforeend', '<span class="knowledge-inline-error">' + escapeText(draft.error) + (draft.conflict ? ' <button type="button" data-document-action="keep">Keep draft</button> <button type="button" data-document-action="reload">Reload disk version</button>' : '') + '</span>'); refreshIcons(bar);
}
function renderDocument(forceReplace, preserveFromId) {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); var history = state.historyView && state.historyView.preview; var body = panel.querySelector('.knowledge-document-body'); var mode = !history && draft && state.fullscreen && draft.writable ? 'edit' : 'read';
  if (renderKnowledgeDatabase(panel)) return;
  if (history) {
    var historyId = 'history:' + state.historyView.documentId + ':' + history.version; if (!forceReplace && body.dataset.knowledgeDocumentId === historyId) return;
    destroyKnowledgeEditor(); body.innerHTML = ''; body.dataset.knowledgeDocumentId = historyId; body.dataset.knowledgeDocumentMode = 'read'; body.dataset.knowledgeDocumentWritable = 'false';
    var historical = document.createElement('article'); historical.className = 'knowledge-preview md-content'; historical.dataset.knowledgePreview = ''; historical.innerHTML = renderMarkdown(history.content || ''); body.appendChild(historical); highlightCodeBlocks(historical); return;
  }
  var sameDocument = draft && (body.dataset.knowledgeDocumentId === state.selected || body.dataset.knowledgeDocumentId === preserveFromId);
  if (!forceReplace && sameDocument && body.dataset.knowledgeDocumentMode === mode && body.dataset.knowledgeDocumentWritable === String(!!draft.writable)) {
    body.dataset.knowledgeDocumentId = state.selected; return;
  }
  destroyKnowledgeEditor(); body.innerHTML = ''; body.dataset.knowledgeDocumentId = draft ? state.selected : ''; body.dataset.knowledgeDocumentMode = draft ? mode : ''; body.dataset.knowledgeDocumentWritable = draft ? String(!!draft.writable) : '';
  if (!draft) { body.innerHTML = '<div class="knowledge-welcome"><i data-lucide="book-open"></i><h2>Knowledge</h2><p>Open a document from the explorer or create a new Markdown note.</p></div>'; refreshIcons(body); return; }
  if (mode === 'read') { var preview = document.createElement('article'); preview.className = 'knowledge-preview md-content'; preview.dataset.knowledgePreview = ''; preview.innerHTML = renderMarkdown(draft.content || ''); body.appendChild(preview); decorateKnowledgePreview(preview, draft.outgoing); highlightCodeBlocks(preview); preview.scrollTop = draft.readScroll || 0; }
  else {
    var split = document.createElement('div'); split.className = 'knowledge-editor-split'; var editorHost = document.createElement('div'); editorHost.className = 'knowledge-editor-host';
    var live = document.createElement('article'); live.className = 'knowledge-live-preview md-content'; live.innerHTML = renderMarkdown(draft.content || ''); split.appendChild(editorHost); split.appendChild(live); body.appendChild(split); if (!draft.dirty) decorateKnowledgePreview(live, draft.outgoing); highlightCodeBlocks(live);
    mountKnowledgeEditor(editorHost, { value: draft.content || '', cursor: draft.cursor, history: draft.editorHistory, files: state.files, currentName: draft.file.name || draft.name, onCursor: function (cursor) { patchDraft(workspaceKey(), state.selected, { cursor: cursor }); scheduleDraftSave(workspaceKey(), state.selected); }, onChange: function (content, cursor) {
      var key = workspaceKey(); var current = stateFor(key); setState(key, editKnowledgeDraft(current, current.selected, { content: content, cursor: cursor, dirty: content !== current.drafts[current.selected].savedContent, error: current.drafts[current.selected].conflict ? current.drafts[current.selected].error : '' }));
      live.innerHTML = renderMarkdown(content || ''); highlightCodeBlocks(live); renderDetails(); updateToolbarState(); scheduleDraftSave(key, current.selected);
    } }); scrollKnowledgeEditor(draft.editScroll || 0);
  }
}
function updateToolbarState() {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); if (!draft || !panel) return;
  var status = panel.querySelector('.knowledge-save-state'); if (status) status.textContent = draft.draftState === 'pending' ? 'Saving draft…' : draft.draftState === 'retry' ? 'Draft waiting for reconnect' : draft.dirty ? 'Unsaved changes' : 'Saved';
  var save = panel.querySelector('[data-document-action="save"]'); if (save) save.disabled = !draft.dirty || !!draft.savingRequest || !!draft.conflict;
  var rename = panel.querySelector('[data-document-action="rename"]'); if (rename) rename.disabled = draft.newDocument || !!draft.savingRequest || !!draft.dirty;
}
function renderDetails() {
  var state = stateFor(workspaceKey()); var draft = currentDraft(state); var history = state.historyView; var outline = panel.querySelector('[data-detail-content="outline"]'); var linkBox = panel.querySelector('[data-detail-content="links"]'); var historyBox = panel.querySelector('[data-detail-content="history"]'); outline.innerHTML = ''; linkBox.innerHTML = ''; historyBox.innerHTML = '';
  panel.querySelector('.knowledge-details').hidden = !!(draft && draft.file.itemType === 'db'); if (draft && draft.file.itemType === 'db') return;
  if (state.deletedFiles && state.deletedFiles.length) historyBox.innerHTML += '<small>RECOVERABLE KNOWLEDGE</small>' + state.deletedFiles.map(function (item) { return item.itemType === 'db' ? '<button type="button" class="knowledge-link-item" data-db-recover-database="' + escapeAttr(item.id) + '" data-db-recover-name="' + escapeAttr(item.name) + '" data-db-recover-revision="' + escapeAttr(item.revision) + '">' + iconHtml('database') + escapeText(item.name) + '</button>' : '<button type="button" class="knowledge-link-item" data-deleted-history="' + escapeAttr(item.id) + '" data-deleted-name="' + escapeAttr(item.name) + '">' + escapeText(item.name) + '</button>'; }).join('');
  historyBox.innerHTML += historyVersionsHtml(history);
  if (!draft) { outline.innerHTML = '<p>Open a document to see its outline.</p>'; linkBox.innerHTML = '<p>Document links appear here.</p>';
    if (!historyBox.innerHTML) historyBox.innerHTML = '<p>Load deleted documents from the history button.</p>'; return; }
  var outlineItems = draft.outline && !draft.dirty ? draft.outline : headings(draft.content); outline.innerHTML = outlineItems.length ? outlineItems.map(function (item) { return '<button type="button" class="knowledge-outline-item depth-' + item.depth + '" data-outline-heading="' + escapeAttr(item.slug || item.text) + '">' + escapeText(item.text) + '</button>'; }).join('') : '<p>No headings</p>';
  var outbound = draft.outgoing || []; var inbound = draft.backlinks || []; var parts = [];
  if (outbound.length) parts.push('<small>OUTGOING</small>' + outbound.map(function (item) { var target = item.documentKey || item.documentId && documentIdentity({ id: item.documentId, name: item.name, common: false }); return target ? '<button type="button" class="knowledge-link-item' + (item.heading && !item.headingValid ? ' unresolved' : '') + '" data-open-document="' + escapeAttr(target) + '" data-open-heading="' + escapeAttr(item.heading || '') + '">' + iconHtml('link-2') + '<span>' + escapeText(item.label) + (item.heading ? ' › ' + escapeText(item.heading) + (item.headingValid ? '' : ' (missing heading)') : '') + '</span></button>' : item.external ? '<span class="knowledge-link-item">' + escapeText(item.label) + ' (external)</span>' : '<button type="button" class="knowledge-link-item unresolved" data-create-linked="' + escapeAttr(item.target) + '">' + iconHtml('file-plus-2') + '<span>' + escapeText(item.label || item.target) + ' (create)</span></button>'; }).join(''));
  if (inbound.length) parts.push('<small>BACKLINKS FROM WORKSPACE</small>' + inbound.map(function (item) { var id = item.documentKey || documentIdentity({ id: item.documentId, name: item.name, common: false }); return '<button type="button" class="knowledge-link-item knowledge-backlink" data-open-document="' + escapeAttr(id) + '">' + iconHtml('corner-up-left') + '<span><b>' + escapeText(item.name) + '</b><em>' + escapeText(item.snippet) + '</em></span></button>'; }).join(''));
  if (draft.tags && draft.tags.length) parts.push('<small>TAGS</small><div class="knowledge-tags">' + draft.tags.map(function (tag) { return '<span>#' + escapeText(tag) + '</span>'; }).join('') + '</div>');
  var propertyNames = Object.keys(draft.properties || {}); if (propertyNames.length) parts.push('<small>PROPERTIES</small><dl class="knowledge-properties">' + propertyNames.map(function (name) { return '<dt>' + escapeText(name) + '</dt><dd>' + escapeText(draft.properties[name]) + '</dd>'; }).join('') + '</dl>');
  if (draft.propertyErrors && draft.propertyErrors.length) parts.push('<p class="knowledge-property-error">' + escapeText(draft.propertyErrors.join(' ')) + '</p>');
  linkBox.innerHTML = parts.join('') || '<p>No document links</p>'; refreshIcons(linkBox);
  if (draft && !draft.newDocument) historyBox.innerHTML += '<button type="button" class="knowledge-link-item" data-history-load>Load version history</button>';
}
function headingSlug(value) { return String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-'); }
function scrollPendingHeading() {
  if (!panel || !pendingHeading) return; var wanted = headingSlug(pendingHeading); var candidates = panel.querySelectorAll('.knowledge-preview h1, .knowledge-preview h2, .knowledge-preview h3, .knowledge-preview h4, .knowledge-preview h5, .knowledge-preview h6, .knowledge-live-preview h1, .knowledge-live-preview h2, .knowledge-live-preview h3, .knowledge-live-preview h4, .knowledge-live-preview h5, .knowledge-live-preview h6');
  for (var i = 0; i < candidates.length; i++) if (headingSlug(candidates[i].textContent) === wanted) { candidates[i].scrollIntoView({ block: 'start' }); pendingHeading = null; return; }
}
function render(options) { if (!panel || panel.classList.contains('hidden')) return; var state = stateFor(workspaceKey()); var settings = options || {}; renderShell(); renderStatus(); panel.querySelector('.knowledge-search input').value = state.query; renderExplorer(); renderTabs(); renderToolbar(); renderDocument(settings.forceDocument === true, settings.preserveFromId); renderDetails(); }
function escapeText(value) { var span = document.createElement('span'); span.textContent = String(value || ''); return span.innerHTML; }
function escapeAttr(value) { return escapeText(value).replace(/"/g, '&quot;'); }

export function openKnowledgeWorkbench() {
  ensurePanel(); if (!panel || !isMateWorkspace(store.snap())) return; returnFocus = document.activeElement;
  claimRightWorkbench('mate-knowledge'); panel.classList.remove('hidden'); setKnowledgeNarrowBackground(panel, true); var button = document.getElementById('knowledge-workbench-btn'); if (button) button.classList.add('active');
  var key = workspaceKey(); var state = stateFor(key); var drafts = Object.assign({}, state.drafts); if (state.selected && drafts[state.selected]) drafts[state.selected] = Object.assign({}, drafts[state.selected], { mode: 'read' });
  setState(key, Object.assign({}, state, { drafts: drafts, fullscreen: false, loading: true, error: '' })); simpleRequest('knowledge_list'); if (stateFor(key).query.trim()) { patchState(key, { searching: true }); requestSearch(key, stateFor(key).query, 0, false); } render(); setTimeout(function () { var search = panel.querySelector('.knowledge-search input'); if (search) search.focus(); }, 0);
}
export function closeKnowledgeWorkbench(skipSave) {
  if (!panel) return; var active = document.activeElement; var shouldReturn = skipSave !== true && (!active || active === document.body || panel.contains(active));
  var key = workspaceKey(); cancelScheduledSearch(); if (deleteTarget) closeDelete(); if (skipSave !== true) { saveScroll(); var selected = stateFor(key).selected; if (selected) saveDraftNow(key, selected); }
  patchState(key, { fullscreen: false }); destroyKnowledgeEditor(); panel.classList.add('hidden'); setKnowledgeNarrowBackground(panel, false); releaseRightWorkbench('mate-knowledge');
  var button = document.getElementById('knowledge-workbench-btn'); if (button) button.classList.remove('active'); if (shouldReturn && returnFocus && returnFocus.isConnected) returnFocus.focus(); returnFocus = null;
}
export function initMateKnowledgeWorkbench() {
  ensurePanel(); configureKnowledgeDbWorkbench({ render: render, openDocument: openDocument, documentIdentity: documentIdentity }); registerRightWorkbench('mate-knowledge', closeKnowledgeWorkbench); var button = ensureButton(); if (button) button.addEventListener('click', function () { if (panel.classList.contains('hidden')) openKnowledgeWorkbench(); else closeKnowledgeWorkbench(); });
  store.subscribe(function (state, previous) { if (state.currentSlug !== previous.currentSlug) { saveScroll(previous.currentSlug); cancelDraftSaves(previous.currentSlug || ''); patchState(previous.currentSlug || '', { fullscreen: false }); closeKnowledgeWorkbench(true); } });
  window.addEventListener('resize', function () { if (panel && !panel.classList.contains('hidden')) setKnowledgeNarrowBackground(panel, true); });
}
export function handleKnowledgeWorkbenchMessage(msg) {
  if (handleKnowledgeDbMessage(msg)) return true;
  var tracked = msg.requestId && pending[msg.requestId]; if (!tracked) return false; delete pending[msg.requestId]; var key = tracked.key; var state = stateFor(key); var forceDocument = false;
  if (msg.type === 'knowledge_list') {
    var nextFiles = msg.files || []; var drafts = Object.assign({}, state.drafts); var refresh = [];
    (msg.drafts || []).forEach(function (savedDraft) {
      if (!savedDraft.newDocument || drafts[savedDraft.documentId]) return;
      var file = { id: savedDraft.documentId, clientIdentity: savedDraft.documentId, name: savedDraft.name || 'Recovered draft.md', itemType: 'text', writable: true, draftOnly: true };
      nextFiles.push(file); drafts[savedDraft.documentId] = { file: file, content: savedDraft.content, savedContent: '', revision: null, dirty: true, writable: true,
        newDocument: true, mode: 'read', name: String(savedDraft.name || '').replace(/\.md$/i, ''), version: savedDraft.clientVersion || 0,
        draftVersion: savedDraft.clientVersion || 0, cursor: savedDraft.cursor || null, draftState: 'saved', recovered: true, error: '' };
    });
    Object.keys(drafts).forEach(function (id) {
      var draft = drafts[id]; if (draft.newDocument || draft.file.common) return;
      var current = nextFiles.filter(function (file) { return documentIdentity(file) === id; })[0];
      if (!current) { if (draft.dirty) drafts[id] = Object.assign({}, draft, { conflict: true, error: 'This document was removed outside Clay. Keep the draft and save it under a new path.' }); return; }
      var changed = current.revision !== draft.revision; drafts[id] = Object.assign({}, draft, { file: Object.assign({}, draft.file, current) });
      if (changed && draft.dirty) drafts[id] = Object.assign({}, drafts[id], { conflict: true, diskRevision: current.revision, error: 'The disk version changed while this draft was open. Keep the draft or reload the disk version.' });
      else if (changed) refresh.push(id);
    });
    setState(key, Object.assign({}, state, { files: nextFiles, drafts: drafts, loading: false, error: '' })); if (key === workspaceKey()) {
      render(); if (refresh.indexOf(state.selected) !== -1) openDocument(state.selected, true);
      Object.keys(drafts).forEach(function (id) { if (drafts[id].dirty && drafts[id].draftState === 'retry') scheduleDraftSave(key, id); });
    } return true;
  }
  if (msg.type === 'knowledge_search_results') { if (state.query === tracked.query && (!tracked.append || tracked.offset === state.searchFiles.length)) setState(key, Object.assign({}, state, { searchFiles: tracked.append ? state.searchFiles.concat(msg.files || []) : msg.files || [], searchTotal: msg.total || 0, searching: false,
    error: msg.complete === false ? 'Some workspace documents could not be indexed; search results are incomplete.' : '' })); if (key === workspaceKey()) render(); return true; }
  if (msg.type === 'knowledge_content') { var beforeRead = state.drafts[tracked.documentId]; var readState = applyKnowledgeRead(state, tracked, msg); forceDocument = tracked.replace === true && readState.drafts[tracked.documentId] !== beforeRead; setState(key, readState); }
  else if (msg.type === 'knowledge_saved') { var savedState = applyKnowledgeSave(state, tracked, msg); setState(key, savedState); var savedId = savedState.tabs.filter(function (id) { return savedState.drafts[id] && savedState.drafts[id].file.id === msg.id; })[0]; if (savedId && savedState.drafts[savedId].dirty) scheduleDraftSave(key, savedId); }
  else if (msg.type === 'knowledge_renamed') setState(key, applyKnowledgeRename(state, tracked, msg));
  else if (msg.type === 'knowledge_deleted') setState(key, applyKnowledgeDelete(state, tracked, msg));
  else if (msg.type === 'knowledge_draft_saved') {
    var savedDraft = stateFor(key).drafts[tracked.documentId]; if (savedDraft && (savedDraft.version || 0) === tracked.submittedVersion) patchDraft(key, tracked.documentId, { draftState: 'saved', draftSavedAt: msg.savedAt, draftVersion: msg.clientVersion });
    else if (savedDraft) { patchDraft(key, tracked.documentId, { draftState: 'pending', draftVersion: msg.clientVersion }); scheduleDraftSave(key, tracked.documentId); }
  }
  else if (msg.type === 'knowledge_draft_deleted') { patchDraft(key, tracked.documentId, { draftState: '' }); }
  else if (msg.type === 'knowledge_draft_discarded') { setState(key, applyKnowledgeDiscard(state, tracked, msg)); forceDocument = true; }
  else if (msg.type === 'knowledge_history') setState(key, receiveHistoryVersions(state, tracked, msg.versions || []));
  else if (msg.type === 'knowledge_history_version') { setState(key, receiveHistoryPreview(state, tracked, { version: msg.version, content: msg.content })); forceDocument = true; }
  else if (msg.type === 'knowledge_deleted_list') setState(key, Object.assign({}, state, { deletedFiles: msg.files || [] }));
  else if (msg.type === 'knowledge_restored') { readRestoredDocument(key, msg); return true; }
  else if (msg.type === 'knowledge_synced') { var drafts = Object.assign({}, state.drafts); Object.keys(drafts).forEach(function (id) { if (drafts[id].syncWarning) drafts[id] = Object.assign({}, drafts[id], { syncWarning: '' }); }); setState(key, Object.assign({}, state, { drafts: drafts, syncRetry: null, error: '' })); }
  else if (msg.type === 'knowledge_error') { if (tracked.type === 'knowledge_sync') setState(key, Object.assign({}, state, { error: msg.error || 'Knowledge index synchronization is still pending.' })); else setState(key, failKnowledgeRequest(state, tracked, msg)); }
  else return false;
  if (key === workspaceKey()) { if (['knowledge_saved', 'knowledge_renamed', 'knowledge_deleted'].indexOf(msg.type) !== -1) simpleRequest('knowledge_list'); render({ forceDocument: forceDocument, preserveFromId: ['knowledge_saved', 'knowledge_renamed'].indexOf(msg.type) !== -1 ? tracked.documentId : null }); if (pendingHeading) setTimeout(scrollPendingHeading, 0); }
  return true;
}
