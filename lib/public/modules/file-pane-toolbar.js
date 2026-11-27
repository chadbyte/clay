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
  var pin = button('Pin this file', 'link-2', function () { act('pin'); }); pin.dataset.action = 'pin';
  actions.append(pin, button('Expand file pane', 'maximize-2', function () { act('expand'); }), button('Close file pane', 'x', function () { act('close'); }));
  header.append(title, space, actions);
  var toolbar = document.createElement('div'); toolbar.className = 'file-instance-toolbar'; toolbar.setAttribute('aria-label', 'File actions');
  [
    ['Preview', 'preview', 'book-open'], ['Source', 'source', 'code'], ['History', 'history', 'clock'],
    ['Refresh', 'refresh', 'refresh-cw'], ['Download', 'download', 'download'], ['Copy source', 'copy', 'copy'],
    ['Copy formatted', 'formatted', 'copy-plus'], ['Export PDF', 'pdf', 'square-arrow-out-up-right'], ['Present slides', 'slides', 'presentation']
  ].forEach(function (item) {
    var control = button(item[0], item[2], function () { act(item[1]); });
    control.dataset.action = item[1]; toolbar.appendChild(control);
  });
  var level = button('Slide heading level', 'chevron-down', toggle);
  var levelText = document.createElement('span'); levelText.textContent = 'H1';
  level.prepend(levelText); level.dataset.action = 'slide-level';
  level.setAttribute('aria-haspopup', 'menu'); level.setAttribute('aria-expanded', 'false');
  var menu = document.createElement('div'); menu.className = 'file-instance-heading-menu hidden'; menu.setAttribute('role', 'menu');
  [['Use H1 headings', 'h1'], ['Use H2 headings', 'h2'], ['Use H3 headings', 'h3']].forEach(function (item) {
    var b = button(item[0], null, function () { dismiss(true); act(item[1]); }); b.setAttribute('role', 'menuitem'); b.dataset.action = item[1]; menu.appendChild(b);
  });
  toolbar.append(level, menu);
  function dismiss(focus) { menu.classList.add('hidden'); level.setAttribute('aria-expanded', 'false'); if (focus) level.focus(); }
  function toggle() { var open = menu.classList.contains('hidden'); dismiss(false); if (open) { menu.classList.remove('hidden'); level.setAttribute('aria-expanded', 'true'); menu.querySelector('button:not(:disabled)').focus(); } }
  function outside(event) { if (!menu.contains(event.target) && !level.contains(event.target)) dismiss(false); }
  panel.addEventListener('keydown', function (event) {
    if (!menu.classList.contains('hidden')) {
      if (event.key === 'Escape' || event.key === 'Tab') { dismiss(event.key === 'Escape'); event.stopPropagation(); if (event.key === 'Escape') event.preventDefault(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        var buttons = Array.from(menu.querySelectorAll('button:not(:disabled)')), index = buttons.indexOf(document.activeElement);
        index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        if (buttons[index]) buttons[index].focus();
        event.preventDefault(); event.stopPropagation();
      }
      return;
    }
    if (event.key === 'Escape' && !panel.classList.contains('markdown-slides-active')) { act('escape'); event.stopPropagation(); }
  });
  document.addEventListener('pointerdown', outside);
  panel.addEventListener('clay-tool-pane-dispose', function () { document.removeEventListener('pointerdown', outside); }, { once: true });
  var body = document.createElement('div'); body.className = 'file-viewer-body'; body.tabIndex = 0;
  panel.append(header, toolbar, body); refreshIcons(); return panel;
}
export function updateFilePaneToolbar(panel, state, headingCounts) {
  var title = panel.querySelector('.tool-pane-title'); title.textContent = state.resource.path.split('/').pop(); title.title = state.resource.path;
  var pin = panel.querySelector('[data-action="pin"]'), pinned = state.resource.mode === 'pin';
  pin.setAttribute('aria-pressed', String(pinned)); pin.title = pinned ? 'Pinned to ' + state.resource.path + '. Switch to Follow selection' : 'Following file selection. Pin this file'; pin.setAttribute('aria-label', pinned ? 'Follow file selection' : 'Pin this file');
  ['preview', 'source', 'history'].forEach(function (key) { panel.querySelector('[data-action="' + key + '"]').setAttribute('aria-pressed', String(key === 'history' ? state.historyVisible : !state.historyVisible && (key === 'preview') === state.resource.rendered)); });
  panel.querySelector('[data-action="preview"]').disabled = !filePreviewKind(state.resource.path) || !!state.binary;
  var markdown = /\.mdx?$/i.test(state.resource.path);
  ['pdf', 'formatted'].forEach(function (key) { panel.querySelector('[data-action="' + key + '"]').disabled = !markdown; });
  var slides = panel.querySelector('[data-action="slides"]'), level = panel.querySelector('[data-action="slide-level"]');
  slides.disabled = level.disabled = !headingCounts[state.slideLevel];
  slides.setAttribute('aria-pressed', String(!!state.presenting));
  level.querySelector('span').textContent = 'H' + state.slideLevel;
  for (var i = 1; i <= 3; i++) panel.querySelector('[data-action="h' + i + '"]').disabled = !headingCounts[i];
  if (level.disabled) {
    level.setAttribute('aria-expanded', 'false');
    panel.querySelector('.file-instance-heading-menu').classList.add('hidden');
  }
}
