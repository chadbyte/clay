import { store } from './store.js';
import { confirmSettingsAction, isolateSettingsDialog, trapSettingsFocus } from './server-settings-state.js';
import { enhanceSettingsSelects } from './settings-select.js';

// Keep contextual connection forms transactional when opened from settings.
export function preparePersonalConnectionDialog(overlay, inline) {
  var previous = document.activeElement;
  var restore = inline ? function () {} : isolateSettingsDialog(overlay);
  var dirty = false;
  var dialog = overlay.querySelector('.email-setup-dialog');
  dialog.setAttribute('role', inline ? 'region' : 'dialog');
  if (!inline) dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Add personal mailbox');
  overlay.querySelectorAll('.email-setup-field').forEach(function (field) {
    var label = field.querySelector('label');
    var input = field.querySelector('input,select');
    if (label && input) label.htmlFor = input.id;
  });
  enhanceSettingsSelects(overlay);
  function markDirty() { dirty = true; if (inline) store.set({personalEmailDirty:true}); }
  overlay.addEventListener('input', markDirty);
  overlay.addEventListener('change', markDirty);
  var unsubscribe = inline ? store.subscribe(function (state, previousState) {
    if (state.myUserId !== previousState.myUserId) close();
  }) : function () {};
  function cleanup() { observer.disconnect(); unsubscribe(); restore(); if (inline) store.set({personalEmailDirty:false}); }
  function close() {
    cleanup();overlay.remove();
    if (previous && previous.isConnected) previous.focus();
  }
  function leave() {
    if (dirty) confirmSettingsAction('Discard this unsaved mailbox connection?', 'Discard', close);
    else close();
  }
  overlay.addEventListener('click', function (event) {
    if (!inline && event.target === overlay || event.target.closest('#email-setup-cancel')) {
      event.preventDefault();event.stopImmediatePropagation();leave();
    }
  }, true);
  overlay.addEventListener('keydown', function (event) {
    if (!inline || event.key === 'Escape') event.stopPropagation();
    if (event.key === 'Escape' && !event.defaultPrevented) {event.preventDefault();leave();}
    if (!inline) trapSettingsFocus(event, overlay);
  });
  var observer = new MutationObserver(function () {
    if (!overlay.isConnected) {cleanup();if(previous && previous.isConnected)previous.focus();}
  });
  observer.observe(inline ? overlay.parentElement : document.body,{childList:true});
  (overlay.querySelector('#email-setup-address') || overlay.querySelector('button')).focus();
  return close;
}
