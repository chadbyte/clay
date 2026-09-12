// Two-pane iframe shell for the split-view spike.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { iconHtml, refreshIcons } from './icons.js';
import { detachTuiView } from './session-tui-view.js';
import { formatTokens } from './app-panels.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';
import { groupedSessionIds, findSplitGroup, isConfiguredWorker } from './split-group-helpers.js';
import { showConfirm } from './app-misc.js';
import { syncPairChrome } from './split-pair-ui.js';
import { presentMarkdownEdit } from './filebrowser.js';
import { autoStartLoginIfNeeded } from './vendor-login.js';

var host = null;
var nativeApp = null;
var mainPanelsEl = null;
var dropOverlay = null;
var ghostTitleEl = null;
var draggedSessionId = null;
var stickyNotesContainer = null;
var stickyNotesHome = null;
var stickyNotesAnchor = null;
function placeStickyNotesOverlay(splitActive) {
  if (!stickyNotesContainer || !stickyNotesHome || !mainPanelsEl) return;
  if (splitActive) {
    // Notes are project-wide, so split view owns one canvas above both panes.
    // Pane-mode CSS suppresses the duplicate canvas inside each iframe.
    mainPanelsEl.appendChild(stickyNotesContainer);
    return;
  }
  if (stickyNotesAnchor && stickyNotesAnchor.parentNode === stickyNotesHome) {
    stickyNotesHome.insertBefore(stickyNotesContainer, stickyNotesAnchor);
  } else {
    stickyNotesHome.appendChild(stickyNotesContainer);
  }
}

function sessionById(sessionId) {
  var sessions = getCachedSessions() || [];
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].id === sessionId) return sessions[i];
  }
  return null;
}

function paneForSession(sessionId) {
  var session = sessionById(sessionId);
  return {
    slug: store.get('currentSlug'),
    sessionId: sessionId,
    title: (session && session.title) || ("Session " + sessionId),
  };
}

function paneUrl(pane) {
  return "/p/" + encodeURIComponent(pane.slug) + "/?pane=1&session=" + encodeURIComponent(pane.sessionId);
}

// Arc-style drop preview: hovering one half folds the live app into the
// other half and shows a ghost pane where the dragged session will land.
function setPreviewSide(side) {
  if (!mainPanelsEl) return;
  mainPanelsEl.classList.toggle("split-preview-left", side === "left");
  mainPanelsEl.classList.toggle("split-preview-right", side === "right");
}

function hideDropOverlay() {
  if (dropOverlay) dropOverlay.classList.remove("visible");
  setPreviewSide(null);
  if (mainPanelsEl) mainPanelsEl.classList.remove("split-drag-active");
  draggedSessionId = null;
}

function showDropOverlay() {
  if (!dropOverlay || store.get('splitPanes')) return;
  var grouped = groupedSessionIds(store.get('splitGroups'));
  if (grouped.has(store.get('activeSessionId'))) return;
  if (ghostTitleEl) {
    var session = sessionById(draggedSessionId);
    ghostTitleEl.textContent = (session && session.title) || ("Session " + draggedSessionId);
  }
  if (mainPanelsEl) mainPanelsEl.classList.add("split-drag-active");
  dropOverlay.classList.add("visible");
}

function switchNativeSession(sessionId) {
  store.set({ splitPanes: null });
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "switch_session", id: sessionId }));
  }
}

function closePane(index) {
  var split = store.get('splitPanes');
  if (!split || !split.panes || split.panes.length !== 2) return;
  if (split.groupId && getWs() && getWs().readyState === 1) {
    getWs().send(JSON.stringify({ type: "split_group_dissolve", id: split.groupId }));
  }
  switchNativeSession(split.panes[index === 0 ? 1 : 0].sessionId);
}

function startPaneRename(header, titleEl, pane) {
  if (header.querySelector(".split-pane-rename-input")) return;
  var input = document.createElement("input");
  input.type = "text";
  input.className = "split-pane-rename-input";
  input.value = pane.title;
  titleEl.style.display = "none";
  header.insertBefore(input, titleEl);
  input.focus();
  input.select();

  var done = false;
  function finish(commit) {
    if (done) return;
    done = true;
    var newTitle = input.value.trim();
    input.remove();
    titleEl.style.display = "";
    if (!commit || !newTitle || newTitle === pane.title) return;
    pane.title = newTitle;
    titleEl.textContent = newTitle;
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "rename_session", id: pane.sessionId, title: newTitle }));
    }
  }

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") { event.preventDefault(); finish(true); }
    if (event.key === "Escape") { event.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", function () { finish(true); });
  input.addEventListener("click", function (event) { event.stopPropagation(); });
}

// Called on session_list so pane headers follow renames made elsewhere
// (sidebar, in-pane app). Panes being renamed inline are left alone.
export function syncPaneTitles() {
  var split = store.get('splitPanes');
  if (!split || !split.panes || !host) return;
  var titleEls = host.querySelectorAll(".split-pane-title");
  for (var i = 0; i < split.panes.length && i < titleEls.length; i++) {
    var session = sessionById(split.panes[i].sessionId);
    if (!session || !session.title) continue;
    split.panes[i].title = session.title;
    if (titleEls[i].style.display !== "none") titleEls[i].textContent = session.title;
  }
  var accessBtns = host.querySelectorAll(".split-pane-full-access");
  for (var ai = 0; ai < split.panes.length && ai < accessBtns.length; ai++) {
    updatePaneFullAccessButton(accessBtns[ai], sessionById(split.panes[ai].sessionId));
  }
  syncPairChrome(host, split);
}

function updatePaneFullAccessButton(button, session) {
  if (!button) return;
  var mode = session && (session.runtimeMode || session.mode || "gui");
  var worker = !!session && isConfiguredWorker(store.get('splitGroups'), session.id);
  // Permission policy belongs to the Driver. A configured Worker inherits it
  // server-side and must not present a second, misleading control.
  var visible = !!session && !worker && !store.get('skipPermsEnabled') && mode === "gui";
  var enabled = visible && session.permissionMode === "bypassPermissions";
  button.classList.toggle("hidden", !visible);
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-checked", enabled ? "true" : "false");
  button.title = enabled ? "Skip Permissions is on — click to restore permission prompts" : "Skip Permissions is off — permission prompts are on";
}

function setPaneFullAccess(sessionId, enabled) {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "set_session_full_access", id: sessionId, enabled: enabled }));
  }
}

function createPane(pane, index) {
  var paneEl = document.createElement("section");
  paneEl.className = "split-pane";

  var header = document.createElement("header");
  header.className = "split-pane-header";

  var session = sessionById(pane.sessionId);
  var vendor = (session && session.vendor) || "claude";
  var vendorIcon = document.createElement("img");
  vendorIcon.className = "split-pane-vendor";
  vendorIcon.src = VENDOR_AVATARS[vendor] || VENDOR_AVATARS.claude;
  vendorIcon.alt = "";
  vendorIcon.title = VENDOR_NAMES[vendor] || vendor;
  header.appendChild(vendorIcon);

  var title = document.createElement("span");
  title.className = "split-pane-title";
  title.textContent = pane.title;
  title.title = "Rename session";
  title.addEventListener("click", function () { startPaneRename(header, title, pane); });
  header.appendChild(title);

  var frame = document.createElement("iframe");
  frame.className = "split-pane-frame";
  frame.src = paneUrl(pane);
  frame.title = pane.title;

  // Context-usage chip, fed by clay-pane-context messages from the pane
  // iframe. Hidden until the pane reports a non-zero context percentage.
  var ctxChip = document.createElement("button");
  ctxChip.type = "button";
  ctxChip.className = "split-pane-context";
  ctxChip.title = "Context usage";
  ctxChip.innerHTML = '<span class="split-pane-context-bar"><span class="split-pane-context-fill"></span></span><span class="split-pane-context-label"></span>';
  ctxChip.addEventListener("click", function () {
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "clay-pane-toggle-context" }, window.location.origin);
    }
  });
  header.appendChild(ctxChip);

  var fullAccess = document.createElement("button");
  fullAccess.type = "button";
  fullAccess.className = "session-full-access split-pane-full-access hidden";
  fullAccess.setAttribute("role", "switch");
  fullAccess.innerHTML = '<span class="session-full-access-label">Skip Permissions</span><span class="session-full-access-track" aria-hidden="true"><span></span></span>';
  updatePaneFullAccessButton(fullAccess, session);
  fullAccess.addEventListener("click", function () {
    var current = sessionById(pane.sessionId);
    if (current && current.permissionMode === "bypassPermissions") {
      setPaneFullAccess(pane.sessionId, false);
      return;
    }
    showConfirm("Skip permission prompts for this session? Tool requests will be approved automatically.", function () {
      setPaneFullAccess(pane.sessionId, true);
    }, "Skip Permissions", true);
  });
  header.appendChild(fullAccess);
  // Permission state belongs to the session identity on the left. Keep it
  // immediately after the title instead of grouping it with usage and close.
  header.insertBefore(fullAccess, ctxChip);

  var close = document.createElement("button");
  close.type = "button";
  close.className = "split-pane-close";
  close.title = "Close pane";
  close.setAttribute("aria-label", "Close pane");
  close.innerHTML = iconHtml("x");
  close.addEventListener("click", function () { closePane(index); });
  header.appendChild(close);
  paneEl.appendChild(header);
  paneEl.appendChild(frame);
  return paneEl;
}

function updatePaneContextChip(paneEl, msg) {
  if (!paneEl) return;
  var chip = paneEl.querySelector(".split-pane-context");
  if (!chip) return;
  var pct = msg.pct || 0;
  if (pct <= 0) return;
  chip.classList.add("has-data");
  var fill = chip.querySelector(".split-pane-context-fill");
  var label = chip.querySelector(".split-pane-context-label");
  fill.style.width = Math.min(100, pct).toFixed(1) + "%";
  fill.className = "split-pane-context-fill" + (msg.cls || "");
  label.textContent = pct.toFixed(0) + "%";
  var tip = "Context " + pct.toFixed(0) + "% (" + formatTokens(msg.used || 0) + " / " + formatTokens(msg.win || 0) + " tokens)";
  if (msg.cost) tip += " · $" + msg.cost.toFixed(4);
  if (msg.model && msg.model !== "-") tip += " · " + msg.model;
  chip.title = tip;
}

function handlePaneMessage(event) {
  if (event.origin !== window.location.origin) return;
  var msg = event.data;
  if (!msg || !host) return;
  if (msg.type === "clay-pane-present-markdown") {
    var present = msg.message;
    if (present) presentMarkdownEdit(present);
    return;
  }
  // Both panes can report auth_required for their own sessions. The shell runs
  // one login flow for the project; repeat events are no-ops there.
  if (msg.type === "clay-pane-auth-required") {
    if (msg.message) autoStartLoginIfNeeded(msg.message);
    return;
  }
  if (msg.type !== "clay-pane-context") return;
  var frames = host.querySelectorAll(".split-pane-frame");
  for (var i = 0; i < frames.length; i++) {
    if (frames[i].contentWindow === event.source) {
      updatePaneContextChip(frames[i].closest(".split-pane"), msg);
      return;
    }
  }
}

var renderedPaneKey = null;

function paneKey(panes) {
  return panes.map(function (pane) { return pane.slug + "#" + pane.sessionId; }).join("|");
}

function renderSplit(split) {
  if (!host || !nativeApp) return;
  var panes = split && split.panes;
  if (!panes || panes.length !== 2) {
    placeStickyNotesOverlay(false);
    host.innerHTML = "";
    renderedPaneKey = null;
    host.classList.remove("visible");
    nativeApp.classList.remove("split-native-hidden");
    return;
  }
  // splitPanes is replaced (same panes, new object) when the server confirms
  // the groupId. Rebuilding then would reload both iframes, so skip DOM work
  // when the rendered pane set is unchanged.
  var key = paneKey(panes);
  placeStickyNotesOverlay(true);
  if (key === renderedPaneKey && host.classList.contains("visible")) return;
  host.innerHTML = "";
  renderedPaneKey = key;
  nativeApp.classList.add("split-native-hidden");
  host.classList.add("visible");
  for (var i = 0; i < panes.length; i++) host.appendChild(createPane(panes[i], i));
  syncPairChrome(host, split);
  refreshIcons();
}

function openSplit(side, draggedId) {
  var currentId = store.get('activeSessionId');
  var grouped = groupedSessionIds(store.get('splitGroups'));
  if (!currentId || !draggedId || currentId === draggedId || store.get('splitPanes')) {
    hideDropOverlay();
    return;
  }
  if (grouped.has(currentId) || grouped.has(draggedId)) {
    hideDropOverlay();
    return;
  }
  var current = paneForSession(currentId);
  var dragged = paneForSession(draggedId);
  var panes = side === "left" ? [dragged, current] : [current, dragged];
  hideDropOverlay();
  // The TUI host is position:fixed on document.body, so hiding #app does not
  // hide it. Detach before showing panes; exiting the split re-attaches via
  // the switch_session -> session_switched path.
  detachTuiView();
  store.set({ splitPanes: { groupId: null, panes: panes } });
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "split_group_create", members: [panes[0].sessionId, panes[1].sessionId] }));
  }
}

export function openGroup(group) {
  if (!group || !Array.isArray(group.members) || group.members.length !== 2) return false;
  if (!sessionById(group.members[0]) || !sessionById(group.members[1])) return false;
  detachTuiView();
  store.set({
    splitPanes: {
      groupId: group.id,
      panes: [paneForSession(group.members[0]), paneForSession(group.members[1])],
    },
  });
  // Anchor the parent's active session (and server-side presence) to a
  // member while the split is open, so a hard refresh restores into this
  // group instead of whatever was viewed before it.
  var activeId = store.get('activeSessionId');
  if (activeId !== group.members[0] && activeId !== group.members[1]) {
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "switch_session", id: group.members[0] }));
    }
  }
  dismissSplitOverlays();
  return true;
}

// Reload survival: when the restored active session turns out to be a split
// group member, reopen that group. Safe to call often -- no-ops unless a
// group member is active natively with no split open.
export function maybeRestoreSplitGroup() {
  if (store.get('paneMode') || store.get('splitPanes')) return;
  var activeId = store.get('activeSessionId');
  if (!activeId) return;
  var groups = store.get('splitGroups') || [];
  for (var i = 0; i < groups.length; i++) {
    var members = groups[i].members || [];
    if (members.indexOf(activeId) !== -1) {
      openGroup(groups[i]);
      return;
    }
  }
}

export function separateGroup(group) {
  if (!group || !Array.isArray(group.members) || group.members.length !== 2) return;
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "split_group_dissolve", id: group.id }));
  }
  var split = store.get('splitPanes');
  if (split && split.groupId === group.id) switchNativeSession(group.members[0]);
}

function dismissSplitOverlays() {
  hideDropOverlay();
}

function overlaySide(event) {
  var rect = dropOverlay.getBoundingClientRect();
  return (event.clientX - rect.left) < rect.width / 2 ? "left" : "right";
}

function createDropOverlay(mainPanels) {
  var overlay = document.createElement("div");
  overlay.className = "split-drop-overlay";

  var ghost = document.createElement("div");
  ghost.className = "split-drop-ghost";
  ghostTitleEl = document.createElement("span");
  ghostTitleEl.className = "split-drop-ghost-title";
  ghost.appendChild(ghostTitleEl);
  overlay.appendChild(ghost);

  overlay.addEventListener("dragover", function (event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setPreviewSide(overlaySide(event));
  });
  overlay.addEventListener("dragleave", function (event) {
    if (!event.relatedTarget || !overlay.contains(event.relatedTarget)) setPreviewSide(null);
  });
  overlay.addEventListener("drop", function (event) {
    event.preventDefault();
    event.stopPropagation();
    var side = overlaySide(event);
    var droppedId = draggedSessionId || parseInt(event.dataTransfer.getData("text/plain"), 10);
    openSplit(side, droppedId);
  });
  mainPanels.appendChild(overlay);
  return overlay;
}

function handleSessionDragStart(event) {
  if (store.get('splitPanes')) return;
  var item = event.target.closest("[data-session-id][draggable='true']");
  if (!item) return;
  draggedSessionId = parseInt(item.dataset.sessionId, 10);
  if (groupedSessionIds(store.get('splitGroups')).has(draggedSessionId)) {
    draggedSessionId = null;
    return;
  }
  if (draggedSessionId) showDropOverlay();
}

function handleSidebarSessionClick(event) {
  if (!store.get('splitPanes') || event.button !== 0) return;
  if (event.target.closest(".session-close-btn, .session-more-btn")) return;
  var item = event.target.closest(".session-item[data-session-id], .session-loop-child[data-session-id]");
  if (!item) return;
  var sessionId = parseInt(item.dataset.sessionId, 10);
  if (!sessionId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  switchNativeSession(sessionId);
}

export function initSplitView() {
  if (store.get('paneMode')) return;
  var mainPanels = document.getElementById("main-panels");
  nativeApp = document.getElementById("app");
  if (!mainPanels || !nativeApp) return;
  mainPanelsEl = mainPanels;
  stickyNotesContainer = document.getElementById("sticky-notes-container");
  if (stickyNotesContainer) {
    stickyNotesHome = stickyNotesContainer.parentNode;
    stickyNotesAnchor = stickyNotesContainer.nextSibling;
  }

  host = document.createElement("div");
  host.id = "split-host";
  mainPanels.insertBefore(host, nativeApp.nextSibling);
  dropOverlay = createDropOverlay(mainPanels);

  window.addEventListener("message", handlePaneMessage);
  document.addEventListener("dragstart", handleSessionDragStart);
  document.addEventListener("dragend", hideDropOverlay);
  document.addEventListener("drop", function (event) {
    if (dropOverlay && !dropOverlay.contains(event.target)) hideDropOverlay();
  });
  document.addEventListener("click", handleSidebarSessionClick, true);
  store.subscribe(function (state, prev) {
    if (state.splitPanes !== prev.splitPanes) renderSplit(state.splitPanes);
    // Switching to a session outside the open split (new_session, palette,
    // notification click) closes the split UI; the group itself persists.
    if (state.activeSessionId !== prev.activeSessionId && state.splitPanes && state.splitPanes.panes) {
      var sp = state.splitPanes.panes;
      if (state.activeSessionId !== sp[0].sessionId && state.activeSessionId !== sp[1].sessionId) {
        store.set({ splitPanes: null });
      }
    }
    if (state.splitGroups !== prev.splitGroups) {
      var split = state.splitPanes;
      if (!split || !split.panes) return;
      syncPairChrome(host, split);
      if (split.groupId) {
        var stillExists = state.splitGroups.some(function (group) { return group.id === split.groupId; });
        if (!stillExists) switchNativeSession(split.panes[0].sessionId);
        return;
      }
      var ids = [split.panes[0].sessionId, split.panes[1].sessionId];
      var confirmed = findSplitGroup(state.splitGroups, ids);
      if (confirmed) store.set({ splitPanes: { groupId: confirmed.id, panes: split.panes } });
    }
  });
  renderSplit(store.get('splitPanes'));
}
