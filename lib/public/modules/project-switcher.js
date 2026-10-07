// project-switcher.js — macOS Cmd+Tab-style quick switcher.
//
// Two modes share the same overlay:
//   Cmd/Ctrl+E  → projects only (non-Mate), activates via switchProject
//   Cmd/Ctrl+M  → Mates only, activates in the home conversation pane
//
// While the modifier is still held, repeating the same shortcut cycles
// forward and Shift cycles back. Releasing the modifier commits —
// matching Cmd+Tab semantics. Enter commits explicitly; Escape cancels.
//
// Each mode has its own in-memory MRU list so the ordering stays
// mode-specific (visiting projects shouldn't reorder the mate list,
// and vice versa). No persistence — MRU is a transient hint and
// project rule forbids localStorage for preferences.

import { store } from './store.js';
import { refreshIcons } from './icons.js';
import { getCachedProjects, switchProject } from './app-projects.js';
import { showHomeHub, isHomeHubVisible } from './app-home-hub.js';
import { openHomeChat } from './home-mate-chat.js';
import { mateAvatarUrl } from './avatar.js';
import { parseEmojis } from './markdown.js';
import { isExternalWorktree, externalWorktreeTooltip, appendExternalWorktreeBadge } from './worktree-location.js';

var _projectMru = [];   // project slugs, most recent first
var _mateMru = [];      // mate ids (mate_XXX), most recent first
var _overlay = null;
var _list = null;
var _headerEl = null;
var _open = false;
var _mode = 'project';  // 'project' | 'mate'
var _highlightedIndex = 0;
var _entries = [];

export function openSwitcherForMode(mode) {
  if (mode !== 'project' && mode !== 'mate') return;
  if (mode === 'mate' && !isHomeHubVisible()) return;
  if (_open) closeSwitcher(false);
  openSwitcher(mode);
}

export function initProjectSwitcher() {
  buildOverlayIfMissing();
  _list = _overlay.querySelector('.cmd-palette-results');
  _headerEl = _overlay.querySelector('.project-switcher-header');

  // Seed MRUs from current state.
  var seedSlug = store.get('currentSlug');
  if (seedSlug) _projectMru = [seedSlug];
  var seedTarget = store.get('dmTargetUser');
  if (seedTarget && seedTarget.isMate && seedTarget.id) _mateMru = [seedTarget.id];

  // Track MRUs by watching the store for navigation changes.
  store.subscribe(function (state, prev) {
    if (state.currentSlug && state.currentSlug !== prev.currentSlug) {
      bumpMru(_projectMru, state.currentSlug);
      _projectMru = _projectMru; // (keep reference; bumpMru mutates via reassignment)
    }
    var curMate = mateIdFrom(state.dmTargetUser);
    var prevMate = mateIdFrom(prev.dmTargetUser);
    if (curMate && curMate !== prevMate) bumpMru(_mateMru, curMate);
  });

  var backdrop = _overlay.querySelector('.cmd-palette-backdrop');
  if (backdrop) backdrop.addEventListener('click', function () { closeSwitcher(false); });

  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('keyup', handleKeyUp, true);
  window.addEventListener('blur', function () { if (_open) closeSwitcher(false); });

  // Wire hotkey hint pills next to the icon strip so the keybinding is
  // discoverable in the same surface users use for clicking. Clicking
  // the pill is equivalent to pressing the shortcut itself.
  var isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
  var projectHintLabel = isMac ? '\u2318E' : 'Ctrl+E';
  var mateHintLabel    = isMac ? '\u2318M' : 'Ctrl+M';
  var projectHint = document.getElementById('icon-strip-hint-project');
  var mateHint    = document.getElementById('icon-strip-hint-mate');
  if (projectHint) {
    projectHint.textContent = projectHintLabel;
    projectHint.title = 'Switch project (' + projectHintLabel + ')';
    projectHint.addEventListener('click', function () { openSwitcherForMode('project'); });
  }
  if (mateHint) {
    mateHint.textContent = mateHintLabel;
    mateHint.title = 'Switch mate (' + mateHintLabel + ')';
    mateHint.addEventListener('click', function () { openSwitcherForMode('mate'); });
  }

  // Mate hint visibility piggybacks on cachedMatesList: show the pill
  // whenever the mate list has any entries, hide otherwise. The users
  // strip inside the same wrapper also hides itself (sidebar-mates.js
  // toggles that), and the wrapper shrinks to nothing when both are
  // hidden — no extra visibility bookkeeping needed on the wrapper.
  function refreshMateHintVisibility() {
    if (!mateHint) return;
    var mates = store.get('cachedMatesList') || [];
    mateHint.classList.toggle('hidden', mates.length === 0);
  }
  refreshMateHintVisibility();
  store.subscribe(function (state, prev) {
    if (state.cachedMatesList !== prev.cachedMatesList || state.projectMateDmsEnabled !== prev.projectMateDmsEnabled) refreshMateHintVisibility();
  });
}

function buildOverlayIfMissing() {
  _overlay = document.getElementById('project-switcher');
  if (_overlay) return;
  var isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
  var modKbd = isMac ? '<kbd>\u2318</kbd>' : '<kbd>Ctrl</kbd>';
  _overlay = document.createElement('div');
  _overlay.id = 'project-switcher';
  _overlay.className = 'cmd-palette hidden project-switcher';
  _overlay.innerHTML =
    '<div class="cmd-palette-backdrop"></div>' +
    '<div class="cmd-palette-dialog project-switcher-dialog">' +
      '<div class="project-switcher-header">Switch project</div>' +
      '<div class="cmd-palette-results"></div>' +
      '<div class="cmd-palette-footer project-switcher-footer">' +
        '<span class="project-switcher-shortcuts">' + modKbd + '<kbd class="proj-next-key">E</kbd> next \u00b7 <kbd>\u21E7</kbd>' + modKbd + '<kbd class="proj-prev-key">E</kbd> prev \u00b7 <kbd>\u23CE</kbd> select \u00b7 <kbd>Esc</kbd> cancel</span>' +
      '</div>' +
    '</div>';
  document.body.appendChild(_overlay);
}

function mateIdFrom(target) {
  return target && target.isMate && target.id ? target.id : null;
}

function bumpMru(list, key) {
  // Mutate the original array to preserve the module-level reference
  // so subscribers / future reads see the update without a reassign.
  var idx = list.indexOf(key);
  if (idx !== -1) list.splice(idx, 1);
  list.unshift(key);
}

function handleKeyDown(e) {
  if (!e.key) return;
  var isMod = (e.metaKey || e.ctrlKey) && !e.altKey;
  var k = e.key.toLowerCase();

  // Mode shortcuts: Cmd/Ctrl+E (projects) and Cmd/Ctrl+M (mates).
  // Pressing the other shortcut while open switches mode; pressing the
  // same shortcut cycles.
  if (isMod && (k === 'e' || k === 'm')) {
    var requestedMode = k === 'e' ? 'project' : 'mate';
    if (requestedMode === 'mate' && !isHomeHubVisible()) return;
    e.preventDefault();
    e.stopPropagation();
    if (!_open) {
      openSwitcher(requestedMode);
    } else if (_mode !== requestedMode) {
      // Switched modes mid-flight. Rebuild the list for the new mode.
      openSwitcher(requestedMode);
    } else if (e.shiftKey) {
      cycle(-1);
    } else {
      cycle(1);
    }
    return;
  }

  if (!_open) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSwitcher(false);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    closeSwitcher(true);
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); cycle(1); return; }
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); cycle(-1); return; }
}

function handleKeyUp(e) {
  if (!_open) return;
  if (e.key === 'Meta' || e.key === 'Control') {
    closeSwitcher(true);
  }
}

function openSwitcher(mode) {
  _mode = mode;
  _entries = buildEntries(mode);
  if (_entries.length === 0) {
    // Nothing to switch to; don't show an empty modal.
    if (_open) closeSwitcher(false);
    return;
  }
  if (_headerEl) {
    _headerEl.textContent = mode === 'mate' ? 'Switch mate' : 'Switch project';
  }
  updateFooterShortcut(mode);
  renderEntries();
  _highlightedIndex = pickInitialIndex();
  paintHighlight();
  _overlay.classList.remove('hidden');
  _open = true;
  refreshIcons();
  // UI chrome matches the rest of Clay by swapping native emoji into
  // Twemoji <img>s (same pattern as title bar, icon strip, project
  // settings). The global COLR font fallback alone isn't reliable for
  // UI surfaces because OS emoji fonts tend to match first.
  parseEmojis(_list);
}

function updateFooterShortcut(mode) {
  var nextKey = _overlay.querySelector('.proj-next-key');
  var prevKey = _overlay.querySelector('.proj-prev-key');
  var letter = mode === 'mate' ? 'M' : 'E';
  if (nextKey) nextKey.textContent = letter;
  if (prevKey) prevKey.textContent = letter;
}

function pickInitialIndex() {
  // Highlight the "previous" selectable entry (Cmd+Tab semantics),
  // while keeping the list in a stable natural order. Uses MRU to
  // find which project/mate was visited before the current one, then
  // locates its position in _entries.
  if (_entries.length === 0) return 0;
  var mru = _mode === 'mate' ? _mateMru : _projectMru;
  var currentKey = currentActiveKey();
  for (var m = 0; m < mru.length; m++) {
    var key = mru[m];
    if (key === currentKey) continue;
    for (var i = 0; i < _entries.length; i++) {
      if (_entries[i].key === key && !_entries[i].disabled) return i;
    }
  }
  // Fallback: first non-current, non-disabled entry.
  for (var j = 0; j < _entries.length; j++) {
    if (!_entries[j].disabled && _entries[j].key !== currentKey) return j;
  }
  for (var d = 0; d < _entries.length; d++) {
    if (!_entries[d].disabled) return d;
  }
  return 0;
}

function currentActiveKey() {
  if (_mode === 'mate') {
    return mateIdFrom(store.get('dmTargetUser'));
  }
  return store.get('currentSlug');
}

function buildEntries(mode) {
  if (mode === 'mate') return buildMateEntries();
  return buildProjectEntries();
}

function buildProjectEntries() {
  var projects = (getCachedProjects() || []).filter(function (p) { return !p.isMate; });
  // Keep natural (server-provided) order so the list looks the same
  // every time the switcher opens. MRU only drives initial highlight.
  return projects.map(function (p) {
    var external = isExternalWorktree(p);
    return {
      key: p.slug,
      title: p.title || p.project || p.slug,
      icon: p.icon || null,
      fallbackIcon: 'folder',
      isCurrent: p.slug === store.get('currentSlug'),
      external: external,
      disabled: false,
      disabledReason: null,
    };
  });
}

function buildMateEntries() {
  var mates = store.get('cachedMatesList') || [];
  var currentMateId = mateIdFrom(store.get('dmTargetUser'));
  // Natural list order; MRU is only for choosing the initial highlight.
  return mates.map(function (m) {
    return {
      key: m.id,
      title: m.displayName || m.name || m.id,
      icon: null,
      avatarUrl: mateAvatarUrl(m, 88),
      fallbackIcon: 'user',
      isCurrent: m.id === currentMateId,
      disabled: false,
      disabledReason: null,
    };
  });
}

function closeSwitcher(commit) {
  if (!_open) return;
  _open = false;
  _overlay.classList.add('hidden');
  if (!commit) return;
  var entry = _entries[_highlightedIndex];
  if (!entry || entry.disabled) return;
  if (_mode === 'mate') {
    if (entry.key !== currentActiveKey()) {
      showHomeHub();
      openHomeChat(entry.key);
    }
  } else {
    if (entry.key !== store.get('currentSlug')) switchProject(entry.key);
  }
}

function cycle(delta) {
  if (_entries.length === 0) return;
  // Skip over disabled entries so unreachable worktrees aren't part
  // of the cycle. If every entry is disabled (shouldn't happen, since
  // openSwitcher bails on empty lists), fall back to plain stepping.
  var step = delta > 0 ? 1 : -1;
  var idx = _highlightedIndex;
  for (var i = 0; i < _entries.length; i++) {
    idx = (idx + step + _entries.length) % _entries.length;
    if (!_entries[idx].disabled) {
      _highlightedIndex = idx;
      paintHighlight();
      return;
    }
  }
}

function renderEntries() {
  if (!_list) return;
  _list.innerHTML = '';
  for (var i = 0; i < _entries.length; i++) {
    _list.appendChild(buildEntryNode(_entries[i], i));
  }
}

function buildEntryNode(entry, index) {
  var item = document.createElement('button');
  item.type = 'button';
  item.className = 'cmd-palette-item project-switcher-item';
  if (entry.disabled) item.classList.add('disabled');
  if (entry.disabled && entry.disabledReason) item.title = entry.disabledReason;
  if (entry.external) item.title = externalWorktreeTooltip(entry.title);
  item.dataset.index = String(index);

  var iconWrap = document.createElement('div');
  iconWrap.className = 'cmd-palette-item-icon';
  if (entry.icon) {
    iconWrap.textContent = entry.icon;
  } else if (entry.avatarUrl) {
    var img = document.createElement('img');
    img.src = entry.avatarUrl;
    img.alt = '';
    img.className = 'project-switcher-avatar';
    iconWrap.appendChild(img);
  } else {
    var fallback = document.createElement('i');
    fallback.setAttribute('data-lucide', entry.fallbackIcon || 'folder');
    iconWrap.appendChild(fallback);
  }
  if (entry.external) appendExternalWorktreeBadge(iconWrap, 'project-switcher-external-badge');
  item.appendChild(iconWrap);

  var body = document.createElement('div');
  body.className = 'cmd-palette-item-body';
  var titleRow = document.createElement('div');
  titleRow.className = 'cmd-palette-item-title-row';
  var title = document.createElement('span');
  title.className = 'cmd-palette-item-title';
  title.textContent = entry.title;
  titleRow.appendChild(title);
  if (entry.isCurrent) {
    var badge = document.createElement('span');
    badge.className = 'project-switcher-current';
    badge.textContent = 'current';
    titleRow.appendChild(badge);
  }
  if (entry.disabled && entry.disabledReason) {
    var reason = document.createElement('span');
    reason.className = 'project-switcher-disabled-reason';
    reason.textContent = entry.disabledReason;
    titleRow.appendChild(reason);
  }
  body.appendChild(titleRow);
  item.appendChild(body);

  item.addEventListener('mouseenter', function () {
    if (entry.disabled) return;
    _highlightedIndex = index;
    paintHighlight();
  });
  item.addEventListener('click', function () {
    if (entry.disabled) return;
    _highlightedIndex = index;
    closeSwitcher(true);
  });
  return item;
}

function paintHighlight() {
  if (!_list) return;
  var items = _list.querySelectorAll('.cmd-palette-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('active', i === _highlightedIndex);
  }
  var active = items[_highlightedIndex];
  if (active && active.scrollIntoView) {
    active.scrollIntoView({ block: 'nearest' });
  }
}
