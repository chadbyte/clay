// app-loop-ui.js - Ralph Loop UI: bars, banners, preview modal, execution modal

import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml } from './utils.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showConfirm } from './app-misc.js';
import { openScheduledTasks } from './scheduled-tasks.js';
import { renderModelList, renderModeList, renderEffortBar, renderThinkingBar } from './settings-defaults.js';
import { showDebateSticky } from './app-debate-ui.js';

// Execution modal: module-internal UI var (not in store)
var pendingIterations = 20;

// ========================================================
// Init
// ========================================================
export function initLoopUi() {

  // --- Reactive UI sync for loop state ---
  store.subscribe(function (state, prev) {
    if (state.loopActive !== prev.loopActive ||
        state.ralphPhase !== prev.ralphPhase ||
        state.loopIteration !== prev.loopIteration ||
        state.loopMaxIterations !== prev.loopMaxIterations) {
      updateLoopButton();
    }
    if (state.ralphPhase !== prev.ralphPhase ||
        state.ralphCraftingSessionId !== prev.ralphCraftingSessionId ||
        state.ralphCraftingSource !== prev.ralphCraftingSource ||
        state.activeSessionId !== prev.activeSessionId) {
      updateRalphBars();
    }
  });

  // --- Preview modal listeners ---
  // Backdrop click intentionally does NOT close the modal (no way to reopen it)

  // Run button in preview modal footer
  var previewRunBtn = document.getElementById("ralph-preview-run");
  if (previewRunBtn) {
    previewRunBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeRalphPreviewModal();
      startLoopFromUi();
    });
  }

  // Delete/cancel button in preview modal header
  var previewDeleteBtn = document.getElementById("ralph-preview-delete");
  if (previewDeleteBtn) {
    previewDeleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeRalphPreviewModal();
      showConfirm("Discard this loop setup?", function() {
        var ws = getWs();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ralph_wizard_cancel" }));
        }
        var stickyEl = document.getElementById("ralph-sticky");
        if (stickyEl) {
          stickyEl.classList.add("hidden");
          stickyEl.classList.remove("ralph-ready");
          stickyEl.innerHTML = "";
        }
      });
    });
  }

  var previewTabs = document.querySelectorAll(".ralph-tab");
  for (var ti = 0; ti < previewTabs.length; ti++) {
    previewTabs[ti].addEventListener("click", function() {
      showRalphPreviewTab(this.getAttribute("data-tab"));
    });
  }

  // Iterations input in preview modal footer
  var previewIterInput = document.getElementById("ralph-preview-iterations");
  if (previewIterInput) {
    previewIterInput.addEventListener("input", function () {
      pendingIterations = parseInt(this.value, 10) || pendingIterations;
      syncIterationsUi();
    });
  }
}

// ========================================================
// Iteration sync helper
// ========================================================

function syncIterationsUi() {
  var wizData = store.get('wizardData') || {};
  var isSimple = wizData.loopMode === "simple";
  var label = isSimple ? ("Run x" + pendingIterations) : ("Start (max " + pendingIterations + ")");

  // Sync sticky bar input
  var stickyIter = document.getElementById("ralph-sticky-iterations");
  if (stickyIter && parseInt(stickyIter.value, 10) !== pendingIterations) {
    stickyIter.value = pendingIterations;
  }
  var stickyStartBtn = document.querySelector(".ralph-sticky-start");
  if (stickyStartBtn) stickyStartBtn.title = label;

  // Sync preview modal input
  var previewIter = document.getElementById("ralph-preview-iterations");
  if (previewIter && parseInt(previewIter.value, 10) !== pendingIterations) {
    previewIter.value = pendingIterations;
  }
  var comboLabel = document.getElementById("ralph-run-combo-label");
  if (comboLabel) comboLabel.textContent = isSimple ? "Run x" : "Start max";
}

// ========================================================
// Start loop from UI (shared by sticky bar + exec modal)
// ========================================================

function startLoopFromUi() {
  var basePath = store.get('basePath');
  var stickyEl = document.getElementById("ralph-sticky");

  fetch(basePath + "api/git-dirty")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.dirty) {
        var fileList = (data.files || []).slice(0, 15).join("\n");
        if (data.files && data.files.length > 15) fileList += "\n... and " + (data.files.length - 15) + " more";
        var msg = "You have uncommitted changes. The loop uses git diff to track progress, so uncommitted files may cause unexpected results.\n\n" + fileList + "\n\nStart anyway?";
        showConfirm(msg, function () {
          sendLoopStart();
          if (stickyEl) { stickyEl.classList.add("hidden"); stickyEl.innerHTML = ""; }
        }, "Start anyway", false);
      } else {
        sendLoopStart();
        if (stickyEl) { stickyEl.classList.add("hidden"); stickyEl.innerHTML = ""; }
      }
    })
    .catch(function () {
      sendLoopStart();
      if (stickyEl) { stickyEl.classList.add("hidden"); stickyEl.innerHTML = ""; }
    });
}

function sendLoopStart() {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    var msg = { type: "loop_start", maxIterations: pendingIterations };
    if (Object.keys(_previewLoopSettings).length > 0) {
      msg.settings = _previewLoopSettings;
    }
    ws.send(JSON.stringify(msg));
  }
}

// ========================================================
// Loop UI (exported)
// ========================================================

export function updateLoopInputVisibility(loop) {
  var inputArea = document.getElementById("input-area");
  if (!inputArea) return;
  if (loop && loop.active && loop.role !== "crafting") {
    inputArea.style.display = "none";
  } else {
    inputArea.style.display = "";
  }
}

export function updateLoopButton() {
  var section = document.getElementById("ralph-loop-section");
  if (!section) return;

  var s = store.snap();
  var busy = s.loopActive || s.ralphPhase === "executing";
  var phase = busy ? "executing" : s.ralphPhase;

  var statusHtml = "";
  var statusClass = "";
  var clickAction = "wizard"; // default

  if (phase === "crafting") {
    statusHtml = '<span class="ralph-section-status crafting">' + iconHtml("loader", "icon-spin") + ' Crafting\u2026</span>';
    clickAction = "none";
  } else if (phase === "approval") {
    statusHtml = '<span class="ralph-section-status ready">Ready</span>';
    statusClass = "ralph-section-ready";
    clickAction = "none";
  } else if (phase === "executing") {
    var iterText = s.loopIteration > 0 ? "Running \u00b7 iteration " + s.loopIteration + "/" + s.loopMaxIterations : "Starting\u2026";
    statusHtml = '<span class="ralph-section-status running">' + iconHtml("loader", "icon-spin") + ' ' + iterText + '</span>';
    statusClass = "ralph-section-running";
    clickAction = "popover";
  } else if (phase === "done") {
    statusHtml = '<span class="ralph-section-status done">\u2713 Done</span>';
    statusHtml += '<a href="#" class="ralph-section-tasks-link">View in Scheduled</a>';
    statusClass = "ralph-section-done";
    clickAction = "wizard";
  } else {
    // idle
    statusHtml = '<span class="ralph-section-hint">Start a new loop</span>';
  }

  section.className = "ralph-loop-section" + (statusClass ? " " + statusClass : "");
  section.innerHTML =
    '<div class="ralph-section-inner">' +
      '<div class="ralph-section-header">' +
        '<span class="ralph-section-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="ralph-section-label">Loop</span>' +
        '<span class="loop-experimental"><i data-lucide="flask-conical"></i> experimental</span>' +
      '</div>' +
      '<div class="ralph-section-body">' + statusHtml + '</div>' +
    '</div>';

  refreshIcons();

  // Click handler on header
  var header = section.querySelector(".ralph-section-header");
  if (header) {
    header.style.cursor = clickAction === "none" ? "default" : "pointer";
    header.addEventListener("click", function() {
      if (clickAction === "popover") {
        toggleLoopPopover();
      }
    });
  }

  // "View in Scheduled" link
  var tasksLink = section.querySelector(".ralph-section-tasks-link");
  if (tasksLink) {
    tasksLink.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      openScheduledTasks();
    });
  }
}

export function showLoopBanner(show) {
  var stickyEl = document.getElementById("ralph-sticky");
  if (!stickyEl) { updateLoopButton(); return; }
  if (!show) {
    stickyEl.classList.add("hidden");
    stickyEl.classList.remove("ralph-running");
    stickyEl.innerHTML = "";
    updateLoopButton();
    return;
  }

  var bannerLabel = store.get('loopBannerName') || "Loop";
  stickyEl.innerHTML =
    '<div class="ralph-sticky-inner">' +
      '<div class="ralph-sticky-header">' +
        '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="ralph-sticky-label">' + escapeHtml(bannerLabel) + '</span>' +
        '<span class="ralph-sticky-status" id="loop-status">Starting\u2026</span>' +
        '<button class="ralph-sticky-action ralph-sticky-stop" title="Stop loop">' + iconHtml("square") + '</button>' +
      '</div>' +
    '</div>';
  stickyEl.classList.remove("hidden", "ralph-ready");
  stickyEl.classList.add("ralph-running");
  refreshIcons();

  stickyEl.querySelector(".ralph-sticky-stop").addEventListener("click", function(e) {
    e.stopPropagation();
    var w = getWs();
    if (w && w.readyState === 1) {
      w.send(JSON.stringify({ type: "loop_stop" }));
    }
  });
  updateLoopButton();
}

export function updateLoopBanner(iteration, maxIterations, phase) {
  var statusEl = document.getElementById("loop-status");
  if (!statusEl) return;
  var text;
  if (phase === "stopping") {
    text = "Stopping\u2026";
  } else if (maxIterations <= 1) {
    text = phase === "judging" ? "judging\u2026" : "running";
  } else {
    text = "#" + iteration + "/" + maxIterations;
    if (phase === "judging") text += " judging\u2026";
    else text += " running";
  }
  statusEl.textContent = text;
}

export function updateRalphBars() {
  // Task source uses the scheduler panel, not the sticky bar
  var s = store.snap();
  var isTaskSource = s.ralphCraftingSource !== "ralph";
  var onCraftingSession = s.ralphCraftingSessionId && s.activeSessionId === s.ralphCraftingSessionId;
  // If approval phase but no craftingSessionId (recovered after server restart), show bar anyway
  var recoveredApproval = s.ralphPhase === "approval" && !s.ralphCraftingSessionId;
  if (!isTaskSource && s.ralphPhase === "crafting" && onCraftingSession) {
    showRalphCraftingBar(true);
  } else {
    showRalphCraftingBar(false);
  }
  if (!isTaskSource && s.ralphPhase === "approval") {
    showRalphApprovalBar(true);
  } else {
    showRalphApprovalBar(false);
  }
  // Restore running loop banner on session switch
  if (s.loopActive && s.ralphPhase === "executing") {
    showLoopBanner(true);
    if (s.loopIteration > 0) {
      updateLoopBanner(s.loopIteration, s.loopMaxIterations, "running");
    }
  }

  // Restore debate sticky on session switch
  var debateStickyState = store.get('debateStickyState');
  if (debateStickyState && debateStickyState.phase) {
    showDebateSticky(debateStickyState.phase, debateStickyState.msg);
  } else {
    showDebateSticky("hide", null);
  }
}

// ========================================================
// Internal: toggleLoopPopover
// ========================================================

function toggleLoopPopover() {
  var existing = document.getElementById("loop-status-modal");
  if (existing) {
    existing.remove();
    return;
  }

  var wizData = store.get('wizardData') || {};
  var taskPreview = wizData.task || "\u2014";
  if (taskPreview.length > 120) taskPreview = taskPreview.substring(0, 120) + "\u2026";
  var _s = store.snap();
  var statusText = "Iteration #" + _s.loopIteration + " / " + _s.loopMaxIterations;

  var modal = document.createElement("div");
  modal.id = "loop-status-modal";
  modal.className = "loop-status-modal";
  modal.innerHTML =
    '<div class="loop-status-backdrop"></div>' +
    '<div class="loop-status-dialog">' +
      '<div class="loop-status-dialog-header">' +
        '<span class="loop-status-dialog-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="loop-status-dialog-title">Loop</span>' +
        '<button class="loop-status-dialog-close" title="Close">' + iconHtml("x") + '</button>' +
      '</div>' +
      '<div class="loop-status-dialog-body">' +
        '<div class="loop-status-dialog-row">' +
          '<span class="loop-status-dialog-label">Progress</span>' +
          '<span class="loop-status-dialog-value">' + escapeHtml(statusText) + '</span>' +
        '</div>' +
        '<div class="loop-status-dialog-row">' +
          '<span class="loop-status-dialog-label">Task</span>' +
          '<span class="loop-status-dialog-value loop-status-dialog-task">' + escapeHtml(taskPreview) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="loop-status-dialog-footer">' +
        '<button class="loop-status-dialog-stop">' + iconHtml("square") + ' Stop loop</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  refreshIcons();

  function closeModal() { modal.remove(); }

  modal.querySelector(".loop-status-backdrop").addEventListener("click", closeModal);
  modal.querySelector(".loop-status-dialog-close").addEventListener("click", closeModal);

  modal.querySelector(".loop-status-dialog-stop").addEventListener("click", function(e) {
    e.stopPropagation();
    closeModal();
    showConfirm("Stop the running " + (store.get('loopBannerName') || "loop") + "?", function() {
      var w = getWs();
      if (w && w.readyState === 1) {
        w.send(JSON.stringify({ type: "loop_stop" }));
      }
    });
  });
}

// ========================================================
// Crafting / Approval bars (exported)
// ========================================================

export function showRalphCraftingBar(show) {
  var stickyEl = document.getElementById("ralph-sticky");
  if (!stickyEl) return;
  if (!show) {
    stickyEl.classList.add("hidden");
    stickyEl.innerHTML = "";
    return;
  }
  stickyEl.innerHTML =
    '<div class="ralph-sticky-inner">' +
      '<div class="ralph-sticky-header">' +
        '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="ralph-sticky-label">Ralph</span>' +
        '<span class="ralph-sticky-status">' + iconHtml("loader", "icon-spin") + ' Preparing\u2026</span>' +
        '<button class="ralph-sticky-cancel" title="Cancel">' + iconHtml("x") + '</button>' +
      '</div>' +
    '</div>';
  stickyEl.classList.remove("hidden");
  refreshIcons();

  var cancelBtn = stickyEl.querySelector(".ralph-sticky-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ralph_cancel_crafting" }));
      }
      showRalphCraftingBar(false);
      showRalphApprovalBar(false);
    });
  }
}

export function showRalphApprovalBar(show) {
  var stickyEl = document.getElementById("ralph-sticky");
  if (!stickyEl) return;
  if (!show) {
    // Only clear if we're in approval mode (don't clobber crafting)
    if (store.get('ralphPhase') !== "crafting") {
      stickyEl.classList.add("hidden");
      stickyEl.innerHTML = "";
    }
    return;
  }

  var wizData = store.get('wizardData') || {};
  var isSimple = wizData.loopMode === "simple";
  var defaultIter = isSimple ? 5 : 20;
  pendingIterations = defaultIter;

  var runLabel = isSimple ? ("Run x" + defaultIter) : ("Start (max " + defaultIter + ")");

  stickyEl.innerHTML =
    '<div class="ralph-sticky-inner">' +
      '<div class="ralph-sticky-header" id="ralph-sticky-header">' +
        '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="ralph-sticky-label">Ralph</span>' +
        '<span class="ralph-sticky-status" id="ralph-sticky-status">Ready</span>' +
        '<input type="number" id="ralph-sticky-iterations" class="ralph-input-number ralph-sticky-iter" value="' + defaultIter + '" min="1" max="100">' +
        '<button class="ralph-sticky-action ralph-sticky-preview" title="Preview files">' + iconHtml("eye") + '</button>' +
        '<button class="ralph-sticky-action ralph-sticky-start" title="' + runLabel + '">' + iconHtml(wizData.cron ? "calendar-clock" : "play") + '</button>' +
        '<button class="ralph-sticky-action ralph-sticky-dismiss" title="Cancel and discard">' + iconHtml("x") + '</button>' +
      '</div>' +
    '</div>';
  stickyEl.classList.remove("hidden");
  refreshIcons();

  // Iteration input handler
  var stickyIterInput = document.getElementById("ralph-sticky-iterations");
  if (stickyIterInput) {
    stickyIterInput.addEventListener("input", function () {
      pendingIterations = parseInt(this.value, 10) || pendingIterations;
      syncIterationsUi();
    });
  }

  stickyEl.querySelector(".ralph-sticky-preview").addEventListener("click", function(e) {
    e.stopPropagation();
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ralph_preview_files" }));
    }
  });

  stickyEl.querySelector(".ralph-sticky-start").addEventListener("click", function(e) {
    e.stopPropagation();
    startLoopFromUi();
  });

  stickyEl.querySelector(".ralph-sticky-dismiss").addEventListener("click", function(e) {
    e.stopPropagation();
    showConfirm("Discard this Ralph Loop setup?", function() {
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ralph_wizard_cancel" }));
      }
      stickyEl.classList.add("hidden");
      stickyEl.classList.remove("ralph-ready");
      stickyEl.innerHTML = "";
    });
  });

  updateRalphApprovalStatus();
}

export function updateRalphApprovalStatus() {
  var stickyEl = document.getElementById("ralph-sticky");
  var statusEl = document.getElementById("ralph-sticky-status");
  var startBtn = document.querySelector(".ralph-sticky-start");
  if (!statusEl) return;

  var wizData = store.get('wizardData') || {};
  var isSimple = wizData.loopMode === "simple";
  var _rf = store.get('ralphFilesReady');
  var ready = isSimple ? _rf.promptReady : _rf.bothReady;

  if (ready) {
    statusEl.textContent = "Ready";
    if (startBtn) startBtn.disabled = false;
    if (stickyEl) stickyEl.classList.add("ralph-ready");
  } else if (_rf.promptReady || _rf.judgeReady) {
    statusEl.textContent = "Partial\u2026";
    if (startBtn) startBtn.disabled = true;
    if (stickyEl) stickyEl.classList.remove("ralph-ready");
  } else {
    statusEl.textContent = "Waiting\u2026";
    if (startBtn) startBtn.disabled = true;
    if (stickyEl) stickyEl.classList.remove("ralph-ready");
  }
}

// ========================================================
// Preview modal (exported: openRalphPreviewModal, showExecModal)
// The preview modal doubles as the execution modal.
// showExecModal opens it with auto-popup flag set.
// ========================================================

export function showExecModal() {
  store.set({ execModalShown: true });
  // Open the preview modal immediately, then request file content to fill in
  openRalphPreviewModal();
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "ralph_preview_files" }));
  }
}

export function closeExecModal() {
  closeRalphPreviewModal();
}

export function updateExecModalStatus() {
  // no-op, preview modal updates on open
}

export function openRalphPreviewModal() {
  // Only show for loop (ralph) source, not scheduled tasks
  var st = store.snap();
  if (st.ralphCraftingSource !== "ralph") return;

  var modal = document.getElementById("ralph-preview-modal");
  if (!modal) return;

  var wizData = st.wizardData || {};
  var isSimple = wizData.loopMode === "simple";

  // Set defaults if not yet set
  if (!pendingIterations || pendingIterations <= 0) {
    pendingIterations = isSimple ? 5 : 20;
  }

  // Set name
  var nameEl = document.getElementById("ralph-preview-name");
  if (nameEl) {
    nameEl.textContent = (wizData && wizData.name) || "Loop";
  }

  // Hide JUDGE.md tab for simple loop
  var judgeTab = document.querySelector('#ralph-preview-modal .ralph-tab[data-tab="judge"]');
  if (judgeTab) judgeTab.style.display = isSimple ? "none" : "";

  // Update footer: iteration label + run button
  var iterInput = document.getElementById("ralph-preview-iterations");
  if (iterInput) iterInput.value = pendingIterations;

  var comboLabel = document.getElementById("ralph-run-combo-label");
  if (comboLabel) comboLabel.textContent = isSimple ? "Run x" : "Start max";

  var runBtn = document.getElementById("ralph-preview-run");
  if (runBtn) runBtn.disabled = !store.get('ralphFilesReady').bothReady;

  _previewLoopSettings = {};
  showRalphPreviewTab("prompt");
  modal.classList.remove("hidden");
  refreshIcons();
  syncIterationsUi();
}

function closeRalphPreviewModal() {
  var modal = document.getElementById("ralph-preview-modal");
  if (modal) modal.classList.add("hidden");
}

// Pending loop settings for the preview modal (saved to LOOP.json on launch)
var _previewLoopSettings = {};

function getPreviewLoopSettings() { return _previewLoopSettings; }

function showRalphPreviewTab(tab) {
  var tabs = document.querySelectorAll("#ralph-preview-modal .ralph-tab");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute("data-tab") === tab) {
      tabs[i].classList.add("active");
    } else {
      tabs[i].classList.remove("active");
    }
  }
  var body = document.getElementById("ralph-preview-body");
  if (!body) return;

  if (tab === "model") {
    renderPreviewModelTab(body);
    return;
  }

  var _rpc = store.get('ralphPreviewContent');
  var content = tab === "prompt" ? _rpc.prompt : _rpc.judge;
  if (typeof marked !== "undefined" && marked.parse) {
    body.innerHTML = '<div class="md-content">' + DOMPurify.sanitize(marked.parse(content)) + '</div>';
  } else {
    body.textContent = content;
  }
}

function renderPreviewModelTab(bodyEl) {
  var s = store.snap();

  bodyEl.innerHTML =
    '<div class="scheduler-model-settings">' +
      '<div class="settings-card"><div class="settings-field">' +
        '<label class="settings-label">Model</label>' +
        '<div class="settings-hint">Choose the Claude model for this loop.</div>' +
        '<div id="rp-model-list" class="settings-model-list"></div>' +
      '</div></div>' +
      '<div class="settings-card"><div class="settings-field">' +
        '<label class="settings-label">Mode</label>' +
        '<div class="settings-hint">Controls how Claude handles tool use and file edits.</div>' +
        '<div id="rp-mode-list" class="settings-model-list"></div>' +
      '</div></div>' +
      '<div class="settings-card"><div class="settings-field">' +
        '<label class="settings-label">Effort</label>' +
        '<div class="settings-hint">Controls how much thinking effort Claude puts into responses.</div>' +
        '<div class="settings-btn-group" id="rp-effort-bar"></div>' +
      '</div></div>' +
      '<div class="settings-card"><div class="settings-field">' +
        '<label class="settings-label">Thinking</label>' +
        '<div class="settings-hint">Controls whether Claude shows its reasoning process.</div>' +
        '<div class="settings-btn-group" id="rp-thinking-bar"></div>' +
        '<div id="rp-thinking-budget-row" class="settings-budget-row" style="display:none">' +
          '<label class="settings-budget-label">Budget tokens</label>' +
          '<input id="rp-thinking-budget" type="number" class="settings-budget-input" min="1024" max="128000" step="1024" value="10000">' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function savePreviewSetting(key, value) {
    _previewLoopSettings[key] = value;
  }

  var opts = {
    models: s.currentModels || [],
    currentModel: _previewLoopSettings.model || "",
    currentMode: _previewLoopSettings.permissionMode || "default",
    currentEffort: _previewLoopSettings.effort || "medium",
    currentThinking: _previewLoopSettings.thinking || "adaptive",
    currentThinkingBudget: _previewLoopSettings.thinkingBudget || 10000,
    sendMsg: function (msgType, data) {
      if (msgType === "rp_set_model") savePreviewSetting("model", data.model);
      else if (msgType === "rp_set_mode") savePreviewSetting("permissionMode", data.mode);
      else if (msgType === "rp_set_effort") savePreviewSetting("effort", data.effort);
      else if (msgType === "set_thinking") {
        savePreviewSetting("thinking", data.thinking);
        if (data.budgetTokens) savePreviewSetting("thinkingBudget", data.budgetTokens);
      }
    },
    modelMsgType: "rp_set_model",
    modeMsgType: "rp_set_mode",
    effortMsgType: "rp_set_effort",
  };

  renderModelList("rp", opts);
  renderModeList("rp", opts);
  renderEffortBar("rp", opts);
  renderThinkingBar("rp", opts);
}
