// Existing Mates share the project rail while retaining their conversations.
import { store } from './store.js';
import { applyWorkspaceColor } from './mate-workspace-color.js';
import { mateAvatarUrl } from './avatar.js';
import { renderMateProjectHeader, renderOrdinaryProjectHeader } from './project-header-identity.js';
import { getHomeMateName } from './home-mate-selection.js';
import { switchProject } from './app-projects.js';
import { closeTerminal } from './terminal.js';
import { closeFileViewer } from './filebrowser.js';
import { getActiveMentionMateIds, onMentionActiveChange, bindIconTooltip, hideIconTooltip, showMateCtxMenu } from './sidebar-mates.js';
import { chooseProjectActivationTarget } from './project-activation.js';
import { showProjectsHub } from './projects-hub.js';
import { openProjectSession } from './project-session-navigation.js';

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
  return (!!state.activeProjectMateId && state.activeProjectSlug === state.currentSlug) || (state.projectsHubList || []).some(function (project) {
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
  var mate = mateForWorkspace(state);
  if (!mate || state.homeShellVisible) {
    renderOrdinaryProjectHeader(state);
    return;
  }
  renderMateProjectHeader(state, mate);
}

function ordinaryProjects(state) {
  return (state.projectsHubList || []).filter(function (project) {
    return project && project.slug && project.isMate !== true;
  });
}

function clayIsActive(state, clay) {
  return !!clay && !state.homeShellVisible && !state.dmMode && state.currentSlug === 'mate-' + clay.id;
}

export function clayReturnTargetForState(state) {
  var target = state && state.clayReturnTarget;
  var recordedSlug = target && target.projectSlug;
  var candidates = recordedSlug ? [recordedSlug] : [];
  var slug = chooseProjectActivationTarget(ordinaryProjects(state), candidates);
  if (!slug) return null;
  var sameProject = slug === recordedSlug;
  return {
    projectSlug: slug,
    sessionId: sameProject && target && Number.isSafeInteger(Number(target.sessionId)) && Number(target.sessionId) > 0 ? Number(target.sessionId) : null,
  };
}

function rememberClayReturnTarget(state) {
  if (!state || state.homeShellVisible || state.dmMode || isMateWorkspace(state) || !state.currentSlug ||
      state.activeProjectSlug !== state.currentSlug || state.sessionActivatedProjectSlug !== state.currentSlug) return;
  var projects = ordinaryProjects(state);
  var found = projects.some(function (project) { return project.slug === state.currentSlug; });
  if (!found) return;
  var target = { projectSlug: state.currentSlug, sessionId: Number.isSafeInteger(Number(state.activeSessionId)) && Number(state.activeSessionId) > 0 ? Number(state.activeSessionId) : null };
  store.set({ clayReturnTarget: target });
  return target;
}

function returnFromClay() {
  var state = store.snap();
  var target = clayReturnTargetForState(state);
  if (!target) {
    store.set({ pendingProjectSessionNavigation: null, clayReturnPendingProjectSlug: null, clayReturnTarget: null });
    showProjectsHub();
    return false;
  }
  store.set({ clayReturnTarget: null, clayReturnPendingProjectSlug: target.sessionId ? target.projectSlug : null });
  if (target.sessionId) openProjectSession(target.projectSlug, target.sessionId);
  else {
    store.set({ pendingProjectSessionNavigation: null });
    switchProject(target.projectSlug);
  }
  return true;
}

function updateClayBrand(state) {
  var entry = document.querySelector('.icon-strip-brand');
  if (!entry) return;
  var clay = navigationMates(state.cachedMatesList).find(function (mate) { return mate.builtinKey === 'clay'; });
  var active = clayIsActive(state, clay);
  var speaking = !!(state.youActivity && state.youActivity.active);
  entry.dataset.clayMode = active ? 'mate' : 'project';
  entry.classList.toggle('clay-speaking', speaking);
  var avatar = entry.querySelector('.clay-brand-avatar');
  var logo = entry.querySelector('.clay-brand-logo');
  if (avatar && clay) avatar.src = mateAvatarUrl(clay, 38);
  if (logo) logo.src = 'clay-studio-symbol.png';
  entry.disabled = !clay;
  entry.classList.toggle('active', active);
  entry.setAttribute('aria-label', clay ? (active ? 'Return to project' : 'Open Clay') : 'Clay is unavailable');
  if (active) entry.setAttribute('aria-current', 'page');
  else entry.removeAttribute('aria-current');
}

export function openMateWorkspace(mateId) {
  var mate = navigationMates(store.get('cachedMatesList')).find(function (item) { return item.id === mateId; });
  if (!mate) return;
  if (mate.builtinKey === 'clay' && store.snap) rememberClayReturnTarget(store.snap());
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
  bindIconTooltip(button, function () {
    var mate = navigationMates(store.get('cachedMatesList')).find(function (item) { return item.id === mateId; });
    return {
      text: mate ? getHomeMateName(mate) : 'Mate',
      kind: 'mate',
      avatarUrl: mate ? mateAvatarUrl(mate, 24) : '',
    };
  });
  function openContextMenu(event) {
    event.preventDefault(); event.stopPropagation(); hideIconTooltip();
    var mate = navigationMates(store.get('cachedMatesList')).find(function (item) { return item.id === mateId; });
    if (mate) showMateCtxMenu(button, mate);
  }
  button.addEventListener('contextmenu', openContextMenu);
  button.addEventListener('keydown', function (event) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openContextMenu(event);
  });
  return button;
}

export function renderProjectMates() {
  var rail = document.getElementById('icon-strip-projects');
  if (!rail) return;
  hideIconTooltip();
  var state = store.snap();
  var clay = navigationMates(state.cachedMatesList).find(function (mate) { return mate.builtinKey === 'clay'; });
  var clayActive = !!clay && !state.homeShellVisible && !state.dmMode && state.currentSlug === 'mate-' + clay.id;
  document.body.classList.toggle('clay-workspace-active', clayActive);
  updateClayBrand(state);
  document.body.classList.toggle('mate-workspace-active', !state.homeShellVisible && isMateWorkspace(state));
  applyWorkspaceColor(mateForWorkspace(state));
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
  if (home && !home.classList.contains('icon-strip-brand')) home.classList.toggle('active', !!state.homeShellVisible);
  applyProjectMateFilter();
}

export function initProjectMateNavigation() {
  var clayEntry = document.querySelector('.icon-strip-brand');
  if (clayEntry) {
    clayEntry.addEventListener('click', function () {
      var state = store.snap();
      var clay = navigationMates(state.cachedMatesList).find(function (mate) { return mate.builtinKey === 'clay'; });
      hideIconTooltip();
      if (!clay) return;
      if (!clayIsActive(state, clay)) {
        openMateWorkspace(clay.id);
      } else returnFromClay();
    });
    bindIconTooltip(clayEntry, function () {
      var state = store.snap();
      var clay = navigationMates(state.cachedMatesList).find(function (mate) { return mate.builtinKey === 'clay'; });
      return { text: clayIsActive(state, clay) ? 'Return to project' : 'Open Clay', kind: 'mate', avatarUrl: 'clay-studio-symbol.png' };
    });
  }
  var knob = document.getElementById('icon-strip-filter-knob');
  if (knob) knob.addEventListener('click', activateProjectMateFilter);
  store.subscribe(function (state, previous) {
    if (state.clayReturnPendingProjectSlug && state.currentSlug !== previous.currentSlug &&
        state.currentSlug !== state.clayReturnPendingProjectSlug) {
      store.set({ pendingProjectSessionNavigation: null, clayReturnPendingProjectSlug: null });
    } else if (state.clayReturnPendingProjectSlug && !state.pendingProjectSessionNavigation && previous.pendingProjectSessionNavigation) {
      store.set({ clayReturnPendingProjectSlug: null });
    }
    if (state.cachedMatesList !== previous.cachedMatesList || state.homeChatMateId !== previous.homeChatMateId ||
        state.homeShellVisible !== previous.homeShellVisible || state.projectsHubList !== previous.projectsHubList ||
        state.dmUnread !== previous.dmUnread || state.currentSlug !== previous.currentSlug ||
        state.dmMode !== previous.dmMode || state.connected !== previous.connected || state.activeSessionId !== previous.activeSessionId || state.youActivity !== previous.youActivity) renderProjectMates();
    if (state.projectMateFilterMode !== previous.projectMateFilterMode ||
        state.projectMateFilterTurns !== previous.projectMateFilterTurns) applyProjectMateFilter();
  });
  onMentionActiveChange(renderProjectMates);
  renderProjectMates();
  restoreProjectMateFilter();
}
