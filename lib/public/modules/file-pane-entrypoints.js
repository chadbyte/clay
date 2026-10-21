import { recordToolExpansion } from './view-presentation-state.js';
import { registerStudioPaint } from './clay-studio-render.js';
import { bindFileReview } from './file-pane-review.js';
// Compatibility entrypoints resolve an actual pane in the authenticated current View.
import { store } from './store.js';
import { activeSavedView } from './view-workspace-state.js';
import { filePaneStates, filePaneState, openIndependentFile, updateFilePaneState, repaintFilePane, actOnFilePane, closeFilePane, mountFilePane } from './file-pane-instances.js';
import { claimRightWorkbench } from './right-workbench.js';
import { presentedDocument } from './clay-studio-document.js';
import { showToast } from './utils.js';

export function independentFilesActive() { return !!activeSavedView() && !store.get('paneMode'); }
export function fileEntryContext() { var s = store.snap(); return JSON.stringify([s.currentSlug, s.myUserId, s.currentProjectOwnerId, s.projectSplitViewActiveId, s.projectSplitViewSocketGeneration]); }
export function normalizedFilePath(path) {
  var cwd = String(store.get('cwd') || '').replace(/\/$/, '');
  return cwd && path.indexOf(cwd + '/') === 0 ? path.slice(cwd.length + 1) : path;
}
export function activeFilePane() {
  var id = store.get('activeFilePaneId'), state = filePaneState(id);
  if (state) return state;
  var ids = Object.keys(filePaneStates()).reverse();
  for (var i = 0; i < ids.length; i++) { state = filePaneState(ids[i]); if (state) return state; }
  return null;
}
export function closeActiveFilePane() { var state = activeFilePane(); if (state) closeFilePane(state.instanceId); }
export function expandActiveFilePane(enabled) { var state = activeFilePane(); if (state) { updateFilePaneState(state.instanceId, { expanded: !!enabled }); repaintFilePane(state.instanceId); recordToolExpansion('file-' + state.instanceId, enabled); } }
export function reopenIndependentFile() {
  var last = filePaneStates()[store.get('activeFilePaneId')];
  if (last && !last.open && last.context === fileEntryContext()) { mountFilePane(last); return true; }
  var state = activeFilePane();
  if (state) { claimRightWorkbench('file-' + state.instanceId); return true; }
  var closed = Object.keys(filePaneStates()).reverse().map(function (id) { return filePaneStates()[id]; }).find(function (item) { return item.context === fileEntryContext(); });
  if (!closed) return false;
  mountFilePane(closed); return true;
}
export function refreshIndependentFile(path) {
  path = normalizedFilePath(path);
  Object.keys(filePaneStates()).forEach(function (id) { var state = filePaneState(id); if (state && state.resource.path === path && !state.historyVisible && !state.diff) actOnFilePane(id, 'refresh'); });
}
export function presentIndependentFile(msg, diff, review) {
  // Source-frame receipts do not grant access to a same-named parent-project file.
  var source = presentedDocument(msg.path);
  if (source && source.descriptor.sourceSlug !== store.get('currentSlug')) { showToast('Source-project document presentation is unavailable in this View.', 'warn'); return false; }
  if (!openIndependentFile(msg.path, { rendered: !diff, diff: diff })) return false;
  var path = normalizedFilePath(msg.path);
  Object.keys(filePaneStates()).forEach(function (id) {
    var state = filePaneState(id);
    if (!state || state.resource.mode !== 'follow' || state.resource.path !== path) return;
    bindFileReview(state, review);
    updateFilePaneState(id, { suppliedSnapshotRequestId: state.requestId, content: msg.content || '', size: msg.size || (msg.content || '').length, binary: !!msg.binary, diff: diff || null }); repaintFilePane(id);
    var panel = document.getElementById('file-' + id);
    registerStudioPaint(msg, panel.querySelector('.tool-pane-header'), null, panel.querySelector('.file-viewer-body'));
  });
  return true;
}
