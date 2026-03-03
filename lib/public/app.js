import { showToast, copyToClipboard, escapeHtml } from './modules/utils.js';
import { refreshIcons, iconHtml, randomThinkingVerb } from './modules/icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, closeMermaidModal } from './modules/markdown.js';
import { initSidebar, renderSessionList, handleSearchResults, updatePageTitle, getActiveSearchQuery, buildSearchTimeline, removeSearchTimeline, populateCliSessionList, renderIconStrip, initIconStrip } from './modules/sidebar.js';
import { initRewind, setRewindMode, showRewindModal, clearPendingRewindUuid } from './modules/rewind.js';
import { initNotifications, showDoneNotification, playDoneSound, isNotifAlertEnabled, isNotifSoundEnabled } from './modules/notifications.js';
import { initInput, clearPendingImages, handleInputSync, autoResize, builtinCommands } from './modules/input.js';
import { initQrCode } from './modules/qrcode.js';
import { initFileBrowser, loadRootDirectory, refreshTree, handleFsList, handleFsRead, handleDirChanged, refreshIfOpen, handleFileChanged, handleFileHistory, handleGitDiff, handleFileAt, getPendingNavigate, closeFileViewer } from './modules/filebrowser.js';
import { initTerminal, openTerminal, closeTerminal, resetTerminals, handleTermList, handleTermCreated, handleTermOutput, handleTermExited, handleTermClosed } from './modules/terminal.js';
import { initTheme, getThemeColor, getComputedVar, onThemeChange, getCurrentTheme } from './modules/theme.js';
import { initTools, resetToolState, saveToolState, restoreToolState, renderAskUserQuestion, markAskUserAnswered, renderPermissionRequest, markPermissionResolved, markPermissionCancelled, renderPlanBanner, renderPlanCard, handleTodoWrite, handleTaskCreate, handleTaskUpdate, startThinking, appendThinking, stopThinking, createToolItem, updateToolExecuting, updateToolResult, markAllToolsDone, addTurnMeta, enableMainInput, getTools, getPlanContent, setPlanContent, isPlanFilePath, getTodoTools, updateSubagentActivity, addSubagentToolEntry, markSubagentDone, closeToolGroup, removeToolFromGroup } from './modules/tools.js';
import { initServerSettings, updateSettingsStats, updateSettingsModels, updateDaemonConfig, handleSetPinResult, handleKeepAwakeChanged, handleShutdownResult } from './modules/server-settings.js';

// --- Base path for multi-project routing ---
  var slugMatch = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  var basePath = slugMatch ? "/p/" + slugMatch[1] + "/" : "/";
  var wsPath = slugMatch ? "/p/" + slugMatch[1] + "/ws" : "/ws";

// --- DOM refs ---
  var $ = function (id) { return document.getElementById(id); };
  var messagesEl = $("messages");
  var inputEl = $("input");
  var sendBtn = $("send-btn");
  function getStatusDot() {
    var active = document.querySelector("#icon-strip-projects .icon-strip-item.active .icon-strip-status");
    if (active) return active;
    // Fallback: home icon status dot
    return document.querySelector(".icon-strip-home .icon-strip-status");
  }
  var headerTitleEl = $("header-title");
  var headerRenameBtn = $("header-rename-btn");
  var slashMenu = $("slash-menu");
  var sidebar = $("sidebar");
  var sidebarOverlay = $("sidebar-overlay");
  var sessionListEl = $("session-list");
  var newSessionBtn = $("new-session-btn");
  var hamburgerBtn = $("hamburger-btn");
  var sidebarToggleBtn = $("sidebar-toggle-btn");
  var sidebarExpandBtn = $("sidebar-expand-btn");
  var resumeSessionBtn = $("resume-session-btn");
  var imagePreviewBar = $("image-preview-bar");
  var connectOverlay = $("connect-overlay");

  // --- Project List ---
  var projectListSection = $("project-list-section");
  var projectListEl = $("project-list");
  var projectListAddBtn = $("project-list-add");
  var projectHint = $("project-hint");
  var projectHintDismiss = $("project-hint-dismiss");
  var cachedProjects = [];
  var cachedProjectCount = 0;
  var currentSlug = slugMatch ? slugMatch[1] : null;

  function updateProjectList(msg) {
    if (typeof msg.projectCount === "number") cachedProjectCount = msg.projectCount;
    if (msg.projects) cachedProjects = msg.projects;
    var count = cachedProjectCount || 0;
    renderProjectList();
    if (count === 1 && projectHint) {
      try {
        if (!localStorage.getItem("clay-project-hint-dismissed")) {
          projectHint.classList.remove("hidden");
        }
      } catch (e) {}
    } else if (projectHint) {
      projectHint.classList.add("hidden");
    }
  }

  function renderProjectList() {
    // Render icon strip projects
    var iconStripProjects = cachedProjects.map(function (p) {
      return { slug: p.slug, name: p.title || p.project, isProcessing: p.isProcessing };
    });
    renderIconStrip(iconStripProjects, currentSlug);
    // Re-apply current socket status to the active icon's dot
    var dot = getStatusDot();
    if (dot) {
      if (connected && processing) { dot.classList.add("connected"); dot.classList.add("processing"); }
      else if (connected) { dot.classList.add("connected"); }
    }
  }

  if (projectListAddBtn) {
    projectListAddBtn.addEventListener("click", function () {
      openAddProjectModal();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeImageModal();
    }
  });

  if (projectHintDismiss) {
    projectHintDismiss.addEventListener("click", function () {
      projectHint.classList.add("hidden");
      try { localStorage.setItem("clay-project-hint-dismissed", "1"); } catch (e) {}
    });
  }

  // Modal close handlers (replaces inline onclick)
  $("paste-modal").querySelector(".confirm-backdrop").addEventListener("click", function() {
    $("paste-modal").classList.add("hidden");
  });
  $("paste-modal").querySelector(".paste-modal-close").addEventListener("click", function() {
    $("paste-modal").classList.add("hidden");
  });
  $("mermaid-modal").querySelector(".confirm-backdrop").addEventListener("click", closeMermaidModal);
  $("mermaid-modal").querySelector(".mermaid-modal-btn[title='Close']").addEventListener("click", closeMermaidModal);
  $("image-modal").querySelector(".confirm-backdrop").addEventListener("click", closeImageModal);
  $("image-modal").querySelector(".image-modal-close").addEventListener("click", closeImageModal);

  function showImageModal(src) {
    var modal = $("image-modal");
    var img = $("image-modal-img");
    if (!modal || !img) return;
    img.src = src;
    modal.classList.remove("hidden");
    refreshIcons(modal);
  }

  function closeImageModal() {
    var modal = $("image-modal");
    if (modal) modal.classList.add("hidden");
  }

  // --- State ---
  var ws = null;
  var connected = false;
  var wasConnected = false;
  var processing = false;
  // isComposing -> modules/input.js
  var reconnectTimer = null;
  var reconnectDelay = 1000;
  var disconnectNotifTimer = null;
  var disconnectNotifShown = false;
  var activityEl = null;
  var currentMsgEl = null;
  var currentFullText = "";
  // tools, currentThinking -> modules/tools.js
  var highlightTimer = null;
  var activeSessionId = null;
  var sessionDrafts = {};
  var slashCommands = [];
  // slashActiveIdx, slashFiltered, pendingImages, pendingPastes -> modules/input.js
  // pendingPermissions -> modules/tools.js
  var cliSessionId = null;
  var projectName = "";
  var turnCounter = 0;
  var messageUuidMap = [];
  // pendingRewindUuid is now in modules/rewind.js
  // rewindMode is now in modules/rewind.js

  // --- Progressive history loading ---
  var historyFrom = 0;
  var historyTotal = 0;
  var prependAnchor = null;
  var loadingMore = false;
  var historySentinelObserver = null;

  // --- Scroll lock ---
  var isUserScrolledUp = false;
  var scrollThreshold = 150;

  // builtinCommands -> modules/input.js

  // --- Header session rename ---
  if (headerRenameBtn) {
    headerRenameBtn.addEventListener("click", function () {
      if (!activeSessionId) return;
      var currentText = headerTitleEl.textContent;
      var input = document.createElement("input");
      input.type = "text";
      input.className = "header-rename-input";
      input.value = currentText;
      headerTitleEl.style.display = "none";
      headerRenameBtn.style.display = "none";
      headerTitleEl.parentNode.insertBefore(input, headerTitleEl.nextSibling);
      input.focus();
      input.select();

      function commit() {
        var newTitle = input.value.trim();
        if (newTitle && newTitle !== currentText && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "rename_session", id: activeSessionId, title: newTitle }));
          headerTitleEl.textContent = newTitle;
        }
        input.remove();
        headerTitleEl.style.display = "";
        headerRenameBtn.style.display = "";
      }

      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") {
          e.preventDefault();
          input.remove();
          headerTitleEl.style.display = "";
          headerRenameBtn.style.display = "";
        }
      });
      input.addEventListener("blur", commit);
    });
  }

  // --- Confirm modal ---
  var confirmModal = $("confirm-modal");
  var confirmText = $("confirm-text");
  var confirmOk = $("confirm-ok");
  var confirmCancel = $("confirm-cancel");
  // --- Paste content viewer modal ---
  function showPasteModal(text) {
    var modal = $("paste-modal");
    var body = $("paste-modal-body");
    if (!modal || !body) return;
    body.textContent = text;
    modal.classList.remove("hidden");
  }

  function closePasteModal() {
    var modal = $("paste-modal");
    if (modal) modal.classList.add("hidden");
  }

  var confirmCallback = null;

  function showConfirm(text, onConfirm) {
    confirmText.textContent = text;
    confirmCallback = onConfirm;
    confirmModal.classList.remove("hidden");
  }

  function hideConfirm() {
    confirmModal.classList.add("hidden");
    confirmCallback = null;
  }

  confirmOk.addEventListener("click", function () {
    if (confirmCallback) confirmCallback();
    hideConfirm();
  });

  confirmCancel.addEventListener("click", hideConfirm);
  confirmModal.querySelector(".confirm-backdrop").addEventListener("click", hideConfirm);

  // --- Rewind (module) ---
  initRewind({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get processing() { return processing; },
    messagesEl: messagesEl,
    addSystemMessage: addSystemMessage,
  });

  // --- Theme (module) ---
  initTheme();

  // --- Sidebar (module) ---
  var sidebarCtx = {
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get projectName() { return projectName; },
    messagesEl: messagesEl,
    sessionListEl: sessionListEl,
    sidebar: sidebar,
    sidebarOverlay: sidebarOverlay,
    sidebarToggleBtn: sidebarToggleBtn,
    sidebarExpandBtn: sidebarExpandBtn,
    hamburgerBtn: hamburgerBtn,
    newSessionBtn: newSessionBtn,
    resumeSessionBtn: resumeSessionBtn,
    headerTitleEl: headerTitleEl,
    showConfirm: showConfirm,
    onFilesTabOpen: function () { loadRootDirectory(); },
  };
  initSidebar(sidebarCtx);
  initIconStrip(sidebarCtx);

  // --- Connect overlay (logo + wordmark only) ---
  function startVerbCycle() {}
  function stopVerbCycle() {}

  // Reset favicon cache when theme changes
  onThemeChange(function () {
    faviconOrigHref = null;
  });

  function startPixelAnim() {}
  function stopPixelAnim() {}

  // --- Dynamic favicon ---
  var faviconLink = document.querySelector('link[rel="icon"]');
  var faviconSvgLight = null;
  var faviconSvgDark = null;
  var faviconOrigHref = null;

  function getFaviconSvg() {
    var theme = getCurrentTheme();
    var isLight = theme.variant === "light";
    var src = isLight ? "favicon.svg" : "favicon-dark.svg";
    var cached = isLight ? faviconSvgLight : faviconSvgDark;
    if (cached) return cached;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", basePath + src, false);
    xhr.send();
    if (xhr.status !== 200) return null;
    if (isLight) { faviconSvgLight = xhr.responseText; return faviconSvgLight; }
    faviconSvgDark = xhr.responseText;
    return faviconSvgDark;
  }

  function updateFavicon(overlayColor) {
    if (!faviconLink) return;
    var raw = getFaviconSvg();
    if (!raw) return;
    if (!overlayColor) {
      // Restore original
      if (faviconOrigHref) { faviconLink.href = faviconOrigHref; faviconOrigHref = null; }
      return;
    }
    if (!faviconOrigHref) faviconOrigHref = faviconLink.href;
    // Extract viewBox to get dimensions for overlay
    var vbMatch = raw.match(/viewBox="([^"]+)"/);
    var overlay = "";
    if (vbMatch) {
      var parts = vbMatch[1].split(/\s+/);
      overlay = '<rect x="' + parts[0] + '" y="' + parts[1] + '" width="' + parts[2] + '" height="' + parts[3] + '" fill="' + overlayColor + '" opacity="0.45"/>';
    }
    var svg = raw.replace(/<\/svg>/, overlay + "</svg>");
    faviconLink.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }

  // --- Status & Activity ---
  function setSendBtnMode(mode) {
    if (mode === "stop") {
      sendBtn.disabled = false;
      sendBtn.classList.add("stop");
      sendBtn.innerHTML = '<i data-lucide="square"></i>';
    } else {
      sendBtn.classList.remove("stop");
      sendBtn.innerHTML = '<i data-lucide="arrow-up"></i>';
    }
    refreshIcons();
  }

  var ioTimer = null;
  var faviconIoTimer = null;
  function blinkIO() {
    if (!processing) return;
    var dot = getStatusDot();
    if (dot) dot.classList.add("io");
    clearTimeout(ioTimer);
    ioTimer = setTimeout(function () { var d = getStatusDot(); if (d) d.classList.remove("io"); }, 60);

    // Blink favicon: overlay then restore
    updateFavicon(getComputedVar("--accent"));
    clearTimeout(faviconIoTimer);
    faviconIoTimer = setTimeout(function () { updateFavicon(null); }, 60);
  }

  // --- Urgent favicon blink (permission / ask user) ---
  var urgentBlinkTimer = null;
  var savedTitle = null;
  function startUrgentBlink() {
    if (urgentBlinkTimer) return;
    savedTitle = document.title;
    var tick = 0;
    urgentBlinkTimer = setInterval(function () {
      updateFavicon(tick % 2 === 0 ? getComputedVar("--accent") : null);
      document.title = tick % 2 === 0 ? "\u26A0 Input needed" : savedTitle;
      tick++;
    }, 250);
  }
  function stopUrgentBlink() {
    if (!urgentBlinkTimer) return;
    clearInterval(urgentBlinkTimer);
    urgentBlinkTimer = null;
    updateFavicon(null);
    if (savedTitle) document.title = savedTitle;
    savedTitle = null;
  }

  function setStatus(status) {
    var dot = getStatusDot();
    if (dot) dot.className = "icon-strip-status";
    if (status === "connected") {
      if (dot) dot.classList.add("connected");
      connected = true;
      processing = false;
      sendBtn.disabled = false;
      setSendBtnMode("send");
      connectOverlay.classList.add("hidden");
      stopVerbCycle();
      updateFavicon(getComputedVar("--success"));
    } else if (status === "processing") {
      if (dot) { dot.classList.add("connected"); dot.classList.add("processing"); }
      processing = true;
      setSendBtnMode("stop");
      updateFavicon(getComputedVar("--success"));
    } else {
      connected = false;
      sendBtn.disabled = true;
      connectOverlay.classList.remove("hidden");
      updateFavicon(getComputedVar("--error"));
    }
  }

  function setActivity(text) {
    if (text) {
      if (!activityEl) {
        activityEl = document.createElement("div");
        activityEl.className = "activity-inline";
        activityEl.innerHTML =
          '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
          '<span class="activity-text"></span>';
        addToMessages(activityEl);
        refreshIcons();
      }
      activityEl.querySelector(".activity-text").textContent = text;
      scrollToBottom();
    } else {
      if (activityEl) {
        activityEl.remove();
        activityEl = null;
      }
    }
  }

  // --- Config chip (model + mode + effort) ---
  var configChipWrap = $("config-chip-wrap");
  var configChip = $("config-chip");
  var configChipLabel = $("config-chip-label");
  var configPopover = $("config-popover");
  var configModelList = $("config-model-list");
  var configModeList = $("config-mode-list");
  var configEffortSection = $("config-effort-section");
  var configEffortBar = $("config-effort-bar");

  var currentModels = [];
  var currentModel = "";
  var currentMode = "default";
  var currentEffort = "high";
  var skipPermsEnabled = false;

  var MODE_OPTIONS = [
    { value: "default", label: "Default" },
    { value: "plan", label: "Plan" },
    { value: "acceptEdits", label: "Auto-accept edits" },
  ];
  var MODE_FULL_AUTO = { value: "bypassPermissions", label: "Full auto" };

  var EFFORT_LEVELS = ["low", "medium", "high", "max"];

  function modelDisplayName(value, models) {
    if (!value) return "";
    if (models) {
      for (var i = 0; i < models.length; i++) {
        if (models[i].value === value && models[i].displayName) return models[i].displayName;
      }
    }
    return value;
  }

  function modeDisplayName(value) {
    for (var i = 0; i < MODE_OPTIONS.length; i++) {
      if (MODE_OPTIONS[i].value === value) return MODE_OPTIONS[i].label;
    }
    if (value === "bypassPermissions") return "Full auto";
    if (value === "dontAsk") return "Don\u2019t ask";
    return value;
  }

  function effortDisplayName(value) {
    if (!value) return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function updateConfigChip() {
    if (!configChipWrap || !configChip) return;
    configChipWrap.classList.remove("hidden");
    var parts = [modelDisplayName(currentModel, currentModels)];
    parts.push(modeDisplayName(currentMode));
    // Only show effort if model supports it
    var modelSupportsEffort = getModelSupportsEffort();
    if (modelSupportsEffort) {
      parts.push(effortDisplayName(currentEffort));
    }
    configChipLabel.textContent = parts.join(" \u00b7 ");
    rebuildModelList();
    rebuildModeList();
    rebuildEffortBar();
  }

  function getModelSupportsEffort() {
    if (!currentModels || currentModels.length === 0) return true; // assume yes if no info
    for (var i = 0; i < currentModels.length; i++) {
      if (currentModels[i].value === currentModel) {
        if (currentModels[i].supportsEffort === false) return false;
        return true;
      }
    }
    return true;
  }

  function getModelEffortLevels() {
    if (!currentModels || currentModels.length === 0) return EFFORT_LEVELS;
    for (var i = 0; i < currentModels.length; i++) {
      if (currentModels[i].value === currentModel) {
        if (currentModels[i].supportedEffortLevels && currentModels[i].supportedEffortLevels.length > 0) {
          return currentModels[i].supportedEffortLevels;
        }
        return EFFORT_LEVELS;
      }
    }
    return EFFORT_LEVELS;
  }

  function rebuildModelList() {
    if (!configModelList) return;
    configModelList.innerHTML = "";
    var list = currentModels.length > 0 ? currentModels : (currentModel ? [{ value: currentModel, displayName: currentModel }] : []);
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var value = item.value || "";
      var label = item.displayName || value;
      var btn = document.createElement("button");
      btn.className = "config-radio-item";
      if (value === currentModel) btn.classList.add("active");
      btn.dataset.model = value;
      btn.textContent = label;
      btn.addEventListener("click", function () {
        var model = this.dataset.model;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_model", model: model }));
        }
        configPopover.classList.add("hidden");
        configChip.classList.remove("active");
      });
      configModelList.appendChild(btn);
    }
  }

  function rebuildModeList() {
    if (!configModeList) return;
    configModeList.innerHTML = "";
    var options = MODE_OPTIONS.slice();
    if (skipPermsEnabled) {
      options.push(MODE_FULL_AUTO);
    }
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var btn = document.createElement("button");
      btn.className = "config-radio-item";
      if (opt.value === currentMode) btn.classList.add("active");
      btn.dataset.mode = opt.value;
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        var mode = this.dataset.mode;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_permission_mode", mode: mode }));
        }
        configPopover.classList.add("hidden");
        configChip.classList.remove("active");
      });
      configModeList.appendChild(btn);
    }
  }

  function rebuildEffortBar() {
    if (!configEffortBar || !configEffortSection) return;
    var supportsEffort = getModelSupportsEffort();
    if (!supportsEffort) {
      configEffortSection.style.display = "none";
      return;
    }
    configEffortSection.style.display = "";
    configEffortBar.innerHTML = "";
    var levels = getModelEffortLevels();
    for (var i = 0; i < levels.length; i++) {
      var level = levels[i];
      var btn = document.createElement("button");
      btn.className = "config-segment-btn";
      if (level === currentEffort) btn.classList.add("active");
      btn.dataset.effort = level;
      btn.textContent = effortDisplayName(level);
      btn.addEventListener("click", function () {
        var effort = this.dataset.effort;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_effort", effort: effort }));
        }
        configPopover.classList.add("hidden");
        configChip.classList.remove("active");
      });
      configEffortBar.appendChild(btn);
    }
  }

  configChip.addEventListener("click", function (e) {
    e.stopPropagation();
    var wasHidden = configPopover.classList.toggle("hidden");
    configChip.classList.toggle("active", !wasHidden);
  });

  document.addEventListener("click", function (e) {
    if (!configPopover.contains(e.target) && e.target !== configChip) {
      configPopover.classList.add("hidden");
      configChip.classList.remove("active");
    }
  });

  // --- Usage panel ---
  var usagePanel = $("usage-panel");
  var usagePanelClose = $("usage-panel-close");
  var usageCostEl = $("usage-cost");
  var usageInputEl = $("usage-input");
  var usageOutputEl = $("usage-output");
  var usageCacheReadEl = $("usage-cache-read");
  var usageCacheWriteEl = $("usage-cache-write");
  var usageTurnsEl = $("usage-turns");
  var sessionUsage = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };

  function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function updateUsagePanel() {
    if (!usageCostEl) return;
    usageCostEl.textContent = "$" + sessionUsage.cost.toFixed(4);
    usageInputEl.textContent = formatTokens(sessionUsage.input);
    usageOutputEl.textContent = formatTokens(sessionUsage.output);
    usageCacheReadEl.textContent = formatTokens(sessionUsage.cacheRead);
    usageCacheWriteEl.textContent = formatTokens(sessionUsage.cacheWrite);
    usageTurnsEl.textContent = String(sessionUsage.turns);
  }

  function accumulateUsage(cost, usage) {
    if (cost != null) sessionUsage.cost += cost;
    if (usage) {
      sessionUsage.input += usage.input_tokens || usage.inputTokens || 0;
      sessionUsage.output += usage.output_tokens || usage.outputTokens || 0;
      sessionUsage.cacheRead += usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
      sessionUsage.cacheWrite += usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
    }
    sessionUsage.turns++;
    updateUsagePanel();
  }

  function resetUsage() {
    sessionUsage = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    updateUsagePanel();
    if (usagePanel) usagePanel.classList.add("hidden");
  }

  function toggleUsagePanel() {
    if (!usagePanel) return;
    usagePanel.classList.toggle("hidden");
    refreshIcons();
  }

  if (usagePanelClose) {
    usagePanelClose.addEventListener("click", function () {
      usagePanel.classList.add("hidden");
    });
  }

  // --- Status panel ---
  var statusPanel = $("status-panel");
  var statusPanelClose = $("status-panel-close");
  var statusPidEl = $("status-pid");
  var statusUptimeEl = $("status-uptime");
  var statusRssEl = $("status-rss");
  var statusHeapUsedEl = $("status-heap-used");
  var statusHeapTotalEl = $("status-heap-total");
  var statusExternalEl = $("status-external");
  var statusSessionsEl = $("status-sessions");
  var statusProcessingEl = $("status-processing");
  var statusClientsEl = $("status-clients");
  var statusTerminalsEl = $("status-terminals");
  var statusRefreshTimer = null;

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

  function updateStatusPanel(data) {
    if (!statusPidEl) return;
    statusPidEl.textContent = String(data.pid);
    statusUptimeEl.textContent = formatUptime(data.uptime);
    statusRssEl.textContent = formatBytes(data.memory.rss);
    statusHeapUsedEl.textContent = formatBytes(data.memory.heapUsed);
    statusHeapTotalEl.textContent = formatBytes(data.memory.heapTotal);
    statusExternalEl.textContent = formatBytes(data.memory.external);
    statusSessionsEl.textContent = String(data.sessions);
    statusProcessingEl.textContent = String(data.processing);
    statusClientsEl.textContent = String(data.clients);
    statusTerminalsEl.textContent = String(data.terminals);
  }

  function requestProcessStats() {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "process_stats" }));
    }
  }

  function toggleStatusPanel() {
    if (!statusPanel) return;
    var opening = statusPanel.classList.contains("hidden");
    statusPanel.classList.toggle("hidden");
    if (opening) {
      requestProcessStats();
      statusRefreshTimer = setInterval(requestProcessStats, 5000);
    } else {
      if (statusRefreshTimer) {
        clearInterval(statusRefreshTimer);
        statusRefreshTimer = null;
      }
    }
    refreshIcons();
  }

  if (statusPanelClose) {
    statusPanelClose.addEventListener("click", function () {
      statusPanel.classList.add("hidden");
      if (statusRefreshTimer) {
        clearInterval(statusRefreshTimer);
        statusRefreshTimer = null;
      }
    });
  }

  // --- Context panel ---
  var contextPanel = $("context-panel");
  var contextPanelClose = $("context-panel-close");
  var contextPanelMinimize = $("context-panel-minimize");
  var contextBarFill = $("context-bar-fill");
  var contextBarPct = $("context-bar-pct");
  var contextUsedEl = $("context-used");
  var contextWindowEl = $("context-window");
  var contextMaxOutputEl = $("context-max-output");
  var contextInputEl = $("context-input");
  var contextOutputEl = $("context-output");
  var contextCacheReadEl = $("context-cache-read");
  var contextCacheWriteEl = $("context-cache-write");
  var contextModelEl = $("context-model");
  var contextCostEl = $("context-cost");
  var contextTurnsEl = $("context-turns");
  var contextMini = $("context-mini");
  var contextMiniFill = $("context-mini-fill");
  var contextMiniLabel = $("context-mini-label");
  var contextData = { contextWindow: 0, maxOutputTokens: 0, model: "-", cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };

  function contextPctClass(pct) {
    return pct >= 85 ? " danger" : pct >= 60 ? " warn" : "";
  }

  function updateContextPanel() {
    if (!contextUsedEl) return;
    // Context window usage = input tokens (includes cache read/write) + output tokens
    var used = contextData.input + contextData.output;
    var win = contextData.contextWindow;
    var pct = win > 0 ? Math.min(100, (used / win) * 100) : 0;
    var cls = contextPctClass(pct);
    // Panel bar
    contextBarFill.style.width = pct.toFixed(1) + "%";
    contextBarFill.className = "context-bar-fill" + cls;
    contextBarPct.textContent = pct.toFixed(0) + "%";
    // Mini bar
    if (contextMiniFill) {
      contextMiniFill.style.width = pct.toFixed(1) + "%";
      contextMiniFill.className = "context-mini-fill" + cls;
    }
    if (contextMiniLabel) {
      contextMiniLabel.textContent = (win > 0 ? formatTokens(used) + "/" + formatTokens(win) : "0%");
    }
    contextUsedEl.textContent = formatTokens(used);
    contextWindowEl.textContent = win > 0 ? formatTokens(win) : "-";
    contextMaxOutputEl.textContent = contextData.maxOutputTokens > 0 ? formatTokens(contextData.maxOutputTokens) : "-";
    contextInputEl.textContent = formatTokens(contextData.input);
    contextOutputEl.textContent = formatTokens(contextData.output);
    contextCacheReadEl.textContent = formatTokens(contextData.cacheRead);
    contextCacheWriteEl.textContent = formatTokens(contextData.cacheWrite);
    contextModelEl.textContent = contextData.model;
    contextCostEl.textContent = "$" + contextData.cost.toFixed(4);
    contextTurnsEl.textContent = String(contextData.turns);
  }

  function accumulateContext(cost, usage, modelUsage) {
    if (cost != null) contextData.cost += cost;
    // Use latest turn values (not cumulative) since each turn's input_tokens
    // already includes the full conversation context up to that point
    if (usage) {
      contextData.input = usage.input_tokens || usage.inputTokens || 0;
      contextData.output = usage.output_tokens || usage.outputTokens || 0;
      contextData.cacheRead = usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
      contextData.cacheWrite = usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
    }
    contextData.turns++;
    if (modelUsage) {
      var models = Object.keys(modelUsage);
      if (models.length > 0) {
        var m = models[0];
        var mu = modelUsage[m];
        contextData.model = m;
        if (mu.contextWindow) contextData.contextWindow = mu.contextWindow;
        if (mu.maxOutputTokens) contextData.maxOutputTokens = mu.maxOutputTokens;
      }
    }
    updateContextPanel();
  }

  // contextView: "off" | "mini" | "panel"
  function getContextView() {
    try { return localStorage.getItem("clay-context-view") || "off"; } catch (e) { return "off"; }
  }
  function setContextView(v) {
    try { localStorage.setItem("clay-context-view", v); } catch (e) {}
  }

  function applyContextView(view) {
    if (contextPanel) contextPanel.classList.toggle("hidden", view !== "panel");
    if (contextMini) contextMini.classList.toggle("hidden", view !== "mini");
    if (view === "panel") refreshIcons();
  }

  function resetContextData() {
    contextData = { contextWindow: 0, maxOutputTokens: 0, model: "-", cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    updateContextPanel();
  }

  function resetContext() {
    resetContextData();
    // Keep view state, just reset data
    applyContextView(getContextView());
  }

  function minimizeContext() {
    setContextView("mini");
    applyContextView("mini");
  }

  function expandContext() {
    setContextView("panel");
    applyContextView("panel");
  }

  function toggleContextPanel() {
    if (!contextPanel) return;
    var view = getContextView();
    if (view === "panel") {
      setContextView("mini");
      applyContextView("mini");
    } else {
      setContextView("panel");
      applyContextView("panel");
    }
  }

  if (contextPanelClose) {
    contextPanelClose.addEventListener("click", function () {
      setContextView("off");
      applyContextView("off");
    });
  }

  if (contextPanelMinimize) {
    contextPanelMinimize.addEventListener("click", minimizeContext);
  }

  // Restore context view on load
  applyContextView(getContextView());

  if (contextMini) {
    contextMini.addEventListener("click", expandContext);
  }

  function addToMessages(el) {
    if (prependAnchor) messagesEl.insertBefore(el, prependAnchor);
    else messagesEl.appendChild(el);
  }

  var newMsgBtn = $("new-msg-btn");
  var newMsgBtnDefault = "\u2193 Latest";
  var newMsgBtnActivity = "\u2193 New activity";

  messagesEl.addEventListener("scroll", function () {
    var distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    isUserScrolledUp = distFromBottom > scrollThreshold;
    if (isUserScrolledUp) {
      if (newMsgBtn.classList.contains("hidden")) {
        newMsgBtn.textContent = newMsgBtnDefault;
      }
      newMsgBtn.classList.remove("hidden");
    } else {
      newMsgBtn.classList.add("hidden");
      newMsgBtn.textContent = newMsgBtnDefault;
    }
  });

  newMsgBtn.addEventListener("click", function () {
    forceScrollToBottom();
  });

  function scrollToBottom() {
    if (prependAnchor) return;
    if (isUserScrolledUp) {
      newMsgBtn.textContent = newMsgBtnActivity;
      newMsgBtn.classList.remove("hidden");
      return;
    }
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function forceScrollToBottom() {
    if (prependAnchor) return;
    isUserScrolledUp = false;
    newMsgBtn.classList.add("hidden");
    newMsgBtn.textContent = newMsgBtnDefault;
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // --- Tools module ---
  initTools({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get turnCounter() { return turnCounter; },
    messagesEl: messagesEl,
    inputEl: inputEl,
    finalizeAssistantBlock: function() { finalizeAssistantBlock(); },
    addToMessages: function(el) { addToMessages(el); },
    scrollToBottom: function() { scrollToBottom(); },
    setActivity: function(text) { setActivity(text); },
    stopUrgentBlink: function() { stopUrgentBlink(); },
    getContextPercent: function() {
      var used = contextData.input + contextData.output;
      var win = contextData.contextWindow;
      return win > 0 ? Math.round((used / win) * 100) : 0;
    },
  });

  // isPlanFile, toolSummary, toolActivityText, shortPath -> modules/tools.js

  // AskUserQuestion, PermissionRequest, Plan, Todo, Thinking, Tool items -> modules/tools.js

  // --- DOM: Messages ---
  function addUserMessage(text, images, pastes) {
    var div = document.createElement("div");
    div.className = "msg-user";
    div.dataset.turn = ++turnCounter;
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.dir = "auto";

    if (images && images.length > 0) {
      var imgRow = document.createElement("div");
      imgRow.className = "bubble-images";
      for (var i = 0; i < images.length; i++) {
        var img = document.createElement("img");
        img.src = "data:" + images[i].mediaType + ";base64," + images[i].data;
        img.className = "bubble-img";
        img.addEventListener("click", function () { showImageModal(this.src); });
        imgRow.appendChild(img);
      }
      bubble.appendChild(imgRow);
    }

    if (pastes && pastes.length > 0) {
      var pasteRow = document.createElement("div");
      pasteRow.className = "bubble-pastes";
      for (var p = 0; p < pastes.length; p++) {
        (function (pasteText) {
          var chip = document.createElement("div");
          chip.className = "bubble-paste";
          var preview = pasteText.substring(0, 60).replace(/\n/g, " ");
          if (pasteText.length > 60) preview += "...";
          chip.innerHTML = '<span class="bubble-paste-preview">' + escapeHtml(preview) + '</span><span class="bubble-paste-label">PASTED</span>';
          chip.addEventListener("click", function (e) {
            e.stopPropagation();
            showPasteModal(pasteText);
          });
          pasteRow.appendChild(chip);
        })(pastes[p]);
      }
      bubble.appendChild(pasteRow);
    }

    if (text) {
      var textEl = document.createElement("span");
      textEl.textContent = text;
      bubble.appendChild(textEl);
    }

    div.appendChild(bubble);
    addToMessages(div);
    forceScrollToBottom();
  }

  function ensureAssistantBlock() {
    if (!currentMsgEl) {
      currentMsgEl = document.createElement("div");
      currentMsgEl.className = "msg-assistant";
      currentMsgEl.dataset.turn = turnCounter;
      currentMsgEl.innerHTML = '<div class="md-content" dir="auto"></div>';
      addToMessages(currentMsgEl);
      currentFullText = "";
    }
    return currentMsgEl;
  }

  function addCopyHandler(msgEl, rawText) {
    var primed = false;
    var resetTimer = null;

    var isTouchDevice = "ontouchstart" in window;

    var hint = document.createElement("div");
    hint.className = "msg-copy-hint";
    hint.textContent = (isTouchDevice ? "Tap" : "Click") + " to grab this";
    msgEl.appendChild(hint);

    function reset() {
      primed = false;
      msgEl.classList.remove("copy-primed", "copy-done");
      hint.textContent = (isTouchDevice ? "Tap" : "Click") + " to grab this";
    }

    msgEl.addEventListener("click", function (e) {
      // Don't intercept clicks on links or code blocks
      if (e.target.closest("a, pre, code")) return;
      // Don't intercept text selection
      var sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;

      if (!primed) {
        primed = true;
        msgEl.classList.add("copy-primed");
        hint.textContent = isTouchDevice ? "Tap again to grab" : "Click again to grab";
        clearTimeout(resetTimer);
        resetTimer = setTimeout(reset, 3000);
      } else {
        clearTimeout(resetTimer);
        copyToClipboard(rawText).then(function () {
          msgEl.classList.remove("copy-primed");
          msgEl.classList.add("copy-done");
          hint.textContent = "Grabbed!";
          resetTimer = setTimeout(reset, 1500);
        });
      }
    });

    document.addEventListener("click", function (e) {
      if (primed && !msgEl.contains(e.target)) reset();
    });
  }

  function appendDelta(text) {
    ensureAssistantBlock();
    currentFullText += text;
    var contentEl = currentMsgEl.querySelector(".md-content");
    contentEl.innerHTML = renderMarkdown(currentFullText);

    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(function () {
      highlightCodeBlocks(contentEl);
    }, 150);

    scrollToBottom();
  }

  function finalizeAssistantBlock() {
    if (currentMsgEl) {
      var contentEl = currentMsgEl.querySelector(".md-content");
      if (contentEl) {
        highlightCodeBlocks(contentEl);
        renderMermaidBlocks(contentEl);
      }
      if (currentFullText) {
        addCopyHandler(currentMsgEl, currentFullText);
      }
      // Assistant text appeared, so break the current tool group
      closeToolGroup();
    }
    currentMsgEl = null;
    currentFullText = "";
  }

  function addSystemMessage(text, isError) {
    var div = document.createElement("div");
    div.className = "sys-msg" + (isError ? " error" : "");
    div.innerHTML = '<span class="sys-text"></span>';
    div.querySelector(".sys-text").textContent = text;
    addToMessages(div);
    scrollToBottom();
  }

  function addConflictMessage(msg) {
    var div = document.createElement("div");
    div.className = "conflict-msg";
    var header = document.createElement("div");
    header.className = "conflict-header";
    header.textContent = msg.text || "Another Claude Code process is already running.";
    div.appendChild(header);

    var hint = document.createElement("div");
    hint.className = "conflict-hint";
    hint.textContent = "Kill the conflicting process to continue, or use the existing Claude Code session.";
    div.appendChild(hint);

    for (var i = 0; i < msg.processes.length; i++) {
      var p = msg.processes[i];
      var row = document.createElement("div");
      row.className = "conflict-process";

      var info = document.createElement("span");
      info.className = "conflict-pid";
      info.textContent = "PID " + p.pid;
      row.appendChild(info);

      var cmd = document.createElement("code");
      cmd.className = "conflict-cmd";
      cmd.textContent = p.command.length > 80 ? p.command.substring(0, 80) + "..." : p.command;
      cmd.title = p.command;
      row.appendChild(cmd);

      var killBtn = document.createElement("button");
      killBtn.className = "conflict-kill-btn";
      killBtn.textContent = "Kill Process";
      killBtn.setAttribute("data-pid", p.pid);
      killBtn.addEventListener("click", function() {
        var pid = parseInt(this.getAttribute("data-pid"), 10);
        ws.send(JSON.stringify({ type: "kill_process", pid: pid }));
        this.disabled = true;
        this.textContent = "Killing...";
      });
      row.appendChild(killBtn);
      div.appendChild(row);
    }

    addToMessages(div);
    scrollToBottom();
  }

  function addContextOverflowMessage(msg) {
    var div = document.createElement("div");
    div.className = "context-overflow-msg";

    var header = document.createElement("div");
    header.className = "context-overflow-header";
    header.textContent = msg.text || "Conversation too long to continue.";
    div.appendChild(header);

    var hint = document.createElement("div");
    hint.className = "context-overflow-hint";
    hint.textContent = "The conversation has exceeded the model's context limit. Please start a new conversation to continue.";
    div.appendChild(hint);

    var btn = document.createElement("button");
    btn.className = "context-overflow-btn";
    btn.textContent = "New Conversation";
    btn.addEventListener("click", function() {
      ws.send(JSON.stringify({ type: "new_session" }));
    });
    div.appendChild(btn);

    addToMessages(div);
    scrollToBottom();
  }

  function resetClientState() {
    messagesEl.innerHTML = "";
    currentMsgEl = null;
    currentFullText = "";
    resetToolState();
    clearPendingImages();
    activityEl = null;
    processing = false;
    turnCounter = 0;
    messageUuidMap = [];
    historyFrom = 0;
    historyTotal = 0;
    prependAnchor = null;
    loadingMore = false;
    isUserScrolledUp = false;
    newMsgBtn.classList.add("hidden");
    setRewindMode(false);
    removeSearchTimeline();
    setActivity(null);
    setStatus("connected");
    enableMainInput();
    resetUsage();
    resetContext();
  }

  // --- WebSocket ---
  var connectTimeoutId = null;

  function connect() {
    if (ws) { ws.onclose = null; ws.close(); }
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }

    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + wsPath);


    // If not connected within 3s, force retry
    connectTimeoutId = setTimeout(function () {
      if (!connected) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        connect();
      }
    }, 3000);

    ws.onopen = function () {
      if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
      // Cancel pending "connection lost" notification if reconnected quickly
      if (disconnectNotifTimer) {
        clearTimeout(disconnectNotifTimer);
        disconnectNotifTimer = null;
      }
      // Only show "restored" notification if "lost" was actually shown
      if (wasConnected && disconnectNotifShown && !document.hasFocus() && "serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification("Clay", {
            body: "Server connection restored",
            tag: "claude-disconnect",
          });
        }).catch(function () {});
      }
      disconnectNotifShown = false;
      wasConnected = true;
      setStatus("connected");
      reconnectDelay = 1000;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

      // Reset terminal xterm instances (server will send fresh term_list)
      resetTerminals();

      // Re-send push subscription on reconnect
      if (window._pushSubscription) {
        try {
          ws.send(JSON.stringify({
            type: "push_subscribe",
            subscription: window._pushSubscription.toJSON(),
          }));
        } catch(e) {}
      }
    };

    ws.onclose = function (e) {
      if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
      setStatus("disconnected");
      processing = false;
      setActivity(null);
      // Delay "connection lost" notification by 5s to suppress brief disconnects
      if (!disconnectNotifTimer) {
        disconnectNotifTimer = setTimeout(function () {
          disconnectNotifTimer = null;
          disconnectNotifShown = true;
          if (!document.hasFocus() && "serviceWorker" in navigator) {
            navigator.serviceWorker.ready.then(function (reg) {
              reg.showNotification("Clay", {
                body: "Server connection lost",
                tag: "claude-disconnect",
              });
            }).catch(function () {});
          }
        }, 5000);
      }
      scheduleReconnect();
    };

    ws.onerror = function () {
    };

    ws.onmessage = function (event) {
      // Backup: if we're receiving messages, we're connected
      if (!connected) {
        setStatus("connected");
        reconnectDelay = 1000;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      }

      blinkIO();
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      processMessage(msg);
    };
  }

  function processMessage(msg) {
      switch (msg.type) {
        case "history_meta":
          historyFrom = msg.from;
          historyTotal = msg.total;
          updateHistorySentinel();
          break;

        case "history_prepend":
          prependOlderHistory(msg.items, msg.meta);
          break;

        case "history_done":
          // Render + finalize any incomplete turn from the replayed history
          if (currentMsgEl && currentFullText) {
            var replayContentEl = currentMsgEl.querySelector(".md-content");
            if (replayContentEl) {
              replayContentEl.innerHTML = renderMarkdown(currentFullText);
            }
          }
          markAllToolsDone();
          finalizeAssistantBlock();
          scrollToBottom();
          var pendingQuery = getActiveSearchQuery();
          if (pendingQuery) {
            requestAnimationFrame(function() { buildSearchTimeline(pendingQuery); });
          }
          // Scroll to tool element if navigating from file edit history
          var nav = getPendingNavigate();
          if (nav && (nav.toolId || nav.assistantUuid)) {
            requestAnimationFrame(function() {
              // Prefer scrolling to the exact tool element
              var target = nav.toolId ? messagesEl.querySelector('[data-tool-id="' + nav.toolId + '"]') : null;
              if (!target && nav.assistantUuid) {
                target = messagesEl.querySelector('[data-uuid="' + nav.assistantUuid + '"]');
              }
              if (target) {
                // Auto-expand parent tool group if collapsed
                var parentGroup = target.closest(".tool-group");
                if (parentGroup) parentGroup.classList.remove("collapsed");
                target.scrollIntoView({ behavior: "smooth", block: "center" });
                target.classList.add("message-blink");
                setTimeout(function() { target.classList.remove("message-blink"); }, 2000);
              }
            });
          }
          break;

        case "info":
          projectName = msg.project || msg.cwd;
          if (msg.slug) currentSlug = msg.slug;
          headerTitleEl.textContent = projectName;
          var tbProjectName = $("title-bar-project-name");
          if (tbProjectName) tbProjectName.textContent = msg.title || projectName;
          updatePageTitle();
          if (msg.version) {
            var vEl = $("footer-version");
            if (vEl) vEl.textContent = "v" + msg.version;
          }
          if (msg.debug) {
            var debugWrap = $("debug-menu-wrap");
            if (debugWrap) debugWrap.classList.remove("hidden");
          }
          if (msg.lanHost) window.__lanHost = msg.lanHost;
          if (msg.dangerouslySkipPermissions) {
            skipPermsEnabled = true;
            var spBanner = $("skip-perms-banner");
            if (spBanner) spBanner.classList.remove("hidden");
          }
          updateProjectList(msg);
          break;

        case "update_available":
          var updateBanner = $("update-banner");
          var updateVersion = $("update-version");
          if (updateBanner && updateVersion && msg.version) {
            updateVersion.textContent = "v" + msg.version;
            updateBanner.classList.remove("hidden");
            // Reset button state (may be stuck on "Updating..." after restart)
            var updResetBtn = $("update-now");
            if (updResetBtn) {
              updResetBtn.textContent = "Update now";
              updResetBtn.disabled = false;
            }
            refreshIcons();
          }
          // Show badge on footer update check item
          var footerUpdateBtn = $("footer-update-check");
          if (footerUpdateBtn && msg.version) {
            var labelSpan = footerUpdateBtn.querySelector("span");
            if (labelSpan) labelSpan.textContent = "Update available";
            footerUpdateBtn.classList.add("has-badge");
            var existingBadge = footerUpdateBtn.querySelector(".menu-badge");
            if (!existingBadge) {
              var badge = document.createElement("span");
              badge.className = "menu-badge";
              badge.textContent = "v" + msg.version;
              footerUpdateBtn.appendChild(badge);
            }
          }
          break;

        case "update_started":
          var updNowBtn = $("update-now");
          if (updNowBtn) {
            updNowBtn.textContent = "Updating...";
            updNowBtn.disabled = true;
          }
          // Block the entire screen with the connect overlay
          connectOverlay.classList.remove("hidden");
          break;

        case "slash_commands":
          var reserved = new Set(builtinCommands.map(function (c) { return c.name; }));
          slashCommands = (msg.commands || []).filter(function (name) {
            return !reserved.has(name);
          }).map(function (name) {
            return { name: name, desc: "Skill" };
          });
          break;

        case "model_info":
          currentModel = msg.model || currentModel;
          currentModels = msg.models || [];
          updateConfigChip();
          updateSettingsModels(msg.model, msg.models || []);
          break;

        case "config_state":
          if (msg.model) currentModel = msg.model;
          if (msg.mode) currentMode = msg.mode;
          if (msg.effort) currentEffort = msg.effort;
          // Validate effort against current model's supported levels
          if (currentModels.length > 0) {
            var levels = getModelEffortLevels();
            var effortValid = false;
            for (var ei = 0; ei < levels.length; ei++) {
              if (levels[ei] === currentEffort) { effortValid = true; break; }
            }
            if (!effortValid) currentEffort = "high";
          }
          updateConfigChip();
          break;

        case "client_count":
          var countEl = document.getElementById("client-count");
          if (countEl) {
            if (msg.count > 1) {
              countEl.textContent = msg.count;
              countEl.dataset.tip = msg.count + " devices connected";
              countEl.classList.remove("hidden");
            } else {
              countEl.classList.add("hidden");
            }
          }
          break;

        case "toast":
          showToast(msg.message, msg.level, msg.detail);
          break;

        case "input_sync":
          handleInputSync(msg.text);
          break;

        case "session_list":
          renderSessionList(msg.sessions || []);
          break;

        case "search_results":
          handleSearchResults(msg);
          break;

        case "cli_session_list":
          populateCliSessionList(msg.sessions || []);
          break;

        case "session_switched":
          // Save draft from outgoing session
          if (activeSessionId && inputEl.value) {
            sessionDrafts[activeSessionId] = inputEl.value;
          } else if (activeSessionId) {
            delete sessionDrafts[activeSessionId];
          }
          activeSessionId = msg.id;
          cliSessionId = msg.cliSessionId || null;
          resetClientState();
          // Restore draft for incoming session
          var draft = sessionDrafts[activeSessionId] || "";
          inputEl.value = draft;
          autoResize();
          if (!("ontouchstart" in window)) {
            inputEl.focus();
          }
          break;

        case "session_id":
          cliSessionId = msg.cliSessionId;
          break;

        case "message_uuid":
          var uuidTarget;
          if (msg.messageType === "user") {
            var allUsers = messagesEl.querySelectorAll(".msg-user:not([data-uuid])");
            if (allUsers.length > 0) uuidTarget = allUsers[allUsers.length - 1];
          } else {
            var allAssistants = messagesEl.querySelectorAll(".msg-assistant:not([data-uuid])");
            if (allAssistants.length > 0) uuidTarget = allAssistants[allAssistants.length - 1];
          }
          if (uuidTarget) {
            uuidTarget.dataset.uuid = msg.uuid;
          }
          messageUuidMap.push({ uuid: msg.uuid, type: msg.messageType });
          break;

        case "user_message":
          addUserMessage(msg.text, msg.images || null, msg.pastes || null);
          break;

        case "status":
          if (msg.status === "processing") {
            setStatus("processing");
            setActivity(randomThinkingVerb() + "...");
          }
          break;

        case "compacting":
          if (msg.active) {
            setActivity("Compacting conversation...");
          } else {
            setActivity(randomThinkingVerb() + "...");
          }
          break;

        case "thinking_start":
          startThinking();
          break;

        case "thinking_delta":
          if (typeof msg.text === "string") appendThinking(msg.text);
          break;

        case "thinking_stop":
          stopThinking();
          setActivity(randomThinkingVerb() + "...");
          break;

        case "delta":
          if (typeof msg.text !== "string") break;
          stopThinking();
          setActivity(null);
          appendDelta(msg.text);
          break;

        case "tool_start":
          stopThinking();
          markAllToolsDone();
          if (msg.name === "EnterPlanMode") {
            renderPlanBanner("enter");
            getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else if (msg.name === "ExitPlanMode") {
            if (getPlanContent()) {
              renderPlanCard(getPlanContent());
            }
            renderPlanBanner("exit");
            getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else if (getTodoTools()[msg.name]) {
            getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else {
            createToolItem(msg.id, msg.name);
          }
          break;

        case "tool_executing":
          if (msg.name === "AskUserQuestion" && msg.input && msg.input.questions) {
            var askTool = getTools()[msg.id];
            if (askTool) {
              if (askTool.el) askTool.el.style.display = "none";
              askTool.done = true;
              removeToolFromGroup(msg.id);
            }
            renderAskUserQuestion(msg.id, msg.input);
            startUrgentBlink();
          } else if (msg.name === "Write" && msg.input && isPlanFilePath(msg.input.file_path)) {
            setPlanContent(msg.input.content || "");
            updateToolExecuting(msg.id, msg.name, msg.input);
          } else if (msg.name === "TodoWrite") {
            handleTodoWrite(msg.input);
          } else if (msg.name === "TaskCreate") {
            handleTaskCreate(msg.input);
          } else if (msg.name === "TaskUpdate") {
            handleTaskUpdate(msg.input);
          } else if (getTodoTools()[msg.name]) {
            // TaskList, TaskGet - silently skip
          } else {
            var t = getTools()[msg.id];
            if (t && t.hidden) break;
            updateToolExecuting(msg.id, msg.name, msg.input);
          }
          break;

        case "tool_result": {
            var tr = getTools()[msg.id];
            if (tr && tr.hidden) break; // skip hidden plan tools
            // Always call updateToolResult for Edit (to show diff from input), or when content exists
            if (msg.content != null || (tr && tr.name === "Edit" && tr.input && tr.input.old_string)) {
              updateToolResult(msg.id, msg.content || "", msg.is_error || false);
            }
            // Refresh file browser if an Edit/Write tool modified the open file
            if (!msg.is_error && tr && (tr.name === "Edit" || tr.name === "Write") && tr.input && tr.input.file_path) {
              refreshIfOpen(tr.input.file_path);
            }
          }
          break;

        case "ask_user_answered":
          markAskUserAnswered(msg.toolId);
          stopUrgentBlink();
          break;

        case "permission_request":
          renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason);
          startUrgentBlink();
          break;

        case "permission_cancel":
          markPermissionCancelled(msg.requestId);
          stopUrgentBlink();
          break;

        case "permission_resolved":
          markPermissionResolved(msg.requestId, msg.decision);
          stopUrgentBlink();
          break;

        case "permission_request_pending":
          renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason);
          startUrgentBlink();
          break;

        case "slash_command_result":
          finalizeAssistantBlock();
          var cmdBlock = document.createElement("div");
          cmdBlock.className = "assistant-block";
          cmdBlock.style.maxWidth = "var(--content-width)";
          cmdBlock.style.margin = "12px auto";
          cmdBlock.style.padding = "0 20px";
          var pre = document.createElement("pre");
          pre.style.cssText = "background:var(--code-bg);border:1px solid var(--border-subtle);border-radius:10px;padding:12px 14px;font-family:'SF Mono',Menlo,Monaco,monospace;font-size:12px;line-height:1.55;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;max-height:400px;overflow-y:auto;margin:0";
          pre.textContent = msg.text;
          cmdBlock.appendChild(pre);
          addToMessages(cmdBlock);
          scrollToBottom();
          break;

        case "subagent_activity":
          updateSubagentActivity(msg.parentToolId, msg.text);
          break;

        case "subagent_tool":
          addSubagentToolEntry(msg.parentToolId, msg.toolName, msg.toolId, msg.text);
          break;

        case "subagent_done":
          markSubagentDone(msg.parentToolId);
          break;

        case "result":
          setActivity(null);
          stopThinking();
          markAllToolsDone();
          closeToolGroup();
          finalizeAssistantBlock();
          addTurnMeta(msg.cost, msg.duration);
          accumulateUsage(msg.cost, msg.usage);
          accumulateContext(msg.cost, msg.usage, msg.modelUsage);
          break;

        case "done":
          setActivity(null);
          stopThinking();
          markAllToolsDone();
          closeToolGroup();
          finalizeAssistantBlock();
          processing = false;
          setStatus("connected");
          enableMainInput();
          resetToolState();
          if (document.hidden) {
            if (isNotifAlertEnabled() && !window._pushSubscription) showDoneNotification();
            if (isNotifSoundEnabled()) playDoneSound();
          }
          break;

        case "stderr":
          addSystemMessage(msg.text, false);
          break;

        case "info":
          addSystemMessage(msg.text, false);
          break;

        case "error":
          setActivity(null);
          addSystemMessage(msg.text, true);
          updateFavicon(getComputedVar("--error"));
          break;

        case "process_conflict":
          setActivity(null);
          addConflictMessage(msg);
          updateFavicon(getComputedVar("--error"));
          break;

        case "context_overflow":
          setActivity(null);
          addContextOverflowMessage(msg);
          updateFavicon(getComputedVar("--error"));
          break;

        case "process_killed":
          addSystemMessage("Process " + msg.pid + " has been terminated. You can retry your message now.", false);
          break;

        case "rewind_preview_result":
          showRewindModal(msg);
          break;

        case "rewind_complete":
          setRewindMode(false);
          var rewindText = "Rewound to earlier point. Files have been restored.";
          if (msg.mode === "chat") rewindText = "Conversation rewound to earlier point.";
          else if (msg.mode === "files") rewindText = "Files restored to earlier point.";
          addSystemMessage(rewindText, false);
          break;

        case "rewind_error":
          clearPendingRewindUuid();
          addSystemMessage(msg.text || "Rewind failed.", true);
          break;

        case "fs_list_result":
          handleFsList(msg);
          break;

        case "fs_read_result":
          handleFsRead(msg);
          break;

        case "fs_file_changed":
          handleFileChanged(msg);
          break;

        case "fs_dir_changed":
          handleDirChanged(msg);
          break;

        case "fs_file_history_result":
          handleFileHistory(msg);
          break;

        case "fs_git_diff_result":
          handleGitDiff(msg);
          break;

        case "fs_file_at_result":
          handleFileAt(msg);
          break;

        case "term_list":
          handleTermList(msg);
          break;

        case "term_created":
          handleTermCreated(msg);
          break;

        case "term_output":
          handleTermOutput(msg);
          break;

        case "term_exited":
          handleTermExited(msg);
          break;

        case "term_closed":
          handleTermClosed(msg);
          break;

        case "process_stats":
          updateStatusPanel(msg);
          updateSettingsStats(msg);
          break;

        case "browse_dir_result":
          handleBrowseDirResult(msg);
          break;

        case "add_project_result":
          handleAddProjectResult(msg);
          break;

        case "remove_project_result":
          handleRemoveProjectResult(msg);
          break;

        case "projects_updated":
          updateProjectList(msg);
          break;

        case "daemon_config":
          updateDaemonConfig(msg.config);
          break;

        case "set_pin_result":
          handleSetPinResult(msg);
          break;

        case "set_keep_awake_result":
          handleKeepAwakeChanged(msg);
          break;

        case "keep_awake_changed":
          handleKeepAwakeChanged(msg);
          break;

        case "shutdown_server_result":
          handleShutdownResult(msg);
          break;
      }
  }

  // --- Progressive history loading ---
  function updateHistorySentinel() {
    var existing = messagesEl.querySelector(".history-sentinel");
    if (historyFrom > 0) {
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
          if (entries[0].isIntersecting && !loadingMore && historyFrom > 0) {
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

  function requestMoreHistory() {
    if (loadingMore || historyFrom <= 0 || !ws || !connected) return;
    loadingMore = true;
    var btn = messagesEl.querySelector(".load-more-btn");
    if (btn) btn.classList.add("loading");
    ws.send(JSON.stringify({ type: "load_more_history", before: historyFrom }));
  }

  function prependOlderHistory(items, meta) {
    // Save current rendering state
    var savedMsgEl = currentMsgEl;
    var savedActivity = activityEl;
    var savedFullText = currentFullText;
    var savedTurnCounter = turnCounter;
    var savedToolsState = saveToolState();

    // Reset to initial values for clean rendering
    currentMsgEl = null;
    activityEl = null;
    currentFullText = "";
    turnCounter = 0;
    resetToolState();

    // Set prepend anchor to insert before existing content
    // Skip the sentinel itself when setting anchor
    var firstReal = messagesEl.querySelector(".history-sentinel");
    prependAnchor = firstReal ? firstReal.nextSibling : messagesEl.firstChild;

    // Remember the first existing content element and its position
    var anchorEl = prependAnchor;
    var anchorOffset = anchorEl ? anchorEl.getBoundingClientRect().top : 0;

    // Process each item through the rendering pipeline
    for (var i = 0; i < items.length; i++) {
      processMessage(items[i]);
    }

    // Finalize any open assistant block from the batch
    finalizeAssistantBlock();

    // Clear prepend mode
    prependAnchor = null;

    // Restore saved state
    currentMsgEl = savedMsgEl;
    activityEl = savedActivity;
    currentFullText = savedFullText;
    turnCounter = savedTurnCounter;
    restoreToolState(savedToolsState);

    // Fix scroll: restore anchor element to same visual position
    if (anchorEl) {
      var newTop = anchorEl.getBoundingClientRect().top;
      messagesEl.scrollTop += (newTop - anchorOffset);
    }

    // Update state
    historyFrom = meta.from;
    loadingMore = false;

    // Renumber data-turn attributes in DOM order
    var turnEls = messagesEl.querySelectorAll("[data-turn]");
    for (var t = 0; t < turnEls.length; t++) {
      turnEls[t].dataset.turn = t + 1;
    }
    turnCounter = turnEls.length;

    // Update sentinel
    if (meta.hasMore) {
      var btn = messagesEl.querySelector(".load-more-btn");
      if (btn) btn.classList.remove("loading");
    } else {
      updateHistorySentinel();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
  }

  // --- Input module (sendMessage, autoResize, paste/image, slash menu, input handlers) ---
  initInput({
    get ws() { return ws; },
    get connected() { return connected; },
    get processing() { return processing; },
    inputEl: inputEl,
    sendBtn: sendBtn,
    slashMenu: slashMenu,
    messagesEl: messagesEl,
    imagePreviewBar: imagePreviewBar,
    slashCommands: function() { return slashCommands; },
    messageUuidMap: function() { return messageUuidMap; },
    addUserMessage: addUserMessage,
    addSystemMessage: addSystemMessage,
    toggleUsagePanel: toggleUsagePanel,
    toggleStatusPanel: toggleStatusPanel,
    toggleContextPanel: toggleContextPanel,
    resetContextData: resetContextData,
    showImageModal: showImageModal,
  });

  // --- Notifications module (viewport, banners, notifications, debug, service worker) ---
  initNotifications({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    messagesEl: messagesEl,
    sessionListEl: sessionListEl,
    scrollToBottom: scrollToBottom,
    basePath: basePath,
    toggleUsagePanel: toggleUsagePanel,
    toggleStatusPanel: toggleStatusPanel,
  });

  // --- Server Settings ---
  initServerSettings({
    get ws() { return ws; },
    get projectName() { return projectName; },
    get currentSlug() { return currentSlug; },
    wsPath: wsPath,
    get currentModels() { return currentModels; },
    set currentModels(v) { currentModels = v; updateConfigChip(); },
    setContextView: setContextView,
    applyContextView: applyContextView,
  });

  // --- QR code ---
  initQrCode();

  // --- File browser ---
  initFileBrowser({
    get ws() { return ws; },
    get connected() { return connected; },
    get activeSessionId() { return activeSessionId; },
    messagesEl: messagesEl,
    fileTreeEl: $("file-tree"),
    fileViewerEl: $("file-viewer"),
  });

  // --- Terminal ---
  initTerminal({
    get ws() { return ws; },
    get connected() { return connected; },
    terminalContainerEl: $("terminal-container"),
    terminalBodyEl: $("terminal-body"),
    fileViewerEl: $("file-viewer"),
  });

  // --- Remove project ---
  function confirmRemoveProject(slug, name) {
    showConfirm("Remove project \"" + name + "\"?", function () {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "remove_project", slug: slug }));
      }
    });
  }

  function handleRemoveProjectResult(msg) {
    if (msg.ok) {
      showToast("Project removed", "success");
      // If we removed the current project, navigate to first available
      if (msg.slug === currentSlug) {
        window.location.href = "/";
      }
    } else {
      showToast(msg.error || "Failed to remove project", "error");
    }
  }

  // --- Add project modal ---
  var addProjectModal = document.getElementById("add-project-modal");
  var addProjectInput = document.getElementById("add-project-input");
  var addProjectSuggestions = document.getElementById("add-project-suggestions");
  var addProjectError = document.getElementById("add-project-error");
  var addProjectOk = document.getElementById("add-project-ok");
  var addProjectCancel = document.getElementById("add-project-cancel");
  var addProjectDebounce = null;
  var addProjectActiveIdx = -1;

  function openAddProjectModal() {
    addProjectModal.classList.remove("hidden");
    addProjectInput.value = "/";
    addProjectError.classList.add("hidden");
    addProjectError.textContent = "";
    addProjectSuggestions.classList.add("hidden");
    addProjectSuggestions.innerHTML = "";
    addProjectActiveIdx = -1;
    addProjectOk.disabled = false;
    setTimeout(function () {
      addProjectInput.focus();
      addProjectInput.setSelectionRange(1, 1);
    }, 50);
  }

  function closeAddProjectModal() {
    addProjectModal.classList.add("hidden");
    addProjectInput.value = "";
    addProjectSuggestions.classList.add("hidden");
    addProjectSuggestions.innerHTML = "";
    addProjectError.classList.add("hidden");
    addProjectActiveIdx = -1;
    if (addProjectDebounce) { clearTimeout(addProjectDebounce); addProjectDebounce = null; }
  }

  function requestBrowseDir(val) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "browse_dir", path: val }));
  }

  function handleBrowseDirResult(msg) {
    addProjectSuggestions.innerHTML = "";
    addProjectActiveIdx = -1;
    if (msg.error) {
      addProjectSuggestions.classList.add("hidden");
      return;
    }
    var entries = msg.entries || [];
    if (entries.length === 0) {
      addProjectSuggestions.classList.add("hidden");
      return;
    }
    for (var si = 0; si < entries.length; si++) {
      var entry = entries[si];
      var item = document.createElement("div");
      item.className = "add-project-suggestion-item";
      item.dataset.path = entry.path;
      item.innerHTML = '<i data-lucide="folder"></i><span class="add-project-suggestion-name">' +
        escapeHtml(entry.name) + '</span>';
      item.addEventListener("click", function (e) {
        var p = this.dataset.path + "/";
        addProjectInput.value = p;
        addProjectInput.focus();
        addProjectError.classList.add("hidden");
        requestBrowseDir(p);
      });
      addProjectSuggestions.appendChild(item);
    }
    addProjectSuggestions.classList.remove("hidden");
    refreshIcons();
  }

  function handleAddProjectResult(msg) {
    if (msg.ok) {
      closeAddProjectModal();
      if (msg.existing) {
        showToast("Project already registered", "info");
      } else {
        showToast("Project added", "success");
        // Navigate to the new project
        if (msg.slug) {
          window.location.href = "/p/" + msg.slug + "/";
        }
      }
    } else {
      addProjectError.textContent = msg.error || "Failed to add project";
      addProjectError.classList.remove("hidden");
      addProjectOk.disabled = false;
    }
  }

  function setActiveIdx(idx) {
    var items = addProjectSuggestions.querySelectorAll(".add-project-suggestion-item");
    addProjectActiveIdx = idx;
    for (var ai = 0; ai < items.length; ai++) {
      if (ai === idx) {
        items[ai].classList.add("active");
        items[ai].scrollIntoView({ block: "nearest" });
      } else {
        items[ai].classList.remove("active");
      }
    }
  }

  addProjectInput.addEventListener("focus", function () {
    var val = addProjectInput.value;
    if (val && addProjectSuggestions.children.length === 0) {
      requestBrowseDir(val);
    } else if (addProjectSuggestions.children.length > 0) {
      addProjectSuggestions.classList.remove("hidden");
    }
  });

  addProjectModal.querySelector(".confirm-dialog").addEventListener("click", function (e) {
    if (e.target === addProjectInput || addProjectInput.contains(e.target)) return;
    if (e.target === addProjectSuggestions || addProjectSuggestions.contains(e.target)) return;
    addProjectSuggestions.classList.add("hidden");
    addProjectActiveIdx = -1;
  });

  addProjectInput.addEventListener("input", function () {
    var val = addProjectInput.value;
    addProjectError.classList.add("hidden");
    if (addProjectDebounce) clearTimeout(addProjectDebounce);
    addProjectDebounce = setTimeout(function () {
      requestBrowseDir(val);
    }, 200);
  });

  addProjectInput.addEventListener("keydown", function (e) {
    var items = addProjectSuggestions.querySelectorAll(".add-project-suggestion-item");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) {
        var next = addProjectActiveIdx < items.length - 1 ? addProjectActiveIdx + 1 : 0;
        setActiveIdx(next);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        var prev = addProjectActiveIdx > 0 ? addProjectActiveIdx - 1 : items.length - 1;
        setActiveIdx(prev);
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      var target = addProjectActiveIdx >= 0 && addProjectActiveIdx < items.length
        ? items[addProjectActiveIdx]
        : items.length > 0 ? items[0] : null;
      if (target) {
        var p = target.dataset.path + "/";
        addProjectInput.value = p;
        addProjectError.classList.add("hidden");
        requestBrowseDir(p);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      // If a suggestion is highlighted, pick it first
      if (addProjectActiveIdx >= 0 && addProjectActiveIdx < items.length) {
        var picked = items[addProjectActiveIdx].dataset.path + "/";
        addProjectInput.value = picked;
        addProjectError.classList.add("hidden");
        requestBrowseDir(picked);
        return;
      }
      // Otherwise submit
      submitAddProject();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeAddProjectModal();
      return;
    }
  });

  function submitAddProject() {
    var val = addProjectInput.value.replace(/\/+$/, "");
    if (!val) return;
    addProjectOk.disabled = true;
    addProjectError.classList.add("hidden");
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "add_project", path: val }));
    }
  }

  addProjectOk.addEventListener("click", function () { submitAddProject(); });
  addProjectCancel.addEventListener("click", function () { closeAddProjectModal(); });

  // Close on backdrop click
  addProjectModal.querySelector(".confirm-backdrop").addEventListener("click", function () {
    closeAddProjectModal();
  });

  // --- Init ---
  lucide.createIcons();
  connect();
  inputEl.focus();
