import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { switchProject } from './app-projects.js';
import { openAddProjectModal } from './project-start-dialog.js';
import { startClayMateCreation } from './project-mate-creation-workspace.js';
import { updateHomeSurfacePreference } from './home-surface.js';
import { projectsHubContent, isShellWelcome, clayMateReady, ordinaryProjects } from './projects-hub-view.js';
import { refreshIcons } from './icons.js';

function root() { return document.getElementById('projects-hub'); }

function render() {
  var element = root();
  if (!element || !store.get('projectsHubVisible')) return;
  document.body.classList.toggle('projects-shell', isShellWelcome(store.snap()));
  var html = projectsHubContent(store.snap());
  if (store.get('projectsHubMarkup') === html) return;
  store.set({ projectsHubMarkup: html });
  var active = element.contains(document.activeElement) ? document.activeElement : null;
  var action = active && (active.dataset.projectsAction);
  element.innerHTML = html;
  refreshIcons();
  if (action) {
    var buttons = element.querySelectorAll('button, a');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].dataset.projectsAction === action && !buttons[i].disabled) {
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

// The authorised project to open when no standalone list exists: the server-saved
// last project, then the current one, then the first ordinary project. Only
// projects present in the server-provided list qualify.
function workspaceFallback() {
  var known = ordinaryProjects(store.get('projectsHubList')).map(function (project) { return project.slug; });
  var choices = [store.get('homeSurfaceProjectSlug'), store.get('currentSlug'), known[0]];
  for (var i = 0; i < choices.length; i++) if (choices[i] && known.indexOf(choices[i]) !== -1) return choices[i];
  return null;
}

// Shows the loading or zero-project welcome; with projects present it opens a workspace instead.
export function showProjectsHub(fromHistory) {
  if (store.get('projectListLoaded') && ordinaryProjects(store.get('projectsHubList')).length) {
    var slug = workspaceFallback();
    if (slug) {
      hideProjectsHub();
      if (fromHistory) history.replaceState(null, '', '/p/' + slug + '/');
      switchProject(slug);
      return;
    }
  }
  store.set({ projectsHubVisible: true, pendingHomeProjectSlug: null });
  document.body.classList.add('projects-active');
  root().classList.remove('hidden');
  if (location.pathname === '/projects' || location.pathname === '/projects/') history.replaceState(null, '', '/');
  render();
  focusHeading();
}

export function hideProjectsHub() {
  if (!store.get('projectsHubVisible')) return;
  store.set({ projectsHubVisible: false });
  document.body.classList.remove('projects-active', 'projects-shell');
  if (root()) root().classList.add('hidden');
}

export function completeProjectsOnboarding() {
  if (store.get('onboardingStep') !== 'project') return;
  updateHomeSurfacePreference({ onboardingStep: 'complete' });
}

function handleClick(event) {
  var button = event.target.closest('[data-projects-action]');
  if (!button || button.disabled) return;
  event.preventDefault();
  var action = button.dataset.projectsAction;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  if (action === 'mate') { if (clayMateReady(store.snap())) startClayMateCreation(); return; }
  if (action === 'create-project') {
    var permissions = store.get('permissions');
    if (!store.get('projectsAccessLoaded') || store.get('pendingHomeProjectSlug') || (permissions && permissions.createProject !== true)) return;
    openAddProjectModal();
  }
}

export function initProjectsHub() {
  root().addEventListener('click', handleClick);
  store.subscribe(function (state, previous) {
    if (state.projectsHubRestoreRequested && !previous.projectsHubRestoreRequested) {
      showProjectsHub(true);
      store.set({ projectsHubRestoreRequested: false });
      return;
    }
    if (!state.projectsHubVisible) return;
    // A project already being opened keeps its own activation; otherwise known projects replace the hub.
    if (state.projectListLoaded && !state.pendingHomeProjectSlug && ordinaryProjects(state.projectsHubList).length) { showProjectsHub(true); return; }
    if (state.projectsHubList !== previous.projectsHubList || state.projectListLoaded !== previous.projectListLoaded ||
        state.homeSurfaceLoaded !== previous.homeSurfaceLoaded || state.onboardingStep !== previous.onboardingStep ||
        state.projectsAccessLoaded !== previous.projectsAccessLoaded || state.permissions !== previous.permissions ||
        state.connected !== previous.connected || state.cachedMatesList !== previous.cachedMatesList || state.pendingHomeProjectSlug !== previous.pendingHomeProjectSlug) render();
  });
}
