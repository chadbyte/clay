// Cross-Mate debate archive and launcher. Conversation content remains in the
// owning Mate project; this panel is only an authorized index and launch pad.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { switchProject } from './app-projects.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';
import { startProjectDebatePlanning } from './project-debate-planning-workspace.js';

var panel = null;
var requestSequence = 0;
var opener = null;
var backgroundState = [];

function narrowLayout() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 1023px)').matches;
}

function setNarrowBackground(hidden) {
  var selectors = ['#app', '#sidebar-column', '#icon-strip', '#top-bar', '#main-column > .title-bar-content', '#dm-header-bar'];
  if (hidden) {
    backgroundState = [];
    for (var i = 0; i < selectors.length; i++) {
      var element = document.querySelector(selectors[i]);
      if (!element) continue;
      backgroundState.push({ element: element, inert: element.inert === true, ariaHidden: element.getAttribute('aria-hidden') });
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    }
    return;
  }
  for (var j = 0; j < backgroundState.length; j++) {
    backgroundState[j].element.inert = backgroundState[j].inert;
    if (backgroundState[j].ariaHidden == null) backgroundState[j].element.removeAttribute('aria-hidden');
    else backgroundState[j].element.setAttribute('aria-hidden', backgroundState[j].ariaHidden);
  }
  backgroundState = [];
}

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function phaseLabel(phase) {
  if (phase === 'live') return 'Live';
  if (phase === 'ended') return 'Ended';
  if (phase === 'interrupted') return 'Interrupted';
  return 'Planning';
}

function dateLabel(value) {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) return 'Date unavailable';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)); }
  catch (error) { return new Date(value).toLocaleDateString(); }
}

function participantsLabel(participants) {
  var source = Array.isArray(participants) ? participants : [];
  var names = [];
  for (var i = 0; i < source.length; i++) if (source[i] && source[i].name) names.push(source[i].name);
  return names.length ? names.join(', ') : 'Panel not selected';
}

function ensurePanel() {
  if (panel) return panel;
  var host = document.getElementById('main-panels');
  if (!host) return null;
  panel = document.createElement('section');
  panel.id = 'debates-workbench';
  panel.className = 'hidden';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Debates');
  panel.innerHTML =
    '<header class="debates-workbench-topbar">' +
      '<span class="debates-workbench-title">' + iconHtml('messages-square') + 'Debates</span>' +
      '<button class="debates-workbench-new" type="button" data-debates-action="new">' + iconHtml('plus') + 'New debate</button>' +
      '<div class="debates-workbench-actions">' +
        '<button class="debates-workbench-icon" type="button" data-debates-action="wide" title="Widen panel" aria-label="Widen Debates panel" aria-pressed="false">' + iconHtml('chevrons-left-right') + '</button>' +
        '<button class="debates-workbench-icon" type="button" data-debates-action="fullscreen" title="Toggle fullscreen" aria-label="Toggle Debates fullscreen" aria-pressed="false">' + iconHtml('maximize-2') + '</button>' +
        '<button class="debates-workbench-icon" type="button" data-debates-action="close" title="Close" aria-label="Close Debates">' + iconHtml('x') + '</button>' +
      '</div>' +
    '</header>' +
    '<div class="debates-workbench-filters" role="group" aria-label="Filter debates"></div>' +
    '<form class="debates-workbench-form hidden"><label for="debates-workbench-topic">What should the debate be about?</label><textarea id="debates-workbench-topic" maxlength="1000" required placeholder="Enter a question or topic"></textarea><p class="debates-workbench-launch-status" role="alert"></p><div class="debates-workbench-form-actions"><button type="button" data-debates-action="cancel-new">Cancel</button><button type="submit">Continue in chat</button></div></form>' +
    '<p class="debates-workbench-summary" role="status" aria-live="polite"></p>' +
    '<div class="debates-workbench-list" role="list"></div>';
  host.appendChild(panel);
  panel.addEventListener('click', handleClick);
  panel.addEventListener('keydown', handleKeydown);
  panel.querySelector('form').addEventListener('submit', submitNewDebate);
  refreshIcons();
  return panel;
}

function requestDebates() {
  requestSequence += 1;
  var requestId = 'debates-workbench-' + requestSequence;
  store.set({ debatesWorkbenchStatus: 'loading', debatesWorkbenchRequestId: requestId, debatesWorkbenchError: '' });
  if (!send({ type: 'home_debates_list', requestId: requestId })) {
    store.set({ debatesWorkbenchStatus: 'error', debatesWorkbenchError: 'Reconnect to load your debates.' });
    render();
    return;
  }
  render();
}

function renderFilters() {
  var filters = panel.querySelector('.debates-workbench-filters');
  var active = store.get('debatesWorkbenchFilter') || 'all';
  var specs = [{ key: 'all', label: 'All' }, { key: 'planning', label: 'Planning' }, { key: 'live', label: 'Live' }, { key: 'ended', label: 'Ended' }, { key: 'interrupted', label: 'Interrupted' }];
  filters.innerHTML = '';
  for (var i = 0; i < specs.length; i++) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'debates-workbench-filter';
    button.dataset.debatesFilter = specs[i].key;
    button.setAttribute('aria-pressed', specs[i].key === active ? 'true' : 'false');
    button.textContent = specs[i].label;
    filters.appendChild(button);
  }
}

function debateRow(debate) {
  var row = document.createElement('button');
  row.type = 'button';
  row.className = 'debates-workbench-row';
  row.dataset.projectSlug = debate.projectSlug || '';
  row.dataset.sessionId = String(debate.localId == null ? '' : debate.localId);
  row.setAttribute('role', 'listitem');
  var title = document.createElement('strong');
  title.textContent = debate.topic || debate.title || 'Debate planning';
  var panelists = document.createElement('span');
  panelists.className = 'debates-workbench-row-panel';
  panelists.textContent = participantsLabel(debate.participants);
  var meta = document.createElement('span');
  meta.className = 'debates-workbench-row-meta';
  var phase = document.createElement('span');
  phase.className = 'debates-workbench-phase';
  phase.textContent = phaseLabel(debate.phase);
  var date = document.createElement('span');
  date.textContent = dateLabel(debate.lastActivity);
  meta.appendChild(phase);
  meta.appendChild(date);
  row.appendChild(title);
  row.appendChild(panelists);
  row.appendChild(meta);
  return row;
}

function render() {
  if (!panel || panel.classList.contains('hidden')) return;
  renderFilters();
  panel.querySelector('form').classList.toggle('hidden', !store.get('debatesWorkbenchCreating'));
  var summary = panel.querySelector('.debates-workbench-summary');
  var list = panel.querySelector('.debates-workbench-list');
  var status = store.get('debatesWorkbenchStatus') || 'idle';
  var filter = store.get('debatesWorkbenchFilter') || 'all';
  var debates = (store.get('debatesWorkbenchItems') || []).filter(function (item) { return filter === 'all' || item.phase === filter; });
  list.innerHTML = '';
  if (status === 'loading' || status === 'idle') {
    summary.textContent = 'Loading debates…';
    list.innerHTML = '<div class="debates-workbench-empty"><strong>Gathering your debates</strong>Planning sessions and completed debates will appear here.</div>';
  } else if (status === 'error') {
    summary.textContent = 'Debates could not be loaded.';
    var failure = document.createElement('div');
    failure.className = 'debates-workbench-empty';
    var failureTitle = document.createElement('strong');
    failureTitle.textContent = 'Could not load debates';
    var failureText = document.createElement('span');
    failureText.textContent = store.get('debatesWorkbenchError') || 'Try again when the connection is available.';
    failure.appendChild(failureTitle);
    failure.appendChild(failureText);
    list.appendChild(failure);
  } else if (!debates.length) {
    summary.textContent = filter === 'all' ? 'No debates yet' : 'No ' + filter + ' debates';
    list.innerHTML = '<div class="debates-workbench-empty"><strong>Nothing here yet</strong>Use New debate to plan one with Clay in the main chat.</div>';
  } else {
    summary.textContent = debates.length + (debates.length === 1 ? ' debate' : ' debates');
    for (var i = 0; i < debates.length; i++) list.appendChild(debateRow(debates[i]));
  }
  list.scrollTop = Number(store.get('debatesWorkbenchScrollTop')) || 0;
  refreshIcons();
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDebatesWorkbench(true);
    return;
  }
  if (event.key !== 'Tab' || !narrowLayout()) return;
  var controls = panel.querySelectorAll('button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (!controls.length) return;
  var first = controls[0];
  var last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function applyWindowState(wide, fullscreen) {
  store.set({ debatesWorkbenchWide: !!wide, debatesWorkbenchFullscreen: !!fullscreen });
  panel.classList.toggle('debates-workbench-wide', !!wide && !fullscreen);
  panel.classList.toggle('panel-fullscreen', !!fullscreen);
  panel.querySelector('[data-debates-action="wide"]').setAttribute('aria-pressed', wide ? 'true' : 'false');
  panel.querySelector('[data-debates-action="fullscreen"]').setAttribute('aria-pressed', fullscreen ? 'true' : 'false');
}

function handleClick(event) {
  var filter = event.target.closest('[data-debates-filter]');
  if (filter) { store.set({ debatesWorkbenchFilter: filter.dataset.debatesFilter }); render(); return; }
  var row = event.target.closest('.debates-workbench-row');
  if (row) {
    var localId = Number(row.dataset.sessionId);
    if (!row.dataset.projectSlug || !Number.isSafeInteger(localId) || localId < 1) return;
    store.set({ pendingDebateNavigation: { projectSlug: row.dataset.projectSlug, sessionId: localId } });
    if (narrowLayout()) closeDebatesWorkbench(false);
    switchProject(row.dataset.projectSlug);
    flushPendingNavigation();
    return;
  }
  var action = event.target.closest('[data-debates-action]');
  if (!action) return;
  if (action.dataset.debatesAction === 'close') closeDebatesWorkbench(true);
  if (action.dataset.debatesAction === 'new') {
    store.set({ debatesWorkbenchCreating: true }); render();
    panel.querySelector('textarea').focus({ preventScroll: true });
  }
  if (action.dataset.debatesAction === 'cancel-new') { store.set({ debatesWorkbenchCreating: false }); render(); }
  if (action.dataset.debatesAction === 'wide') applyWindowState(!store.get('debatesWorkbenchWide'), false);
  if (action.dataset.debatesAction === 'fullscreen') applyWindowState(false, !store.get('debatesWorkbenchFullscreen'));
}

function submitNewDebate(event) {
  event.preventDefault();
  var input = panel.querySelector('textarea');
  var topic = input.value.trim();
  if (!topic) { input.focus(); return; }
  var status = panel.querySelector('.debates-workbench-launch-status');
  status.textContent = 'Opening Clay in the main chat…';
  if (!startProjectDebatePlanning(topic)) {
    status.textContent = store.get('projectDebatePlanningError') || 'Clay is unavailable. Refresh and try again.';
    input.focus();
    return;
  }
  input.value = '';
  store.set({ debatesWorkbenchCreating: false });
  closeDebatesWorkbench();
}

function flushPendingNavigation() {
  var pending = store.get('pendingDebateNavigation');
  var ws = getWs();
  if (!pending || store.get('activeProjectSlug') !== pending.projectSlug || !ws || ws.readyState !== 1) return;
  store.set({ pendingDebateNavigation: null });
  ws.send(JSON.stringify({ type: 'switch_session', id: pending.sessionId }));
}

export function handleDebatesWorkbenchState(msg) {
  if (!msg || msg.type !== 'home_debates_state') return false;
  if (msg.requestId && msg.requestId !== store.get('debatesWorkbenchRequestId')) return true;
  store.set({ debatesWorkbenchStatus: msg.status === 'error' || msg.error ? 'error' : 'ready', debatesWorkbenchItems: Array.isArray(msg.debates) ? msg.debates : [], debatesWorkbenchError: msg.error || '' });
  render();
  return true;
}

export function openDebatesWorkbench(trigger) {
  if (!ensurePanel()) return;
  opener = trigger && trigger.focus ? trigger : document.activeElement;
  claimRightWorkbench('debates');
  panel.classList.remove('hidden');
  var narrow = narrowLayout();
  panel.setAttribute('role', narrow ? 'dialog' : 'region');
  panel.setAttribute('aria-modal', narrow ? 'true' : 'false');
  setNarrowBackground(narrow);
  applyWindowState(store.get('debatesWorkbenchWide'), store.get('debatesWorkbenchFullscreen'));
  requestDebates();
  requestAnimationFrame(function () { panel.querySelector('[data-debates-action="new"]').focus({ preventScroll: true }); });
}

export function closeDebatesWorkbench(restoreFocus) {
  if (panel) {
    var list = panel.querySelector('.debates-workbench-list');
    if (list) store.set({ debatesWorkbenchScrollTop: list.scrollTop });
    panel.classList.add('hidden');
  }
  setNarrowBackground(false);
  releaseRightWorkbench('debates');
  if (restoreFocus && opener && opener.isConnected) opener.focus({ preventScroll: true });
}

export function initDebatesWorkbench() {
  registerRightWorkbench('debates', function () { closeDebatesWorkbench(false); });
  var buttons = [document.getElementById('debates-btn'), document.getElementById('mate-debates-btn')];
  for (var i = 0; i < buttons.length; i++) if (buttons[i]) buttons[i].addEventListener('click', function (event) {
    if (panel && !panel.classList.contains('hidden')) closeDebatesWorkbench(true);
    else openDebatesWorkbench(event.currentTarget);
  });
  store.subscribe(function (state, previous) {
    if (state.activeProjectSlug !== previous.activeProjectSlug || state.connected !== previous.connected) flushPendingNavigation();
    if (state.currentSlug !== previous.currentSlug && panel && !panel.classList.contains('hidden')) requestDebates();
  });
}
