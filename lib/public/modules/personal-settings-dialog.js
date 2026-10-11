import { confirmSettingsAction, isolateSettingsDialog, trapSettingsFocus } from './server-settings-state.js';
import { enhanceSettingsSelects } from './settings-select.js';

// Keep contextual connection forms transactional when opened from settings.
export function preparePersonalConnectionDialog(overlay) {
  var previous = document.activeElement;
  var restore = isolateSettingsDialog(overlay);
  var dirty = false;
  var dialog = overlay.querySelector('.email-setup-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Add personal mailbox');
  overlay.querySelectorAll('.email-setup-field').forEach(function (field) {
    var label = field.querySelector('label');
    var input = field.querySelector('input,select');
    if (label && input) label.htmlFor = input.id;
  });
  enhanceSettingsSelects(overlay);
  overlay.addEventListener('input', function () {dirty = true;});
  overlay.addEventListener('change', function () {dirty = true;});
  function close() {
    observer.disconnect();restore();overlay.remove();
    if (previous && previous.isConnected) previous.focus();
  }
  function leave() {
    if (dirty) confirmSettingsAction('Discard this unsaved mailbox connection?', 'Discard', close);
    else close();
  }
  overlay.addEventListener('click', function (event) {
    if (event.target === overlay || event.target.closest('#email-setup-cancel')) {
      event.preventDefault();event.stopImmediatePropagation();leave();
    }
  }, true);
  overlay.addEventListener('keydown', function (event) {
    event.stopPropagation();
    if (event.key === 'Escape' && !event.defaultPrevented) {event.preventDefault();leave();}
    trapSettingsFocus(event, overlay);
  });
  var observer = new MutationObserver(function () {
    if (!overlay.isConnected) {observer.disconnect();restore();if(previous && previous.isConnected)previous.focus();}
  });
  observer.observe(document.body,{childList:true});
  overlay.querySelector('#email-setup-address').focus();
}
