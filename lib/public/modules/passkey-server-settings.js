import { store } from './store.js';
import { setSettingsDraft, clearSettingsDraft } from './server-settings-state.js';

function render(state) {
  var section = document.getElementById('passkey-policy');
  if (!section) return;
  section.hidden = !state.available;
  var input = section.querySelector('[name=origin]');
  if (state.draft === undefined) input.value = state.origin || '';
  input.disabled = !!state.pending || !!state.locked;
  section.querySelector('[name=currentPassword]').disabled = !!state.pending;
  section.querySelector('button').disabled = !!state.pending || !!state.locked;
  section.querySelector('[data-passkey-editor]').hidden = !!state.locked;
  section.querySelector('[role=status]').textContent = state.error || (state.pending ? 'Saving…' : state.origin ?
    'Passkeys are available at ' + state.origin + (state.locked ? '. Remove registered passkeys before changing this address.' : '.') : 'Not configured. Password sign-in remains available.');
}
export async function loadPasskeyServerSettings() {
  if (!document.getElementById('passkey-policy') || (store.get('passkeyPolicy') || {}).draft !== undefined) return;
  try {
    var response = await fetch('/api/passkey-policy'); var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load passkey settings.');
    store.set({ passkeyPolicy: data }); render(data);
  } catch (error) {
    var state = Object.assign({}, store.get('passkeyPolicy'), { error: error.message });
    store.set({ passkeyPolicy: state }); render(state);
  }
}
export function initPasskeyServerSettings() {
  var anchor = document.getElementById('account-auth-policy');
  if (!anchor || document.getElementById('passkey-policy')) return;
  var section = document.createElement('section'); section.id = 'passkey-policy'; section.className = 'settings-card'; section.hidden = true;
  section.innerHTML = '<h3>Passkey sign-in address</h3><p class="settings-hint">Configure the shared server address for passkey sign-in. Users register and manage their own passkeys in Personal settings → Account. Passwords remain available.</p>' +
    '<form><label class="settings-label" for="passkey-origin">Sign-in address</label><input class="us-text-input" id="passkey-origin" name="origin" type="url" placeholder="https://clay.example.com" required>' +
    '<p class="settings-hint">Use the permanent HTTPS address for this server. Local development can use http://localhost with its port.</p>' +
    '<div data-passkey-editor><label class="settings-label" for="passkey-admin-password">Administrator password</label><input class="us-text-input" id="passkey-admin-password" name="currentPassword" type="password" autocomplete="current-password" required>' +
    '<div class="settings-form-actions"><button class="settings-btn-sm" type="submit">Save passkey address</button></div></div></form><p class="settings-hint" role="status"></p>';
  anchor.after(section);
  var input = section.querySelector('[name=origin]');
  input.oninput = function () {
    var state = Object.assign({}, store.get('passkeyPolicy'), { draft: input.value, error: '' });
    if (input.value === (state.origin || '')) { delete state.draft; clearSettingsDraft('passkeys'); }
    else setSettingsDraft('passkeys', true);
    store.set({ passkeyPolicy: state }); render(state);
  };
  section.querySelector('form').onsubmit = async function (event) {
    event.preventDefault();
    var state = Object.assign({}, store.get('passkeyPolicy'), { pending: true, error: '' });
    store.set({ passkeyPolicy: state }); render(state);
    var password = section.querySelector('[name=currentPassword]');
    try {
      var response = await fetch('/api/passkey-policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: input.value, currentPassword: password.value }) });
      var data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save passkey settings.');
      state = data; clearSettingsDraft('passkeys');
    } catch (error) { state.pending = false; state.error = error.message; }
    finally { password.value = ''; store.set({ passkeyPolicy: state }); render(state); }
  };
}
