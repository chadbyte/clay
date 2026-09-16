// app-panels.js - Config chip, usage panel, status panel, context panel
// Extracted from app.js (PR-30)

import { refreshIcons } from "./icons.js";
import { escapeHtml, showToast } from "./utils.js";
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { reportPaneContext } from './pane-bridge.js';
import { setupModelPicker, renderModelPicker, requestVendorModels, prepareModelPickerOpen, modelDisplayName } from './model-picker.js';

// --- Module-owned state (not in store) ---
var sessionUsage = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
var contextData = { contextWindow: 0, currentInput: null, maxOutputTokens: 0, model: "-", cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, thinking: null, costBasis: null };
var ctxPopoverEl = null;
var ctxHoverTimer = null;
var statusRefreshTimer = null;

// --- DOM refs ---
var configChipWrap = null;
var configChip = null;
var configChipLabel = null;
var configPopover = null;
var configModeList = null;
var configEffortSection = null;
var configEffortBar = null;
var configBetaSection = null;
var configBeta1mBtn = null;
var configThinkingSection = null;
var configThinkingBar = null;
var configThinkingBudgetRow = null;
var configThinkingBudgetInput = null;
var configApprovalSection = null;
var configApprovalBar = null;
var configSandboxSection = null;
var configSandboxBar = null;
var configWebsearchSection = null;
var configWebsearchBar = null;

var usagePanel = null;
var usagePanelClose = null;
var usageCostEl = null;
var usageInputEl = null;
var usageOutputEl = null;
var usageCacheReadEl = null;
var usageCacheWriteEl = null;
var usageTurnsEl = null;

var statusPanel = null;
var statusPanelClose = null;
var statusPidEl = null;
var statusUptimeEl = null;
var statusRssEl = null;
var statusHeapUsedEl = null;
var statusHeapTotalEl = null;
var statusExternalEl = null;
var statusSessionsEl = null;
var statusProcessingEl = null;
var statusClientsEl = null;
var statusTerminalsEl = null;

var contextPanel = null;
var contextPanelClose = null;
var contextPanelMinimize = null;
var contextBarFill = null;
var contextBarPct = null;
var contextUsedEl = null;
var contextWindowEl = null;
var contextMaxOutputEl = null;
var contextInputEl = null;
var contextOutputEl = null;
var contextCacheReadEl = null;
var contextCacheWriteEl = null;
var contextModelEl = null;
var contextCostEl = null;
var contextThinkingEl = null;
var contextThinkingRow = null;
var contextCostBasisEl = null;
var contextCostBasisRow = null;
var contextTurnsEl = null;
var contextMini = null;
var contextMiniFill = null;
var contextMiniLabel = null;

// --- Constants ---
var MODE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "plan", label: "Plan" },
  { value: "acceptEdits", label: "Auto-accept edits" },
];
var MODE_FULL_AUTO = { value: "bypassPermissions", label: "Full auto" };
var EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
var EFFORT_LEVELS_BY_VENDOR = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh", "max"],
  antigravity: [],
  opencode: [],
  kiro: ["low", "medium", "high", "xhigh", "max"],
};
var THINKING_OPTIONS = ["disabled", "adaptive", "budget"];
var CODEX_APPROVAL_OPTIONS = [
  { value: "never", label: "Auto" },
  { value: "untrusted", label: "Untrusted" },
  { value: "on-request", label: "Ask" },
];
var CODEX_SANDBOX_OPTIONS = [
  { value: "read-only", label: "Read Only" },
  { value: "workspace-write", label: "Workspace" },
  { value: "danger-full-access", label: "Full Access" },
];
var CODEX_WEBSEARCH_OPTIONS = [
  { value: "disabled", label: "Off" },
  { value: "cached", label: "Cached" },
  { value: "live", label: "Live" },
];
var KNOWN_CONTEXT_WINDOWS = {
  "opus-4-6": 1000000,
  "claude-sonnet-4": 1000000,
  "gpt-6-astra": 1050000,
  "gpt-5.6": 1050000,
  "gpt-5.5": 1048576,
  "gpt-5.4": 1048576,
  "gpt-5.3": 1048576,
  "gpt-5.2": 1048576,
  "gpt-4.1": 1047576,
  "o3": 200000,
  "o4-mini": 200000,
};
// Categories to hide from the legend (noise, not actionable)
var CTX_HIDDEN_CATS = { "Free space": 1, "Autocompact buffer": 1 };

// --- Non-store state accessors (module-owned, not in store) ---
export function getSessionUsage() { return sessionUsage; }
export function setSessionUsage(v) { sessionUsage = v; }
export function getContextData() { return contextData; }
export function setContextData(v) { contextData = v; }

// --- Internal helpers ---

function modeDisplayName(value) {
  for (var i = 0; i < MODE_OPTIONS.length; i++) {
    if (MODE_OPTIONS[i].value === value) return MODE_OPTIONS[i].label;
  }
  if (value === "bypassPermissions") return "Full auto";
  if (value === "dontAsk") return "Don\u2019t ask";
  return value;
}

export function effortDisplayName(value) {
  if (!value) return "";
  if (value === "xhigh") return "X-High";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Effort levels for an arbitrary vendor/model pair (pure; the pair dialog
// uses this for sessions other than the active one). Falls back from the
// model's own supportedEffortLevels to the vendor table.
export function effortLevelsFor(vendor, models, modelValue) {
  var defaults = EFFORT_LEVELS_BY_VENDOR[vendor] || EFFORT_LEVELS;
  var list = models || [];
  for (var i = 0; i < list.length; i++) {
    var value = typeof list[i] === "string" ? list[i] : (list[i] && (list[i].value || list[i].id)) || "";
    if (value === modelValue) {
      if (list[i].supportedEffortLevels && list[i].supportedEffortLevels.length > 0) {
        return list[i].supportedEffortLevels;
      }
      return defaults;
    }
  }
  return defaults;
}

function thinkingDisplayName(value) {
  if (value === "disabled") return "Off";
  if (value === "adaptive") return "Adaptive";
  if (value === "budget") return "Budget";
  return value || "Adaptive";
}

function isSonnetModel(model) {
  if (!model) return false;
  var lower = model.toLowerCase();
  return lower.indexOf("sonnet") !== -1;
}

function hasBeta(name) {
  var betas = store.get('currentBetas');
  for (var i = 0; i < betas.length; i++) {
    if (betas[i].indexOf(name) !== -1) return true;
  }
  return false;
}

function rebuildModeList() {
  if (!configModeList) return;
  configModeList.innerHTML = "";
  var options = MODE_OPTIONS.slice();
  if (store.get('skipPermsEnabled')) {
    options.push(MODE_FULL_AUTO);
  }
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var btn = document.createElement("button");
    btn.className = "config-radio-item";
    if (opt.value === store.get('currentMode')) btn.classList.add("active");
    btn.dataset.mode = opt.value;
    btn.textContent = opt.label;
    btn.addEventListener("click", function () {
      var mode = this.dataset.mode;
      var ws = getWs();
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
    if (level === store.get('currentEffort')) btn.classList.add("active");
    btn.dataset.effort = level;
    btn.textContent = effortDisplayName(level);
    btn.addEventListener("click", function () {
      var effort = this.dataset.effort;
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "set_effort", effort: effort }));
      }
      configPopover.classList.add("hidden");
      configChip.classList.remove("active");
    });
    configEffortBar.appendChild(btn);
  }
}

function rebuildBetaSection() {
  if (!configBetaSection || !configBeta1mBtn) return;
  // Only show for Sonnet models
  if (!isSonnetModel(store.get('currentModel'))) {
    configBetaSection.style.display = "none";
    return;
  }
  configBetaSection.style.display = "";
  var active = hasBeta("context-1m");
  configBeta1mBtn.classList.toggle("active", active);
  configBeta1mBtn.setAttribute("aria-checked", active ? "true" : "false");
}

function rebuildThinkingSection() {
  if (!configThinkingBar || !configThinkingSection) return;
  configThinkingSection.style.display = "";
  configThinkingBar.innerHTML = "";
  var s = store.snap();
  for (var i = 0; i < THINKING_OPTIONS.length; i++) {
    var opt = THINKING_OPTIONS[i];
    var btn = document.createElement("button");
    btn.className = "config-segment-btn";
    if (opt === s.currentThinking) btn.classList.add("active");
    btn.dataset.thinking = opt;
    btn.textContent = thinkingDisplayName(opt);
    btn.addEventListener("click", function () {
      var thinking = this.dataset.thinking;
      var msg = { type: "set_thinking", thinking: thinking };
      if (thinking === "budget") {
        msg.budgetTokens = store.get('currentThinkingBudget');
      }
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
      }
    });
    configThinkingBar.appendChild(btn);
  }
  // Show/hide budget input
  if (configThinkingBudgetRow) {
    configThinkingBudgetRow.style.display = s.currentThinking === "budget" ? "" : "none";
  }
  if (configThinkingBudgetInput) {
    configThinkingBudgetInput.value = s.currentThinkingBudget;
  }
}

function buildSegmentedBar(barEl, options, currentValue, msgType, msgKey) {
  if (!barEl) return;
  barEl.innerHTML = "";
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var btn = document.createElement("button");
    btn.className = "config-segment-btn";
    if (opt.value === currentValue) btn.classList.add("active");
    btn.dataset.val = opt.value;
    btn.textContent = opt.label;
    btn.addEventListener("click", function () {
      var val = this.dataset.val;
      var msg = { type: msgType };
      msg[msgKey] = val;
      var ws = getWs();
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
      configPopover.classList.add("hidden");
      configChip.classList.remove("active");
    });
    barEl.appendChild(btn);
  }
}

function rebuildCodexSections() {
  var s = store.snap();
  var isCodex = (s.currentVendor || "claude") === "codex";

  if (configApprovalSection) {
    configApprovalSection.style.display = isCodex ? "" : "none";
    if (isCodex) buildSegmentedBar(configApprovalBar, CODEX_APPROVAL_OPTIONS, s.codexApproval, "set_codex_approval", "approval");
  }
  if (configSandboxSection) {
    configSandboxSection.style.display = isCodex ? "" : "none";
    if (isCodex) buildSegmentedBar(configSandboxBar, CODEX_SANDBOX_OPTIONS, s.codexSandbox, "set_codex_sandbox", "sandbox");
  }
  if (configWebsearchSection) {
    configWebsearchSection.style.display = isCodex ? "" : "none";
    if (isCodex) buildSegmentedBar(configWebsearchBar, CODEX_WEBSEARCH_OPTIONS, s.codexWebSearch, "set_codex_websearch", "webSearch");
  }
}

function escHtml(s) {
  var div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function em(emoji) {
  return '<span class="ctx-emoji">' + emoji + '</span>';
}

// --- Exported functions ---

export function initPanels() {
  var $ = function (id) { return document.getElementById(id); };

  // Config chip DOM refs
  configChipWrap = $("config-chip-wrap");
  configChip = $("config-chip");
  configChipLabel = $("config-chip-label");
  configPopover = $("config-popover");
  setupModelPicker();
  configModeList = $("config-mode-list");
  configEffortSection = $("config-effort-section");
  configEffortBar = $("config-effort-bar");
  configBetaSection = $("config-beta-section");
  configBeta1mBtn = $("config-beta-1m");
  configThinkingSection = $("config-thinking-section");
  configThinkingBar = $("config-thinking-bar");
  configThinkingBudgetRow = $("config-thinking-budget-row");
  configThinkingBudgetInput = $("config-thinking-budget");
  configApprovalSection = $("config-approval-section");
  configApprovalBar = $("config-approval-bar");
  configSandboxSection = $("config-sandbox-section");
  configSandboxBar = $("config-sandbox-bar");
  configWebsearchSection = $("config-websearch-section");
  configWebsearchBar = $("config-websearch-bar");

  // --- Reactive UI sync ---
  store.subscribe(function (state, prev) {
    // richContextUsage changed -> update popover + panel
    if (state.richContextUsage !== prev.richContextUsage) {
      if (state.richContextUsage) {
        var hce = store.get('headerContextEl');
        if (hce) hce.removeAttribute("data-tip");
        if (state.ctxPopoverVisible) renderCtxPopover();
      } else {
        hideCtxPopover();
      }
      updateContextPanel();
    }
    // Split opened/closed -> show or hide the title-bar context gauge
    if (state.splitPanes !== prev.splitPanes) updateContextPanel();

    // Vendor changed -> switch model list and current model to match
    if (state.currentVendor !== prev.currentVendor && state.currentVendor) {
      requestVendorModels(state.currentVendor, true);
    }

    // config chip
    if (state.currentModel !== prev.currentModel ||
        state.currentMode !== prev.currentMode ||
        state.currentEffort !== prev.currentEffort ||
        state.currentBetas !== prev.currentBetas ||
        state.currentThinking !== prev.currentThinking ||
        state.currentVendor !== prev.currentVendor ||
        state.currentModels !== prev.currentModels ||
        state.vendorCapabilities !== prev.vendorCapabilities ||
        state.modelListStatus !== prev.modelListStatus ||
        state.modelListError !== prev.modelListError ||
        state.modelSelectionPending !== prev.modelSelectionPending ||
        state.modelSelectionError !== prev.modelSelectionError ||
        state.codexApproval !== prev.codexApproval ||
        state.codexSandbox !== prev.codexSandbox ||
        state.codexWebSearch !== prev.codexWebSearch ||
        state.sessionHasHistory !== prev.sessionHasHistory ||
        state.activeSessionMode !== prev.activeSessionMode) {
      updateConfigChip();
    }
  });

  // Usage panel DOM refs
  usagePanel = $("usage-panel");
  usagePanelClose = $("usage-panel-close");
  usageCostEl = $("usage-cost");
  usageInputEl = $("usage-input");
  usageOutputEl = $("usage-output");
  usageCacheReadEl = $("usage-cache-read");
  usageCacheWriteEl = $("usage-cache-write");
  usageTurnsEl = $("usage-turns");

  // Status panel DOM refs
  statusPanel = $("status-panel");
  statusPanelClose = $("status-panel-close");
  statusPidEl = $("status-pid");
  statusUptimeEl = $("status-uptime");
  statusRssEl = $("status-rss");
  statusHeapUsedEl = $("status-heap-used");
  statusHeapTotalEl = $("status-heap-total");
  statusExternalEl = $("status-external");
  statusSessionsEl = $("status-sessions");
  statusProcessingEl = $("status-processing");
  statusClientsEl = $("status-clients");
  statusTerminalsEl = $("status-terminals");

  // Context panel DOM refs
  contextPanel = $("context-panel");
  contextPanelClose = $("context-panel-close");
  contextPanelMinimize = $("context-panel-minimize");
  contextBarFill = $("context-bar-fill");
  contextBarPct = $("context-bar-pct");
  contextUsedEl = $("context-used");
  contextWindowEl = $("context-window");
  contextMaxOutputEl = $("context-max-output");
  contextInputEl = $("context-input");
  contextOutputEl = $("context-output");
  contextCacheReadEl = $("context-cache-read");
  contextCacheWriteEl = $("context-cache-write");
  contextModelEl = $("context-model");
  contextCostEl = $("context-cost");
  contextThinkingEl = $("context-thinking");
  contextThinkingRow = $("context-thinking-row");
  contextCostBasisEl = $("context-cost-basis");
  contextCostBasisRow = $("context-cost-basis-row");
  contextTurnsEl = $("context-turns");
  contextMini = $("context-mini");
  contextMiniFill = $("context-mini-fill");
  contextMiniLabel = $("context-mini-label");

  // --- Event listeners ---

  if (configThinkingBudgetInput) {
    configThinkingBudgetInput.addEventListener("change", function () {
      var val = parseInt(this.value, 10);
      if (isNaN(val) || val < 1024) val = 1024;
      if (val > 128000) val = 128000;
      store.set({ currentThinkingBudget: val });
      this.value = val;
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "set_thinking", thinking: "budget", budgetTokens: val }));
      }
    });
  }

  if (configBeta1mBtn) {
    configBeta1mBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var active = hasBeta("context-1m");
      var betas = store.get('currentBetas');
      var newBetas;
      if (active) {
        // Remove context-1m beta
        newBetas = [];
        for (var i = 0; i < betas.length; i++) {
          if (betas[i].indexOf("context-1m") === -1) {
            newBetas.push(betas[i]);
          }
        }
      } else {
        // Add context-1m beta
        newBetas = betas.slice();
        newBetas.push("context-1m-2025-08-07");
      }
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "set_betas", betas: newBetas }));
      }
    });
  }

  if (configChip) {
    configChip.addEventListener("click", function (e) {
      e.stopPropagation();
      var wasHidden = configPopover.classList.toggle("hidden");
      configChip.classList.toggle("active", !wasHidden);
      if (!wasHidden) prepareModelPickerOpen();
    });
  }

  document.addEventListener("click", function (e) {
    if (configPopover && configChip && !configPopover.contains(e.target) && e.target !== configChip) {
      configPopover.classList.add("hidden");
      configChip.classList.remove("active");
    }
  });

  if (usagePanelClose) {
    usagePanelClose.addEventListener("click", function () {
      usagePanel.classList.add("hidden");
    });
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

  if (contextPanelClose) {
    contextPanelClose.addEventListener("click", function () {
      setContextView("off");
      applyContextView("off");
    });
  }

  if (contextPanelMinimize) {
    contextPanelMinimize.addEventListener("click", minimizeContext);
  }

  if (contextMini) {
    contextMini.addEventListener("click", expandContext);
  }

  // Restore context view on load
  applyContextView(getContextView());
}

// --- Config chip ---

export function updateConfigChip() {
  if (!configChipWrap || !configChip) return;
  configChipWrap.classList.remove("hidden");
  var s = store.snap();
  var vendor = s.currentVendor || "claude";
  configChipLabel.textContent = modelDisplayName(s.currentModel, s.currentModels);
  renderModelPicker();
  rebuildModeList();
  rebuildEffortBar();

  // MODE remains Claude-specific until adapter modes become capabilities.
  var isClaude = vendor === "claude";
  if (configModeList && configModeList.parentElement) configModeList.parentElement.style.display = isClaude ? "" : "none";
  rebuildThinkingSection();
  // capabilities.thinking means "emits a thinking stream" (true for every
  // vendor), NOT "accepts thinking config". The adaptive/extended toggle and
  // budget only feed Claude queries (sm.currentThinking), so the section
  // stays Claude-only until a dedicated thinkingConfig capability exists.
  if (configThinkingSection) configThinkingSection.style.display = isClaude ? "" : "none";
  // BETA section deprecated (1M context is now standard)
  if (configBetaSection) configBetaSection.style.display = "none";
  // APPROVAL, SANDBOX, WEB SEARCH are Codex-only
  rebuildCodexSections();
}

export function getModelSupportsEffort() {
  var s = store.snap();
  if (!s.currentModels || s.currentModels.length === 0) return true; // assume yes if no info
  for (var i = 0; i < s.currentModels.length; i++) {
    if (s.currentModels[i].value === s.currentModel) {
      if (s.currentModels[i].supportsEffort === false) return false;
      return true;
    }
  }
  return true;
}

export function getModelEffortLevels() {
  var s = store.snap();
  return effortLevelsFor(s.currentVendor || "claude", s.currentModels || [], s.currentModel);
}

// --- Usage panel ---

export function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

export function updateUsagePanel() {
  if (!usageCostEl) return;
  usageCostEl.textContent = "$" + sessionUsage.cost.toFixed(4);
  usageInputEl.textContent = formatTokens(sessionUsage.input);
  usageOutputEl.textContent = formatTokens(sessionUsage.output);
  usageCacheReadEl.textContent = formatTokens(sessionUsage.cacheRead);
  usageCacheWriteEl.textContent = formatTokens(sessionUsage.cacheWrite);
  usageTurnsEl.textContent = String(sessionUsage.turns);
}

export function accumulateUsage(cost, usage) {
  // cost is the SDK's total_cost_usd -- a cumulative running total, not a delta.
  // Assign directly instead of summing to avoid overcounting.
  if (cost != null) sessionUsage.cost = cost;
  if (usage) {
    sessionUsage.input += usage.input_tokens || usage.inputTokens || 0;
    sessionUsage.output += usage.output_tokens || usage.outputTokens || 0;
    sessionUsage.cacheRead += usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
    sessionUsage.cacheWrite += usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
  }
  sessionUsage.turns++;
  if (!store.get('replayingHistory')) updateUsagePanel();
}

export function resetUsage() {
  sessionUsage = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  updateUsagePanel();
  if (usagePanel) usagePanel.classList.add("hidden");
}

export function toggleUsagePanel() {
  if (!usagePanel) return;
  usagePanel.classList.toggle("hidden");
  refreshIcons();
}

// --- Status panel ---

export function formatBytes(n) {
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

export function formatUptime(seconds) {
  var d = Math.floor(seconds / 86400);
  var h = Math.floor((seconds % 86400) / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  if (d > 0) return d + "d " + h + "h " + m + "m";
  if (h > 0) return h + "h " + m + "m " + s + "s";
  return m + "m " + s + "s";
}

export function updateStatusPanel(data) {
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

export function requestProcessStats() {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "process_stats" }));
  }
}

export function toggleStatusPanel() {
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

// --- Context panel ---

export function resolveContextWindow(model, sdkValue) {
  var lc = (model || "").toLowerCase();
  if (lc.includes("[1m]")) return 1000000;
  if (sdkValue) return sdkValue;
  for (var key in KNOWN_CONTEXT_WINDOWS) {
    if (lc.includes(key)) return KNOWN_CONTEXT_WINDOWS[key];
  }
  return 200000;
}

export function contextPctClass(pct) {
  return pct >= 85 ? " danger" : pct >= 60 ? " warn" : "";
}

export function updateContextPanel() {
  if (!contextUsedEl) return;
  // Context occupancy is separate from generic per-turn accounting. Codex
  // only supplies currentInput from a verified last-turn snapshot; rich
  // context usage is more authoritative when available.
  var rich = store.get('richContextUsage');
  var hasRich = rich && (
    (typeof rich.totalTokens === "number" && typeof rich.maxTokens === "number" && rich.maxTokens > 0) ||
    (typeof rich.input_tokens === "number" && typeof rich.contextWindow === "number" && rich.contextWindow > 0)
  );
  var hasCurrent = typeof contextData.currentInput === "number";
  var hasContext = !!(hasRich || hasCurrent);
  var used = hasRich ? (typeof rich.totalTokens === "number" ? rich.totalTokens : rich.input_tokens) : (hasCurrent ? contextData.currentInput : 0);
  var win = hasRich ? (typeof rich.maxTokens === "number" ? rich.maxTokens : rich.contextWindow) : (hasCurrent ? contextData.contextWindow : 0);
  var pct = win > 0 ? Math.min(100, (used / win) * 100) : 0;
  var cls = contextPctClass(pct);
  reportPaneContext({ pct: pct, used: used, win: win, cls: cls, model: contextData.model, cost: contextData.cost });
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
    contextMiniLabel.textContent = (win > 0 ? formatTokens(used) + "/" + formatTokens(win) : "-");
  }
  // Header bar. A split group has no meaningful group-level context usage:
  // the two members have separate windows, and the parent shell's own numbers
  // are whatever it last viewed natively. Each pane header carries its own
  // chip instead, so hide the title-bar gauge while a split is open.
  var splitOpen = !!store.get('splitPanes');
  var headerCtxEl = store.get('headerContextEl');
  if (headerCtxEl) headerCtxEl.classList.toggle("hidden", splitOpen || !hasContext);
  if (contextMini) contextMini.classList.toggle("split-hidden", splitOpen || !hasContext);
  if (hasContext && !splitOpen) {
    var statusArea = document.querySelector(".title-bar-content .status");
    var hCtxEl = store.get('headerContextEl');
    if (statusArea && !hCtxEl) {
      hCtxEl = document.createElement("div");
      hCtxEl.className = "header-context";
      hCtxEl.innerHTML = '<div class="header-context-bar"><div class="header-context-fill"></div></div><span class="header-context-label"></span>';
      statusArea.insertBefore(hCtxEl, statusArea.firstChild);
      hCtxEl.addEventListener("mouseenter", function() {
        if (store.get('richContextUsage')) {
          showCtxPopover();
        }
      });
      hCtxEl.addEventListener("mouseleave", function() {
        ctxHoverTimer = setTimeout(hideCtxPopover, 120);
      });
      store.set({ headerContextEl: hCtxEl });
    }
    if (hCtxEl) {
      var hFill = hCtxEl.querySelector(".header-context-fill");
      var hLabel = hCtxEl.querySelector(".header-context-label");
      hFill.style.width = pct.toFixed(1) + "%";
      hFill.className = "header-context-fill" + cls;
      hLabel.textContent = pct.toFixed(0) + "%";
      // Use data-tip as fallback when rich data is not yet loaded
      if (store.get('richContextUsage')) {
        hCtxEl.removeAttribute("data-tip");
      } else {
        hCtxEl.dataset.tip = "Context window " + pct.toFixed(0) + "% used (" + formatTokens(used) + " / " + formatTokens(win) + " tokens)";
      }
    }
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
  // Optional SDK fields: shown only once the CLI has actually reported them.
  if (contextThinkingRow && contextThinkingEl) {
    var hasThinking = typeof contextData.thinking === "number";
    contextThinkingRow.classList.toggle("hidden", !hasThinking);
    if (hasThinking) contextThinkingEl.textContent = formatTokens(contextData.thinking);
  }
  if (contextCostBasisRow && contextCostBasisEl) {
    contextCostBasisRow.classList.toggle("hidden", !contextData.costBasis);
    if (contextData.costBasis) contextCostBasisEl.textContent = contextData.costBasis;
  }
  contextTurnsEl.textContent = String(contextData.turns);
}

export function accumulateContext(cost, usage, modelUsage, lastStreamInputTokens) {
  // cost is the SDK's total_cost_usd -- a cumulative running total, not a delta.
  if (cost != null) contextData.cost = cost;
  // Use latest turn values (not cumulative) since each turn's input_tokens
  // already includes the full conversation context up to that point
  if (usage) {
    // Prefer per-call input_tokens from the last stream message_start event
    // when available -- result.usage.input_tokens sums all API calls in a turn,
    // inflating context usage when tools are involved.
    // Falls back to the summed value for setups that don't emit message_start.
    if (typeof lastStreamInputTokens === "number") {
      contextData.input = lastStreamInputTokens;
    } else {
      contextData.input = (usage.input_tokens || usage.inputTokens || 0)
          + (usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0);
    }
    contextData.output = usage.output_tokens || usage.outputTokens || 0;
    contextData.cacheRead = usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
    contextData.cacheWrite = usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
    if (store.get('currentVendor') === "codex") {
      contextData.currentInput = typeof lastStreamInputTokens === "number" ? lastStreamInputTokens : null;
    } else {
      contextData.currentInput = typeof lastStreamInputTokens === "number" ? lastStreamInputTokens : contextData.input;
    }
  }
  contextData.turns++;
  if (modelUsage) {
    var models = Object.keys(modelUsage);
    if (models.length > 0) {
      var m = models[0];
      var mu = modelUsage[m];
      // Prefer the user-configured model name over the API-reported one
      // (e.g. CLI reports "claude-sonnet-4-6" even when running as opus[1m])
      var displayModel = store.get('currentModel') || m;
      contextData.model = displayModel;
      contextData.contextWindow = resolveContextWindow(displayModel, mu.contextWindow);
      if (mu.maxOutputTokens) contextData.maxOutputTokens = mu.maxOutputTokens;
      if (store.get('currentVendor') === "codex") {
        var snapshot = mu.contextSnapshot;
        if (snapshot) store.set({ richContextUsage: null });
        if (snapshot && snapshot.valid === true
            && typeof snapshot.inputTokens === "number"
            && typeof snapshot.contextWindow === "number"
            && snapshot.contextWindow > 0) {
          contextData.currentInput = snapshot.inputTokens;
          contextData.contextWindow = snapshot.contextWindow;
        } else {
          // An explicit invalid marker is authoritative: do not retain an
          // occupancy value from the previous live turn or history replay.
          contextData.currentInput = null;
        }
      }

      // thinkingTokens and costBasis are per-model and optional: absent on
      // older CLI builds and, for a resumed session, on the turns that ran
      // before the field existed. Leave them null in that case so the rows
      // stay hidden rather than claiming a confident zero.
      var thinkingTotal = null;
      var basis = null;
      var basisMixed = false;
      for (var mi = 0; mi < models.length; mi++) {
        var entry = modelUsage[models[mi]];
        if (!entry) continue;
        if (typeof entry.thinkingTokens === "number") {
          thinkingTotal = (thinkingTotal || 0) + entry.thinkingTokens;
        }
        if (entry.costBasis) {
          if (basis === null) basis = entry.costBasis;
          else if (basis !== entry.costBasis) basisMixed = true;
        }
      }
      contextData.thinking = thinkingTotal;
      // Several models in one query can be priced differently; say so rather
      // than reporting whichever happened to come first.
      contextData.costBasis = basisMixed ? "mixed" : basis;
    }
  }
  if (!store.get('replayingHistory')) updateContextPanel();
}

// contextView: "off" | "mini" | "panel"
export function getContextView() {
  try { return localStorage.getItem("clay-context-view") || "off"; } catch (e) { return "off"; }
}

export function setContextView(v) {
  try { localStorage.setItem("clay-context-view", v); } catch (e) {}
}

export function applyContextView(view) {
  if (contextPanel) contextPanel.classList.toggle("hidden", view !== "panel");
  if (contextMini) contextMini.classList.toggle("hidden", view !== "mini");
  if (view === "panel") { refreshIcons(); requestContextDetails(); }
}

export function resetContextData() {
  contextData = { contextWindow: 0, currentInput: null, maxOutputTokens: 0, model: "-", cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, thinking: null, costBasis: null };
  store.set({ richContextUsage: null });
  // hideCtxPopover + updateContextPanel handled by store subscriber
}

export function markContextUnavailable() {
  contextData.currentInput = null;
  store.set({ richContextUsage: null });
  updateContextPanel();
}

export function resetContext() {
  resetContextData();
  // Keep view state, just reset data
  applyContextView(getContextView());
}

export function minimizeContext() {
  setContextView("mini");
  applyContextView("mini");
}

export function expandContext() {
  setContextView("panel");
  applyContextView("panel");
}

export function toggleContextPanel() {
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

// --- Rich context usage popover ---

export function ensureCtxPopover() {
  if (ctxPopoverEl) return;
  ctxPopoverEl = document.createElement("div");
  ctxPopoverEl.className = "context-usage-popover hidden";
  // Keep popover open when hovering over it
  ctxPopoverEl.addEventListener("mouseenter", function() {
    if (ctxHoverTimer) { clearTimeout(ctxHoverTimer); ctxHoverTimer = null; }
  });
  ctxPopoverEl.addEventListener("mouseleave", function() {
    hideCtxPopover();
  });
}

function requestContextDetails() {
  var ws = getWs();
  if (!store.get("replayingHistory") && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "context_usage_request", sessionId: store.get("activeSessionId") }));
  }
}

export function showCtxPopover() {
  var s = store.snap();
  if (!s.headerContextEl || !s.richContextUsage) return;
  requestContextDetails();
  if (ctxHoverTimer) { clearTimeout(ctxHoverTimer); ctxHoverTimer = null; }
  ensureCtxPopover();
  s.headerContextEl.appendChild(ctxPopoverEl);
  renderCtxPopover();
  ctxPopoverEl.classList.remove("hidden");
  store.set({ ctxPopoverVisible: true });
}

export function hideCtxPopover() {
  if (!ctxPopoverEl) return;
  ctxPopoverEl.classList.add("hidden");
  store.set({ ctxPopoverVisible: false });
}

export function renderCtxPopover() {
  var richContextUsage = store.get('richContextUsage');
  if (!ctxPopoverEl || !richContextUsage) return;
  var d = richContextUsage;
  var cats = d.categories || [];
  var total = d.totalTokens != null ? d.totalTokens : (d.input_tokens || 0);
  var max = d.maxTokens != null ? d.maxTokens : (d.contextWindow || 0);
  var pct = d.percentage != null ? d.percentage : (max > 0 ? (total / max) * 100 : 0);

  var html = "";

  // Header
  html += '<div class="ctx-pop-header">';
  html += '<span class="ctx-pop-model">' + escHtml(d.model || contextData.model || "-") + '</span>';
  html += '<span class="ctx-pop-pct">' + pct.toFixed(0) + '%';
  html += '<span class="ctx-pop-tokens">' + formatTokens(total) + ' / ' + formatTokens(max) + '</span>';
  html += '</span>';
  html += '</div>';

  // Category emoji map
  var CTX_EMOJI = {
    "System prompt": "\ud83d\udcdc", "System tools": "\ud83d\udee0\ufe0f",
    "Memory files": "\ud83d\udcc1", "Skills": "\u26a1", "Messages": "\ud83d\udcac",
    "MCP tools": "\ud83d\udd0c", "Agents": "\ud83e\udd16", "Deferred tools": "\ud83d\udce6"
  };

  // Stacked bar
  if (cats.length > 0 && max > 0) {
    html += '<div class="ctx-cat-bar">';
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      if (cat.isDeferred || !cat.tokens || CTX_HIDDEN_CATS[cat.name]) continue;
      var w = Math.max(0.3, (cat.tokens / max) * 100);
      html += '<div style="width:' + w.toFixed(2) + '%;background:' + escHtml(cat.color) + '"></div>';
    }
    html += '</div>';

    // Legend
    html += '<div class="ctx-cat-legend">';
    for (var j = 0; j < cats.length; j++) {
      var c = cats[j];
      if (c.isDeferred || !c.tokens || CTX_HIDDEN_CATS[c.name]) continue;
      var emoji = CTX_EMOJI[c.name] || "\ud83d\udcca";
      html += '<div class="ctx-cat-item">';
      html += '<span class="ctx-cat-name">' + em(emoji) + ' ' + escHtml(c.name) + '</span>';
      html += '<span class="ctx-cat-value">' + formatTokens(c.tokens) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Message breakdown
  var mb = d.messageBreakdown;
  if (mb) {
    html += '<div class="ctx-pop-divider"></div>';
    html += '<div class="ctx-pop-section-label">' + em("\ud83d\udcac") + ' Messages</div>';
    if (mb.userMessageTokens) {
      html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udc64") + ' User</span><span class="ctx-pop-row-value">' + formatTokens(mb.userMessageTokens) + '</span></div>';
    }
    if (mb.assistantMessageTokens) {
      html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83e\udd16") + ' Assistant</span><span class="ctx-pop-row-value">' + formatTokens(mb.assistantMessageTokens) + '</span></div>';
    }
    if (mb.toolCallTokens) {
      html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udee0\ufe0f") + ' Tool calls</span><span class="ctx-pop-row-value">' + formatTokens(mb.toolCallTokens) + '</span></div>';
    }
    if (mb.toolResultTokens) {
      html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udccb") + ' Tool results</span><span class="ctx-pop-row-value">' + formatTokens(mb.toolResultTokens) + '</span></div>';
    }
    if (mb.attachmentTokens) {
      html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udcce") + ' Attachments</span><span class="ctx-pop-row-value">' + formatTokens(mb.attachmentTokens) + '</span></div>';
    }
  }

  // Memory files
  var mf = d.memoryFiles;
  if (mf && mf.length > 0) {
    html += '<div class="ctx-pop-divider"></div>';
    html += '<div class="ctx-pop-section-label">' + em("\ud83d\udcc1") + ' Memory Files</div>';
    var baseCount = {};
    for (var mc = 0; mc < mf.length; mc++) {
      var bn = mf[mc].path.split("/").pop() || mf[mc].path;
      baseCount[bn] = (baseCount[bn] || 0) + 1;
    }
    for (var mi = 0; mi < mf.length; mi++) {
      var fpath = mf[mi].path;
      var fname = fpath.split("/").pop() || fpath;
      if (baseCount[fname] > 1) {
        var parts = fpath.split("/");
        fname = parts.length >= 2 ? parts[parts.length - 2] + "/" + fname : fpath;
      }
      html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udcc4") + ' ' + escHtml(fname) + '</span><span class="ctx-pop-row-value">' + formatTokens(mf[mi].tokens) + '</span></div>';
    }
  }

  // Auto-compact note
  if (d.isAutoCompactEnabled && d.autoCompactThreshold) {
    html += '<div class="ctx-pop-note">' + em("\u267b\ufe0f") + ' Auto-compact at ' + formatTokens(d.autoCompactThreshold) + '</div>';
  }

  ctxPopoverEl.innerHTML = html;
}
