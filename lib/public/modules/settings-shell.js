import { activateSettingsSections, deactivateSettingsSections } from './settings-section-nav.js';
// Unified full-screen settings: one shell for Personal, Project and Server
// settings. Scope modules register a controller; the shell owns routing,
// access, project target binding, focus, close restoration and draft guards.
import { store } from './store.js';
import { refreshIcons } from './icons.js';
import { closeFileViewer } from './filebrowser.js';
import { holdNotesForSettings, releaseNotesForSettings } from './sticky-notes.js';
import { openNotesBrowser, closeNotesBrowser, isNotesBrowserOpen } from './sticky-notes-browser.js';
import { confirmSettingsAction, isolateSettingsDialog, trapSettingsFocus } from './server-settings-state.js';
import { showToast } from './utils.js';
import { enhanceSettingsSelects } from './settings-select.js';
import { accessFromMe, defaultAccess, pagesForScope, resolveRoute, scopeAvailable } from './settings-shell-registry.js';
import { listSettingsProjects, resolveTargetSlug, findChoice, createTargetBinding } from './settings-project-target.js';
import { setShellStatus, renderScopeTabs, renderPageNav, markActivePage, renderProjectSelect, showProjectPicker, syncProjectSelect } from './settings-shell-view.js';

var controllers = {};
var binding = createTargetBinding();
var root = null;
var lastChoices = '';
var OFFLINE = 'Offline. The project list and your project access may be out of date until the connection returns.';
var shell = { verified: false, pending: null, waiting: null, offline: false, open: false, scope: null, pages: {}, slug: null, access: defaultAccess(), returnFocus: null, restoreInert: null, notesReopen: false, token: 0, pending: null };
var OVERLAYS = '.admin-modal-overlay, #settings-confirm, .confirm-above-settings, .avatar-positioner-overlay, .email-setup-overlay, .settings-subview';

export function registerSettingsScope(id, controller) { controllers[id] = controller; }
export function isSettingsShellOpen() { return !!shell.open; }
export function activeSettingsScope() { return shell.scope; }
export function settingsTargetSlug() { return shell.slug; }
// Async replies compare their captured token with the live target.
export function settingsTargetToken() { return binding.generation(); }
export function isSettingsTargetCurrent(token, slug) { return shell.open && binding.isCurrent(token, slug); }

// Fail closed: until a fresh server answer is bound to this open, no
// administrator scope is offered, whatever an earlier session learned.
function provisionalAccess() {
  var perms = store.get('permissions');
  return Object.assign(defaultAccess(), { project: !perms || perms.projectSettings !== false });
}

// Reads only; the caller applies the answer after validating that it still
// belongs to the current open and signed-in user.
function fetchMe() {
  return fetch('/api/me', { credentials: 'same-origin' }).then(function (response) {
    if (!response.ok) throw new Error('Could not verify access.');
    return response.json();
  });
}

function setGears(open) {
  ['server-settings-btn', 'user-settings-btn'].forEach(function (id) {
    var button = document.getElementById(id);
    if (!button) return;
    button.classList.toggle('active', open);
    button.setAttribute('aria-expanded', String(open));
  });
}

function projectChoices() {
  return listSettingsProjects(store.get('projectsHubList'), store.get('currentSlug'), store.get('permissions'));
}

function focusHeading(ctrl) {
  var heading = ctrl && ctrl.pane.querySelector('.active h2');
  if (heading) { heading.tabIndex = -1; heading.focus(); }
}

function setPaneVisibility(scope) {
  Object.keys(controllers).forEach(function (id) { controllers[id].pane.classList.toggle('hidden', id !== scope); });
}

function controller() { return controllers[shell.scope]; }

// Ask before leaving drafts behind. kind: page | scope | project | close.
function guard(kind, proceed, pageId) {
  var ctrl = controller();
  var busy = ctrl && ctrl.busy && ctrl.busy(kind);
  if (busy) { showToast(busy); return; }
  var prompt = ctrl && ctrl.leavePrompt && ctrl.leavePrompt(kind, pageId);
  if (!prompt) { proceed(); return; }
  confirmSettingsAction(prompt.message, prompt.action, function () { if (prompt.apply) prompt.apply(); proceed(); });
}

function choicesSignature(choices, slug) {
  return choices.map(function (choice) { return choice.slug + '|' + choice.label + '|' + choice.isCurrent; }).join('\n') + '#' + (slug || '');
}

function applyProject(ctrl, route, page) {
  var requested = route.slug || shell.slug;
  lastChoices = '';
  // An unloaded list is never "no projects": wait for the authoritative list.
  if (store.get('projectListLoaded') !== true) {
    shell.waiting = { slug: requested };
    binding.bind(null); shell.slug = null;
    renderProjectSelect([], '', onProjectSelect, 'Loading projects…'); showProjectPicker(true);
    renderPageNav(pagesForScope('project', shell.access), page, onPageSelect);
    ctrl.setEmpty('Loading your projects…', 'loading');
    var token = shell.token;
    setTimeout(function () {
      if (shell.open && token === shell.token && shell.waiting) {
        ctrl.setEmpty('Your projects could not be loaded. Check the connection and reopen Settings to try again.', 'error');
        setShellStatus('Your projects could not be loaded.', 'error');
      }
    }, 10000);
    return;
  }
  shell.waiting = null;
  var choices = projectChoices();
  var slug = resolveTargetSlug(requested, choices);
  var lost = !!requested && slug !== requested;
  renderProjectSelect(choices, slug, onProjectSelect);
  lastChoices = choicesSignature(choices, slug);
  showProjectPicker(true);
  binding.bind(slug);
  shell.slug = slug;
  if (!slug) {
    ctrl.setEmpty('You do not have a project to configure yet. Open or create a project, then return here.', 'empty');
    renderPageNav(pagesForScope('project', shell.access), page, onPageSelect);
    return;
  }
  ctrl.setEmpty(null);
  ctrl.retarget(slug, findChoice(choices, slug).project, binding.generation());
  setShellStatus(lost ? 'That project is not available for your account. Showing ' + findChoice(choices, slug).label + '.' : '', lost ? 'error' : undefined);
}

function redirectNote(resolved) {
  if (!resolved.redirected) return '';
  return resolved.requestedScope === 'server' ? 'Server settings require an administrator. Your personal settings are shown.' : 'That settings area is not available for your account.';
}

function currentRoute() {
  return { scope: shell.scope, page: shell.pages[shell.scope], slug: shell.slug || (shell.waiting && shell.waiting.slug) || null };
}

function applyRoute(route, focus) {
  var resolved = resolveRoute(route, shell.access);
  var ctrl = controllers[resolved.scope];
  if (!ctrl) return;
  deactivateSettingsSections();
  if (shell.scope && shell.scope !== resolved.scope && controllers[shell.scope].leave) controllers[shell.scope].leave();
  var entering = shell.scope !== resolved.scope;
  shell.scope = resolved.scope;
  binding.bind(null);
  setPaneVisibility(resolved.scope);
  renderScopeTabs(shell.access, resolved.scope, onScopeSelect);
  setShellStatus(redirectNote(resolved), resolved.redirected ? 'error' : undefined);
  var ctx = { access: shell.access, scope: resolved.scope };
  if (entering && ctrl.enter) ctrl.enter(ctx);
  if (resolved.scope === 'project') applyProject(ctrl, resolved, resolved.page);
  else { showProjectPicker(false); shell.slug = null; shell.waiting = null; }
  var page = resolved.page;
  if (resolved.scope !== 'project' || shell.slug) renderPageNav(pagesForScope(resolved.scope, shell.access), page, onPageSelect);
  shell.pages[resolved.scope] = page;
  if (resolved.scope !== 'project' || shell.slug) ctrl.activate(page, ctx);
  markActivePage(page);
  store.set({ settingsLastRoute: { scope: resolved.scope, page: page, slug: shell.slug } });
  enhanceSettingsSelects(root); refreshIcons(root);
  if (focus && !resolved.anchor) focusHeading(ctrl);
  activateSettingsSections(page, resolved.anchor);
}

function onScopeSelect(scope) {
  if (scope === shell.scope) return;
  guard('scope', function () { applyRoute({ scope: scope, page: shell.pages[scope], slug: scope === 'project' ? currentRoute().slug : null }, true); });
}
function onPageSelect(page) {
  var route = resolveRoute({scope:shell.scope,page:page}, shell.access);
  if (route.page === shell.pages[shell.scope]) {
    if (!route.anchor) focusHeading(controller());
    activateSettingsSections(route.page, route.anchor); return;
  }
  guard('page', function () {
    var ctrl = controller();
    deactivateSettingsSections();
    shell.pages[shell.scope] = route.page; ctrl.activate(route.page, {access:shell.access,scope:shell.scope});
    markActivePage(route.page); store.set({settingsLastRoute:{scope:shell.scope,page:route.page,slug:shell.slug}});
    if (!route.anchor) focusHeading(ctrl);
    activateSettingsSections(route.page, route.anchor);
  }, shell.pages[shell.scope]);
}
// A project switch retargets only the settings view, never the workspace.
function onProjectSelect(slug) {
  syncProjectSelect(shell.slug);
  if (!slug || slug === shell.slug) return;
  guard('project', function () { applyRoute({ scope: 'project', page: shell.pages.project, slug: slug }, false); });
}

export function navigateSettings(route) {
  // Until access is verified, remember the latest request and apply it afterwards.
  if (!shell.verified) { shell.pending = route; return; }
  var resolved = resolveRoute(route, shell.access);
  if (resolved.scope === shell.scope && resolved.page === shell.pages[shell.scope] && (resolved.scope !== 'project' || !route.slug || route.slug === shell.slug)) {
    setShellStatus(redirectNote(resolved), resolved.redirected ? 'error' : undefined);
    if (!resolved.anchor) focusHeading(controller());
    activateSettingsSections(resolved.page, resolved.anchor); return;
  }
  guard(resolved.scope === shell.scope ? (route.slug && route.slug !== shell.slug ? 'project' : 'page') : 'scope', function () { applyRoute(route, true); }, shell.pages[shell.scope]);
}

// Entry for every legacy opener. Returns once the exact destination is shown.
export function openSettings(route) {
  if (!root) return Promise.resolve();
  route = route || store.get('settingsLastRoute') || { scope: 'personal' };
  if (shell.open) { navigateSettings(route); return Promise.resolve(); }
  shell.open = true;
  shell.token += 1;
  var token = shell.token;
  shell.returnFocus = document.activeElement;
  shell.scope = null; shell.pages = {}; shell.slug = null;
  closeFileViewer();
  shell.notesReopen = isNotesBrowserOpen();
  if (shell.notesReopen) closeNotesBrowser();
  holdNotesForSettings();
  root.classList.remove('hidden');
  shell.restoreInert = isolateSettingsDialog(root);
  setGears(true);
  store.set({ settingsOpen: true });
  var userAtOpen = store.get('myUserId');
  shell.verified = false; shell.pending = null;
  shell.access = provisionalAccess();
  setShellStatus('');
  if (route.scope !== 'server') applyRoute(route, true);
  else { renderScopeTabs(shell.access, 'personal', onScopeSelect); setShellStatus('Checking administrator access…'); }
  function current(me) {
    // Stale after close/reopen, or a different signed-in user: ignore entirely.
    return shell.open && token === shell.token && store.get('myUserId') === userAtOpen && (!me || !me.user || !userAtOpen || me.user.id === userAtOpen);
  }
  return fetchMe().then(function (me) {
    if (!current(me)) return;
    var access = accessFromMe(me, me.permissions || null);
    store.set({ adminMe: me, permissions: me.permissions || null, projectsAccessLoaded: true });
    var needsRoute = !shell.scope;
    var changed = access.server !== shell.access.server || access.multiUser !== shell.access.multiUser || access.project !== shell.access.project;
    shell.access = access;
    shell.verified = true;
    var pending = shell.pending; shell.pending = null;
    if (pending) applyRoute(pending, true);
    else if (needsRoute) applyRoute(route, true);
    else if (changed) applyRoute(scopeAvailable(shell.scope, access) ? currentRoute() : { scope: 'personal' }, false);
  }, function () {
    if (!current()) return;
    // Verification failed: Server stays unavailable and the view is rebuilt without it.
    shell.access = Object.assign({}, shell.access, { server: false });
    shell.verified = true;
    var queued = shell.pending; shell.pending = null;
    applyRoute(queued || (shell.scope && shell.scope !== 'server' ? currentRoute() : { scope: 'personal' }), false);
    setShellStatus('Could not verify administrator access, so Server settings are unavailable. Close and reopen Settings to retry.', 'error');
  });
}

function closePrompt() {
  var withDrafts = Object.keys(controllers).filter(function (id) { return controllers[id].leavePrompt && controllers[id].leavePrompt('close'); });
  if (!withDrafts.length) return null;
  if (withDrafts.length === 1 && withDrafts[0] === shell.scope) return controllers[shell.scope].leavePrompt('close');
  return { message: 'You have unsaved changes in another settings area. Closing keeps these drafts in this tab, but reloading the page will lose them.', action: 'Close with drafts' };
}

export function closeSettings(opts) {
  opts = opts || {};
  if (!shell.open) return;
  if (opts.onlyScope && shell.scope !== opts.onlyScope) return;
  function finish() {
    shell.token += 1; binding.invalidate();
    var ctrl = controller();
    deactivateSettingsSections();
    if (ctrl && ctrl.leave) ctrl.leave();
    Object.keys(controllers).forEach(function (id) { if (controllers[id].close) controllers[id].close(); });
    root.classList.add('hidden');
    if (shell.restoreInert) { shell.restoreInert(); shell.restoreInert = null; }
    setGears(false);
    shell.open = false; shell.scope = null; shell.slug = null; shell.waiting = null; shell.offline = false; shell.verified = false; shell.pending = null;
    store.set({ settingsOpen: false });
    releaseNotesForSettings();
    if (!opts.cleanup) {
      if (shell.notesReopen) openNotesBrowser();
      var focus = shell.returnFocus;
      if (!focus || !focus.isConnected || focus === document.body) focus = document.getElementById('server-settings-btn');
      if (focus) focus.focus();
    }
    shell.notesReopen = false; shell.returnFocus = null;
  }
  if (opts.cleanup || opts.force) { finish(); return; }
  var ctrl = controller();
  var busy = ctrl && ctrl.busy && ctrl.busy('close');
  if (busy) { showToast(busy); return; }
  var prompt = closePrompt();
  if (!prompt) { finish(); return; }
  confirmSettingsAction(prompt.message, prompt.action, function () { if (prompt.apply) prompt.apply(); finish(); });
}

// Authorisation, ordering and the open project can change while settings
// are open; an unavailable target is cleared rather than silently replaced.
function refreshLive() {
  if (!shell.open || !shell.scope) return;
  var perms = store.get('permissions');
  var project = !perms || perms.projectSettings !== false;
  if (project !== shell.access.project) {
    shell.access = Object.assign({}, shell.access, { project: project });
    if (shell.scope === 'project' && !project) { applyRoute({ scope: 'personal' }, false); setShellStatus('Project settings are no longer permitted for your account.', 'error'); return; }
    renderScopeTabs(shell.access, shell.scope, onScopeSelect);
  }
  if (shell.scope !== 'project') return;
  syncConnectivity();
  if (shell.waiting && store.get('projectListLoaded') === true) {
    var waiting = shell.waiting; shell.waiting = null;
    applyRoute({ scope: 'project', page: shell.pages.project, slug: waiting.slug }, false);
    return;
  }
  if (shell.waiting) return;
  var choices = projectChoices();
  var ctrl = controller();
  var target = findChoice(choices, shell.slug);
  var signature = choicesSignature(choices, target ? shell.slug : '');
  if (signature !== lastChoices) { lastChoices = signature; renderProjectSelect(choices, target ? shell.slug : '', onProjectSelect); }
  if (shell.slug && !target) {
    var lostSlug = shell.slug;
    binding.invalidate(); shell.slug = null;
    ctrl.clearTarget(lostSlug);
    ctrl.setEmpty('That project is no longer available for your account. Choose another project.', 'lost');
    syncProjectSelect('');
    setShellStatus('The selected project is no longer available. Unsaved edits for it were not applied.', 'error');
  } else if (target) ctrl.refreshTarget(shell.slug, target.project);
}

function syncConnectivity() {
  var offline = store.get('connected') === false;
  if (offline && !shell.offline) { shell.offline = true; setShellStatus(OFFLINE, 'error'); }
  else if (!offline && shell.offline) { shell.offline = false; setShellStatus(''); }
}

export function initSettingsShell() {
  root = document.getElementById('settings-shell');
  if (!root) return;
  var content = document.getElementById('settings-shell-content');
  ['user-settings', 'project-settings', 'server-settings'].forEach(function (id) {
    var pane = document.getElementById(id);
    if (pane) { pane.classList.add('settings-pane', 'hidden'); content.appendChild(pane); }
  });
  document.getElementById('settings-shell-close').onclick = function () { closeSettings(); };
  var server = document.getElementById('server-settings-btn');
  if (server) server.addEventListener('click', function () { if (shell.open) closeSettings(); else openSettings(); });
  var personal = document.getElementById('user-settings-btn');
  if (personal) personal.addEventListener('click', function () { openSettings({ scope: 'personal' }); });
  document.addEventListener('keydown', function (event) {
    if (shell.open && event.key === 'Tab' && !document.querySelector('#settings-confirm, .admin-modal-overlay')) trapSettingsFocus(event, root);
    if (!shell.open || event.key !== 'Escape' || event.defaultPrevented) return;
    if (store.get('speechPopup') || document.querySelector(OVERLAYS)) return;
    event.preventDefault(); closeSettings();
  });
  store.subscribe(function (state, previous) {
    if (state.myUserId !== previous.myUserId) { closeSettings({ cleanup: true }); return; }
    if (state.projectsHubList !== previous.projectsHubList || state.currentSlug !== previous.currentSlug || state.permissions !== previous.permissions || state.projectListLoaded !== previous.projectListLoaded || state.connected !== previous.connected) refreshLive();
  });
}
