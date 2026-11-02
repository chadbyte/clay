// Direction menu, then a centered session picker inside the reserved empty pane.
import { store } from './store.js';
import { retryOptions } from './session-create.js';
import { pickerReceipt, pickerCurrent, insertPickerSession, createPickerSession } from './split-view-picker-actions.js';
import { renderPicker, renderPickerResults } from './split-view-picker-render.js';
import { showToast } from './utils.js';

function menuElement() { return document.getElementById('split-view-create-menu'); }
function close(returnFocus) {
  var menu = menuElement(); if (!menu) return;
  var state = store.get('splitSessionPicker');
  var update = { splitSessionPicker: null, projectSplitViewCreateSelection: [] };
  if (returnFocus && state && pickerCurrent(state.receipt) && !store.get('projectSplitViewPending')) update.projectSplitViewFocusedOrigin = state.priorFocus || null;
  var anchor = menu.clayCreateAnchor; menu.clayCreateAnchor = null;
  menu.hidden = true; store.set(update);
  if (menu.contains(document.activeElement)) document.activeElement.blur();
  if (menu.parentNode !== document.body) document.body.appendChild(menu);
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  document.dispatchEvent(new CustomEvent('clay-split-picker-layout'));
  if (returnFocus && anchor && anchor.isConnected) anchor.focus();
}
function position() {
  var menu = menuElement(), anchor = menu && menu.clayCreateAnchor;
  if (!menu || menu.hidden) return;
  if (!anchor || !anchor.isConnected) { close(false); return; }
  var state = store.get('splitSessionPicker');
  if (state && state.side) { menu.style.left = ''; menu.style.top = ''; return; }
  var rect = anchor.getBoundingClientRect(), width = menu.offsetWidth;
  menu.style.left = Math.max(8, Math.min(rect.right - width, innerWidth - width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(rect.bottom + 5, innerHeight - menu.offsetHeight - 8)) + 'px';
}
function open(anchor, side, origin) {
  var receipt = pickerReceipt(anchor, origin);
  if (!receipt || !pickerCurrent(receipt)) { showToast('Wait for this View to finish loading, then try again.', 'warn'); return; }
  var menu = menuElement();
  if (menu && !menu.hidden && menu.clayCreateAnchor === anchor) { close(true); return; }
  if (menu && !menu.hidden) close(false);
  if (!menu) {
    menu = document.createElement('section'); menu.id = 'split-view-create-menu'; menu.className = 'split-view-arrange split-session-picker'; menu.hidden = true;
    menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Add a session split'); document.body.appendChild(menu);
  }
  receipt.reservationId = 'split-picker-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  menu.clayCreateAnchor = anchor; anchor.setAttribute('aria-expanded', 'true');
  store.set({ splitSessionPicker: { receipt: receipt, side: side || null, query: '', error: '', priorFocus: store.get('projectSplitViewFocusedOrigin') } });
  if (side) store.set({ projectSplitViewFocusedOrigin: null });
  renderPicker(menu); menu.hidden = false;
  if (side) document.dispatchEvent(new CustomEvent('clay-split-picker-layout'));
  position(); menu.querySelector(side ? 'input' : '[data-split-side]').focus();
  if (side) retryOptions();
}
function onClick(event) {
  var menu = menuElement(), state = store.get('splitSessionPicker'); if (!menu || menu.hidden || !state) return;
  var button = event.target.closest && event.target.closest('button');
  if (!menu.contains(event.target)) { if (!state.side && (!event.target.closest || !event.target.closest('.split-view-arrange-trigger'))) close(false); return; }
  if (!button || button.disabled) return;
  event.preventDefault();
  if (button.dataset.splitClose) { close(true); return; }
  if (!pickerCurrent(state.receipt)) { close(true); return; }
  if (button.dataset.splitSide) {
    store.set({ splitSessionPicker: Object.assign({}, state, { side: button.dataset.splitSide, query: '' }), projectSplitViewFocusedOrigin: null }); renderPicker(menu); document.dispatchEvent(new CustomEvent('clay-split-picker-layout')); position(); menu.querySelector('input').focus(); retryOptions(); return;
  }
  if (button.dataset.splitRetry) { retryOptions(); return; }
  var accepted = button.dataset.splitSession ? insertPickerSession(state.receipt, state.side, Number(button.dataset.splitSession)) : button.dataset.splitVendor ? createPickerSession(state.receipt, state.side, button.dataset.splitVendor) : false;
  if (accepted) renderPickerResults(menu);
  else { store.set({ splitSessionPicker: Object.assign({}, state, { error: 'The split could not be added. Check the View and try again.' }) }); renderPickerResults(menu); }
}
function onKey(event) {
  var menu = menuElement(), state = store.get('splitSessionPicker'); if (!menu || menu.hidden || !state) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); return; }
  if (!menu.contains(event.target)) return;
  var keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (keys.indexOf(event.key) < 0 && !(event.key === 'Enter' && event.target.tagName === 'INPUT')) return;
  var items = Array.from(menu.querySelectorAll('[data-split-side], [data-split-session], [data-split-vendor]')).filter(function (button) { return !button.disabled; });
  if (!items.length) return;
  if (event.target.tagName === 'INPUT' && (event.key === 'Home' || event.key === 'End')) return;
  event.preventDefault();
  var index = items.indexOf(document.activeElement);
  if (event.key === 'Enter') { items[0].click(); return; }
  var next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index < 0 ? event.key === 'ArrowUp' ? items.length - 1 : 0 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
  items[next].focus();
}
export function initSplitViewCreateMenu() {
  document.addEventListener('clay-split-view-open-create', function (event) { if (event.detail && event.detail.anchor) open(event.detail.anchor, event.detail.side, event.detail.origin); });
  document.addEventListener('click', onClick, true); document.addEventListener('keydown', onKey, true);
  document.addEventListener('input', function (event) {
    var state = store.get('splitSessionPicker'); if (!state || !event.target.matches('#split-view-create-menu input')) return;
    store.set({ splitSessionPicker: Object.assign({}, state, { query: event.target.value }) });
    var label = menuElement().querySelector('.split-session-section'); label.textContent = event.target.value ? 'Search results' : 'Recent sessions'; renderPickerResults(menuElement()); position();
  });
  window.addEventListener('resize', position);
  store.subscribe(function (state, previous) {
    if (!state.splitSessionPicker) return;
    if (!pickerCurrent(state.splitSessionPicker.receipt)) { close(false); return; }
    if (state.sessionCreateOptions !== previous.sessionCreateOptions || state.projectSplitViewPending !== previous.projectSplitViewPending || state.paneBindingSessions !== previous.paneBindingSessions || state.splitSessionCreation !== previous.splitSessionCreation) { renderPickerResults(menuElement()); position(); }
  });
}
