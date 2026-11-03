// Project home shares guarded session creation and navigation with the picker.
import { store } from './store.js';
import { startNewSession } from './sidebar-sessions.js';
import { retryOptions, createOptions } from './session-create.js';
import { switchToStandalone } from './split-view-presentations.js';
import { pickerCandidates } from './split-view-picker-render.js';
import { renderProjectHome } from './project-home-render.js';
import { activeSavedView } from './view-workspace-state.js';
import { layoutScope, currentLayoutScope } from './split-view-layout-scope.js';

var CANVAS_ID = 'project-empty-canvas';
function canvasElement() { return document.getElementById(CANVAS_ID); }
export function viewHasOpenPanes(view) {
  return !!(view && view.workspace && Array.isArray(view.workspace.panes) && view.workspace.panes.some(function (pane) { return pane.open; }));
}
export function presentableWithoutSessions(view, sessions) {
  return viewHasOpenPanes(view) || !(sessions || []).length;
}
function standaloneScope() {
  var state = store.snap();
  return { standalone: true, context: state.projectSplitViewContextKey || null, slug: state.currentSlug || null,
    owner: state.currentProjectOwnerId || null, viewer: state.myUserId || null, generation: state.projectSplitViewSocketGeneration || 0 };
}
function currentPickerScope(scope) {
  if (scope && scope.standalone) {
    var state = store.snap();
    return !state.projectSplitViewActiveId && !state.projectSplitViewSingletonOrigin && !state.splitPanes &&
      scope.context === (state.projectSplitViewContextKey || null) && scope.slug === (state.currentSlug || null) &&
      scope.owner === (state.currentProjectOwnerId || null) && scope.viewer === (state.myUserId || null) &&
      scope.generation === (state.projectSplitViewSocketGeneration || 0);
  }
  return currentLayoutScope(scope);
}
function updatePicker(change) {
  var state = store.get('projectStartPicker');
  if (state) store.set({ projectStartPicker: Object.assign({}, state, change) });
}
function createSession(vendor) {
  var state = store.get('projectStartPicker');
  if (!state || state.pending || !currentPickerScope(state.scope) ||
      !createOptions().vendors.some(function (item) { return item.id === vendor && item.installed; })) return;
  var requestId = 'project-start-' + (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  updatePicker({ pending: requestId, error: '' });
  if (!startNewSession(vendor, { forceNew: true, activate: false, slug: store.get('currentSlug'), requestId: requestId })) {
    updatePicker({ pending: null, error: 'Not connected. Reconnect and try again.' });
    return;
  }
  setTimeout(function () {
    var current = store.get('projectStartPicker');
    if (current && current.pending === requestId) updatePicker({ pending: null, error: 'Creation was not confirmed. Check the sidebar before trying again.' });
  }, 30000);
}

// A stale acknowledgement must never select a session in another workspace.
export function handleEmptyCanvasNewSessionResult(msg) {
  var state = store.get('projectStartPicker');
  if (!state || !state.pending || msg.requestId !== state.pending) return false;
  var current = currentPickerScope(state.scope) && !state.dismissed;
  updatePicker({ pending: null, error: msg.ok ? '' : msg.error || 'The session could not be created.' });
  if (current && msg.ok && typeof msg.sessionId === 'number') switchToStandalone(msg.sessionId);
  return true;
}

function onClick(event) {
  var button = event.target.closest('button'), state = store.get('projectStartPicker');
  if (!button || button.disabled || !state || state.pending || !currentPickerScope(state.scope)) return;
  if (button.dataset.splitRetry) { retryOptions(); return; }
  if (button.dataset.splitVendor) { createSession(button.dataset.splitVendor); return; }
  var id = Number(button.dataset.splitSession);
  if (pickerCandidates(state.query, true).some(function (session) { return session.id === id; })) switchToStandalone(id);
}
function onKey(event) {
  var menu = canvasElement();
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].indexOf(event.key) < 0) return;
  if (event.target.tagName === 'INPUT' && ['Home', 'End'].indexOf(event.key) >= 0) return;
  var items = Array.from(menu.querySelectorAll('[data-split-session], [data-split-vendor]')).filter(function (item) { return !item.disabled; });
  if (!items.length) return;
  if (event.key === 'Enter') {
    if (event.target.tagName === 'INPUT') { event.preventDefault(); items[0].click(); }
    return;
  }
  event.preventDefault();
  var index = items.indexOf(document.activeElement);
  var next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index < 0 ? event.key === 'ArrowUp' ? items.length - 1 : 0 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
  items[next].focus();
}

export function renderProjectEmptyCanvas(host, nativeApp) {
  if (!host) return;
  var root = canvasElement();
  if (!root || root.parentNode !== host || !currentPickerScope((store.get('projectStartPicker') || {}).scope)) {
    clearProjectEmptyCanvas();
    root = document.createElement('section');
    root.id = CANVAS_ID;
    root.className = 'project-home';
    root.setAttribute('aria-label', 'Project home');
    host.appendChild(root);
    var scope = activeSavedView() ? layoutScope(activeSavedView()) : standaloneScope();
    store.set({ projectStartPicker: { projectStart: true, side: 'right', query: '', error: '', pending: null, dismissed: false, scope: scope } });
    renderProjectHome(root, store.get('projectStartPicker'));
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    if (!createOptions().loaded) retryOptions();
  }
  host.classList.add('visible', 'project-start-visible');
  // A closed pane may leave the split canvas geometry on the shared host.
  // Project home uses normal flow and preserves the retained pane children.
  host.classList.remove('split-view-canvas', 'split-view-preview-only');
  delete host.dataset.positioned;
  delete host.dataset.singlePane;
  delete host.dataset.previewOnly;
  if (nativeApp) nativeApp.classList.add('split-native-hidden');
}

export function showStandaloneEmptyCanvas(host, nativeApp) {
  store.set({ projectSplitViewSingletonOrigin: null, projectStartPicker: {
    projectStart: true, side: 'right', query: '', error: '', pending: null, dismissed: false, scope: standaloneScope()
  } });
  renderProjectEmptyCanvas(host, nativeApp);
}

export function clearProjectEmptyCanvas() {
  var root = canvasElement();
  var host = document.getElementById('split-host');
  if (host) host.classList.remove('project-start-visible');
  if (root) root.remove();
  if (store.get('projectStartPicker')) store.set({ projectStartPicker: null });
}

store.subscribe(function (state, previous) {
  var root = canvasElement();
  if (!root || !state.projectStartPicker) return;
  root.hidden = !!state.projectStartPicker.dismissed;
  if (state.projectStartPicker !== previous.projectStartPicker || state.paneBindingSessions !== previous.paneBindingSessions ||
      state.sessionCreateOptions !== previous.sessionCreateOptions || state.connected !== previous.connected) {
    renderProjectHome(root, state.projectStartPicker);
  }
});

// This decision arrives only on project entry; elapsed time never navigates a live tab.
export function handleProjectEntry(msg) {
  if (store.get('paneMode') || store.get('dmMode') || msg.projectSlug !== store.get('currentSlug')) return false;
  store.set({ projectEntryEmpty: msg.empty === true });
  if (msg.empty === true) {
    store.set({ activeSessionId: null, sessionOriginId: null, projectSplitViewActiveId: null, projectSplitViewSingletonOrigin: null, splitPanes: null });
    showStandaloneEmptyCanvas(document.getElementById('split-host'), document.getElementById('app'));
  }
  return msg.empty === true;
}
