import { getFileIconSvg } from './fileicons.js';

var tabs = new Map();
var focusedPath = null;
var previewPath = null;
var onFocus = null;
var onEmpty = null;

function label(path) {
  var parts = String(path || "").split("/");
  return parts[parts.length - 1] || path;
}

function render() {
  var root = document.getElementById("file-viewer-tabs");
  if (!root) return;
  root.innerHTML = "";
  tabs.forEach(function(value, path) {
    var tab = document.createElement("button");
    tab.type = "button";
    tab.className = "file-viewer-tab" + (path === focusedPath ? " active" : "") + (path === previewPath ? " preview" : "");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", path === focusedPath ? "true" : "false");
    tab.title = path;
    tab.addEventListener("click", function() { focusFileViewerTab(path); });
    var icon = document.createElement("span");
    icon.className = "file-viewer-tab-icon";
    icon.innerHTML = getFileIconSvg(label(path));
    var name = document.createElement("span");
    name.className = "file-viewer-tab-label";
    name.textContent = label(path);
    var close = document.createElement("span");
    close.className = "file-viewer-tab-close";
    close.textContent = "×";
    close.addEventListener("click", function(event) { event.stopPropagation(); closeFileViewerTab(path); });
    tab.appendChild(icon);
    tab.appendChild(name);
    tab.appendChild(close);
    root.appendChild(tab);
  });
}

export function initFileViewerTabs(options) {
  onFocus = options && options.onFocus;
  onEmpty = options && options.onEmpty;
}

export function openFileViewerTab(path, data) {
  if (!path) return false;
  var exists = tabs.has(path);
  tabs.set(path, Object.assign(tabs.get(path) || {}, data || {}));
  if (path === previewPath) previewPath = null;
  focusedPath = path;
  render();
  return !exists;
}

export function previewFileViewerTab(path, data) {
  if (!path) return false;
  if (tabs.has(path) && path !== previewPath) {
    focusedPath = path;
    render();
    return false;
  }
  if (previewPath && previewPath !== path) tabs.delete(previewPath);
  var exists = tabs.has(path);
  tabs.set(path, Object.assign(tabs.get(path) || {}, data || {}));
  previewPath = path;
  focusedPath = path;
  render();
  return !exists;
}

export function updateFileViewerTab(path, data) {
  if (!path) return false;
  if (!tabs.has(path)) return false;
  tabs.set(path, Object.assign(tabs.get(path) || {}, data || {}));
  if (focusedPath !== path) return false;
  render();
  return true;
}

export function focusFileViewerTab(path) {
  if (!tabs.has(path)) return false;
  focusedPath = path;
  render();
  if (onFocus) onFocus(path, tabs.get(path));
  return true;
}

export function closeFileViewerTab(path) {
  if (!tabs.has(path)) return;
  var paths = Array.from(tabs.keys());
  var index = paths.indexOf(path);
  tabs.delete(path);
  if (previewPath === path) previewPath = null;
  if (focusedPath === path) focusedPath = paths[index + 1] || paths[index - 1] || null;
  render();
  if (focusedPath && onFocus) onFocus(focusedPath, tabs.get(focusedPath));
  if (!focusedPath && onEmpty) onEmpty();
}

export function focusedFileViewerTab() { return focusedPath; }
export function focusedFileViewerTabData() { return focusedPath && tabs.has(focusedPath) ? tabs.get(focusedPath) : null; }
export function clearFileViewerTabs() { tabs.clear(); focusedPath = null; previewPath = null; render(); }
