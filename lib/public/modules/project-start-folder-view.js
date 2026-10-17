// project-start-folder-view.js - Open-folder step: browse_dir navigation and add_project submit

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { baseName, breadcrumbSegments, initialCandidates } from './project-start-path.js';
import {
  beginInitial, beginNavigate, applyBrowseResult, failLocally, canOpenFolder, emptyFolderState,
} from './project-start-folder-state.js';

var seq = 0;
var onSubmit = null;

function nextId() { seq += 1; return "browse-" + seq; }
function folder() { return store.get('projectStartFolder'); }
function setFolder(next) { store.set({ projectStartFolder: next }); }
function root() { return document.querySelector('#project-start-body [data-view="open"]'); }

export function resetFolderState() { setFolder(emptyFolderState()); }

function send(path, requestId) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    setFolder(failLocally(folder(), "Not connected to the server."));
    return;
  }
  ws.send(JSON.stringify({ type: "browse_dir", path: path, requestId: requestId }));
}

export function startFolderBrowse() {
  var next = beginInitial(initialCandidates(store.snap()), nextId());
  setFolder(next);
  send(next.requestedPath, next.requestId);
}

export function navigateTo(path) {
  if (!path) return;
  var next = beginNavigate(folder(), path, nextId());
  setFolder(next);
  send(path, next.requestId);
}

export function handleBrowseDirResult(msg) {
  if (store.get('projectStart').view !== 'open') return;
  var out = applyBrowseResult(folder(), msg, nextId());
  if (out.state === folder()) return;
  setFolder(out.state);
  if (out.retryPath) send(out.retryPath, out.state.requestId);
}

export function folderViewHtml() {
  return '<div class="project-start-view" data-view="open">' +
    '<div class="project-start-location">' +
      '<button type="button" class="project-start-icon-btn" data-ps="up" aria-label="Up one folder">' + iconHtml('arrow-up') + '</button>' +
      '<nav class="project-start-crumbs" aria-label="Current folder"></nav>' +
      '<button type="button" class="project-start-link-btn" data-ps="toggle-path" aria-expanded="false" aria-controls="project-start-pathform">Enter path</button>' +
    '</div>' +
    '<form class="project-start-pathform" id="project-start-pathform" hidden>' +
      '<input type="text" class="project-start-input" data-ps="path-input" aria-label="Folder path" placeholder="/path/to/folder" autocomplete="off" spellcheck="false">' +
      '<button type="submit" class="project-start-secondary">Go</button>' +
    '</form>' +
    '<div class="project-start-scroll project-start-list" data-ps="list" tabindex="-1" aria-live="polite"></div>' +
    '<div class="project-start-footer">' +
      '<p class="project-start-error" data-ps="error" role="alert" hidden></p>' +
      '<button type="button" class="project-start-primary" data-ps="open" disabled>Open</button>' +
    '</div></div>';
}

function stateBlock(kind, title, text, actions) {
  return '<div class="project-start-state project-start-state-' + kind + '">' +
    (kind === 'loading' ? '<span class="project-start-spinner" aria-hidden="true"></span>' : '') +
    '<strong>' + escapeHtml(title) + '</strong>' + (text ? '<span>' + escapeHtml(text) + '</span>' : '') +
    (actions || '') + '</div>';
}

function errorTitle(kind) {
  if (kind === 'denied') return "You can't open this folder";
  if (kind === 'missing') return "Folder not found";
  return "Couldn't load folders";
}

function listHtml(state) {
  if (state.status === 'loading') return stateBlock('loading', 'Loading folders…');
  if (state.status === 'error') {
    var actions = '<div class="project-start-state-actions">' +
      '<button type="button" class="project-start-secondary" data-ps="retry">Try again</button>' +
      (state.dir ? '<button type="button" class="project-start-secondary" data-ps="back-to-dir">Back to ' + escapeHtml(baseName(state.dir)) + '</button>' : '') + '</div>';
    return stateBlock('error', errorTitle(state.errorKind), state.error, actions);
  }
  if (state.status !== 'ready') return '';
  if (state.entries.length === 0) return stateBlock('empty', 'No folders here', 'This folder has no sub-folders. You can still open it.');
  var html = '<ul class="project-start-rows" role="list">';
  for (var i = 0; i < state.entries.length; i++) {
    html += '<li><button type="button" class="project-start-row project-start-folder-row" data-ps="enter" data-path="' + escapeHtml(state.entries[i].path) + '">' +
      iconHtml('folder') + '<span class="project-start-row-name">' + escapeHtml(state.entries[i].name) + '</span>' + iconHtml('chevron-right') + '</button></li>';
  }
  return html + '</ul>';
}

function crumbsHtml(state) {
  if (!state.dir) return '<span class="project-start-crumb-muted">' + (state.status === 'error' ? 'No folder selected' : 'Loading…') + '</span>';
  var info = breadcrumbSegments(state.dir, 3);
  var html = info.truncated ? '<span class="project-start-crumb-muted">…</span><span class="project-start-crumb-sep">/</span>' : '';
  for (var i = 0; i < info.segments.length; i++) {
    var last = i === info.segments.length - 1;
    html += '<span class="' + (last ? 'project-start-crumb-current' : 'project-start-crumb') + '"' + (last ? ' aria-current="location"' : '') + '>' + escapeHtml(info.segments[i]) + '</span>';
    if (!last) html += '<span class="project-start-crumb-sep">/</span>';
  }
  return html;
}

export function renderFolderView() {
  var view = root();
  if (!view) return;
  var state = folder();
  var crumbs = view.querySelector('.project-start-crumbs');
  crumbs.innerHTML = crumbsHtml(state);
  crumbs.title = state.dir || '';
  view.querySelector('[data-ps="up"]').disabled = !(state.status === 'ready' && state.parent);
  var list = view.querySelector('[data-ps="list"]');
  var listHadFocus = list.contains(document.activeElement);
  list.innerHTML = listHtml(state);
  if (listHadFocus) list.focus({ preventScroll: true });
  list.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
  var pathInput = view.querySelector('[data-ps="path-input"]');
  if (state.status === 'ready' && document.activeElement !== pathInput) pathInput.value = state.dir;
  var submit = store.get('projectStart').submit;
  var busy = submit.status === 'busy';
  var open = view.querySelector('[data-ps="open"]');
  var name = state.dir ? baseName(state.dir) : '';
  open.innerHTML = busy ? 'Opening…' : 'Open ' + (name ? '<span class="project-start-open-name">' + escapeHtml(name) + '</span>' : 'folder');
  open.disabled = busy || !canOpenFolder(state);
  open.title = state.dir && canOpenFolder(state) ? state.dir : '';
  var error = view.querySelector('[data-ps="error"]');
  error.textContent = submit.error || '';
  error.hidden = !submit.error;
  refreshIcons();
}

function togglePath(view, force) {
  var form = view.querySelector('.project-start-pathform');
  var open = typeof force === 'boolean' ? force : form.hidden;
  form.hidden = !open;
  view.querySelector('[data-ps="toggle-path"]').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    var input = form.querySelector('input');
    input.value = folder().dir || '';
    input.focus();
    input.select();
  }
}

export function bindFolderView(submitFolder) {
  onSubmit = submitFolder;
  var view = root();
  view.addEventListener('click', function (event) {
    var target = event.target.closest('[data-ps]');
    if (!target || target.disabled) return;
    var action = target.dataset.ps;
    var state = folder();
    if (action === 'up' && state.parent) navigateTo(state.parent);
    else if (action === 'enter') navigateTo(target.dataset.path);
    else if (action === 'retry') navigateTo(state.requestedPath);
    else if (action === 'back-to-dir') navigateTo(state.dir);
    else if (action === 'toggle-path') togglePath(view);
    else if (action === 'open' && canOpenFolder(state) && onSubmit) onSubmit(state.dir);
  });
  view.querySelector('.project-start-pathform').addEventListener('submit', function (event) {
    event.preventDefault();
    var value = view.querySelector('[data-ps="path-input"]').value.trim();
    if (value) navigateTo(value);
  });
  view.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !view.querySelector('.project-start-pathform').hidden) {
      event.stopPropagation();
      togglePath(view, false);
      view.querySelector('[data-ps="toggle-path"]').focus();
      return;
    }
    var rows = view.querySelectorAll('[data-ps="enter"]');
    var index = Array.prototype.indexOf.call(rows, document.activeElement);
    if (index < 0 || !rows.length) return;
    var key = event.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;
    event.preventDefault();
    var next = key === 'Home' ? 0 : key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (key === 'ArrowDown' ? 1 : -1)));
    rows[next].focus();
  });
}
