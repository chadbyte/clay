import { iconHtml } from './icons.js';

export function ordinaryProjects(projects) {
  return (Array.isArray(projects) ? projects : []).filter(function (project) {
    return project && !project.isMate && project.slug;
  });
}

// Zero ordinary projects (once the list is known): the welcome renders inside the normal app shell.
export function isShellWelcome(state) {
  return !!state.projectListLoaded && ordinaryProjects(state.projectsHubList).length === 0;
}

function button(action, label, extra, disabled) {
  return '<button type="button" class="projects-button ' + (extra || '') + '" data-projects-action="' + action + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
}

// Mate creation starts with the built-in Clay Mate, so the CTA waits until it is in the loaded Mate list.
export function clayMateReady(state) {
  var mates = Array.isArray(state.cachedMatesList) ? state.cachedMatesList : [];
  for (var i = 0; i < mates.length; i++) if (mates[i] && mates[i].builtinKey === 'clay') return true;
  return false;
}

function welcomeCard(label, title, text, action, artwork) {
  return '<div class="projects-intro-card"><div class="projects-intro-art"><img src="/welcome-art/' + artwork + '.png" width="1536" height="1024" alt="" decoding="async"></div>' +
    '<span class="projects-intro-label">' + label + '</span><h2>' + title + '</h2><p>' + text + '</p><div class="projects-intro-action">' + action + '</div></div>';
}

// The standalone project list no longer exists: the hub renders only the loading state
// and the zero-project welcome. Once ordinary projects are known the app opens a workspace.
export function projectsHubContent(state) {
  var projects = ordinaryProjects(state.projectsHubList);
  if (!state.projectListLoaded || projects.length) {
    return '<main class="projects-main" aria-labelledby="projects-title"><div class="projects-loading" role="status"><h1 id="projects-title" tabindex="-1">Your workspace</h1><p>Loading your workspace…</p></div></main>';
  }
  var allowed = state.projectsAccessLoaded && (!state.permissions || state.permissions.createProject === true);
  var available = allowed && state.connected && !state.pendingHomeProjectSlug;
  var mateReady = !!state.connected && clayMateReady(state);
  return '<main class="projects-main" aria-labelledby="projects-title"><section class="projects-welcome"><div class="projects-eyebrow">WELCOME TO</div>' +
    '<h1 id="projects-title" tabindex="-1"><span class="projects-wordmark" role="img" aria-label="Clay Studio"></span></h1>' +
    '<p class="projects-lead">Where the minds work together</p>' +
    '<div class="projects-intro-grid">' +
    welcomeCard('01 / PROJECTS', 'Work together on a project.', 'Bring a codebase or a folder of files, and work through it together with Clay Studio.',
      button('create-project', 'Start a project ' + iconHtml('arrow-right'), 'projects-button-primary', !available), 'project-clay') +
    welcomeCard('02 / MATES', 'Create your own specialist.', 'Create a Mate with the expertise you need, and work together on your ideas and tasks.',
      button('mate', 'Create a Mate ' + iconHtml('arrow-right'), 'projects-button-secondary', !mateReady), 'mate-clay') +
    '</div></section></main>';
}
