// Existing Mates share the project rail while retaining their conversations.
import { store } from './store.js';
import { mateAvatarUrl } from './avatar.js';
import { getHomeMateName } from './home-mate-selection.js';
import { switchProject } from './app-projects.js';
import { closeTerminal } from './terminal.js';
import { closeFileViewer } from './filebrowser.js';
import { getActiveMentionMateIds, onMentionActiveChange, showIconTooltip, hideIconTooltip, showMateCtxMenu } from './sidebar-mates.js';

var FILTER_MODES = ['all', 'projects', 'mates'];
var FILTER_LABELS = { all: 'All', projects: 'Projects', mates: 'Mates' };
var filterSaveQueue = Promise.resolve();

export function normalizeProjectMateFilterMode(mode) {
  return FILTER_MODES.indexOf(mode) === -1 ? 'all' : mode;
}

export function advanceProjectMateFilter(mode, turns) {
  var index = FILTER_MODES.indexOf(normalizeProjectMateFilterMode(mode));
  return { mode: FILTER_MODES[(index + 1) % FILTER_MODES.length], turns: (Number(turns) || 0) + 1 };
}

function applyProjectMateFilter() {
  var rail = document.getElementById('icon-strip-projects');
  var knob = document.getElementById('icon-strip-filter-knob');
  if (!rail || !knob) return;
  var mode = normalizeProjectMateFilterMode(store.get('projectMateFilterMode'));
  var turns = Number(store.get('projectMateFilterTurns')) || 0;
  var next = FILTER_MODES[(FILTER_MODES.indexOf(mode) + 1) % FILTER_MODES.length];
  rail.dataset.filterMode = mode;
  knob.dataset.mode = mode;
  knob.setAttribute('aria-label', 'Showing ' + FILTER_LABELS[mode].toLowerCase() + '. Activate to show ' + FILTER_LABELS[next].toLowerCase());
  knob.querySelector('.icon-strip-filter-pointer').style.transform = 'rotate(' + (turns * 120) + 'deg)';
  document.getElementById('icon-strip-filter-label').textContent = FILTER_LABELS[mode];
}

function saveProjectMateFilter(mode) {
  filterSaveQueue = filterSaveQueue.catch(function () {}).then(function () {
    return fetch('/api/user/project-mate-filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ mode: mode })
    });
  }).catch(function () {});
}

function activateProjectMateFilter() {
  var next = advanceProjectMateFilter(store.get('projectMateFilterMode'), store.get('projectMateFilterTurns'));
  store.set({ projectMateFilterMode: next.mode, projectMateFilterTurns: next.turns, projectMateFilterActivated: true });
  saveProjectMateFilter(next.mode);
}

function restoreProjectMateFilter() {
  fetch('/api/profile', { credentials: 'same-origin' }).then(function (response) {
    if (!response.ok) throw new Error('Unable to restore project and Mate filter');
    return response.json();
  }).then(function (profile) {
    if (store.get('projectMateFilterActivated')) return;
    var mode = normalizeProjectMateFilterMode(profile.projectMateFilterMode);
    store.set({ projectMateFilterMode: mode, projectMateFilterTurns: FILTER_MODES.indexOf(mode) });
  }).catch(function () {});
}

export function navigationMates(mates) {
  return (Array.isArray(mates) ? mates : []).filter(function (mate) {
    return mate && mate.id && !mate.archived;
  }).sort(function (a, b) {
    var aClay = a.builtinKey === 'clay' ? 0 : 1;
    var bClay = b.builtinKey === 'clay' ? 0 : 1;
    return aClay - bClay || (a.createdAt || 0) - (b.createdAt || 0);
  });
}

export function isMateWorkspace(state) {
  return (state.projectsHubList || []).some(function (project) {
    return project.slug === state.currentSlug && project.isMate === true;
  }) || navigationMates(state.cachedMatesList).some(function (mate) {
    return state.currentSlug === 'mate-' + mate.id;
  });
}

export function mateForWorkspace(state) {
  var mates = navigationMates(state.cachedMatesList);
  for (var i = 0; i < mates.length; i++) if (state.currentSlug === 'mate-' + mates[i].id) return mates[i];
  return null;
}

function renderMateHeaderDefault(state) {
  var detail = document.getElementById('title-bar-project-default');
  var dropdown = document.getElementById('title-bar-project-dropdown');
  if (!detail || !dropdown) return;
  var mate = mateForWorkspace(state);
  if (!mate || state.homeShellVisible) {
    detail.textContent = '';
    dropdown.removeAttribute('data-mate-defaults');
    dropdown.removeAttribute('aria-label');
    dropdown.removeAttribute('title');
    return;
  }
  var vendor = mate.vendor || 'Default vendor';
  var model = mate.model || 'default model';
  detail.textContent = vendor + ' · ' + model;
  dropdown.dataset.mateDefaults = 'true';
  dropdown.setAttribute('aria-label', 'Mate defaults for ' + getHomeMateName(mate) + ': ' + vendor + ', ' + model);
  dropdown.title = 'Change Mate default vendor and model';
}

export function openMateWorkspace(mateId) {
  var mate = navigationMates(store.get('cachedMatesList')).find(function (item) { return item.id === mateId; });
  if (!mate) return;
  if (store.get('currentSlug') !== 'mate-' + mateId) {
    closeTerminal();
    closeFileViewer();
  }
  switchProject('mate-' + mateId);
}

function createMateIcon(mateId) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-strip-item icon-strip-project-mate';
  button.dataset.mateId = mateId;
  button.innerHTML = '<img class="icon-strip-mate-avatar" alt="" draggable="false"><span class="icon-strip-pill"></span><span class="icon-strip-status"></span><span class="icon-strip-project-badge"></span>';
  button.addEventListener('click', function () {
    hideIconTooltip();
    openMateWorkspace(mateId);
  });
  button.addEventListener('mouseenter', function () { showIconTooltip(button, button.getAttribute('aria-label')); });
  button.addEventListener('mouseleave', hideIconTooltip);
  button.addEventListener('blur', hideIconTooltip);
  button.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    var mate = navigationMates(store.get('cachedMatesList')).find(function (item) { return item.id === mateId; });
    if (mate) showMateCtxMenu(button, mate);
  });
  return button;
}

export function renderProjectMates() {
  var rail = document.getElementById('icon-strip-projects');
  if (!rail) return;
  var state = store.snap();
  document.body.classList.toggle('mate-workspace-active', !state.homeShellVisible && isMateWorkspace(state));
  renderMateHeaderDefault(state);
  var mates = navigationMates(state.cachedMatesList).filter(function (mate) {
    return mate.builtinKey !== 'clay';
  });
  var mentionActive = getActiveMentionMateIds();
  var projects = state.projectsHubList || [];
  var unread = state.dmUnread || {};
  var icons = {};
  rail.querySelectorAll('[data-mate-id]').forEach(function (button) { icons[button.dataset.mateId] = button; });
  mates.forEach(function (mate) {
    var button = icons[mate.id] || createMateIcon(mate.id);
    delete icons[mate.id];
    var active = !state.homeShellVisible && !state.dmMode && state.currentSlug === 'mate-' + mate.id;
    var project = projects.find(function (item) { return item.slug === 'mate-' + mate.id; });
    var busy = !!(project && project.isProcessing) || !!mentionActive[mate.id];
    var count = active ? 0 : (unread[mate.id] || 0);
    button.classList.toggle('active', !!active);
    button.setAttribute('aria-label', getHomeMateName(mate) + ', Mate' + (busy ? ', working' : '') + (count ? ', ' + count + ' unread' : ''));
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    var avatar = button.querySelector('img');
    var url = mateAvatarUrl(mate, 38);
    if (avatar.getAttribute('src') !== url) avatar.src = url;
    var status = button.querySelector('.icon-strip-status');
    status.classList.toggle('processing', busy);
    status.classList.toggle('connected', !!state.connected);
    var badge = button.querySelector('.icon-strip-project-badge');
    badge.classList.toggle('has-unread', count > 0);
    badge.textContent = count > 99 ? '99+' : count ? String(count) : '';
    if (!button.parentNode) rail.appendChild(button);
  });
  Object.keys(icons).forEach(function (id) { icons[id].remove(); });
  var ordered = Array.from(rail.querySelectorAll('[data-mate-id]'));
  mates.forEach(function (mate, index) {
    var button = ordered.find(function (item) { return item.dataset.mateId === mate.id; });
    if (ordered[index] === button) return;
    rail.insertBefore(button, ordered[index] || null);
    ordered.splice(ordered.indexOf(button), 1);
    ordered.splice(index, 0, button);
  });
  var separator = rail.querySelector('.icon-strip-peer-separator');
  var hasProjects = !!rail.querySelector(':scope > .icon-strip-item[data-slug], :scope > .icon-strip-group');
  if (hasProjects && mates.length) {
    if (!separator) {
      separator = document.createElement('div');
      separator.className = 'icon-strip-peer-separator';
    }
    var firstMate = rail.querySelector(':scope > [data-mate-id]');
    if (firstMate) rail.insertBefore(separator, firstMate);
  } else if (separator) {
    separator.remove();
  }
  rail.querySelectorAll('[data-slug]').forEach(function (item) {
    item.classList.toggle('active', !state.homeShellVisible && !state.dmMode && item.dataset.slug === state.currentSlug);
  });
  var home = document.querySelector('.icon-strip-home');
  if (home) home.classList.toggle('active', !!state.homeShellVisible);
  applyProjectMateFilter();
}

export function initProjectMateNavigation() {
  var knob = document.getElementById('icon-strip-filter-knob');
  if (knob) knob.addEventListener('click', activateProjectMateFilter);
  store.subscribe(function (state, previous) {
    if (state.cachedMatesList !== previous.cachedMatesList || state.homeChatMateId !== previous.homeChatMateId ||
        state.homeShellVisible !== previous.homeShellVisible || state.projectsHubList !== previous.projectsHubList ||
        state.dmUnread !== previous.dmUnread || state.currentSlug !== previous.currentSlug ||
        state.dmMode !== previous.dmMode || state.connected !== previous.connected) renderProjectMates();
    if (state.projectMateFilterMode !== previous.projectMateFilterMode ||
        state.projectMateFilterTurns !== previous.projectMateFilterTurns) applyProjectMateFilter();
  });
  onMentionActiveChange(renderProjectMates);
  renderProjectMates();
  restoreProjectMateFilter();
}
