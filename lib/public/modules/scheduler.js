/**
 * Scheduler module — Split-panel layout: sidebar (task list) + content area.
 *
 * Modes: calendar (month/week grid), detail (single task view), crafting (reparented chat).
 * Edit modal: change cron/name/enabled for existing records.
 */

import { iconHtml } from './icons.js';
import { showToast } from './utils.js';
import { renderModelList, renderModeList, renderEffortBar, renderThinkingBar } from './settings-defaults.js';
import { store } from './store.js';
import { initSchedulerConfig, setupCreateModal, openCreateModal, openCreateModalWithRecord, closeCreateModal, removePreview, getPreviewEl, showPreviewOnCell, showPreviewOnSlot, showPreviewForCreate, applyDraggedTask, parseCronSimple } from './scheduler-config.js';
import { initSchedulerHistory, renderHistory, _lastFiles as lastLoopFiles } from './scheduler-history.js';
export { handleLoopRegistryUpdated, handleLoopRegistryFiles, handleScheduleRunStarted, handleScheduleRunFinished, handleLoopScheduled } from './scheduler-history.js';

var ctx = null;
var records = []; // all loop registry records

// Calendar state
var currentView = "month";
var viewDate = new Date();

// Mode state
var currentMode = "calendar";     // "calendar" | "detail" | "crafting"
var selectedTaskId = null;
var showRalphTasks = false;        // toggle: show ralph-source tasks in sidebar
var showAllProjects = false;       // toggle: show tasks from all projects (default: current only)
var currentProjectSlug = null;     // derived from basePath on init
var draggedTaskId = null;          // drag-and-drop: task ID being dragged
var draggedTaskName = null;        // drag-and-drop: task name being dragged
var craftingTaskId = null;         // task ID currently being crafted
var craftingSessionId = null;      // session ID used for crafting
var logPreviousSessionId = null;   // session to restore when leaving log mode

// DOM refs
var panel = null;    // #scheduler-panel
var bodyEl = null;
var monthLabel = null;
var calHeader = null;
var popoverEl = null;
var panelOpen = false;

// Split-panel DOM refs
var sidebarListEl = null;
var contentCalEl = null;
var contentDetailEl = null;
var contentCraftEl = null;
var messagesOrigParent = null;    // for reparenting
var inputOrigNextSibling = null;  // anchor for restoring input-area position

// Edit state

// Create popover state (most create* vars moved to scheduler-config.js)
var createPopover = null;
var weekTzAbbr = "";               // cached timezone abbreviation for week view
var nowLineTimer = null;           // interval timer for updating current-time indicator

// Day names
var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var DAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
var MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// --- Init ---

export function initScheduler(_ctx) {
  ctx = _ctx;
  currentProjectSlug = ctx.currentSlug || null;
  createPopover = document.getElementById("schedule-create-popover");
  popoverEl = document.getElementById("schedule-popover");

  // Sidebar button
  var btn = document.getElementById("scheduler-btn");
  if (btn) {
    btn.addEventListener("click", function () {
      if (panelOpen) {
        closeScheduler();
      } else {
        ctx.requireClayRalph(function () {
          openScheduler();
        });
      }
    });
  }

  // Create modal (extracted to scheduler-config.js)
  initSchedulerConfig({
    ctx: ctx,
    getRecords: function () { return records; },
    getCreatePopover: function () { return createPopover; },
    getContentCalEl: function () { return contentCalEl; },
    getDragState: function () { return { draggedTaskId: draggedTaskId, draggedTaskName: draggedTaskName }; },
    clearDragState: function () { draggedTaskId = null; draggedTaskName = null; },
    send: send,
    pad: pad,
    esc: esc,
    detectInterval: detectInterval,
  });
  setupCreateModal();

  // History handlers (extracted to scheduler-history.js)
  initSchedulerHistory({
    isPanelOpen: function () { return panelOpen; },
    getCurrentMode: function () { return currentMode; },
    getSelectedTaskId: function () { return selectedTaskId; },
    getContentDetailEl: function () { return contentDetailEl; },
    setRecords: function (recs) { records = recs; },
    renderSidebar: function () { renderSidebar(); },
    render: function () { render(); },
    renderDetail: function () { renderDetail(); },
    send: send,
    formatDateTime: formatDateTime,
  });

  // Close popover on outside click
  document.addEventListener("click", function (e) {
    if (popoverEl && !popoverEl.classList.contains("hidden") && !popoverEl.contains(e.target)) {
      popoverEl.classList.add("hidden");
    }
  });
}

function ensurePanel() {
  if (panel) return;

  var hostEl = document.getElementById("main-area");
  if (!hostEl) return;

  panel = document.createElement("div");
  panel.id = "scheduler-panel";
  panel.className = "hidden";

  // --- Top header bar ---
  var topBar = document.createElement("div");
  topBar.className = "scheduler-top-bar";
  topBar.innerHTML =
    '<span class="scheduler-top-title"><i data-lucide="calendar-clock"></i>Scheduled Tasks</span>' +
    '<label class="scheduler-scope-toggle" id="scheduler-scope-toggle">' +
      '<span class="scheduler-scope-label" data-side="off">This project</span>' +
      '<span class="scheduler-scope-switch"><span class="scheduler-scope-thumb"></span></span>' +
      '<span class="scheduler-scope-label" data-side="on">All projects</span>' +
    '</label>' +
    '<button class="scheduler-close-btn" id="scheduler-panel-close" title="Close"><i data-lucide="x"></i></button>';
  panel.appendChild(topBar);

  // Scope toggle handler (in top bar)
  var scopeToggle = topBar.querySelector("#scheduler-scope-toggle");
  if (scopeToggle) {
    scopeToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      showAllProjects = !showAllProjects;
      scopeToggle.classList.toggle("active", showAllProjects);
      renderSidebar();
      if (currentMode === "calendar") render();
    });
  }

  // --- Body row (sidebar + content) ---
  var bodyRow = document.createElement("div");
  bodyRow.className = "scheduler-body-row";

  // --- Sidebar ---
  var sidebar = document.createElement("div");
  sidebar.className = "scheduler-sidebar";

  // Sidebar header
  var sidebarHeader = document.createElement("div");
  sidebarHeader.className = "scheduler-sidebar-header";
  sidebarHeader.innerHTML =
    '<span class="scheduler-sidebar-title">Tasks</span>' +
    '<span class="scheduler-sidebar-count">0</span>' +
    '<button class="scheduler-ralph-toggle" id="scheduler-ralph-toggle" title="Show Ralph Loops">' +
      '<i data-lucide="repeat"></i> <span>Show Ralph</span>' +
    '</button>';
  sidebar.appendChild(sidebarHeader);

  // Ralph toggle handler
  var ralphToggleBtn = sidebarHeader.querySelector("#scheduler-ralph-toggle");
  if (ralphToggleBtn) {
    ralphToggleBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      showRalphTasks = !showRalphTasks;
      ralphToggleBtn.classList.toggle("active", showRalphTasks);
      renderSidebar();
    });
  }

  // Add task button (opens wizard modal)
  var addRow = document.createElement("div");
  addRow.className = "scheduler-add-row";
  addRow.innerHTML =
    '<div class="scheduler-add-trigger" id="scheduler-add-trigger">' +
      '<i data-lucide="plus-circle"></i> <span>Add new task</span>' +
    '</div>';
  sidebar.appendChild(addRow);

  // Sidebar list
  var sidebarList = document.createElement("div");
  sidebarList.className = "scheduler-sidebar-list";
  sidebar.appendChild(sidebarList);
  sidebarListEl = sidebarList;

  bodyRow.appendChild(sidebar);

  // --- Content ---
  var content = document.createElement("div");
  content.className = "scheduler-content";

  // Content: calendar
  var contentCal = document.createElement("div");
  contentCal.className = "scheduler-content-calendar";

  // Calendar header (nav, month label, view toggle)
  var calHdr = document.createElement("div");
  calHdr.className = "scheduler-header";
  calHdr.id = "scheduler-cal-header";
  calHdr.innerHTML =
    '<div class="scheduler-nav">' +
      '<button class="scheduler-nav-btn" id="scheduler-prev"><i data-lucide="chevron-left"></i></button>' +
      '<button class="scheduler-nav-btn" id="scheduler-next"><i data-lucide="chevron-right"></i></button>' +
    '</div>' +
    '<span class="scheduler-month-label" id="scheduler-month-label"></span>' +
    '<button class="scheduler-today-btn" id="scheduler-today">Today</button>' +
    '<div class="scheduler-view-toggle">' +
      '<button class="scheduler-view-btn active" data-view="month">Month</button>' +
      '<button class="scheduler-view-btn" data-view="week">Week</button>' +
    '</div>';
  contentCal.appendChild(calHdr);
  calHeader = calHdr;
  monthLabel = calHdr.querySelector("#scheduler-month-label");

  // Calendar body
  var body = document.createElement("div");
  body.className = "scheduler-body";
  body.id = "scheduler-body";
  contentCal.appendChild(body);
  bodyEl = body;

  content.appendChild(contentCal);
  contentCalEl = contentCal;

  // Content: detail
  var contentDetail = document.createElement("div");
  contentDetail.className = "scheduler-content-detail hidden";
  content.appendChild(contentDetail);
  contentDetailEl = contentDetail;

  // Content: crafting
  var contentCraft = document.createElement("div");
  contentCraft.className = "scheduler-content-crafting hidden";
  content.appendChild(contentCraft);
  contentCraftEl = contentCraft;

  bodyRow.appendChild(content);
  panel.appendChild(bodyRow);

  hostEl.appendChild(panel);

  // --- Close button (in top bar) ---
  panel.querySelector("#scheduler-panel-close").addEventListener("click", function () {
    closeScheduler();
  });

  // Scheduled task creation stays in the scheduler after standalone Loop
  // creation is retired.
  var addTrigger = addRow.querySelector("#scheduler-add-trigger");
  addTrigger.addEventListener("click", function () {
    openCreateModal(new Date(), null, addTrigger);
  });

  // Calendar controls
  calHdr.querySelector("#scheduler-prev").addEventListener("click", function () { navigate(-1); });
  calHdr.querySelector("#scheduler-next").addEventListener("click", function () { navigate(1); });
  calHdr.querySelector("#scheduler-today").addEventListener("click", function () { viewDate = new Date(); render(); });

  // View toggle
  var viewBtns = calHdr.querySelectorAll(".scheduler-view-btn");
  for (var i = 0; i < viewBtns.length; i++) {
    (function (vbtn) {
      vbtn.addEventListener("click", function () {
        currentView = vbtn.dataset.view;
        for (var j = 0; j < viewBtns.length; j++) {
          viewBtns[j].classList.toggle("active", viewBtns[j] === vbtn);
        }
        render();
      });
    })(viewBtns[i]);
  }

  try { lucide.createIcons({ node: panel }); } catch (e) {}
}

// --- Mode switching ---

function switchMode(mode) {
  currentMode = mode;
  if (contentCalEl) contentCalEl.classList.toggle("hidden", mode !== "calendar");
  if (contentDetailEl) contentDetailEl.classList.toggle("hidden", mode !== "detail");
  if (contentCraftEl) contentCraftEl.classList.toggle("hidden", mode !== "crafting");

  if (mode === "calendar") {
    selectedTaskId = null;
    updateSidebarSelection();
    unparentChat();
    if (contentDetailEl) contentDetailEl.innerHTML = "";
    render();
  } else if (mode === "detail") {
    unparentChat();
    renderDetail();
  } else if (mode === "crafting") {
    reparentChat();
    updateCraftingHeader();
  }
}

function updateCraftingHeader() {
  if (!contentCraftEl) return;
  var existing = contentCraftEl.querySelector(".scheduler-crafting-header");
  if (existing) existing.remove();

  var isLog = !!logPreviousSessionId;
  var hdr = document.createElement("div");
  hdr.className = "scheduler-crafting-header";

  var backBtn = document.createElement("button");
  backBtn.className = "scheduler-crafting-back";
  backBtn.innerHTML = '<i data-lucide="arrow-left"></i> <span>' + (isLog ? "Back to task" : "Back to tasks") + '</span>';
  backBtn.addEventListener("click", function () {
    if (isLog) {
      switchMode("detail");
    } else {
      switchMode("calendar");
    }
  });
  hdr.appendChild(backBtn);

  var label = document.createElement("span");
  label.className = "scheduler-crafting-label";
  if (isLog) {
    label.innerHTML = '<i data-lucide="message-square"></i> Session Log';
  } else {
    label.innerHTML = '<i data-lucide="radio"></i> Crafting in progress';
  }
  hdr.appendChild(label);

  contentCraftEl.insertBefore(hdr, contentCraftEl.firstChild);
  try { lucide.createIcons({ node: hdr }); } catch (e) {}
}

// --- Open/Close ---

function openScheduler() {
  if (panelOpen) return;
  panelOpen = true;
  ensurePanel();
  if (!panel) return;

  var messagesEl = document.getElementById("messages");
  var inputArea = document.getElementById("input-area");
  var titleBar = document.querySelector("#main-column > .title-bar-content");
  var notesContainer = document.getElementById("sticky-notes-container");
  var notesArchive = document.getElementById("notes-archive");

  if (messagesEl) messagesEl.classList.add("hidden");
  if (inputArea) inputArea.classList.add("hidden");
  if (titleBar) titleBar.classList.add("hidden");
  if (notesContainer) notesContainer.classList.add("hidden");
  if (notesArchive) notesArchive.classList.add("hidden");

  // Un-mark sticky notes sidebar button when scheduler takes over
  var notesSidebarBtn = document.getElementById("sticky-notes-sidebar-btn");
  if (notesSidebarBtn) notesSidebarBtn.classList.remove("active");

  panel.classList.remove("hidden");
  viewDate = new Date();
  currentMode = "calendar";
  selectedTaskId = null;
  send({ type: "loop_registry_list" });
  switchMode("calendar");
  renderSidebar();
  try { lucide.createIcons({ node: panel }); } catch (e) {}

  var sidebarBtn = document.getElementById("scheduler-btn");
  if (sidebarBtn) sidebarBtn.classList.add("active");
  var homeBtn = document.getElementById("home-scheduler-btn");
  if (homeBtn) homeBtn.classList.add("active");

  // Persist scheduler state in URL hash
  if (location.hash !== "#scheduler") {
    history.replaceState(null, "", location.pathname + "#scheduler");
  }
}

export function closeScheduler() {
  if (!panelOpen) return;
  panelOpen = false;
  stopNowLineTimer();
  if (currentMode === "crafting") {
    unparentChat();
    // Switch back to previous session so crafting chat does not linger
    if (craftingSessionId && logPreviousSessionId) {
      send({ type: "switch_session", id: logPreviousSessionId });
      logPreviousSessionId = null;
    }
    craftingTaskId = null;
    craftingSessionId = null;
  }

  if (panel) panel.classList.add("hidden");
  if (popoverEl) popoverEl.classList.add("hidden");
  closeCreateModal();

  var messagesEl = document.getElementById("messages");
  var inputArea = document.getElementById("input-area");
  var titleBar = document.querySelector("#main-column > .title-bar-content");

  if (messagesEl) messagesEl.classList.remove("hidden");
  if (inputArea) inputArea.classList.remove("hidden");
  if (titleBar) titleBar.classList.remove("hidden");

  currentMode = "calendar";
  selectedTaskId = null;

  // Un-mark sidebar button
  var sidebarBtn = document.getElementById("scheduler-btn");
  if (sidebarBtn) sidebarBtn.classList.remove("active");
  var homeBtn = document.getElementById("home-scheduler-btn");
  if (homeBtn) homeBtn.classList.remove("active");

  // Remove scheduler hash from URL
  if (location.hash === "#scheduler") {
    history.replaceState(null, "", location.pathname);
  }
}

// Reset state on project switch (SPA navigation, no full reload)
export function resetScheduler(newSlug) {
  records = [];
  currentProjectSlug = newSlug || null;
  selectedTaskId = null;
  craftingTaskId = null;
  craftingSessionId = null;
}

function send(msg) {
  if (ctx && ctx.ws && ctx.ws.readyState === 1) {
    ctx.ws.send(JSON.stringify(msg));
  }
}

// --- Project filtering ---

function filterByProject(recs) {
  if (showAllProjects || !currentProjectSlug) return recs;
  return recs.filter(function (r) { return !r.projectSlug || r.projectSlug === currentProjectSlug; });
}

function isOwnRecord(rec) {
  if (!currentProjectSlug) return true;
  return !rec.projectSlug || rec.projectSlug === currentProjectSlug;
}

// --- Sidebar ---

function renderSidebar() {
  if (!sidebarListEl) return;

  // Apply project filter first
  var projectFiltered = filterByProject(records);

  // Update count badge (exclude ralph and schedule items from count)
  var taskRecords = projectFiltered.filter(function (r) { return r.source !== "ralph" && r.source !== "schedule"; });
  var ralphRecords = projectFiltered.filter(function (r) { return r.source === "ralph"; });
  var countEl = panel ? panel.querySelector(".scheduler-sidebar-count") : null;
  if (countEl) countEl.textContent = showRalphTasks ? (taskRecords.length + ralphRecords.length) : taskRecords.length;

  // Update toggle badges
  var toggleBtn = panel ? panel.querySelector("#scheduler-ralph-toggle") : null;
  if (toggleBtn) {
    toggleBtn.classList.toggle("has-items", ralphRecords.length > 0);
    toggleBtn.classList.toggle("active", showRalphTasks);
  }
  var scopeEl = panel ? panel.querySelector("#scheduler-scope-toggle") : null;
  if (scopeEl) {
    scopeEl.classList.toggle("active", showAllProjects);
  }

  var filtered = showRalphTasks
    ? projectFiltered.filter(function (r) { return r.source !== "schedule"; })
    : taskRecords;

  if (filtered.length === 0) {
    sidebarListEl.innerHTML = '<div class="scheduler-empty">' + (showRalphTasks ? "No tasks" : "No tasks yet") + '</div>';
    return;
  }

  var sorted = filtered.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  var html = "";
  for (var i = 0; i < sorted.length; i++) {
    var rec = sorted[i];
    var isRalph = rec.source === "ralph";
    var isScheduled = !!rec.cron;
    var selected = rec.id === selectedTaskId ? " selected" : "";
    var isCrafting = craftingTaskId === rec.id;
    var isOwn = isOwnRecord(rec);

    html += '<div class="scheduler-task-item' + selected + (isOwn ? "" : " foreign") + '" data-rec-id="' + rec.id + '" data-rec-name="' + esc(rec.name || rec.id) + '"' + (isOwn ? ' draggable="true"' : '') + '>';
    html += '<div class="scheduler-task-name-row">';
    if (isOwn) {
      html += '<span class="scheduler-task-drag-handle" title="Drag to calendar">' + iconHtml("grip-vertical") + '</span>';
    }
    html += '<div class="scheduler-task-name">' + esc(rec.name || rec.id) + '</div>';
    if (!isCrafting && isOwn) {
      html += '<button class="scheduler-task-edit-btn" data-edit-id="' + rec.id + '" type="button" title="Rename">' + iconHtml("pencil") + '</button>';
    }
    html += '</div>';
    // Badges row
    var badges = [];
    if (showAllProjects && rec.projectTitle) {
      badges.push('<span class="scheduler-task-badge project">' + esc(rec.projectTitle) + '</span>');
    }
    if (isRalph) badges.push('<span class="scheduler-task-badge ralph">Ralph</span>');
    if (isCrafting) badges.push('<span class="scheduler-task-badge crafting">Crafting</span>');
    else if (isScheduled && rec.enabled) badges.push('<span class="scheduler-task-badge scheduled">Scheduled</span>');
    if (badges.length > 0) {
      html += '<div class="scheduler-task-row">' + badges.join("") + '</div>';
    }
    html += '</div>';
  }
  if (sorted.length > 0) {
    html += '<div class="scheduler-drag-hint">' + iconHtml("arrow-right-to-line") + ' Drag task to calendar to schedule</div>';
  }
  sidebarListEl.innerHTML = html;

  // Attach click handlers
  var items = sidebarListEl.querySelectorAll(".scheduler-task-item");
  for (var i = 0; i < items.length; i++) {
    (function (item) {
      item.addEventListener("click", function () {
        var clickedId = item.dataset.recId;
        if (selectedTaskId === clickedId) {
          if (currentMode === "detail") {
            // Toggle: detail → crafting (if this task is being crafted) or calendar
            if (craftingTaskId === clickedId) {
              switchMode("crafting");
            } else {
              switchMode("calendar");
              renderSidebar();
            }
            return;
          } else if (currentMode === "crafting") {
            // Toggle: crafting → detail
            switchMode("detail");
            return;
          }
        }
        selectedTaskId = clickedId;
        updateSidebarSelection();
        switchMode("detail");
      });
    })(items[i]);
  }

  // Attach drag handlers for drag-to-calendar
  for (var i = 0; i < items.length; i++) {
    (function (item) {
      item.addEventListener("dragstart", function (e) {
        draggedTaskId = item.dataset.recId;
        draggedTaskName = item.dataset.recName;
        e.dataTransfer.setData("text/plain", draggedTaskId);
        e.dataTransfer.effectAllowed = "copy";
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", function () {
        draggedTaskId = null;
        draggedTaskName = null;
        item.classList.remove("dragging");
        // Clean up any lingering drag-over highlights
        var overs = document.querySelectorAll(".drag-over");
        for (var j = 0; j < overs.length; j++) overs[j].classList.remove("drag-over");
      });
    })(items[i]);
  }

  // Attach pencil edit handlers
  var editBtns = sidebarListEl.querySelectorAll(".scheduler-task-edit-btn");
  for (var i = 0; i < editBtns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var editId = btn.dataset.editId;
        var rec = null;
        for (var j = 0; j < records.length; j++) {
          if (records[j].id === editId) { rec = records[j]; break; }
        }
        if (!rec) return;
        var nameEl = btn.parentElement.querySelector(".scheduler-task-name");
        var original = rec.name || rec.id;
        var input = document.createElement("input");
        input.type = "text";
        input.className = "scheduler-task-name-input";
        input.value = original;
        nameEl.replaceWith(input);
        btn.classList.add("hidden");
        input.focus();
        input.select();

        function finishEdit() {
          var newName = input.value.trim();
          if (newName && newName !== original) {
            send({ type: "loop_registry_update", id: editId, data: { name: newName } });
          }
          renderSidebar();
        }
        input.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") { ev.preventDefault(); finishEdit(); }
          if (ev.key === "Escape") { ev.preventDefault(); renderSidebar(); }
        });
        input.addEventListener("blur", finishEdit);
      });
    })(editBtns[i]);
  }

  try { lucide.createIcons({ node: sidebarListEl }); } catch (e) {}
}

function updateSidebarSelection() {
  if (!sidebarListEl) return;
  var items = sidebarListEl.querySelectorAll(".scheduler-task-item");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle("selected", items[i].dataset.recId === selectedTaskId);
  }
}

// --- Detail view ---

function renderDetail() {
  if (!contentDetailEl || !selectedTaskId) return;
  var rec = null;
  for (var i = 0; i < records.length; i++) {
    if (records[i].id === selectedTaskId) { rec = records[i]; break; }
  }
  if (!rec) {
    // Task not found — fall back to calendar view
    selectedTaskId = null;
    switchMode("calendar");
    renderSidebar();
    render();
    return;
  }

  var isScheduled = !!rec.cron;
  var lastRun = rec.runs && rec.runs.length > 0 ? rec.runs[rec.runs.length - 1] : null;

  var isCraftingThis = craftingTaskId === rec.id;
  var hasSession = rec.craftingSessionId || null;

  var html = '<div class="scheduler-detail-header">';
  html += '<button class="scheduler-crafting-back" data-action="close" title="Back to tasks"><i data-lucide="arrow-left"></i></button>';
  html += '<span class="scheduler-detail-name">' + esc(rec.name || rec.id) + '</span>';
  html += '<div class="scheduler-detail-actions">';
  if (isCraftingThis || hasSession) {
    html += '<button class="scheduler-detail-btn" data-action="session">';
    html += '<i data-lucide="' + (isCraftingThis ? "radio" : "message-square") + '"></i> ';
    html += isCraftingThis ? "Live session" : "Session log";
    html += '</button>';
  }
  if (rec.source === "ralph") {
    html += '<button class="scheduler-detail-btn" data-action="convert" title="Convert to regular task"><i data-lucide="arrow-right-left"></i> To Task</button>';
  }
  html += '<button class="scheduler-detail-btn primary" data-action="run">Run now</button>';
  html += '<button class="scheduler-detail-icon-btn" data-action="delete" title="Delete task"><i data-lucide="trash-2"></i></button>';
  html += '</div>';
  html += '</div>';

  html += '<div class="scheduler-detail-tabs">';
  html += '<button class="scheduler-detail-tab active" data-tab="prompt">PROMPT.md</button>';
  html += '<button class="scheduler-detail-tab" data-tab="judge">JUDGE.md</button>';
  html += '<button class="scheduler-detail-tab" data-tab="model">Model</button>';
  html += '</div>';

  html += '<div class="scheduler-detail-body" id="scheduler-detail-body">';
  html += '<div class="scheduler-detail-loading">Loading...</div>';
  html += '</div>';

  contentDetailEl.innerHTML = html;

  // Bind action handlers
  var actionBtns = contentDetailEl.querySelectorAll("[data-action]");
  for (var i = 0; i < actionBtns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var action = btn.dataset.action;
        if (action === "run") {
          send({ type: "loop_registry_rerun", id: selectedTaskId });
        } else if (action === "delete") {
          if (confirm("Delete this task?")) {
            send({ type: "loop_registry_remove", id: selectedTaskId });
          }
        } else if (action === "close") {
          switchMode("calendar");
          renderSidebar();
        } else if (action === "convert") {
          send({ type: "loop_registry_convert", id: selectedTaskId });
        } else if (action === "session") {
          if (craftingTaskId === rec.id) {
            switchMode("crafting");
          } else if (rec.craftingSessionId) {
            logPreviousSessionId = ctx.activeSessionId || null;
            send({ type: "switch_session", id: rec.craftingSessionId });
            switchMode("crafting");
            var inputArea = document.getElementById("input-area");
            if (inputArea && contentCraftEl && contentCraftEl.contains(inputArea)) {
              inputArea.classList.add("hidden");
            }
          }
        }
      });
    })(actionBtns[i]);
  }

  // Bind tab switching
  var tabBtns = contentDetailEl.querySelectorAll(".scheduler-detail-tab");
  for (var i = 0; i < tabBtns.length; i++) {
    (function (tabBtn) {
      tabBtn.addEventListener("click", function () {
        for (var j = 0; j < tabBtns.length; j++) {
          tabBtns[j].classList.toggle("active", tabBtns[j] === tabBtn);
        }
        renderDetailBody(tabBtn.dataset.tab, rec);
      });
    })(tabBtns[i]);
  }

  // Request files for prompt tab (default)
  send({ type: "loop_registry_files", id: selectedTaskId });

  try { lucide.createIcons({ node: contentDetailEl }); } catch (e) {}
}

function renderDetailBody(tab, rec) {
  var bodyEl2 = document.getElementById("scheduler-detail-body");
  if (!bodyEl2) return;

  if (tab === "model") {
    renderModelTab(bodyEl2, rec);
    return;
  }

  // prompt or judge — request files from server
  bodyEl2.innerHTML = '<div class="scheduler-detail-loading">Loading...</div>';
  send({ type: "loop_registry_files", id: selectedTaskId });
}

function renderModelTab(bodyEl, rec) {
  var settings = lastLoopFiles.settings || {};
  var loopFilesId = rec.linkedTaskId || rec.id;

  bodyEl.innerHTML =
    '<div class="scheduler-model-settings">' +
      '<div class="settings-card"><div class="settings-field">' +
        '<label class="settings-label">Model</label>' +
        '<div class="settings-hint">Choose the Claude model for this task.</div>' +
        '<div id="ls-model-list" class="settings-model-list"></div>' +
      '</div></div>' +
      '<div class="settings-card"><div class="settings-field">' +
        '<label class="settings-label">Mode</label>' +
        '<div class="settings-hint">Controls how Claude handles tool use and file edits.</div>' +
        '<div id="ls-mode-list" class="settings-model-list"></div>' +
      '</div></div>' +
      '<div class="settings-card"><div class="settings-field">' +
        '<label class="settings-label">Effort</label>' +
        '<div class="settings-hint">Controls how much thinking effort Claude puts into responses.</div>' +
        '<div class="settings-btn-group" id="ls-effort-bar"></div>' +
      '</div></div>' +
      '<div class="settings-card"><div class="settings-field">' +
        '<label class="settings-label">Thinking</label>' +
        '<div class="settings-hint">Controls whether Claude shows its reasoning process.</div>' +
        '<div class="settings-btn-group" id="ls-thinking-bar"></div>' +
        '<div id="ls-thinking-budget-row" class="settings-budget-row" style="display:none">' +
          '<label class="settings-budget-label">Budget tokens</label>' +
          '<input id="ls-thinking-budget" type="number" class="settings-budget-input" min="1024" max="128000" step="1024" value="10000">' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function saveLoopSetting(key, value) {
    var updated = Object.assign({}, settings);
    updated[key] = value;
    settings = updated;
    send({ type: "loop_registry_save_files", id: loopFilesId, settings: updated });
  }

  var opts = {
    models: store.get('currentModels') || [],
    currentModel: settings.model || "",
    currentMode: settings.permissionMode || "default",
    currentEffort: settings.effort || "medium",
    currentThinking: settings.thinking || "adaptive",
    currentThinkingBudget: settings.thinkingBudget || 10000,
    sendMsg: function (msgType, data) {
      if (msgType === "set_model" || msgType === "loop_set_model") {
        saveLoopSetting("model", data.model);
      } else if (msgType === "loop_set_mode") {
        saveLoopSetting("permissionMode", data.mode);
      } else if (msgType === "loop_set_effort") {
        saveLoopSetting("effort", data.effort);
      } else if (msgType === "set_thinking") {
        saveLoopSetting("thinking", data.thinking);
        if (data.budgetTokens) saveLoopSetting("thinkingBudget", data.budgetTokens);
      }
    },
    modelMsgType: "loop_set_model",
    modeMsgType: "loop_set_mode",
    effortMsgType: "loop_set_effort",
  };

  renderModelList("ls", opts);
  renderModeList("ls", opts);
  renderEffortBar("ls", opts);
  renderThinkingBar("ls", opts);
}

// --- Chat reparenting ---

function reparentChat() {
  var messagesEl = document.getElementById("messages");
  var inputArea = document.getElementById("input-area");
  if (!messagesEl || !inputArea || !contentCraftEl) return;
  if (messagesOrigParent) return; // already reparented
  messagesOrigParent = messagesEl.parentNode;
  inputOrigNextSibling = inputArea.nextSibling;
  contentCraftEl.appendChild(messagesEl);
  contentCraftEl.appendChild(inputArea);
  messagesEl.classList.remove("hidden");
  inputArea.classList.remove("hidden");
}

function unparentChat() {
  var messagesEl = document.getElementById("messages");
  var inputArea = document.getElementById("input-area");
  if (!messagesOrigParent) return;
  var infoPanels = messagesOrigParent.querySelector("#info-panels");
  if (infoPanels) {
    messagesOrigParent.insertBefore(messagesEl, infoPanels);
  } else {
    messagesOrigParent.appendChild(messagesEl);
  }
  if (inputOrigNextSibling) {
    messagesOrigParent.insertBefore(inputArea, inputOrigNextSibling);
  } else {
    messagesOrigParent.appendChild(inputArea);
  }
  messagesOrigParent = null;
  inputOrigNextSibling = null;

  // Restore input-area visibility (may have been hidden in log mode)
  if (inputArea) inputArea.classList.remove("hidden");

  // Remove crafting header
  if (contentCraftEl) {
    var craftHdr = contentCraftEl.querySelector(".scheduler-crafting-header");
    if (craftHdr) craftHdr.remove();
  }

  // If we were in log mode, switch back to the original session
  if (logPreviousSessionId) {
    send({ type: "switch_session", id: logPreviousSessionId });
    logPreviousSessionId = null;
  }
}

// --- Navigation ---

function navigate(dir) {
  if (currentView === "month") {
    viewDate.setMonth(viewDate.getMonth() + dir);
  } else {
    viewDate.setDate(viewDate.getDate() + dir * 7);
  }
  render();
}

// --- Render ---

function render() {
  if (!bodyEl) return;
  updateMonthLabel();
  if (currentView === "month") {
    renderMonthView();
  } else {
    renderWeekView();
  }
}

function updateMonthLabel() {
  if (!monthLabel) return;
  if (currentView === "month") {
    monthLabel.textContent = MONTH_NAMES[viewDate.getMonth()] + " " + viewDate.getFullYear();
  } else {
    var weekStart = getWeekStart(viewDate);
    var weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    monthLabel.textContent = MONTH_NAMES[weekStart.getMonth()].substring(0, 3) + " " + weekStart.getDate() + " – " + MONTH_NAMES[weekEnd.getMonth()].substring(0, 3) + " " + weekEnd.getDate() + ", " + weekEnd.getFullYear();
  }
}

// --- Month View ---

function renderMonthView() {
  stopNowLineTimer();
  var year = viewDate.getFullYear();
  var month = viewDate.getMonth();
  var today = new Date();
  var todayStr = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());

  var firstDay = new Date(year, month, 1);
  var startDay = new Date(firstDay);
  startDay.setDate(startDay.getDate() - firstDay.getDay());

  var html = '<div class="scheduler-weekdays">';
  html += '<div class="scheduler-weekday scheduler-week-num-hdr"></div>';
  for (var d = 0; d < 7; d++) {
    var wkdCls = "scheduler-weekday" + (d === 0 || d === 6 ? " weekend" : "");
    html += '<div class="' + wkdCls + '">' + DAY_NAMES[d] + '</div>';
  }
  html += '</div><div class="scheduler-grid">';

  var cursor = new Date(startDay);
  for (var w = 0; w < 6; w++) {
    // Week number label
    var wn = getISOWeekNumber(cursor);
    html += '<div class="scheduler-week-num">W' + wn + '</div>';
    for (var d = 0; d < 7; d++) {
      var dateStr = cursor.getFullYear() + "-" + pad(cursor.getMonth() + 1) + "-" + pad(cursor.getDate());
      var isOther = cursor.getMonth() !== month;
      var isToday = dateStr === todayStr;
      var isPast = dateStr < todayStr;
      var isWeekend = d === 0 || d === 6;
      var cls = "scheduler-cell" + (isOther ? " other-month" : "") + (isToday ? " today" : "") + (isPast ? " past" : "") + (isWeekend ? " weekend" : "");
      html += '<div class="' + cls + '" data-date="' + dateStr + '">';
      var dayLabel = cursor.getDate() === 1
        ? MONTH_NAMES[cursor.getMonth()].substring(0, 3) + ", " + cursor.getDate()
        : String(cursor.getDate());
      html += '<div class="scheduler-day-num">' + dayLabel + '</div>';
      var events = getEventsForDate(cursor);
      for (var e = 0; e < events.length && e < 3; e++) {
        var ev = events[e];
        var evFullText = ev.timeStr + " " + ev.name;
        html += '<div class="scheduler-event ' + (ev.enabled ? "enabled" : "disabled") + '" data-rec-id="' + ev.id + '" data-tip="' + esc(evFullText) + '">';
        html += '<span class="scheduler-event-time">' + ev.timeStr + '</span> ' + esc(ev.name);
        html += '</div>';
      }
      if (events.length > 3) {
        html += '<div class="scheduler-event" style="opacity:0.6;font-size:10px">+' + (events.length - 3) + ' more</div>';
      }
      html += '</div>';
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  html += '</div>';
  bodyEl.innerHTML = html;
  attachEventClicks(bodyEl, ".scheduler-event[data-rec-id]");
  attachCellClicks(bodyEl);
}

// --- Week View ---

function renderWeekView() {
  var weekStart = getWeekStart(viewDate);
  var today = new Date();
  var todayStr = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());

  // Detect timezone abbreviation (prefer named like NZDT/KST/PDT, fallback to short)
  weekTzAbbr = "";
  try {
    // Try longGeneric first to extract abbreviation from toString()
    var tzStr = today.toLocaleTimeString("en", { timeZoneName: "short" });
    var tzMatch = tzStr.match(/[A-Z]{2,5}$/);
    if (tzMatch) {
      weekTzAbbr = tzMatch[0];
    } else {
      // Fallback: extract from Date.toString() which usually has e.g. "(New Zealand Daylight Time)"
      var dStr = today.toString();
      var parenMatch = dStr.match(/\((.+)\)/);
      if (parenMatch) {
        // Build abbreviation from first letters of each word
        var words = parenMatch[1].split(/\s+/);
        var abbr = "";
        for (var w = 0; w < words.length; w++) abbr += words[w].charAt(0);
        weekTzAbbr = abbr;
      }
    }
  } catch (e) {}

  // Header: timezone label + day columns
  var html = '<div class="scheduler-week-header">';
  html += '<div class="scheduler-week-tz-label">' + esc(weekTzAbbr) + '</div>';
  for (var d = 0; d < 7; d++) {
    var day = new Date(weekStart);
    day.setDate(day.getDate() + d);
    var dateStr = day.getFullYear() + "-" + pad(day.getMonth() + 1) + "-" + pad(day.getDate());
    var dayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.getDay()];
    html += '<div class="scheduler-week-header-cell' + (dateStr === todayStr ? ' today' : '') + '">';
    html += '<span class="wday">' + dayShort + '</span> ';
    html += '<span class="wdate">' + day.getDate() + '</span></div>';
  }
  html += '</div>';

  // Week body wrapper (for relative positioning of current-time indicator)
  html += '<div class="scheduler-week-body">';
  html += '<div class="scheduler-week-view">';

  // Time column
  html += '<div class="scheduler-week-time-col">';
  for (var h = 0; h < 24; h++) {
    html += '<div class="scheduler-week-time-label">' + (h === 0 ? "" : pad(h) + ":00") + '</div>';
  }
  html += '</div>';

  // Day columns with 4 sub-slots per hour (15-min)
  for (var d = 0; d < 7; d++) {
    var day = new Date(weekStart);
    day.setDate(day.getDate() + d);
    var dayDateStr = day.getFullYear() + "-" + pad(day.getMonth() + 1) + "-" + pad(day.getDate());
    html += '<div class="scheduler-week-day-col" data-date="' + dayDateStr + '">';
    for (var h = 0; h < 24; h++) {
      html += '<div class="scheduler-week-hour" data-date="' + dayDateStr + '" data-hour="' + h + '">';
      for (var q = 0; q < 4; q++) {
        html += '<div class="scheduler-week-slot" data-date="' + dayDateStr + '" data-hour="' + h + '" data-quarter="' + q + '"></div>';
      }
      html += '</div>';
    }
    // Events — detect overlaps and lay out side-by-side
    var events = getEventsForDate(day);
    var evDuration = 30; // assumed event duration in minutes for overlap detection
    // Assign overlap columns: greedy left-to-right
    // Sort by start time
    var sorted = events.slice().sort(function (a, b) {
      return (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute);
    });
    // Build overlap groups
    var colAssign = {}; // ev.id -> { col, totalCols }
    var groups = []; // array of arrays of event indices sharing overlap
    for (var e = 0; e < sorted.length; e++) {
      var ev = sorted[e];
      var evStart = ev.hour * 60 + ev.minute;
      var evEnd = evStart + evDuration;
      // Find which group this event overlaps with
      var placed = false;
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var overlaps = false;
        for (var gi = 0; gi < grp.length; gi++) {
          var other = grp[gi];
          var oStart = other.hour * 60 + other.minute;
          var oEnd = oStart + evDuration;
          if (evStart < oEnd && evEnd > oStart) { overlaps = true; break; }
        }
        if (overlaps) { grp.push(ev); placed = true; break; }
      }
      if (!placed) groups.push([ev]);
    }
    // Assign columns within each group
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      for (var gi = 0; gi < grp.length; gi++) {
        colAssign[grp[gi].id] = { col: gi, totalCols: grp.length };
      }
    }
    for (var e = 0; e < events.length; e++) {
      var ev = events[e];
      if (ev.intervalBadge) {
        var badgeStyle = "";
        if (ev.color) badgeStyle = "background:" + ev.color;
        var weekIntFullText = ev.timeStr + " " + ev.name;
        html += '<div class="scheduler-week-event interval-badge ' + (ev.enabled ? "enabled" : "disabled") + '" data-rec-id="' + ev.id + '" data-tip="' + esc(weekIntFullText) + '" style="position:relative;top:0;left:0;width:85%;height:auto;' + badgeStyle + '">';
        html += '<span class="scheduler-week-event-time">' + esc(ev.timeStr) + '</span>';
        html += '<span class="scheduler-week-event-title">' + esc(ev.name) + '</span>';
        html += '</div>';
        continue;
      }
      var topPct = ((ev.hour * 60 + ev.minute) / 1440) * 100;
      var evColor = ev.color || "";
      var assign = colAssign[ev.id] || { col: 0, totalCols: 1 };
      var rightMargin = 15; // percentage reserved for "add new" click area
      var usableWidth = 100 - rightMargin;
      var colWidth = usableWidth / assign.totalCols;
      var leftPct = assign.col * colWidth;
      var evStyle = "top:" + topPct + "%;height:calc(160vh / 48)";
      evStyle += ";left:" + leftPct + "%;width:" + (colWidth - 1) + "%";
      if (evColor) evStyle += ";background:" + evColor;
      var weekEvFullText = ev.timeStr + " " + ev.name;
      html += '<div class="scheduler-week-event ' + (ev.enabled ? "enabled" : "disabled") + '" data-rec-id="' + ev.id + '" data-tip="' + esc(weekEvFullText) + '" style="' + evStyle + '">';
      html += '<span class="scheduler-week-event-title">' + esc(ev.name) + '</span>';
      html += '<span class="scheduler-week-event-time">' + ev.timeStr + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }
  // Current time indicator — per-column segments (past=dim, today=bright, future=hidden)
  var nowMinutes = today.getHours() * 60 + today.getMinutes();
  var nowPct = (nowMinutes / 1440) * 100;
  var todayDayIdx = -1;
  for (var d = 0; d < 7; d++) {
    var chk = new Date(weekStart);
    chk.setDate(chk.getDate() + d);
    var chkStr = chk.getFullYear() + "-" + pad(chk.getMonth() + 1) + "-" + pad(chk.getDate());
    if (chkStr === todayStr) { todayDayIdx = d; break; }
  }
  html += '<div class="scheduler-week-now-line" style="top:' + nowPct + '%">';
  html += '<span class="scheduler-week-now-label">' + pad(today.getHours()) + ':' + pad(today.getMinutes()) + '</span>';
  for (var d = 0; d < 7; d++) {
    var segCls = "now-seg";
    if (d < todayDayIdx) segCls += " past";
    else if (d === todayDayIdx) segCls += " today";
    else segCls += " future";
    html += '<div class="' + segCls + '"></div>';
  }
  html += '</div>';

  html += '</div>'; // .scheduler-week-view
  html += '</div>'; // .scheduler-week-body

  // Task count footer
  html += '<div class="scheduler-week-footer">';
  html += '<div class="scheduler-week-footer-tz"></div>';
  for (var d = 0; d < 7; d++) {
    var day = new Date(weekStart);
    day.setDate(day.getDate() + d);
    var dayEvents = getEventsForDate(day);
    var taskCount = dayEvents.length;
    html += '<div class="scheduler-week-footer-cell">';
    if (taskCount > 0) html += '<span class="scheduler-week-task-badge">' + taskCount + (taskCount === 1 ? ' Task' : ' Tasks') + '</span>';
    html += '</div>';
  }
  html += '</div>';

  bodyEl.innerHTML = html;

  // Scroll to current time area
  var weekBody = bodyEl.querySelector(".scheduler-week-body");
  if (weekBody) {
    var hourH = weekBody.scrollHeight / 24;
    weekBody.scrollTop = Math.max(0, today.getHours() - 2) * hourH;
  }

  attachEventClicks(bodyEl, ".scheduler-week-event[data-rec-id]");
  attachWeekSlotClicks(bodyEl);
  attachWeekHoverTooltip(bodyEl);
  startNowLineTimer();
}

function startNowLineTimer() {
  if (nowLineTimer) clearInterval(nowLineTimer);
  nowLineTimer = setInterval(updateNowLine, 30000); // every 30s
}

function stopNowLineTimer() {
  if (nowLineTimer) { clearInterval(nowLineTimer); nowLineTimer = null; }
}

function updateNowLine() {
  if (!bodyEl) return;
  var line = bodyEl.querySelector(".scheduler-week-now-line");
  if (!line) return;
  var now = new Date();
  var mins = now.getHours() * 60 + now.getMinutes();
  var pct = (mins / 1440) * 100;
  line.style.top = pct + "%";
  var label = line.querySelector(".scheduler-week-now-label");
  if (label) label.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes());
}

function attachWeekHoverTooltip(container) {
  var tooltip = document.createElement("div");
  tooltip.className = "scheduler-week-tooltip hidden";
  container.appendChild(tooltip);

  var dayCols = container.querySelectorAll(".scheduler-week-day-col");
  for (var i = 0; i < dayCols.length; i++) {
    (function (col) {
      col.addEventListener("mousemove", function (e) {
        var rect = col.getBoundingClientRect();
        // e.clientY - rect.top gives position within the full column (rect reflects scroll offset)
        var relY = e.clientY - rect.top;
        var colH = rect.height;
        var totalMin = (relY / colH) * 1440;
        var snapped = Math.floor(totalMin / 15) * 15;
        if (snapped < 0) snapped = 0;
        if (snapped >= 1440) snapped = 1425;
        var hh = Math.floor(snapped / 60);
        var mm = snapped % 60;
        tooltip.textContent = pad(hh) + ":" + pad(mm) + " " + weekTzAbbr;
        // Position tooltip near cursor
        var bodyRect = container.querySelector(".scheduler-week-body").getBoundingClientRect();
        tooltip.style.left = (e.clientX - bodyRect.left + 12) + "px";
        tooltip.style.top = (e.clientY - bodyRect.top - 14) + "px";
        tooltip.classList.remove("hidden");
      });
      col.addEventListener("mouseleave", function () {
        tooltip.classList.add("hidden");
      });
    })(dayCols[i]);
  }
}

// --- Events for calendar ---

function getEventsForDate(date) {
  var results = [];
  var dow = date.getDay();
  var dom = date.getDate();
  var month = date.getMonth() + 1;
  var dateStr = date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());

  var visibleRecords = filterByProject(records);
  for (var i = 0; i < visibleRecords.length; i++) {
    var r = visibleRecords[i];

    // One-off schedule (no cron) with a specific date
    if (!r.cron && r.date) {
      if (r.date === dateStr) {
        var evHour = 0;
        var evMinute = 0;
        if (r.time) {
          var tp = r.time.split(":");
          evHour = parseInt(tp[0], 10) || 0;
          evMinute = parseInt(tp[1], 10) || 0;
        }
        results.push({
          id: r.id, name: r.name, enabled: true,
          hour: evHour, minute: evMinute,
          timeStr: r.allDay ? "All day" : pad(evHour) + ":" + pad(evMinute),
          allDay: r.allDay || false,
          color: r.color || null,
          source: r.source || null,
        });
      }
      continue;
    }

    if (!r.cron) continue; // skip non-scheduled without date
    var parsed = parseCronSimple(r.cron);
    if (!parsed) continue;
    // Skip occurrences before the schedule's start date
    if (r.date) {
      var sp = r.date.split("-");
      var startDate = new Date(parseInt(sp[0], 10), parseInt(sp[1], 10) - 1, parseInt(sp[2], 10));
      startDate.setHours(0, 0, 0, 0);
      var checkDate = new Date(date);
      checkDate.setHours(0, 0, 0, 0);
      if (checkDate < startDate) continue;
    }
    // Skip occurrences after the recurrence end date
    if (r.recurrenceEnd && r.recurrenceEnd.type === "until" && r.recurrenceEnd.date) {
      var ep = r.recurrenceEnd.date.split("-");
      var endDate = new Date(parseInt(ep[0], 10), parseInt(ep[1], 10) - 1, parseInt(ep[2], 10));
      endDate.setHours(23, 59, 59, 999);
      var checkDate2 = new Date(date);
      checkDate2.setHours(0, 0, 0, 0);
      if (checkDate2 > endDate) continue;
    }
    if (parsed.months.indexOf(month) === -1) continue;
    if (parsed.daysOfMonth.indexOf(dom) === -1) continue;
    if (parsed.daysOfWeek.indexOf(dow) === -1) continue;
    // Detect sub-daily interval mode to prevent calendar item explosion
    var cronParts = r.cron.trim().split(/\s+/);
    var isIntervalMode = (cronParts[0].indexOf("/") !== -1 && cronParts[1] === "*")
                      || (cronParts[1].indexOf("/") !== -1)
                      || (parsed.minutes.length * parsed.hours.length > 24);
    if (isIntervalMode) {
      results.push({
        id: r.id, name: r.name, enabled: r.enabled,
        hour: 0, minute: 0,
        timeStr: (r.time || "00:00") + " " + (cronToHuman(r.cron) || "Interval"),
        allDay: true,
        intervalBadge: true,
        color: r.color || null,
        source: r.source || null,
      });
    } else {
      for (var h = 0; h < parsed.hours.length; h++) {
        for (var m = 0; m < parsed.minutes.length; m++) {
          results.push({
            id: r.id, name: r.name, enabled: r.enabled,
            hour: parsed.hours[h], minute: parsed.minutes[m],
            timeStr: pad(parsed.hours[h]) + ":" + pad(parsed.minutes[m]),
            color: r.color || null,
            source: r.source || null,
          });
        }
      }
    }
  }
  results.sort(function (a, b) { return a.hour * 60 + a.minute - (b.hour * 60 + b.minute); });
  return results;
}

// --- Popover ---

function showPopover(recId, anchorEl) {
  var rec = null;
  for (var i = 0; i < records.length; i++) {
    if (records[i].id === recId) { rec = records[i]; break; }
  }
  if (!rec || !popoverEl) return;

  var nextStr = rec.nextRunAt ? formatDateTime(new Date(rec.nextRunAt)) : "—";
  var lastStr = rec.lastRunAt ? formatDateTime(new Date(rec.lastRunAt)) : "Never";

  var html = '<div class="schedule-popover-name">' + esc(rec.name) + '</div>';
  html += '<div class="schedule-popover-meta">Next: <strong>' + nextStr + '</strong></div>';
  html += '<div class="schedule-popover-meta">Last: <strong>' + lastStr + '</strong></div>';
  if (rec.lastRunResult) {
    html += '<div class="schedule-popover-result ' + (rec.lastRunResult === "pass" ? "pass" : "fail") + '">' + rec.lastRunResult + '</div>';
  }
  html += '<div class="schedule-popover-meta">' + cronToHuman(rec.cron) + '</div>';
  html += '<div class="schedule-popover-actions">';
  html += '<button class="schedule-popover-btn" data-action="edit" data-id="' + rec.id + '">Edit</button>';
  html += '<button class="schedule-popover-btn" data-action="toggle" data-id="' + rec.id + '">' + (rec.enabled ? "Pause" : "Enable") + '</button>';
  html += '<button class="schedule-popover-btn" data-action="rerun" data-id="' + rec.id + '">Re-run</button>';
  html += '<button class="schedule-popover-btn" data-action="move" data-id="' + rec.id + '">Move to\u2026</button>';
  html += '<button class="schedule-popover-btn danger" data-action="delete" data-id="' + rec.id + '">Delete</button>';
  html += '</div>';

  popoverEl.innerHTML = html;
  popoverEl.classList.remove("hidden");

  var rect = anchorEl.getBoundingClientRect();
  var left = Math.max(8, Math.min(rect.left, window.innerWidth - 268));
  var top = rect.bottom + 6;
  if (top + 200 > window.innerHeight) top = rect.top - 200;
  popoverEl.style.left = left + "px";
  popoverEl.style.top = top + "px";

  var btns = popoverEl.querySelectorAll(".schedule-popover-btn");
  for (var i = 0; i < btns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var action = btn.dataset.action;
        var id = btn.dataset.id;
        popoverEl.classList.add("hidden");
        if (action === "edit") {
          var rec = null;
          for (var ri = 0; ri < records.length; ri++) {
            if (records[ri].id === id) { rec = records[ri]; break; }
          }
          if (rec) openCreateModalWithRecord(rec, btn);
        }
        else if (action === "toggle") send({ type: "loop_registry_toggle", id: id });
        else if (action === "rerun") send({ type: "loop_registry_rerun", id: id });
        else if (action === "move") showMovePopover(id, btn);
        else if (action === "delete" && confirm("Delete this schedule?")) send({ type: "loop_registry_remove", id: id });
      });
    })(btns[i]);
  }
}

// --- Move task to another project ---

function getAvailableProjects(excludeSlug) {
  var seen = {};
  var result = [];
  // First use the project list from the app context (most reliable)
  if (ctx && typeof ctx.getProjects === "function") {
    var projects = ctx.getProjects();
    for (var p = 0; p < projects.length; p++) {
      var proj = projects[p];
      if (proj.slug && proj.slug !== excludeSlug && !seen[proj.slug]) {
        seen[proj.slug] = true;
        result.push({ slug: proj.slug, title: proj.title || proj.project || proj.slug });
      }
    }
  }
  // Fallback: extract from records
  if (result.length === 0) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.projectSlug && !seen[r.projectSlug] && r.projectSlug !== excludeSlug) {
        seen[r.projectSlug] = true;
        result.push({ slug: r.projectSlug, title: r.projectTitle || r.projectSlug });
      }
    }
  }
  return result;
}

function showMovePopover(recId, anchorEl) {
  var rec = null;
  for (var i = 0; i < records.length; i++) {
    if (records[i].id === recId) { rec = records[i]; break; }
  }
  if (!rec || !popoverEl) return;

  var projects = getAvailableProjects(rec.projectSlug);
  if (projects.length === 0) {
    popoverEl.innerHTML = '<div class="schedule-popover-name">No other projects available</div>';
    popoverEl.classList.remove("hidden");
    var r2 = anchorEl.getBoundingClientRect();
    popoverEl.style.left = Math.max(8, r2.left) + "px";
    popoverEl.style.top = (r2.bottom + 6) + "px";
    return;
  }

  var html = '<div class="schedule-popover-name">Move "' + esc(rec.name) + '" to:</div>';
  html += '<div class="schedule-popover-actions schedule-move-list">';
  for (var p = 0; p < projects.length; p++) {
    html += '<button class="schedule-popover-btn" data-action="move-to" data-slug="' + esc(projects[p].slug) + '">' + esc(projects[p].title) + '</button>';
  }
  html += '</div>';

  popoverEl.innerHTML = html;
  popoverEl.classList.remove("hidden");

  var rect = anchorEl.getBoundingClientRect();
  popoverEl.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 268)) + "px";
  popoverEl.style.top = (rect.bottom + 6) + "px";

  var btns = popoverEl.querySelectorAll('[data-action="move-to"]');
  for (var b = 0; b < btns.length; b++) {
    (function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        popoverEl.classList.add("hidden");
        send({
          type: "schedule_move",
          recordId: recId,
          fromSlug: rec.projectSlug || currentProjectSlug,
          toSlug: btn.dataset.slug,
        });
      });
    })(btns[b]);
  }
}

function attachEventClicks(container, selector) {
  var els = container.querySelectorAll(selector);
  for (var i = 0; i < els.length; i++) {
    (function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        var recId = el.dataset.recId;
        var rec = null;
        for (var j = 0; j < records.length; j++) {
          if (records[j].id === recId) { rec = records[j]; break; }
        }
        if (!rec) return;
        // Schedule-source records: open create popover with pre-filled values
        if (rec.source === "schedule") {
          openCreateModalWithRecord(rec, el);
          return;
        }
        // Other records: go to detail view
        selectedTaskId = recId;
        updateSidebarSelection();
        switchMode("detail");
      });
    })(els[i]);
  }
}

// --- Public API ---

export function openSchedulerToTab(tab) {
  if (!panelOpen) openScheduler();
  if (tab === "library" || tab === "tasks") {
    // Just open, sidebar already shows tasks
  } else {
    switchMode("calendar");
  }
}

export function openHomeScheduler() {
  if (!ctx) return;
  ctx.requireClayRalph(function () {
    showAllProjects = true;
    openSchedulerToTab("calendar");
    renderSidebar();
    render();
  });
}

export function isSchedulerOpen() {
  return panelOpen;
}

export function enterCraftingMode(sessionId, taskId) {
  craftingSessionId = sessionId || null;
  craftingTaskId = taskId || null;
  // Remember the current session so we can restore it when crafting ends
  if (!logPreviousSessionId && ctx && ctx.activeSessionId && ctx.activeSessionId !== sessionId) {
    logPreviousSessionId = ctx.activeSessionId;
  }
  if (!panelOpen) openScheduler();
  if (taskId) {
    selectedTaskId = taskId;
    renderSidebar();
  }
  switchMode("crafting");
}

export function exitCraftingMode(taskId) {
  if (!panelOpen || currentMode !== "crafting") return;
  craftingTaskId = null;
  if (taskId) {
    selectedTaskId = taskId;
    switchMode("detail");
    renderSidebar();
  } else {
    switchMode("calendar");
  }
}

// Expose upcoming schedules (within given ms window) for countdown display
// Always filters to current project only (countdown is project-specific)
export function getUpcomingSchedules(windowMs) {
  var now = Date.now();
  var result = [];
  var filtered = filterByProject(records);
  for (var i = 0; i < filtered.length; i++) {
    var r = filtered[i];
    if (!r.enabled || !r.nextRunAt) continue;
    var diff = r.nextRunAt - now;
    if (diff > 0 && diff <= windowMs) {
      result.push({ id: r.id, name: r.name, nextRunAt: r.nextRunAt, color: r.color || "" });
    }
  }
  return result;
}

// --- Cell click → open create modal ---

function attachCellClicks(container) {
  var cells = container.querySelectorAll(".scheduler-cell[data-date]");
  for (var i = 0; i < cells.length; i++) {
    (function (cell) {
      cell.addEventListener("click", function (e) {
        // Don't open create if user clicked on an event
        if (e.target.closest(".scheduler-event")) return;
        var parts = cell.dataset.date.split("-");
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        // Block creating tasks on past dates
        var now = new Date();
        var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (d < todayStart) {
          showToast("Cannot schedule a task in the past", "error");
          return;
        }
        openCreateModal(d, null, cell);
      });
      cell.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        cell.classList.add("drag-over");
        if (!getPreviewEl() || getPreviewEl().parentNode !== cell) {
          showPreviewOnCell(cell);
        }
      });
      cell.addEventListener("dragleave", function (e) {
        if (cell.contains(e.relatedTarget)) return;
        cell.classList.remove("drag-over");
        removePreview();
      });
      cell.addEventListener("drop", function (e) {
        e.preventDefault();
        cell.classList.remove("drag-over");
        removePreview();
        var parts = cell.dataset.date.split("-");
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var now = new Date();
        var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (d < todayStart) {
          showToast("Cannot schedule a task in the past", "error");
          return;
        }
        openCreateModal(d, null, cell);
        applyDraggedTask();
      });
    })(cells[i]);
  }
}

function attachWeekSlotClicks(container) {
  var slots = container.querySelectorAll(".scheduler-week-slot[data-date]");
  for (var i = 0; i < slots.length; i++) {
    (function (slot) {
      slot.addEventListener("click", function (e) {
        if (e.target.closest(".scheduler-week-event")) return;
        var parts = slot.dataset.date.split("-");
        var hour = parseInt(slot.dataset.hour, 10);
        var quarter = parseInt(slot.dataset.quarter || "0", 10);
        var minute = quarter * 15;
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), hour, minute, 0);
        // Block creating tasks in the past
        if (d < new Date()) {
          showToast("Cannot schedule a task in the past", "error");
          return;
        }
        openCreateModal(d, hour, slot);
      });
      slot.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        slot.classList.add("drag-over");
        if (!getPreviewEl() || !slot.closest(".scheduler-week-day-col").contains(getPreviewEl())) {
          showPreviewOnSlot(slot);
        }
      });
      slot.addEventListener("dragleave", function (e) {
        if (slot.contains(e.relatedTarget)) return;
        slot.classList.remove("drag-over");
        removePreview();
      });
      slot.addEventListener("drop", function (e) {
        e.preventDefault();
        slot.classList.remove("drag-over");
        removePreview();
        var parts = slot.dataset.date.split("-");
        var hour = parseInt(slot.dataset.hour, 10);
        var quarter = parseInt(slot.dataset.quarter || "0", 10);
        var minute = quarter * 15;
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), hour, minute, 0);
        if (d < new Date()) {
          showToast("Cannot schedule a task in the past", "error");
          return;
        }
        openCreateModal(d, hour, slot);
        applyDraggedTask();
      });
    })(slots[i]);
  }
}

// --- Utility ---

function getISOWeekNumber(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function getWeekStart(date) {
  var d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function pad(n) { return n < 10 ? "0" + n : String(n); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function formatDateTime(d) {
  return MONTH_NAMES[d.getMonth()].substring(0, 3) + " " + d.getDate() + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function cronToHuman(cron) {
  if (!cron) return "";
  var parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  // Minute interval patterns (e.g. */5 * * * * or 0,15,30,45 * * * *)
  if (parts[1] === "*" && parts[2] === "*") {
    var minStep = detectInterval(parts[0], 60);
    if (minStep) return minStep === 1 ? "Every minute" : "Every " + minStep + " minutes";
  }
  // Hour interval patterns (e.g. 0 */2 * * * or 0 1,5,9,13,17,21 * * *)
  if (parts[2] === "*") {
    var hrStep = detectInterval(parts[1], 24);
    if (hrStep) return hrStep === 1 ? "Every hour" : "Every " + hrStep + " hours";
  }
  var t = pad(parseInt(parts[1], 10)) + ":" + pad(parseInt(parts[0], 10));
  var dow = parts[4], dom = parts[2];
  if (dow === "*" && dom === "*") return "Every day at " + t;
  if (dow === "1-5" && dom === "*") return "Weekdays at " + t;
  if (dom !== "*" && dow === "*") return "Monthly on day " + dom + " at " + t;
  if (dow !== "*" && dom === "*") {
    var ds = dow.split(",").map(function (d) { return DAY_NAMES[parseInt(d, 10)] || d; });
    return "Every " + ds.join(", ") + " at " + t;
  }
  return cron;
}

// Detect if a cron field represents an evenly-spaced interval (*/N or comma-separated offset list)
function detectInterval(field, max) {
  if (field.indexOf("/") !== -1) return parseInt(field.split("/")[1], 10) || null;
  if (field.indexOf(",") === -1) return null;
  var vals = field.split(",").map(function (v) { return parseInt(v, 10); }).sort(function (a, b) { return a - b; });
  if (vals.length < 2) return null;
  var step = vals[1] - vals[0];
  if (step <= 0) return null;
  // Verify all values are evenly spaced (wrapping around max)
  for (var i = 1; i < vals.length; i++) {
    if (vals[i] - vals[i - 1] !== step) return null;
  }
  // Check the wrap-around gap matches too
  if ((max - vals[vals.length - 1] + vals[0]) !== step) return null;
  return step;
}
