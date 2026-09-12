// app-rate-limit.js - Rate limit UI, scheduled messages, fast mode indicator
// Extracted from app.js (PR-26)

import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { scheduledMessageControl } from './scheduled-message-state.js';
import { getWs } from './ws-ref.js';
import { addToMessages, scrollToBottom } from './app-rendering.js';
import { userAvatarUrl } from './avatar.js';
import { setScheduleDelayMs, clearScheduleDelay } from './input.js';

// --- Module-owned state ---
var rateLimitCountdownTimer = null;
var rateLimitIndicatorEl = null;
var rateLimitResetsAt = null;
var rateLimitResetTimer = null;
var rateLimitUsageEl = null;
var rateLimitResetState = {};
var rateLimitTickTimer = null;
var scheduledMsgEl = null;
var scheduledCountdownTimer = null;
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
      href: "https://chatgpt.com/admin/usage",
      title: "Check usage on ChatGPT",
    },
    claude: {
      icon: "/claude-code-avatar.png",
      alt: "Claude Code",
      href: "https://claude.ai/settings/usage",
      title: "Check usage on claude.ai",
    },
  };
  return fallbacks[vendor] || fallbacks.claude;
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
  rateLimitIndicatorEl.innerHTML =
    '<span class="' + pillClass + '">' +
      iconHtml("alert-triangle") +
      '<span class="header-pill-text">' + label + "</span>" +
      '<a href="https://claude.ai/settings/usage" target="_blank" rel="noopener" class="rate-limit-link">' +
        iconHtml("external-link") +
      "</a>" +
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
  setTimeout(function () {
    pop.classList.add("fade-out");
    setTimeout(function () { if (pop.parentNode) pop.remove(); }, 300);
  }, 5000);
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
  for (var i = 0; i < types.length; i++) {
    var entry = rateLimitResetState[types[i]];
    if (!entry || !entry.resetsAt) continue;
    var timeStr = formatResetTime(entry.resetsAt);
    if (!timeStr) { delete rateLimitResetState[types[i]]; continue; }
    parts.push(rateLimitTypeShortLabel(types[i]) + " resets " + timeStr);
  }
  if (parts.length === 0) {
    rateLimitUsageEl.innerHTML = iconHtml("activity") + '<span>Check usage</span>' + iconHtml("external-link");
    refreshIcons();
    if (rateLimitTickTimer) { clearInterval(rateLimitTickTimer); rateLimitTickTimer = null; }
    return;
  }
  var label = parts.join(" · ");
  rateLimitUsageEl.innerHTML = iconHtml("activity") + '<span>' + label + '</span>' + iconHtml("external-link");
  refreshIcons();
}

// --- Exported functions ---

export function initRateLimit() {
  store.subscribe(function(state, prev) {
    if (state.currentVendor !== prev.currentVendor && state.currentVendor) {
      if (!vendorSupportsScheduledMessages(state.currentVendor)) clearScheduleDelay();
    }
    if (state.currentVendor !== prev.currentVendor || state.vendorInfo !== prev.vendorInfo) {
      if (rateLimitUsageEl) {
        rateLimitUsageEl.style.display = vendorTracksRateLimits(state.currentVendor || "claude") ? "" : "none";
      }
    }
  });
}

export function handleRateLimitEvent(msg) {
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
      // Clear schedule mode when rate limit resets
      clearScheduleDelay();
    }, msg.resetsAt - Date.now() + 1000);
  } else {
    var pct = msg.utilization ? Math.round(msg.utilization * 100) : null;
    popoverText = typeLabel + " warning" + (pct ? " (" + pct + "% used)" : "");
    updateRateLimitIndicator(msg);
  }

  showRateLimitPopover(popoverText, isRejected);
}

export function updateRateLimitUsage(msg) {
  var activeVendor = store.get('currentVendor') || "claude";
  if (!vendorTracksRateLimits(activeVendor)) {
    if (rateLimitUsageEl) rateLimitUsageEl.style.display = "none";
    return;
  }
  if (msg.rateLimitType && msg.resetsAt) {
    rateLimitResetState[msg.rateLimitType] = { resetsAt: msg.resetsAt, status: msg.status };
  }

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

  // Build label from available reset times
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
  var vendor = activeVendor;
  var meta = getVendorUsageMeta(vendor);
  rateLimitUsageEl.href = meta.href;
  rateLimitUsageEl.title = meta.title;
  rateLimitUsageEl.innerHTML =
    '<img src="' + meta.icon + '" class="usage-check-vendor-icon" alt="' + meta.alt + '">' +
    '<span>' + label + '</span>' +
    iconHtml("external-link");
  refreshIcons();

  // Start or stop live countdown tick
  if (parts.length > 0 && !rateLimitTickTimer) {
    rateLimitTickTimer = setInterval(tickRateLimitUsage, 30000);
  } else if (parts.length === 0 && rateLimitTickTimer) {
    clearInterval(rateLimitTickTimer);
    rateLimitTickTimer = null;
  }
}

export function addScheduledMessageBubble(text, resetsAt, correlation) {
  removeScheduledMessageBubble();
  var isChannel = document.body.classList.contains("wide-view");
  var wrap = document.createElement("div");
  wrap.className = "msg-user scheduled-msg-wrap";
  wrap.id = "scheduled-msg-bubble";

  var countdownEl;
  var cancelBtn;

  if (isChannel) {
    // Channel mode: avatar + header with scheduled badge + message
    var _me = store.get('cachedAllUsers').find(function (u) { return u.id === store.get('myUserId'); });
    var _myName = document.body.dataset.myDisplayName || (_me && (_me.displayName || _me.username)) || "Me";

    var avi = document.createElement("img");
    avi.className = "dm-bubble-avatar dm-bubble-avatar-me";
    avi.src = document.body.dataset.myAvatarUrl || userAvatarUrl(_me || { id: store.get('myUserId') }, 36);
    wrap.appendChild(avi);

    var content = document.createElement("div");
    content.className = "dm-bubble-content";

    var header = document.createElement("div");
    header.className = "dm-bubble-header";

    var nameSpan = document.createElement("span");
    nameSpan.className = "dm-bubble-name";
    nameSpan.textContent = _myName;
    header.appendChild(nameSpan);

    var badge = document.createElement("span");
    badge.className = "scheduled-msg-badge";
    badge.innerHTML = iconHtml("clock");
    countdownEl = document.createElement("span");
    countdownEl.className = "scheduled-msg-countdown";
    badge.appendChild(countdownEl);
    header.appendChild(badge);

    var actions = document.createElement("span");
    actions.className = "scheduled-msg-actions";

    var sendNowBtn = document.createElement("button");
    sendNowBtn.className = "scheduled-msg-send-now";
    sendNowBtn.textContent = "Send now";
    sendNowBtn.addEventListener("click", function () {
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(scheduledMessageControl("send_scheduled_now", correlation)));
      }
    });
    actions.appendChild(sendNowBtn);

    var sep = document.createElement("span");
    sep.className = "scheduled-msg-sep";
    sep.textContent = "\u00b7";
    actions.appendChild(sep);

    cancelBtn = document.createElement("button");
    cancelBtn.className = "scheduled-msg-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", function () {
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(scheduledMessageControl("cancel_scheduled_message", correlation)));
      }
    });
    actions.appendChild(cancelBtn);

    header.appendChild(actions);

    content.appendChild(header);

    var bubble = document.createElement("div");
    bubble.className = "bubble scheduled-msg-bubble";
    var textEl = document.createElement("span");
    textEl.textContent = text;
    bubble.appendChild(textEl);
    content.appendChild(bubble);

    wrap.appendChild(content);
  } else {
    // Bubble mode: original layout
    var bubble = document.createElement("div");
    bubble.className = "bubble scheduled-msg-bubble";

    var textEl = document.createElement("span");
    textEl.textContent = text;
    bubble.appendChild(textEl);

    var metaEl = document.createElement("div");
    metaEl.className = "scheduled-msg-meta";

    var clockIcon = document.createElement("span");
    clockIcon.className = "scheduled-msg-icon";
    clockIcon.innerHTML = iconHtml("clock");
    metaEl.appendChild(clockIcon);

    countdownEl = document.createElement("span");
    countdownEl.className = "scheduled-msg-countdown";
    metaEl.appendChild(countdownEl);

    var sendNowBtn2 = document.createElement("button");
    sendNowBtn2.className = "scheduled-msg-send-now";
    sendNowBtn2.textContent = "Send now";
    sendNowBtn2.addEventListener("click", function () {
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(scheduledMessageControl("send_scheduled_now", correlation)));
      }
    });
    metaEl.appendChild(sendNowBtn2);

    var sep2 = document.createElement("span");
    sep2.className = "scheduled-msg-sep";
    sep2.textContent = "\u00b7";
    metaEl.appendChild(sep2);

    cancelBtn = document.createElement("button");
    cancelBtn.className = "scheduled-msg-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", function () {
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(scheduledMessageControl("cancel_scheduled_message", correlation)));
      }
    });
    metaEl.appendChild(cancelBtn);

    wrap.appendChild(bubble);
    wrap.appendChild(metaEl);
  }

  addToMessages(wrap);
  scheduledMsgEl = wrap;
  scrollToBottom();

  // Start countdown
  function updateCountdown() {
    var remaining = resetsAt - Date.now();
    if (remaining <= 0) {
      countdownEl.textContent = "Sending...";
      if (scheduledCountdownTimer) { clearInterval(scheduledCountdownTimer); scheduledCountdownTimer = null; }
      return;
    }
    var hrs = Math.floor(remaining / 3600000);
    var mins = Math.floor((remaining % 3600000) / 60000);
    var secs = Math.floor((remaining % 60000) / 1000);
    var timeStr = "";
    if (hrs > 0) timeStr += hrs + "h ";
    if (mins > 0 || hrs > 0) timeStr += mins + "m ";
    timeStr += secs + "s";

    var sendDate = new Date(resetsAt);
    var absTime = sendDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    countdownEl.textContent = "Sends at " + absTime + " (" + timeStr + ")";
  }
  updateCountdown();
  scheduledCountdownTimer = setInterval(updateCountdown, 1000);
}

export function removeScheduledMessageBubble() {
  if (scheduledMsgEl) {
    scheduledMsgEl.remove();
    scheduledMsgEl = null;
  }
  if (scheduledCountdownTimer) {
    clearInterval(scheduledCountdownTimer);
    scheduledCountdownTimer = null;
  }
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

export function getScheduledMsgEl() { return scheduledMsgEl; }

export function resetRateLimitState() {
  clearRateLimitIndicator();
  store.set({ scheduledMessageCorrelation: null });
  removeScheduledMessageBubble();
  if (rateLimitCountdownTimer) { clearInterval(rateLimitCountdownTimer); rateLimitCountdownTimer = null; }
  if (fastModeIndicatorEl) { fastModeIndicatorEl.remove(); fastModeIndicatorEl = null; }
}
