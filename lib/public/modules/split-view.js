// Two-pane iframe shell for the split-view spike.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { refreshIcons } from './icons.js';
import { detachTuiView } from './session-tui-view.js';
import { groupedSessionIds, findSplitGroup, isConfiguredWorker, splitGroupRoles, splitGroupMemberIds, splitGroupActiveAnchor, splitWorkerCloseRequest } from './split-group-helpers.js';
import { syncPairChrome } from './split-pair-ui.js';
import { presentMarkdownEdit } from './filebrowser.js';
import { autoStartLoginIfNeeded } from './vendor-login.js';
import { isCurrentProjectSessionReady } from './split-session-boundary.js';
import { splitPanesMatchProject, reconcileRestoredSplit } from './project-activation.js';
import { handlePaneIssueMessage } from './pane-issue-bridge.js';
import { handlePaneFileMessage, revealFilesPanel } from './pane-file-bridge.js';
import { openFile } from './filebrowser.js';
import { reconcileSplitPanes } from './split-pane-reconciler.js';
import { createSplitPane, updateSplitPaneMetadata, updatePaneContextChip, updatePaneFullAccessButton } from './split-pane-renderer.js';

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

function switchNativeSession(sessionId, expectedSlug) {
  store.set({ splitPanes: null });
  var ws = getWs();
  var state = store.snap();
  if ((!expectedSlug || expectedSlug === state.currentSlug) && isCurrentProjectSessionReady(state, ws)) {
    ws.send(JSON.stringify({ type: "switch_session", id: sessionId }));
  }
}

function closePane(sessionId) {
  var split = store.get('splitPanes');
  if (!split || !split.panes || split.panes.length < 2) return;
  var index = -1;
  for (var pi = 0; pi < split.panes.length; pi++) if (split.panes[pi].sessionId === sessionId) index = pi;
  if (index === -1) return;
  if (split.groupId && getWs() && getWs().readyState === 1) {
    var group = null;
    var groups = store.get('splitGroups') || [];
    for (var gi = 0; gi < groups.length; gi++) if (groups[gi].id === split.groupId) group = groups[gi];
    var roles = splitGroupRoles(group);
    var closingId = sessionId;
    if (roles && roles.version === 2 && roles.workerIds.indexOf(closingId) !== -1) {
      var request = splitWorkerCloseRequest(group, getCachedSessions(), store.get('currentSlug'), closingId,
        "worker-close-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8));
      if (request) getWs().send(JSON.stringify(request));
      return;
    }
    getWs().send(JSON.stringify({ type: "split_group_dissolve", id: split.groupId }));
  }
  var next = split.panes[index === 0 ? 1 : 0];
  switchNativeSession(next.sessionId, next.slug);
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
    if (titleEls[i].parentNode) titleEls[i].parentNode.title = session.title;
    if (titleEls[i].style.display !== "none") titleEls[i].textContent = session.title;
  }
  var accessBtns = host.querySelectorAll(".split-pane-full-access");
  for (var ai = 0; ai < split.panes.length && ai < accessBtns.length; ai++) {
    updatePaneFullAccessButton(accessBtns[ai], sessionById(split.panes[ai].sessionId));
  }
  syncPairChrome(host, split);
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
  if (handlePaneIssueMessage(event, host)) return;
  if (handlePaneFileMessage(event, host, openFile, revealFilesPanel)) return;
  if (msg.type !== "clay-pane-context") return;
  var frames = host.querySelectorAll(".split-pane-frame");
  for (var i = 0; i < frames.length; i++) {
    if (frames[i].contentWindow === event.source) {
      updatePaneContextChip(frames[i].closest(".split-pane"), msg);
      return;
    }
  }
}

function renderSplit(split) {
  if (!host || !nativeApp) return;
  var panes = split && split.panes;
  if (!panes || panes.length < 2 || panes.length > 3) {
    placeStickyNotesOverlay(false);
    host.innerHTML = "";
    host.classList.remove("visible");
    nativeApp.classList.remove("split-native-hidden");
    return;
  }
  placeStickyNotesOverlay(true);
  nativeApp.classList.add("split-native-hidden");
  host.classList.add("visible");
  reconcileSplitPanes(host, panes, function (pane) { return createSplitPane(pane, closePane); }, updateSplitPaneMetadata);
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
  if (!group || !Array.isArray(group.members) || group.members.length < 2 || group.members.length > 3) return false;
  var memberIds = splitGroupMemberIds(group);
  if (memberIds.length !== group.members.length) return false;
  for (var mi = 0; mi < memberIds.length; mi++) if (!sessionById(memberIds[mi])) return false;
  detachTuiView();
  store.set({
    splitPanes: {
      groupId: group.id,
      panes: memberIds.map(function (id) { return paneForSession(id); }),
    },
  });
  // Anchor the parent's active session (and server-side presence) to a
  // member while the split is open, so a hard refresh restores into this
  // group instead of whatever was viewed before it.
  var activeId = store.get('activeSessionId');
  var anchorId = splitGroupActiveAnchor(group, activeId);
  if (anchorId && anchorId !== activeId) {
    var ws = getWs();
    if (isCurrentProjectSessionReady(store.snap(), ws)) {
      ws.send(JSON.stringify({ type: "switch_session", id: anchorId }));
    }
  }
  dismissSplitOverlays();
  return true;
}

// Reload survival: when the restored active session turns out to be a split
// group member, reopen that group. Safe to call often -- no-ops unless a
// group member is active natively with no split open.
export function maybeRestoreSplitGroup() {
  var state = store.snap();
  if (!isCurrentProjectSessionReady(state, getWs())) return;
  var split = state.splitPanes;
  if (split && !splitPanesMatchProject(split, state.currentSlug)) {
    store.set({ splitPanes: null });
    return;
  }
  if (state.paneMode) return;
  if (split) {
    var reconciliation = reconcileRestoredSplit(split, state.splitGroups);
    if (reconciliation.action === "clear") {
      store.set({ splitPanes: null });
      return;
    }
    if (reconciliation.action === "rebuild") {
      var rebuilt = reconciliation.group;
      if (rebuilt.members.some(function (id) { return !sessionById(id); })) {
        store.set({ splitPanes: null });
        return;
      }
      store.set({ splitPanes: {
        groupId: rebuilt.id,
        panes: splitGroupMemberIds(rebuilt).map(function (id) { return paneForSession(id); }),
      } });
    }
    return;
  }
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
  if (!group || !Array.isArray(group.members) || group.members.length < 2) return;
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "split_group_dissolve", id: group.id }));
  }
  var split = store.get('splitPanes');
  if (split && split.groupId === group.id) switchNativeSession(split.panes[0].sessionId);
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
    if (state.permissionModePendingByTarget !== prev.permissionModePendingByTarget || state.connected !== prev.connected ||
        state.skipPermsEnabled !== prev.skipPermsEnabled) syncPaneTitles();
    // Switching to a session outside the open split (new_session, palette,
    // notification click) closes the split UI; the group itself persists.
    if (state.activeSessionId !== prev.activeSessionId && state.splitPanes && state.splitPanes.panes) {
      var sp = state.splitPanes.panes;
      var activePane = false;
      for (var spi = 0; spi < sp.length; spi++) if (state.activeSessionId === sp[spi].sessionId) activePane = true;
      if (!activePane) {
        store.set({ splitPanes: null });
      }
    }
    if (state.splitGroups !== prev.splitGroups) {
      if (!isCurrentProjectSessionReady(state, getWs())) return;
      var split = state.splitPanes;
      if (!split || !split.panes || split.panes.length < 2) return;
      if (!splitPanesMatchProject(split, state.currentSlug)) {
        store.set({ splitPanes: null });
        return;
      }
      syncPairChrome(host, split);
      if (split.groupId) {
        var currentGroup = null;
        for (var cgi = 0; cgi < state.splitGroups.length; cgi++) {
          if (state.splitGroups[cgi].id === split.groupId) currentGroup = state.splitGroups[cgi];
        }
        if (!currentGroup) {
          switchNativeSession(split.panes[0].sessionId, state.currentSlug);
          return;
        }
        var projectedIds = splitGroupMemberIds(currentGroup);
        if (projectedIds.length < 2 || projectedIds.length > 3) return;
        var projectedPanes = projectedIds.map(function (id) { return paneForSession(id); });
        var projectedKey = projectedPanes.map(function (pane) { return pane.slug + "#" + pane.sessionId; }).join("|");
        var currentKey = split.panes.map(function (pane) { return pane.slug + "#" + pane.sessionId; }).join("|");
        if (projectedKey !== currentKey) {
          store.set({ splitPanes: { groupId: split.groupId, panes: projectedPanes } });
        }
        return;
      }
      var ids = split.panes.map(function (pane) { return pane.sessionId; });
      var confirmed = findSplitGroup(state.splitGroups, ids);
      if (confirmed) store.set({ splitPanes: { groupId: confirmed.id, panes: split.panes } });
    }
  });
  renderSplit(store.get('splitPanes'));
}
