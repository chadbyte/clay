import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';

// Reparent the live controls: their permissions, upload and model handlers stay
// with the production composer. Only contextual panes use this presentation.
export function initContextualComposer() {
  var row = document.getElementById('input-row');
  var tools = document.getElementById('attach-wrap');
  var config = document.getElementById('config-chip-wrap');
  var model = document.getElementById('config-chip');
  var modelPopover = document.getElementById('config-popover');
  var button = document.createElement('button');
  button.id = 'contextual-attach-btn'; button.type = 'button';
  button.setAttribute('aria-label', 'Add attachments and context');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'contextual-attach-popover');
  button.innerHTML = iconHtml('plus');
  var menu = document.createElement('div');
  menu.id = 'contextual-attach-popover'; menu.hidden = true;
  menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Attachments and context');
  menu.appendChild(tools); row.append(button, config, menu);
  ['attach-file-btn', 'attach-image-btn'].forEach(function (id) {
    var control = document.getElementById(id);
    var label = document.createElement('span');
    label.textContent = id === 'attach-file-btn' ? 'File' : 'Image'; control.appendChild(label);
    control.addEventListener('click', function () { close(true); });
  });
  var contextLabel = document.createElement('span'); contextLabel.textContent = 'Context sources';
  document.getElementById('context-sources-add').appendChild(contextLabel);
  model.setAttribute('aria-label', 'Model and session settings');
  model.setAttribute('aria-haspopup', 'dialog'); model.setAttribute('aria-controls', 'config-popover');
  model.setAttribute('aria-expanded', 'false');
  modelPopover.setAttribute('role', 'dialog'); modelPopover.setAttribute('aria-label', 'Model and session settings');
  function position(popover, anchor) {
    var rect = anchor.getBoundingClientRect();
    popover.style.width = Math.min(280, window.innerWidth - 16) + 'px';
    popover.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(280, window.innerWidth - 16) - 8)) + 'px';
    popover.style.bottom = Math.max(8, window.innerHeight - rect.top + 6) + 'px';
    popover.style.maxHeight = Math.max(40, rect.top - 14) + 'px';
  }
  function close(restoreFocus) {
    store.set({ contextualAttachmentMenuOpen: false });
    if (restoreFocus) button.focus({ preventScroll: true });
  }
  function actions() { return Array.from(menu.querySelectorAll('button:not(:disabled)')).filter(function (item) { return item.getClientRects().length; }); }
  button.addEventListener('click', function () {
    var open = !store.get('contextualAttachmentMenuOpen');
    modelPopover.classList.add('hidden'); model.classList.remove('active');
    store.set({ contextualAttachmentMenuOpen: open });
    if (open && actions()[0]) actions()[0].focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', function (event) {
    if (!menu.contains(event.target) && !button.contains(event.target) && store.get('contextualAttachmentMenuOpen')) close(false);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && (!menu.hidden || !modelPopover.classList.contains('hidden'))) {
      event.preventDefault(); event.stopImmediatePropagation();
      var sources = document.getElementById('context-sources-picker');
      if (!menu.hidden && !sources.classList.contains('hidden')) { sources.classList.add('hidden'); document.getElementById('context-sources-add').focus(); }
      else if (!menu.hidden) close(true);
      else { modelPopover.classList.add('hidden'); model.classList.remove('active'); model.focus({ preventScroll: true }); }
      return;
    }
    if (menu.hidden || !menu.contains(event.target) || !/^(ArrowDown|ArrowUp|Home|End)$/.test(event.key)) return;
    var items = actions(), index = items.indexOf(document.activeElement);
    if (!items.length) return;
    event.preventDefault();
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? items.length - 1 : 1)) % items.length].focus();
  }, true);
  menu.addEventListener('focusout', function (event) {
    if (menu.contains(event.relatedTarget) || event.relatedTarget === button) return;
    setTimeout(function () { if (!menu.contains(document.activeElement) && document.activeElement !== button && !menu.hidden) close(false); }, 0);
  });
  model.addEventListener('click', function () { close(false); });
  function placeMenus() { if (!menu.hidden) position(menu, button); if (!modelPopover.classList.contains('hidden')) position(modelPopover, model); }
  new MutationObserver(function () {
    model.setAttribute('aria-expanded', String(!modelPopover.classList.contains('hidden')));
    placeMenus();
  }).observe(modelPopover, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(placeMenus).observe(row);
  window.addEventListener('resize', placeMenus);
  store.subscribe(function (value) {
    var open = !!value.contextualAttachmentMenuOpen && value.contextualSessionReady && !value.contextualWriterSuspended;
    menu.hidden = !open; button.setAttribute('aria-expanded', String(open));
    button.disabled = !value.contextualSessionReady || !!value.contextualWriterSuspended;
    if (button.disabled) { modelPopover.classList.add('hidden'); model.classList.remove('active'); }
    placeMenus();
  });
  store.set({ contextualAttachmentMenuOpen: false });
  refreshIcons();
}
