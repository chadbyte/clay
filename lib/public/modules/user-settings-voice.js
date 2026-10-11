import { store } from './store.js';
import { saveSpeechSettings, loadSpeechSettings } from './stt-settings.js';
import { confirmSettingsAction } from './server-settings-state.js';

export function initPersonalVoice() {
  var root = document.getElementById('us-voice-settings');
  root.innerHTML = '<h3>Voice providers</h3><p class="settings-hint">Manage your personal API keys here. Choose the voice model, transcription mode and language from the microphone menu in the composer. Browser speech needs no API key.</p><div class="us-voice-providers" aria-label="Voice providers"></div><div id="us-voice-connection" hidden><form id="us-voice-key-form"><label class="settings-label" for="us-voice-key">API key</label><input id="us-voice-key" class="us-text-input" type="password" autocomplete="off" spellcheck="false" maxlength="4096" required><p id="us-voice-privacy" class="settings-hint"></p><div class="settings-form-actions"><button type="submit" class="settings-btn-sm">Save key</button><button type="button" id="us-voice-key-cancel" class="settings-btn-sm">Cancel</button><a id="us-voice-get-key" target="_blank" rel="noopener noreferrer">Get API key ↗</a></div></form><button type="button" id="us-voice-remove" class="settings-btn-sm">Remove saved key</button></div><p class="settings-status" role="status" id="us-voice-status"></p><button type="button" class="settings-btn-sm" id="us-voice-retry" hidden>Reload providers</button>';
  var list = root.querySelector('.us-voice-providers'); var editor = root.querySelector('#us-voice-connection');
  var form = root.querySelector('form'); var key = form.querySelector('input'); var status = root.querySelector('[role=status]');
  var remove = root.querySelector('#us-voice-remove'); var retry = root.querySelector('#us-voice-retry');
  function sync() {
    var settings = store.get('speechSettings'); var busy = !!store.get('speechSettingsSaving');
    if (settings) {
      var signature = settings.providers.map(function (provider) { return provider.id; }).join(',');
      if (list.dataset.catalog !== signature) {
        root.appendChild(editor); list.replaceChildren(); list.dataset.catalog = signature;
        settings.providers.forEach(function (provider) {
          var row = document.createElement('div'); row.className = 'us-voice-row'; row.dataset.voiceProvider = provider.id;
          var controls = document.createElement('div'); controls.className = 'us-voice-row-controls';
          var image = document.createElement('img'); image.className = 'us-voice-provider-logo'; image.src = provider.icon; image.alt = '';
          var copy = document.createElement('div'); copy.className = 'us-voice-provider-copy';
          var name = document.createElement('strong'); name.textContent = provider.name;
          var state = document.createElement('small'); state.className = 'us-voice-key-state'; copy.appendChild(name); copy.appendChild(state);
          var button = document.createElement('button'); button.type = 'button'; button.className = 'settings-btn-sm us-voice-key-action'; button.dataset.voiceKey = provider.id;
          button.setAttribute('aria-controls','us-voice-connection');
          button.onclick = function () { discardThen(function () { store.set({userVoiceKeyProvider:provider.id}); status.textContent = ''; sync(); key.focus(); }); };
          controls.appendChild(image); controls.appendChild(copy); controls.appendChild(button); row.appendChild(controls); list.appendChild(row);
        });
      }
      list.querySelectorAll('[data-voice-provider]').forEach(function (row) {
        var id = row.dataset.voiceProvider; var connected = settings.configured.indexOf(id) >= 0; var button = row.querySelector('[data-voice-key]');
        row.querySelector('.us-voice-key-state').textContent = connected ? 'Key saved' : 'Not connected';
        button.textContent = connected ? 'API key' : 'Connect'; button.disabled = busy;
        button.setAttribute('aria-label', (connected ? 'Manage ' : 'Connect ') + row.querySelector('strong').textContent + ' API key');
        button.setAttribute('aria-expanded',String(store.get('userVoiceKeyProvider') === id));
      });
      var provider = settings.providers.find(function (item) { return item.id === store.get('userVoiceKeyProvider'); });
      editor.hidden = !provider;
      if (provider) {
        var connected = settings.configured.indexOf(provider.id) >= 0;
        var row = Array.from(list.children).find(function (item) { return item.dataset.voiceProvider === provider.id; });
        if (editor.parentElement !== row) row.appendChild(editor);
        if (status.parentElement !== editor) editor.appendChild(status);
        form.querySelector('label').textContent = provider.name + ' API key';
        key.placeholder = connected ? 'Enter a replacement key' : 'Enter API key'; remove.hidden = !connected;
        root.querySelector('#us-voice-privacy').textContent = 'Stored privately on your Clay server and shared by all ' + provider.name + ' voice models. Audio is sent to ' + provider.name + '; usage is billed to your account.';
        root.querySelector('#us-voice-get-key').href = provider.url;
      } else { if (editor.parentElement !== root) root.appendChild(editor); retry.before(status); }
    } else list.textContent = 'Loading providers…';
    editor.querySelectorAll('input,button').forEach(function (control) { control.disabled = busy || !settings; });
    retry.hidden = !store.get('speechSettingsError'); retry.disabled = busy;
    if (store.get('speechSettingsError')) { status.textContent = store.get('speechSettingsError'); status.dataset.state = 'error'; }
  }
  function discardThen(action) {
    if (!key.value) { action(); return; }
    confirmSettingsAction('Discard the unsaved voice API key?', 'Discard', function () { key.value = ''; store.set({userVoiceDirty:false}); action(); });
  }
  function closeEditor() {
    var id = store.get('userVoiceKeyProvider'); key.value = ''; store.set({userVoiceKeyProvider:null,userVoiceDirty:false}); sync();
    var button = root.querySelector('[data-voice-key="' + id + '"]'); if (button) button.focus();
  }
  async function save(value) {
    var provider = store.get('userVoiceKeyProvider'); if (!provider) return;
    status.textContent = 'Saving…'; status.dataset.state = '';
    try { await saveSpeechSettings({provider:provider,key:value}); closeEditor(); status.textContent = value === null ? 'Key removed. Reconnect this provider before using its voice models.' : 'Key saved. Your voice model and language are unchanged.'; }
    catch (error) { status.textContent = error.message; status.dataset.state = 'error'; sync(); }
  }
  key.oninput = function () { store.set({userVoiceDirty:!!key.value}); };
  form.onsubmit = function (event) { event.preventDefault(); save(key.value); };
  root.querySelector('#us-voice-key-cancel').onclick = function () { discardThen(function () { closeEditor(); status.textContent = ''; }); };
  remove.onclick = function () { confirmSettingsAction('Remove this provider’s saved voice key? Models using it will require reconnection.', 'Remove key', function () { save(null); }); };
  retry.onclick = loadSpeechSettings;
  store.subscribe(function (state, previous) { if (state.speechSettings !== previous.speechSettings || state.speechSettingsSaving !== previous.speechSettingsSaving || state.speechSettingsError !== previous.speechSettingsError) sync(); });
  sync();
}
