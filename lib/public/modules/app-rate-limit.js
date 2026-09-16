// app-rate-limit.js - Rate limit UI, scheduled messages, fast mode indicator
// Extracted from app.js (PR-26)

import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { setScheduleDelayMs, clearScheduleDelay } from './input.js';

// --- Module-owned state ---
var rateLimitCountdownTimer = null;
var rateLimitIndicatorEl = null;
var rateLimitResetsAt = null;
var rateLimitResetTimer = null;
var rateLimitUsageEl = null;
var rateLimitResetState = {};
var rateLimitTickTimer = null;
var rateLimitPopoverTimers = [];
var fastModeIndicatorEl = null;

// --- Internal helpers ---

function getVendorUsageMeta(vendor) {
  var vendors = store.get('vendorInfo') || {};
  var info = vendors[vendor];
  if (info && info.usageDashboard) return info.usageDashboard;
  var fallbacks = {
    codex: {
      icon: "/codex-avatar.png",
      alt: "Codex",
      href: "https://chatgpt.com/codex/settings/usage",
      title: "Check usage on ChatGPT",
    },
    claude: {
      icon: "/claude-code-avatar.png",
      alt: "Claude Code",
      href: "https://claude.ai/settings/usage",
      title: "Check usage on claude.ai",
    },
  };
  return fallbacks[vendor] || null;
}

function vendorTracksRateLimits(vendor) {
  var vendors = store.get('vendorInfo') || {};
  var info = vendors[vendor];
  if (info) return info.rateLimitTracking !== false;
  var legacyTrackedVendors = ["claude", "codex"];
  return legacyTrackedVendors.indexOf(vendor) !== -1;
}

function vendorSupportsScheduledMessages(vendor) {
  var scheduledMessageVendors = ["claude"];
  return scheduledMessageVendors.indexOf(vendor) !== -1;
}

function rateLimitEventAppliesToPane(msg, state) {
  var activeSessionId = state.activeSessionId;
  var activeVendor = state.currentVendor || "claude";
  if (!msg) return false;
  if (msg.sessionId != null && String(msg.sessionId) !== String(activeSessionId)) return false;
  if (msg.vendor) return msg.vendor === activeVendor;
  // Legacy Claude records predate vendor/session stamps. Never project them
  // into a non-Claude pane, where they would look like Claude usage.
  return activeVendor === "claude";
}

function rateLimitStateKey(sessionId, vendor) {
  return String(store.get('currentSlug') || "") + "\u0000" +
    String(store.get('myUserId') || "") + "\u0000" +
    String(sessionId == null ? "" : sessionId) + "\u0000" + String(vendor || "claude");
}

function getActiveRateLimitState() {
  var state = store.get('rateLimitState') || {};
  var key = rateLimitStateKey(store.get('activeSessionId'), store.get('currentVendor'));
  return state[key] || {};
}

function setActiveRateLimitState(next) {
  var state = Object.assign({}, store.get('rateLimitState') || {});
  var key = rateLimitStateKey(store.get('activeSessionId'), store.get('currentVendor'));
  state[key] = next;
  store.set({ rateLimitState: state });
  rateLimitResetState = next;
}

function rateLimitTypeLabel(type) {
  if (!type) return "Usage";
  var labels = {
    "five_hour": "5-hour",
    "seven_day": "7-day",
    "seven_day_opus": "7-day Opus",
    "seven_day_sonnet": "7-day Sonnet",
    "overage": "Overage",
  };
  return labels[type] || type;
}

function startRateLimitCountdown(el, resetsAt, cardEl) {
  if (rateLimitCountdownTimer) clearInterval(rateLimitCountdownTimer);

  function tick() {
    var remaining = resetsAt - Date.now();
    if (remaining <= 0) {
      clearInterval(rateLimitCountdownTimer);
      rateLimitCountdownTimer = null;
      clearRateLimitIndicator();
      return;
    }
    // Update pill text with countdown
    if (rateLimitIndicatorEl) {
      var pillText = rateLimitIndicatorEl.querySelector(".header-pill-text");
      if (pillText) {
        var mins = Math.floor(remaining / 60000);
        var secs = Math.floor((remaining % 60000) / 1000);
        if (mins >= 60) {
          var hrs = Math.floor(mins / 60);
          mins = mins % 60;
          pillText.textContent = hrs + "h " + mins + "m";
        } else {
          pillText.textContent = mins + "m " + secs + "s";
        }
      }
    }
  }

  tick();
  rateLimitCountdownTimer = setInterval(tick, 1000);
}

function updateRateLimitIndicator(msg) {
  var statusArea = document.querySelector(".title-bar-content .status");
  if (!statusArea) return;

  if (!rateLimitIndicatorEl) {
    rateLimitIndicatorEl = document.createElement("span");
    rateLimitIndicatorEl.className = "header-rate-limit-wrap";
    statusArea.insertBefore(rateLimitIndicatorEl, statusArea.firstChild);
  }

  var isRejected = msg.status === "rejected";
  var pillClass = "header-rate-limit" + (isRejected ? " rejected" : " warning");
  var label = isRejected ? "Rate limited" : "Rate warning";
  var meta = getVendorUsageMeta(store.get('currentVendor') || "claude");
  var link = meta
    ? '<a href="' + meta.href + '" target="_blank" rel="noopener" class="rate-limit-link" title="' + meta.title + '">' + iconHtml("external-link") + "</a>"
    : '<span class="rate-limit-link unavailable" title="Usage information is unavailable for this vendor">' + iconHtml("external-link") + "</span>";
  rateLimitIndicatorEl.innerHTML =
    '<span class="' + pillClass + '">' +
      iconHtml("alert-triangle") +
      '<span class="header-pill-text">' + label + "</span>" +
      link +
    "</span>";
  refreshIcons();
}

function showRateLimitPopover(text, isRejected) {
  if (!rateLimitIndicatorEl) return;
  // Remove existing popover
  var old = rateLimitIndicatorEl.querySelector(".rate-limit-popover");
  if (old) old.remove();

  var pop = document.createElement("div");
  pop.className = "rate-limit-popover" + (isRejected ? " rejected" : "");
  pop.textContent = text;
  rateLimitIndicatorEl.appendChild(pop);

  // Auto-dismiss after 5s
  var fadeTimer = setTimeout(function () {
    pop.classList.add("fade-out");
    var removeTimer = setTimeout(function () { if (pop.parentNode) pop.remove(); }, 300);
    rateLimitPopoverTimers.push(removeTimer);
  }, 5000);
  rateLimitPopoverTimers.push(fadeTimer);
}

function clearRateLimitIndicator() {
  if (rateLimitIndicatorEl) {
    rateLimitIndicatorEl.remove();
    rateLimitIndicatorEl = null;
  }
}

function formatResetTime(resetsAt) {
  if (!resetsAt) return "";
  var d = new Date(resetsAt);
  var now = new Date();
  var diff = resetsAt - now.getTime();
  if (diff <= 0) return "";
  var hrs = Math.floor(diff / 3600000);
  var mins = Math.floor((diff % 3600000) / 60000);
  if (hrs > 0) return hrs + "h " + mins + "m";
  return mins + "m";
}

function rateLimitTypeShortLabel(type) {
  if (type === "five_hour") return "5h";
  if (type === "seven_day") return "7d";
  if (type === "seven_day_opus") return "7d opus";
  if (type === "seven_day_sonnet") return "7d sonnet";
  return type || "";
}

function tickRateLimitUsage() {
  if (!rateLimitUsageEl) return;
  var parts = [];
  var types = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];
  var nextState = Object.assign({}, rateLimitResetState);
  var changed = false;
  for (var i = 0; i < types.length; i++) {
    var entry = rateLimitResetState[types[i]];
    if (!entry || !entry.resetsAt) continue;
    var timeStr = formatResetTime(entry.resetsAt);
    if (!timeStr) { delete nextState[types[i]]; changed = true; continue; }
    parts.push(rateLimitTypeShortLabel(types[i]) + " resets " + timeStr);
  }
  if (changed) setActiveRateLimitState(nextState);
  if (parts.length === 0) {
    renderRateLimitUsage();
    return;
  }
  renderRateLimitUsage();
}

function renderRateLimitUsage() {
  var activeVendor = store.get('currentVendor') || "claude";
  if (!vendorTracksRateLimits(activeVendor)) {
    if (rateLimitUsageEl) {
      rateLimitUsageEl.remove();
      rateLimitUsageEl = null;
    }
    if (rateLimitTickTimer) { clearInterval(rateLimitTickTimer); rateLimitTickTimer = null; }
    return;
  }

  rateLimitResetState = getActiveRateLimitState();
  var topBarActions = document.querySelector("#top-bar .top-bar-actions");
  if (!topBarActions) return;
  if (!rateLimitUsageEl) {
    rateLimitUsageEl = document.createElement("a");
    rateLimitUsageEl.id = "rate-limit-usage-link";
    rateLimitUsageEl.className = "top-bar-pill pill-dim usage-check-link";
    rateLimitUsageEl.target = "_blank";
    rateLimitUsageEl.rel = "noopener";
    var ref = document.getElementById("skip-perms-pill");
    topBarActions.insertBefore(rateLimitUsageEl, ref);
  }
  rateLimitUsageEl.style.display = "";

  var parts = [];
  var types = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];
  for (var i = 0; i < types.length; i++) {
    var entry = rateLimitResetState[types[i]];
    if (!entry || !entry.resetsAt) continue;
    var timeStr = formatResetTime(entry.resetsAt);
    if (!timeStr) continue;
    parts.push(rateLimitTypeShortLabel(types[i]) + " resets " + timeStr);
  }

  var label = parts.length > 0 ? parts.join(" · ") : "Check usage";
  var meta = getVendorUsageMeta(activeVendor);
  if (meta) {
    rateLimitUsageEl.href = meta.href;
    rateLimitUsageEl.title = meta.title;
    rateLimitUsageEl.removeAttribute("aria-disabled");
    rateLimitUsageEl.innerHTML =
      '<img src="' + meta.icon + '" class="usage-check-vendor-icon" alt="' + meta.alt + '">' +
      '<span>' + label + '</span>' + iconHtml("external-link");
  } else {
    rateLimitUsageEl.removeAttribute("href");
    rateLimitUsageEl.setAttribute("aria-disabled", "true");
    rateLimitUsageEl.title = "Usage information is unavailable for this vendor";
    rateLimitUsageEl.innerHTML = '<span>' + (parts.length > 0 ? label : "Usage unavailable") + '</span>';
  }
  refreshIcons();

  if (parts.length > 0 && !rateLimitTickTimer) {
    rateLimitTickTimer = setInterval(tickRateLimitUsage, 30000);
  } else if (parts.length === 0 && rateLimitTickTimer) {
    clearInterval(rateLimitTickTimer);
    rateLimitTickTimer = null;
  }
}

// --- Exported functions ---

export function initRateLimit() {
  store.subscribe(function(state, prev) {
    if (state.currentVendor !== prev.currentVendor && state.currentVendor) {
      if (!vendorSupportsScheduledMessages(state.currentVendor)) clearScheduleDelay();
    }
    if (state.currentVendor !== prev.currentVendor || state.activeSessionId !== prev.activeSessionId
        || state.currentSlug !== prev.currentSlug || state.myUserId !== prev.myUserId) {
      resetRateLimitState();
    }
    if (state.vendorInfo !== prev.vendorInfo && state.currentVendor === prev.currentVendor && state.activeSessionId === prev.activeSessionId
        && state.currentSlug === prev.currentSlug && state.myUserId === prev.myUserId) {
      renderRateLimitUsage();
    }
  });
}

export function handleRateLimitEvent(msg) {
  if (!rateLimitEventAppliesToPane(msg, store.snap())) return;
  if (msg.resetsAt && msg.resetsAt <= Date.now()) {
    var expiredState = Object.assign({}, getActiveRateLimitState());
    if (msg.rateLimitType) delete expiredState[msg.rateLimitType];
    setActiveRateLimitState(expiredState);
    clearRateLimitIndicator();
    renderRateLimitUsage();
    return;
  }
  if (msg.rateLimitType && msg.resetsAt) {
    var eventState = Object.assign({}, getActiveRateLimitState());
    eventState[msg.rateLimitType] = { resetsAt: msg.resetsAt, status: msg.status };
    setActiveRateLimitState(eventState);
  }
  var isRejected = msg.status === "rejected";
  var typeLabel = rateLimitTypeLabel(msg.rateLimitType);
  var popoverText = "";

  if (isRejected && msg.resetsAt) {
    // Check if already expired (history replay) — skip popover
    if (msg.resetsAt < Date.now()) {
      updateRateLimitIndicator(msg);
      return;
    }
    popoverText = typeLabel + " limit exceeded";
    updateRateLimitIndicator(msg);
    startRateLimitCountdown(null, msg.resetsAt, null);
    // Track rate limit reset time
    rateLimitResetsAt = msg.resetsAt;
    if (rateLimitResetTimer) clearTimeout(rateLimitResetTimer);
    // Auto-switch input to schedule mode: any message typed will be queued for after reset
    var delayUntilReset = msg.resetsAt - Date.now();
    if (delayUntilReset > 0 && vendorSupportsScheduledMessages(store.get('currentVendor') || "claude")) {
      setScheduleDelayMs(delayUntilReset + 60000); // +1min buffer after reset
    }
    rateLimitResetTimer = setTimeout(function () {
      rateLimitResetsAt = null;
      rateLimitResetTimer = null;
      var currentState = Object.assign({}, getActiveRateLimitState());
      delete currentState[msg.rateLimitType];
      setActiveRateLimitState(currentState);
      // Clear schedule mode when rate limit resets
      clearScheduleDelay();
      renderRateLimitUsage();
    }, msg.resetsAt - Date.now() + 1000);
  } else {
    var pct = msg.utilization ? Math.round(msg.utilization * 100) : null;
    popoverText = typeLabel + " warning" + (pct ? " (" + pct + "% used)" : "");
    updateRateLimitIndicator(msg);
  }

  showRateLimitPopover(popoverText, isRejected);
}

export function updateRateLimitUsage(msg) {
  if (!rateLimitEventAppliesToPane(msg, store.snap())) return;
  var activeVendor = store.get('currentVendor') || "claude";
  if (!vendorTracksRateLimits(activeVendor)) {
    renderRateLimitUsage();
    return;
  }
  if (msg.rateLimitType && msg.resetsAt) {
    var nextState = Object.assign({}, getActiveRateLimitState());
    nextState[msg.rateLimitType] = { resetsAt: msg.resetsAt, status: msg.status };
    setActiveRateLimitState(nextState);
  }

  renderRateLimitUsage();
}

export function handleFastModeState(state) {
  var statusArea = document.querySelector(".title-bar-content .status");
  if (!statusArea) return;

  if (state === "off") {
    if (fastModeIndicatorEl) {
      fastModeIndicatorEl.remove();
      fastModeIndicatorEl = null;
    }
    return;
  }

  if (!fastModeIndicatorEl) {
    fastModeIndicatorEl = document.createElement("span");
    statusArea.insertBefore(fastModeIndicatorEl, statusArea.firstChild);
  }

  if (state === "cooldown") {
    fastModeIndicatorEl.className = "header-fast-mode cooldown";
    fastModeIndicatorEl.innerHTML = iconHtml("timer") + '<span class="header-pill-text">Cooldown</span>';
  } else if (state === "on") {
    fastModeIndicatorEl.className = "header-fast-mode active";
    fastModeIndicatorEl.innerHTML = iconHtml("zap") + '<span class="header-pill-text">Fast mode</span>';
  }
  refreshIcons();
}

export function resetRateLimitState() {
  clearRateLimitIndicator();
  rateLimitResetsAt = null;
  if (rateLimitResetTimer) { clearTimeout(rateLimitResetTimer); rateLimitResetTimer = null; }
  clearScheduleDelay();
  for (var i = 0; i < rateLimitPopoverTimers.length; i++) clearTimeout(rateLimitPopoverTimers[i]);
  rateLimitPopoverTimers = [];
  if (rateLimitTickTimer) { clearInterval(rateLimitTickTimer); rateLimitTickTimer = null; }
  if (rateLimitCountdownTimer) { clearInterval(rateLimitCountdownTimer); rateLimitCountdownTimer = null; }
  rateLimitResetState = getActiveRateLimitState();
  renderRateLimitUsage();
  if (fastModeIndicatorEl) { fastModeIndicatorEl.remove(); fastModeIndicatorEl = null; }
}

export { rateLimitEventAppliesToPane, getVendorUsageMeta };
