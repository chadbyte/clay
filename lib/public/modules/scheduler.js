/**
 * Scheduler module — Split-panel layout: sidebar (task list) + content area.
 *
 * Modes: calendar (month/week grid), detail (single task view), crafting (reparented chat).
 * Edit modal: change cron/name/enabled for existing records.
 */

import { renderMarkdown } from './markdown.js';
import { iconHtml } from './icons.js';

var ctx = null;
var records = []; // all loop registry records

// Calendar state
var currentView = "month";
var viewDate = new Date();

// Mode state
var currentMode = "calendar";     // "calendar" | "detail" | "crafting"
var selectedTaskId = null;
var showRalphTasks = false;        // toggle: show ralph-source tasks in sidebar
var draggedTaskId = null;          // drag-and-drop: task ID being dragged
var draggedTaskName = null;        // drag-and-drop: task name being dragged
var previewEl = null;              // temporary preview event element on calendar
var craftingTaskId = null;         // task ID currently being crafted
var craftingSessionId = null;      // session ID used for crafting
var logPreviousSessionId = null;   // session to restore when leaving log mode

// DOM refs
var panel = null;    // #scheduler-panel
var bodyEl = null;
var monthLabel = null;
var calHeader = null;
var editModal = null;
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
var editingId = null;

// Create popover state
var createEditingRecId = null;     // non-null when editing existing schedule
var createPopover = null;
var createSelectedDate = null;    // Date object for clicked calendar date
var createRecurrence = "none";    // current recurrence selection
var createCustomConfirmed = false; // whether custom repeat was confirmed via OK
var createColor = "#ffb86c";       // selected event color (default: accent)
var createEndType = "never";       // "never" | "until" | "after"
var createEndDate = null;          // Date for "until" end type
var createEndCalMonth = null;      // Date tracking displayed month in end calendar
var createEndAfter = 10;           // occurrence count for "after" end type
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
  editModal = document.getElementById("schedule-edit-modal");
  createPopover = document.getElementById("schedule-create-popover");
  popoverEl = document.getElementById("schedule-popover");

  // Sidebar button
  var btn = document.getElementById("scheduler-btn");
  if (btn) {
    btn.addEventListener("click", function () {
      if (panelOpen) {
        closeScheduler();
      } else {
        openScheduler();
      }
    });
  }

  // Edit modal
  setupEditModal();

  // Create modal
  setupCreateModal();

  // Close popover on outside click
  document.addEventListener("click", function (e) {
    if (popoverEl && !popoverEl.classList.contains("hidden") && !popoverEl.contains(e.target)) {
      popoverEl.classList.add("hidden");
    }
  });
}

function ensurePanel() {
  if (panel) return;

  var appEl = document.getElementById("app");
  if (!appEl) return;

  panel = document.createElement("div");
  panel.id = "scheduler-panel";
  panel.className = "hidden";

  // --- Top header bar ---
  var topBar = document.createElement("div");
  topBar.className = "scheduler-top-bar";
  topBar.innerHTML =
    '<span class="scheduler-top-title">Scheduled Tasks</span>' +
    '<button class="scheduler-close-btn" id="scheduler-panel-close" title="Close"><i data-lucide="x"></i></button>';
  panel.appendChild(topBar);

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

  // Inline add task
  var addRow = document.createElement("div");
  addRow.className = "scheduler-add-row";
  addRow.innerHTML =
    '<div class="scheduler-add-trigger" id="scheduler-add-trigger">' +
      '<i data-lucide="plus-circle"></i> <span>Add new task</span>' +
    '</div>' +
    '<div class="scheduler-add-form hidden" id="scheduler-add-form">' +
      '<textarea id="scheduler-add-input" rows="2" placeholder="Describe what to build..."></textarea>' +
      '<div class="scheduler-add-actions">' +
        '<button type="button" class="scheduler-add-submit" id="scheduler-add-submit">Add</button>' +
        '<button type="button" class="scheduler-add-cancel" id="scheduler-add-cancel">Cancel</button>' +
      '</div>' +
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

  appEl.appendChild(panel);

  // --- Close button (in top bar) ---
  panel.querySelector("#scheduler-panel-close").addEventListener("click", function () {
    closeScheduler();
  });

  // Inline add task
  var addTrigger = addRow.querySelector("#scheduler-add-trigger");
  var addForm = addRow.querySelector("#scheduler-add-form");
  var addInput = addRow.querySelector("#scheduler-add-input");
  var addSubmitBtn = addRow.querySelector("#scheduler-add-submit");
  var addCancelBtn = addRow.querySelector("#scheduler-add-cancel");

  addTrigger.addEventListener("click", function () {
    addTrigger.classList.add("hidden");
    addForm.classList.remove("hidden");
    addInput.value = "";
    addInput.focus();
  });

  addCancelBtn.addEventListener("click", function () {
    addForm.classList.add("hidden");
    addTrigger.classList.remove("hidden");
  });

  addInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitInlineTask();
    }
    if (e.key === "Escape") {
      addForm.classList.add("hidden");
      addTrigger.classList.remove("hidden");
    }
  });

  addSubmitBtn.addEventListener("click", function () {
    submitInlineTask();
  });

  var addSubmitting = false;
  function submitInlineTask() {
    if (addSubmitting) return;
    var task = addInput.value.trim();
    if (!task) { addInput.focus(); return; }
    addSubmitting = true;
    addInput.value = "";
    addForm.classList.add("hidden");
    addTrigger.classList.remove("hidden");
    // Send wizard complete directly (skip modal)
    send({
      type: "ralph_wizard_complete",
      data: { name: task, task: task, maxIterations: 3, cron: null, source: "task" }
    });
    setTimeout(function () { addSubmitting = false; }, 1000);
  }

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
}

export function closeScheduler() {
  if (!panelOpen) return;
  panelOpen = false;
  stopNowLineTimer();
  if (currentMode === "crafting") unparentChat();

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
}

function send(msg) {
  if (ctx && ctx.ws && ctx.ws.readyState === 1) {
    ctx.ws.send(JSON.stringify(msg));
  }
}

// --- Sidebar ---

function renderSidebar() {
  if (!sidebarListEl) return;

  // Update count badge (exclude ralph and schedule items from count)
  var taskRecords = records.filter(function (r) { return r.source !== "ralph" && r.source !== "schedule"; });
  var ralphRecords = records.filter(function (r) { return r.source === "ralph"; });
  var countEl = panel ? panel.querySelector(".scheduler-sidebar-count") : null;
  if (countEl) countEl.textContent = showRalphTasks ? (taskRecords.length + ralphRecords.length) : taskRecords.length;

  // Update toggle badge
  var toggleBtn = panel ? panel.querySelector("#scheduler-ralph-toggle") : null;
  if (toggleBtn) {
    toggleBtn.classList.toggle("has-items", ralphRecords.length > 0);
    toggleBtn.classList.toggle("active", showRalphTasks);
  }

  var filtered = showRalphTasks
    ? records.filter(function (r) { return r.source !== "schedule"; })
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

    html += '<div class="scheduler-task-item' + selected + '" data-rec-id="' + rec.id + '" data-rec-name="' + esc(rec.name || rec.id) + '" draggable="true">';
    html += '<div class="scheduler-task-name-row">';
    html += '<span class="scheduler-task-drag-handle" title="Drag to calendar">' + iconHtml("grip-vertical") + '</span>';
    html += '<div class="scheduler-task-name">' + esc(rec.name || rec.id) + '</div>';
    if (!isCrafting) {
      html += '<button class="scheduler-task-edit-btn" data-edit-id="' + rec.id + '" type="button" title="Rename">' + iconHtml("pencil") + '</button>';
    }
    html += '</div>';
    // Badges row
    var badges = [];
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
  html += '<button class="scheduler-detail-tab" data-tab="meta">Info</button>';
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

  if (tab === "meta") {
    var isScheduled = !!rec.cron;
    var lastRun = rec.runs && rec.runs.length > 0 ? rec.runs[rec.runs.length - 1] : null;
    var scheduleStr = isScheduled ? cronToHuman(rec.cron) : "One-off";
    var statusStr = isScheduled ? (rec.enabled ? "Enabled" : "Paused") : "One-off";
    var createdStr = rec.createdAt ? formatDateTime(new Date(rec.createdAt)) : "—";
    var lastRunStr = "Never";
    if (lastRun) {
      var resultStr = lastRun.result || "?";
      var iterStr = (lastRun.iterations || 0) + " iter";
      lastRunStr = formatDateTime(new Date(lastRun.finishedAt || lastRun.startedAt)) + " — " + resultStr + " (" + iterStr + ")";
    }

    var html = '<div class="scheduler-detail-meta">';
    html += '<span class="scheduler-detail-meta-label">Schedule</span>';
    html += '<span class="scheduler-detail-meta-value">' + esc(scheduleStr) + '</span>';
    html += '<span class="scheduler-detail-meta-label">Status</span>';
    html += '<span class="scheduler-detail-meta-value">' + esc(statusStr) + '</span>';
    html += '<span class="scheduler-detail-meta-label">Max Iterations</span>';
    html += '<span class="scheduler-detail-meta-value">' + (rec.maxIterations || "—") + '</span>';
    html += '<span class="scheduler-detail-meta-label">Created</span>';
    html += '<span class="scheduler-detail-meta-value">' + esc(createdStr) + '</span>';
    html += '<span class="scheduler-detail-meta-label">Last Run</span>';
    html += '<span class="scheduler-detail-meta-value">' + esc(lastRunStr) + '</span>';
    html += '</div>';
    bodyEl2.innerHTML = html;
  } else {
    // prompt or judge — request files from server
    bodyEl2.innerHTML = '<div class="scheduler-detail-loading">Loading...</div>';
    send({ type: "loop_registry_files", id: selectedTaskId });
  }
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
      var isWeekend = d === 0 || d === 6;
      var cls = "scheduler-cell" + (isOther ? " other-month" : "") + (isToday ? " today" : "") + (isWeekend ? " weekend" : "");
      html += '<div class="' + cls + '" data-date="' + dateStr + '">';
      var dayLabel = cursor.getDate() === 1
        ? MONTH_NAMES[cursor.getMonth()].substring(0, 3) + ", " + cursor.getDate()
        : String(cursor.getDate());
      html += '<div class="scheduler-day-num">' + dayLabel + '</div>';
      var events = getEventsForDate(cursor);
      for (var e = 0; e < events.length && e < 3; e++) {
        var ev = events[e];
        html += '<div class="scheduler-event ' + (ev.enabled ? "enabled" : "disabled") + '" data-rec-id="' + ev.id + '">';
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
      html += '<div class="scheduler-week-event ' + (ev.enabled ? "enabled" : "disabled") + '" data-rec-id="' + ev.id + '" style="' + evStyle + '">';
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

  for (var i = 0; i < records.length; i++) {
    var r = records[i];

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
        if (action === "edit") openEditModal(id);
        else if (action === "toggle") send({ type: "loop_registry_toggle", id: id });
        else if (action === "rerun") send({ type: "loop_registry_rerun", id: id });
        else if (action === "delete" && confirm("Delete this schedule?")) send({ type: "loop_registry_remove", id: id });
      });
    })(btns[i]);
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

// --- Edit Modal (for changing cron/name on existing records) ---

function setupEditModal() {
  if (!editModal) return;
  document.getElementById("schedule-edit-close").addEventListener("click", function () { closeEditModal(); });
  document.getElementById("sched-cancel").addEventListener("click", function () { closeEditModal(); });
  editModal.querySelector(".confirm-backdrop").addEventListener("click", function () { closeEditModal(); });

  // Presets
  var presetBtns = document.querySelectorAll("#sched-presets .sched-preset-btn");
  for (var i = 0; i < presetBtns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function () { selectPreset(btn.dataset.preset); });
    })(presetBtns[i]);
  }

  // DOW
  var dowBtns = document.querySelectorAll("#sched-dow-row .sched-dow-btn");
  for (var i = 0; i < dowBtns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function () { btn.classList.toggle("active"); updateEditCronPreview(); });
    })(dowBtns[i]);
  }

  document.getElementById("sched-time").addEventListener("change", function () { updateEditCronPreview(); });
  document.getElementById("sched-save").addEventListener("click", function () { saveEdit(); });
  document.getElementById("sched-delete").addEventListener("click", function () {
    if (editingId && confirm("Delete this job?")) {
      send({ type: "loop_registry_remove", id: editingId });
      closeEditModal();
    }
  });
}

var editPreset = "daily";

function selectPreset(preset) {
  editPreset = preset;
  var btns = document.querySelectorAll("#sched-presets .sched-preset-btn");
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", btns[i].dataset.preset === preset);
  var dowField = document.getElementById("sched-dow-field");
  if (dowField) dowField.style.display = (preset === "custom" || preset === "weekly") ? "" : "none";
  updateEditCronPreview();
}

function buildEditCron() {
  var timeVal = document.getElementById("sched-time").value || "09:00";
  var parts = timeVal.split(":");
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var dow = "*";
  if (editPreset === "weekdays") dow = "1-5";
  else if (editPreset === "weekly" || editPreset === "custom") {
    var days = [];
    var btns = document.querySelectorAll("#sched-dow-row .sched-dow-btn.active");
    for (var i = 0; i < btns.length; i++) days.push(btns[i].dataset.dow);
    if (days.length > 0 && days.length < 7) dow = days.sort().join(",");
  } else if (editPreset === "monthly") {
    return m + " " + h + " " + new Date().getDate() + " * *";
  }
  return m + " " + h + " * * " + dow;
}

function updateEditCronPreview() {
  var cron = buildEditCron();
  var humanEl = document.getElementById("sched-human-text");
  var cronEl = document.getElementById("sched-cron-text");
  if (humanEl) humanEl.textContent = cronToHuman(cron);
  if (cronEl) cronEl.textContent = cron;
}

function openEditModal(recId) {
  if (!editModal) return;
  editingId = recId;
  var rec = null;
  for (var i = 0; i < records.length; i++) {
    if (records[i].id === recId) { rec = records[i]; break; }
  }
  if (!rec) return;

  document.getElementById("schedule-edit-title").textContent = "Edit Schedule";
  document.getElementById("sched-name").value = rec.name || "";
  document.getElementById("sched-enabled").checked = rec.enabled;
  document.getElementById("sched-delete").style.display = "";

  // Show job name
  var jobNameEl = document.getElementById("sched-job-name");
  if (jobNameEl) jobNameEl.textContent = rec.task ? rec.task.substring(0, 80) : rec.id;

  // History
  var historyField = document.getElementById("sched-history-field");
  if (rec.runs && rec.runs.length > 0) {
    if (historyField) historyField.style.display = "";
    renderHistory(rec.runs);
  } else {
    if (historyField) historyField.style.display = "none";
  }

  // Parse cron
  if (rec.cron) {
    var parsed = parseCronSimple(rec.cron);
    if (parsed) {
      document.getElementById("sched-time").value = pad(parsed.hours[0] || 9) + ":" + pad(parsed.minutes[0] || 0);
      var dowArr = parsed.daysOfWeek;
      if (dowArr.length === 7) selectPreset("daily");
      else if (dowArr.length === 5 && dowArr[0] === 1 && dowArr[4] === 5) selectPreset("weekdays");
      else {
        selectPreset("custom");
        var dowBtns = document.querySelectorAll("#sched-dow-row .sched-dow-btn");
        for (var j = 0; j < dowBtns.length; j++) {
          dowBtns[j].classList.toggle("active", dowArr.indexOf(parseInt(dowBtns[j].dataset.dow)) !== -1);
        }
      }
    }
  } else {
    document.getElementById("sched-time").value = "09:00";
    selectPreset("daily");
  }

  updateEditCronPreview();
  editModal.classList.remove("hidden");
}

function closeEditModal() {
  if (editModal) editModal.classList.add("hidden");
  editingId = null;
}

function saveEdit() {
  var name = document.getElementById("sched-name").value.trim();
  var enabled = document.getElementById("sched-enabled").checked;
  var cron = buildEditCron();
  if (!name) { alert("Please enter a name."); return; }

  send({
    type: "loop_registry_update",
    id: editingId,
    data: { name: name, cron: cron, enabled: enabled },
  });
  closeEditModal();
}

function renderHistory(runs) {
  var el = document.getElementById("sched-history");
  if (!el || !runs || runs.length === 0) { if (el) el.innerHTML = '<div class="sched-history-empty">No runs yet</div>'; return; }
  var html = "";
  var sorted = runs.slice().reverse();
  for (var i = 0; i < sorted.length; i++) {
    var run = sorted[i];
    html += '<div class="sched-history-item"><span class="sched-history-dot ' + (run.result || "") + '"></span>';
    html += '<span class="sched-history-date">' + formatDateTime(new Date(run.startedAt)) + '</span>';
    html += '<span class="sched-history-result">' + (run.result || "?") + '</span>';
    html += '<span class="sched-history-iterations">' + (run.iterations || 0) + ' iter</span></div>';
  }
  el.innerHTML = html;
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

export function isSchedulerOpen() {
  return panelOpen;
}

export function enterCraftingMode(sessionId, taskId) {
  craftingSessionId = sessionId || null;
  craftingTaskId = taskId || null;
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

// --- Message handlers ---

export function handleLoopRegistryUpdated(msg) {
  records = msg.records || [];
  if (panelOpen) {
    renderSidebar();
    if (currentMode === "calendar") render();
    else if (currentMode === "detail") renderDetail();
  }
}

export function handleLoopRegistryFiles(msg) {
  if (!panelOpen || currentMode !== "detail") return;
  if (msg.id !== selectedTaskId) return;
  var bodyEl2 = document.getElementById("scheduler-detail-body");
  if (!bodyEl2) return;
  var activeTab = contentDetailEl ? contentDetailEl.querySelector(".scheduler-detail-tab.active") : null;
  var tab = activeTab ? activeTab.dataset.tab : "prompt";
  if (tab === "prompt") {
    bodyEl2.innerHTML = msg.prompt ? '<div class="md-content">' + renderMarkdown(msg.prompt) + '</div>' : '<div class="scheduler-empty">No PROMPT.md found</div>';
  } else if (tab === "judge") {
    bodyEl2.innerHTML = msg.judge ? '<div class="md-content">' + renderMarkdown(msg.judge) + '</div>' : '<div class="scheduler-empty">No JUDGE.md found</div>';
  }
  // Disable "Run now" if PROMPT.md or JUDGE.md is missing
  var runBtn = contentDetailEl ? contentDetailEl.querySelector('[data-action="run"]') : null;
  if (runBtn) {
    var filesReady = !!msg.prompt && !!msg.judge;
    runBtn.disabled = !filesReady;
    runBtn.title = filesReady ? "Run now" : "PROMPT.md and JUDGE.md are required to run";
  }
}

export function handleScheduleRunStarted(msg) {
  if (panelOpen) render();
}

export function handleScheduleRunFinished(msg) {
  send({ type: "loop_registry_list" });
}

export function handleLoopScheduled(msg) {
  // A loop was just registered as scheduled (from approval bar)
  send({ type: "loop_registry_list" });
}

// Expose upcoming schedules (within given ms window) for countdown display
export function getUpcomingSchedules(windowMs) {
  var now = Date.now();
  var result = [];
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
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
        openCreateModal(d, null, cell);
      });
      cell.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        cell.classList.add("drag-over");
        if (!previewEl || previewEl.parentNode !== cell) {
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
        openCreateModal(d, hour, slot);
      });
      slot.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        slot.classList.add("drag-over");
        if (!previewEl || !slot.closest(".scheduler-week-day-col").contains(previewEl)) {
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
        openCreateModal(d, hour, slot);
        applyDraggedTask();
      });
    })(slots[i]);
  }
}

// --- Create Popover (inline, Akiflow-style) ---

function setupCreateModal() {
  if (!createPopover) return;

  // Close
  document.getElementById("sched-create-cancel").addEventListener("click", function () { closeCreateModal(); });

  // Color picker
  var colorBtn = document.getElementById("sched-create-color-btn");
  var colorPalette = document.getElementById("sched-create-color-palette");
  if (colorBtn && colorPalette) {
    colorBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      colorPalette.classList.toggle("hidden");
    });
    var swatches = colorPalette.querySelectorAll(".sched-color-swatch");
    for (var i = 0; i < swatches.length; i++) {
      swatches[i].addEventListener("click", function (e) {
        e.stopPropagation();
        var c = this.dataset.color;
        createColor = c;
        var dot = document.getElementById("sched-create-color-dot");
        if (dot) dot.style.background = c;
        // update active state
        var all = colorPalette.querySelectorAll(".sched-color-swatch");
        for (var j = 0; j < all.length; j++) {
          all[j].classList.toggle("active", all[j].dataset.color === c);
        }
        colorPalette.classList.add("hidden");
      });
    }
  }

  // Date picker change → sync createSelectedDate and recurrence labels
  var datePickerEl = document.getElementById("sched-create-date-picker");
  if (datePickerEl) {
    datePickerEl.addEventListener("change", function () {
      var parts = this.value.split("-");
      if (parts.length === 3) {
        createSelectedDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        document.getElementById("sched-create-date").value = this.value;
        updateRecurrenceLabels(createSelectedDate);
      }
    });
  }

  // Task dropdown
  var taskBtn = document.getElementById("sched-create-task-btn");
  var taskList = document.getElementById("sched-create-task-list");
  if (taskBtn && taskList) {
    taskBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      taskList.classList.toggle("hidden");
    });
  }

  // Close task dropdown on outside click
  document.addEventListener("click", function (e) {
    var tl = document.getElementById("sched-create-task-list");
    if (tl && !tl.classList.contains("hidden")) {
      if (!tl.contains(e.target) && !e.target.closest("#sched-create-task-btn")) {
        tl.classList.add("hidden");
      }
    }
  });

  // Recurrence button → toggle dropdown
  document.getElementById("sched-create-recurrence-btn").addEventListener("click", function (e) {
    e.stopPropagation();
    var dd = document.getElementById("sched-create-recurrence-dropdown");
    var btn = document.getElementById("sched-create-recurrence-btn");
    if (dd) {
      var wasHidden = dd.classList.contains("hidden");
      dd.classList.toggle("hidden");
      document.getElementById("sched-custom-repeat-panel").classList.add("hidden");
      document.getElementById("sched-create-recurrence-list").style.display = "";
      if (wasHidden && btn) {
        var bRect = btn.getBoundingClientRect();
        var ddW = 280;
        var ddLeft = bRect.left;
        if (ddLeft + ddW > window.innerWidth - 10) ddLeft = window.innerWidth - ddW - 10;
        if (ddLeft < 10) ddLeft = 10;
        dd.style.left = ddLeft + "px";
        dd.style.top = (bRect.bottom + 4) + "px";
      }
    }
  });

  // Recurrence option clicks
  var recOptions = createPopover.querySelectorAll(".sched-recurrence-option");
  for (var i = 0; i < recOptions.length; i++) {
    (function (opt) {
      opt.addEventListener("click", function (e) {
        e.stopPropagation();
        var rec = opt.dataset.recurrence;
        if (rec === "custom") {
          document.getElementById("sched-create-recurrence-list").style.display = "none";
          document.getElementById("sched-custom-repeat-panel").classList.remove("hidden");
          return;
        }
        for (var j = 0; j < recOptions.length; j++) {
          recOptions[j].classList.toggle("active", recOptions[j] === opt);
        }
        createRecurrence = rec;
        createCustomConfirmed = false;
        // Close dropdown
        document.getElementById("sched-create-recurrence-dropdown").classList.add("hidden");
        updateRecurrenceBtn();
      });
    })(recOptions[i]);
  }

  // Custom repeat: back
  document.getElementById("sched-custom-back").addEventListener("click", function (e) {
    e.stopPropagation();
    document.getElementById("sched-custom-repeat-panel").classList.add("hidden");
    document.getElementById("sched-create-recurrence-list").style.display = "";
  });

  // Custom repeat: cancel
  document.getElementById("sched-custom-cancel").addEventListener("click", function (e) {
    e.stopPropagation();
    document.getElementById("sched-custom-repeat-panel").classList.add("hidden");
    document.getElementById("sched-create-recurrence-list").style.display = "";
  });

  // Custom repeat: unit change
  document.getElementById("sched-custom-unit").addEventListener("change", function () {
    var dowSection = document.getElementById("sched-custom-dow-section");
    if (dowSection) dowSection.style.display = this.value === "week" ? "" : "none";
  });

  // Custom repeat: DOW toggle
  var customDowBtns = document.querySelectorAll("#sched-custom-dow-row .sched-dow-btn");
  for (var i = 0; i < customDowBtns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function (e) { e.stopPropagation(); btn.classList.toggle("active"); });
    })(customDowBtns[i]);
  }

  // Custom repeat: End type JS dropdown
  var endBtn = document.getElementById("sched-custom-end-btn");
  var endList = document.getElementById("sched-custom-end-list");

  endBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (endList.classList.contains("hidden")) {
      var r = endBtn.getBoundingClientRect();
      endList.style.left = r.left + "px";
      endList.style.top = (r.bottom + 4) + "px";
      // If it would overflow bottom, show above
      endList.classList.remove("hidden");
      var lr = endList.getBoundingClientRect();
      if (lr.bottom > window.innerHeight - 8) {
        endList.style.top = (r.top - lr.height - 4) + "px";
      }
    } else {
      endList.classList.add("hidden");
    }
  });

  var endItems = endList.querySelectorAll(".sched-custom-end-item");
  for (var ei = 0; ei < endItems.length; ei++) {
    (function (item) {
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        var val = item.dataset.value;
        createEndType = val;
        document.getElementById("sched-custom-end").value = val;
        document.getElementById("sched-custom-end-label").textContent = item.textContent;

        // Update active state
        for (var j = 0; j < endItems.length; j++) {
          endItems[j].classList.toggle("active", endItems[j] === item);
        }
        endList.classList.add("hidden");

        // Toggle conditional inputs
        var dateBtn2 = document.getElementById("sched-custom-end-date-btn");
        var afterWrap = document.getElementById("sched-custom-end-after-wrap");
        var calPanel = document.getElementById("sched-custom-end-calendar");

        dateBtn2.classList.add("hidden");
        afterWrap.classList.add("hidden");
        calPanel.classList.add("hidden");

        if (val === "until") {
          dateBtn2.classList.remove("hidden");
          if (!createEndDate) {
            createEndDate = new Date(createSelectedDate || new Date());
            createEndDate.setMonth(createEndDate.getMonth() + 1);
          }
          updateEndDateLabel();
        } else if (val === "after") {
          afterWrap.classList.remove("hidden");
          document.getElementById("sched-custom-end-after").value = createEndAfter;
        }
      });
    })(endItems[ei]);
  }

  // Close end dropdown on outside click
  document.addEventListener("click", function (e) {
    if (endList && !endList.classList.contains("hidden")) {
      if (!endList.contains(e.target) && !endBtn.contains(e.target)) {
        endList.classList.add("hidden");
      }
    }
  });

  // Custom repeat: End date button → toggle inline calendar
  document.getElementById("sched-custom-end-date-btn").addEventListener("click", function (e) {
    e.stopPropagation();
    var calPanel = document.getElementById("sched-custom-end-calendar");
    if (calPanel.classList.contains("hidden")) {
      createEndCalMonth = new Date(createEndDate.getFullYear(), createEndDate.getMonth(), 1);
      renderEndCalendar();
      calPanel.classList.remove("hidden");
      try { lucide.createIcons({ node: calPanel }); } catch (ex) {}
    } else {
      calPanel.classList.add("hidden");
    }
  });

  // Custom repeat: End calendar prev/next
  document.getElementById("sched-cal-prev").addEventListener("click", function (e) {
    e.stopPropagation();
    createEndCalMonth.setMonth(createEndCalMonth.getMonth() - 1);
    renderEndCalendar();
  });
  document.getElementById("sched-cal-next").addEventListener("click", function (e) {
    e.stopPropagation();
    createEndCalMonth.setMonth(createEndCalMonth.getMonth() + 1);
    renderEndCalendar();
  });

  // Custom repeat: After occurrences input
  document.getElementById("sched-custom-end-after").addEventListener("change", function () {
    createEndAfter = parseInt(this.value, 10) || 10;
    if (createEndAfter < 1) { createEndAfter = 1; this.value = 1; }
  });

  // Custom repeat: OK
  document.getElementById("sched-custom-ok").addEventListener("click", function (e) {
    e.stopPropagation();
    createRecurrence = "custom";
    createCustomConfirmed = true;
    var recOptions = createPopover.querySelectorAll(".sched-recurrence-option");
    for (var j = 0; j < recOptions.length; j++) {
      recOptions[j].classList.toggle("active", recOptions[j].dataset.recurrence === "custom");
    }
    document.getElementById("sched-create-recurrence-dropdown").classList.add("hidden");
    updateRecurrenceBtn();
  });

  // Submit
  document.getElementById("sched-create-submit").addEventListener("click", function () { submitCreateSchedule(); });

  // Delete button → close popover, then open dialog
  var deleteBtn = document.getElementById("sched-create-delete");
  var deleteDialog = document.getElementById("sched-delete-dialog");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!createEditingRecId) return;
      var rec = null;
      for (var j = 0; j < records.length; j++) {
        if (records[j].id === createEditingRecId) { rec = records[j]; break; }
      }
      if (!rec) return;
      // Save context before closing popover
      var deleteRecId = createEditingRecId;
      var deleteDate = createSelectedDate ? new Date(createSelectedDate) : null;
      closeCreateModal();
      openDeleteDialog(deleteRecId, deleteDate, !rec.cron);
    });
  }

  // Delete dialog option handlers
  if (deleteDialog) {
    var deleteOptions = deleteDialog.querySelectorAll(".sched-delete-option");
    for (var i = 0; i < deleteOptions.length; i++) {
      (function (opt) {
        opt.addEventListener("click", function (e) {
          e.stopPropagation();
          var action = opt.dataset.delete;
          if (action === "cancel") {
            closeDeleteDialog();
            return;
          }
          var recId = deleteDialog.dataset.recId;
          var dateStr = deleteDialog.dataset.eventDate;
          if (!recId) return;
          if (action === "this") {
            if (dateStr) {
              var dp = dateStr.split("-");
              var next = new Date(parseInt(dp[0], 10), parseInt(dp[1], 10) - 1, parseInt(dp[2], 10));
              next.setDate(next.getDate() + 1);
              var newDate = next.getFullYear() + "-" + pad(next.getMonth() + 1) + "-" + pad(next.getDate());
              send({ type: "loop_registry_update", id: recId, data: { date: newDate } });
            }
          } else if (action === "following") {
            if (dateStr) {
              var dp2 = dateStr.split("-");
              var prev = new Date(parseInt(dp2[0], 10), parseInt(dp2[1], 10) - 1, parseInt(dp2[2], 10));
              prev.setDate(prev.getDate() - 1);
              var endDate = prev.getFullYear() + "-" + pad(prev.getMonth() + 1) + "-" + pad(prev.getDate());
              send({ type: "loop_registry_update", id: recId, data: { recurrenceEnd: { type: "until", date: endDate } } });
            }
          } else if (action === "all") {
            send({ type: "loop_registry_remove", id: recId });
          }
          closeDeleteDialog();
        });
      })(deleteOptions[i]);
    }
    // Close on backdrop click
    deleteDialog.addEventListener("click", function (e) {
      if (e.target === deleteDialog) closeDeleteDialog();
    });
  }

  // Close color palette on any click outside it
  document.addEventListener("click", function (e) {
    var pal = document.getElementById("sched-create-color-palette");
    if (pal && !pal.classList.contains("hidden")) {
      if (!pal.contains(e.target) && !e.target.closest("#sched-create-color-btn")) {
        pal.classList.add("hidden");
      }
    }
  });

  // Close popover on outside click
  document.addEventListener("click", function (e) {
    if (!createPopover || createPopover.classList.contains("hidden")) return;
    if (createPopover.contains(e.target)) return;
    // Also ignore clicks on calendar cells (they open the popover)
    if (e.target.closest(".scheduler-cell") || e.target.closest(".scheduler-week-slot")) return;
    closeCreateModal();
  });

  // Escape key
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && createPopover && !createPopover.classList.contains("hidden")) {
      // Close recurrence dropdown first if open
      var dd = document.getElementById("sched-create-recurrence-dropdown");
      if (dd && !dd.classList.contains("hidden")) {
        dd.classList.add("hidden");
        return;
      }
      closeCreateModal();
    }
  });
}

function updateRecurrenceBtn() {
  var btn = document.getElementById("sched-create-recurrence-btn");
  if (btn) {
    btn.classList.toggle("has-recurrence", createRecurrence !== "none");
  }
}

function removePreview() {
  if (previewEl && previewEl.parentNode) {
    previewEl.parentNode.removeChild(previewEl);
  }
  previewEl = null;
}

function showPreviewOnCell(cell) {
  removePreview();
  var label = draggedTaskName || "(No title)";
  var el = document.createElement("div");
  el.className = "scheduler-event preview";
  el.textContent = label;
  cell.appendChild(el);
  previewEl = el;
}

function showPreviewOnSlot(slot) {
  removePreview();
  var label = draggedTaskName || "(No title)";
  var hour = parseInt(slot.dataset.hour, 10);
  var quarter = parseInt(slot.dataset.quarter || "0", 10);
  var minute = quarter * 15;
  var timeStr = pad(hour) + ":" + pad(minute);
  var col = slot.closest(".scheduler-week-day-col");
  if (!col) return;
  var topPct = ((hour * 60 + minute) / 1440) * 100;
  var el = document.createElement("div");
  el.className = "scheduler-week-event preview";
  el.style.cssText = "top:" + topPct + "%;height:calc(160vh / 48)";
  el.textContent = timeStr + " " + label;
  col.appendChild(el);
  previewEl = el;
}

function showPreviewForCreate(anchorEl, label) {
  removePreview();
  if (!anchorEl) return;
  var text = label || "(No title)";
  if (anchorEl.classList.contains("scheduler-week-slot")) {
    var hour = parseInt(anchorEl.dataset.hour, 10);
    var quarter = parseInt(anchorEl.dataset.quarter || "0", 10);
    var minute = quarter * 15;
    var timeStr = pad(hour) + ":" + pad(minute);
    var col = anchorEl.closest(".scheduler-week-day-col");
    if (!col) return;
    var topPct = ((hour * 60 + minute) / 1440) * 100;
    var el = document.createElement("div");
    el.className = "scheduler-week-event preview";
    el.style.cssText = "top:" + topPct + "%;height:calc(160vh / 48)";
    el.textContent = timeStr + " " + text;
    col.appendChild(el);
    previewEl = el;
  } else if (anchorEl.classList.contains("scheduler-cell")) {
    var el = document.createElement("div");
    el.className = "scheduler-event preview";
    el.textContent = text;
    anchorEl.appendChild(el);
    previewEl = el;
  }
}

function applyDraggedTask() {
  if (!draggedTaskId) return;
  var taskHidden = document.getElementById("sched-create-task");
  var taskLabel = document.getElementById("sched-create-task-label");
  var taskBtn = document.getElementById("sched-create-task-btn");
  if (taskHidden) taskHidden.value = draggedTaskId;
  if (taskLabel) taskLabel.textContent = draggedTaskName || draggedTaskId;
  if (taskBtn) { taskBtn.classList.add("has-value"); taskBtn.classList.remove("invalid"); }
  // Mark the matching item as selected in the dropdown list
  var taskListEl = document.getElementById("sched-create-task-list");
  if (taskListEl) {
    var items = taskListEl.querySelectorAll(".sched-create-task-item");
    for (var k = 0; k < items.length; k++) {
      items[k].classList.toggle("selected", items[k].dataset.taskId === draggedTaskId);
    }
  }
  // Auto-generate title: "taskName - HH:MM"
  var titleInput = document.getElementById("sched-create-title");
  var timeInput = document.getElementById("sched-create-time");
  if (titleInput && (draggedTaskName || draggedTaskId)) {
    var name = draggedTaskName || draggedTaskId;
    var time = timeInput ? timeInput.value : "";
    titleInput.value = time ? name + " - " + time : name;
  }
  // Update preview text to match auto-title
  if (previewEl && titleInput) {
    var previewText = titleInput.value || "(No title)";
    if (previewEl.classList.contains("scheduler-week-event") && timeInput) {
      previewText = timeInput.value + " " + (titleInput.value || "(No title)");
    }
    previewEl.textContent = previewText;
  }
  draggedTaskId = null;
  draggedTaskName = null;
}

function openCreateModalWithRecord(rec, anchorEl) {
  // Parse date/time from record
  var date = null;
  var hour = null;
  if (rec.date) {
    var dp = rec.date.split("-");
    date = new Date(parseInt(dp[0], 10), parseInt(dp[1], 10) - 1, parseInt(dp[2], 10));
  }
  if (rec.time) {
    var tp = rec.time.split(":");
    hour = parseInt(tp[0], 10) || 0;
    var mins = parseInt(tp[1], 10) || 0;
    if (date) { date.setHours(hour, mins, 0); }
  }
  // Mark as editing existing record
  createEditingRecId = rec.id;

  // Open the create modal normally first
  openCreateModal(date || new Date(), hour, anchorEl);

  // Show delete button
  var deleteBtn = document.getElementById("sched-create-delete");
  if (deleteBtn) deleteBtn.classList.remove("hidden");

  // Now override with record values
  var titleInput = document.getElementById("sched-create-title");
  if (titleInput) titleInput.value = rec.name || "";

  var descInput = document.getElementById("sched-create-desc");
  if (descInput) descInput.value = rec.description || "";

  // Set color
  if (rec.color) {
    createColor = rec.color;
    var colorDot = document.getElementById("sched-create-color-dot");
    if (colorDot) colorDot.style.background = createColor;
    var swatches = createPopover.querySelectorAll(".sched-color-swatch");
    for (var si = 0; si < swatches.length; si++) {
      swatches[si].classList.toggle("active", swatches[si].dataset.color === createColor);
    }
  }

  // Set iterations
  if (rec.maxIterations) {
    var iterInput = document.getElementById("sched-create-iterations");
    if (iterInput) iterInput.value = rec.maxIterations;
  }

  // Set linked task
  if (rec.linkedTaskId) {
    var taskHidden = document.getElementById("sched-create-task");
    var taskLabel = document.getElementById("sched-create-task-label");
    var taskBtn = document.getElementById("sched-create-task-btn");
    var taskListEl = document.getElementById("sched-create-task-list");
    if (taskHidden) taskHidden.value = rec.linkedTaskId;
    // Find the task name
    var taskName = rec.linkedTaskId;
    for (var j = 0; j < records.length; j++) {
      if (records[j].id === rec.linkedTaskId) { taskName = records[j].name || records[j].id; break; }
    }
    if (taskLabel) taskLabel.textContent = taskName;
    if (taskBtn) { taskBtn.classList.add("has-value"); taskBtn.classList.remove("invalid"); }
    if (taskListEl) {
      var items = taskListEl.querySelectorAll(".sched-create-task-item");
      for (var k = 0; k < items.length; k++) {
        items[k].classList.toggle("selected", items[k].dataset.taskId === rec.linkedTaskId);
      }
    }
  }

  // Update preview to show record name
  if (previewEl) {
    var previewText = rec.name || "(No title)";
    if (previewEl.classList.contains("scheduler-week-event") && rec.time) {
      previewText = rec.time + " " + previewText;
    }
    previewEl.textContent = previewText;
  }
}

function openCreateModal(date, hour, anchorEl) {
  if (!createPopover) return;
  // Reset editing state (openCreateModalWithRecord sets this before calling us)
  if (!createEditingRecId) {
    var deleteBtn = document.getElementById("sched-create-delete");
    if (deleteBtn) deleteBtn.classList.add("hidden");
  }
  createSelectedDate = date || new Date();
  createRecurrence = "none";
  createCustomConfirmed = false;
  createColor = "#ffb86c";

  // Reset form
  document.getElementById("sched-create-title").value = "";
  document.getElementById("sched-create-desc").value = "";
  var iterReset = document.getElementById("sched-create-iterations");
  if (iterReset) iterReset.value = "3";

  // Reset color
  var colorDot = document.getElementById("sched-create-color-dot");
  if (colorDot) colorDot.style.background = createColor;
  var palette = document.getElementById("sched-create-color-palette");
  if (palette) palette.classList.add("hidden");
  var swatches = createPopover.querySelectorAll(".sched-color-swatch");
  for (var si = 0; si < swatches.length; si++) {
    swatches[si].classList.toggle("active", swatches[si].dataset.color === createColor);
  }

  // Populate task dropdown (only tasks — exclude ralph and schedule)
  var taskHidden = document.getElementById("sched-create-task");
  var taskLabel = document.getElementById("sched-create-task-label");
  var taskBtn = document.getElementById("sched-create-task-btn");
  var taskListEl = document.getElementById("sched-create-task-list");
  if (taskHidden) taskHidden.value = "";
  if (taskLabel) taskLabel.textContent = "Select a task";
  if (taskBtn) { taskBtn.classList.remove("has-value"); taskBtn.classList.remove("invalid"); }
  if (taskListEl) {
    taskListEl.classList.add("hidden");
    var tasks = records.filter(function (r) { return r.source !== "ralph" && r.source !== "schedule"; });
    if (tasks.length === 0) {
      taskListEl.innerHTML = '<div class="sched-create-task-empty">No tasks available</div>';
    } else {
      var html = "";
      for (var i = 0; i < tasks.length; i++) {
        html += '<div class="sched-create-task-item" data-task-id="' + esc(tasks[i].id) + '">' + esc(tasks[i].name || tasks[i].id) + '</div>';
      }
      taskListEl.innerHTML = html;
      // Bind click handlers
      var items = taskListEl.querySelectorAll(".sched-create-task-item");
      for (var j = 0; j < items.length; j++) {
        (function (item) {
          item.addEventListener("click", function (e) {
            e.stopPropagation();
            var id = item.dataset.taskId;
            var name = item.textContent;
            if (taskHidden) taskHidden.value = id;
            if (taskLabel) taskLabel.textContent = name;
            if (taskBtn) { taskBtn.classList.add("has-value"); taskBtn.classList.remove("invalid"); }
            // Update selected state
            var all = taskListEl.querySelectorAll(".sched-create-task-item");
            for (var k = 0; k < all.length; k++) {
              all[k].classList.toggle("selected", all[k] === item);
            }
            taskListEl.classList.add("hidden");
          });
        })(items[j]);
      }
    }
  }

  // Set date picker
  var dateStr = createSelectedDate.getFullYear() + "-" + pad(createSelectedDate.getMonth() + 1) + "-" + pad(createSelectedDate.getDate());
  document.getElementById("sched-create-date").value = dateStr;
  var datePicker = document.getElementById("sched-create-date-picker");
  if (datePicker) datePicker.value = dateStr;

  // Time (use minutes from createSelectedDate for 15-min snapping)
  if (hour !== null && hour !== undefined) {
    var mins = createSelectedDate.getMinutes ? createSelectedDate.getMinutes() : 0;
    document.getElementById("sched-create-time").value = pad(hour) + ":" + pad(mins);
  } else {
    document.getElementById("sched-create-time").value = "09:00";
  }

  // Update recurrence labels
  updateRecurrenceLabels(createSelectedDate);

  // Reset recurrence
  var recOptions = createPopover.querySelectorAll(".sched-recurrence-option");
  for (var i = 0; i < recOptions.length; i++) {
    recOptions[i].classList.toggle("active", recOptions[i].dataset.recurrence === "none");
  }
  updateRecurrenceBtn();

  // Reset custom panel
  document.getElementById("sched-create-recurrence-dropdown").classList.add("hidden");
  document.getElementById("sched-custom-repeat-panel").classList.add("hidden");
  document.getElementById("sched-create-recurrence-list").style.display = "";
  document.getElementById("sched-custom-interval").value = "1";
  document.getElementById("sched-custom-unit").value = "week";
  document.getElementById("sched-custom-dow-section").style.display = "";
  var customDowBtns = document.querySelectorAll("#sched-custom-dow-row .sched-dow-btn");
  for (var i = 0; i < customDowBtns.length; i++) {
    customDowBtns[i].classList.toggle("active", parseInt(customDowBtns[i].dataset.dow) === createSelectedDate.getDay());
  }
  document.getElementById("sched-custom-end").value = "never";
  document.getElementById("sched-custom-end-label").textContent = "Never";
  var endItems = document.querySelectorAll(".sched-custom-end-item");
  for (var ei = 0; ei < endItems.length; ei++) {
    endItems[ei].classList.toggle("active", endItems[ei].dataset.value === "never");
  }
  document.getElementById("sched-custom-end-list").classList.add("hidden");
  createEndType = "never";
  createEndDate = null;
  createEndAfter = 10;
  document.getElementById("sched-custom-end-date-btn").classList.add("hidden");
  document.getElementById("sched-custom-end-after-wrap").classList.add("hidden");
  document.getElementById("sched-custom-end-calendar").classList.add("hidden");

  // Show preview event on the calendar cell
  showPreviewForCreate(anchorEl, draggedTaskName || null);

  // Position near anchor cell
  createPopover.classList.remove("hidden");
  positionCreatePopover(anchorEl);

  try { lucide.createIcons({ node: createPopover }); } catch (e) {}
  setTimeout(function () { document.getElementById("sched-create-title").focus(); }, 50);
}

function positionCreatePopover(anchorEl) {
  if (!createPopover || !anchorEl) {
    // Fallback: center in scheduler content area
    if (createPopover && contentCalEl) {
      var cRect = contentCalEl.getBoundingClientRect();
      createPopover.style.left = (cRect.left + cRect.width / 2 - 180) + "px";
      createPopover.style.top = (cRect.top + 60) + "px";
    }
    return;
  }

  var rect = anchorEl.getBoundingClientRect();
  var popW = 360;
  var popH = createPopover.offsetHeight || 300;

  // Try to place to the right of the cell
  var left = rect.right + 8;
  var top = rect.top;

  // If it overflows right, place to the left
  if (left + popW > window.innerWidth - 10) {
    left = rect.left - popW - 8;
  }
  // If it still overflows left, center horizontally on the cell
  if (left < 10) {
    left = Math.max(10, rect.left + rect.width / 2 - popW / 2);
  }

  // Vertical: don't overflow bottom
  if (top + popH > window.innerHeight - 10) {
    top = window.innerHeight - popH - 10;
  }
  if (top < 10) top = 10;

  createPopover.style.left = left + "px";
  createPopover.style.top = top + "px";
}

function updateRecurrenceLabels(date) {
  var dow = date.getDay();
  var dayName = DAY_NAMES[dow];
  var dom = date.getDate();
  var monthName = MONTH_NAMES[date.getMonth()];

  // Weekly on {day}
  var weeklyEl = document.getElementById("sched-recurrence-weekly");
  if (weeklyEl) weeklyEl.textContent = "Weekly on " + dayName;

  // Every second {day} of the month
  var weekOfMonth = Math.ceil(dom / 7);
  var ordinals = ["", "first", "second", "third", "fourth", "fifth"];
  var biweeklyEl = document.getElementById("sched-recurrence-biweekly");
  if (biweeklyEl) {
    var ordStr = ordinals[weekOfMonth] || weekOfMonth + "th";
    biweeklyEl.textContent = "Every " + ordStr + " " + dayName + " of the mo...";
  }

  // Every year on {month} {date}
  var yearlyEl = document.getElementById("sched-recurrence-yearly");
  if (yearlyEl) yearlyEl.textContent = "Every year on " + monthName + " " + dom;

  // Every month on the {date}th
  var monthlyEl = document.getElementById("sched-recurrence-monthly");
  if (monthlyEl) {
    var suffix = "th";
    if (dom === 1 || dom === 21 || dom === 31) suffix = "st";
    else if (dom === 2 || dom === 22) suffix = "nd";
    else if (dom === 3 || dom === 23) suffix = "rd";
    monthlyEl.textContent = "Every month on the " + dom + suffix;
  }
}

function closeCreateModal() {
  if (createPopover) createPopover.classList.add("hidden");
  var dd = document.getElementById("sched-create-recurrence-dropdown");
  if (dd) dd.classList.add("hidden");
  var pal = document.getElementById("sched-create-color-palette");
  if (pal) pal.classList.add("hidden");
  var tl = document.getElementById("sched-create-task-list");
  if (tl) tl.classList.add("hidden");
  removePreview();
  createSelectedDate = null;
  createEditingRecId = null;
}

function openDeleteDialog(recId, eventDate, isOneOff) {
  var dialog = document.getElementById("sched-delete-dialog");
  if (!dialog) return;
  dialog.dataset.recId = recId;
  if (eventDate) {
    dialog.dataset.eventDate = eventDate.getFullYear() + "-" + pad(eventDate.getMonth() + 1) + "-" + pad(eventDate.getDate());
  } else {
    dialog.dataset.eventDate = "";
  }
  // Toggle between one-off and recurring UI
  var title = dialog.querySelector(".sched-delete-dialog-title");
  var body = dialog.querySelector(".sched-delete-dialog-body");
  var footer = dialog.querySelector(".sched-delete-dialog-footer");
  var cancelBtn = dialog.querySelector('[data-delete="cancel"]');
  dialog.dataset.oneOff = isOneOff ? "1" : "";
  if (isOneOff) {
    if (title) title.textContent = "Delete this event?";
    if (body) body.classList.add("hidden");
    if (cancelBtn) cancelBtn.textContent = "Cancel";
    // Add a "Delete" button next to cancel in footer
    var existingDel = footer ? footer.querySelector(".sched-delete-confirm-btn") : null;
    if (!existingDel && footer) {
      var delBtn = document.createElement("button");
      delBtn.className = "sched-delete-option danger sched-delete-confirm-btn";
      delBtn.dataset.delete = "all";
      delBtn.textContent = "Delete";
      footer.appendChild(delBtn);
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var rid = dialog.dataset.recId;
        if (rid) send({ type: "loop_registry_remove", id: rid });
        closeDeleteDialog();
      });
    }
    if (existingDel) existingDel.classList.remove("hidden");
  } else {
    if (title) title.textContent = "Delete recurring event";
    if (body) body.classList.remove("hidden");
    if (cancelBtn) cancelBtn.textContent = "Cancel";
    var existingDel = footer ? footer.querySelector(".sched-delete-confirm-btn") : null;
    if (existingDel) existingDel.classList.add("hidden");
  }
  dialog.classList.remove("hidden");
}

function closeDeleteDialog() {
  var dialog = document.getElementById("sched-delete-dialog");
  if (dialog) {
    dialog.classList.add("hidden");
    dialog.dataset.recId = "";
    dialog.dataset.eventDate = "";
  }
}

function buildCreateCron() {
  if (!createSelectedDate) return null;

  var timeVal = document.getElementById("sched-create-time").value || "09:00";
  var timeParts = timeVal.split(":");
  var h = parseInt(timeParts[0], 10);
  var m = parseInt(timeParts[1], 10);

  var dow = createSelectedDate.getDay();
  var dom = createSelectedDate.getDate();
  var month = createSelectedDate.getMonth() + 1;

  if (createRecurrence === "none") return null;
  if (createRecurrence === "daily") return m + " " + h + " * * *";
  if (createRecurrence === "weekly") return m + " " + h + " * * " + dow;
  if (createRecurrence === "biweekly") {
    // Nth weekday of month — approximate with cron (run weekly, but it's the closest)
    var weekNum = Math.ceil(dom / 7);
    return m + " " + h + " " + ((weekNum - 1) * 7 + 1) + "-" + (weekNum * 7) + " * " + dow;
  }
  if (createRecurrence === "yearly") return m + " " + h + " " + dom + " " + month + " *";
  if (createRecurrence === "monthly") return m + " " + h + " " + dom + " * *";
  if (createRecurrence === "weekdays") return m + " " + h + " * * 1-5";

  if (createRecurrence === "custom" && createCustomConfirmed) {
    return buildCustomCron(h, m);
  }

  return null;
}

function updateEndDateLabel() {
  var label = document.getElementById("sched-custom-end-date-label");
  if (!label || !createEndDate) return;
  var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  label.textContent = days[createEndDate.getDay()] + ", " + months[createEndDate.getMonth()] + " " + createEndDate.getDate();
}

function renderEndCalendar() {
  var grid = document.getElementById("sched-cal-grid");
  var titleEl = document.getElementById("sched-cal-title");
  if (!grid || !createEndCalMonth) return;

  var year = createEndCalMonth.getFullYear();
  var month = createEndCalMonth.getMonth();
  var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  titleEl.textContent = months[month] + " " + year;

  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var prevDays = new Date(year, month, 0).getDate();

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  grid.innerHTML = "";

  // Previous month filler
  for (var p = firstDay - 1; p >= 0; p--) {
    var d = prevDays - p;
    var btn = document.createElement("button");
    btn.className = "sched-cal-day other-month";
    btn.textContent = d;
    btn.type = "button";
    var prevDate = new Date(year, month - 1, d);
    (function (dt) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        createEndDate = dt;
        updateEndDateLabel();
        renderEndCalendar();
      });
    })(prevDate);
    grid.appendChild(btn);
  }

  // Current month
  for (var i = 1; i <= daysInMonth; i++) {
    var btn = document.createElement("button");
    btn.className = "sched-cal-day";
    btn.textContent = i;
    btn.type = "button";
    var cellDate = new Date(year, month, i);
    if (cellDate.getTime() === today.getTime()) btn.classList.add("today");
    if (createEndDate && cellDate.getFullYear() === createEndDate.getFullYear() && cellDate.getMonth() === createEndDate.getMonth() && cellDate.getDate() === createEndDate.getDate()) {
      btn.classList.add("selected");
    }
    (function (dt) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        createEndDate = dt;
        updateEndDateLabel();
        renderEndCalendar();
      });
    })(cellDate);
    grid.appendChild(btn);
  }

  // Next month filler
  var totalCells = firstDay + daysInMonth;
  var remaining = (7 - (totalCells % 7)) % 7;
  for (var n = 1; n <= remaining; n++) {
    var btn = document.createElement("button");
    btn.className = "sched-cal-day other-month";
    btn.textContent = n;
    btn.type = "button";
    var nextDate = new Date(year, month + 1, n);
    (function (dt) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        createEndDate = dt;
        updateEndDateLabel();
        renderEndCalendar();
      });
    })(nextDate);
    grid.appendChild(btn);
  }
}

function buildCustomCron(h, m) {
  var interval = parseInt(document.getElementById("sched-custom-interval").value, 10) || 1;
  var unit = document.getElementById("sched-custom-unit").value;

  if (unit === "day") {
    if (interval === 1) return m + " " + h + " * * *";
    return m + " " + h + " */" + interval + " * *";
  }

  if (unit === "week") {
    var days = [];
    var btns = document.querySelectorAll("#sched-custom-dow-row .sched-dow-btn.active");
    for (var i = 0; i < btns.length; i++) days.push(btns[i].dataset.dow);
    if (days.length === 0) days.push(String(createSelectedDate ? createSelectedDate.getDay() : 0));
    return m + " " + h + " * * " + days.sort().join(",");
  }

  if (unit === "month") {
    var dom = createSelectedDate ? createSelectedDate.getDate() : 1;
    if (interval === 1) return m + " " + h + " " + dom + " * *";
    return m + " " + h + " " + dom + " */" + interval + " *";
  }

  if (unit === "year") {
    var dom = createSelectedDate ? createSelectedDate.getDate() : 1;
    var month = createSelectedDate ? createSelectedDate.getMonth() + 1 : 1;
    return m + " " + h + " " + dom + " " + month + " *";
  }

  return null;
}

function submitCreateSchedule() {
  var name = document.getElementById("sched-create-title").value.trim();
  if (!name) { document.getElementById("sched-create-title").focus(); return; }

  var taskId = document.getElementById("sched-create-task").value || null;
  if (!taskId) {
    var taskBtn = document.getElementById("sched-create-task-btn");
    if (taskBtn) taskBtn.classList.add("invalid");
    return;
  }
  var description = document.getElementById("sched-create-desc").value.trim();
  var datePicker = document.getElementById("sched-create-date-picker");
  var dateVal = datePicker ? datePicker.value : document.getElementById("sched-create-date").value;
  var timeVal = document.getElementById("sched-create-time").value || "09:00";
  var cron = buildCreateCron();

  // Build recurrence end info
  var recurrenceEnd = null;
  if (cron && createRecurrence === "custom" && createCustomConfirmed) {
    if (createEndType === "until" && createEndDate) {
      var ey = createEndDate.getFullYear();
      var em = String(createEndDate.getMonth() + 1).padStart(2, "0");
      var ed = String(createEndDate.getDate()).padStart(2, "0");
      recurrenceEnd = { type: "until", date: ey + "-" + em + "-" + ed };
    } else if (createEndType === "after" && createEndAfter > 0) {
      recurrenceEnd = { type: "after", count: createEndAfter };
    }
  }

  var iterInput = document.getElementById("sched-create-iterations");
  var maxIterations = iterInput ? (parseInt(iterInput.value, 10) || 3) : 3;
  if (maxIterations < 1) maxIterations = 1;
  if (maxIterations > 100) maxIterations = 100;

  send({
    type: "schedule_create",
    data: {
      name: name,
      taskId: taskId,
      description: description,
      date: dateVal,
      time: timeVal,
      allDay: false,
      cron: cron,
      enabled: cron ? true : false,
      color: createColor,
      recurrenceEnd: recurrenceEnd,
      maxIterations: maxIterations,
    },
  });

  closeCreateModal();
}

// --- Cron parser (client-side) ---

function parseCronSimple(expr) {
  if (!expr) return null;
  var fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  return {
    minutes: parseField(fields[0], 0, 59),
    hours: parseField(fields[1], 0, 23),
    daysOfMonth: parseField(fields[2], 1, 31),
    months: parseField(fields[3], 1, 12),
    daysOfWeek: parseField(fields[4], 0, 6),
  };
}

function parseField(field, min, max) {
  var values = [];
  var parts = field.split(",");
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (part.indexOf("/") !== -1) {
      var sp = part.split("/");
      var step = parseInt(sp[1], 10);
      var rMin = min, rMax = max;
      if (sp[0] !== "*") { var rp = sp[0].split("-"); rMin = parseInt(rp[0], 10); rMax = rp.length > 1 ? parseInt(rp[1], 10) : rMin; }
      for (var v = rMin; v <= rMax; v += step) values.push(v);
    } else if (part === "*") {
      for (var v = min; v <= max; v++) values.push(v);
    } else if (part.indexOf("-") !== -1) {
      var rp = part.split("-");
      for (var v = parseInt(rp[0], 10); v <= parseInt(rp[1], 10); v++) values.push(v);
    } else {
      values.push(parseInt(part, 10));
    }
  }
  return values;
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
