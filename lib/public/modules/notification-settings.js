import { store } from './store.js';

function status(text) { var el = document.getElementById('personal-notification-status'); if (el) el.textContent = text; }
function apply(values) {
  store.set({ notificationPreferences: values });
  ['alert', 'sound'].forEach(function (key) {
    var source = document.getElementById('notif-toggle-' + key);
    var target = document.getElementById('settings-notif-' + key);
    if (source) source.checked = values[key];
    if (target) target.checked = values[key];
  });
  window.dispatchEvent(new CustomEvent('clay:notification-preferences', { detail: values }));
}
export async function loadNotificationSettings() {
  if (store.get('notificationDraft') || store.get('notificationSaving')) return;
  try {
    var response = await fetch('/api/user/notifications');
    var data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (store.get('notificationDraft') || store.get('notificationSaving')) return;
    apply(data);
    if (!data.configured) {
      var legacyAlert = localStorage.getItem('notif-alert');
      var legacySound = localStorage.getItem('notif-sound');
      if (legacyAlert !== null || legacySound !== null) {
        store.set({ notificationPreferences: { alert: legacyAlert !== '0', sound: legacySound !== '0' } });
        await saveNotificationPreference('alert', legacyAlert !== '0');
        return;
      }
    }
    status('Preferences saved on this server. Browser permission: ' + ('Notification' in window ? Notification.permission : 'unsupported') + '.');
  } catch (error) { status(error.message || 'Notifications unavailable. Reopen Personal settings to retry.'); }
}
export async function saveNotificationPreference(key, value) {
  if (store.get('notificationSaving')) return;
  var saved = store.get('notificationDraft') || store.get('notificationPreferences');
  if (!saved) { status('Preferences have not loaded. Reopen Personal settings to retry.'); return; }
  var draft = Object.assign({}, saved); draft[key] = value;
  store.set({ notificationDraft: draft, notificationSaving: true });
  setPending(true);
  status('Saving…');
  try {
    var response = await fetch('/api/user/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Clay-Settings': '1' }, body: JSON.stringify(draft) });
    var data = await response.json();
    if (!response.ok) throw new Error(data.error);
    store.set({ notificationDraft: null });
    localStorage.removeItem('notif-alert'); localStorage.removeItem('notif-sound');
    apply(data); status('Saved. Browser permissions and push subscriptions are managed separately on this device.');
  } catch (error) { status(error.message || 'Could not save. Your selection is retained; retry below.'); }
  finally { store.set({ notificationSaving: false }); setPending(false); }
}
function setPending(pending) {
  ['settings-notif-alert', 'settings-notif-sound', 'notif-toggle-alert', 'notif-toggle-sound'].forEach(function (id) {
    var input = document.getElementById(id); if (input) input.disabled = pending;
  });
  var retry = document.getElementById('notification-save-retry');
  if (retry) retry.hidden = pending || !store.get('notificationDraft');
}
export function initNotificationSettings() {
  var retry = document.createElement('button'); retry.id = 'notification-save-retry'; retry.textContent = 'Retry save'; retry.className = 'settings-btn-sm'; retry.hidden = true;
  retry.onclick = function () { var draft = store.get('notificationDraft'); if (draft) saveNotificationPreference('alert', draft.alert); };
  document.getElementById('personal-notification-status').insertAdjacentElement('afterend', retry);
  ['alert', 'sound', 'push'].forEach(function (key) {
    var target = document.getElementById('settings-notif-' + key);
    if (!target) return;
    target.onchange = function () {
      var source = document.getElementById('notif-toggle-' + key);
      if (!source) { target.checked = false; status('Push requires the installed app on this device.'); return; }
      source.checked = target.checked;
      source.dispatchEvent(new Event('change', { bubbles: true }));
    };
  });
  var push = document.getElementById('settings-notif-push');
  push.disabled = !('serviceWorker' in navigator) || !window.isSecureContext || !('PushManager' in window);
  loadNotificationSettings();
}
export function updatePushSettings(checked, message, pending) {
  var input = document.getElementById('settings-notif-push');
  if (input) { input.checked = checked; if (pending !== undefined) input.disabled = pending; }
  if (message) status(message);
}
