// server-settings.js — Full-screen server settings overlay
import { refreshIcons } from './icons.js';
import { getCurrentTheme } from './theme.js';
import { showToast } from './utils.js';

var ctx = null;
var settingsEl = null;
var settingsBtn = null;
var closeBtn = null;
var navItems = null;
var sections = null;
var statsTimer = null;

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

  // Context view buttons
  var contextViewEl = document.getElementById("settings-context-view");
  if (contextViewEl) {
    var btns = contextViewEl.querySelectorAll(".settings-btn-option");
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener("click", function () {
        var view = this.dataset.view;
        if (ctx.setContextView) ctx.setContextView(view);
        if (ctx.applyContextView) ctx.applyContextView(view);
        updateContextViewButtons();
      });
    }
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
      ws.send(JSON.stringify({ type: "set_model", model: model }));
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
}

function switchSection(sectionName) {
  for (var i = 0; i < navItems.length; i++) {
    var isActive = navItems[i].dataset.section === sectionName;
    navItems[i].classList.toggle("active", isActive);
  }
  for (var j = 0; j < sections.length; j++) {
    var isActive2 = sections[j].dataset.section === sectionName;
    sections[j].classList.toggle("active", isActive2);
  }
}

function openSettings() {
  settingsEl.classList.remove("hidden");
  settingsBtn.classList.add("active");
  refreshIcons(settingsEl);
  populateSettings();
  requestDaemonConfig();

  // Start periodic stats refresh
  requestStats();
  statsTimer = setInterval(requestStats, 5000);
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

  // Theme
  updateThemeDisplay();

  // Context view
  updateContextViewButtons();

  // Models
  updateModelList();
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

function updateThemeDisplay() {
  var themeEl = document.getElementById("settings-current-theme");
  if (!themeEl) return;
  var theme = getCurrentTheme();
  if (theme && theme.name) {
    themeEl.textContent = theme.name + " (" + (theme.variant || "dark") + ")";
  } else {
    themeEl.textContent = "Default";
  }
}

function updateContextViewButtons() {
  var view = "off";
  try { view = localStorage.getItem("clay-context-view") || "off"; } catch (e) {}
  var btns = document.querySelectorAll("#settings-context-view .settings-btn-option");
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle("active", btns[i].dataset.view === view);
  }
}

function updateModelList() {
  var listEl = document.getElementById("settings-model-list");
  var currentEl = document.getElementById("settings-current-model");
  if (!listEl) return;

  var models = ctx.currentModels || [];
  var currentLabel = document.getElementById("model-label");
  var currentModel = currentLabel ? currentLabel.textContent : "";

  if (currentEl) currentEl.textContent = currentModel || "-";

  listEl.innerHTML = "";
  if (models.length === 0) {
    listEl.innerHTML = '<div style="font-size:13px;color:var(--text-dimmer);">No models available</div>';
    return;
  }

  for (var i = 0; i < models.length; i++) {
    var m = models[i];
    var value = m.value || "";
    var label = m.displayName || value;
    var item = document.createElement("div");
    item.className = "settings-model-item";
    if (label === currentModel || value === currentModel) item.classList.add("active");
    item.dataset.model = value;
    item.textContent = label;
    listEl.appendChild(item);
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
  if (isSettingsOpen()) {
    updateModelList();
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
