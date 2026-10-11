// header-tui-font.js
//
// Single icon button in the title bar (visible only while a TUI session
// is active) that opens a popover with terminal font settings: family
// picker (with per-item font preview) + size stepper. Values live in
// terminal-prefs.js and persist server-side via
// PUT /api/user/terminal-font.

import {
  saveTerminalFont,
  TERMINAL_FONT_OPTIONS,
  getTerminalFontFamily,
  getTerminalFontSize,
  onTerminalFontChange,
} from './terminal-prefs.js';

var FONT_OPTIONS = TERMINAL_FONT_OPTIONS;

var MIN_SIZE = 9;
var MAX_SIZE = 32;

var btnEl = null;
var popoverEl = null;
var sizeValEl = null;
var sizeDecEl = null;
var sizeIncEl = null;
var menuItemEls = [];
var popoverOpen = false;
var outsideHandler = null;
var keyHandler = null;
var initialized = false;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function persistTermFont(family, size) {
  var status = popoverEl.querySelector('[role=status]');
  status.textContent = 'Saving…';
  popoverEl.querySelectorAll('button').forEach(function (button) {button.disabled = true;});
  saveTerminalFont(family, size).then(function () {status.textContent = 'Saved.';})
    .catch(function (error) {status.textContent = error.message;})
    .finally(function () {popoverEl.querySelectorAll('button').forEach(function (button) {button.disabled = false;});syncSize();});
}

function syncSize() {
  if (!sizeValEl) return;
  var sz = getTerminalFontSize();
  sizeValEl.textContent = String(sz);
  if (sizeDecEl) sizeDecEl.disabled = sz <= MIN_SIZE;
  if (sizeIncEl) sizeIncEl.disabled = sz >= MAX_SIZE;
}

function syncActiveFamily() {
  var fam = getTerminalFontFamily();
  for (var i = 0; i < menuItemEls.length; i++) {
    var el = menuItemEls[i];
    el.classList.toggle('active', el.dataset.family === fam);
  }
}

function buildPopover() {
  if (popoverEl) return popoverEl;
  popoverEl = document.createElement('div');
  popoverEl.className = 'header-tui-font-popover';

  var label = document.createElement('div');
  label.className = 'header-tui-font-popover-label';
  label.textContent = 'Font';
  popoverEl.appendChild(label);

  var list = document.createElement('div');
  list.className = 'header-tui-font-popover-list';
  for (var i = 0; i < FONT_OPTIONS.length; i++) {
    var opt = FONT_OPTIONS[i];
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'header-tui-font-popover-item';
    item.dataset.family = opt.family;
    item.style.fontFamily = opt.family;
    item.innerHTML =
      '<span class="header-tui-font-popover-check"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>' +
      '<span class="header-tui-font-popover-item-label">' + escapeHtml(opt.label) + '</span>';
    (function (family) {
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        persistTermFont(family, undefined);
      });
    })(opt.family);
    list.appendChild(item);
    menuItemEls.push(item);
  }
  popoverEl.appendChild(list);

  var divider = document.createElement('div');
  divider.className = 'header-tui-font-popover-divider';
  popoverEl.appendChild(divider);

  var sizeRow = document.createElement('div');
  sizeRow.className = 'header-tui-font-popover-size';
  sizeRow.innerHTML =
    '<span class="header-tui-font-popover-size-label">Size</span>' +
    '<div class="header-tui-font-popover-size-stepper">' +
      '<button type="button" data-step="-1" title="Smaller">−</button>' +
      '<span class="header-tui-font-popover-size-val">13</span>' +
      '<button type="button" data-step="1" title="Larger">+</button>' +
    '</div>';
  popoverEl.appendChild(sizeRow);

  sizeValEl = sizeRow.querySelector('.header-tui-font-popover-size-val');
  var stepBtns = sizeRow.querySelectorAll('button');
  sizeDecEl = stepBtns[0];
  sizeIncEl = stepBtns[1];
  sizeDecEl.addEventListener('click', function (e) {
    e.stopPropagation();
    var next = Math.max(MIN_SIZE, getTerminalFontSize() - 1);
    persistTermFont(undefined, next);
  });
  sizeIncEl.addEventListener('click', function (e) {
    e.stopPropagation();
    var next = Math.min(MAX_SIZE, getTerminalFontSize() + 1);
    persistTermFont(undefined, next);
  });

  var status = document.createElement('p');status.setAttribute('role','status');status.className='settings-status';popoverEl.appendChild(status);
  document.body.appendChild(popoverEl);
  return popoverEl;
}

function positionPopover() {
  if (!popoverEl || !btnEl) return;
  var r = btnEl.getBoundingClientRect();
  popoverEl.style.left = '0px';
  popoverEl.style.top = '0px';
  var pw = popoverEl.offsetWidth || 220;
  var ph = popoverEl.offsetHeight || 340;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var left = r.right - pw;
  if (left < 8) left = 8;
  if (left + pw > vw - 8) left = vw - pw - 8;
  var top = r.bottom + 8;
  if (top + ph > vh - 8) {
    var flipped = r.top - ph - 8;
    if (flipped >= 8) top = flipped;
    else top = Math.max(8, vh - ph - 8);
  }
  popoverEl.style.left = left + 'px';
  popoverEl.style.top = top + 'px';
}

function openPopover() {
  if (popoverOpen) return;
  buildPopover();
  syncActiveFamily();
  syncSize();
  popoverEl.classList.add('visible');
  positionPopover();
  popoverOpen = true;
  if (btnEl) btnEl.classList.add('active');

  outsideHandler = function (ev) {
    if (!popoverEl) return;
    if (popoverEl.contains(ev.target)) return;
    if (btnEl && btnEl.contains(ev.target)) return;
    closePopover();
  };
  document.addEventListener('mousedown', outsideHandler, true);

  keyHandler = function (ev) {
    if (ev.key === 'Escape') closePopover();
  };
  document.addEventListener('keydown', keyHandler, true);
}

function closePopover() {
  if (!popoverOpen) return;
  if (popoverEl) popoverEl.classList.remove('visible');
  if (btnEl) btnEl.classList.remove('active');
  popoverOpen = false;
  if (outsideHandler) {
    document.removeEventListener('mousedown', outsideHandler, true);
    outsideHandler = null;
  }
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
  }
}

export function initHeaderTuiFont() {
  if (initialized) return;
  btnEl = document.getElementById('header-tui-font-btn');
  if (!btnEl) return;
  btnEl.addEventListener('click', function (e) {
    e.stopPropagation();
    if (popoverOpen) closePopover();
    else openPopover();
  });
  // Reflect external changes back into the popover (re-renders only if
  // it's currently open).
  onTerminalFontChange(function () {
    if (popoverOpen) {
      syncActiveFamily();
      syncSize();
    }
  });
  initialized = true;
}

export function showHeaderTuiFont() {
  if (!btnEl) return;
  btnEl.classList.remove('hidden');
}

export function hideHeaderTuiFont() {
  closePopover();
  if (!btnEl) return;
  btnEl.classList.add('hidden');
}
