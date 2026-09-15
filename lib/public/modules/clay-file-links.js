// Shared local-file link rendering and activation for every Markdown surface.

import { escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { store } from './store.js';

var openFileHandler = null;
var delegatedBinding = false;

function decode(value) {
  try { return decodeURIComponent(value); } catch (e) { return value; }
}

function splitLocation(value) {
  var raw = String(value || "");
  var fragment = "";
  var hash = raw.indexOf("#");
  if (hash !== -1) {
    fragment = decode(raw.slice(hash + 1));
    raw = raw.slice(0, hash);
  }
  var decoded = decode(raw);
  var line = null;
  var column = null;
  var lineMatch = /^L(\d+)(?:-L?(\d+))?(?:C(\d+))?$/i.exec(fragment);
  if (lineMatch) {
    line = Number(lineMatch[1]);
    column = lineMatch[3] ? Number(lineMatch[3]) : null;
  }
  var suffixMatch = /^(.*?):(\d+)(?::(\d+))?$/.exec(decoded);
  if (suffixMatch && !/^[A-Za-z]:$/.test(suffixMatch[1])) {
    decoded = suffixMatch[1];
    line = Number(suffixMatch[2]);
    column = suffixMatch[3] ? Number(suffixMatch[3]) : column;
  }
  return { path: decoded, line: line, column: column };
}

export function localFileTarget(href) {
  if (typeof href !== "string" || !href || href.charAt(0) === "#") return null;
  var raw = href;
  var pathValue = raw;
  if (/^(?:https?|mailto|tel|data|javascript|log|session|issue):/i.test(raw)) return null;
  if (/^file:\/\//i.test(raw)) {
    try {
      var url = new URL(raw);
      if (url.hostname && url.hostname !== "localhost") return null;
      pathValue = url.pathname + (url.hash || "");
      if (/^\/[A-Za-z]:/.test(pathValue)) pathValue = pathValue.slice(1);
    } catch (e) { return null; }
  }
  var target = splitLocation(pathValue);
  if (!target.path) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target.path) || target.path.indexOf("//") === 0) return null;
  target.href = href;
  return target;
}

export function renderLocalFileLink(href, title, text) {
  var target = localFileTarget(href);
  if (!target) return null;
  var label = text || target.path;
  var tooltip = target.path + (target.line ? ":" + target.line + (target.column ? ":" + target.column : "") : "");
  var state = store.snap();
  var projectAttr = state.currentSlug ? ' data-file-project-slug="' + escapeHtml(String(state.currentSlug)) + '"' : '';
  var sessionAttr = state.activeSessionId != null ? ' data-file-session-id="' + escapeHtml(String(state.activeSessionId)) + '"' : '';
  return '<button type="button" class="clay-file-link" data-file-path="' + escapeHtml(target.path) + '"' +
    projectAttr + sessionAttr +
    (target.line ? ' data-file-line="' + target.line + '"' : '') +
    (target.column ? ' data-file-column="' + target.column + '"' : '') +
    ' title="' + escapeHtml(tooltip) + '" aria-label="Open file ' + escapeHtml(tooltip) + '">' +
    '<span class="clay-file-link-icon" data-lucide="file-code-2" aria-hidden="true"></span>' +
    '<span class="clay-file-link-label">' + label + '</span></button>';
}

export function registerClayFileLinkOpener(handler) {
  openFileHandler = handler;
  bindDelegatedHandler();
}

function showUnavailable(button) {
  var notice = document.createElement("div");
  notice.className = "clay-file-link-notice";
  notice.setAttribute("role", "status");
  notice.textContent = "File browser is unavailable for " + (button.dataset.filePath || "this file") + ".";
  button.parentElement.appendChild(notice);
  setTimeout(function () { if (notice.parentNode) notice.parentNode.removeChild(notice); }, 5000);
}

export function enhanceClayFileLinks(root) {
  if (!root || typeof document === "undefined") return;
  bindDelegatedHandler();
  refreshIcons();
}

function bindDelegatedHandler() {
  if (delegatedBinding || typeof document === "undefined") return;
  delegatedBinding = true;
  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest(".clay-file-link") : null;
    if (!button) return;
    if (!openFileHandler) { showUnavailable(button); return; }
    var result = openFileHandler(button.dataset.filePath, {
      line: button.dataset.fileLine ? Number(button.dataset.fileLine) : null,
      column: button.dataset.fileColumn ? Number(button.dataset.fileColumn) : null,
      projectSlug: button.dataset.fileProjectSlug || null,
      sessionId: button.dataset.fileSessionId || null
    });
    if (result === false) showUnavailable(button);
  });
}
