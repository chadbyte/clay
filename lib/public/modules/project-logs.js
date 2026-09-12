// Project Logs — the project's ledger of agent-authored decisions and work.
//
// A bounded right-side workbench pane, like the document viewer and terminal.
// Inside it there is one navigation stack rather than a master/detail split:
// the list fills the pane, opening an entry replaces it with the full-pane
// record, and Back returns to the list with the query, filter, and scroll
// position intact.
//
// People read and comment, and project owners may delete. Canonical entries
// are created and revised only by this project's agent sessions through the
// clay-logs MCP tools, so this module has no create or edit affordance.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { closeScheduledTasks } from './scheduled-tasks.js';
import { closeNotesBrowser } from './sticky-notes-browser.js';
import { closeFileViewer } from './filebrowser.js';
import { closeTerminal } from './terminal.js';
import { renderFilter, renderContextFilter, renderList, renderDetail } from './project-logs-render.js';

var panel = null;
var listEl = null;
var detailEl = null;
var searchEl = null;
var filterEl = null;
var contextFilterEl = null;
var backBtn = null;
var deleteDialog = null;
var pendingDeleteEntry = null;
var searchTimer = null;
var requestCounter = 0;

function syncUnreadBadge() {
  var button = document.getElementById("project-logs-btn");
  if (!button) return;
  var unread = store.get('projectLogsUnread') || 0;
  button.classList.toggle("project-logs-unread", unread > 0);
  var badge = document.getElementById("project-logs-count");
  if (!badge) return;
  badge.textContent = unread > 0 ? String(unread) : "";
  badge.classList.toggle("hidden", unread < 1);
}

function acknowledgeUpdates() {
  if (!store.get('projectLogsUnread')) return;
  store.set({ projectLogsUnread: 0 });
  syncUnreadBadge();
}

function noteCanonicalUpdate(msg) {
  if (!msg || !msg.ref || !msg.revision) return false;
  var seen = store.get('projectLogsSeenRevisions') || {};
  if (seen[msg.ref] >= msg.revision) return false;
  var next = Object.assign({}, seen);
  next[msg.ref] = msg.revision;
  store.set({
    projectLogsSeenRevisions: next,
    projectLogsUnread: store.get('projectLogsOpen') ? 0 : (store.get('projectLogsUnread') || 0) + 1,
  });
  syncUnreadBadge();
  return true;
}

function nextRequestId(prefix) {
  requestCounter += 1;
  return prefix + "-" + Date.now() + "-" + requestCounter;
}

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function ensurePanel() {
  if (panel) return;
  var panels = document.getElementById("main-panels");
  if (!panels) return;
  panel = document.createElement("section");
  panel.id = "project-logs-panel";
  panel.className = "project-logs-panel hidden";
  panel.setAttribute("aria-label", "Project Logs");
  panel.innerHTML =
    '<header class="project-logs-topbar">' +
      '<button id="project-logs-back" class="project-logs-icon-btn hidden" type="button" title="Back to the log list" aria-label="Back to the log list"><i data-lucide="arrow-left"></i></button>' +
      '<span class="project-logs-title"><i data-lucide="notebook-tabs"></i>Logs</span>' +
      '<span class="project-logs-subtitle">Decisions and work recorded by this project</span>' +
      '<div class="project-logs-window-actions" aria-label="Project Logs window controls">' +
        '<button id="project-logs-wide" class="project-logs-icon-btn" type="button" title="Widen panel" aria-label="Widen Logs panel" aria-pressed="false"><i data-lucide="chevrons-left-right"></i></button>' +
        '<button id="project-logs-fullscreen" class="project-logs-icon-btn" type="button" title="Toggle fullscreen" aria-label="Toggle Logs fullscreen" aria-pressed="false"><i data-lucide="maximize-2"></i></button>' +
        '<button id="project-logs-close" class="project-logs-icon-btn" type="button" title="Close Logs" aria-label="Close Logs"><i data-lucide="x"></i></button>' +
      '</div>' +
    '</header>' +
    '<div id="project-logs-toolbar" class="project-logs-toolbar">' +
      '<label class="project-logs-search"><i data-lucide="search"></i><input id="project-logs-search" type="search" placeholder="Search logs" autocomplete="off"></label>' +
      '<div id="project-logs-context-filter-slot"></div>' +
      '<div id="project-logs-filter-slot"></div>' +
    '</div>' +
    '<div id="project-logs-list" class="project-logs-list" role="list"></div>' +
    '<main id="project-logs-detail" class="project-logs-detail hidden"></main>' +
    '<div id="project-log-delete-dialog" class="project-log-delete-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="project-log-delete-heading">' +
      '<div class="project-log-delete-dialog-card">' +
        '<h2 id="project-log-delete-heading">Delete this log?</h2>' +
        '<p>This removes the entry from the project ledger. It cannot be restored in the app.</p>' +
        '<p class="project-log-delete-dialog-title"></p>' +
        '<p class="project-log-delete-dialog-status" role="status"></p>' +
        '<div class="project-log-delete-dialog-actions">' +
          '<button type="button" data-action="cancel">Cancel</button>' +
          '<button type="button" class="danger" data-action="delete">Delete log</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  panels.appendChild(panel);

  listEl = panel.querySelector("#project-logs-list");
  detailEl = panel.querySelector("#project-logs-detail");
  searchEl = panel.querySelector("#project-logs-search");
  filterEl = panel.querySelector("#project-logs-filter-slot");
  contextFilterEl = panel.querySelector("#project-logs-context-filter-slot");
  backBtn = panel.querySelector("#project-logs-back");
  deleteDialog = panel.querySelector("#project-log-delete-dialog");

  panel.querySelector("#project-logs-close").addEventListener("click", closeProjectLogs);
  backBtn.addEventListener("click", showList);
  panel.querySelector("#project-logs-wide").addEventListener("click", function () {
    applyWindowState(!store.get('projectLogsWide'), store.get('projectLogsFullscreen'));
  });
  panel.querySelector("#project-logs-fullscreen").addEventListener("click", function () {
    applyWindowState(store.get('projectLogsWide'), !store.get('projectLogsFullscreen'));
  });
  searchEl.addEventListener("input", function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(requestList, 180);
  });
  deleteDialog.querySelector('[data-action="cancel"]').addEventListener("click", closeDeleteDialog);
  deleteDialog.querySelector('[data-action="delete"]').addEventListener("click", confirmDelete);
  deleteDialog.addEventListener("click", function (event) {
    if (event.target === deleteDialog) closeDeleteDialog();
  });
  deleteDialog.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeDeleteDialog();
  });
  refreshIcons();
}

// Width and fullscreen are transient view state, so they live in the store like
// every other mutable UI value. `panel-fullscreen` is the shared class the
// document viewer and terminal already use.
function applyWindowState(wide, fullscreen) {
  store.set({ projectLogsWide: !!wide, projectLogsFullscreen: !!fullscreen });
  if (!panel) return;
  panel.classList.toggle("project-logs-wide", !!wide && !fullscreen);
  panel.classList.toggle("panel-fullscreen", !!fullscreen);
  var wideBtn = panel.querySelector("#project-logs-wide");
  var fullBtn = panel.querySelector("#project-logs-fullscreen");
  if (wideBtn) {
    wideBtn.setAttribute("aria-pressed", wide ? "true" : "false");
    wideBtn.disabled = !!fullscreen;
  }
  if (fullBtn) fullBtn.setAttribute("aria-pressed", fullscreen ? "true" : "false");
}

// --- Navigation stack ----------------------------------------------------

function showList() {
  if (!panel) return;
  store.set({ projectLogsView: "list", projectLogsSelectedRef: null });
  detailEl.classList.add("hidden");
  listEl.classList.remove("hidden");
  panel.querySelector("#project-logs-toolbar").classList.remove("hidden");
  backBtn.classList.add("hidden");
  // The list is re-shown rather than rebuilt, so the query and filter survive;
  // the scroll offset is restored from where the user left it.
  listEl.scrollTop = store.get('projectLogsListScroll') || 0;
}

function showDetail(entry) {
  if (!panel || !entry) return;
  store.set({ projectLogsListScroll: listEl.scrollTop, projectLogsView: "detail", projectLogsSelectedRef: entry.ref });
  listEl.classList.add("hidden");
  panel.querySelector("#project-logs-toolbar").classList.add("hidden");
  detailEl.classList.remove("hidden");
  detailEl.scrollTop = 0;
  backBtn.classList.remove("hidden");
  renderDetail(detailEl, entry, {
    onComment: submitComment,
    onDelete: openDeleteDialog,
    canDelete: store.get('projectLogsCanDelete') === true,
  });
}

function openDeleteDialog(entry) {
  if (!deleteDialog || !entry || store.get('projectLogsCanDelete') !== true) return;
  pendingDeleteEntry = entry;
  deleteDialog.querySelector(".project-log-delete-dialog-title").textContent = entry.title || "Untitled log";
  deleteDialog.querySelector(".project-log-delete-dialog-status").textContent = "";
  deleteDialog.querySelector('[data-action="delete"]').disabled = false;
  deleteDialog.querySelector('[data-action="cancel"]').disabled = false;
  deleteDialog.classList.remove("hidden");
  deleteDialog.querySelector('[data-action="cancel"]').focus();
}

function closeDeleteDialog(force) {
  if (!deleteDialog) return;
  if (!force && store.get('projectLogsDeleteRequestId')) return;
  deleteDialog.classList.add("hidden");
  pendingDeleteEntry = null;
  store.set({ projectLogsDeleteRequestId: null });
}

function confirmDelete() {
  if (!pendingDeleteEntry || !deleteDialog) return;
  var requestId = nextRequestId("delete-log");
  var status = deleteDialog.querySelector(".project-log-delete-dialog-status");
  var button = deleteDialog.querySelector('[data-action="delete"]');
  var cancelButton = deleteDialog.querySelector('[data-action="cancel"]');
  store.set({ projectLogsDeleteRequestId: requestId });
  button.disabled = true;
  cancelButton.disabled = true;
  status.textContent = "Deleting...";
  if (!send({ type: "project_log_delete", requestId: requestId, ref: pendingDeleteEntry.ref })) {
    button.disabled = false;
    cancelButton.disabled = false;
    store.set({ projectLogsDeleteRequestId: null });
    status.textContent = "Logs are unavailable while disconnected.";
  }
}

// --- Requests ------------------------------------------------------------

function requestList() {
  var requestId = nextRequestId("list-logs");
  store.set({ projectLogsListRequestId: requestId });
  if (listEl && !store.get('projectLogsEntries').length) {
    listEl.setAttribute("aria-busy", "true");
    renderList(listEl, [], requestEntry, "Loading the project ledger...");
  }
  if (!send({
    type: "project_logs_list",
    requestId: requestId,
    query: searchEl ? searchEl.value.trim() : "",
    category: store.get('projectLogsCategory') || "",
    contextMode: store.get('projectLogsContextMode') || "",
  })) {
    if (listEl) {
      listEl.removeAttribute("aria-busy");
      renderList(listEl, [], requestEntry, "Logs are unavailable while disconnected.");
    }
  }
}

function requestEntry(ref) {
  var requestId = nextRequestId("read-log");
  store.set({ projectLogsReadRequestId: requestId });
  send({ type: "project_log_read", requestId: requestId, ref: ref });
}

function submitComment(ref, body, statusEl, inputEl) {
  var requestId = nextRequestId("comment-log");
  store.set({ projectLogsCommentRequestId: requestId, projectLogsCommentInput: inputEl || null });
  if (!send({ type: "project_log_comment", requestId: requestId, ref: ref, body: body })) {
    statusEl.textContent = "Logs are unavailable while disconnected.";
    return;
  }
  statusEl.textContent = "Posting...";
  store.set({ projectLogsCommentStatusEl: statusEl });
}

function applyFilter(category) {
  store.set({ projectLogsCategory: category || "" });
  requestList();
}

function applyContextFilter(contextMode) {
  store.set({ projectLogsContextMode: contextMode || "project" });
  requestList();
}

// --- Lifecycle -----------------------------------------------------------

export function initProjectLogs() {
  var button = document.getElementById("project-logs-btn");
  if (!button) return;
  button.addEventListener("click", function () {
    if (store.get('projectLogsOpen')) closeProjectLogs();
    else openProjectLogs();
  });
  syncUnreadBadge();
  store.subscribe(function (state, previous) {
    if (state.currentSlug === previous.currentSlug) return;
    closeProjectLogs();
    applyWindowState(false, false);
    // A different project must never inherit the previous project's unread
    // state.
    store.set({
      projectLogsEntries: [],
      projectLogsSelectedRef: null,
      projectLogsView: "list",
      projectLogsCategory: "",
      projectLogsContextMode: "",
      projectLogsIsWorktree: false,
      projectLogsListScroll: 0,
      projectLogsListRequestId: null,
      projectLogsReadRequestId: null,
      projectLogsCommentRequestId: null,
      projectLogsDeleteRequestId: null,
      projectLogsCanDelete: false,
      projectLogsUnread: 0,
      projectLogsSeenRevisions: {}
    });
    syncUnreadBadge();
  });
}

// The conversation, composer, and title bar stay mounted and visible: Logs
// opens beside them, it does not replace them.
export function openProjectLogs() {
  ensurePanel();
  if (!panel) return;
  closeScheduledTasks();
  closeNotesBrowser();
  // Claim the single right workbench slot.
  try { closeFileViewer(); } catch (e) {}
  try { closeTerminal(); } catch (e) {}
  panel.classList.remove("hidden");
  applyWindowState(store.get('projectLogsWide'), false);
  var button = document.getElementById("project-logs-btn");
  if (button) button.classList.add("active");
  store.set({ projectLogsOpen: true });
  // Opening through the explicit tool button acknowledges the live badge.
  acknowledgeUpdates();
  showList();
  requestList();
}

export function openProjectLog(ref) {
  if (typeof ref !== "string" || !/^log:[A-Za-z0-9_-]{24}$/.test(ref)) return false;
  openProjectLogs();
  requestEntry(ref);
  return true;
}

export function closeProjectLogs() {
  if (!store.get('projectLogsOpen')) return;
  if (panel) {
    panel.classList.add("hidden");
  }
  closeDeleteDialog(true);
  // Fullscreen is always dropped on close so the next open is a bounded pane
  // and never silently hides the conversation.
  applyWindowState(store.get('projectLogsWide'), false);
  var button = document.getElementById("project-logs-btn");
  if (button) button.classList.remove("active");
  store.set({ projectLogsOpen: false });
}

// --- Server messages -----------------------------------------------------

export function handleProjectLogsState(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsListRequestId')) return;
  var contextMode = msg.contextMode || store.get('projectLogsContextMode') || (msg.isWorktree ? "current" : "project");
  store.set({
    projectLogsEntries: msg.entries || [],
    projectLogsCanDelete: msg.canDelete === true,
    projectLogsContextMode: contextMode,
    projectLogsIsWorktree: msg.isWorktree === true,
  });
  if (!listEl) return;
  listEl.removeAttribute("aria-busy");
  if (filterEl && Array.isArray(msg.categories)) {
    renderFilter(filterEl, msg.categories, store.get('projectLogsCategory'), applyFilter);
  }
  if (contextFilterEl) {
    renderContextFilter(contextFilterEl, contextMode, msg.isWorktree === true, applyContextFilter);
  }
  var isFiltered = !!((searchEl && searchEl.value.trim()) || store.get('projectLogsCategory') || contextMode !== "project");
  renderList(listEl, msg.entries || [], requestEntry,
    isFiltered ? "No entries match the current scope, search, or category." : "No logs yet. This project's agent sessions record decisions and work here.");
  if (store.get('projectLogsView') !== "detail") listEl.scrollTop = store.get('projectLogsListScroll') || 0;
}

export function handleProjectLogEntry(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsReadRequestId')) return;
  if (!msg.entry) return;
  store.set({ projectLogsCanDelete: msg.canDelete === true });
  showDetail(msg.entry);
}

export function handleProjectLogCommented(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsCommentRequestId')) return;
  if (!msg.entry) return;
  // The comment is a proposal, not a change, so say so plainly rather than
  // leaving the composer reading "Posting..." forever.
  var pendingStatus = store.get('projectLogsCommentStatusEl');
  if (pendingStatus) pendingStatus.textContent = msg.reviewQueued
    ? "Project Driver is reviewing..."
    : "Awaiting Project Driver review";
  store.set({ projectLogsCommentStatusEl: null });
  // Re-render the open entry so the new comment and its attribution appear,
  // then refresh the ledger so the comment count is current.
  showDetail(msg.entry);
  if (msg.reviewQueued && detailEl) {
    var badges = detailEl.querySelectorAll(".project-log-comment-status-badge");
    if (badges.length > 0) badges[badges.length - 1].textContent = "Project Driver is reviewing";
  }
  requestList();
}

export function handleProjectLogCommentReviewed(msg) {
  if (!msg || !msg.ref || !store.get('projectLogsOpen')) return;
  if (store.get('projectLogsView') === "detail" && msg.ref === store.get('projectLogsSelectedRef')) {
    requestEntry(msg.ref);
    return;
  }
  requestList();
}

export function handleProjectLogDeleted(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsDeleteRequestId')) return;
  closeDeleteDialog(true);
  showList();
  requestList();
  showToast("Log deleted.");
}

// A canonical revision landed. This marks the explicit button only; it never
// opens, reveals, focuses, or scrolls the pane.
export function handleProjectLogUpdated(msg) {
  noteCanonicalUpdate(msg);
  if (msg.op === "delete" && msg.ref === store.get('projectLogsSelectedRef')) {
    closeDeleteDialog(true);
    showList();
  }
  // Refresh the ledger only when it is already on screen, so the row moves to
  // the top the moment its canonical update arrives.
  if (store.get('projectLogsOpen') && store.get('projectLogsView') !== "detail") requestList();
}

export function handleProjectLogsError(msg) {
  var pending = [
    store.get('projectLogsListRequestId'),
    store.get('projectLogsReadRequestId'),
    store.get('projectLogsCommentRequestId'),
    store.get('projectLogsDeleteRequestId')
  ];
  if (msg.requestId && pending.indexOf(msg.requestId) === -1) return;
  if (msg.requestId && msg.requestId === store.get('projectLogsListRequestId') && listEl) {
    listEl.removeAttribute("aria-busy");
    renderList(listEl, [], requestEntry, "The ledger could not be loaded. Try opening Logs again.");
  }
  if (msg.requestId && msg.requestId === store.get('projectLogsDeleteRequestId') && deleteDialog) {
    store.set({ projectLogsDeleteRequestId: null });
    deleteDialog.querySelector('[data-action="delete"]').disabled = false;
    deleteDialog.querySelector('[data-action="cancel"]').disabled = false;
    deleteDialog.querySelector(".project-log-delete-dialog-status").textContent = msg.message || "The log could not be deleted.";
  }
  showToast(msg.message || "Project Logs could not complete the request.", "error");
}
