// Single arbitration point for the mutually exclusive right-side workbench.

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showToast } from './utils.js';

var closers = {};
var panelIds = { terminal: 'terminal-container', browser: 'shared-browser-panel', 'file-viewer': 'file-viewer',
  'project-logs': 'project-logs-panel', you: 'you-panel', issues: 'issues-panel', linear: 'linear-panel',
  'notes-browser': 'notes-browser', 'scheduled-tasks': 'scheduled-tasks-panel', debates: 'debates-workbench',
  'mcp-skills': 'mcp-skills-workbench', 'mate-knowledge': 'mate-knowledge-workbench', wireframe: 'wireframe-panel' };

// Pane startup does not need account settings for a closed workbench.
function ensureLayoutPreference() {
  var account = store.get('myUserId'), project = store.get('currentSlug');
  return import('./workbench-layout-preference.js').then(function (api) {
    if (account !== store.get('myUserId') || project !== store.get('currentSlug')) return false;
    return api.ensureWorkbenchLayoutPreference();
  }).catch(function () {
    if (account !== store.get('myUserId') || project !== store.get('currentSlug')) return false;
    store.set({ workbenchLayoutPreference: Object.assign({}, store.get('workbenchLayoutPreference') || {}, {
      loading: false, saving: false, error: 'Workbench layout could not be loaded. Try again.'
    }) });
    return false;
  });
}

function renderLayoutControls() {
  if (typeof document === 'undefined') return;
  var main = document.getElementById('main-panels');
  if (!main) return;
  var state = store.get('workbenchLayoutPreference') || {}, docked = state.mode === 'docked';
  main.dataset.workbenchMode = docked ? 'docked' : 'overlay';
  var panel = document.getElementById(panelIds[store.get('rightWorkbenchOwner')]);
  if (!panel) return;
  var header = panel.querySelector(':scope > header, :scope > .file-viewer-header .file-viewer-tabbar, :scope > .terminal-header');
  if (!header) return;
  var button = panel.querySelector('.workbench-layout-toggle');
  if (!button) {
    var actions = header.querySelector('[class*="window-actions"], .terminal-header-actions, .shared-browser-window, :scope.mcp-skills-header > div') || header;
    button = document.createElement('button'); button.type = 'button'; button.className = 'workbench-layout-toggle';
    button.addEventListener('click', function () {
      var current = store.get('workbenchLayoutPreference') || {};
      if (!current.ready || current.loading || current.saving) { ensureLayoutPreference(); return; }
      var owner = store.get('myUserId'), project = store.get('currentSlug');
      function currentTarget() { return button.isConnected && owner === store.get('myUserId') && project === store.get('currentSlug'); }
      import('./workbench-layout-preference.js').then(function (api) {
        var fresh = store.get('workbenchLayoutPreference') || {};
        if (!currentTarget() || fresh.mode !== current.mode || fresh.revision !== current.revision || fresh.loading || fresh.saving || !fresh.ready) return false;
        return api.saveWorkbenchLayoutMode(current.mode === 'docked' ? 'overlay' : 'docked');
      }).then(function (saved) {
        if (saved === false && currentTarget()) showToast((store.get('workbenchLayoutPreference') || {}).error || 'Workbench layout could not be saved. Try again.', 'error');
      }).catch(function (error) {
        if (currentTarget()) showToast(error.message || 'Workbench layout could not be saved. Try again.', 'error');
      });
    });
    var anchor = actions === header ? header.querySelector('[data-knowledge-wide]') : actions.firstElementChild;
    actions.insertBefore(button, anchor || null);
  }
  if (button.dataset.mode !== (docked ? 'docked' : 'overlay')) {
    button.dataset.mode = docked ? 'docked' : 'overlay';
    button.innerHTML = iconHtml(docked ? 'layers-2' : 'panel-right');
    refreshIcons();
  }
  button.setAttribute('aria-label', docked ? 'Float workbench over sessions' : 'Dock workbench beside sessions');
  button.title = state.error || button.getAttribute('aria-label');
  button.setAttribute('aria-pressed', docked ? 'true' : 'false');
  button.disabled = !!state.loading || !!state.saving;
  button.setAttribute('aria-busy', state.loading || state.saving ? 'true' : 'false');
}

export function registerRightWorkbench(name, close) {
  if (!name || typeof close !== "function") return;
  closers[name] = close;
}

export function claimRightWorkbench(name) {
  if (typeof document !== 'undefined') ensureLayoutPreference();
  var previousRevision = store.get("rightWorkbenchRevision") || 0;
  var nextRevision = previousRevision + 1;
  storeSet(name, nextRevision);
  var keys = Object.keys(closers);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === name) continue;
    try { closers[keys[i]](); } catch (error) { /* one panel must not block another */ }
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(renderLayoutControls);
  return nextRevision;
}

function storeSet(name, value) {
  store.set({ rightWorkbenchOwner: name, rightWorkbenchRevision: value });
}

export function releaseRightWorkbench(name) {
  if (store.get("rightWorkbenchOwner") !== name) return;
  storeSet(null, (store.get("rightWorkbenchRevision") || 0) + 1);
}

export function isRightWorkbenchCurrent(name, expectedRevision) {
  return store.get("rightWorkbenchOwner") === name && store.get("rightWorkbenchRevision") === expectedRevision;
}

export function resetRightWorkbench() {
  storeSet(null, (store.get("rightWorkbenchRevision") || 0) + 1);
}

store.subscribe(function (state, previous) {
  if (state.workbenchLayoutPreference !== previous.workbenchLayoutPreference || state.rightWorkbenchOwner !== previous.rightWorkbenchOwner) renderLayoutControls();
  if (state.currentSlug === previous.currentSlug && state.myUserId === previous.myUserId) return;
  resetRightWorkbench();
});
