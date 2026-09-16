// chat-render-runtime.js - Shared project transcript state and scrolling.

import { store } from './store.js';
import { getMessagesEl } from './dom-refs.js';

export var VENDOR_AVATARS = {
  claude: "/claude-code-avatar.png",
  codex: "/codex-avatar.png",
  antigravity: "/antigravity-avatar.png",
  opencode: "/opencode-avatar.svg",
  kimi: "/kimi-avatar.svg",
  grok: "/grok-avatar.svg",
  copilot: "/copilot-avatar.svg",
  qwen: "/qwen-avatar.svg",
  junie: "/junie-avatar.svg",
  kiro: "/kiro-avatar.svg",
};

export var VENDOR_NAMES = {
  claude: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity CLI",
  opencode: "OpenCode",
  kimi: "Kimi Code",
  grok: "Grok Build",
  copilot: "GitHub Copilot CLI",
  qwen: "Qwen Code",
  junie: "Junie CLI",
  kiro: "Kiro CLI",
};

export var VENDOR_HOMEPAGES = {
  claude: "https://claude.com/product/claude-code",
  codex: "https://openai.com/codex/",
  antigravity: "https://antigravity.google/product/antigravity-cli",
  opencode: "https://opencode.ai/",
  kimi: "https://www.kimi.com/code/",
  grok: "https://docs.x.ai/build/overview",
  copilot: "https://github.com/features/copilot/cli",
  qwen: "https://qwenlm.github.io/qwen-code-docs/",
  junie: "https://junie.jetbrains.com/",
  kiro: "https://kiro.dev/",
};

var NEW_MSG_BTN_DEFAULT = "\u2193 Latest";
var NEW_MSG_BTN_ACTIVITY = "\u2193 New activity";
var turnCounter = 0;
var prependAnchor = null;
var activityEl = null;
var isUserScrolledUp = false;
var stickyBottom = false;
var stickyBottomQuietTimer = null;
var stickyBottomCeilingTimer = null;
var stickyBottomQuietMs = 750;
var stickyBottomCeilingMs = 8000;
var stickyBottomResizeObs = null;
var stickyBottomInputBound = false;

export function getStickyBottom() { return stickyBottom; }

function pinToBottomNow() {
  var messagesEl = getMessagesEl();
  if (!messagesEl) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function ensureStickyInfrastructure() {
  var messagesEl = getMessagesEl();
  if (!messagesEl) return;
  if (!stickyBottomResizeObs && typeof ResizeObserver !== "undefined") {
    stickyBottomResizeObs = new ResizeObserver(function () {
      if (!stickyBottom) return;
      pinToBottomNow();
      if (stickyBottomQuietTimer) clearTimeout(stickyBottomQuietTimer);
      stickyBottomQuietTimer = setTimeout(disarmStickyBottom, stickyBottomQuietMs);
    });
    stickyBottomResizeObs.observe(messagesEl);
    var kids = messagesEl.children;
    for (var i = 0; i < kids.length; i++) stickyBottomResizeObs.observe(kids[i]);
  }
  if (!stickyBottomInputBound) {
    stickyBottomInputBound = true;
    var disarmOnUserScroll = function () { disarmStickyBottom(); };
    messagesEl.addEventListener("wheel", disarmOnUserScroll, { passive: true });
    messagesEl.addEventListener("touchmove", disarmOnUserScroll, { passive: true });
    document.addEventListener("keydown", function (event) {
      if (!stickyBottom) return;
      if (event.key === "PageUp" || event.key === "Home" || event.key === "ArrowUp") disarmStickyBottom();
    });
  }
}

export function armStickyBottom(durationMs) {
  if (prependAnchor) return;
  ensureStickyInfrastructure();
  stickyBottom = true;
  isUserScrolledUp = false;
  var newMsgBtn = document.getElementById("new-msg-btn");
  if (newMsgBtn) {
    newMsgBtn.classList.add("hidden");
    newMsgBtn.textContent = NEW_MSG_BTN_DEFAULT;
  }
  pinToBottomNow();
  if (stickyBottomResizeObs) {
    var messagesEl = getMessagesEl();
    if (messagesEl) {
      var kids = messagesEl.children;
      for (var i = 0; i < kids.length; i++) {
        try { stickyBottomResizeObs.observe(kids[i]); } catch (e) {}
      }
    }
  }
  stickyBottomQuietMs = durationMs || 750;
  if (stickyBottomQuietTimer) clearTimeout(stickyBottomQuietTimer);
  stickyBottomQuietTimer = setTimeout(disarmStickyBottom, stickyBottomQuietMs);
  if (stickyBottomCeilingTimer) clearTimeout(stickyBottomCeilingTimer);
  stickyBottomCeilingTimer = setTimeout(disarmStickyBottom, stickyBottomCeilingMs);
}

export function disarmStickyBottom() {
  stickyBottom = false;
  if (stickyBottomQuietTimer) { clearTimeout(stickyBottomQuietTimer); stickyBottomQuietTimer = null; }
  if (stickyBottomCeilingTimer) { clearTimeout(stickyBottomCeilingTimer); stickyBottomCeilingTimer = null; }
}

export function initRendering() {
  store.subscribe(function (state, prev) {
    if (state.currentVendor !== prev.currentVendor) {
      var inputEl = document.getElementById("input");
      if (inputEl) inputEl.placeholder = "Message " + (VENDOR_NAMES[state.currentVendor] || VENDOR_NAMES.claude) + "...";
    }
  });
}

export function getTurnCounter() { return turnCounter; }
export function setTurnCounter(value) { turnCounter = value; }
export function getPrependAnchor() { return prependAnchor; }
export function setPrependAnchor(value) { prependAnchor = value; }
export function getActivityEl() { return activityEl; }
export function setActivityEl(value) { activityEl = value; }
export function getIsUserScrolledUp() { return isUserScrolledUp; }
export function setIsUserScrolledUp(value) { isUserScrolledUp = value; }

export function addToMessages(element) {
  var messagesEl = getMessagesEl();
  if (prependAnchor) messagesEl.insertBefore(element, prependAnchor);
  else messagesEl.appendChild(element);
  keepActiveThinkingAtTail();
}

// Thinking is a single accumulating record for the active turn. Other live
// transcript entries may arrive between reasoning segments, so keep only the
// currently active record after the tail activity indicator.
export function keepActiveThinkingAtTail() {
  if (prependAnchor || store.get('replayingHistory')) return;
  var thinkingState = store.get('thinkingState');
  var thinkingEl = thinkingState && thinkingState.active && thinkingState.el;
  var messagesEl = getMessagesEl();
  if (!thinkingEl || !messagesEl || thinkingEl.parentNode !== messagesEl) return;
  if (activityEl && activityEl.parentNode === messagesEl) {
    if (activityEl.nextSibling !== thinkingEl || messagesEl.lastElementChild !== thinkingEl) {
      messagesEl.appendChild(activityEl);
      messagesEl.appendChild(thinkingEl);
    }
  } else if (messagesEl.lastElementChild !== thinkingEl) {
    messagesEl.appendChild(thinkingEl);
  }
}

export function scrollToBottom() {
  if (prependAnchor) return;
  var messagesEl = getMessagesEl();
  if (!messagesEl) return;
  var distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  if (distFromBottom > 150 || isUserScrolledUp) {
    if (distFromBottom > 150) isUserScrolledUp = true;
    var newMsgBtn = document.getElementById("new-msg-btn");
    if (newMsgBtn) {
      newMsgBtn.textContent = NEW_MSG_BTN_ACTIVITY;
      newMsgBtn.classList.remove("hidden");
    }
    return;
  }
  requestAnimationFrame(function () {
    var dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    if (dist > 150) {
      isUserScrolledUp = true;
      return;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

export function forceScrollToBottom() {
  if (prependAnchor) return;
  armStickyBottom(750);
}

export function getMsgTime() {
  var timestamp = store.get('currentMsgTs');
  var date = timestamp ? new Date(timestamp) : new Date();
  var time = String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  var now = new Date();
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return time;
  return (date.getMonth() + 1) + "/" + date.getDate() + " " + time;
}

export function shouldGroupMessage(senderClass) {
  var state = store.snap();
  if (state.replayingHistory && !state.currentMsgTs) return false;
  var prev = getMessagesEl().lastElementChild;
  if (!prev || !prev.classList.contains(senderClass)) return false;
  var prevTime = prev.querySelector(".dm-bubble-time");
  if (!prevTime) return false;
  return prevTime.textContent === getMsgTime();
}
