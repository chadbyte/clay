import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { hideHomeHub, showHomeHub } from './app-home-hub.js';
import { openAddProjectModal, switchProject } from './app-projects.js';
import { openUserSettings } from './user-settings.js';
import { rememberHomePrimarySurface, updateHomeSurfacePreference } from './home-surface.js';
import { projectsHubContent } from './projects-hub-view.js';
import { refreshIcons } from './icons.js';

function root() { return document.getElementById('projects-hub'); }

function render() {
  var element = root();
  if (!element || !store.get('projectsHubVisible')) return;
  var html = projectsHubContent(store.snap());
  if (store.get('projectsHubMarkup') === html) return;
  store.set({ projectsHubMarkup: html });
  var active = element.contains(document.activeElement) ? document.activeElement : null;
  var action = active && (active.dataset.projectsAction || active.dataset.projectsMode || active.dataset.projectSlug);
  element.innerHTML = html;
  refreshIcons();
  if (action) {
    var buttons = element.querySelectorAll('button, a');
    for (var i = 0; i < buttons.length; i++) {
      if ((buttons[i].dataset.projectsAction || buttons[i].dataset.projectsMode || buttons[i].dataset.projectSlug) === action && !buttons[i].disabled) {
        buttons[i].focus({ preventScroll: true });
        break;
      }
    }
  }
}

function focusHeading() {
  if (root()) root().scrollTop = 0;
  var title = document.getElementById('projects-title');
  if (title) title.focus({ preventScroll: true });
}

export function showProjectsHub(fromHistory) {
  hideHomeHub();
  store.set({ projectsHubVisible: true, pendingHomeProjectSlug: null });
  document.body.classList.add('projects-active');
  root().classList.remove('hidden');
  rememberHomePrimarySurface('projects');
  if (!fromHistory && location.pathname !== '/projects') {
    var method = document.documentElement.classList.contains('pwa-standalone') ? 'replaceState' : 'pushState';
    history[method](null, '', '/projects');
  }
  render();
  focusHeading();
}

export function hideProjectsHub() {
  if (!store.get('projectsHubVisible')) return;
  store.set({ projectsHubVisible: false, projectsShowGuide: false });
  document.body.classList.remove('projects-active');
  if (root()) root().classList.add('hidden');
}

export function completeProjectsOnboarding() {
  if (store.get('onboardingStep') !== 'project') return;
  updateHomeSurfacePreference({ onboardingStep: 'complete' });
}

function handleClick(event) {
  var button = event.target.closest('[data-projects-action], [data-projects-mode], [data-project-slug]');
  if (!button || button.disabled) return;
  event.preventDefault();
  var action = button.dataset.projectsAction;
  if (action === 'home') { showHomeHub(); return; }
  if (action === 'settings') { openUserSettings(); return; }
  if (action === 'guide') { store.set({ projectsShowGuide: true }); render(); focusHeading(); return; }
  if (action === 'start' || action === 'skip') {
    store.set({ projectsShowGuide: false });
    updateHomeSurfacePreference({ onboardingStep: 'project' });
    if (action === 'skip') showHomeHub();
    else { render(); focusHeading(); }
    return;
  }
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  if (button.dataset.projectSlug) { switchProject(button.dataset.projectSlug); return; }
  if (button.dataset.projectsMode) {
    var permissions = store.get('permissions');
    if (!store.get('projectsAccessLoaded') || (permissions && permissions.createProject !== true)) return;
    openAddProjectModal(button.dataset.projectsMode);
  }
}

export function initProjectsHub() {
  root().addEventListener('click', handleClick);
  store.subscribe(function (state, previous) {
    if (state.projectsHubRestoreRequested && !previous.projectsHubRestoreRequested) {
      showProjectsHub(true);
      if (location.pathname === '/') history.replaceState(null, '', '/projects');
      store.set({ projectsHubRestoreRequested: false });
      return;
    }
    if (!state.projectsHubVisible) return;
    if (state.projectsHubList !== previous.projectsHubList || state.projectListLoaded !== previous.projectListLoaded ||
        state.homeSurfaceLoaded !== previous.homeSurfaceLoaded || state.onboardingStep !== previous.onboardingStep ||
        state.projectsAccessLoaded !== previous.projectsAccessLoaded || state.permissions !== previous.permissions ||
        state.connected !== previous.connected || state.pendingHomeProjectSlug !== previous.pendingHomeProjectSlug) render();
  });
}
