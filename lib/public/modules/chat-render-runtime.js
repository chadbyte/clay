// chat-render-runtime.js - Shared project transcript state and scrolling.

import { store } from './store.js';
import { getMessagesEl } from './dom-refs.js';
import { getProjectAssistantPlaceholder } from './project-chat-identity.js';

export var VENDOR_AVATARS = {
  claude: "/claude-code-avatar.png",
  codex: "/codex-avatar.png",
  muse: "/muse-avatar.svg",
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
  muse: "Muse Code",
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
  muse: "https://dev.meta.ai/docs/muse-code",
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

function layoutScrollLock() { return store.get('paneLayoutScrollLock'); }

export function beginPaneLayoutScrollLock(token, scrollTop) {
  var messagesEl = getMessagesEl();
  if (!messagesEl || !token) return false;
  disarmStickyBottom();
  var userPosition = store.get('paneLastUserScrollTop');
  var position = Number.isFinite(userPosition) ? userPosition : Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : messagesEl.scrollTop;
  store.set({ paneLayoutScrollLock: { token: token, scrollTop: position } });
  messagesEl.scrollTop = position;
  return true;
}

export function endPaneLayoutScrollLock(token) {
  var state = layoutScrollLock(), messagesEl = getMessagesEl();
  if (!state || state.token !== token || !messagesEl) return false;
  requestAnimationFrame(function () {
    var current = layoutScrollLock();
    if (!current || current.token !== token || !messagesEl.isConnected) return;
    disarmStickyBottom();
    messagesEl.scrollTop = current.scrollTop;
    store.set({ paneLayoutScrollLock: null });
  });
  return true;
}

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
  if (layoutScrollLock()) return;
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
  var messagesEl = getMessagesEl();
  if (messagesEl && !messagesEl.__paneLayoutScrollLockListener) {
    messagesEl.__paneLayoutScrollLockListener = true;
    messagesEl.addEventListener('wheel', function () {
      var revision = (store.get('paneUserScrollRevision') || 0) + 1;
      store.set({ paneUserScrollRevision: revision, paneUserScrollIntent: revision });
      requestAnimationFrame(function () {
        if (store.get('paneUserScrollIntent') === revision) store.set({ paneUserScrollIntent: null });
      });
    }, { passive: true });
    messagesEl.addEventListener('scroll', function () {
      var state = layoutScrollLock();
      if (state) store.set({ paneLayoutScrollLock: Object.assign({}, state, { scrollTop: messagesEl.scrollTop }) });
      if (store.get('paneUserScrollIntent') != null) store.set({ paneLastUserScrollTop: messagesEl.scrollTop, paneUserScrollIntent: null });
    }, { passive: true });
  }
  var lastAssistantPlaceholder = '';
  function updateInputPlaceholder(state) {
    var inputEl = document.getElementById("input");
    if (!inputEl) return;
    var nextPlaceholder = getProjectAssistantPlaceholder(state, state.currentVendor);
    var ownsPlaceholder = !lastAssistantPlaceholder || inputEl.placeholder === lastAssistantPlaceholder;
    lastAssistantPlaceholder = nextPlaceholder;
    if (inputEl.disabled || document.getElementById("input-mention-chip") || !ownsPlaceholder) return;
    inputEl.placeholder = nextPlaceholder;
  }
  updateInputPlaceholder(store.snap());
  store.subscribe(function (state, prev) {
    if (state.currentVendor !== prev.currentVendor || state.activeSessionMateId !== prev.activeSessionMateId ||
        state.activeSessionMateName !== prev.activeSessionMateName || state.activeProjectMateId !== prev.activeProjectMateId ||
        state.activeProjectMateName !== prev.activeProjectMateName || state.cachedMatesList !== prev.cachedMatesList ||
        state.dmMode !== prev.dmMode || state.dmTargetUser !== prev.dmTargetUser) updateInputPlaceholder(state);
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
  addHistoryIndex(element, store.get('currentHistoryIndexes') || store.get('currentHistoryIndex'));
  if (prependAnchor) messagesEl.insertBefore(element, prependAnchor);
  else messagesEl.appendChild(element);
  keepActiveThinkingAtTail();
}

export function addHistoryIndex(element, historyIndex) {
  if (Array.isArray(historyIndex)) {
    if (!element) return;
    var indexes = new Set((element.dataset.historyIndexes || "").split(",").filter(Boolean));
    for (var i = 0; i < historyIndex.length; i++) {
      if (Number.isSafeInteger(historyIndex[i]) && historyIndex[i] >= 0) indexes.add(String(historyIndex[i]));
    }
    element.dataset.historyIndexes = Array.from(indexes).join(",");
    return;
  }
  if (!element || !Number.isSafeInteger(historyIndex) || historyIndex < 0) return;
  var existing = element.dataset.historyIndexes || "";
  if (existing.split(",").indexOf(String(historyIndex)) !== -1) return;
  element.dataset.historyIndexes = existing ? existing + "," + historyIndex : String(historyIndex);
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
  if (layoutScrollLock()) return;
  if (prependAnchor || store.get('replayingHistory')) return;
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
    if (layoutScrollLock()) return;
    var dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    if (dist > 150) {
      isUserScrolledUp = true;
      return;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

export function forceScrollToBottom() {
  if (prependAnchor || store.get('replayingHistory')) return;
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
