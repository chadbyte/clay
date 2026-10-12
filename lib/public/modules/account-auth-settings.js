import { store } from './store.js';
import { enhanceSettingsSelects } from './settings-select.js';
import { confirmSettingsAction, setSettingsDraft, clearSettingsDraft } from './server-settings-state.js';
import { initPasskeyServerSettings, loadPasskeyServerSettings } from './passkey-server-settings.js';
import { initAccountTransportSettings, loadAccountTransportSettings } from './account-transport-settings.js';

function render(state) {
  var section = document.getElementById('account-auth-policy');
  if (!section) return;
  var select = section.querySelector('select');
  var save = section.querySelector('[data-policy-save]');
  section.hidden = state.available === false;
  select.value = state.draft || state.method || 'pin';
  select.disabled = !!state.pending || state.method === 'password' || !state.method;
  select.dispatchEvent(new Event('settings-sync'));
  save.hidden = !state.method || state.method === select.value;
  save.disabled = !!state.pending;
  section.querySelector('[role=status]').textContent = state.error || (state.pending ? 'Saving…' : state.method === 'password' ? 'Password required. Existing account PINs only authorize password setup.' : 'Existing users verify their account PIN once, then set a password before continuing.');
}

export async function loadAccountAuthSettings() {
  loadPasskeyServerSettings();
  var section = document.getElementById('account-auth-policy');
  if (!section) return;
  if ((store.get('accountAuthPolicy') || {}).draft) return;
  try {
    var response = await fetch('/api/account-auth-policy');
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load account policy.');
    store.set({ accountAuthPolicy: data }); render(data); loadAccountTransportSettings();
  } catch (error) {
    var state = Object.assign({}, store.get('accountAuthPolicy'), { error: error.message });
    store.set({ accountAuthPolicy: state }); render(state);
  }
}

export function initAccountAuthSettings() {
  var page = document.querySelector('.server-settings-section[data-section="security"]');
  if (!page || document.getElementById('account-auth-policy')) return;
  var section = document.createElement('section'); section.id = 'account-auth-policy';
  section.className = 'settings-card';
  section.innerHTML = '<h3>Account sign-in</h3><div class="settings-field-row"><div><label class="settings-label" for="account-auth-method">Authentication method</label><p class="settings-hint">Applies to all accounts on this server. Users manage their own credentials in Personal settings.</p></div><select class="settings-select" id="account-auth-method" disabled><option value="pin">Account PIN</option><option value="password">Password / passphrase</option></select></div><p class="settings-hint" role="status">Loading account policy…</p><div class="settings-form-actions"><button class="settings-btn-sm" data-policy-save hidden>Apply password policy</button></div>';
  var description = page.querySelector('.settings-page-description');
  description.textContent = 'Sign-in policies and connection security for this server. Manage your own password, passkeys and devices in Personal settings → Account.';
  description.after(section);
  var select = section.querySelector('select');
  select.onchange = function () {
    var state = Object.assign({}, store.get('accountAuthPolicy'), { draft: select.value, error: '' });
    if (state.draft === state.method) { delete state.draft; clearSettingsDraft('accountAuth'); }
    else setSettingsDraft('accountAuth', true);
    store.set({ accountAuthPolicy: state }); render(state);
  };
  section.querySelector('[data-policy-save]').onclick = function () {
    confirmSettingsAction('Require passwords for account users? Everyone using an account, including you, must verify their account PIN and set a password before continuing. Existing PINs remain valid for setup until each password is saved. This change does not alter solo access or the Server PIN.', 'Require passwords', async function () {
      var state = Object.assign({}, store.get('accountAuthPolicy'), { pending: true, error: '' });
      store.set({ accountAuthPolicy: state }); render(state);
      try {
        var response = await fetch('/api/account-auth-policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'password' }) });
        var data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || 'Could not save the policy.');
        clearSettingsDraft('accountAuth'); window.location.reload();
      } catch (error) {
        state.pending = false; state.error = error.message;
        store.set({ accountAuthPolicy: state }); render(state);
      }
    });
  };
  enhanceSettingsSelects(section);
  initPasskeyServerSettings();
  initAccountTransportSettings();
}
