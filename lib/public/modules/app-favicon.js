// app-favicon.js - Favicon, IO blink, urgent blink, status/activity UI
// Extracted from app.js (PR-34)

import { refreshIcons } from './icons.js';
import { store } from './store.js';
import { getSendBtn, getStatusDot } from './dom-refs.js';
import { onThemeChange } from './theme.js';
import { getActivityEl, setActivityEl, addToMessages, scrollToBottom, VENDOR_AVATARS } from './app-rendering.js';
import { escapeHtml } from './utils.js';

// --- Module-owned state ---
var faviconLink, faviconOrigHref, faviconCanvas, faviconCtx, faviconImg, faviconImgReady;
var pendingFaviconColor = null;
var faviconAnimTimer = null, faviconAnimFrame = 0;
var urgentBlinkTimer = null, urgentTitleTimer = null, savedTitle = null;
var ioTimer = null;
var sessionIoTimers = {};
var crossProjectBlinkTimer = null;

export function initFavicon() {
  if (store.get('paneMode')) return;
  faviconLink = document.querySelector('link[rel="icon"]');
  faviconCanvas = document.createElement("canvas");
  faviconCanvas.width = 32;
  faviconCanvas.height = 32;
  faviconCtx = faviconCanvas.getContext("2d");
  faviconImg = null;
  faviconImgReady = false;

  // Load the brand symbol for status and attention variants.
  (function () {
    faviconImg = new Image();
    faviconImg.onload = function () {
      faviconImgReady = true;
      if (pendingFaviconColor) {
        var color = pendingFaviconColor;
        pendingFaviconColor = null;
        updateFavicon(color);
      }
    };
    faviconImg.src = (store.get('basePath') || "") + "clay-studio-symbol.png";
  })();

  // Reset cached favicon href on theme change
  onThemeChange(function () { faviconOrigHref = null; });
}

export function updateFavicon(bgColor) {
  if (store.get('paneMode')) return;
  if (!faviconLink) return;
  if (!bgColor) {
    if (faviconOrigHref) { faviconLink.href = faviconOrigHref; faviconOrigHref = null; }
    return;
  }
  if (!faviconOrigHref) faviconOrigHref = faviconLink.href;
  if (!faviconImgReady) {
    pendingFaviconColor = bgColor;
    return;
  }
  faviconCtx.clearRect(0, 0, 32, 32);
  faviconCtx.drawImage(faviconImg, 0, 0, 32, 32);
  faviconCtx.fillStyle = bgColor;
  faviconCtx.beginPath();
  faviconCtx.arc(25, 25, 5, 0, Math.PI * 2);
  faviconCtx.fill();
  faviconLink.href = faviconCanvas.toDataURL("image/png");
}

export function drawFaviconAnimFrame() {
  if (store.get('paneMode')) return;
  if (!faviconImgReady) return;
  var S = 32;
  faviconCtx.clearRect(0, 0, S, S);
  faviconCtx.drawImage(faviconImg, 0, 0, S, S);
  faviconCtx.fillStyle = faviconAnimFrame % 2 === 0 ? "#07e5a3" : "#5857fc";
  faviconCtx.beginPath();
  faviconCtx.arc(25, 7, 5, 0, Math.PI * 2);
  faviconCtx.fill();

  faviconLink.href = faviconCanvas.toDataURL("image/png");
  faviconAnimFrame++;
}

export function setSendBtnMode(mode) {
  var sendBtn = getSendBtn();
  if (mode === "stop") {
    sendBtn.disabled = false;
    sendBtn.classList.add("stop");
    sendBtn.innerHTML = '<i data-lucide="square"></i>';
  } else {
    sendBtn.disabled = false;
    sendBtn.classList.remove("stop");
    sendBtn.innerHTML = '<i data-lucide="arrow-up"></i>';
  }
  refreshIcons();
}

export function blinkIO() {
  if (!store.get('connected')) return;
  var dot = getStatusDot();
  if (dot) dot.classList.add("io");
  // Also blink the active session's processing dot in sidebar (project or mate)
  var sessionDot = document.querySelector(".session-item.active .session-processing") ||
                   document.querySelector(".mate-session-item.active .session-processing");
  if (sessionDot) sessionDot.classList.add("io");
  // If active project is a worktree, also blink the parent project dot
  var activeWt = document.querySelector("#icon-strip-projects .icon-strip-wt-item.active");
  var parentDot = null;
  if (activeWt) {
    var group = activeWt.closest(".icon-strip-group");
    if (group) parentDot = group.querySelector(".folder-header .icon-strip-status");
    if (parentDot) parentDot.classList.add("io");
  }
  // Mobile chat chip dot + mobile session dot
  var mobileChipDot = null;
  var _s = store.snap();
  if (_s.dmMode && _s.dmTargetUser && _s.dmTargetUser.isMate) {
    mobileChipDot = document.querySelector('.mobile-chat-chip[data-mate-id="' + _s.dmTargetUser.id + '"] .mobile-chat-chip-dot');
  } else {
    mobileChipDot = document.querySelector('.mobile-chat-chip[data-slug="' + _s.currentSlug + '"] .mobile-chat-chip-dot');
  }
  if (mobileChipDot) mobileChipDot.classList.add("io");
  var mobileSessionDot = document.querySelector('.mobile-session-item.active .mobile-session-dot');
  if (mobileSessionDot) mobileSessionDot.classList.add("io");
  clearTimeout(ioTimer);
  ioTimer = setTimeout(function () {
    var d = getStatusDot();
    if (d) d.classList.remove("io");
    var sd = document.querySelector(".session-item.active .session-processing.io") ||
             document.querySelector(".mate-session-item.active .session-processing.io");
    if (sd) sd.classList.remove("io");
    if (parentDot) parentDot.classList.remove("io");
    if (mobileChipDot) mobileChipDot.classList.remove("io");
    if (mobileSessionDot) mobileSessionDot.classList.remove("io");
  }, 80);
}

export function blinkSessionDot(sessionId) {
  var el = document.querySelector('.session-item[data-session-id="' + sessionId + '"] .session-processing');
  if (!el) return;
  el.classList.add("io");
  clearTimeout(sessionIoTimers[sessionId]);
  sessionIoTimers[sessionId] = setTimeout(function () {
    el.classList.remove("io");
    delete sessionIoTimers[sessionId];
  }, 80);
}

export function updateCrossProjectBlink() {
  if (crossProjectBlinkTimer) { clearTimeout(crossProjectBlinkTimer); crossProjectBlinkTimer = null; }
  function doBlink() {
    var dots = document.querySelectorAll("#icon-strip-projects .icon-strip-item:not(.active) .icon-strip-status.processing, #icon-strip-projects .icon-strip-wt-item:not(.active) .icon-strip-status.processing, #icon-strip-users .icon-strip-mate:not(.active) .icon-strip-status.processing");
    // Also blink mobile chat chip dots (same icon-strip-status class inside chips)
    var mobileDots = document.querySelectorAll(".mobile-chat-chip .icon-strip-status.processing");
    var allDots = [];
    for (var i = 0; i < dots.length; i++) allDots.push(dots[i]);
    for (var m = 0; m < mobileDots.length; m++) allDots.push(mobileDots[m]);
    if (allDots.length === 0) { crossProjectBlinkTimer = null; return; }
    for (var i2 = 0; i2 < allDots.length; i2++) { allDots[i2].classList.add("io"); }
    setTimeout(function () {
      for (var j = 0; j < allDots.length; j++) { allDots[j].classList.remove("io"); }
      crossProjectBlinkTimer = setTimeout(doBlink, 150 + Math.random() * 350);
    }, 80);
  }
  crossProjectBlinkTimer = setTimeout(doBlink, 50);
}

export function startUrgentBlink() {
  if (store.get('paneMode')) return;
  if (urgentBlinkTimer) return;
  savedTitle = document.title;
  if (!faviconOrigHref && faviconLink) faviconOrigHref = faviconLink.href;
  faviconAnimFrame = 0;
  urgentBlinkTimer = setInterval(drawFaviconAnimFrame, 500);
  // Title blink separately
  var titleTick = 0;
  urgentTitleTimer = setInterval(function () {
    document.title = titleTick % 2 === 0 ? "\u26A0 Input needed" : savedTitle;
    titleTick++;
  }, 500);
}

export function stopUrgentBlink() {
  if (store.get('paneMode')) return;
  if (!urgentBlinkTimer) return;
  clearInterval(urgentBlinkTimer);
  clearInterval(urgentTitleTimer);
  urgentBlinkTimer = null;
  urgentTitleTimer = null;
  faviconAnimFrame = 0;
  updateFavicon(null);
  if (savedTitle) document.title = savedTitle;
  savedTitle = null;
}

export function setActivity(text) {
  var thinkingState = store.get('thinkingState');
  if (text === "thinking" && thinkingState && thinkingState.active) {
    // Live Thinking already owns the tail progress UI. Compaction and tool
    // activity intentionally continue through so their distinct states show.
    if (getActivityEl()) {
      getActivityEl().remove();
      setActivityEl(null);
    }
    return;
  }
  if (text) {
    if (!getActivityEl()) {
      var _actEl = document.createElement("div");
      _actEl.className = "activity-inline";
      // In channel mode (Claude Code / Codex sessions), include the vendor
      // avatar so the user can see who is responding while the dots are
      // animating. DM mode handles its own avatar via mate-thinking
      // elements and shouldn't pick up a vendor avatar here.
      var _isDm = !!(store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').isMate);
      if (!_isDm) {
        var _vendor = store.get('currentVendor') || 'claude';
        var _avatarUrl = VENDOR_AVATARS[_vendor] || VENDOR_AVATARS.claude;
        _actEl.innerHTML =
          '<img class="activity-inline-avatar" src="' + escapeHtml(_avatarUrl) + '" alt="">' +
          '<div class="mate-thinking-dots"><span></span><span></span><span></span></div>';
      } else {
        _actEl.innerHTML =
          '<div class="mate-thinking-dots"><span></span><span></span><span></span></div>';
      }
      setActivityEl(_actEl);
      addToMessages(_actEl);
    }
    scrollToBottom();
  } else {
    if (getActivityEl()) {
      getActivityEl().remove();
      setActivityEl(null);
    }
  }
}
