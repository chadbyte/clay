import { store } from './store.js';
import { setSettingsDraft, clearSettingsDraft } from './server-settings-state.js';
function render(state) {
  var section = document.getElementById('account-transport'); if (!section) return;
  section.hidden = !state.available;
  if (!state.dirty) {
    section.querySelector('[name=origin]').value = state.origin || '';
    section.querySelector('[name=proxies]').value = (state.trustedProxies || []).join('\n');
  }
  section.querySelectorAll('input,textarea,button').forEach(function (element) { element.disabled = !!state.pending; });
  section.querySelector('[role=status]').textContent = state.error || (state.pending ? 'Saving…' : state.origin ? 'Saved proxy HTTPS address: ' + state.origin : 'Direct HTTPS or localhost access. No proxy headers are trusted.');
}
export async function loadAccountTransportSettings() {
  if ((store.get('accountTransport') || {}).dirty) return;
  try {
    var response = await fetch('/api/account-transport'); var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load connection settings.');
    var state = Object.assign({}, data, { available: (store.get('accountAuthPolicy') || {}).method === 'password' });
    store.set({ accountTransport: state }); render(state);
  } catch (error) {
    var state = Object.assign({}, store.get('accountTransport'), { error: error.message });
    store.set({ accountTransport: state }); render(state);
  }
}
export function initAccountTransportSettings() {
  var anchor = document.getElementById('passkey-policy'); if (!anchor || document.getElementById('account-transport')) return;
  var section = document.createElement('section'); section.id = 'account-transport'; section.className = 'settings-card'; section.hidden = true;
  section.innerHTML = '<h3>HTTPS &amp; trusted proxies</h3><p class="settings-hint">Connection security for account users on this server. Account passwords require HTTPS for remote access. Localhost is available for setup and recovery.</p>' +
    '<form><label class="settings-label" for="account-external-origin">Proxy HTTPS address</label><input class="us-text-input" id="account-external-origin" name="origin" type="url" placeholder="https://clay.example.com">' +
    '<label class="settings-label" for="account-trusted-proxies">Trusted proxy IP addresses</label><textarea class="settings-network-origins" id="account-trusted-proxies" name="proxies" rows="2" placeholder="One exact IP address per line"></textarea>' +
    '<p class="settings-hint">Leave empty for direct HTTPS. Each trusted proxy must overwrite X-Forwarded-Proto and X-Real-IP, prevent direct public access to the backend, and serve this HTTPS address. Forwarded host headers are ignored.</p>' +
    '<label class="settings-label" for="account-transport-password">Administrator password</label><input class="us-text-input" id="account-transport-password" name="password" type="password" autocomplete="current-password" required>' +
    '<div class="settings-form-actions"><button class="settings-btn-sm">Save connection settings</button></div></form><p class="settings-hint" role="status"></p>';
  anchor.after(section);
  section.querySelectorAll('[name=origin],[name=proxies]').forEach(function (input) { input.oninput = function () {
    // A draft is the form differing from the saved values, so a manual revert clears it.
    var saved = store.get('accountTransport') || {};
    var origin = section.querySelector('[name=origin]').value.trim();
    var proxies = section.querySelector('[name=proxies]').value.split(/\s+/).filter(Boolean);
    var dirty = origin !== (saved.origin || '') || proxies.join('\n') !== (saved.trustedProxies || []).join('\n');
    var state = Object.assign({}, saved, { dirty: dirty, error: '' });
    if (dirty) setSettingsDraft('accountTransport', true); else clearSettingsDraft('accountTransport');
    store.set({ accountTransport: state }); render(state);
  }; });
  section.querySelector('form').onsubmit = async function (event) {
    event.preventDefault(); var password = section.querySelector('[name=password]');
    var state = Object.assign({}, store.get('accountTransport'), { pending: true, error: '' }); store.set({ accountTransport: state }); render(state);
    try {
      var response = await fetch('/api/account-transport', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        origin: section.querySelector('[name=origin]').value.trim(), trustedProxies: section.querySelector('[name=proxies]').value.split(/\s+/).filter(Boolean), currentPassword: password.value,
      }) });
      var data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save connection settings.');
      state = Object.assign({}, data, { available: true }); clearSettingsDraft('accountTransport');
    } catch (error) { state.error = error.message; state.pending = false; }
    finally { password.value = ''; store.set({ accountTransport: state }); render(state); }
  };
}
