/**
 * Scheduler config module — Create/edit modal, delete dialog, cron builder, preview.
 *
 * Extracted from scheduler.js to keep module sizes manageable.
 */

import { showToast } from './utils.js';
import { legacyScheduleRule } from './scheduled-task-schedule-rule.js';

// Constants (duplicated from scheduler.js — small arrays)
var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// Module-private state
var configCtx = null;
var previewEl = null;
var createEditingRecId = null;
var createSelectedDate = null;
var createRecurrence = "none";
var createCustomConfirmed = false;
var createInterval = "none";
var createIntervalCustom = null;
var createIntervalEnd = "allday";
var createIntervalEndAfter = 5;
var createIntervalEndTime = "";
var createColor = "#ffb86c";
var createEndType = "never";
var createEndDate = null;
var createEndCalMonth = null;
var createEndAfter = 10;

// --- Init ---

export function initSchedulerConfig(_configCtx) {
  configCtx = _configCtx;
}

// --- Create Popover (inline, Akiflow-style) ---

export function setupCreateModal() {
  var createPopover = configCtx.getCreatePopover();
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

  // Date picker change -> sync createSelectedDate and recurrence labels
  var datePickerEl = document.getElementById("sched-create-date-picker");
  if (datePickerEl) {
    datePickerEl.addEventListener("change", function () {
      var parts = this.value.split("-");
      if (parts.length === 3) {
        createSelectedDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        document.getElementById("sched-create-date").value = this.value;
        updateRecurrenceLabels(createSelectedDate);
        enforceMinTime();
      }
    });
  }

  // Time input change -- enforce min time when today is selected
  var timeInputEl = document.getElementById("sched-create-time");
  if (timeInputEl) {
    timeInputEl.addEventListener("blur", function () {
      enforceMinTime();
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

  // updateTaskSubtitle is defined at module level (below)

  // --- Repeat accordion toggle ---
  document.getElementById("sched-accordion-repeat-header").addEventListener("click", function (e) {
    e.stopPropagation();
    var acc = document.getElementById("sched-accordion-repeat");
    var body = document.getElementById("sched-accordion-repeat-body");
    var isOpen = acc.classList.contains("open");
    // Close interval accordion
    document.getElementById("sched-accordion-interval").classList.remove("open");
    document.getElementById("sched-accordion-interval-body").classList.add("hidden");
    acc.classList.toggle("open", !isOpen);
    body.classList.toggle("hidden", isOpen);
    try { lucide.createIcons({ node: acc }); } catch (ex) {}
  });

  // --- Interval accordion toggle ---
  document.getElementById("sched-accordion-interval-header").addEventListener("click", function (e) {
    e.stopPropagation();
    var acc = document.getElementById("sched-accordion-interval");
    var body = document.getElementById("sched-accordion-interval-body");
    var isOpen = acc.classList.contains("open");
    // Close repeat accordion
    document.getElementById("sched-accordion-repeat").classList.remove("open");
    document.getElementById("sched-accordion-repeat-body").classList.add("hidden");
    acc.classList.toggle("open", !isOpen);
    body.classList.toggle("hidden", isOpen);
    try { lucide.createIcons({ node: acc }); } catch (ex) {}
  });

  // --- Clear buttons ---
  document.getElementById("sched-accordion-repeat-clear").addEventListener("click", function (e) {
    e.stopPropagation();
    createRecurrence = "none";
    createCustomConfirmed = false;
    // Reset controls
    document.getElementById("sched-custom-interval").value = "1";
    document.getElementById("sched-custom-unit").value = "week";
    var dowSection = document.getElementById("sched-custom-dow-section");
    if (dowSection) dowSection.style.display = "";
    var dowBtns = document.querySelectorAll("#sched-custom-dow-row .sched-dow-btn");
    for (var d = 0; d < dowBtns.length; d++) dowBtns[d].classList.remove("active");
    document.getElementById("sched-custom-end").value = "never";
    document.getElementById("sched-custom-end-label").textContent = "Never";
    var dateBtn3 = document.getElementById("sched-custom-end-date-btn");
    if (dateBtn3) dateBtn3.classList.add("hidden");
    var afterWrap3 = document.getElementById("sched-custom-end-after-wrap");
    if (afterWrap3) afterWrap3.classList.add("hidden");
    var calPanel3 = document.getElementById("sched-custom-end-calendar");
    if (calPanel3) calPanel3.classList.add("hidden");
    // Collapse and update
    document.getElementById("sched-accordion-repeat").classList.remove("open");
    document.getElementById("sched-accordion-repeat-body").classList.add("hidden");
    updateRecurrenceBtn();
  });

  document.getElementById("sched-accordion-interval-clear").addEventListener("click", function (e) {
    e.stopPropagation();
    createInterval = "none";
    createIntervalCustom = null;
    createIntervalEnd = "allday";
    createIntervalEndAfter = 5;
    createIntervalEndTime = "";
    // Reset controls
    document.getElementById("sched-interval-custom-value").value = "10";
    var segs = document.querySelectorAll(".sched-interval-seg");
    for (var s = 0; s < segs.length; s++) segs[s].classList.toggle("active", segs[s].dataset.unit === "minute");
    var iendOpts2 = document.querySelectorAll(".sched-interval-end-opt");
    for (var ie2 = 0; ie2 < iendOpts2.length; ie2++) iendOpts2[ie2].classList.toggle("active", iendOpts2[ie2].dataset.iend === "allday");
    var iAfterRow = document.getElementById("sched-interval-end-after-row");
    if (iAfterRow) iAfterRow.classList.add("hidden");
    var iUntilRow = document.getElementById("sched-interval-end-until-row");
    if (iUntilRow) iUntilRow.classList.add("hidden");
    // Collapse and update
    document.getElementById("sched-accordion-interval").classList.remove("open");
    document.getElementById("sched-accordion-interval-body").classList.add("hidden");
    updateIntervalBtn();
  });

  // Interval custom input
  var intCustomValue = document.getElementById("sched-interval-custom-value");
  var intUnitSegs = document.querySelectorAll(".sched-interval-seg");
  function getIntervalUnit() {
    for (var s = 0; s < intUnitSegs.length; s++) {
      if (intUnitSegs[s].classList.contains("active")) return intUnitSegs[s].dataset.unit;
    }
    return "minute";
  }
  function applyInlineInterval() {
    var v = parseInt(intCustomValue.value, 10) || 1;
    var u = getIntervalUnit();
    createInterval = "custom";
    createIntervalCustom = { value: v, unit: u };
    updateIntervalBtn();
  }
  intCustomValue.addEventListener("change", applyInlineInterval);
  for (var si = 0; si < intUnitSegs.length; si++) {
    (function (seg) {
      seg.addEventListener("click", function (e) {
        e.stopPropagation();
        for (var s = 0; s < intUnitSegs.length; s++) {
          intUnitSegs[s].classList.toggle("active", intUnitSegs[s] === seg);
        }
        applyInlineInterval();
      });
    })(intUnitSegs[si]);
  }

  // Interval end condition options
  var iendOpts = document.querySelectorAll(".sched-interval-end-opt");
  for (var ie = 0; ie < iendOpts.length; ie++) {
    (function (opt) {
      opt.addEventListener("click", function (e) {
        e.stopPropagation();
        var val = opt.dataset.iend;
        for (var j = 0; j < iendOpts.length; j++) {
          iendOpts[j].classList.toggle("active", iendOpts[j] === opt);
        }
        createIntervalEnd = val;
        var afterRow = document.getElementById("sched-interval-end-after-row");
        var untilRow = document.getElementById("sched-interval-end-until-row");
        if (afterRow) afterRow.classList.toggle("hidden", val !== "after");
        if (untilRow) untilRow.classList.toggle("hidden", val !== "until");
      });
    })(iendOpts[ie]);
  }

  var iendAfterInput = document.getElementById("sched-interval-end-after");
  if (iendAfterInput) {
    iendAfterInput.addEventListener("change", function () {
      createIntervalEndAfter = parseInt(this.value, 10) || 5;
      if (createIntervalEndAfter < 1) createIntervalEndAfter = 1;
    });
  }

  var iendTimeInput = document.getElementById("sched-interval-end-time");
  if (iendTimeInput) {
    iendTimeInput.addEventListener("change", function () {
      createIntervalEndTime = this.value;
    });
  }

  // Custom repeat: unit change (applies immediately)
  document.getElementById("sched-custom-unit").addEventListener("change", function () {
    var dowSection = document.getElementById("sched-custom-dow-section");
    if (dowSection) dowSection.style.display = this.value === "week" ? "" : "none";
    createRecurrence = "custom";
    createCustomConfirmed = true;
    updateRecurrenceBtn();
  });

  // Custom repeat: interval input (applies immediately)
  document.getElementById("sched-custom-interval").addEventListener("change", function () {
    createRecurrence = "custom";
    createCustomConfirmed = true;
    updateRecurrenceBtn();
  });

  // Custom repeat: DOW toggle
  var customDowBtns = document.querySelectorAll("#sched-custom-dow-row .sched-dow-btn");
  for (var i = 0; i < customDowBtns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        btn.classList.toggle("active");
        createRecurrence = "custom";
        createCustomConfirmed = true;
        updateRecurrenceBtn();
      });
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

  // Custom repeat: End date button -> toggle inline calendar
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

  // Submit
  document.getElementById("sched-create-submit").addEventListener("click", function () { submitCreateSchedule(); });

  // Delete button -> close popover, then open dialog
  var deleteBtn = document.getElementById("sched-create-delete");
  var deleteDialog = document.getElementById("sched-delete-dialog");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!createEditingRecId) return;
      var records = configCtx.getRecords();
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
              var newDate = next.getFullYear() + "-" + configCtx.pad(next.getMonth() + 1) + "-" + configCtx.pad(next.getDate());
              configCtx.send({ type: "loop_registry_update", id: recId, data: { date: newDate } });
            }
          } else if (action === "following") {
            if (dateStr) {
              var dp2 = dateStr.split("-");
              var prev = new Date(parseInt(dp2[0], 10), parseInt(dp2[1], 10) - 1, parseInt(dp2[2], 10));
              prev.setDate(prev.getDate() - 1);
              var endDate = prev.getFullYear() + "-" + configCtx.pad(prev.getMonth() + 1) + "-" + configCtx.pad(prev.getDate());
              configCtx.send({ type: "loop_registry_update", id: recId, data: { recurrenceEnd: { type: "until", date: endDate } } });
            }
          } else if (action === "all") {
            configCtx.send({ type: "loop_registry_remove", id: recId });
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
    var cp = configCtx.getCreatePopover();
    if (!cp || cp.classList.contains("hidden")) return;
    if (cp.contains(e.target)) return;
    // Also ignore clicks on calendar cells (they open the popover)
    if (e.target.closest(".scheduler-cell") || e.target.closest(".scheduler-week-slot")) return;
    closeCreateModal();
  });

  // Escape key
  document.addEventListener("keydown", function (e) {
    var cp = configCtx.getCreatePopover();
    if (e.key === "Escape" && cp && !cp.classList.contains("hidden")) {
      // Close open accordions first
      var openAcc = cp.querySelector(".sched-accordion.open");
      if (openAcc) {
        openAcc.classList.remove("open");
        var openBody = openAcc.querySelector(".sched-accordion-body");
        if (openBody) openBody.classList.add("hidden");
        return;
      }
      closeCreateModal();
    }
  });
}

function updateTaskSubtitle() {
  var sub = document.getElementById("sched-accordion-task-subtitle");
  if (!sub) return;
  var taskLabel = document.getElementById("sched-create-task-label");
  var taskName = (taskLabel && taskLabel.textContent !== "Select a task") ? taskLabel.textContent : null;
  if (!taskName) {
    sub.textContent = "What to run";
  } else {
    sub.textContent = taskName;
  }
}

function updateRecurrenceBtn() {
  var acc = document.getElementById("sched-accordion-repeat");
  var hasVal = createRecurrence !== "none";
  if (acc) {
    acc.classList.toggle("has-value", hasVal);
  }
  var clearBtn = document.getElementById("sched-accordion-repeat-clear");
  if (clearBtn) clearBtn.classList.toggle("hidden", !hasVal);
  // Update subtitle with summary or default description
  var sub = document.getElementById("sched-accordion-repeat-subtitle");
  if (!sub) return;
  if (createRecurrence === "none" || !createCustomConfirmed) {
    sub.textContent = "Which days to run";
    return;
  }
  var interval = document.getElementById("sched-custom-interval").value || "1";
  var unit = document.getElementById("sched-custom-unit").value || "week";
  var summary = "Every " + interval + " " + unit;
  if (unit === "week") {
    var activeDow = document.querySelectorAll("#sched-custom-dow-row .sched-dow-btn.active");
    if (activeDow.length > 0) {
      var days = [];
      for (var di = 0; di < activeDow.length; di++) days.push(activeDow[di].textContent);
      summary += " on " + days.join(", ");
    }
  }
  sub.textContent = summary;
}

/**
 * When today is selected, set min on the time input so past times appear disabled.
 * If the current time value is before now, bump it to the next quarter-hour.
 */
function enforceMinTime() {
  var timeInput = document.getElementById("sched-create-time");
  var datePicker = document.getElementById("sched-create-date-picker");
  if (!timeInput || !datePicker) return;

  var now = new Date();
  var todayStr = now.getFullYear() + "-" + configCtx.pad(now.getMonth() + 1) + "-" + configCtx.pad(now.getDate());
  var isToday = datePicker.value === todayStr;

  if (isToday) {
    // Round up to the next minute for min
    var minMinutes = now.getHours() * 60 + now.getMinutes() + 1;
    var minH = Math.floor(minMinutes / 60);
    var minM = minMinutes % 60;
    if (minH >= 24) { minH = 23; minM = 59; }
    var minVal = configCtx.pad(minH) + ":" + configCtx.pad(minM);
    timeInput.min = minVal;

    // If current value is before min, bump it
    if (timeInput.value < minVal) {
      timeInput.value = minVal;
    }
  } else {
    timeInput.removeAttribute("min");
  }
}

function updateIntervalBtn() {
  var acc = document.getElementById("sched-accordion-interval");
  var hasVal = createInterval !== "none";
  if (acc) {
    acc.classList.toggle("has-value", hasVal);
  }
  var clearBtn = document.getElementById("sched-accordion-interval-clear");
  if (clearBtn) clearBtn.classList.toggle("hidden", !hasVal);
  // Show/hide interval end conditions section
  var endSection = document.getElementById("sched-interval-end-section");
  if (endSection) {
    endSection.classList.toggle("hidden", createInterval === "none");
  }
  // Update subtitle
  var sub = document.getElementById("sched-accordion-interval-subtitle");
  if (sub) {
    if (createInterval === "none" || !createIntervalCustom) {
      sub.textContent = "How often within each day";
    } else {
      var v = createIntervalCustom.value || 10;
      var u = createIntervalCustom.unit === "hour" ? "hrs" : "min";
      sub.textContent = "Every " + v + " " + u;
    }
  }
  updateRecurrenceBtn();
}

export function getPreviewEl() {
  return previewEl;
}

export function removePreview() {
  if (previewEl && previewEl.parentNode) {
    previewEl.parentNode.removeChild(previewEl);
  }
  previewEl = null;
}

export function showPreviewOnCell(cell) {
  removePreview();
  var dragState = configCtx.getDragState();
  var label = dragState.draggedTaskName || "(No title)";
  var el = document.createElement("div");
  el.className = "scheduler-event preview";
  el.textContent = label;
  cell.appendChild(el);
  previewEl = el;
}

export function showPreviewOnSlot(slot) {
  removePreview();
  var dragState = configCtx.getDragState();
  var label = dragState.draggedTaskName || "(No title)";
  var hour = parseInt(slot.dataset.hour, 10);
  var quarter = parseInt(slot.dataset.quarter || "0", 10);
  var minute = quarter * 15;
  var timeStr = configCtx.pad(hour) + ":" + configCtx.pad(minute);
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

export function showPreviewForCreate(anchorEl, label) {
  removePreview();
  if (!anchorEl) return;
  var text = label || "(No title)";
  if (anchorEl.classList.contains("scheduler-week-slot")) {
    var hour = parseInt(anchorEl.dataset.hour, 10);
    var quarter = parseInt(anchorEl.dataset.quarter || "0", 10);
    var minute = quarter * 15;
    var timeStr = configCtx.pad(hour) + ":" + configCtx.pad(minute);
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

export function applyDraggedTask() {
  var dragState = configCtx.getDragState();
  if (!dragState.draggedTaskId) return;
  var taskHidden = document.getElementById("sched-create-task");
  var taskLabel = document.getElementById("sched-create-task-label");
  var taskBtn = document.getElementById("sched-create-task-btn");
  if (taskHidden) taskHidden.value = dragState.draggedTaskId;
  if (taskLabel) taskLabel.textContent = dragState.draggedTaskName || dragState.draggedTaskId;
  if (taskBtn) { taskBtn.classList.add("has-value"); taskBtn.classList.remove("invalid"); }
  updateTaskSubtitle();
  // Mark the matching item as selected in the dropdown list
  var taskListEl = document.getElementById("sched-create-task-list");
  if (taskListEl) {
    var items = taskListEl.querySelectorAll(".sched-create-task-item");
    for (var k = 0; k < items.length; k++) {
      items[k].classList.toggle("selected", items[k].dataset.taskId === dragState.draggedTaskId);
    }
  }
  // Auto-generate title: "taskName - HH:MM"
  var titleInput = document.getElementById("sched-create-title");
  var timeInput = document.getElementById("sched-create-time");
  if (titleInput && (dragState.draggedTaskName || dragState.draggedTaskId)) {
    var name = dragState.draggedTaskName || dragState.draggedTaskId;
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
  configCtx.clearDragState();
}

export function openCreateModalWithRecord(rec, anchorEl) {
  var createPopover = configCtx.getCreatePopover();
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

  // Show description row only if the record already has one
  var descRow = document.getElementById("sched-create-desc-row");
  var descInput = document.getElementById("sched-create-desc");
  if (rec.description) {
    if (descInput) descInput.value = rec.description;
    if (descRow) descRow.classList.remove("hidden");
  } else {
    if (descInput) descInput.value = "";
    if (descRow) descRow.classList.add("hidden");
  }

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

  // Set skip-if-running
  var skipRunningEl = document.getElementById("sched-skip-running");
  if (skipRunningEl) skipRunningEl.checked = rec.skipIfRunning !== false;

  // Set linked task
  if (rec.linkedTaskId) {
    var taskHidden = document.getElementById("sched-create-task");
    var taskLabel2 = document.getElementById("sched-create-task-label");
    var taskBtn = document.getElementById("sched-create-task-btn");
    var taskListEl = document.getElementById("sched-create-task-list");
    var records = configCtx.getRecords();
    if (taskHidden) taskHidden.value = rec.linkedTaskId;
    // Find the task name
    var taskName = rec.linkedTaskId;
    for (var j = 0; j < records.length; j++) {
      if (records[j].id === rec.linkedTaskId) { taskName = records[j].name || records[j].id; break; }
    }
    if (taskLabel2) taskLabel2.textContent = taskName;
    if (taskBtn) { taskBtn.classList.add("has-value"); taskBtn.classList.remove("invalid"); }
    // (no accordion to update)
    if (taskListEl) {
      var items = taskListEl.querySelectorAll(".sched-create-task-item");
      for (var k = 0; k < items.length; k++) {
        items[k].classList.toggle("selected", items[k].dataset.taskId === rec.linkedTaskId);
      }
    }
    updateTaskSubtitle();
  }

  // Restore interval from cron
  if (rec.cron) {
    var cronParts = rec.cron.trim().split(/\s+/);
    if (cronParts.length === 5) {
      var detectedMinInterval = null;
      var detectedHrInterval = null;
      // Detect minute-level interval: e.g. "0,5,10,... * * * *" or "*/5 * * * *"
      if (cronParts[1] === "*" && cronParts[2] === "*") {
        detectedMinInterval = configCtx.detectInterval(cronParts[0], 60);
      }
      // Detect hour-level interval: e.g. "0 1,3,5,... * * *"
      if (!detectedMinInterval && cronParts[2] === "*") {
        detectedHrInterval = configCtx.detectInterval(cronParts[1], 24);
      }

      if (detectedMinInterval) {
        createInterval = "custom";
        createIntervalCustom = { value: detectedMinInterval, unit: "minute" };
        var intValEl = document.getElementById("sched-interval-custom-value");
        if (intValEl) intValEl.value = detectedMinInterval;
        var intUnitBtns = document.querySelectorAll("#sched-interval-custom-unit .sched-interval-seg");
        for (var iu = 0; iu < intUnitBtns.length; iu++) {
          intUnitBtns[iu].classList.toggle("active", intUnitBtns[iu].dataset.unit === "minute");
        }
        updateIntervalBtn();
      } else if (detectedHrInterval) {
        createInterval = "custom";
        createIntervalCustom = { value: detectedHrInterval, unit: "hour" };
        var intValEl2 = document.getElementById("sched-interval-custom-value");
        if (intValEl2) intValEl2.value = detectedHrInterval;
        var intUnitBtns2 = document.querySelectorAll("#sched-interval-custom-unit .sched-interval-seg");
        for (var iu2 = 0; iu2 < intUnitBtns2.length; iu2++) {
          intUnitBtns2[iu2].classList.toggle("active", intUnitBtns2[iu2].dataset.unit === "hour");
        }
        updateIntervalBtn();
      }

      // Restore recurrence from cron (if no interval detected, or combined with interval)
      if (!detectedMinInterval && !detectedHrInterval) {
        var cronDow = cronParts[4];
        var cronDom = cronParts[2];
        var cronMonth = cronParts[3];
        if (cronDow === "*" && cronDom === "*" && cronMonth === "*") {
          createRecurrence = "daily";
        } else if (cronDow === "1-5" && cronDom === "*") {
          createRecurrence = "weekdays";
        } else if (cronDom !== "*" && cronMonth !== "*") {
          createRecurrence = "yearly";
        } else if (cronDom !== "*" && cronDow === "*") {
          createRecurrence = "monthly";
        } else if (cronDow !== "*" && cronDom === "*") {
          // Check if it matches a single day (weekly)
          var dowVals = cronDow.split(",");
          if (dowVals.length === 1) {
            createRecurrence = "weekly";
          } else if (dowVals.length === 7) {
            createRecurrence = "daily";
          } else {
            createRecurrence = "custom";
            createCustomConfirmed = true;
            // Set custom panel values
            document.getElementById("sched-custom-interval").value = "1";
            document.getElementById("sched-custom-unit").value = "week";
            var customDowBtns = document.querySelectorAll("#sched-custom-dow-row .sched-dow-btn");
            for (var cd = 0; cd < customDowBtns.length; cd++) {
              customDowBtns[cd].classList.toggle("active", dowVals.indexOf(customDowBtns[cd].dataset.dow) !== -1);
            }
          }
        }
        updateRecurrenceBtn();
      }
    }
  }

  // Restore interval end conditions
  if (rec.intervalEnd) {
    createIntervalEnd = rec.intervalEnd.type || "allday";
    var editIendOpts = document.querySelectorAll(".sched-interval-end-opt");
    for (var ei = 0; ei < editIendOpts.length; ei++) {
      editIendOpts[ei].classList.toggle("active", editIendOpts[ei].dataset.iend === createIntervalEnd);
    }
    var editAfterRow = document.getElementById("sched-interval-end-after-row");
    var editUntilRow = document.getElementById("sched-interval-end-until-row");
    if (createIntervalEnd === "after") {
      createIntervalEndAfter = rec.intervalEnd.count || 5;
      if (editAfterRow) editAfterRow.classList.remove("hidden");
      if (editUntilRow) editUntilRow.classList.add("hidden");
      var editAfterInput = document.getElementById("sched-interval-end-after");
      if (editAfterInput) editAfterInput.value = createIntervalEndAfter;
    } else if (createIntervalEnd === "until") {
      createIntervalEndTime = rec.intervalEnd.time || "18:00";
      if (editAfterRow) editAfterRow.classList.add("hidden");
      if (editUntilRow) editUntilRow.classList.remove("hidden");
      var editTimeInput = document.getElementById("sched-interval-end-time");
      if (editTimeInput) editTimeInput.value = createIntervalEndTime;
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

export function openCreateModal(date, hour, anchorEl) {
  var createPopover = configCtx.getCreatePopover();
  if (!createPopover) return;
  // Reset editing state (openCreateModalWithRecord sets this before calling us)
  if (!createEditingRecId) {
    var deleteBtn = document.getElementById("sched-create-delete");
    if (deleteBtn) deleteBtn.classList.add("hidden");
  }
  createSelectedDate = date || new Date();
  createRecurrence = "none";
  createCustomConfirmed = false;
  createInterval = "none";
  createIntervalCustom = null;
  createIntervalEnd = "allday";
  createIntervalEndAfter = 5;
  createIntervalEndTime = "";
  createColor = "#ffb86c";

  // Reset form
  document.getElementById("sched-create-title").value = "";
  document.getElementById("sched-create-desc").value = "";
  var descRowReset = document.getElementById("sched-create-desc-row");
  if (descRowReset) descRowReset.classList.add("hidden");
  // (task is always visible, no accordion reset needed)

  // Reset color
  var colorDot = document.getElementById("sched-create-color-dot");
  if (colorDot) colorDot.style.background = createColor;
  var palette = document.getElementById("sched-create-color-palette");
  if (palette) palette.classList.add("hidden");
  var swatches = createPopover.querySelectorAll(".sched-color-swatch");
  for (var si = 0; si < swatches.length; si++) {
    swatches[si].classList.toggle("active", swatches[si].dataset.color === createColor);
  }

  // Populate task dropdown (only tasks -- exclude ralph and schedule)
  var taskHidden = document.getElementById("sched-create-task");
  var taskLabel = document.getElementById("sched-create-task-label");
  var taskBtn = document.getElementById("sched-create-task-btn");
  var taskListEl = document.getElementById("sched-create-task-list");
  var records = configCtx.getRecords();
  if (taskHidden) taskHidden.value = "";
  if (taskLabel) taskLabel.textContent = "Select a task";
  if (taskBtn) { taskBtn.classList.remove("has-value"); taskBtn.classList.remove("invalid"); }
  if (taskListEl) {
    taskListEl.classList.add("hidden");
    var tasks = records.filter(function (r) { return r.source !== "ralph" && r.source !== "schedule"; });
    var html = "";
    if (tasks.length === 0) {
      html = '<div class="sched-create-task-empty">No tasks available</div>';
    } else {
      for (var i = 0; i < tasks.length; i++) {
        html += '<div class="sched-create-task-item" data-task-id="' + configCtx.esc(tasks[i].id) + '">' + configCtx.esc(tasks[i].name || tasks[i].id) + '</div>';
      }
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
          // (no accordion to update)
          // Update selected state
          var all = taskListEl.querySelectorAll(".sched-create-task-item");
          for (var k = 0; k < all.length; k++) {
            all[k].classList.toggle("selected", all[k] === item);
          }
          taskListEl.classList.add("hidden");
          updateTaskSubtitle();
        });
      })(items[j]);
    }
  }

  // Set date picker
  var dateStr = createSelectedDate.getFullYear() + "-" + configCtx.pad(createSelectedDate.getMonth() + 1) + "-" + configCtx.pad(createSelectedDate.getDate());
  document.getElementById("sched-create-date").value = dateStr;
  var datePicker = document.getElementById("sched-create-date-picker");
  if (datePicker) {
    datePicker.value = dateStr;
    var todayNow = new Date();
    var todayMin = todayNow.getFullYear() + "-" + configCtx.pad(todayNow.getMonth() + 1) + "-" + configCtx.pad(todayNow.getDate());
    datePicker.min = todayMin;
  }

  // Time (use minutes from createSelectedDate for 15-min snapping)
  if (hour !== null && hour !== undefined) {
    var mins = createSelectedDate.getMinutes ? createSelectedDate.getMinutes() : 0;
    document.getElementById("sched-create-time").value = configCtx.pad(hour) + ":" + configCtx.pad(mins);
  } else {
    // Default to current time (next quarter-hour)
    var nowT = new Date();
    var nowMins = nowT.getHours() * 60 + nowT.getMinutes();
    var nextQ = Math.ceil(nowMins / 15) * 15;
    var defH = Math.floor(nextQ / 60);
    var defM = nextQ % 60;
    if (defH >= 24) { defH = 23; defM = 45; }
    document.getElementById("sched-create-time").value = configCtx.pad(defH) + ":" + configCtx.pad(defM);
  }

  // Update recurrence labels
  updateRecurrenceLabels(createSelectedDate);

  // Enforce min time for today
  enforceMinTime();

  // Reset recurrence
  createRecurrence = "none";
  createCustomConfirmed = false;
  updateRecurrenceBtn();

  // Reset interval accordion
  document.getElementById("sched-accordion-interval").classList.remove("open");
  document.getElementById("sched-accordion-interval-body").classList.add("hidden");
  var timeInput = document.getElementById("sched-create-time");
  if (timeInput) timeInput.style.display = "";

  // Reset interval end conditions
  var iendOpts = document.querySelectorAll(".sched-interval-end-opt");
  for (var ie = 0; ie < iendOpts.length; ie++) {
    iendOpts[ie].classList.toggle("active", iendOpts[ie].dataset.iend === "allday");
  }
  var iendAfterRow = document.getElementById("sched-interval-end-after-row");
  if (iendAfterRow) iendAfterRow.classList.add("hidden");
  var iendUntilRow = document.getElementById("sched-interval-end-until-row");
  if (iendUntilRow) iendUntilRow.classList.add("hidden");
  var iendAfterInput = document.getElementById("sched-interval-end-after");
  if (iendAfterInput) iendAfterInput.value = "5";
  var iendTimeInput = document.getElementById("sched-interval-end-time");
  if (iendTimeInput) iendTimeInput.value = "18:00";

  updateIntervalBtn();

  // Reset repeat accordion
  document.getElementById("sched-accordion-repeat").classList.remove("open");
  document.getElementById("sched-accordion-repeat-body").classList.add("hidden");
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
  var dragState = configCtx.getDragState();
  showPreviewForCreate(anchorEl, dragState.draggedTaskName || null);

  // Position near anchor cell
  createPopover.classList.remove("hidden");
  positionCreatePopover(anchorEl);

  try { lucide.createIcons({ node: createPopover }); } catch (e) {}
  setTimeout(function () { document.getElementById("sched-create-title").focus(); }, 50);
}

function positionCreatePopover(anchorEl) {
  var createPopover = configCtx.getCreatePopover();
  var contentCalEl = configCtx.getContentCalEl();
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

export function closeCreateModal() {
  var createPopover = configCtx.getCreatePopover();
  if (createPopover) createPopover.classList.add("hidden");
  // Collapse accordions
  var accRepeat = document.getElementById("sched-accordion-repeat");
  if (accRepeat) { accRepeat.classList.remove("open"); }
  var accRepeatBody = document.getElementById("sched-accordion-repeat-body");
  if (accRepeatBody) accRepeatBody.classList.add("hidden");
  var accInterval = document.getElementById("sched-accordion-interval");
  if (accInterval) { accInterval.classList.remove("open"); }
  var accIntervalBody = document.getElementById("sched-accordion-interval-body");
  if (accIntervalBody) accIntervalBody.classList.add("hidden");
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
    dialog.dataset.eventDate = eventDate.getFullYear() + "-" + configCtx.pad(eventDate.getMonth() + 1) + "-" + configCtx.pad(eventDate.getDate());
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
        if (rid) configCtx.send({ type: "loop_registry_remove", id: rid });
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

// Build an explicit list of values offset from a start value with a given step, wrapping at max
function buildOffsetList(start, step, max) {
  var vals = [];
  var v = start % max;
  for (var i = 0; i < max; i += step) {
    vals.push(v);
    v = (v + step) % max;
  }
  vals.sort(function (a, b) { return a - b; });
  return vals.join(",");
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

  // Determine interval minutes
  var intervalMins = 0;
  if (createInterval !== "none") {
    if (createInterval === "custom" && createIntervalCustom) {
      intervalMins = createIntervalCustom.unit === "hour"
        ? createIntervalCustom.value * 60
        : createIntervalCustom.value;
    } else {
      intervalMins = parseInt(createInterval, 10) || 0;
    }
  }

  // Interval only (no recurrence) = interval every day
  if (intervalMins > 0 && createRecurrence === "none") {
    if (intervalMins < 60) return buildOffsetList(m, intervalMins, 60) + " * * * *";
    var intHrs = Math.floor(intervalMins / 60);
    return String(m) + " " + buildOffsetList(h, intHrs, 24) + " * * *";
  }

  if (createRecurrence === "none" && intervalMins === 0) return null;

  // Build minute/hour fields from interval or time
  var minField = String(m);
  var hourField = String(h);
  if (intervalMins > 0 && intervalMins < 60) {
    minField = buildOffsetList(m, intervalMins, 60);
    hourField = "*";
  } else if (intervalMins >= 60) {
    var intHrs2 = Math.floor(intervalMins / 60);
    minField = String(m);
    hourField = buildOffsetList(h, intHrs2, 24);
  }

  if (createRecurrence === "daily") return minField + " " + hourField + " * * *";
  if (createRecurrence === "weekly") return minField + " " + hourField + " * * " + dow;
  if (createRecurrence === "biweekly") {
    var weekNum = Math.ceil(dom / 7);
    return minField + " " + hourField + " " + ((weekNum - 1) * 7 + 1) + "-" + (weekNum * 7) + " * " + dow;
  }
  if (createRecurrence === "yearly") return minField + " " + hourField + " " + dom + " " + month + " *";
  if (createRecurrence === "monthly") return minField + " " + hourField + " " + dom + " * *";
  if (createRecurrence === "weekdays") return minField + " " + hourField + " * * 1-5";

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

  if (unit === "minute") {
    return interval === 1 ? "*/1 * * * *" : buildOffsetList(m, interval, 60) + " * * * *";
  }
  if (unit === "hour") {
    return interval === 1 ? m + " */1 * * *" : m + " " + buildOffsetList(h, interval, 24) + " * * *";
  }
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

  var ctx = configCtx.ctx;
  ctx.requireClayRalph(function () {
    var createPopover = configCtx.getCreatePopover();
    var descInput = document.getElementById("sched-create-desc");
    var description = descInput ? descInput.value.trim() : "";
    var datePicker = document.getElementById("sched-create-date-picker");
    var dateVal = datePicker ? datePicker.value : document.getElementById("sched-create-date").value;
    var timeVal = document.getElementById("sched-create-time").value || "09:00";

    // Reject scheduling in the past
    if (dateVal && timeVal) {
      var dp = dateVal.split("-");
      var tp = timeVal.split(":");
      if (dp.length === 3 && tp.length >= 2) {
        var schedDate = new Date(
          parseInt(dp[0], 10), parseInt(dp[1], 10) - 1, parseInt(dp[2], 10),
          parseInt(tp[0], 10), parseInt(tp[1], 10), 0
        );
        if (schedDate < new Date()) {
          showToast("Cannot schedule a task in the past", "error");
          return;
        }
      }
    }

    var cron = buildCreateCron();

    // Build recurrence end info
    var recurrenceEnd = null;
    // Interval-only (no recurrence): limit to the scheduled date only
    if (cron && createRecurrence === "none" && createInterval !== "none" && dateVal) {
      recurrenceEnd = { type: "until", date: dateVal };
    }
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

    // Build interval end info
    var intervalEnd = null;
    if (createInterval !== "none") {
      if (createIntervalEnd === "after" && createIntervalEndAfter > 0) {
        intervalEnd = { type: "after", count: createIntervalEndAfter };
      } else if (createIntervalEnd === "until" && createIntervalEndTime) {
        intervalEnd = { type: "until", time: createIntervalEndTime };
      }
      // "allday" = null (no limit)
    }

    var skipRunningEl = document.getElementById("sched-skip-running");
    var skipIfRunning = skipRunningEl ? skipRunningEl.checked : true;
    var customDays = Array.from(document.querySelectorAll("#sched-custom-dow-row .sched-dow-btn.active")).map(function (button) { return Number(button.dataset.dow); });
    var scheduleRule = legacyScheduleRule({ anchorDate: dateVal, time: timeVal, anchorWeekday: createSelectedDate.getDay(), repeatType: createRecurrence !== "custom" || createCustomConfirmed ? createRecurrence : "none", repeatEvery: parseInt(document.getElementById("sched-custom-interval").value, 10) || 1, repeatUnit: document.getElementById("sched-custom-unit").value, weekdays: customDays, recurrenceEnd: recurrenceEnd, interval: createInterval !== "none" && createIntervalCustom ? { every: createIntervalCustom.value, unit: createIntervalCustom.unit, end: intervalEnd } : null });

    if (createEditingRecId) {
      configCtx.send({
        type: "loop_registry_update",
        id: createEditingRecId,
        data: {
          name: name,
          description: description,
          date: dateVal,
          time: timeVal,
          allDay: false,
          cron: cron,
          enabled: cron ? true : false,
          color: createColor,
          recurrenceEnd: recurrenceEnd,
          intervalEnd: intervalEnd,
          scheduleRule: scheduleRule,
          skipIfRunning: skipIfRunning,
        },
      });
    } else {
      configCtx.send({
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
          intervalEnd: intervalEnd,
          scheduleRule: scheduleRule,
          skipIfRunning: skipIfRunning,
        },
      });
    }

    closeCreateModal();
  });
}

// --- Cron parser (client-side) ---

export function parseCronSimple(expr) {
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
