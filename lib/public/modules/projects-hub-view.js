import { escapeHtml } from './utils.js';
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

function setupAction(mode, icon, title, text, disabled) {
  return '<button type="button" class="projects-setup-action" data-projects-mode="' + mode + '"' + (disabled ? ' disabled' : '') + '>' +
    '<span class="projects-action-icon">' + iconHtml(icon) + '</span><span><strong>' + title + '</strong><span>' + text + '</span></span>' + iconHtml('arrow-up-right') + '</button>';
}

export function projectsHubContent(state) {
  var projects = ordinaryProjects(state.projectsHubList);
  var ready = state.projectListLoaded;
  var welcome = ready && (state.projectsShowGuide || !projects.length);
  var allowed = state.projectsAccessLoaded && (!state.permissions || state.permissions.createProject === true);
  var available = allowed && state.connected && !state.pendingHomeProjectSlug;
  var html = isShellWelcome(state) ? '' : '<header class="projects-header"><a class="projects-brand" href="/projects"><img src="/clay-studio-symbol.png" alt="">Clay Studio</a>' +
    '<nav aria-label="Workspace navigation">' + button('settings', 'Settings', 'projects-button-quiet') + '</nav></header>';
  html += '<main class="projects-main" aria-labelledby="projects-title">';
  if (!ready) return html + '<div class="projects-loading" role="status"><h1 id="projects-title" tabindex="-1">Your projects</h1><p>Loading your workspace…</p></div></main>';
  if (welcome) {
    var mateReady = !!state.connected && clayMateReady(state);
    return html + '<section class="projects-welcome"><div class="projects-eyebrow">WELCOME TO</div>' +
      '<h1 id="projects-title" tabindex="-1"><span class="projects-wordmark" role="img" aria-label="Clay Studio"></span></h1>' +
      '<p class="projects-lead">Where the minds work together</p>' +
      '<div class="projects-intro-grid">' +
      welcomeCard('01 / PROJECTS', 'Work together on a project.', 'Bring a codebase or a folder of files, and work through it together with Clay Studio.',
        button(projects.length ? 'start' : 'create-project', projects.length ? 'Explore your projects ' + iconHtml('arrow-right') : 'Start a project ' + iconHtml('arrow-right'), 'projects-button-primary', !projects.length && !available), 'project-clay') +
      welcomeCard('02 / MATES', 'Create your own specialist.', 'Create a Mate with the expertise you need, and work together on your ideas and tasks.',
        button('mate', 'Create a Mate ' + iconHtml('arrow-right'), 'projects-button-secondary', !mateReady), 'mate-clay') +
      '</div><p class="projects-footnote">You can revisit this guide from Projects at any time.</p></section></main>';
  }
  html += '<div class="projects-heading"><div><div class="projects-eyebrow">YOUR WORKSPACE</div><h1 id="projects-title" tabindex="-1">Projects</h1>' +
    '<p class="projects-lead">Pick up where you left off, or begin something new.</p></div>' + button('guide', 'Getting started', 'projects-button-quiet') + '</div>';
  if (state.pendingHomeProjectSlug) html += '<p class="projects-status" role="status">Opening your project…</p>';
  if (projects.length) {
    html += '<div class="projects-list" aria-label="Your projects">';
    projects.forEach(function (project) {
      html += '<button type="button" class="projects-list-item" data-project-slug="' + escapeHtml(project.slug) + '"' + (!state.connected || state.pendingHomeProjectSlug ? ' disabled' : '') + '>' +
        '<span class="projects-action-icon">' + iconHtml(project.isWorktree ? 'git-branch' : 'folder') + '</span><span><strong>' + escapeHtml(project.title || project.project || project.slug) + '</strong>' +
        '<span>' + escapeHtml(project.branch || project.path || project.slug) + '</span></span>' + iconHtml('arrow-right') + '</button>';
    });
    html += '</div><h2 class="projects-section-title">Add a project</h2>';
  }
  if (!state.projectsAccessLoaded) html += '<p class="projects-status" role="status">Checking project access…</p>';
  else if (!allowed) html += '<p class="projects-status">Ask an administrator to create or share a project with you.</p>';
  else {
    html += '<div class="projects-setup-actions">' +
      setupAction('existing', 'folder-open', 'Open a folder', 'Use a directory on the machine running Clay.', !available) +
      setupAction('create', 'plus', 'Create a project', 'Start in a new, empty project directory.', !available) +
      setupAction('clone', 'git-branch', 'Clone a repository', 'Bring an existing Git repository into Clay.', !available) + '</div>';
  }
  if (!state.connected) html += '<p class="projects-status" role="status">Reconnecting… Project actions will be available when the connection returns.</p>';
  return html + '</main><footer class="projects-footer">Your projects, conversations, and tools. One workspace.</footer>';
}
