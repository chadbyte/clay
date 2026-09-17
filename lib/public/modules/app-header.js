// app-header.js - Session rename, session info popover, progressive history loading
// Extracted from app.js (PR-34)

import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml, copyToClipboard } from './utils.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getMessagesEl } from './dom-refs.js';
import { getActivityEl, setActivityEl, getTurnCounter, setTurnCounter, getPrependAnchor, setPrependAnchor, finalizeAssistantBlock } from './app-rendering.js';
import { processMessage } from './app-messages.js';
import { saveToolState, resetToolState, restoreToolState } from './tools.js';
import { getSessionUsage, setSessionUsage, getContextData, setContextData, updateContextPanel, updateUsagePanel } from './app-panels.js';
import { onHistoryPrepended as onSessionSearchHistoryPrepended } from './session-search.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { bindPermissionControl, renderPermissionControl } from './permission-control.js';

// --- Module-owned state ---
var sessionInfoPopover = null;
var historySentinelObserver = null;

export function initHeader() {
  var headerRenameBtn = document.getElementById("header-rename-btn");
  var headerTitleEl = document.getElementById("header-title");
  var headerInfoBtn = document.getElementById("header-info-btn");
  var headerFullAccessBtn = document.getElementById("header-full-access-btn");

  function permissionControlState() {
    var s = store.snap();
    return {
      projectSlug: s.currentSlug,
      sessionId: s.activeSessionId,
      vendor: s.currentVendor || "claude",
      permissionMode: s.currentMode,
      effectivePermissionMode: s.effectivePermissionMode,
      permissionCapabilities: s.permissionCapabilities,
      connected: s.connected,
      globalPermissionModeForced: s.skipPermsEnabled === true,
      visible: !s.dmMode && !s.splitPanes && s.activeSessionMode === "gui" && !!s.activeSessionId,
    };
  }

  function updateFullAccessButton() {
    if (!headerFullAccessBtn) return;
    renderPermissionControl(headerFullAccessBtn, permissionControlState());
  }

  if (headerFullAccessBtn) {
    bindPermissionControl(headerFullAccessBtn, permissionControlState);
    store.subscribe(function (state, prev) {
      if (state.currentMode !== prev.currentMode || state.effectivePermissionMode !== prev.effectivePermissionMode || state.permissionCapabilities !== prev.permissionCapabilities || state.permissionModePendingByTarget !== prev.permissionModePendingByTarget || state.connected !== prev.connected || state.activeSessionId !== prev.activeSessionId || state.currentSlug !== prev.currentSlug || state.currentVendor !== prev.currentVendor ||
          state.activeSessionMode !== prev.activeSessionMode ||
          state.dmMode !== prev.dmMode || state.splitPanes !== prev.splitPanes ||
          state.skipPermsEnabled !== prev.skipPermsEnabled) updateFullAccessButton();
    });
    updateFullAccessButton();
  }

  // --- Header session rename ---
  if (headerRenameBtn) {
    headerRenameBtn.addEventListener("click", function () {
      if (!store.get('activeSessionId')) return;
      var currentText = headerTitleEl.textContent;
      var input = document.createElement("input");
      input.type = "text";
      input.className = "header-rename-input";
      input.value = currentText;
      var titleBar = headerTitleEl.closest(".title-bar-content");
      if (titleBar) titleBar.classList.add("session-renaming");
      headerTitleEl.style.display = "none";
      headerRenameBtn.style.display = "none";
      headerTitleEl.parentNode.insertBefore(input, headerTitleEl.nextSibling);
      input.focus();
      input.select();

      function commit() {
        var newTitle = input.value.trim();
        var ws = getWs();
        if (newTitle && newTitle !== currentText && ws && ws.readyState === 1) {
          // With a split group open the header shows the GROUP name, so the
          // pencil must rename the group, not the parent's last active session.
          var split = store.get('splitPanes');
          if (split) {
            if (split.groupId) {
              ws.send(JSON.stringify({ type: "split_group_rename", id: split.groupId, name: newTitle }));
              headerTitleEl.textContent = newTitle;
            }
          } else {
            ws.send(JSON.stringify({ type: "rename_session", id: store.get('activeSessionId'), title: newTitle }));
            headerTitleEl.textContent = newTitle;
          }
        }
        input.remove();
        if (titleBar) titleBar.classList.remove("session-renaming");
        headerTitleEl.style.display = "";
        headerRenameBtn.style.display = "";
      }

      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") {
          e.preventDefault();
          input.remove();
          if (titleBar) titleBar.classList.remove("session-renaming");
          headerTitleEl.style.display = "";
          headerRenameBtn.style.display = "";
        }
      });
      input.addEventListener("blur", commit);
    });
  }

  // --- Session info popover ---
  if (headerInfoBtn) {
    headerInfoBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (sessionInfoPopover) { closeSessionInfoPopover(); return; }

      var pop = document.createElement("div");
      pop.className = "session-info-popover";

      function addRow(label, value) {
        var val = value == null ? "-" : String(value);
        var row = document.createElement("div");
        row.className = "info-row";
        row.innerHTML =
          '<span class="info-label">' + label + '</span>' +
          '<span class="info-value">' + escapeHtml(val) + '</span>' +
          '<button class="info-copy-btn" title="Copy">' + iconHtml("copy") + '</button>';
        var btn = row.querySelector(".info-copy-btn");
        btn.addEventListener("click", function () {
          copyToClipboard(value || "").then(function () {
            btn.innerHTML = iconHtml("check");
            refreshIcons();
            setTimeout(function () { btn.innerHTML = iconHtml("copy"); refreshIcons(); }, 1200);
          });
        });
        pop.appendChild(row);
      }

      var split = store.get('splitPanes');
      if (split && split.panes) {
        // A split group is open: single-session info makes no sense here.
        // Show one section per member instead.
        var cached = getCachedSessions() || [];
        for (var pi = 0; pi < split.panes.length; pi++) {
          var member = null;
          for (var ci = 0; ci < cached.length; ci++) {
            if (cached[ci].id === split.panes[pi].sessionId) { member = cached[ci]; break; }
          }
          var heading = document.createElement("div");
          heading.className = "info-section-title";
          heading.textContent = (member && member.title) || split.panes[pi].title || ("Session " + split.panes[pi].sessionId);
          pop.appendChild(heading);
          addRow("Local ID", split.panes[pi].sessionId);
          if (member && member.cliSessionId) {
            addRow("Session ID", member.cliSessionId);
            addRow("Resume", "claude --resume " + member.cliSessionId);
          }
        }
      } else {
        var s = store.snap();
        if (s.cliSessionId) addRow("Session ID", s.cliSessionId);
        if (s.activeSessionId) addRow("Local ID", s.activeSessionId);
        if (s.cliSessionId) addRow("Resume", "claude --resume " + s.cliSessionId);
      }

      document.body.appendChild(pop);
      sessionInfoPopover = pop;
      refreshIcons();

      var btnRect = headerInfoBtn.getBoundingClientRect();
      pop.style.top = (btnRect.bottom + 6) + "px";
      pop.style.left = btnRect.left + "px";
      var popRect = pop.getBoundingClientRect();
      if (popRect.right > window.innerWidth - 8) {
        pop.style.left = (window.innerWidth - popRect.width - 8) + "px";
      }
    });

    document.addEventListener("click", function (e) {
      if (sessionInfoPopover && !sessionInfoPopover.contains(e.target) && !e.target.closest("#header-info-btn")) {
        closeSessionInfoPopover();
      }
    });
  }
}

export function closeSessionInfoPopover() {
  if (sessionInfoPopover) {
    sessionInfoPopover.remove();
    sessionInfoPopover = null;
  }
}

export function updateHistorySentinel() {
  var messagesEl = getMessagesEl();
  var existing = messagesEl.querySelector(".history-sentinel");
  if (store.get('historyFrom') > 0) {
    if (!existing) {
      var sentinel = document.createElement("div");
      sentinel.className = "history-sentinel";
      sentinel.innerHTML = '<button class="load-more-btn">Load earlier messages</button>';
      sentinel.querySelector(".load-more-btn").addEventListener("click", function () {
        requestMoreHistory();
      });
      messagesEl.insertBefore(sentinel, messagesEl.firstChild);

      // Auto-load when sentinel scrolls into view
      if (historySentinelObserver) historySentinelObserver.disconnect();
      historySentinelObserver = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !store.get('loadingMore') && store.get('historyFrom') > 0) {
          requestMoreHistory();
        }
      }, { root: messagesEl, rootMargin: "200px 0px 0px 0px" });
      historySentinelObserver.observe(sentinel);
    }
  } else {
    if (existing) existing.remove();
    if (historySentinelObserver) { historySentinelObserver.disconnect(); historySentinelObserver = null; }
  }
}

export function requestMoreHistory() {
  var ws = getWs();
  var s = store.snap();
  if (s.loadingMore || s.historyFrom <= 0 || !ws || !s.connected) return;
  store.set({ loadingMore: true });
  var messagesEl = getMessagesEl();
  var btn = messagesEl.querySelector(".load-more-btn");
  if (btn) btn.classList.add("loading");
  ws.send(JSON.stringify({ type: "load_more_history", before: s.historyFrom }));
}

export function prependOlderHistory(items, meta) {
  var messagesEl = getMessagesEl();

  // Save current rendering state
  var savedMsgEl = store.get('currentMsgEl');
  var savedActivity = getActivityEl();
  var savedFullText = store.get('currentFullText');
  var savedTurnCounter = getTurnCounter();
  var savedToolsState = saveToolState();
  // Save context & usage so old result messages don't overwrite current values
  var savedContext = JSON.parse(JSON.stringify(getContextData()));
  var savedUsage = JSON.parse(JSON.stringify(getSessionUsage()));

  // Reset to initial values for clean rendering
  store.set({ currentMsgEl: null, currentFullText: "" });
  setActivityEl(null);
  setTurnCounter(0);
  resetToolState();

  // Set prepend anchor to insert before existing content
  // Skip the sentinel itself when setting anchor
  var firstReal = messagesEl.querySelector(".history-sentinel");
  setPrependAnchor(firstReal ? firstReal.nextSibling : messagesEl.firstChild);

  // Remember the first existing content element and its position
  var anchorEl = getPrependAnchor();
  var anchorOffset = anchorEl ? anchorEl.getBoundingClientRect().top : 0;

  // Process each item through the rendering pipeline
  for (var i = 0; i < items.length; i++) {
    processMessage(items[i]);
  }

  // Finalize any open assistant block from the batch
  finalizeAssistantBlock();

  // Clear prepend mode
  setPrependAnchor(null);

  // Restore saved state
  store.set({ currentMsgEl: savedMsgEl, currentFullText: savedFullText });
  setActivityEl(savedActivity);
  setTurnCounter(savedTurnCounter);
  restoreToolState(savedToolsState);
  // Restore context & usage (old result messages must not overwrite current values)
  setContextData(savedContext);
  setSessionUsage(savedUsage);
  updateContextPanel();
  updateUsagePanel();

  // Fix scroll: restore anchor element to same visual position
  if (anchorEl) {
    var newTop = anchorEl.getBoundingClientRect().top;
    messagesEl.scrollTop += (newTop - anchorOffset);
  }

  // Update state
  store.set({ historyFrom: meta.from, loadingMore: false });

  // Renumber data-turn attributes in DOM order
  var turnEls = messagesEl.querySelectorAll("[data-turn]");
  for (var t = 0; t < turnEls.length; t++) {
    turnEls[t].dataset.turn = t + 1;
  }
  setTurnCounter(turnEls.length);

  // Update sentinel
  if (meta.hasMore) {
    var btn = messagesEl.querySelector(".load-more-btn");
    if (btn) btn.classList.remove("loading");
  } else {
    updateHistorySentinel();
  }

  // Notify in-session search that history was prepended (for pending scroll targets)
  onSessionSearchHistoryPrepended();
}
