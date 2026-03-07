// server-settings.js — Full-screen server settings overlay
import { refreshIcons } from './icons.js';
import { showToast, copyToClipboard } from './utils.js';
import { parseEnvString, looksLikeEnv } from './project-settings.js';

var ctx = null;
var settingsEl = null;
var settingsBtn = null;
var closeBtn = null;
var navItems = null;
var sections = null;
var statsTimer = null;

var SS_MODE_OPTIONS = [
  { value: "default", label: "Default", desc: "Claude asks for permission before running tools and editing files." },
  { value: "plan", label: "Plan", desc: "Claude creates a plan first and asks for approval before making changes." },
  { value: "acceptEdits", label: "Auto-accept edits", desc: "File edits are applied automatically. Claude still asks before running commands." },
];

var SS_EFFORT_LEVELS = [
  { value: "low", desc: "Quick, concise responses. Best for simple questions." },
  { value: "medium", desc: "Balanced responses with moderate reasoning. Good for most tasks." },
  { value: "high", desc: "Thorough responses with deeper analysis. Good for complex tasks." },
  { value: "max", desc: "Maximum reasoning depth. Best for the most difficult problems." },
];

var SS_MODEL_DESCRIPTIONS = {
  "default": "Automatically selects the best model for the task.",
  "sonnet": "Fast and capable. Great balance of speed and intelligence.",
  "haiku": "Fastest model. Best for quick tasks and simple questions.",
  "opus": "Most powerful model. Best for complex reasoning and analysis.",
};

export function initServerSettings(appCtx) {
  ctx = appCtx;
  settingsEl = document.getElementById("server-settings");
  settingsBtn = document.getElementById("server-settings-btn");
  closeBtn = document.getElementById("server-settings-close");

  if (!settingsEl || !settingsBtn) return;

  navItems = settingsEl.querySelectorAll(".settings-nav-item");
  sections = settingsEl.querySelectorAll(".server-settings-section");

  // Open settings
  settingsBtn.addEventListener("click", function () {
    openSettings();
  });

  // Close settings
  closeBtn.addEventListener("click", function () {
    closeSettings();
  });

  // ESC to close
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !settingsEl.classList.contains("hidden")) {
      closeSettings();
    }
  });

  // Nav item clicks
  for (var i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener("click", function () {
      var section = this.dataset.section;
      switchSection(section);
    });
  }

  // Copyable command blocks
  var copyables = settingsEl.querySelectorAll(".settings-copyable");
  for (var c = 0; c < copyables.length; c++) {
    copyables[c].addEventListener("click", function () {
      var text = this.dataset.copy;
      if (!text) return;
      var btn = this.querySelector(".settings-copy-btn");
      copyToClipboard(text).then(function () {
        if (btn) {
          var orig = btn.textContent;
          btn.textContent = "✓";
          setTimeout(function () { btn.textContent = orig; }, 1500);
        }
        showToast("Copied to clipboard");
      });
    });
  }

  // Notification toggles
  var notifAlert = document.getElementById("settings-notif-alert");
  var notifSound = document.getElementById("settings-notif-sound");
  var notifPush = document.getElementById("settings-notif-push");

  if (notifAlert) {
    notifAlert.addEventListener("change", function () {
      var src = document.getElementById("notif-toggle-alert");
      if (src) {
        src.checked = this.checked;
        src.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  if (notifSound) {
    notifSound.addEventListener("change", function () {
      var src = document.getElementById("notif-toggle-sound");
      if (src) {
        src.checked = this.checked;
        src.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  if (notifPush) {
    notifPush.addEventListener("change", function () {
      var src = document.getElementById("notif-toggle-push");
      if (src) {
        src.checked = this.checked;
        src.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  // Model item click
  settingsEl.addEventListener("click", function (e) {
    var modelItem = e.target.closest(".settings-model-item");
    if (!modelItem) return;
    var model = modelItem.dataset.model;
    if (!model) return;
    var ws = ctx.ws;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "set_server_default_model", model: model }));
    }
  });

  // PIN buttons
  var pinSetBtn = document.getElementById("settings-pin-set-btn");
  var pinRemoveBtn = document.getElementById("settings-pin-remove-btn");
  var pinSaveBtn = document.getElementById("settings-pin-save-btn");
  var pinCancelBtn = document.getElementById("settings-pin-cancel-btn");
  var pinInput = document.getElementById("settings-pin-input");

  if (pinSetBtn) pinSetBtn.addEventListener("click", function () { showPinForm(); });
  if (pinRemoveBtn) pinRemoveBtn.addEventListener("click", function () {
    var ws = ctx.ws;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "set_pin", pin: null }));
    }
  });
  if (pinSaveBtn) pinSaveBtn.addEventListener("click", function () { submitPin(); });
  if (pinCancelBtn) pinCancelBtn.addEventListener("click", function () { hidePinForm(); });
  if (pinInput) pinInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submitPin(); }
    if (e.key === "Escape") { e.preventDefault(); hidePinForm(); }
  });

  // Keep awake toggle
  var keepAwakeToggle = document.getElementById("settings-keep-awake");
  if (keepAwakeToggle) {
    keepAwakeToggle.addEventListener("change", function () {
      var ws = ctx.ws;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "set_keep_awake", value: this.checked }));
      }
    });
  }

  // Global CLAUDE.md: save button
  var ssClaudeMdSave = document.getElementById("ss-claudemd-save");
  if (ssClaudeMdSave) {
    ssClaudeMdSave.addEventListener("click", function () { saveGlobalClaudeMd(); });
  }

  // Shared environment: add button
  var ssEnvAddBtn = document.getElementById("ss-env-add-btn");
  if (ssEnvAddBtn) {
    ssEnvAddBtn.addEventListener("click", function () {
      addSharedEnvRow("", "", true);
      autoSaveSharedEnv();
    });
  }

  // Restart server
  var restartBtn = document.getElementById("settings-restart-btn");
  if (restartBtn) {
    restartBtn.addEventListener("click", function () {
      var ws = ctx.ws;
      if (ws && ws.readyState === 1) {
        restartBtn.disabled = true;
        restartBtn.textContent = "Restarting...";
        ws.send(JSON.stringify({ type: "restart_server" }));
      }
    });
  }

  // Shutdown server
  var shutdownInput = document.getElementById("settings-shutdown-input");
  var shutdownBtn = document.getElementById("settings-shutdown-btn");

  if (shutdownInput && shutdownBtn) {
    shutdownInput.addEventListener("input", function () {
      var val = this.value.trim().toLowerCase();
      shutdownBtn.disabled = val !== "shutdown";
    });

    shutdownInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!shutdownBtn.disabled) shutdownBtn.click();
      }
    });

    shutdownBtn.addEventListener("click", function () {
      var val = shutdownInput.value.trim().toLowerCase();
      if (val !== "shutdown") return;
      var ws = ctx.ws;
      if (ws && ws.readyState === 1) {
        shutdownBtn.disabled = true;
        shutdownBtn.textContent = "Shutting down...";
        shutdownInput.disabled = true;
        ws.send(JSON.stringify({ type: "shutdown_server" }));
      }
    });
  }
}

function switchSection(sectionName) {
  for (var i = 0; i < navItems.length; i++) {
    var isActive = navItems[i].dataset.section === sectionName;
    navItems[i].classList.toggle("active", isActive);
    // On mobile, scroll the active tab into view
    if (isActive) {
      navItems[i].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }
  for (var j = 0; j < sections.length; j++) {
    var isActive2 = sections[j].dataset.section === sectionName;
    sections[j].classList.toggle("active", isActive2);
  }

  // Lazy-load section data
  if (sectionName === "claudemd") loadGlobalClaudeMd();
  if (sectionName === "environment") loadSharedEnv();
}

function openSettings() {
  settingsEl.classList.remove("hidden");
  settingsBtn.classList.add("active");
  refreshIcons(settingsEl);
  populateSettings();
  requestDaemonConfig();
  resetRestartButton();
  resetShutdownForm();

  // Start periodic stats refresh
  requestStats();
  statsTimer = setInterval(requestStats, 5000);
}

function resetRestartButton() {
  var btn = document.getElementById("settings-restart-btn");
  var errorEl = document.getElementById("settings-restart-error");
  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="refresh-cw" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Restart Server'; }
  if (errorEl) errorEl.classList.add("hidden");
}

function resetShutdownForm() {
  var input = document.getElementById("settings-shutdown-input");
  var btn = document.getElementById("settings-shutdown-btn");
  var errorEl = document.getElementById("settings-shutdown-error");
  if (input) { input.value = ""; input.disabled = false; }
  if (btn) { btn.disabled = true; btn.textContent = "Shutdown"; }
  if (errorEl) errorEl.classList.add("hidden");
}

function closeSettings() {
  settingsEl.classList.add("hidden");
  settingsBtn.classList.remove("active");
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
}

export function isSettingsOpen() {
  return settingsEl && !settingsEl.classList.contains("hidden");
}

function requestStats() {
  var ws = ctx.ws;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "process_stats" }));
  }
}

function populateSettings() {
  // Server name
  var nameEl = document.getElementById("settings-server-name");
  var projNameEl = document.getElementById("settings-project-name");
  var cwdEl = document.getElementById("settings-project-cwd");
  var versionEl = document.getElementById("settings-server-version");
  var slugEl = document.getElementById("settings-project-slug");
  var wsPathEl = document.getElementById("settings-ws-path");
  var skipPermsEl = document.getElementById("settings-skip-perms");

  var projectName = ctx.projectName || "-";
  if (nameEl) nameEl.textContent = projectName;
  if (projNameEl) projNameEl.textContent = projectName;
  if (cwdEl) cwdEl.textContent = ctx.projectName || "-";

  var footerVersion = document.getElementById("footer-version");
  if (versionEl && footerVersion) {
    versionEl.textContent = footerVersion.textContent || "-";
  }

  if (slugEl) slugEl.textContent = ctx.currentSlug || "(default)";
  if (wsPathEl) wsPathEl.textContent = ctx.wsPath || "/ws";

  // Skip permissions
  var spBanner = document.getElementById("skip-perms-banner");
  if (skipPermsEl) {
    var isSkip = spBanner && !spBanner.classList.contains("hidden");
    skipPermsEl.textContent = isSkip ? "Enabled" : "Disabled";
    skipPermsEl.classList.toggle("settings-badge-on", isSkip);
  }

  // Sync notification toggles
  syncNotifToggles();

  // Session defaults
  updateModelList();
  updateModeList();
  updateEffortBar();
  updateSsBetaCard();
}

function syncNotifToggles() {
  var pairs = [
    ["notif-toggle-alert", "settings-notif-alert"],
    ["notif-toggle-sound", "settings-notif-sound"],
    ["notif-toggle-push", "settings-notif-push"],
  ];
  for (var i = 0; i < pairs.length; i++) {
    var src = document.getElementById(pairs[i][0]);
    var dst = document.getElementById(pairs[i][1]);
    if (src && dst) dst.checked = src.checked;
  }
}

function ssGetModelDesc(model) {
  if (!model) return "";
  var lower = model.toLowerCase();
  for (var key in SS_MODEL_DESCRIPTIONS) {
    if (lower.indexOf(key) !== -1) return SS_MODEL_DESCRIPTIONS[key];
  }
  return "";
}

function ssIsSonnetModel(model) {
  if (!model) return false;
  return model.toLowerCase().indexOf("sonnet") !== -1;
}

function updateModelList() {
  var listEl = document.getElementById("settings-model-list");
  if (!listEl) return;

  var models = ctx.currentModels || [];
  var currentModel = ctx.currentModel || ctx._currentModelValue || "";

  listEl.innerHTML = "";
  if (models.length === 0) {
    listEl.innerHTML = '<div style="font-size:13px;color:var(--text-dimmer);">No models available</div>';
    return;
  }

  for (var i = 0; i < models.length; i++) {
    (function (m) {
      var value = m.value || "";
      var label = m.displayName || value;
      var item = document.createElement("div");
      item.className = "settings-model-item";
      if (value === currentModel) item.classList.add("active");
      item.dataset.model = value;

      var nameSpan = document.createElement("span");
      nameSpan.className = "settings-model-name";
      nameSpan.textContent = label;
      item.appendChild(nameSpan);

      var desc = ssGetModelDesc(value);
      if (desc) {
        var descSpan = document.createElement("span");
        descSpan.className = "settings-model-desc";
        descSpan.textContent = desc;
        item.appendChild(descSpan);
      }

      item.addEventListener("click", function () {
        var ws = ctx.ws;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_model", model: value }));
        }
        var items = listEl.querySelectorAll(".settings-model-item");
        for (var j = 0; j < items.length; j++) items[j].classList.remove("active");
        item.classList.add("active");
        updateSsBetaCard(value);
      });

      listEl.appendChild(item);
    })(models[i]);
  }
}

function updateModeList() {
  var listEl = document.getElementById("ss-mode-list");
  if (!listEl) return;

  var currentMode = ctx.currentMode || "default";
  listEl.innerHTML = "";

  for (var i = 0; i < SS_MODE_OPTIONS.length; i++) {
    (function (opt) {
      var item = document.createElement("div");
      item.className = "settings-model-item" + (opt.value === currentMode ? " active" : "");

      var nameSpan = document.createElement("span");
      nameSpan.className = "settings-model-name";
      nameSpan.textContent = opt.label;
      item.appendChild(nameSpan);

      var descSpan = document.createElement("span");
      descSpan.className = "settings-model-desc";
      descSpan.textContent = opt.desc;
      item.appendChild(descSpan);

      item.addEventListener("click", function () {
        var ws = ctx.ws;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_server_default_mode", mode: opt.value }));
        }
        var items = listEl.querySelectorAll(".settings-model-item");
        for (var j = 0; j < items.length; j++) items[j].classList.remove("active");
        item.classList.add("active");
      });

      listEl.appendChild(item);
    })(SS_MODE_OPTIONS[i]);
  }
}

function updateEffortBar() {
  var bar = document.getElementById("ss-effort-bar");
  if (!bar) return;

  var currentEffort = ctx.currentEffort || "medium";
  bar.innerHTML = "";

  for (var i = 0; i < SS_EFFORT_LEVELS.length; i++) {
    (function (lvl) {
      var btn = document.createElement("button");
      btn.className = "settings-btn-option" + (lvl.value === currentEffort ? " active" : "");
      btn.textContent = lvl.value.charAt(0).toUpperCase() + lvl.value.slice(1);
      btn.title = lvl.desc;
      btn.addEventListener("click", function () {
        var ws = ctx.ws;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_server_default_effort", effort: lvl.value }));
        }
        var btns = bar.querySelectorAll(".settings-btn-option");
        for (var j = 0; j < btns.length; j++) btns[j].classList.remove("active");
        btn.classList.add("active");
      });
      bar.appendChild(btn);
    })(SS_EFFORT_LEVELS[i]);
  }
}

function updateSsBetaCard(overrideModel) {
  var model = overrideModel || ctx.currentModel || ctx._currentModelValue || "";
  var card = document.getElementById("ss-beta-card");
  if (card) {
    card.style.display = ssIsSonnetModel(model) ? "" : "none";
  }

  var toggle = document.getElementById("ss-beta-1m");
  if (toggle) {
    var betas = ctx.currentBetas || [];
    var hasBeta = false;
    for (var i = 0; i < betas.length; i++) {
      if (betas[i].indexOf("context-1m") !== -1) { hasBeta = true; break; }
    }
    toggle.checked = hasBeta;
    toggle.onchange = function () {
      ssToggleBeta1m(this.checked);
    };
  }
}

function ssToggleBeta1m(enable) {
  var betas = ctx.currentBetas || [];
  var newBetas;
  if (enable) {
    newBetas = betas.slice();
    newBetas.push("context-1m-2025-08-07");
  } else {
    newBetas = [];
    for (var i = 0; i < betas.length; i++) {
      if (betas[i].indexOf("context-1m") === -1) {
        newBetas.push(betas[i]);
      }
    }
  }
  var ws = ctx.ws;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "set_betas", betas: newBetas }));
  }
}

export function updateSettingsStats(data) {
  if (!isSettingsOpen()) return;
  var pid = document.getElementById("settings-status-pid");
  var uptime = document.getElementById("settings-status-uptime");
  var rss = document.getElementById("settings-status-rss");
  var sessions = document.getElementById("settings-status-sessions");
  var clients = document.getElementById("settings-status-clients");

  if (pid) pid.textContent = String(data.pid);
  if (uptime) uptime.textContent = formatUptime(data.uptime);
  if (rss) rss.textContent = formatBytes(data.memory.rss);
  if (sessions) sessions.textContent = String(data.sessions);
  if (clients) clients.textContent = String(data.clients);
}

export function updateSettingsModels(current, models) {
  if (!ctx) return;
  ctx.currentModels = models;
  ctx._currentModelValue = current;
  if (isSettingsOpen()) {
    updateModelList();
    updateModeList();
    updateEffortBar();
    updateSsBetaCard();
  }
}

// --- Daemon config ---
function requestDaemonConfig() {
  var ws = ctx.ws;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "get_daemon_config" }));
  }
}

export function updateDaemonConfig(config) {
  // Port
  var portEl = document.getElementById("settings-port");
  if (portEl) portEl.textContent = String(config.port || "-");

  // TLS
  var tlsEl = document.getElementById("settings-tls");
  if (tlsEl) {
    tlsEl.textContent = config.tls ? "Enabled" : "Disabled";
    tlsEl.classList.toggle("settings-badge-green", !!config.tls);
  }

  // Debug
  var debugEl = document.getElementById("settings-debug");
  if (debugEl) {
    debugEl.textContent = config.debug ? "Enabled" : "Disabled";
    debugEl.classList.toggle("settings-badge-on", !!config.debug);
  }

  // PIN status
  updatePinStatus(!!config.pinEnabled);

  // Keep awake
  var keepAwakeToggle = document.getElementById("settings-keep-awake");
  if (keepAwakeToggle) keepAwakeToggle.checked = !!config.keepAwake;

  // Show keep awake card only on macOS
  var keepAwakeCard = document.getElementById("settings-keep-awake-card");
  if (keepAwakeCard) {
    if (config.platform === "darwin") {
      keepAwakeCard.classList.remove("hidden");
    } else {
      keepAwakeCard.classList.add("hidden");
    }
  }
}

export function handleSetPinResult(msg) {
  if (msg.ok) {
    updatePinStatus(!!msg.pinEnabled);
    hidePinForm();
    showToast(msg.pinEnabled ? "PIN set successfully" : "PIN removed");
  }
}

export function handleKeepAwakeChanged(msg) {
  var keepAwakeToggle = document.getElementById("settings-keep-awake");
  if (keepAwakeToggle) keepAwakeToggle.checked = !!msg.keepAwake;
}

export function handleRestartResult(msg) {
  var restartBtn = document.getElementById("settings-restart-btn");
  var errorEl = document.getElementById("settings-restart-error");

  if (msg.ok) {
    if (restartBtn) restartBtn.textContent = "Server restarting...";
    showToast("Server is restarting...");
  } else {
    if (restartBtn) {
      restartBtn.textContent = "Restart Server";
      restartBtn.disabled = false;
    }
    if (errorEl) {
      errorEl.textContent = msg.error || "Restart failed";
      errorEl.classList.remove("hidden");
    }
  }
}

export function handleShutdownResult(msg) {
  var shutdownInput = document.getElementById("settings-shutdown-input");
  var shutdownBtn = document.getElementById("settings-shutdown-btn");
  var errorEl = document.getElementById("settings-shutdown-error");

  if (msg.ok) {
    if (shutdownBtn) shutdownBtn.textContent = "Server stopped";
    showToast("Server is shutting down...");
  } else {
    if (shutdownBtn) {
      shutdownBtn.textContent = "Shutdown";
      shutdownBtn.disabled = false;
    }
    if (shutdownInput) shutdownInput.disabled = false;
    if (errorEl) {
      errorEl.textContent = msg.error || "Shutdown failed";
      errorEl.classList.remove("hidden");
    }
  }
}

// --- PIN form management ---
function showPinForm() {
  var form = document.getElementById("settings-pin-form");
  var input = document.getElementById("settings-pin-input");
  var errorEl = document.getElementById("settings-pin-error");
  if (form) form.classList.remove("hidden");
  if (errorEl) errorEl.classList.add("hidden");
  if (input) { input.value = ""; input.focus(); }
}

function hidePinForm() {
  var form = document.getElementById("settings-pin-form");
  var input = document.getElementById("settings-pin-input");
  var errorEl = document.getElementById("settings-pin-error");
  if (form) form.classList.add("hidden");
  if (input) input.value = "";
  if (errorEl) errorEl.classList.add("hidden");
}

function submitPin() {
  var input = document.getElementById("settings-pin-input");
  var errorEl = document.getElementById("settings-pin-error");
  if (!input) return;
  var pin = input.value.trim();
  if (!/^\d{6}$/.test(pin)) {
    if (errorEl) errorEl.classList.remove("hidden");
    input.focus();
    return;
  }
  if (errorEl) errorEl.classList.add("hidden");
  var ws = ctx.ws;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "set_pin", pin: pin }));
  }
}

function updatePinStatus(enabled) {
  var statusEl = document.getElementById("settings-pin-status");
  var setBtn = document.getElementById("settings-pin-set-btn");
  var removeBtn = document.getElementById("settings-pin-remove-btn");
  var actionLabel = document.getElementById("settings-pin-action-label");

  if (statusEl) {
    statusEl.textContent = enabled ? "Enabled" : "Disabled";
    statusEl.classList.toggle("settings-badge-green", enabled);
  }
  if (setBtn) setBtn.textContent = enabled ? "Change PIN" : "Set PIN";
  if (removeBtn) removeBtn.classList.toggle("hidden", !enabled);
  if (actionLabel) actionLabel.textContent = enabled ? "Change PIN" : "Set PIN";
}

// ===== Global CLAUDE.md =====
function loadGlobalClaudeMd() {
  var editor = document.getElementById("ss-claudemd-editor");
  var status = document.getElementById("ss-claudemd-status");
  var saveStatus = document.getElementById("ss-claudemd-save-status");
  if (saveStatus) saveStatus.textContent = "";
  if (status) status.textContent = "Loading...";

  var ws = ctx.ws;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "read_global_claude_md" }));
  }
}

export function handleGlobalClaudeMdRead(msg) {
  var editor = document.getElementById("ss-claudemd-editor");
  var status = document.getElementById("ss-claudemd-status");
  if (!editor) return;

  if (msg.error) {
    editor.value = "";
    if (status) status.textContent = "No global CLAUDE.md found. Save to create one.";
  } else {
    editor.value = msg.content || "";
    if (status) status.textContent = "";
  }
}

function saveGlobalClaudeMd() {
  var editor = document.getElementById("ss-claudemd-editor");
  var saveStatus = document.getElementById("ss-claudemd-save-status");
  if (!editor) return;

  var ws = ctx.ws;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "write_global_claude_md", content: editor.value }));
    if (saveStatus) saveStatus.textContent = "Saving...";
  }
}

export function handleGlobalClaudeMdWrite(msg) {
  var saveStatus = document.getElementById("ss-claudemd-save-status");
  if (!saveStatus) return;
  if (msg.ok) {
    saveStatus.textContent = "Saved";
    setTimeout(function () { saveStatus.textContent = ""; }, 2000);
  } else {
    saveStatus.textContent = "Error: " + (msg.error || "Failed to save");
  }
}

// ===== Shared Environment Variables =====
var sharedEnvSaveTimer = null;

function loadSharedEnv() {
  var saveStatus = document.getElementById("ss-env-save-status");
  if (saveStatus) saveStatus.textContent = "";

  var ws = ctx.ws;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "get_shared_env" }));
  }
}

export function handleSharedEnv(msg) {
  var list = document.getElementById("ss-env-list");
  if (!list) return;
  list.innerHTML = "";

  var pairs = parseEnvString(msg.envrc || "");
  for (var i = 0; i < pairs.length; i++) {
    addSharedEnvRow(pairs[i].key, pairs[i].value, false);
  }
  refreshIcons();
}

export function handleSharedEnvSaved(msg) {
  var saveStatus = document.getElementById("ss-env-save-status");
  if (!saveStatus) return;
  if (msg.ok) {
    saveStatus.textContent = "Saved";
    setTimeout(function () { saveStatus.textContent = ""; }, 2000);
  } else {
    saveStatus.textContent = "Error: " + (msg.error || "Failed to save");
  }
}

function buildSharedEnvString() {
  var list = document.getElementById("ss-env-list");
  if (!list) return "";
  var rows = list.querySelectorAll(".ps-env-row");
  var lines = [];
  for (var i = 0; i < rows.length; i++) {
    var keyInput = rows[i].querySelector(".ps-env-key");
    var valInput = rows[i].querySelector(".ps-env-val");
    var key = keyInput ? keyInput.value.trim() : "";
    var val = valInput ? valInput.value : "";
    if (key) lines.push("export " + key + "=" + val);
  }
  return lines.join("\n");
}

function addSharedEnvRow(key, value, focus) {
  var list = document.getElementById("ss-env-list");
  if (!list) return;

  var row = document.createElement("div");
  row.className = "ps-env-row";

  var keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "ps-env-key";
  keyInput.placeholder = "KEY";
  keyInput.value = key;
  keyInput.spellcheck = false;
  keyInput.autocomplete = "off";

  var valInput = document.createElement("input");
  valInput.type = "text";
  valInput.className = "ps-env-val";
  valInput.placeholder = "value";
  valInput.value = value;
  valInput.spellcheck = false;
  valInput.autocomplete = "off";

  var delBtn = document.createElement("button");
  delBtn.className = "ps-env-del";
  delBtn.title = "Remove";
  delBtn.innerHTML = '<i data-lucide="x"></i>';

  delBtn.addEventListener("click", function () {
    row.remove();
    autoSaveSharedEnv();
  });

  keyInput.addEventListener("input", function () { autoSaveSharedEnv(); });
  valInput.addEventListener("input", function () { autoSaveSharedEnv(); });

  // Paste detection
  keyInput.addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (text && looksLikeEnv(text)) {
      e.preventDefault();
      var pairs = parseEnvString(text);
      if (pairs.length > 0) {
        keyInput.value = pairs[0].key;
        valInput.value = pairs[0].value;
        for (var p = 1; p < pairs.length; p++) {
          addSharedEnvRow(pairs[p].key, pairs[p].value, false);
        }
        autoSaveSharedEnv();
      }
    }
  });

  valInput.addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (text && text.indexOf("\n") !== -1 && text.indexOf("=") !== -1) {
      e.preventDefault();
      var pairs = parseEnvString(text);
      if (pairs.length > 0) {
        keyInput.value = pairs[0].key;
        valInput.value = pairs[0].value;
        for (var p = 1; p < pairs.length; p++) {
          addSharedEnvRow(pairs[p].key, pairs[p].value, false);
        }
        autoSaveSharedEnv();
      }
    }
  });

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(delBtn);
  list.appendChild(row);
  refreshIcons();

  if (focus) keyInput.focus();
}

function autoSaveSharedEnv() {
  if (sharedEnvSaveTimer) clearTimeout(sharedEnvSaveTimer);
  sharedEnvSaveTimer = setTimeout(function () {
    var envrc = buildSharedEnvString();
    var ws = ctx.ws;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "set_shared_env", envrc: envrc }));
      var saveStatus = document.getElementById("ss-env-save-status");
      if (saveStatus) {
        saveStatus.textContent = "Saved";
        setTimeout(function () { saveStatus.textContent = ""; }, 2000);
      }
    }
  }, 800);
}

function formatBytes(n) {
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

function formatUptime(seconds) {
  var d = Math.floor(seconds / 86400);
  var h = Math.floor((seconds % 86400) / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  if (d > 0) return d + "d " + h + "h " + m + "m";
  if (h > 0) return h + "h " + m + "m " + s + "s";
  return m + "m " + s + "s";
}
