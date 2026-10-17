import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml } from './utils.js';
import { confirmSettingsAction, trapSettingsFocus, isolateSettingsDialog } from './server-settings-state.js';
import { enhanceSettingsSelects } from './settings-select.js';

async function request(url, method, body) {
  var response = await fetch(url, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  var data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed (HTTP ' + response.status + ').');
  return data;
}
export function apiGet(url) { return request(url, 'GET'); }
export function apiPost(url, body) { return request(url, 'POST', body || {}); }
export function apiPut(url, body) { return request(url, 'PUT', body); }
export function apiDelete(url) { return request(url, 'DELETE'); }

// Editors open inline in the active Server settings page (a subview with its
// own Back/Cancel path) instead of over the page. Only destructive
// confirmations remain overlay dialogs.
export function mountAdminSubview(modal) {
  var host = document.querySelector('#server-settings .server-settings-section.active');
  if (!host) { document.body.appendChild(modal); return; }
  modal.className = 'admin-subview settings-subview';
  host.classList.add('has-subview');
  host.appendChild(modal);
  var observer = new MutationObserver(function () {
    if (!host.querySelector('.settings-subview')) { host.classList.remove('has-subview'); observer.disconnect(); }
  });
  observer.observe(host, { childList: true });
}

export function prepareAdminModal(modal) {
  if (modal.dataset.prepared) return;
  modal.dataset.prepared = 'true';
  var previous = document.activeElement;
  var inline = modal.classList.contains('settings-subview');
  var restore = inline ? function () {} : isolateSettingsDialog(modal);
  var dialog = modal.querySelector('.admin-modal');
  dialog.setAttribute('role', inline ? 'region' : 'dialog'); if (!inline) dialog.setAttribute('aria-modal', 'true');
  var title = dialog.querySelector('h3'); dialog.setAttribute('aria-label', title ? title.textContent : 'Confirm action');
  var dirty = false;
  modal.addEventListener('input', function () { dirty = true; });
  modal.addEventListener('change', function () { dirty = true; });
  function cancel(event) {
    if (dirty) {
      event.preventDefault(); event.stopImmediatePropagation();
      confirmSettingsAction('Discard the unsaved changes in this dialog?', 'Discard changes', function () { modal.remove(); });
    }
  }
  modal.addEventListener('click', function (event) {
    if (event.target === modal || event.target.closest('.admin-modal-close, .admin-modal-cancel')) cancel(event);
  }, true);
  modal.addEventListener('keydown', function (event) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); if (dirty) cancel(event); else modal.remove(); }
    if (!inline) trapSettingsFocus(event, modal);
  });
  modal.querySelectorAll('.admin-smtp-row').forEach(function (row) {
    var label = row.querySelector('label'); var input = row.querySelector('input, select');
    if (label && input && input.id) label.htmlFor = input.id;
    if (label && input && input.tagName === 'SELECT') input.setAttribute('aria-label', label.textContent);
  });
  var closeButton = modal.querySelector('.admin-modal-close'); if (closeButton) closeButton.setAttribute('aria-label', 'Close dialog');
  enhanceSettingsSelects(modal);
  var closeObserver = new MutationObserver(function () {
    if (!modal.isConnected) { closeObserver.disconnect(); restore(); if (previous && previous.isConnected) previous.focus(); }
  });
  closeObserver.observe(inline ? modal.parentElement : document.body, { childList: true });
  var focus = modal.querySelector('input:not([type=hidden]), .admin-modal-cancel, button');
  if (focus) focus.focus();
}

export function showConfirmDialog(message, actionLabel, onConfirm) {
  var modal = document.createElement("div");
  modal.className = "admin-modal-overlay";
  var html = '<div class="admin-modal" role="dialog" aria-modal="true" aria-label="Confirm action">' +
    '<div class="admin-modal-body" style="padding:20px 16px 16px">' +
    '<p class="admin-modal-desc" style="margin:0;font-size:14px;color:var(--text)">' + escapeHtml(message) + '</p>' +
    '</div>' +
    '<div class="admin-modal-footer">' +
    '<button class="admin-modal-save admin-modal-confirm-danger">' + escapeHtml(actionLabel) + '</button>' +
    '<button class="admin-modal-cancel">Cancel</button>' +
    '</div></div>';
  modal.innerHTML = html;
  document.body.appendChild(modal);
  prepareAdminModal(modal);
  refreshIcons(modal);
  modal.querySelector(".admin-modal-cancel").addEventListener("click", function () { modal.remove(); });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
  modal.querySelector(".admin-modal-confirm-danger").addEventListener("click", function () {
    modal.remove();
    onConfirm();
  });
}

export function showConfirmResetPin(name, onConfirm) {
  var modal = document.createElement("div");
  modal.className = "admin-modal-overlay";
  var html = '<div class="admin-modal">' +
    '<div class="admin-modal-body" style="padding:20px 16px 16px">' +
    '<p class="admin-modal-desc" style="margin:0;font-size:14px;color:var(--text)">Reset PIN for <strong>' + escapeHtml(name) + '</strong>? A new temporary PIN will be generated and they will need to change it on next login.</p>' +
    '</div>' +
    '<div class="admin-modal-footer">' +
    '<button class="admin-modal-save">Reset PIN</button>' +
    '<button class="admin-modal-cancel">Cancel</button>' +
    '</div></div>';
  modal.innerHTML = html;
  document.body.appendChild(modal);
  prepareAdminModal(modal);
  modal.querySelector(".admin-modal-cancel").addEventListener("click", function () { modal.remove(); });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
  modal.querySelector(".admin-modal-save").addEventListener("click", function () {
    modal.remove();
    onConfirm();
  });
}
