// sidebar-sessions.js - Session list, search, presence, countdown, CLI picker
// Extracted from sidebar.js (PR-35)

import { avatarUrl, userAvatarUrl } from './avatar.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { openSearch as openSessionSearch } from './session-search.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getSessionListEl } from './dom-refs.js';
import { dismissOverlayPanels, closeSidebar, updatePageTitle, spawnDustParticles } from './sidebar.js';
import { showConfirm } from './app-misc.js';
import { getUpcomingSchedules } from './scheduler.js';
import { refreshMobileChatSheet } from './sidebar-mobile.js';
import { VENDOR_AVATARS, VENDOR_NAMES, VENDOR_ORDER, VENDOR_HOMEPAGES, isExperimentalVendor } from './app-rendering.js';
import { openGroup, separateGroup } from './split-view.js';
import { groupedSessionIds } from './split-group-helpers.js';
import { openPairDialog } from './split-pair-ui.js';
import {
  hierarchyItemMatches,
  prepareSidebarHierarchy,
  renderDesktopDriverHierarchy,
  renderDesktopOrphanHierarchy
} from './sidebar-session-hierarchy.js';


// --- Session state ---
var cachedSessions = [];
var searchQuery = "";
var searchMatchIds = null; // null = no search, Set of matched session IDs
var searchDebounce = null;
var expandedLoopGroups = new Set();
var expandedLoopRuns = new Set();

// --- Session presence (multi-user: who is viewing which session) ---
var sessionPresence = {}; // { sessionId: [{ id, displayName, avatarStyle, avatarSeed }] }

// --- Countdown timer for upcoming schedules ---
var countdownTimer = null;
var countdownContainer = null;

// --- Session context menu ---
var sessionCtxMenu = null;
var sessionCtxSessionId = null;
var draggedSessionId = null;
var draggedSessionBookmarked = false;
var headerSearchOpen = false;
var armedDeleteSessionId = null;
var armedDeleteTimer = null;

function sendSessionBookmark(sessionId, bookmarked) {
  if (getWs() && store.get('connected')) {
    getWs().send(JSON.stringify({ type: "set_session_bookmark", sessionId: sessionId, bookmarked: !!bookmarked }));
  }
}

function compareSessionListItems(a, b) {
  var aData = a && (a.type === "session" || a.type === "driver-hierarchy") ? a.data : a;
  var bData = b && (b.type === "session" || b.type === "driver-hierarchy") ? b.data : b;
  var aBookmarked = !!(aData && aData.bookmarked);
  var bBookmarked = !!(bData && bData.bookmarked);
  if (aBookmarked !== bBookmarked) return aBookmarked ? -1 : 1;
  if (aBookmarked && bBookmarked) {
    var ao = aData && typeof aData.favoriteOrder === "number" ? aData.favoriteOrder : Number.MAX_SAFE_INTEGER;
    var bo = bData && typeof bData.favoriteOrder === "number" ? bData.favoriteOrder : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
  }
  return (b.lastActivity || 0) - (a.lastActivity || 0);
}

function clearSessionDragIndicators() {
  var listEl = getSessionListEl();
  if (!listEl) return;
  var active = listEl.querySelectorAll(".session-favorites-divider.drag-hover, .session-regular-drop.drag-hover, .session-item.dragging");
  for (var i = 0; i < active.length; i++) {
    active[i].classList.remove("drag-hover", "dragging");
  }
}

function setupSessionDragHandlers(el, session) {
  el.setAttribute("draggable", "true");

  el.addEventListener("dragstart", function (e) {
    draggedSessionId = session.id;
    draggedSessionBookmarked = !!session.bookmarked;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(session.id));

    var ghost = document.createElement("div");
    ghost.textContent = session.title || "New Session";
    ghost.style.cssText = "position:fixed;left:-200px;top:-200px;max-width:220px;padding:8px 12px;border-radius:10px;" +
      "background:var(--sidebar-active);color:var(--text);font-size:13px;font-weight:600;pointer-events:none;z-index:-1;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 18, 18);
    setTimeout(function () { ghost.remove(); }, 0);

    setTimeout(function () { el.classList.add("dragging"); }, 0);
  });

  el.addEventListener("dragend", function () {
    clearSessionDragIndicators();
    draggedSessionId = null;
    draggedSessionBookmarked = false;
  });

  if (session.bookmarked) {
    el.addEventListener("dragover", function (e) {
      if (!draggedSessionId || draggedSessionId === session.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var rect = el.getBoundingClientRect();
      var insertBefore = e.clientY < rect.top + rect.height / 2;
      el.classList.remove("drag-over-above", "drag-over-below");
      el.classList.add(insertBefore ? "drag-over-above" : "drag-over-below");
    });

    el.addEventListener("dragleave", function () {
      el.classList.remove("drag-over-above", "drag-over-below");
    });

    el.addEventListener("drop", function (e) {
      if (!draggedSessionId || draggedSessionId === session.id) return;
      e.preventDefault();
      var rect = el.getBoundingClientRect();
      var insertBefore = e.clientY < rect.top + rect.height / 2;
      el.classList.remove("drag-over-above", "drag-over-below");
      if (draggedSessionBookmarked) {
        if (getWs() && store.get('connected')) {
          getWs().send(JSON.stringify({
            type: "reorder_session_bookmarks",
            sourceId: draggedSessionId,
            targetId: session.id,
            insertBefore: insertBefore,
          }));
        }
      } else {
        sendSessionBookmark(draggedSessionId, true);
      }
    });
  }
}

function setupBookmarkDropTarget(el, bookmarked) {
  el.addEventListener("dragover", function (e) {
    if (!draggedSessionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drag-hover");
  });

  el.addEventListener("dragleave", function () {
    el.classList.remove("drag-hover");
  });

  el.addEventListener("drop", function (e) {
    if (!draggedSessionId) return;
    e.preventDefault();
    el.classList.remove("drag-hover");
    if (draggedSessionBookmarked !== !!bookmarked) {
      sendSessionBookmark(draggedSessionId, !!bookmarked);
    }
    clearSessionDragIndicators();
    draggedSessionId = null;
    draggedSessionBookmarked = false;
  });
}

function spawnSessionDeleteParticles(sessionId) {
  if (!spawnDustParticles) return;
  setTimeout(function () {
    var el = getSessionListEl().querySelector('[data-session-id="' + sessionId + '"]');
    if (!el) return;
    var rect = el.getBoundingClientRect();
    spawnDustParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, 0);
}

function confirmDeleteSession(session) {
  showConfirm('Delete "' + (session.title || "New Session") + '"? This session and its history will be permanently removed.', function () {
    var ws = getWs();
    if (ws && store.get('connected')) {
      ws.send(JSON.stringify({ type: "delete_session", id: session.id }));
      spawnSessionDeleteParticles(session.id);
    }
  });
}

function clearArmedSessionDelete() {
  if (armedDeleteTimer) {
    clearTimeout(armedDeleteTimer);
    armedDeleteTimer = null;
  }
  if (armedDeleteSessionId !== null) {
    var prevBtn = getSessionListEl() ? getSessionListEl().querySelector('.session-close-btn[data-session-id="' + armedDeleteSessionId + '"]') : null;
    if (prevBtn) {
      prevBtn.classList.remove("armed");
      prevBtn.innerHTML = iconHtml("x");
      prevBtn.title = "Delete session";
      prevBtn.setAttribute("aria-label", "Delete session");
      refreshIcons();
    }
  }
  armedDeleteSessionId = null;
}

function armSessionDelete(closeBtn, session) {
  clearArmedSessionDelete();
  armedDeleteSessionId = session.id;
  closeBtn.classList.add("armed");
  closeBtn.innerHTML = iconHtml("check");
  closeBtn.title = "Click again to delete";
  closeBtn.setAttribute("aria-label", "Click again to delete");
  refreshIcons();
  armedDeleteTimer = setTimeout(function () {
    clearArmedSessionDelete();
  }, 1800);
}

function deleteSessionImmediately(session) {
  var ws = getWs();
  if (ws && store.get('connected')) {
    ws.send(JSON.stringify({ type: "delete_session", id: session.id }));
    spawnSessionDeleteParticles(session.id);
  }
}

function collectItemSessionIds(item) {
  if (!item) return [];
  if (item.type === "session" && item.data && typeof item.data.id === "number") {
    if (!isSessionVisibleBySearch(item.data.id)) return [];
    return [item.data.id];
  }
  if (item.type === "loop" && Array.isArray(item.children)) {
    var ids = [];
    for (var i = 0; i < item.children.length; i++) {
      if (typeof item.children[i].id === "number" && isSessionVisibleBySearch(item.children[i].id)) {
        ids.push(item.children[i].id);
      }
    }
    return ids;
  }
  if (item.type === "split-group" && Array.isArray(item.members)) {
    return item.members.map(function (session) { return session.id; });
  }
  if (item.type === "driver-hierarchy" && item.root) {
    var hierarchyIds = [item.root.driver.id];
    for (var j = 0; j < item.root.workers.length; j++) hierarchyIds.push(item.root.workers[j].id);
    return hierarchyIds;
  }
  if (item.type === "orphan-workers" && Array.isArray(item.workers)) {
    return item.workers.map(function (session) { return session.id; });
  }
  return [];
}

function confirmDeleteSessionGroup(groupLabel, sessionIds) {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) return;
  var count = sessionIds.length;
  var noun = count === 1 ? "session" : "sessions";
  showConfirm('Clear "' + groupLabel + '"? ' + count + " " + noun + ' will be permanently removed.', function () {
    var ws = getWs();
    if (ws && store.get('connected')) {
      ws.send(JSON.stringify({ type: "bulk_delete_sessions", sessionIds: sessionIds }));
    }
  });
}

function createSessionGroupHeader(group, sessionIds) {
  var header = document.createElement("div");
  header.className = "session-group-header";

  var label = document.createElement("span");
  label.className = "session-group-header-label";
  label.textContent = group;
  header.appendChild(label);

  if ((!store.get('permissions') || store.get('permissions').sessionDelete !== false) && Array.isArray(sessionIds) && sessionIds.length > 0) {
    var clearBtn = document.createElement("button");
    clearBtn.className = "session-group-clear-btn";
    clearBtn.type = "button";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      confirmDeleteSessionGroup(group, sessionIds);
    });
    header.appendChild(clearBtn);
  }

  return header;
}

function appendSessionCloseButton(el, session) {
  if (store.get('permissions') && store.get('permissions').sessionDelete === false) return;

  var closeBtn = document.createElement("button");
  closeBtn.className = "session-close-btn";
  closeBtn.dataset.sessionId = session.id;
  closeBtn.type = "button";
  closeBtn.title = "Delete session";
  closeBtn.setAttribute("aria-label", "Delete session");
  closeBtn.innerHTML = iconHtml("x");
  closeBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (armedDeleteSessionId === session.id) {
      clearArmedSessionDelete();
      deleteSessionImmediately(session);
      return;
    }
    armSessionDelete(closeBtn, session);
  });
  el.appendChild(closeBtn);
}

// Resolve the vendor the "New session" button should launch from the stable
// installed-vendor priority (Claude, then Codex, then the remaining vendors).
export function resolveDefaultVendor() {
  var installed = store.get('installedVendors') || [];
  for (var i = 0; i < VENDOR_ORDER.length; i++) {
    if (installed.indexOf(VENDOR_ORDER[i]) !== -1) return VENDOR_ORDER[i];
  }
  return "claude";
}

// Single entry point for session creation from the sidebar. Optimistically
// bind the composer to the requested vendor before the server round-trip.
// Otherwise vendorSelectionLocked from the previous session can reject the
// new config_state and leave a Kiro/Codex session rendered as Claude.
export function startNewSession(vendor, extra) {
  if (!getWs() || !store.get('connected')) return;
  var payload = { type: "new_session", vendor: vendor };
  if (extra) {
    var keys = Object.keys(extra);
    for (var i = 0; i < keys.length; i++) payload[keys[i]] = extra[keys[i]];
  }
  getWs().send(JSON.stringify(payload));
  store.set({
    lastVendor: vendor,
    currentVendor: vendor,
    currentModel: "",
    currentModels: [],
    vendorSelectionLocked: true,
    sessionVendorBound: true,
  });
}

function renderSessionTopActions() {
  var wrap = document.createElement("div");
  wrap.className = "session-top-actions";

  // Single split button. The main half creates a session with the project's
  // last-used vendor (for Claude the server applies the claudeOpenMode pref);
  // the chevron opens the vendor picker plus alternate launch modes.
  var defaultVendor = resolveDefaultVendor();

  var cell = document.createElement("div");
  cell.className = "session-top-action-split";

  var mainBtn = document.createElement("button");
  mainBtn.className = "session-top-action split-main";
  mainBtn.type = "button";
  mainBtn.title = "New " + (VENDOR_NAMES[defaultVendor] || defaultVendor) + " session";
  mainBtn.innerHTML = '<img src="' + (VENDOR_AVATARS[defaultVendor] || VENDOR_AVATARS.claude) +
    '" class="session-top-action-icon" alt=""><span>New session</span>';
  mainBtn.addEventListener("click", function () {
    startNewSession(defaultVendor);
  });
  cell.appendChild(mainBtn);

  var chevron = document.createElement("button");
  chevron.className = "session-top-action split-chevron";
  chevron.type = "button";
  chevron.title = "Choose a vendor or launch mode";
  chevron.setAttribute("aria-label", "Choose a vendor or launch mode");
  chevron.innerHTML = iconHtml("chevron-down");
  chevron.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (sessionCtxMenu) { closeSessionCtxMenu(); return; }
    showNewSessionMenu(chevron, defaultVendor);
  });
  cell.appendChild(chevron);

  wrap.appendChild(cell);
  return wrap;
}

// Dropdown anchored to the split-button chevron. Reuses the session-ctx-menu
// element/var so the global document click handler closes it.
function showNewSessionMenu(anchorBtn, defaultVendor) {
  closeSessionCtxMenu();

  var menu = document.createElement("div");
  menu.className = "session-ctx-menu session-new-menu";
  var installed = store.get('installedVendors') || [];

  // Every known vendor is listed. Uninstalled ones stay visible but disabled,
  // and clicking one opens the vendor's homepage so the user can install it.
  for (var i = 0; i < VENDOR_ORDER.length; i++) {
    (function (vendor) {
      var isInstalled = installed.indexOf(vendor) !== -1;
      var name = VENDOR_NAMES[vendor] || vendor;
      var item = document.createElement("button");
      item.className = "session-ctx-item session-new-vendor";
      if (!isInstalled) item.classList.add("disabled");
      if (vendor === defaultVendor) item.classList.add("active");
      item.type = "button";
      item.innerHTML = '<img src="' + VENDOR_AVATARS[vendor] + '" class="session-top-action-icon" alt="">' +
        '<span class="session-new-vendor-name">' + name + '</span>' +
        (isExperimentalVendor(vendor) ? '<span class="vendor-experimental-badge" aria-label="Experimental integration" title="Experimental integration; not yet validated through direct use testing">🧪</span>' : '') +
        (isInstalled ? "" : '<span class="session-new-vendor-note">Not installed</span>' + iconHtml("external-link"));
      item.title = isInstalled
        ? "New " + name + " session"
        : name + " is not installed - open " + VENDOR_HOMEPAGES[vendor];
      if (isExperimentalVendor(vendor)) item.title += " · Experimental integration; not yet validated through direct use testing";
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        closeSessionCtxMenu();
        if (!isInstalled) {
          window.open(VENDOR_HOMEPAGES[vendor], "_blank", "noopener");
          return;
        }
        startNewSession(vendor);
      });
      menu.appendChild(item);
    })(VENDOR_ORDER[i]);
  }

  if (installed.length > 0) {
    var pairSep = document.createElement("div");
    pairSep.className = "session-ctx-sep";
    menu.appendChild(pairSep);
    var pairItem = document.createElement("button");
    pairItem.className = "session-ctx-item";
    pairItem.type = "button";
    pairItem.innerHTML = iconHtml("panel-left-close") + " <span>Pair session…</span>";
    pairItem.title = "Create a Driver and Worker in a split view";
    pairItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSessionCtxMenu();
      openPairDialog();
    });
    menu.appendChild(pairItem);
  }

  // Claude-only launch mode: a bare TUI shell with permission prompts off.
  // Hidden in GUI mode (the default) because the item only ever produces a
  // terminal session, which contradicts what the rest of the menu creates.
  if (installed.indexOf("claude") !== -1 && store.get('claudeOpenMode') === "tui") {
    var sep = document.createElement("div");
    sep.className = "session-ctx-sep";
    menu.appendChild(sep);

    var skipItem = document.createElement("button");
    skipItem.className = "session-ctx-item";
    skipItem.type = "button";
    skipItem.innerHTML = iconHtml("shield-off") + " <span>Skip Permissions (TUI)</span>";
    skipItem.title = "Start a terminal session with --dangerously-skip-permissions";
    skipItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSessionCtxMenu();
      startNewSession("claude", { mode: "tui", dangerouslySkipPermissions: true });
    });
    menu.appendChild(skipItem);
  }

  document.body.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var btnRect = anchorBtn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (btnRect.bottom + 2) + "px";
    menu.style.left = btnRect.left + "px";
    menu.style.right = "auto";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = "auto";
      menu.style.right = (window.innerWidth - btnRect.right) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (btnRect.top - menuRect.height - 2) + "px";
    }
  });
}

function runSessionSearch(query) {
  var normalizedQuery = query || "";
  var trimmedQuery = normalizedQuery.trim();
  searchQuery = normalizedQuery;
  if (searchDebounce) {
    clearTimeout(searchDebounce);
    searchDebounce = null;
  }
  if (!trimmedQuery) {
    searchMatchIds = null;
    renderSessionList(null);
    return;
  }
  searchDebounce = setTimeout(function () {
    if (getWs() && store.get('connected')) {
      getWs().send(JSON.stringify({ type: "search_sessions", query: searchQuery }));
    }
  }, 200);
}

function syncHeaderSearchUi() {
  var searchInline = document.getElementById("session-header-search-inline");
  var searchInput = document.getElementById("session-header-search-input");
  var searchClear = document.getElementById("session-header-search-clear");
  var searchBtn = document.getElementById("session-header-search-btn");
  var filterCount = document.getElementById("session-filter-count");
  var isOpen = headerSearchOpen || !!searchQuery;
  if (!searchInline || !searchInput || !searchClear || !searchBtn || !filterCount) return;
  searchInline.classList.toggle("hidden", !isOpen);
  searchBtn.classList.toggle("active", isOpen);
  if (searchInput.value !== searchQuery) {
    searchInput.value = searchQuery;
  }
  searchClear.classList.toggle("hidden", !searchQuery);
  if (!searchQuery || searchMatchIds === null) {
    filterCount.classList.add("hidden");
    filterCount.textContent = "";
  } else {
    filterCount.classList.remove("hidden");
    filterCount.textContent = String(searchMatchIds.size);
  }
}

function openHeaderSearch() {
  headerSearchOpen = true;
  syncHeaderSearchUi();
  var searchInput = document.getElementById("session-header-search-input");
  if (searchInput) {
    requestAnimationFrame(function () {
      searchInput.focus();
      searchInput.select();
    });
  }
}

function closeHeaderSearch() {
  headerSearchOpen = false;
  syncHeaderSearchUi();
}

function clearSessionSearch(shouldBlur, input, shouldClose) {
  if (searchDebounce) {
    clearTimeout(searchDebounce);
    searchDebounce = null;
  }
  searchQuery = "";
  searchMatchIds = null;
  if (shouldClose) {
    headerSearchOpen = false;
  }
  syncHeaderSearchUi();
  renderSessionList(null);
  if (shouldBlur && input) {
    input.blur();
  }
}

export function initSidebarSessions() {

  document.addEventListener("click", function () {
    closeSessionCtxMenu();
    clearArmedSessionDelete();
  });

  var searchBtn = document.getElementById("session-header-search-btn");
  var searchInput = document.getElementById("session-header-search-input");
  var searchClear = document.getElementById("session-header-search-clear");
  var searchInline = document.getElementById("session-header-search-inline");

  if (searchBtn && searchInput && searchClear && searchInline) {
    searchBtn.addEventListener("click", function () {
      if (!headerSearchOpen && !searchQuery) {
        openHeaderSearch();
        return;
      }
      if (!searchQuery) {
        closeHeaderSearch();
        return;
      }
      searchInput.focus();
      searchInput.select();
    });

    searchInput.addEventListener("input", function () {
      runSessionSearch(searchInput.value);
      syncHeaderSearchUi();
    });

    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (searchInput.value.trim()) {
          clearSessionSearch(false, searchInput, false);
          return;
        }
        clearSessionSearch(true, searchInput, true);
      }
    });

    searchInput.addEventListener("blur", function () {
      setTimeout(function () {
        if (!searchQuery && document.activeElement !== searchBtn && document.activeElement !== searchClear) {
          closeHeaderSearch();
        }
      }, 0);
    });

    searchClear.addEventListener("click", function () {
      clearSessionSearch(false, searchInput, false);
      searchInput.focus();
    });

    syncHeaderSearchUi();
  }

  // The "New session" split button renders from lastVendor + installedVendors,
  // so a late-arriving vendor detection or a vendor switch has to repaint it.
  store.subscribe(function (state, prev) {
    if (state.lastVendor !== prev.lastVendor || state.installedVendors !== prev.installedVendors) {
      renderSessionList(null);
    }
    if (state.splitPanes !== prev.splitPanes) renderSessionList(null);
  });

  // --- Resume session picker ---
  // --- Schedule countdown timer ---
  startCountdownTimer();
}

// --- Getters for cross-module access ---

export function getCachedSessions() {
  return cachedSessions;
}

export function getSearchQuery() {
  return searchQuery;
}

export function getSearchMatchIds() {
  return searchMatchIds;
}

export function getExpandedLoopGroups() {
  return expandedLoopGroups;
}

export function getExpandedLoopRuns() {
  return expandedLoopRuns;
}

// --- Context menu ---

function closeSessionCtxMenu() {
  if (sessionCtxMenu) {
    sessionCtxMenu.remove();
    sessionCtxMenu = null;
    sessionCtxSessionId = null;
  }
}

function showSessionCtxMenu(anchorBtn, sessionId, title, cliSid, sessionData) {
  closeSessionCtxMenu();
  sessionCtxSessionId = sessionId;

  var menu = document.createElement("div");
  menu.className = "session-ctx-menu";

  var bookmarkItem = document.createElement("button");
  bookmarkItem.className = "session-ctx-item";
  bookmarkItem.innerHTML = iconHtml(sessionData && sessionData.bookmarked ? "arrow-down" : "arrow-up") + " <span>" + (sessionData && sessionData.bookmarked ? "Remove from Favorites" : "Add to Favorites") + "</span>";
  bookmarkItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    sendSessionBookmark(sessionId, !(sessionData && sessionData.bookmarked));
  });
  menu.appendChild(bookmarkItem);

  var renameItem = document.createElement("button");
  renameItem.className = "session-ctx-item";
  renameItem.innerHTML = iconHtml("pencil") + " <span>Rename</span>";
  renameItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    startInlineRename(sessionId, title);
  });
  menu.appendChild(renameItem);


  // Session visibility toggle (only the session owner can change)
  if (store.get('isMultiUserMode') && sessionData && sessionData.ownerId && sessionData.ownerId === store.get('myUserId')) {
    var currentVis = (sessionData && sessionData.sessionVisibility) || "private";
    var isPrivate = currentVis === "private";
    var visItem = document.createElement("button");
    visItem.className = "session-ctx-item";
    visItem.innerHTML = iconHtml(isPrivate ? "eye" : "eye-off") + " <span>" + (isPrivate ? "Make Shared" : "Make Private") + "</span>";
    visItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSessionCtxMenu();
      var newVis = isPrivate ? "shared" : "private";
      if (getWs() && store.get('connected')) {
        getWs().send(JSON.stringify({ type: "set_session_visibility", sessionId: sessionId, visibility: newVis }));
      }
    });
    menu.appendChild(visItem);
  }

  if (!store.get('permissions') || store.get('permissions').sessionDelete !== false) {
    var deleteItem = document.createElement("button");
    deleteItem.className = "session-ctx-item session-ctx-delete";
    deleteItem.innerHTML = iconHtml("trash-2") + " <span>Delete</span>";
    deleteItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSessionCtxMenu();
      confirmDeleteSession({ id: sessionId, title: title });
    });
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  // Position: fixed relative to the anchor button
  requestAnimationFrame(function () {
    var btnRect = anchorBtn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (btnRect.bottom + 2) + "px";
    menu.style.right = (window.innerWidth - btnRect.right) + "px";
    menu.style.left = "auto";
    // If menu overflows below viewport, flip up
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (btnRect.top - menuRect.height - 2) + "px";
    }
  });
}

function showSplitGroupCtxMenu(anchor, group) {
  closeSessionCtxMenu();
  var menu = document.createElement("div");
  menu.className = "session-ctx-menu";

  var renameItem = document.createElement("button");
  renameItem.className = "session-ctx-item";
  renameItem.innerHTML = iconHtml("pencil") + " <span>Rename</span>";
  renameItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    startSplitGroupInlineRename(group);
  });
  menu.appendChild(renameItem);

  var separateItem = document.createElement("button");
  separateItem.className = "session-ctx-item";
  separateItem.innerHTML = iconHtml("columns-2") + " <span>Separate</span>";
  separateItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    separateGroup(group);
  });
  menu.appendChild(separateItem);

  document.body.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();
  requestAnimationFrame(function () {
    var rect = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (rect.bottom + 2) + "px";
    menu.style.right = (window.innerWidth - rect.right) + "px";
    menu.style.left = "auto";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) menu.style.top = (rect.top - menuRect.height - 2) + "px";
  });
}

function showLoopCtxMenu(anchorBtn, loopId, loopName, childCount) {
  closeSessionCtxMenu();

  var menu = document.createElement("div");
  menu.className = "session-ctx-menu";

  var renameItem = document.createElement("button");
  renameItem.className = "session-ctx-item";
  renameItem.innerHTML = iconHtml("pencil") + " <span>Rename</span>";
  renameItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    startLoopInlineRename(loopId, loopName);
  });
  menu.appendChild(renameItem);

  if (!store.get('permissions') || store.get('permissions').sessionDelete !== false) {
    var deleteItem = document.createElement("button");
    deleteItem.className = "session-ctx-item session-ctx-delete";
    deleteItem.innerHTML = iconHtml("trash-2") + " <span>Delete</span>";
    deleteItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSessionCtxMenu();
      var msg = 'Delete "' + (loopName || "Loop") + '"';
      if (childCount > 1) msg += " and its " + childCount + " sessions";
      msg += "? This cannot be undone.";
      showConfirm(msg, function () {
        if (getWs() && store.get('connected')) {
          getWs().send(JSON.stringify({ type: "delete_loop_group", loopId: loopId }));
        }
      });
    });
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var btnRect = anchorBtn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (btnRect.bottom + 2) + "px";
    menu.style.right = (window.innerWidth - btnRect.right) + "px";
    menu.style.left = "auto";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (btnRect.top - menuRect.height - 2) + "px";
    }
  });
}

// --- Inline rename ---

function startInlineRename(sessionId, currentTitle) {
  var el = getSessionListEl().querySelector('.session-item[data-session-id="' + sessionId + '"]');
  if (!el) return;
  var textSpan = el.querySelector(".session-item-text");
  if (!textSpan) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = currentTitle || "New Session";

  var originalHtml = textSpan.innerHTML;
  textSpan.innerHTML = "";
  textSpan.appendChild(input);
  input.focus();
  input.select();

  function commitRename() {
    var newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle && getWs() && store.get('connected')) {
      getWs().send(JSON.stringify({ type: "rename_session", id: sessionId, title: newTitle }));
    }
    // Restore text (server will send updated session_list)
    textSpan.innerHTML = originalHtml;
    if (newTitle && newTitle !== currentTitle) {
      textSpan.textContent = newTitle;
    }
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); textSpan.innerHTML = originalHtml; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

function startSplitGroupInlineRename(group) {
  var el = getSessionListEl().querySelector('.split-group-item[data-split-group-id="' + group.id + '"]');
  if (!el) return;
  var textSpan = el.querySelector(".split-group-name");
  if (!textSpan) return;
  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = group.name || "Split";
  var original = textSpan.textContent;
  textSpan.innerHTML = "";
  textSpan.appendChild(input);
  input.focus();
  input.select();
  var finished = false;
  function finish(commit) {
    if (finished) return;
    finished = true;
    var name = input.value.trim();
    if (commit && name && name !== group.name && getWs() && store.get('connected')) {
      getWs().send(JSON.stringify({ type: "split_group_rename", id: group.id, name: name }));
      textSpan.textContent = name;
    } else {
      textSpan.textContent = original;
    }
  }
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", function () { finish(true); });
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

function startLoopInlineRename(loopId, currentName) {
  var el = getSessionListEl().querySelector('.session-loop-group[data-loop-id="' + loopId + '"]');
  if (!el) return;
  var textSpan = el.querySelector(".session-item-text");
  if (!textSpan) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = currentName || "Loop";

  var originalHtml = textSpan.innerHTML;
  textSpan.innerHTML = "";
  textSpan.appendChild(input);
  input.focus();
  input.select();

  function commitRename() {
    var newName = input.value.trim();
    if (newName && newName !== currentName && getWs() && store.get('connected')) {
      getWs().send(JSON.stringify({ type: "loop_registry_rename", id: loopId, name: newName }));
    }
    textSpan.innerHTML = originalHtml;
    if (newName && newName !== currentName) {
      // Update text inline immediately
      var nameNode = textSpan.querySelector(".session-loop-name");
      if (nameNode) nameNode.textContent = newName;
    }
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); textSpan.innerHTML = originalHtml; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

// --- Date grouping / highlighting ---

export function getDateGroup(ts) {
  var now = new Date();
  var d = new Date(ts);
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterday = new Date(today.getTime() - 86400000);
  var weekAgo = new Date(today.getTime() - 7 * 86400000);
  if (d >= today) return "Today";
  if (d >= yesterday) return "Yesterday";
  if (d >= weekAgo) return "This Week";
  return "Older";
}

export function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  var lower = text.toLowerCase();
  var qLower = query.toLowerCase();
  var idx = lower.indexOf(qLower);
  if (idx === -1) return escapeHtml(text);
  var before = text.substring(0, idx);
  var match = text.substring(idx, idx + query.length);
  var after = text.substring(idx + query.length);
  return escapeHtml(before) + '<mark class="session-highlight">' + escapeHtml(match) + '</mark>' + escapeHtml(after);
}

function isSessionVisibleBySearch(sessionId) {
  if (searchMatchIds === null) return true;
  return searchMatchIds.has(sessionId);
}

// --- Loop child / run / group rendering ---

function renderLoopChild(s) {
  var el = document.createElement("div");
  var isMatch = searchMatchIds !== null && searchMatchIds.has(s.id);
  el.className = "session-loop-child" + (s.active ? " active" : "") + (isMatch ? " search-match" : "");
  el.dataset.sessionId = s.id;

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (s.isProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  if (s.backgroundTaskCount) {
    textHtml += '<span class="session-background-task-count">' + s.backgroundTaskCount + '</span>';
  }
  if (s.loop) {
    var isRalphChild = s.loop.source === "ralph";
    var roleName = s.loop.role === "crafting" ? "Crafting" : s.loop.role === "judge" ? "Judge" : (isRalphChild ? "Coder" : "Run");
    var iterSuffix = s.loop.role === "crafting" ? "" : " #" + s.loop.iteration;
    var roleCls = s.loop.role === "crafting" ? " crafting" : (!isRalphChild ? " scheduled" : "");
    textHtml += '<span class="session-loop-role-badge' + roleCls + '">' + roleName + iterSuffix + '</span>';
  }
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);
  appendSessionCloseButton(el, s);

  el.addEventListener("click", (function (id) {
    return function () {
      if (getWs() && store.get('connected')) {
        getWs().send(JSON.stringify({ type: "switch_session", id: id }));
        dismissOverlayPanels();
        closeSidebar();
      }
    };
  })(s.id));

  return el;
}

function renderLoopGroup(loopId, children, groupKey) {
  var visibleChildren = children;
  if (searchMatchIds !== null) {
    visibleChildren = [];
    for (var vi = 0; vi < children.length; vi++) {
      if (isSessionVisibleBySearch(children[vi].id)) {
        visibleChildren.push(children[vi]);
      }
    }
    if (visibleChildren.length === 0) {
      return null;
    }
  }

  var gk = groupKey || loopId;

  // Sub-group children by startedAt (each run)
  var runMap = {};
  for (var i = 0; i < visibleChildren.length; i++) {
    var runKey = String(visibleChildren[i].loop && visibleChildren[i].loop.startedAt || 0);
    if (!runMap[runKey]) runMap[runKey] = [];
    runMap[runKey].push(visibleChildren[i]);
  }
  var runKeys = Object.keys(runMap);

  // Sort each run's children by iteration then role
  for (var ri = 0; ri < runKeys.length; ri++) {
    runMap[runKeys[ri]].sort(function (a, b) {
      var ai = (a.loop && a.loop.iteration) || 0;
      var bi = (b.loop && b.loop.iteration) || 0;
      if (ai !== bi) return ai - bi;
      var ar = (a.loop && a.loop.role === "judge") ? 1 : 0;
      var br = (b.loop && b.loop.role === "judge") ? 1 : 0;
      return ar - br;
    });
  }

  // Sort runs by startedAt descending (newest first)
  runKeys.sort(function (a, b) { return Number(b) - Number(a); });

  var expanded = expandedLoopGroups.has(gk);
  var hasActive = false;
  var anyProcessing = false;
  var latestSession = visibleChildren[0];
  for (var ci = 0; ci < visibleChildren.length; ci++) {
    if (visibleChildren[ci].active) hasActive = true;
    if (visibleChildren[ci].isProcessing) anyProcessing = true;
    if ((visibleChildren[ci].lastActivity || 0) > (latestSession.lastActivity || 0)) {
      latestSession = visibleChildren[ci];
    }
  }

  var loopName = (visibleChildren[0].loop && visibleChildren[0].loop.name) || "Loop";
  var isRalph = visibleChildren[0].loop && visibleChildren[0].loop.source === "ralph";
  var isDebate = visibleChildren[0].loop && visibleChildren[0].loop.source === "debate";
  var isCrafting = false;
  for (var j = 0; j < visibleChildren.length; j++) {
    if (visibleChildren[j].loop && visibleChildren[j].loop.role === "crafting") isCrafting = true;
  }

  var runCount = runKeys.length;

  var wrapper = document.createElement("div");
  wrapper.className = "session-loop-wrapper";

  // Group header row
  var el = document.createElement("div");
  var groupClass = "session-loop-group" + (hasActive ? " active" : "") + (expanded ? " expanded" : "");
  if (isDebate) groupClass += " debate";
  else if (!isRalph) groupClass += " scheduled";
  el.className = groupClass;
  el.dataset.loopId = loopId;

  var chevron = document.createElement("button");
  chevron.className = "session-loop-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  chevron.addEventListener("click", (function (lid) {
    return function (e) {
      e.stopPropagation();
      if (expandedLoopGroups.has(lid)) {
        expandedLoopGroups.delete(lid);
      } else {
        expandedLoopGroups.add(lid);
      }
      renderSessionList(null);
    };
  })(gk));
  el.appendChild(chevron);

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (anyProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  var groupBackgroundTaskCount = 0;
  for (var bi = 0; bi < children.length; bi++) groupBackgroundTaskCount += children[bi].backgroundTaskCount || 0;
  if (groupBackgroundTaskCount) textHtml += '<span class="session-background-task-count">' + groupBackgroundTaskCount + '</span>';
  var groupIcon = isDebate ? "mic" : (isRalph ? "repeat" : "calendar-clock");
  var iconClass = isDebate ? " debate" : (isRalph ? "" : " scheduled");
  textHtml += '<span class="session-loop-icon' + iconClass + '">' + iconHtml(groupIcon) + '</span>';
  textHtml += '<span class="session-loop-name">' + escapeHtml(loopName) + '</span>';
  if (isCrafting && children.length === 1) {
    textHtml += '<span class="session-loop-badge crafting">Crafting</span>';
  } else {
    var countLabel = runCount === 1 ? visibleChildren.length : runCount + (runCount === 1 ? " run" : " runs");
    var countClass = isDebate ? " debate" : (isRalph ? "" : " scheduled");
    textHtml += '<span class="session-loop-count' + countClass + '">' + countLabel + '</span>';
  }
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  // More button (ellipsis)
  var moreBtn = document.createElement("button");
  moreBtn.className = "session-more-btn";
  moreBtn.innerHTML = iconHtml("ellipsis");
  moreBtn.title = "More options";
  moreBtn.addEventListener("click", (function (lid, name, count, btn) {
    return function (e) {
      e.stopPropagation();
      showLoopCtxMenu(btn, lid, name, count);
    };
  })(loopId, loopName, visibleChildren.length, moreBtn));
  el.appendChild(moreBtn);

  // Click row (not chevron/more) -> switch to latest session
  el.addEventListener("click", (function (id) {
    return function () {
      if (getWs() && store.get('connected')) {
        getWs().send(JSON.stringify({ type: "switch_session", id: id }));
        dismissOverlayPanels();
        closeSidebar();
      }
    };
  })(latestSession.id));

  wrapper.appendChild(el);

  // Expanded: show runs as sub-groups
  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "session-loop-children";

    if (runCount === 1) {
      // Single run: show sessions directly (no extra nesting)
      var singleRun = runMap[runKeys[0]];
      for (var sk = 0; sk < singleRun.length; sk++) {
        childContainer.appendChild(renderLoopChild(singleRun[sk]));
      }
    } else {
      // Multiple runs: render each run as a collapsible sub-group
      for (var rk = 0; rk < runKeys.length; rk++) {
        childContainer.appendChild(renderLoopRun(gk, runKeys[rk], runMap[runKeys[rk]], isRalph));
      }
    }

    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

function renderLoopRun(parentGk, startedAtKey, sessions, isRalph) {
  var runGk = parentGk + ":" + startedAtKey;
  var expanded = expandedLoopRuns.has(runGk);
  var startedAt = Number(startedAtKey);
  var timeLabel = startedAt ? new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Unknown";

  var hasActive = false;
  var anyProcessing = false;
  var latestSession = sessions[0];
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].active) hasActive = true;
    if (sessions[i].isProcessing) anyProcessing = true;
    if ((sessions[i].lastActivity || 0) > (latestSession.lastActivity || 0)) {
      latestSession = sessions[i];
    }
  }

  var wrapper = document.createElement("div");
  wrapper.className = "session-loop-run-wrapper";

  var el = document.createElement("div");
  el.className = "session-loop-run" + (hasActive ? " active" : "") + (expanded ? " expanded" : "") + (isRalph ? "" : " scheduled");

  var chevron = document.createElement("button");
  chevron.className = "session-loop-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  chevron.addEventListener("click", (function (rk) {
    return function (e) {
      e.stopPropagation();
      if (expandedLoopRuns.has(rk)) {
        expandedLoopRuns.delete(rk);
      } else {
        expandedLoopRuns.add(rk);
      }
      renderSessionList(null);
    };
  })(runGk));
  el.appendChild(chevron);

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (anyProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  var runBackgroundTaskCount = 0;
  for (var bi = 0; bi < sessions.length; bi++) runBackgroundTaskCount += sessions[bi].backgroundTaskCount || 0;
  if (runBackgroundTaskCount) textHtml += '<span class="session-background-task-count">' + runBackgroundTaskCount + '</span>';
  textHtml += '<span class="session-loop-run-time">' + escapeHtml(timeLabel) + '</span>';
  textHtml += '<span class="session-loop-count' + (isRalph ? "" : " scheduled") + '">' + sessions.length + '</span>';
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  // Click row -> switch to latest session of this run
  el.addEventListener("click", (function (id) {
    return function () {
      if (getWs() && store.get('connected')) {
        getWs().send(JSON.stringify({ type: "switch_session", id: id }));
        dismissOverlayPanels();
        closeSidebar();
      }
    };
  })(latestSession.id));

  wrapper.appendChild(el);

  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "session-loop-children";
    for (var k = 0; k < sessions.length; k++) {
      childContainer.appendChild(renderLoopChild(sessions[k]));
    }
    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

// --- Session item rendering ---

function renderSessionItem(s, options) {
  var itemOptions = options || {};
  var el = document.createElement("div");
  var isMatch = searchMatchIds !== null && searchMatchIds.has(s.id);
  el.className = "session-item" + (s.active ? " active" : "") + (isMatch ? " search-match" : "");
  if (itemOptions.worker) el.classList.add("session-worker-item");
  el.dataset.sessionId = s.id;

  // Keep agent identity separate from the title so each row has a stable
  // visual anchor instead of mixing a tiny inline logo into the text.
  var itemVendor = s.vendor || "claude";
  var vendorIcon = document.createElement("img");
  vendorIcon.className = "session-vendor-icon session-vendor-mark";
  vendorIcon.src = VENDOR_AVATARS[itemVendor] || VENDOR_AVATARS.claude;
  vendorIcon.alt = "";
  vendorIcon.title = VENDOR_NAMES[itemVendor] || itemVendor;
  el.appendChild(vendorIcon);

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (s.isProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  if (s.backgroundTaskCount) {
    textHtml += '<span class="session-background-task-count">' + s.backgroundTaskCount + '</span>';
  }
  if (s.loop && s.loop.source === "debate") {
    textHtml += '<span class="session-debate-icon" title="Debate">' + iconHtml("mic") + '</span>';
  }
  if (store.get('isMultiUserMode') && s.sessionVisibility === "shared") {
    textHtml += '<span class="session-shared-icon" title="Shared session" aria-label="Shared session">' + iconHtml("users") + '</span>';
  }
  textHtml += highlightMatch(s.title || "New Session", searchQuery);
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  if (itemOptions.worker) {
    var workerLabel = document.createElement("span");
    workerLabel.className = "session-worker-generation" + (itemOptions.current ? " current" : "");
    workerLabel.textContent = itemOptions.current ? "Current" : (s.workerGeneration ? "Gen " + s.workerGeneration : "Worker");
    el.appendChild(workerLabel);
  }

  var ageText = relativeTime(s.lastActivity || 0);
  if (ageText) {
    var age = document.createElement("span");
    age.className = "session-item-age";
    age.textContent = ageText;
    el.appendChild(age);
  }

  // Right-click / long-press: context menu
  el.addEventListener("contextmenu", (function(id, title, cliSid, anchor, sData) {
    return function(e) {
      e.preventDefault();
      e.stopPropagation();
      showSessionCtxMenu(anchor, id, title, cliSid, sData);
    };
  })(s.id, s.title, s.cliSessionId, el, s));

  // Unread badge
  var unreadBadge = document.createElement("span");
  unreadBadge.className = "session-unread-badge";
  unreadBadge.dataset.sessionId = s.id;
  if (s.unread > 0) {
    unreadBadge.textContent = s.unread > 99 ? "99+" : String(s.unread);
    unreadBadge.classList.add("has-unread");
  }
  el.appendChild(unreadBadge);
  appendSessionCloseButton(el, s);

  el.addEventListener("click", (function (id) {
    return function () {
      if (getWs() && store.get('connected')) {
        var pendingQuery = searchQuery || "";
        getWs().send(JSON.stringify({ type: "switch_session", id: id }));
        dismissOverlayPanels();
        closeSidebar();
        if (pendingQuery) {
          setTimeout(function () { openSessionSearch(pendingQuery); }, 400);
        }
      }
    };
  })(s.id));

  // Presence avatars (multi-user)
  renderPresenceAvatars(el, String(s.id));
  if (!itemOptions.worker) setupSessionDragHandlers(el, s);

  return el;
}

function renderSplitGroupItem(group, members) {
  var el = document.createElement("div");
  var split = store.get('splitPanes');
  el.className = "session-item split-group-item" + (split && split.groupId === group.id ? " active" : "");
  el.dataset.splitGroupId = group.id;

  var text = document.createElement("span");
  text.className = "session-item-text split-group-text";
  var html = '<span class="split-group-glyph" aria-hidden="true">' + iconHtml("columns-2") + '</span><span class="split-group-vendors">';
  for (var i = 0; i < members.length; i++) {
    var vendor = members[i].vendor || "claude";
    html += '<img class="session-vendor-icon split-group-vendor" src="' +
      (VENDOR_AVATARS[vendor] || VENDOR_AVATARS.claude) + '" alt="" title="' +
      escapeHtml(VENDOR_NAMES[vendor] || vendor) + '">';
  }
  html += "</span>";
  if (members[0].isProcessing || members[1].isProcessing) html += '<span class="session-processing"></span>';
  var splitBackgroundTaskCount = (members[0].backgroundTaskCount || 0) + (members[1].backgroundTaskCount || 0);
  if (splitBackgroundTaskCount) html += '<span class="session-background-task-count">' + splitBackgroundTaskCount + '</span>';
  html += '<span class="split-group-name">' + highlightMatch(group.name || "Split", searchQuery) + "</span>";
  text.innerHTML = html;
  el.appendChild(text);

  var unread = (members[0].unread || 0) + (members[1].unread || 0);
  var badge = document.createElement("span");
  badge.className = "session-unread-badge" + (unread > 0 ? " has-unread" : "");
  badge.dataset.splitGroupId = group.id;
  if (unread > 0) badge.textContent = unread > 99 ? "99+" : String(unread);
  el.appendChild(badge);

  el.addEventListener("click", function () {
    if (openGroup(group)) {
      dismissOverlayPanels();
      closeSidebar();
    }
  });
  el.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    e.stopPropagation();
    showSplitGroupCtxMenu(el, group);
  });
  return el;
}

// --- Main session list ---

// Fingerprint of the last completed render: the whole session payload plus the
// two store values this render also reads. Nothing is cherry-picked, so the
// guard can only skip a frame that is byte-identical to what is already on
// screen. A re-render triggered by other state (sessions === null) always
// runs and resets the fingerprint afterwards.
var lastRenderFingerprint = null;

function sessionRenderFingerprint(sessions) {
  try {
    return JSON.stringify([sessions, store.get('splitGroups') || [], store.get('splitPanes') || null]);
  } catch (e) {
    return null;
  }
}

export function renderSessionList(sessions) {
  if (sessions) {
    // A reconnect and a streaming turn both re-send this list unchanged;
    // rebuilding the sidebar for an identical frame is what made it flicker.
    var incoming = sessionRenderFingerprint(sessions);
    if (incoming !== null && incoming === lastRenderFingerprint) return;
    cachedSessions = sessions;
  }

  // If mobile chat sheet is open, refresh it
  if (refreshMobileChatSheet) refreshMobileChatSheet();

  getSessionListEl().innerHTML = "";

  // Partition: loop sessions vs normal sessions
  // Group by loopId + date so all runs of the same task on the same day are merged
  var splitGroups = store.get('splitGroups') || [];
  var groupedIds = groupedSessionIds(splitGroups);
  var hierarchy = prepareSidebarHierarchy(cachedSessions);
  var hierarchyByDriver = hierarchy.byDriver;
  var hierarchySessionIds = hierarchy.sessionIds;
  hierarchySessionIds.forEach(function (id) { groupedIds.delete(id); });
  var sessionsById = new Map();
  for (var si = 0; si < cachedSessions.length; si++) sessionsById.set(cachedSessions[si].id, cachedSessions[si]);
  var loopGroups = {}; // groupKey -> [sessions]
  var normalSessions = [];
  for (var i = 0; i < cachedSessions.length; i++) {
    var s = cachedSessions[i];
    if (s.sessionRole === "worker") continue;
    if (groupedIds.has(s.id)) continue;
    if (s.loop && s.loop.loopId && s.loop.role === "crafting" && s.loop.source !== "ralph" && s.loop.source !== "debate") {
      // Task crafting sessions live in the scheduler calendar, not the main list (except debate)
      continue;
    } else if (s.loop && s.loop.loopId) {
      var startedAt = s.loop.startedAt || 0;
      var dateStr = startedAt ? new Date(startedAt).toISOString().slice(0, 10) : "unknown";
      var groupKey = s.loop.loopId + ":" + dateStr;
      if (!loopGroups[groupKey]) loopGroups[groupKey] = [];
      loopGroups[groupKey].push(s);
    } else {
      normalSessions.push(s);
    }
  }

  // Build virtual items: normal sessions + one entry per loop group (using latest child's lastActivity)
  var items = [];
  for (var j = 0; j < normalSessions.length; j++) {
    var driverRoot = hierarchyByDriver.get(normalSessions[j].id);
    if (driverRoot) items.push({ type: "driver-hierarchy", root: driverRoot, data: driverRoot.driver, lastActivity: driverRoot.lastActivity });
    else items.push({ type: "session", data: normalSessions[j], lastActivity: normalSessions[j].lastActivity || 0 });
  }
  if (hierarchy.orphans.length) {
    var orphanActivity = 0;
    for (var oi = 0; oi < hierarchy.orphans.length; oi++) orphanActivity = Math.max(orphanActivity, hierarchy.orphans[oi].lastActivity || 0);
    items.push({ type: "orphan-workers", workers: hierarchy.orphans, lastActivity: orphanActivity });
  }
  for (var sg = 0; sg < splitGroups.length; sg++) {
    var splitGroup = splitGroups[sg];
    var leftMember = sessionsById.get(splitGroup.members[0]);
    var rightMember = sessionsById.get(splitGroup.members[1]);
    if (!leftMember || !rightMember) continue;
    if (hierarchySessionIds.has(leftMember.id) || hierarchySessionIds.has(rightMember.id)) continue;
    items.push({
      type: "split-group",
      group: splitGroup,
      members: [leftMember, rightMember],
      lastActivity: Math.max(leftMember.lastActivity || 0, rightMember.lastActivity || 0),
    });
  }
  var groupKeys = Object.keys(loopGroups);
  for (var k = 0; k < groupKeys.length; k++) {
    var gk = groupKeys[k];
    var children = loopGroups[gk];
    var realLoopId = children[0].loop.loopId;
    var maxActivity = 0;
    for (var m = 0; m < children.length; m++) {
      var act = children[m].lastActivity || 0;
      if (act > maxActivity) maxActivity = act;
    }
    items.push({ type: "loop", loopId: realLoopId, groupKey: gk, children: children, lastActivity: maxActivity });
  }

  // Sort by lastActivity descending
  items.sort(compareSessionListItems);

  var bookmarkedItems = [];
  var regularItems = [];
  for (var n = 0; n < items.length; n++) {
    var item = items[n];
    if (item.type === "session" && item.data && !isSessionVisibleBySearch(item.data.id)) {
      continue;
    }
    if ((item.type === "driver-hierarchy" || item.type === "orphan-workers") && !hierarchyItemMatches(item, searchMatchIds)) continue;
    if (item.type === "split-group" && searchMatchIds !== null &&
        !searchMatchIds.has(item.members[0].id) && !searchMatchIds.has(item.members[1].id)) continue;
    if ((item.type === "session" || item.type === "driver-hierarchy") && item.data && item.data.bookmarked) {
      bookmarkedItems.push(item);
    } else {
      regularItems.push(item);
    }
  }

  var favoritesContainer = document.createElement("div");
  favoritesContainer.className = "session-favorites-section";
  setupBookmarkDropTarget(favoritesContainer, true);
  if (bookmarkedItems.length === 0) {
    var emptyHint = document.createElement("div");
    emptyHint.className = "session-favorites-empty";
    emptyHint.textContent = "Drag and drop sessions here to add favorites.";
    favoritesContainer.appendChild(emptyHint);
  }
  for (var bi = 0; bi < bookmarkedItems.length; bi++) {
    if (bookmarkedItems[bi].type === "driver-hierarchy") favoritesContainer.appendChild(renderDesktopDriverHierarchy(bookmarkedItems[bi].root, renderSessionItem, function () { renderSessionList(null); }, searchMatchIds));
    else favoritesContainer.appendChild(renderSessionItem(bookmarkedItems[bi].data));
  }

  var divider = document.createElement("div");
  divider.className = "session-favorites-divider";

  var regularContainer = document.createElement("div");
  regularContainer.className = "session-regular-drop";
  setupBookmarkDropTarget(regularContainer, false);
  var stickyTop = document.createElement("div");
  stickyTop.className = "session-list-sticky-top";
  stickyTop.appendChild(favoritesContainer);
  stickyTop.appendChild(divider);
  stickyTop.appendChild(renderSessionTopActions());
  getSessionListEl().appendChild(stickyTop);

  var currentGroup = "";
  var currentGroupIds = [];
  for (var ri = 0; ri < regularItems.length; ri++) {
    var item = regularItems[ri];
    var group = getDateGroup(item.lastActivity || 0);
    if (group !== currentGroup) {
      currentGroup = group;
      currentGroupIds = [];
      for (var gi = ri; gi < regularItems.length; gi++) {
        if (getDateGroup(regularItems[gi].lastActivity || 0) !== group) break;
        var groupIds = collectItemSessionIds(regularItems[gi]);
        for (var gj = 0; gj < groupIds.length; gj++) currentGroupIds.push(groupIds[gj]);
      }
      if (group !== "Today") {
        regularContainer.appendChild(createSessionGroupHeader(group, currentGroupIds));
      }
    }
    if (item.type === "loop") {
      var loopEl = renderLoopGroup(item.loopId, item.children, item.groupKey);
      if (loopEl) {
        regularContainer.appendChild(loopEl);
      }
    } else if (item.type === "split-group") {
      regularContainer.appendChild(renderSplitGroupItem(item.group, item.members));
    } else if (item.type === "driver-hierarchy") {
      regularContainer.appendChild(renderDesktopDriverHierarchy(item.root, renderSessionItem, function () { renderSessionList(null); }, searchMatchIds));
    } else if (item.type === "orphan-workers") {
      regularContainer.appendChild(renderDesktopOrphanHierarchy(item.workers, renderSessionItem, function () { renderSessionList(null); }, searchMatchIds));
    } else {
      regularContainer.appendChild(renderSessionItem(item.data));
    }
  }
  getSessionListEl().appendChild(regularContainer);
  refreshIcons();
  if (updatePageTitle) updatePageTitle();
  syncHeaderSearchUi();
  // Recorded from the sessions actually rendered, so a null-argument re-render
  // driven by other state refreshes the fingerprint rather than stranding it.
  lastRenderFingerprint = sessionRenderFingerprint(cachedSessions);
}

// --- Search results ---

export function handleSearchResults(msg) {
  if (msg.query !== searchQuery) return; // stale response
  var ids = new Set();
  for (var i = 0; i < msg.results.length; i++) {
    ids.add(msg.results[i].id);
  }
  searchMatchIds = ids;
  renderSessionList(null);
}

// --- Session presence ---

export function updateSessionPresence(presence) {
  sessionPresence = presence;
  // Update presence avatars on existing session items without full re-render
  var items = getSessionListEl().querySelectorAll("[data-session-id]");
  for (var i = 0; i < items.length; i++) {
    renderPresenceAvatars(items[i], items[i].dataset.sessionId);
  }
}

function presenceAvatarUrl(userOrStyle, seed) {
  if (userOrStyle && typeof userOrStyle === "object") return userAvatarUrl(userOrStyle, 24);
  return avatarUrl(userOrStyle || "imprint", seed, 24);
}

function renderPresenceAvatars(el, sessionId) {
  // Remove existing presence container
  var existing = el.querySelector(".session-presence");
  if (existing) existing.remove();

  var users = sessionPresence[sessionId];
  if (!users || users.length === 0) return;

  var container = document.createElement("span");
  container.className = "session-presence";

  var max = 3;
  var shown = users.length > max ? max : users.length;
  for (var i = 0; i < shown; i++) {
    var u = users[i];
    var img = document.createElement("img");
    img.className = "session-presence-avatar";
    img.src = presenceAvatarUrl(u);
    img.alt = u.displayName;
    img.dataset.tip = u.displayName + (u.username ? " (@" + u.username + ")" : "");
    if (i > 0) img.style.marginLeft = "-6px";
    container.appendChild(img);
  }
  if (users.length > max) {
    var more = document.createElement("span");
    more.className = "session-presence-more";
    more.textContent = "+" + (users.length - max);
    container.appendChild(more);
  }

  // Insert before the more-btn
  var moreBtn = el.querySelector(".session-more-btn");
  if (moreBtn) {
    el.insertBefore(container, moreBtn);
  } else {
    el.appendChild(container);
  }
}

// --- Session badge ---

export function updateSessionBadge(sessionId, count) {
  for (var i = 0; i < cachedSessions.length; i++) {
    if (cachedSessions[i].id === sessionId) cachedSessions[i].unread = count;
  }
  var badge = document.querySelector('.session-unread-badge[data-session-id="' + sessionId + '"]');
  var groups = store.get('splitGroups') || [];
  for (var gi = 0; gi < groups.length; gi++) {
    if (groups[gi].members.indexOf(sessionId) === -1) continue;
    badge = document.querySelector('.session-unread-badge[data-split-group-id="' + groups[gi].id + '"]');
    count = 0;
    for (var mi = 0; mi < cachedSessions.length; mi++) {
      if (groups[gi].members.indexOf(cachedSessions[mi].id) !== -1) count += cachedSessions[mi].unread || 0;
    }
    break;
  }
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}

// --- Countdown timer ---

function startCountdownTimer() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updateCountdowns, 1000);
}

function updateCountdowns() {
  if (!getSessionListEl()) return;
  var upcoming = getUpcomingSchedules(3 * 60 * 1000); // 3 minutes

  // Remove stale container
  if (countdownContainer && !getSessionListEl().contains(countdownContainer)) {
    countdownContainer = null;
  }

  if (upcoming.length === 0) {
    if (countdownContainer) {
      countdownContainer.remove();
      countdownContainer = null;
    }
    return;
  }

  if (!countdownContainer) {
    countdownContainer = document.createElement("div");
    countdownContainer.className = "session-countdown-group";
    var stickyTop = getSessionListEl().querySelector(".session-list-sticky-top");
    if (stickyTop && stickyTop.nextSibling) {
      getSessionListEl().insertBefore(countdownContainer, stickyTop.nextSibling);
    } else if (stickyTop) {
      getSessionListEl().appendChild(countdownContainer);
    } else {
      getSessionListEl().insertBefore(countdownContainer, getSessionListEl().firstChild);
    }
  }

  var html = "";
  var now = Date.now();
  for (var i = 0; i < upcoming.length; i++) {
    var u = upcoming[i];
    var remaining = Math.max(0, Math.ceil((u.nextRunAt - now) / 1000));
    var min = Math.floor(remaining / 60);
    var sec = remaining % 60;
    var timeStr = min + ":" + (sec < 10 ? "0" : "") + sec;
    var colorStyle = u.color ? " style=\"border-left-color:" + u.color + "\"" : "";
    html += '<div class="session-countdown-item"' + colorStyle + '>';
    html += '<span class="session-countdown-name">' + escapeHtml(u.name) + '</span>';
    html += '<span class="session-countdown-badge">' + timeStr + '</span>';
    html += '</div>';
  }
  countdownContainer.innerHTML = html;
}

// --- CLI session picker ---

function relativeTime(isoString) {
  if (!isoString) return "";
  var ms = Date.now() - new Date(isoString).getTime();
  var sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  var min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  var days = Math.floor(hr / 24);
  if (days < 30) return days + "d ago";
  return new Date(isoString).toLocaleDateString();
}
