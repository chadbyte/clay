// Shared arbitration for docked background panes and one foreground overlay.

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

function dockedOwners() { return store.get('rightWorkbenchDockedOwners') || []; }
function openOwner(name) { return store.get('rightWorkbenchOwner') === name || dockedOwners().indexOf(name) !== -1; }
export function rightWorkbenchRevisionFor(name) {
  var revisions = store.get('rightWorkbenchPanelRevisions') || {};
  return revisions[name] == null ? store.get('rightWorkbenchRevision') || 0 : revisions[name];
}
function publish(owner, docked, revisions) {
  store.set({ rightWorkbenchOwner: owner, rightWorkbenchDockedOwners: docked,
    rightWorkbenchPanelRevisions: revisions, rightWorkbenchRevision: (store.get('rightWorkbenchRevision') || 0) + 1 });
}
function setDocked(name, docked) {
  if (!openOwner(name)) return;
  var owners = dockedOwners().filter(function (item) { return item !== name; }), previous = store.get('rightWorkbenchOwner');
  if (docked) owners.push(name);
  publish(docked ? previous : name, owners, store.get('rightWorkbenchPanelRevisions') || {});
  if (!docked && previous && previous !== name && owners.indexOf(previous) === -1 && closers[previous]) closers[previous]();
}
function renderLayoutControls() {
  if (typeof document === 'undefined') return;
  var main = document.getElementById('main-panels');
  if (!main) return;
  var owners = dockedOwners(), state = store.get('workbenchLayoutPreference') || {};
  main.dataset.workbenchMode = owners.length ? 'docked' : 'overlay';
  main.dataset.workbenchDocks = String(owners.length);
  Object.keys(panelIds).forEach(function (name) {
    var panel = document.getElementById(panelIds[name]);
    if (!panel) return;
    var docked = owners.indexOf(name) !== -1;
    panel.dataset.workbenchPlacement = docked ? 'docked' : 'overlay';
    panel.dataset.workbenchActive = store.get('rightWorkbenchOwner') === name ? 'true' : 'false';
    if (!openOwner(name)) return;
    var header = panel.querySelector(':scope > header, :scope > .file-viewer-header .file-viewer-tabbar, :scope > .terminal-header');
    if (!header) return;
    var button = panel.querySelector('.workbench-layout-toggle');
    if (!button) {
      var actions = header.querySelector('[class*="window-actions"], .terminal-header-actions, .shared-browser-window, :scope.mcp-skills-header > div') || header;
      button = document.createElement('button'); button.type = 'button'; button.className = 'workbench-layout-toggle';
      button.addEventListener('click', function () {
        var current = store.get('workbenchLayoutPreference') || {};
        if (!current.ready || current.loading || current.saving) { ensureLayoutPreference(); return; }
        var owner = store.get('myUserId'), project = store.get('currentSlug'), revision = rightWorkbenchRevisionFor(name);
        var wasDocked = dockedOwners().indexOf(name) !== -1;
        function currentTarget() { return button.isConnected && openOwner(name) && owner === store.get('myUserId') && project === store.get('currentSlug') &&
          revision === rightWorkbenchRevisionFor(name) && wasDocked === (dockedOwners().indexOf(name) !== -1); }
        import('./workbench-layout-preference.js').then(function (api) {
          var fresh = store.get('workbenchLayoutPreference') || {};
          if (!currentTarget() || fresh.mode !== current.mode || fresh.revision !== current.revision || fresh.loading || fresh.saving || !fresh.ready) return false;
          return api.saveWorkbenchLayoutMode(wasDocked ? 'overlay' : 'docked');
        }).then(function (saved) {
          if (!currentTarget()) return;
          var fresh = store.get('workbenchLayoutPreference') || {};
          if (saved === true && fresh.ready && fresh.mode === (wasDocked ? 'overlay' : 'docked')) setDocked(name, !wasDocked);
          else if (saved === false) showToast(fresh.error || 'Workbench layout could not be saved. Try again.', 'error');
        }).catch(function (error) {
          if (currentTarget()) showToast(error.message || 'Workbench layout could not be saved. Try again.', 'error');
        });
      });
      var anchor = actions === header ? header.querySelector('[data-knowledge-wide]') : actions.firstElementChild;
      actions.insertBefore(button, anchor || null);
    }
    if (button.dataset.mode !== (docked ? 'docked' : 'overlay')) {
      button.dataset.mode = docked ? 'docked' : 'overlay';
      button.innerHTML = iconHtml(docked ? 'layers-2' : 'panel-right'); refreshIcons();
    }
    button.setAttribute('aria-label', docked ? 'Float workbench over sessions' : 'Dock workbench beside sessions');
    button.title = state.error || button.getAttribute('aria-label');
    button.setAttribute('aria-pressed', docked ? 'true' : 'false');
    button.disabled = !!state.loading || !!state.saving;
    button.setAttribute('aria-busy', state.loading || state.saving ? 'true' : 'false');
  });
}

export function registerRightWorkbench(name, close) {
  if (!name || typeof close !== "function") return;
  closers[name] = close;
}

export function claimRightWorkbench(name) {
  if (typeof document !== 'undefined') ensureLayoutPreference();
  var owner = store.get('rightWorkbenchOwner'), docked = dockedOwners().slice(), preference = store.get('workbenchLayoutPreference') || {};
  if (!owner && !docked.length && preference.ready && preference.mode === 'docked') docked.push(name);
  var retained = docked.indexOf(name) !== -1 && owner && docked.indexOf(owner) === -1 ? owner : name;
  var revision = (store.get('rightWorkbenchRevision') || 0) + 1, revisions = Object.assign({}, store.get('rightWorkbenchPanelRevisions') || {});
  Object.keys(revisions).forEach(function (key) { if (key !== retained && docked.indexOf(key) === -1) delete revisions[key]; });
  revisions[name] = revision;
  publish(retained, docked, revisions);
  Object.keys(closers).forEach(function (key) {
    if (key === name || key === retained || docked.indexOf(key) !== -1) return;
    try { closers[key](); } catch (error) { /* one panel must not block another */ }
  });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(renderLayoutControls);
  return revision;
}
export function releaseRightWorkbench(name) {
  if (!openOwner(name)) return;
  var docked = dockedOwners().filter(function (item) { return item !== name; }), revisions = Object.assign({}, store.get('rightWorkbenchPanelRevisions') || {});
  delete revisions[name];
  publish(store.get('rightWorkbenchOwner') === name ? docked[docked.length - 1] || null : store.get('rightWorkbenchOwner'), docked, revisions);
}
export function isRightWorkbenchCurrent(name, expectedRevision) {
  return openOwner(name) && rightWorkbenchRevisionFor(name) === expectedRevision;
}
export function resetRightWorkbench() {
  publish(null, [], {});
  Object.keys(closers).forEach(function (name) { try { closers[name](); } catch (error) { /* Clear other panes after a context change. */ } });
}
store.subscribe(function (state, previous) {
  if (state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId) { resetRightWorkbench(); return; }
  var preference = state.workbenchLayoutPreference || {}, before = previous.workbenchLayoutPreference || {};
  if (!before.ready && preference.ready && preference.mode === 'docked' && !dockedOwners().length && state.rightWorkbenchOwner) {
    setDocked(state.rightWorkbenchOwner, true); return;
  }
  if (state.workbenchLayoutPreference !== previous.workbenchLayoutPreference || state.rightWorkbenchOwner !== previous.rightWorkbenchOwner ||
      state.rightWorkbenchDockedOwners !== previous.rightWorkbenchDockedOwners) renderLayoutControls();
});
