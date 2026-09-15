// app-cursors.js - Remote cursor presence, text selection sharing
// Extracted from app.js (PR-27)

import { avatarUrl } from './avatar.js';
import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { getMessagesEl } from './dom-refs.js';
import { registerTooltip } from './tooltip.js';

// --- Module-owned state ---
var remoteCursors = {}; // userId -> { el, indicator, timer, lastY, active }
var cursorThrottleTimer = null;
var CURSOR_THROTTLE_MS = 30;
var CURSOR_HIDE_TIMEOUT = 5000;

var cursorColors = [
  "#F24822", "#FF7262", "#A259FF", "#1ABCFE",
  "#0ACF83", "#FF6D00", "#E84393", "#6C5CE7",
  "#00B894", "#FDCB6E", "#E17055", "#74B9FF",
];
var userColorMap = {};
var nextColorIdx = 0;

var remoteSelections = {}; // userId -> { els: [], timer }
var selectionThrottleTimer = null;
var lastSelectionKey = "";

// --- Internal helpers ---

function getCursorColor(userId) {
  if (!userColorMap[userId]) {
    userColorMap[userId] = cursorColors[nextColorIdx % cursorColors.length];
    nextColorIdx++;
  }
  return userColorMap[userId];
}

function createCursorElement(userId, displayName, color, avatarStyle, avatarSeed, avatarCustom) {
  var wrapper = document.createElement("div");
  wrapper.className = "remote-cursor";
  wrapper.dataset.userId = userId;
  wrapper.style.position = "absolute";
  wrapper.style.zIndex = "9999";
  wrapper.style.pointerEvents = "none";
  wrapper.style.display = "none";
  wrapper.style.transition = "left 30ms linear, top 30ms linear";
  wrapper.style.willChange = "left, top";

  // SVG cursor arrow
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "20");
  svg.setAttribute("viewBox", "0 0 16 20");
  svg.style.display = "block";
  svg.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.3))";
  var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M0 0 L0 16 L4.5 12 L8 19 L10.5 18 L7 11 L13 11 Z");
  path.setAttribute("fill", color);
  path.setAttribute("stroke", "#fff");
  path.setAttribute("stroke-width", "1");
  svg.appendChild(path);
  wrapper.appendChild(svg);

  // Tag: avatar + name label together
  var tag = document.createElement("div");
  tag.className = "remote-cursor-tag";
  tag.style.cssText = "position:absolute;left:14px;top:14px;display:flex;align-items:center;" +
    "gap:3px;background:" + color + ";padding:1px 6px 1px 2px;border-radius:10px;" +
    "pointer-events:none;white-space:nowrap;";

  // Avatar
  var avatarImg = document.createElement("img");
  avatarImg.className = "remote-cursor-avatar";
  avatarImg.src = avatarCustom ? avatarCustom : avatarUrl(avatarStyle || "imprint", avatarSeed || userId, 16);
  avatarImg.style.cssText = "width:14px;height:14px;border-radius:4px;background:#fff;flex-shrink:0;";
  tag.appendChild(avatarImg);

  // Name label
  var label = document.createElement("span");
  label.className = "remote-cursor-label";
  label.textContent = displayName;
  label.style.cssText = "color:#fff;font-size:11px;font-weight:500;line-height:16px;font-family:inherit;";
  tag.appendChild(label);

  wrapper.appendChild(tag);

  return wrapper;
}

// Compute cumulative character offset within a container element
function getCharOffset(container, targetNode, targetOffset) {
  var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
  var offset = 0;
  var node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) {
      return offset + targetOffset;
    }
    offset += node.textContent.length;
  }
  return offset;
}

// Find text node + local offset for a given cumulative character offset
function getNodeAtCharOffset(container, charOffset) {
  var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
  var consumed = 0;
  var node;
  var lastNode = null;
  while ((node = walker.nextNode())) {
    lastNode = node;
    var len = node.textContent.length;
    if (consumed + len >= charOffset) {
      return { node: node, offset: Math.min(charOffset - consumed, len) };
    }
    consumed += len;
  }
  if (lastNode) {
    return { node: lastNode, offset: lastNode.textContent.length };
  }
  return null;
}

// Find parent [data-turn] element from a DOM node
function findParentTurn(node) {
  var messagesEl = getMessagesEl();
  var el = node.nodeType === 3 ? node.parentElement : node;
  while (el && el !== messagesEl) {
    if (el.dataset && el.dataset.turn != null) return el;
    el = el.parentElement;
  }
  return null;
}

function clearRemoteSelection(userId) {
  var sel = remoteSelections[userId];
  if (!sel) return;
  for (var i = 0; i < sel.els.length; i++) {
    if (sel.els[i].parentNode) sel.els[i].parentNode.removeChild(sel.els[i]);
  }
  sel.els = [];
}

function createOffscreenIndicator(userId, displayName, color) {
  var btn = document.createElement("button");
  btn.className = "remote-cursor-offscreen";
  btn.dataset.userId = userId;
  btn.style.cssText =
    "position:absolute;left:50%;transform:translateX(-50%);" +
    "z-index:10000;display:none;cursor:pointer;border:none;outline:none;" +
    "background:" + color + ";color:#fff;font-size:11px;font-weight:500;" +
    "padding:3px 10px 3px 8px;border-radius:12px;white-space:nowrap;" +
    "font-family:inherit;line-height:16px;opacity:0.9;" +
    "box-shadow:0 2px 8px rgba(0,0,0,0.2);pointer-events:auto;" +
    "transition:opacity 0.15s;";
  btn.addEventListener("mouseenter", function () { btn.style.opacity = "1"; });
  btn.addEventListener("mouseleave", function () { btn.style.opacity = "0.9"; });
  return btn;
}

function updateCursorVisibility(entry) {
  var messagesEl = getMessagesEl();
  var visibleTop = messagesEl.scrollTop;
  var visibleBottom = visibleTop + messagesEl.clientHeight;
  var y = entry.lastY || 0;

  if (y < visibleTop) {
    entry.indicator.style.top = (visibleTop + 6) + "px";
    entry.indicator.style.display = "";
  } else if (y > visibleBottom) {
    entry.indicator.style.top = (visibleBottom - 28) + "px";
    entry.indicator.style.display = "";
  } else {
    entry.indicator.style.display = "none";
  }
}

// Find the closest [data-turn] element to a given clientY
function findClosestTurn(clientY) {
  var messagesEl = getMessagesEl();
  var turns = messagesEl.querySelectorAll("[data-turn]");
  if (!turns.length) return null;
  // First: exact hit
  for (var i = 0; i < turns.length; i++) {
    var r = turns[i].getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) return turns[i];
  }
  // Second: closest by distance
  var closest = null;
  var closestDist = Infinity;
  for (var j = 0; j < turns.length; j++) {
    var rect = turns[j].getBoundingClientRect();
    var mid = (rect.top + rect.bottom) / 2;
    var dist = Math.abs(clientY - mid);
    if (dist < closestDist) { closestDist = dist; closest = turns[j]; }
  }
  return closest;
}

// Cursor sharing toggle button in user island (multi-user only)
export function initCursorToggle() {
  if (!store.get('isMultiUserMode')) return;
  var actionsEl = document.querySelector(".user-island-actions");
  if (!actionsEl) return;
  if (document.getElementById("cursor-share-toggle")) return;

  var btn = document.createElement("button");
  btn.id = "cursor-share-toggle";
  btn.className = "cursor-share-btn";
  btn.innerHTML = '<i data-lucide="mouse-pointer-2"></i>';
  var settingsBtn = document.getElementById("user-settings-btn");
  if (settingsBtn) {
    actionsEl.insertBefore(btn, settingsBtn);
  } else {
    actionsEl.appendChild(btn);
  }

  function updateToggleStyle() {
    if (store.get("cursorSharingHydrated") && store.get("cursorSharingEnabled")) {
      btn.classList.remove("off");
      btn.classList.add("on");
      registerTooltip(btn, "Cursor sharing on");
    } else {
      btn.classList.remove("on");
      btn.classList.add("off");
      registerTooltip(btn, "Cursor sharing off");
    }
  }

  store.subscribe(function (state, prev) {
    if (state.cursorSharingEnabled !== prev.cursorSharingEnabled || state.cursorSharingHydrated !== prev.cursorSharingHydrated) {
      updateToggleStyle();
    }
  });

  updateToggleStyle();
  lucide.createIcons({ nodes: [btn] });

  btn.addEventListener("click", function () {
    if (!store.get("cursorSharingHydrated")) return;
    var next = !store.get("cursorSharingEnabled");
    var ws = getWs();
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "cursor_sharing_set", enabled: next, requestId: "cursor-sharing-" + Date.now() }));
  });
}

// --- Exported functions ---

export function handleRemoteSelection(msg) {
  var messagesEl = getMessagesEl();
  var userId = msg.userId;
  var color = getCursorColor(userId);

  if (!remoteSelections[userId]) {
    remoteSelections[userId] = { els: [], timer: null };
  }

  // Clear previous highlight
  clearRemoteSelection(userId);

  // If selection cleared, just remove
  if (!msg.ranges || msg.ranges.length === 0) return;

  var containerRect = messagesEl.getBoundingClientRect();

  for (var r = 0; r < msg.ranges.length; r++) {
    var sel = msg.ranges[r];
    var startTurnEl = messagesEl.querySelector('[data-turn="' + sel.startTurn + '"]');
    var endTurnEl = messagesEl.querySelector('[data-turn="' + sel.endTurn + '"]');
    if (!startTurnEl || !endTurnEl) continue;

    var startResult = getNodeAtCharOffset(startTurnEl, sel.startCh);
    var endResult = getNodeAtCharOffset(endTurnEl, sel.endCh);
    if (!startResult || !endResult) continue;

    try {
      var range = document.createRange();
      range.setStart(startResult.node, startResult.offset);
      range.setEnd(endResult.node, endResult.offset);
      var rects = range.getClientRects();

      for (var i = 0; i < rects.length; i++) {
        var rect = rects[i];
        if (rect.width === 0 && rect.height === 0) continue;
        var highlight = document.createElement("div");
        highlight.className = "remote-selection";
        highlight.dataset.userId = userId;
        highlight.style.cssText =
          "position:absolute;pointer-events:none;z-index:9998;" +
          "background:" + color + ";" +
          "opacity:0.2;" +
          "border-radius:2px;" +
          "left:" + (rect.left - containerRect.left + messagesEl.scrollLeft) + "px;" +
          "top:" + (rect.top - containerRect.top + messagesEl.scrollTop) + "px;" +
          "width:" + rect.width + "px;" +
          "height:" + rect.height + "px;";
        messagesEl.appendChild(highlight);
        remoteSelections[userId].els.push(highlight);
      }
    } catch (e) {}
  }

  // Auto-hide after timeout
  if (remoteSelections[userId].timer) clearTimeout(remoteSelections[userId].timer);
  remoteSelections[userId].timer = setTimeout(function () {
    clearRemoteSelection(userId);
  }, 10000);
}

export function handleRemoteCursorMove(msg) {
  var messagesEl = getMessagesEl();
  var userId = msg.userId;

  var entry = remoteCursors[userId];
  if (!entry) {
    var color = getCursorColor(userId);
    var el = createCursorElement(userId, msg.displayName, color, msg.avatarStyle, msg.avatarSeed, msg.avatarCustom);
    messagesEl.appendChild(el);
    var indicator = createOffscreenIndicator(userId, msg.displayName, color);
    messagesEl.appendChild(indicator);
    entry = { el: el, indicator: indicator, timer: null, lastY: 0, active: false };
    remoteCursors[userId] = entry;

    indicator.addEventListener("click", function () {
      messagesEl.scrollTo({ top: entry.lastY - messagesEl.clientHeight / 2, behavior: "smooth" });
    });
  }

  // Find the same turn element on this screen
  var anchorEl = null;
  if (msg.turn != null) {
    anchorEl = messagesEl.querySelector('[data-turn="' + msg.turn + '"]');
  }

  if (anchorEl && msg.rx != null && msg.ry != null) {
    var x = anchorEl.offsetLeft + msg.rx * anchorEl.offsetWidth;
    var y = anchorEl.offsetTop + msg.ry * anchorEl.offsetHeight;
    entry.lastY = y;
    entry.active = true;

    // Update indicator label (direction set by updateCursorVisibility)
    entry.indicator.textContent = (y < messagesEl.scrollTop ? "▲ " : "▼ ") + (msg.displayName || userId);

    entry.el.style.left = x + "px";
    entry.el.style.top = y + "px";
    entry.el.style.display = "";

    updateCursorVisibility(entry);
  }

  // Reset hide timer
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(function () {
    entry.el.style.display = "none";
    entry.indicator.style.display = "none";
    entry.active = false;
  }, CURSOR_HIDE_TIMEOUT);
}

export function handleRemoteCursorLeave(msg) {
  var entry = remoteCursors[msg.userId];
  if (entry) {
    entry.el.style.display = "none";
    entry.indicator.style.display = "none";
    entry.active = false;
    if (entry.timer) clearTimeout(entry.timer);
  }
}

export function clearRemoteCursors() {
  for (var uid in remoteCursors) {
    var entry = remoteCursors[uid];
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
    if (entry.indicator && entry.indicator.parentNode) entry.indicator.parentNode.removeChild(entry.indicator);
  }
  remoteCursors = {};
  for (var uid2 in remoteSelections) {
    clearRemoteSelection(uid2);
    if (remoteSelections[uid2].timer) clearTimeout(remoteSelections[uid2].timer);
  }
  remoteSelections = {};
}

export function initCursors() {
  var messagesEl = getMessagesEl();

  store.subscribe(function (state, prev) {
    var disconnected = state.connected === false && prev.connected !== false;
    var identityChanged = state.myUserId !== prev.myUserId;
    if (disconnected || identityChanged) {
      if (cursorThrottleTimer) { clearTimeout(cursorThrottleTimer); cursorThrottleTimer = null; }
      if (selectionThrottleTimer) { clearTimeout(selectionThrottleTimer); selectionThrottleTimer = null; }
      lastSelectionKey = "";
      store.set({ cursorSharingEnabled: false, cursorSharingHydrated: false, cursorSharingAccountId: null });
      if (identityChanged && state.myUserId && state.connected) {
        var ws = getWs();
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "cursor_sharing_get", requestId: "cursor-sharing-refresh-" + Date.now() }));
      }
    }
  });

  initCursorToggle();

  // Track local cursor and send to server
  messagesEl.addEventListener("mousemove", function (e) {
    if (!store.get("cursorSharingHydrated") || !store.get("cursorSharingEnabled")) return;
    var ws = getWs();
    if (!ws || ws.readyState !== 1) return;
    if (cursorThrottleTimer) return;
    cursorThrottleTimer = setTimeout(function () { cursorThrottleTimer = null; }, CURSOR_THROTTLE_MS);

    // Find which turn element the cursor is over
    var turnEl = findClosestTurn(e.clientY);
    if (!turnEl) return;

    // Calculate ratio within the turn element
    var turnRect = turnEl.getBoundingClientRect();
    var rx = turnRect.width > 0 ? (e.clientX - turnRect.left) / turnRect.width : 0;
    var ry = turnRect.height > 0 ? (e.clientY - turnRect.top) / turnRect.height : 0;

    ws.send(JSON.stringify({
      type: "cursor_move",
      turn: parseInt(turnEl.dataset.turn, 10),
      rx: Math.max(0, Math.min(1, rx)),
      ry: Math.max(0, Math.min(1, ry))
    }));
  });

  messagesEl.addEventListener("mouseleave", function () {
    if (!store.get("cursorSharingHydrated") || !store.get("cursorSharingEnabled")) return;
    var ws = getWs();
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "cursor_leave" }));
  });

  // Update offscreen indicators on scroll
  messagesEl.addEventListener("scroll", function () {
    for (var uid in remoteCursors) {
      var entry = remoteCursors[uid];
      if (!entry.active) continue;
      updateCursorVisibility(entry);
    }
  });

  // Track local text selection and send to server
  document.addEventListener("selectionchange", function () {
    if (!store.get("cursorSharingHydrated") || !store.get("cursorSharingEnabled")) return;
    var ws = getWs();
    if (!ws || ws.readyState !== 1) return;
    if (selectionThrottleTimer) return;
    selectionThrottleTimer = setTimeout(function () { selectionThrottleTimer = null; }, 100);

    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      // Selection cleared
      if (lastSelectionKey !== "") {
        lastSelectionKey = "";
        ws.send(JSON.stringify({ type: "text_select", ranges: [] }));
      }
      return;
    }

    var ranges = [];
    for (var i = 0; i < sel.rangeCount; i++) {
      var range = sel.getRangeAt(i);
      var startTurn = findParentTurn(range.startContainer);
      var endTurn = findParentTurn(range.endContainer);
      if (!startTurn || !endTurn) continue;
      // Both must be inside messagesEl
      if (!messagesEl.contains(startTurn)) continue;

      var startCh = getCharOffset(startTurn, range.startContainer, range.startOffset);
      var endCh = getCharOffset(endTurn, range.endContainer, range.endOffset);

      ranges.push({
        startTurn: parseInt(startTurn.dataset.turn, 10),
        startCh: startCh,
        endTurn: parseInt(endTurn.dataset.turn, 10),
        endCh: endCh
      });
    }

    var key = JSON.stringify(ranges);
    if (key === lastSelectionKey) return;
    lastSelectionKey = key;

    ws.send(JSON.stringify({ type: "text_select", ranges: ranges }));
  });
}
