// chat-bubble-renderer.js - Stateless project-style chat bubble rendering.

import { copyToClipboard } from './utils.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, enhanceClaySessionLinks } from './markdown.js';

var copyCleanups = new WeakMap();

function appendIdentity(row, options, avatarClass) {
  if (options.avatarUrl) {
    var avatar = document.createElement("img");
    avatar.className = "dm-bubble-avatar " + avatarClass;
    avatar.src = options.avatarUrl;
    avatar.alt = "";
    row.appendChild(avatar);
  }

  var content = document.createElement("div");
  content.className = "dm-bubble-content";
  if (options.name || options.time) {
    var header = document.createElement("div");
    header.className = "dm-bubble-header";
    if (options.name) {
      var name = document.createElement("span");
      name.className = "dm-bubble-name";
      name.textContent = options.name;
      header.appendChild(name);
    }
    if (options.time) {
      var time = document.createElement("span");
      time.className = "dm-bubble-time";
      time.textContent = options.time;
      header.appendChild(time);
    }
    content.appendChild(header);
  }
  row.appendChild(content);
  return content;
}

export function createAssistantBubble(options) {
  options = options || {};
  var row = document.createElement(options.tagName || "div");
  row.className = "msg-assistant";
  if (options.turn !== undefined && options.turn !== null) row.dataset.turn = options.turn;
  var contentWrap = appendIdentity(row, options, "dm-bubble-avatar-mate");
  var content = document.createElement("div");
  content.className = "md-content";
  content.dir = "auto";
  contentWrap.appendChild(content);
  return row;
}

export function createUserBubble(options) {
  options = options || {};
  var row = document.createElement(options.tagName || "div");
  row.className = "msg-user";
  if (options.turn !== undefined && options.turn !== null) row.dataset.turn = options.turn;
  var contentWrap = appendIdentity(row, options, "dm-bubble-avatar-me");
  var bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.dir = "auto";
  var text = document.createElement("span");
  text.textContent = options.text || "";
  bubble.appendChild(text);
  contentWrap.appendChild(bubble);
  return row;
}

function assistantContent(row) {
  return row ? row.querySelector(".md-content") : null;
}

export function renderAssistantBubbleText(row, text, highlight, options) {
  var content = assistantContent(row);
  if (!content) return null;
  var html = renderMarkdown(text || "");
  if (options && options.readOnly) html = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 's', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'wbr'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'start', 'class'], ALLOW_DATA_ATTR: false
  });
  content.innerHTML = html;
  if (options && options.readOnly) content.querySelectorAll('[class]').forEach(function (element) { if (element.tagName !== 'CODE' && element.tagName !== 'PRE') element.removeAttribute('class'); });
  if (!options || !options.readOnly) enhanceClaySessionLinks(content);
  if (highlight) highlightCodeBlocks(content);
  return content;
}

export function enhanceAssistantBubble(row, renderMermaid) {
  var content = assistantContent(row);
  if (!content) return;
  enhanceClaySessionLinks(content);
  highlightCodeBlocks(content);
  if (renderMermaid) renderMermaidBlocks(content);
}

export function addAssistantCopyHandler(row, rawText) {
  if (!row || !rawText || row.dataset.copyBound === "true") return;
  row.dataset.copyBound = "true";
  var primed = false;
  var resetTimer = null;
  var isTouchDevice = "ontouchstart" in window;
  var hint = document.createElement("div");
  hint.className = "msg-copy-hint";
  hint.textContent = (isTouchDevice ? "Tap" : "Click") + " to grab this";
  row.appendChild(hint);

  function reset() {
    primed = false;
    row.classList.remove("copy-primed", "copy-done");
    hint.textContent = (isTouchDevice ? "Tap" : "Click") + " to grab this";
  }

  row.addEventListener("click", function (event) {
    if (event.target.closest("a, button, pre, code")) return;
    var selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    if (!primed) {
      primed = true;
      row.classList.add("copy-primed");
      hint.textContent = isTouchDevice ? "Tap again to grab" : "Click again to grab";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(reset, 3000);
      return;
    }
    clearTimeout(resetTimer);
    copyToClipboard(rawText).then(function () {
      row.classList.remove("copy-primed");
      row.classList.add("copy-done");
      hint.textContent = "Grabbed!";
      resetTimer = setTimeout(reset, 1500);
    });
  });

  function handleOutsideClick(event) {
    if (primed && !row.contains(event.target)) reset();
  }
  document.addEventListener("click", handleOutsideClick);
  copyCleanups.set(row, function () {
    clearTimeout(resetTimer);
    document.removeEventListener("click", handleOutsideClick);
    copyCleanups.delete(row);
  });
}

export function finalizeAssistantBubble(row, rawText, enableCopy) {
  renderAssistantBubbleText(row, rawText, false);
  enhanceAssistantBubble(row, true);
  if (enableCopy) addAssistantCopyHandler(row, rawText);
}

export function disposeChatBubbleTree(root) {
  if (!root) return;
  var rows = root.querySelectorAll('.msg-assistant[data-copy-bound="true"]');
  for (var i = 0; i < rows.length; i++) {
    var cleanup = copyCleanups.get(rows[i]);
    if (cleanup) cleanup();
  }
}
