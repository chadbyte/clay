import { filePreviewKind } from './file-pane-render.js';
import { iconHtml, refreshIcons } from './icons.js';

function button(label, icon, action) {
  var element = document.createElement('button'); element.type = 'button'; element.title = label; element.setAttribute('aria-label', label);
  element.innerHTML = icon ? iconHtml(icon) : label; element.addEventListener('click', action); return element;
}
export function filePaneShell(id, act) {
  var panel = document.createElement('section'); panel.id = 'file-' + id; panel.className = 'file-instance'; panel.dataset.fileInstance = id;
  var header = document.createElement('header'); header.className = 'tool-pane-header split-pane-header'; header.dataset.toolPane = panel.id;
  var title = document.createElement('span'); title.className = 'tool-pane-title split-pane-title';
  var space = document.createElement('span'); space.className = 'split-pane-drag-space';
  var actions = document.createElement('div'); actions.className = 'file-viewer-window-actions';
  var pin = button('Pin this file', 'pin', function () { act('pin'); }); pin.dataset.action = 'pin';
  actions.append(pin, button('Expand file pane', 'maximize-2', function () { act('expand'); }), button('Close file pane', 'x', function () { act('close'); }));
  header.append(title, space, actions);
  var toolbar = document.createElement('div'); toolbar.className = 'file-instance-toolbar'; toolbar.setAttribute('aria-label', 'File actions');
  ['Preview', 'Source', 'History'].forEach(function (label) { var b = button(label, null, function () { act(label.toLowerCase()); }); b.dataset.action = label.toLowerCase(); toolbar.appendChild(b); });
  var more = button('More file actions', 'ellipsis', toggle); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
  toolbar.appendChild(more);
  var menu = document.createElement('div'); menu.className = 'file-instance-more hidden'; menu.setAttribute('role', 'menu');
  [['Copy source', 'copy'], ['Copy formatted', 'formatted'], ['Download', 'download'], ['Export PDF', 'pdf'], ['Present slides', 'slides'], ['Use H1 headings', 'h1'], ['Use H2 headings', 'h2'], ['Use H3 headings', 'h3'], ['Refresh', 'refresh']].forEach(function (item) {
    var b = button(item[0], null, function () { dismiss(true); act(item[1]); }); b.setAttribute('role', 'menuitem'); b.dataset.action = item[1]; menu.appendChild(b);
  });
  function dismiss(focus) { menu.classList.add('hidden'); more.setAttribute('aria-expanded', 'false'); if (focus) more.focus(); }
  function toggle() { var open = menu.classList.contains('hidden'); dismiss(false); if (open) { menu.classList.remove('hidden'); more.setAttribute('aria-expanded', 'true'); menu.querySelector('button:not(:disabled)').focus(); } }
  function outside(event) { if (!menu.contains(event.target) && !more.contains(event.target)) dismiss(false); }
  panel.addEventListener('keydown', function (event) {
    if (!menu.classList.contains('hidden')) {
      if (event.key === 'Escape' || event.key === 'Tab') { dismiss(event.key === 'Escape'); event.stopPropagation(); if (event.key === 'Escape') event.preventDefault(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        var buttons = Array.from(menu.querySelectorAll('button:not(:disabled)')), index = buttons.indexOf(document.activeElement);
        index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index].focus(); event.preventDefault(); event.stopPropagation();
      }
      return;
    }
    if (event.key === 'Escape') { act('escape'); event.stopPropagation(); }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') act(event.key === 'ArrowRight' ? 'next' : 'previous');
  });
  document.addEventListener('pointerdown', outside);
  panel.addEventListener('clay-tool-pane-dispose', function () { document.removeEventListener('pointerdown', outside); }, { once: true });
  var body = document.createElement('div'); body.className = 'file-viewer-body'; body.tabIndex = 0;
  panel.append(header, toolbar, menu, body); refreshIcons(); return panel;
}
export function updateFilePaneToolbar(panel, state) {
  var title = panel.querySelector('.tool-pane-title'); title.textContent = state.resource.path.split('/').pop(); title.title = state.resource.path;
  var pin = panel.querySelector('[data-action="pin"]'), pinned = state.resource.mode === 'pin';
  pin.setAttribute('aria-pressed', String(pinned)); pin.title = pinned ? 'Pinned to ' + state.resource.path + '. Switch to Follow selection' : 'Following file selection. Pin this file'; pin.setAttribute('aria-label', pinned ? 'Follow file selection' : 'Pin this file');
  ['preview', 'source', 'history'].forEach(function (key) { panel.querySelector('[data-action="' + key + '"]').setAttribute('aria-pressed', String(key === 'history' ? state.historyVisible : !state.historyVisible && (key === 'preview') === state.resource.rendered)); });
  panel.querySelector('[data-action="preview"]').disabled = !filePreviewKind(state.resource.path) || !!state.binary;
  var markdown = /\.mdx?$/i.test(state.resource.path);
  ['pdf', 'formatted', 'slides', 'h1', 'h2', 'h3'].forEach(function (key) { panel.querySelector('[data-action="' + key + '"]').disabled = !markdown; });
}
