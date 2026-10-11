import { store } from './store.js';

export function setSettingsDraft(key, dirty) {
  var drafts = Object.assign({}, store.get('serverSettingsDrafts') || {});
  drafts[key] = !!dirty;
  store.set({ serverSettingsDrafts: drafts });
}
export function clearSettingsDraft(key) { setSettingsDraft(key, false); }
export function hasSettingsDrafts() {
  var network = store.get('networkSettings');
  var drafts = store.get('serverSettingsDrafts') || {};
  return Object.keys(drafts).some(function (key) { return drafts[key]; }) ||
    !!(network && network.loaded && network.draft !== network.saved);
}

export function trapSettingsFocus(event, root) {
  if (event.key !== 'Tab') return;
  var items = Array.from(root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(function (el) { return el.getClientRects().length; });
  if (!items.length) return;
  var first = items[0]; var last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
}

export function isolateSettingsDialog(overlay) {
  var entries = Array.from(document.body.children).filter(function (el) { return el !== overlay && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE'; }).map(function (el) {
    var entry = { el: el, inert: el.inert, hidden: el.getAttribute('aria-hidden') };
    el.inert = true; el.setAttribute('aria-hidden', 'true'); return entry;
  });
  return function () { entries.forEach(function (entry) { entry.el.inert = entry.inert; if (entry.hidden === null) entry.el.removeAttribute('aria-hidden'); else entry.el.setAttribute('aria-hidden', entry.hidden); }); };
}

export function confirmSettingsAction(message, action, onConfirm) {
  if (document.getElementById('settings-confirm')) return;
  var previous = document.activeElement;
  var overlay = document.createElement('div');
  overlay.id = 'settings-confirm'; overlay.className = 'settings-confirm';
  overlay.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="settings-confirm-title"><h3 id="settings-confirm-title"></h3><p></p><div class="settings-confirm-actions"><button class="settings-btn-sm" data-cancel>Keep editing</button><button class="settings-btn-sm" data-confirm></button></div></div>';
  overlay.querySelector('h3').textContent = action;
  overlay.querySelector('p').textContent = message;
  overlay.querySelector('[data-confirm]').textContent = action;
  function close() { restore(); overlay.remove(); if (previous && previous.isConnected) previous.focus(); }
  overlay.querySelector('[data-cancel]').onclick = close;
  overlay.querySelector('[data-confirm]').onclick = function () { close(); onConfirm(); };
  overlay.addEventListener('keydown', function (event) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    trapSettingsFocus(event, overlay);
  });
  overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
  document.body.appendChild(overlay);
  var restore = isolateSettingsDialog(overlay);
  overlay.querySelector('[data-cancel]').focus();
}
