// app-rendering.js - Message rendering, streaming, scroll management, system messages
// Extracted from app.js (PR-28)

import { store } from './store.js';
import { escapeHtml } from './utils.js';
import { createAssistantBubble, renderAssistantBubbleText, enhanceAssistantBubble, addAssistantCopyHandler, finalizeAssistantBubble } from './chat-bubble-renderer.js';
import { refreshIcons } from './icons.js';
import { closeToolGroup } from './tools.js';
import { sendMessage, hasSendableContent } from './input.js';
import { getChatLayout } from './theme.js';
import { addToMessages, scrollToBottom, forceScrollToBottom, getMsgTime, shouldGroupMessage, getTurnCounter, getActivityEl, VENDOR_AVATARS, VENDOR_NAMES } from './chat-render-runtime.js';
export { VENDOR_ORDER, EXPERIMENTAL_VENDORS, isExperimentalVendor } from './vendor-priority.js';
export { initRendering, addToMessages, scrollToBottom, forceScrollToBottom, getMsgTime, shouldGroupMessage, getTurnCounter, setTurnCounter, getPrependAnchor, setPrependAnchor, getActivityEl, setActivityEl, getIsUserScrolledUp, setIsUserScrolledUp, getStickyBottom, armStickyBottom, disarmStickyBottom, VENDOR_AVATARS, VENDOR_NAMES, VENDOR_HOMEPAGES } from './chat-render-runtime.js';
export { addUserMessage, addSystemMessage, addConflictMessage, addContextOverflowMessage } from './app-message-cards.js';

// --- Module-owned state (not in store) ---
var matePreThinkingTimer = null;
var highlightTimer = null;
var streamBuffer = "";
var streamDrainTimer = null;

export function ensureAssistantBlock() {
  var _el = store.get('currentMsgEl');
  if (!_el) {
    var _isDm2 = document.body.classList.contains("mate-dm-active") && document.body.dataset.mateAvatarUrl;
    var vendor = store.get('currentVendor') || "claude";
    var dmTarget = store.get('dmTargetUser');
    _el = createAssistantBubble({
      turn: getTurnCounter(),
      avatarUrl: _isDm2 ? document.body.dataset.mateAvatarUrl : (VENDOR_AVATARS[vendor] || VENDOR_AVATARS.claude),
      name: _isDm2 ? ((dmTarget && dmTarget.displayName) || "Mate") : (VENDOR_NAMES[vendor] || VENDOR_NAMES.claude),
      time: getMsgTime(),
    });
    if (shouldGroupMessage("msg-assistant")) _el.classList.add("grouped");
    addToMessages(_el);
    store.set({ currentMsgEl: _el, currentFullText: "" });
  }
  return _el;
}

export function addCopyHandler(msgEl, rawText) {
  addAssistantCopyHandler(msgEl, rawText);
}

export function appendDelta(text) {
  ensureAssistantBlock();
  streamBuffer += text;
  if (store.get('replayingHistory')) {
    store.set({ currentFullText: store.get('currentFullText') + streamBuffer });
    streamBuffer = "";
    return;
  }
  if (!streamDrainTimer) {
    streamDrainTimer = requestAnimationFrame(drainStreamTick);
  }
}

function drainStreamTick() {
  streamDrainTimer = null;
  var _s = store.snap();
  if (!_s.currentMsgEl || streamBuffer.length === 0) return;

  // Render everything received by this frame; never replay a typing backlog.
  var chunk = streamBuffer;
  streamBuffer = "";
  var newText = _s.currentFullText + chunk;
  store.set({ currentFullText: newText });

  renderAssistantBubbleText(_s.currentMsgEl, newText, false);

  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(function () {
    enhanceAssistantBubble(_s.currentMsgEl, false);
  }, 150);

  scrollToBottom();

  if (streamBuffer.length > 0) {
    streamDrainTimer = requestAnimationFrame(drainStreamTick);
  }
}

export function resetStreamBuffer() {
  if (streamDrainTimer) cancelAnimationFrame(streamDrainTimer);
  if (highlightTimer) clearTimeout(highlightTimer);
  streamDrainTimer = null;
  highlightTimer = null;
  streamBuffer = "";
}

export function flushStreamBuffer() {
  if (streamDrainTimer) { cancelAnimationFrame(streamDrainTimer); streamDrainTimer = null; }
  if (streamBuffer.length > 0) {
    store.set({ currentFullText: store.get('currentFullText') + streamBuffer });
    streamBuffer = "";
  }
  var _s = store.snap();
  if (_s.currentMsgEl) {
    var contentEl = _s.currentMsgEl.querySelector(".md-content");
    if (contentEl) {
      renderAssistantBubbleText(_s.currentMsgEl, _s.currentFullText, true);
    }
  }
}

export function finalizeAssistantBlock() {
  flushStreamBuffer();
  var _s = store.snap();
  if (_s.currentMsgEl) {
    finalizeAssistantBubble(_s.currentMsgEl, _s.currentFullText, !!_s.currentFullText);
    closeToolGroup();
  }
  store.set({ currentMsgEl: null, currentFullText: "" });
}

// --- Pre-thinking (instant dots before server responds) ---

export function showClaudePreThinking() {
  if (getChatLayout() !== "channel") return;
  removeMatePreThinking();
  var vendor = store.get('currentVendor') || "claude";
  var vendorAvatar = VENDOR_AVATARS[vendor] || VENDOR_AVATARS.claude;
  var vendorName = VENDOR_NAMES[vendor] || VENDOR_NAMES.claude;
  doShowMatePreThinking(vendorName, vendorAvatar);
}

export function showMatePreThinking() {
  removeMatePreThinking();
  var dmTarget = store.get('dmTargetUser');
  var mateName = dmTarget ? (dmTarget.displayName || "Mate") : "Mate";
  var mateAvatar = document.body.dataset.mateAvatarUrl || "";
  doShowMatePreThinking(mateName, mateAvatar);
}

function doShowMatePreThinking(mateName, mateAvatar) {
  var _el = document.createElement("div");
  _el.className = "thinking-item mate-thinking mate-pre-thinking";
  _el.innerHTML =
    '<img class="dm-bubble-avatar dm-bubble-avatar-mate" src="' + escapeHtml(mateAvatar) + '" alt="" style="display:block">' +
    '<div class="dm-bubble-content">' +
    '<div class="dm-bubble-header"><span class="dm-bubble-name">' + escapeHtml(mateName) + '</span></div>' +
    '<div class="mate-thinking-dots"><span></span><span></span><span></span></div>' +
    '</div>';
  store.set({ matePreThinkingEl: _el });
  var activity = getActivityEl();
  if (activity && activity.parentNode) {
    activity.parentNode.insertBefore(_el, activity);
  } else {
    addToMessages(_el);
  }
  refreshIcons();
  scrollToBottom();
  // Safety net: if no server event ever clears these dots (lost in transit,
  // missed handler, etc.) the user sees them forever and assumes the
  // session is hung. After 90s with zero progress, clear the indicator
  // and log a system note so the user knows to retry.
  if (matePreThinkingTimer) clearTimeout(matePreThinkingTimer);
  matePreThinkingTimer = setTimeout(function () {
    var stillThere = store.get('matePreThinkingEl');
    if (!stillThere) return;
    stillThere.remove();
    store.set({ matePreThinkingEl: null });
    matePreThinkingTimer = null;
    var note = document.createElement("div");
    note.className = "system-msg";
    note.textContent = "No response received in 90s. The server may have stalled. Send another message to retry.";
    addToMessages(note);
    scrollToBottom();
  }, 90000);
}

export function removeMatePreThinking() {
  if (matePreThinkingTimer) {
    clearTimeout(matePreThinkingTimer);
    matePreThinkingTimer = null;
  }
  var _el = store.get('matePreThinkingEl');
  if (_el) {
    _el.remove();
    store.set({ matePreThinkingEl: null });
  }
}

// --- Ghost suggestion (prompt recommendation as ghost text) ---

var _ghostSuggestionText = "";

export function getGhostSuggestion() {
  return _ghostSuggestionText;
}

export function showSuggestionChips(suggestion) {
  if (!suggestion || store.get('processing')) return;
  // Only show ghost text when there is no sendable content — typed text,
  // pending pastes, pending images, or pending files all suppress the
  // suggestion so Enter can't accidentally send it instead of the user's
  // actual attached content.
  if (hasSendableContent()) return;
  _ghostSuggestionText = suggestion;
  var ghostEl = document.getElementById("ghost-suggestion");
  if (!ghostEl) return;
  ghostEl.innerHTML = escapeHtml(suggestion) +
    ' <span class="ghost-hint"><kbd>Enter</kbd> to send</span>';
  ghostEl.classList.remove("hidden");
}

export function hideSuggestionChips() {
  _ghostSuggestionText = "";
  var ghostEl = document.getElementById("ghost-suggestion");
  if (ghostEl) {
    ghostEl.innerHTML = "";
    ghostEl.classList.add("hidden");
  }
}
