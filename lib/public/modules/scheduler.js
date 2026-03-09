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
      data: { name: task, task: task, maxIterations: 3, cron: null }
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
  if (currentMode === "crafting") unparentChat();

  if (panel) panel.classList.add("hidden");
  if (popoverEl) popoverEl.classList.add("hidden");

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

  // Update count badge (exclude ralph items from count)
  var nonRalphCount = records.filter(function (r) { return r.source !== "ralph"; }).length;
  var ralphCount = records.filter(function (r) { return r.source === "ralph"; }).length;
  var countEl = panel ? panel.querySelector(".scheduler-sidebar-count") : null;
  if (countEl) countEl.textContent = showRalphTasks ? records.length : nonRalphCount;

  // Update toggle badge
  var toggleBtn = panel ? panel.querySelector("#scheduler-ralph-toggle") : null;
  if (toggleBtn) {
    toggleBtn.classList.toggle("has-items", ralphCount > 0);
    toggleBtn.classList.toggle("active", showRalphTasks);
  }

  var filtered = showRalphTasks
    ? records.slice()
    : records.filter(function (r) { return r.source !== "ralph"; });

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

    html += '<div class="scheduler-task-item' + selected + '" data-rec-id="' + rec.id + '">';
    html += '<div class="scheduler-task-name-row">';
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
      html += '<div class="' + cls + '">';
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
}

// --- Week View ---

function renderWeekView() {
  var weekStart = getWeekStart(viewDate);
  var today = new Date();
  var todayStr = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());

  var html = '<div class="scheduler-week-header"><div></div>';
  for (var d = 0; d < 7; d++) {
    var day = new Date(weekStart);
    day.setDate(day.getDate() + d);
    var dateStr = day.getFullYear() + "-" + pad(day.getMonth() + 1) + "-" + pad(day.getDate());
    html += '<div class="scheduler-week-header-cell' + (dateStr === todayStr ? ' today' : '') + '">';
    html += '<div class="wday">' + DAY_NAMES[d].toUpperCase() + '</div>';
    html += '<div class="wdate">' + day.getDate() + '</div></div>';
  }
  html += '</div><div class="scheduler-week-view">';
  html += '<div class="scheduler-week-time-col">';
  for (var h = 0; h < 24; h++) {
    html += '<div class="scheduler-week-time-label">' + (h === 0 ? "" : pad(h) + ":00") + '</div>';
  }
  html += '</div>';
  for (var d = 0; d < 7; d++) {
    var day = new Date(weekStart);
    day.setDate(day.getDate() + d);
    html += '<div class="scheduler-week-day-col">';
    for (var h = 0; h < 24; h++) {
      html += '<div class="scheduler-week-slot"></div>';
    }
    var events = getEventsForDate(day);
    for (var e = 0; e < events.length; e++) {
      var ev = events[e];
      var topPx = ev.hour * 48 + (ev.minute / 60) * 48;
      html += '<div class="scheduler-week-event ' + (ev.enabled ? "enabled" : "disabled") + '" data-rec-id="' + ev.id + '" style="top:' + topPx + 'px;height:24px">';
      html += ev.timeStr + " " + esc(ev.name) + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  bodyEl.innerHTML = html;

  var weekView = bodyEl.querySelector(".scheduler-week-view");
  if (weekView) weekView.scrollTop = Math.max(0, today.getHours() - 2) * 48;
  attachEventClicks(bodyEl, ".scheduler-week-event[data-rec-id]");
}

// --- Events for calendar ---

function getEventsForDate(date) {
  var results = [];
  var dow = date.getDay();
  var dom = date.getDate();
  var month = date.getMonth() + 1;

  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (!r.cron) continue; // only scheduled
    var parsed = parseCronSimple(r.cron);
    if (!parsed) continue;
    if (parsed.months.indexOf(month) === -1) continue;
    if (parsed.daysOfMonth.indexOf(dom) === -1) continue;
    if (parsed.daysOfWeek.indexOf(dow) === -1) continue;
    for (var h = 0; h < parsed.hours.length; h++) {
      for (var m = 0; m < parsed.minutes.length; m++) {
        results.push({
          id: r.id, name: r.name, enabled: r.enabled,
          hour: parsed.hours[h], minute: parsed.minutes[m],
          timeStr: pad(parsed.hours[h]) + ":" + pad(parsed.minutes[m]),
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
        selectedTaskId = el.dataset.recId;
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
