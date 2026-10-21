import { recordToolExpansion } from './view-presentation-state.js';
import { releaseFileReview } from './file-pane-review.js';
import { paintFileHistory, receiveFileHistory } from './file-pane-history.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench, unregisterRightWorkbench } from './right-workbench.js';
import { TOOL_PANES } from './tool-pane-tree.js';
import { workspaceChanged, freshInstance, activeSavedView } from './view-workspace-state.js';
import { filePaneShell, updateFilePaneToolbar } from './file-pane-toolbar.js';
import { paintFilePane, filePreviewKind } from './file-pane-render.js';
import { cancelPlantUmlPreview } from './plantuml-preview.js';
import { copyToClipboard, showToast } from './utils.js';
import { copyMarkdownFormatting } from './rich-clipboard.js';
import { exportMarkdownAsPdf } from './markdown.js';
import { downloadProjectFile } from './filebrowser-context-menu.js';

export function filePaneStates() { return store.get('filePaneInstances') || {}; }
function context() { var s = store.snap(); return JSON.stringify([s.currentSlug, s.myUserId, s.currentProjectOwnerId, s.projectSplitViewActiveId, s.projectSplitViewSocketGeneration]); }
export function filePaneState(id) { var state = filePaneStates()[id]; return state && state.context === context() && state.open ? state : null; }
export function updateFilePaneState(id, patch) {
  var states = Object.assign({}, filePaneStates()); states[id] = Object.assign({}, states[id], patch); store.set({ filePaneInstances: states }); return states[id];
}
export function sendFilePaneRequest(state, type, extra) {
  var ws = getWs();
  if (!ws || !store.get('connected') || !filePaneState(state.instanceId)) return;
  ws.send(JSON.stringify(Object.assign({ type: type, instanceId: state.instanceId, requestId: state.requestId, path: state.resource.path,
    projectSlug: store.get('currentSlug'), accountId: store.get('myUserId') || null }, extra)));
}
function unwatch(state) {
  var ws = getWs();
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'fs_unwatch', instanceId: state.instanceId, requestId: state.requestId }));
}
function request(id) {
  var state = filePaneState(id); if (!state) return;
  unwatch(state); state = updateFilePaneState(id, { requestId: freshInstance(), error: null, suppliedSnapshotRequestId: null });
  sendFilePaneRequest(state, 'fs_read'); sendFilePaneRequest(state, 'fs_watch'); sendFilePaneRequest(state, 'fs_file_history');
}
function panelFor(id) { return document.getElementById('file-' + id); }
export function repaintFilePane(id) {
  var state = filePaneState(id), panel = panelFor(id); if (!state || !panel) return;
  delete panel.querySelector('.tool-pane-header').dataset.controlSurface;
  updateFilePaneToolbar(panel, state);
  panel.classList.toggle('panel-fullscreen', !!state.expanded);
  var body = panel.querySelector('.file-viewer-body');
  if (state.historyVisible) { paintFileHistory(body, state); return; }
  paintFilePane(body, state);
}
export function closeFilePane(id) {
  var state = filePaneState(id); if (!state) return;
  recordToolExpansion('file-' + id, false);
  releaseFileReview(id); unwatch(state); cancelPlantUmlPreview(id); updateFilePaneState(id, { open: false, requestId: null });
  var panel = panelFor(id); if (panel) { panel.dispatchEvent(new Event('clay-tool-pane-dispose')); panel.remove(); }
  releaseRightWorkbench('file-' + id); unregisterRightWorkbench('file-' + id); delete TOOL_PANES['file-' + id]; workspaceChanged();
}
export function actOnFilePane(id, action) {
  var state = filePaneState(id); if (!state) return;
  if (action !== 'refresh') store.set({ activeFilePaneId: id });
  var resource = Object.assign({}, state.resource), patch = {};
  if (action === 'close') { closeFilePane(id); return; }
  if (action === 'pin') resource.mode = resource.mode === 'pin' ? 'follow' : 'pin';
  else if (action === 'preview' || action === 'source') { resource.rendered = action === 'preview'; patch.historyVisible = false; patch.diff = null; }
  else if (action === 'history') patch.historyVisible = !state.historyVisible;
  else if (action === 'expand') patch.expanded = !state.expanded;
  else if (action === 'escape') { patch.expanded = false; patch.presenting = false; }
  else if (action === 'refresh') { request(id); return; }
  else if (action === 'copy') { copyToClipboard(state.diff ? state.diff.newStr || '' : state.content || ''); return; }
  else if (action === 'formatted') { copyMarkdownFormatting(state.content || '').catch(function (error) { showToast(error.message, 'error'); }); return; }
  else if (action === 'download') { downloadProjectFile(resource.path); return; }
  else if (action === 'pdf') {
    resource.rendered = true; updateFilePaneState(id, { resource: resource, historyVisible: false, presenting: false }); repaintFilePane(id);
    var markdown = panelFor(id).querySelector('.file-viewer-markdown');
    if (markdown) exportMarkdownAsPdf(markdown, resource.path).catch(function (error) { showToast(error.message, 'error'); });
    workspaceChanged(); return;
  } else if (/^h[123]$/.test(action)) patch.slideLevel = Number(action.slice(1));
  else if (action === 'slides') { patch.presenting = !state.presenting; patch.expanded = patch.presenting; patch.slideIndex = 0; resource.rendered = true; patch.historyVisible = false; }
  else if (action === 'next' || action === 'previous') {
    if (!state.presenting) return;
    var count = (state.content || '').split('\n').filter(function (line) { return new RegExp('^' + '#'.repeat(state.slideLevel || 1) + ' ').test(line); }).length;
    patch.slideIndex = Math.max(0, Math.min(Math.max(0, count - 1), (state.slideIndex || 0) + (action === 'next' ? 1 : -1)));
  } else return;
  patch.resource = resource; updateFilePaneState(id, patch); repaintFilePane(id);
  if (patch.expanded !== undefined) recordToolExpansion('file-' + id, patch.expanded);
  workspaceChanged();
}
export function mountFilePane(pane) {
  var id = pane.instanceId, name = 'file-' + id;
  if (!filePaneState(id)) {
    updateFilePaneState(id, { instanceId: id, context: context(), open: true, resource: Object.assign({}, pane.resource), content: null, requestId: freshInstance() });
    TOOL_PANES[name] = { id: name, label: 'Files', icon: 'file-text' };
    var panel = filePaneShell(id, function (action) { actOnFilePane(id, action); });
    function activate() { store.set({ activeFilePaneId: id }); }
    panel.addEventListener('pointerdown', activate, true); panel.addEventListener('focusin', activate);
    document.getElementById('main-panels').appendChild(panel);
    registerRightWorkbench(name, function () { closeFilePane(id); }, name);
  }
  store.set({ activeFilePaneId: id });
  claimRightWorkbench(name); repaintFilePane(id); request(id); workspaceChanged(); return 'restored';
}
export function openIndependentFile(path, options) {
  options = options || {};
  if (!store.get('connected') || options.projectSlug && options.projectSlug !== store.get('currentSlug') || options.sessionId && String(options.sessionId) !== String(store.get('activeSessionId'))) return false;
  var cwd = String(store.get('cwd') || '').replace(/\/$/, '');
  if (cwd && path.indexOf(cwd + '/') === 0) path = path.slice(cwd.length + 1);
  if (!path || /[\\\x00-\x1f\x7f:]/.test(path) || !path.split('/').every(function (part) { return part && part !== '.' && part !== '..'; })) { showToast('This file cannot be bound to the current View.', 'warn'); return false; }
  var states = filePaneStates(), following = Object.keys(states).map(function (id) { return filePaneState(id); }).filter(function (state) { return state && state.resource.mode === 'follow'; });
  if (following.length) {
    following.forEach(function (state) {
      store.set({ activeFilePaneId: state.instanceId });
      releaseFileReview(state.instanceId); unwatch(state); updateFilePaneState(state.instanceId, { content: null, entries: null, historyVisible: false, historyTarget: null, historyContents: {}, historySelected: [], historyDiff: null, historyDiffHash: null, diff: options.diff || null, line: options.line || null, heading: options.heading || null,
        resource: { path: path, mode: 'follow', rendered: !options.line && !options.diff && options.rendered !== false && !!filePreviewKind(path) } });
      repaintFilePane(state.instanceId); request(state.instanceId);
    }); workspaceChanged(); return true;
  }
  var view = activeSavedView(), count = view ? view.workspace.panes.filter(function (pane) { return pane.kind !== 'session' && pane.open; }).length : Object.keys(states).filter(function (id) { return filePaneState(id); }).length;
  if (count >= 8) { showToast('A View supports at most eight tool panes. Close a pane first.', 'warn'); return false; }
  var id = freshInstance();
  mountFilePane({ instanceId: id, resource: { path: path, mode: 'follow', rendered: !options.line && !options.diff && options.rendered !== false && !!filePreviewKind(path) } });
  updateFilePaneState(id, { line: options.line || null, heading: options.heading || null, diff: options.diff || null }); return true;
}
export function routeFilePaneMessage(msg) {
  if (!msg.instanceId) return false;
  var state = filePaneState(msg.instanceId);
  if (!state || !store.get('connected') || state.requestId !== msg.requestId || state.resource.path !== msg.path) return true;
  if (msg.type === 'fs_read_result' && (msg.projectSlug !== store.get('currentSlug') || (msg.accountId || null) !== (store.get('myUserId') || null))) return true;
  if (msg.type === 'fs_read_result' && !msg.error && state.suppliedSnapshotRequestId === msg.requestId) return true;
  if (msg.type === 'fs_read_result' || msg.type === 'fs_file_changed') {
    updateFilePaneState(state.instanceId, { content: msg.content, size: msg.size, binary: msg.binary, imageUrl: msg.imageUrl, error: msg.error || null }); repaintFilePane(state.instanceId);
  } else receiveFileHistory(state, msg);
  return true;
}
export function resetFilePanes() {
  Object.keys(filePaneStates()).forEach(function (id) {
    releaseFileReview(id); var state = filePaneStates()[id]; unwatch(state); cancelPlantUmlPreview(id);
    var panel = panelFor(id); if (panel) { panel.dispatchEvent(new Event('clay-tool-pane-dispose')); panel.remove(); }
    unregisterRightWorkbench('file-' + id); delete TOOL_PANES['file-' + id];
  }); store.set({ filePaneInstances: {}, activeFilePaneId: null });
}
store.subscribe(function (state, previous) {
  if (state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId || state.currentProjectOwnerId !== previous.currentProjectOwnerId || state.projectSplitViewActiveId !== previous.projectSplitViewActiveId || state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration) resetFilePanes();
});
