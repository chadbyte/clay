import { escapeHtml } from './utils.js';
import { iconHtml } from './icons.js';

export function ordinaryProjects(projects) {
  return (Array.isArray(projects) ? projects : []).filter(function (project) {
    return project && !project.isMate && project.slug;
  });
}

function button(action, label, extra) {
  return '<button type="button" class="projects-button ' + (extra || '') + '" data-projects-action="' + action + '">' + label + '</button>';
}

function setupAction(mode, icon, title, text, disabled) {
  return '<button type="button" class="projects-setup-action" data-projects-mode="' + mode + '"' + (disabled ? ' disabled' : '') + '>' +
    '<span class="projects-action-icon">' + iconHtml(icon) + '</span><span><strong>' + title + '</strong><span>' + text + '</span></span>' + iconHtml('arrow-up-right') + '</button>';
}

export function projectsHubContent(state) {
  var projects = ordinaryProjects(state.projectsHubList);
  var ready = state.projectListLoaded && state.homeSurfaceLoaded;
  var welcome = ready && (state.projectsShowGuide || (!projects.length && (state.onboardingStep || 'welcome') === 'welcome'));
  var allowed = state.projectsAccessLoaded && (!state.permissions || state.permissions.createProject === true);
  var available = allowed && state.connected && !state.pendingHomeProjectSlug;
  var html = '<header class="projects-header"><a class="projects-brand" href="/" data-projects-action="home"><img src="/clay-studio-symbol.png" alt="">Clay Studio</a>' +
    '<nav aria-label="Workspace navigation">' + button('home', 'Home', 'projects-button-quiet') + button('settings', 'Settings', 'projects-button-quiet') + '</nav></header>';
  html += '<main class="projects-main" aria-labelledby="projects-title">';
  if (!ready) return html + '<div class="projects-loading" role="status"><h1 id="projects-title" tabindex="-1">Your projects</h1><p>Loading your workspace…</p></div></main>';
  if (welcome) {
    return html + '<section class="projects-welcome"><div class="projects-eyebrow">WELCOME TO CLAY</div>' +
      '<h1 id="projects-title" tabindex="-1">A place for<br>your next idea.</h1>' +
      '<p class="projects-lead">Bring a project. Describe what you want to build.<br>Your AI Driver helps you take it from there.</p>' +
      '<div class="projects-intro-grid"><div><span>01 / PROJECTS</span><h2>Work on something real.</h2><p>Open a folder, start fresh, or clone a repository. Your conversations and tools stay with the project.</p></div>' +
      '<div><span>02 / HOME</span><h2>Make room to think.</h2><p>Talk with Clay and your Mates, explore ideas, and return to your projects whenever you’re ready.</p></div></div>' +
      '<div class="projects-welcome-actions">' + button('start', projects.length ? 'Explore your projects ' + iconHtml('arrow-right') : 'Set up your first project ' + iconHtml('arrow-right'), 'projects-button-primary') +
      button('skip', 'Explore Home first', 'projects-button-quiet') + '</div>' +
      '<p class="projects-footnote">You can revisit this guide from Projects at any time.</p></section></main>';
  }
  html += '<div class="projects-heading"><div><div class="projects-eyebrow">YOUR WORKSPACE</div><h1 id="projects-title" tabindex="-1">' + (projects.length ? 'Projects' : 'Start with a project.') + '</h1>' +
    '<p class="projects-lead">' + (projects.length ? 'Pick up where you left off, or begin something new.' : 'Choose where your work will live. You can add more projects later.') + '</p></div>' + button('guide', 'Getting started', 'projects-button-quiet') + '</div>';
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
    if (!projects.length) html += '<p class="projects-next-step"><span>UP NEXT</span> Choose your AI in the workspace, then tell your Driver what you want to build or fix.</p>';
  }
  if (!state.connected) html += '<p class="projects-status" role="status">Reconnecting… Project actions will be available when the connection returns.</p>';
  return html + '</main><footer class="projects-footer">Your projects, conversations, and tools. One workspace.</footer>';
}
