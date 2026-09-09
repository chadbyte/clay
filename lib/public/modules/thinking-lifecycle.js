import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { addToMessages, scrollToBottom } from './chat-render-runtime.js';
import { prepareThinkingView, bindThinkingView, updateThinkingView, beginThinkingView, setThinkingViewLive, finishThinkingView } from './thinking-view.js';

function getThinkingState() {
  return store.get('thinkingState') || null;
}

function setThinkingState(state) {
  store.set({ thinkingState: state });
}

function updateThinkingState(state, patch) {
  var next = Object.assign({}, state, patch);
  setThinkingState(next);
  return next;
}

function isMateThinking() {
  var target = store.get('dmTargetUser');
  return !!(store.get('dmMode') && target && target.isMate);
}

function maybeScrollToBottom() {
  if (!store.get('replayingHistory')) scrollToBottom();
}

function createThinkingElement() {
  var el = document.createElement("div");
  el.className = "thinking-item";
  if (isMateThinking()) {
    var target = store.get('dmTargetUser');
    var mateName = (target && target.displayName) || "Mate";
    var mateAvatar = document.body.dataset.mateAvatarUrl || "";
    el.classList.add("mate-thinking");
    el.innerHTML =
      '<img class="dm-bubble-avatar dm-bubble-avatar-mate" src="' + escapeHtml(mateAvatar) + '" alt="">' +
      '<div class="dm-bubble-content">' +
      '<div class="dm-bubble-header"><span class="dm-bubble-name">' + escapeHtml(mateName) + '</span></div>' +
      '<div class="mate-thinking-dots mate-thinking-activity"><span></span><span></span><span></span></div>' +
      '<div class="thinking-header" style="display:none">' +
      '<span class="thinking-chevron">' + iconHtml("chevron-right") + '</span>' +
      '<span class="thinking-label">Thinking</span>' +
      '<span class="thinking-duration"></span>' +
      '<span class="thinking-spinner">' + iconHtml("loader", "icon-spin") + '</span>' +
      '</div>' +
      '<div class="thinking-content"></div>' +
      '</div>';
  } else {
    el.innerHTML =
      '<div class="thinking-header">' +
      '<span class="thinking-chevron">' + iconHtml("chevron-right") + '</span>' +
      '<span class="thinking-label">Thinking</span>' +
      '<span class="thinking-duration"></span>' +
      '<span class="thinking-spinner">' + iconHtml("loader", "icon-spin") + '</span>' +
      '</div>' +
      '<div class="thinking-content"></div>';
  }
  prepareThinkingView(el);
  bindThinkingView(el);
  addToMessages(el);
  return el;
}

function showMateActivity(el, active, hasContent) {
  if (!el.classList.contains("mate-thinking")) return;
  var activity = el.querySelector(".mate-thinking-activity");
  var header = el.querySelector(".thinking-header");
  if (activity) activity.style.display = active ? "" : "none";
  if (header) header.style.display = active || !hasContent ? "none" : "";
}

export function startThinkingSegment() {
  var thinkingState = getThinkingState();
  if (thinkingState && thinkingState.active) return thinkingState.el;
  if (!thinkingState || thinkingState.ended) {
    thinkingState = {
      el: createThinkingElement(),
      detailsText: "",
      segmentText: "",
      latestText: "",
      active: false,
      ended: false,
      startTime: 0,
      totalDuration: 0,
    };
  }
  thinkingState = updateThinkingState(thinkingState, {
    active: true,
    segmentText: "",
    startTime: Date.now(),
  });
  beginThinkingView(thinkingState.el, !store.get('replayingHistory') && !isMateThinking());
  showMateActivity(thinkingState.el, true, !!thinkingState.detailsText.trim());
  refreshIcons();
  maybeScrollToBottom();
  return thinkingState.el;
}

export function appendThinkingText(text) {
  var thinkingState = getThinkingState();
  if (!thinkingState || !thinkingState.active || typeof text !== "string" || !text) return;
  var separator = !thinkingState.segmentText && thinkingState.detailsText ? "\n\n" : "";
  var segmentText = thinkingState.segmentText + text;
  thinkingState = updateThinkingState(thinkingState, {
    segmentText: segmentText,
    detailsText: thinkingState.detailsText + separator + text,
    latestText: segmentText.trim() ? segmentText : thinkingState.latestText,
  });
  updateThinkingView(thinkingState.el, thinkingState.segmentText || thinkingState.latestText, thinkingState.detailsText);
  maybeScrollToBottom();
}

export function stopThinkingSegment(duration) {
  var thinkingState = getThinkingState();
  if (!thinkingState || !thinkingState.active) return;
  var seconds = typeof duration === "number" ? duration : (Date.now() - thinkingState.startTime) / 1000;
  thinkingState = updateThinkingState(thinkingState, {
    totalDuration: thinkingState.totalDuration + seconds,
    active: false,
  });
  finishThinkingView(thinkingState.el, thinkingState.latestText, thinkingState.detailsText);
  thinkingState.el.querySelector(".thinking-duration").textContent = " " + thinkingState.totalDuration.toFixed(1) + "s";
  showMateActivity(thinkingState.el, false, !!thinkingState.detailsText.trim());
}

export function finishThinkingTurn() {
  var thinkingState = getThinkingState();
  if (!thinkingState) return;
  stopThinkingSegment();
  thinkingState = getThinkingState();
  thinkingState = updateThinkingState(thinkingState, { ended: true });
  finishThinkingView(thinkingState.el, thinkingState.latestText, thinkingState.detailsText);
  showMateActivity(thinkingState.el, false, !!thinkingState.detailsText.trim());
}

export function resetThinkingTurn() {
  finishThinkingTurn();
  setThinkingState(null);
}

export function clearThinkingState() {
  setThinkingState(null);
}

export function saveThinkingState() {
  return getThinkingState();
}

export function restoreThinkingState(saved) {
  setThinkingState(saved || null);
}

export function resumeThinkingAfterReplay(processing) {
  var thinkingState = getThinkingState();
  if (!thinkingState || !thinkingState.active || !processing) return;
  setThinkingViewLive(thinkingState.el, !isMateThinking());
  showMateActivity(thinkingState.el, true, !!thinkingState.detailsText.trim());
}

export function updateThinkingTokenEstimate(estimatedTokens) {
  var thinkingState = getThinkingState();
  if (!thinkingState || !thinkingState.active || !thinkingState.el) return;
  var label = thinkingState.el.querySelector(".thinking-label");
  if (!label) return;
  var count = estimatedTokens || 0;
  var display = count >= 1000 ? ("~" + (Math.round(count / 100) / 10) + "k") : ("~" + count);
  if (thinkingState.latestText.trim()) {
    label.title = label.textContent + " · " + display + " tokens";
  } else {
    label.textContent = "Thinking " + display + " tokens";
  }
}
