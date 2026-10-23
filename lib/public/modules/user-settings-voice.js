import { store } from './store.js';
import { saveSpeechSettings, loadSpeechSettings } from './stt-settings.js';
import { confirmSettingsAction } from './server-settings-state.js';

export function initPersonalVoice() {
  var root = document.getElementById('us-voice-settings'); if (!root) return;
  root.innerHTML = '<p class="settings-hint">Audio transcription: convert microphone audio into text for voice input. Choose the model, mode and language in the microphone menu. Browser speech needs no API key.</p><h4>Your connections</h4><div id="us-api-connections"></div><p id="us-api-empty" class="settings-hint">No API connections yet. Choose a provider below to add an audio transcription key.</p><section class="us-integration-catalog"><h4>Available providers</h4><div class="us-integration-tiles"></div></section><div id="us-api-setup"></div><div id="us-voice-connection" hidden><form id="us-voice-key-form"><label class="settings-label" for="us-voice-key">API key</label><input id="us-voice-key" class="us-text-input" type="password" autocomplete="off" spellcheck="false" maxlength="4096"><p id="us-voice-key-help" class="settings-hint"></p><p id="us-voice-privacy" class="settings-hint"></p><div class="settings-form-actions"><button type="submit" class="settings-btn-sm">Save connection</button><button type="button" id="us-voice-key-cancel" class="settings-btn-sm">Cancel</button><button type="button" id="us-voice-remove" class="settings-btn-sm">Remove saved key</button><a id="us-voice-get-key" target="_blank" rel="noopener noreferrer">Get API key ↗</a></div></form></div><p class="settings-status" role="status" aria-live="polite" id="us-voice-status"></p><button type="button" class="settings-btn-sm" id="us-voice-retry" hidden>Reload providers</button>';
  var list = root.querySelector('#us-api-connections'), tiles = root.querySelector('.us-integration-tiles');
  var editor = root.querySelector('#us-voice-connection'), form = root.querySelector('form');
  var key = form.querySelector('input'), status = root.querySelector('[role=status]');
  var remove = root.querySelector('#us-voice-remove'), retry = root.querySelector('#us-voice-retry');
  function sync() {
    var settings = store.get('speechSettings'), busy = !!store.get('speechSettingsSaving');
    root.appendChild(editor); retry.before(status); list.replaceChildren(); tiles.replaceChildren();
    if (settings) {
      root.querySelector('#us-api-empty').hidden = !!settings.configured.length;
      settings.providers.forEach(function (provider) {
        var connected = settings.configured.indexOf(provider.id) >= 0;
        var row = document.createElement('div'); row.className = 'us-voice-row'; row.dataset.voiceProvider = provider.id;
        var controls = document.createElement('div'); controls.className = 'us-voice-row-controls';
        var image = document.createElement('img'); image.className = 'us-voice-provider-logo'; image.src = provider.icon; image.alt = '';
        var copy = document.createElement('div'); copy.className = 'us-voice-provider-copy';
        var name = document.createElement('strong'); name.textContent = provider.name; copy.appendChild(name);
        var button = document.createElement('button'); button.type = 'button'; button.className = connected ? 'settings-btn-sm' : 'us-integration-tile'; button.dataset.voiceKey = provider.id;
        button.setAttribute('aria-label', (connected ? 'Manage ' : 'Add ') + provider.name + ' API key');
        button.setAttribute('aria-controls','us-voice-connection'); button.setAttribute('aria-expanded',String(store.get('userVoiceKeyProvider') === provider.id)); button.disabled = busy;
        button.onclick = function () { discardThen(function () { key.value = ''; store.set({userVoiceKeyProvider:provider.id,userVoiceDirty:false}); status.textContent = ''; sync(); key.focus(); }); };
        if (connected) {
          var purpose = document.createElement('small'); purpose.textContent = 'Audio transcription'; copy.appendChild(purpose);
          var saved = document.createElement('span'); saved.className = 'us-integration-state'; saved.textContent = 'Key saved'; button.textContent = 'Manage';
          controls.append(image,copy,saved,button); row.appendChild(controls); list.appendChild(row);
        } else {
          var title = document.createElement('span'); title.textContent = provider.name; button.append(image,title); tiles.appendChild(button);
        }
      });
      var provider = settings.providers.find(function (item) { return item.id === store.get('userVoiceKeyProvider'); });
      editor.hidden = !provider;
      if (provider) {
        var connected = settings.configured.indexOf(provider.id) >= 0;
        var row = Array.from(list.children).find(function (item) { return item.dataset.voiceProvider === provider.id; });
        (row || root.querySelector('#us-api-setup')).appendChild(editor); editor.appendChild(status);
        form.querySelector('label').textContent = provider.name + ' API key';
        key.required = !connected; key.placeholder = connected ? '•••••••• — saved key' : 'Enter API key'; remove.hidden = !connected;
        root.querySelector('#us-voice-key-help').textContent = connected ? 'Leave blank to keep the saved key. Key saved does not verify provider access.' : 'Enter an API key for audio transcription. Saving does not verify provider access.';
        root.querySelector('#us-voice-privacy').textContent = 'Stored privately on your Clay Studio server for your account and shared by all ' + provider.name + ' voice models. Audio is sent to ' + provider.name + '; usage is billed to your provider account.';
        root.querySelector('#us-voice-get-key').href = provider.url;
      }
    } else { list.textContent = store.get('speechSettingsError') ? 'Provider collection unavailable.' : 'Loading providers…'; root.querySelector('#us-api-empty').hidden = true; editor.hidden = true; }
    editor.querySelectorAll('input,button').forEach(function (control) { control.disabled = busy || !settings; });
    retry.hidden = !store.get('speechSettingsError'); retry.disabled = busy;
    if (store.get('speechSettingsError')) { status.textContent = store.get('speechSettingsError'); status.dataset.state = 'error'; status.dataset.loadError = 'true'; }
    else if (status.dataset.loadError) { status.textContent = ''; status.dataset.state = ''; delete status.dataset.loadError; }
  }
  function discardThen(action) {
    if (!key.value) { action(); return; }
    confirmSettingsAction('Discard the unsaved audio transcription API key?', 'Discard', function () { key.value = ''; store.set({userVoiceDirty:false}); action(); });
  }
  function closeEditor() {
    var id = store.get('userVoiceKeyProvider'); key.value = ''; store.set({userVoiceKeyProvider:null,userVoiceDirty:false}); sync();
    var button = root.querySelector('[data-voice-key="' + id + '"]'); if (button) button.focus();
  }
  async function save(value) {
    var provider = store.get('userVoiceKeyProvider'); if (!provider || store.get('speechSettingsSaving')) return;
    var actor = store.get('myUserId'), generation = store.get('speechSettingsContextGeneration');
    var configured = (store.get('speechSettings') || {}).configured || [];
    if (value === '' && configured.indexOf(provider) >= 0) { closeEditor(); status.textContent = 'No key changes. Your voice model and language are unchanged.'; return; }
    status.textContent = 'Saving…'; status.dataset.state = '';
    try {
      await saveSpeechSettings({provider:provider,key:value});
      if (actor !== store.get('myUserId') || generation !== store.get('speechSettingsContextGeneration')) return;
      closeEditor(); status.textContent = value === null ? 'Key removed. Reconnect this provider before using its voice models.' : 'Key saved. Your voice model and language are unchanged.';
    } catch (error) { if (actor === store.get('myUserId') && generation === store.get('speechSettingsContextGeneration')) { status.textContent = error.message; status.dataset.state = 'error'; sync(); } }
  }
  key.oninput = function () { store.set({userVoiceDirty:!!key.value}); };
  form.onsubmit = function (event) { event.preventDefault(); save(key.value); };
  root.querySelector('#us-voice-key-cancel').onclick = function () { discardThen(function () { closeEditor(); status.textContent = ''; }); };
  remove.onclick = function () { confirmSettingsAction('Remove this provider’s saved audio transcription key? Models using it will require reconnection.', 'Remove key', function () { save(null); }); };
  retry.onclick = loadSpeechSettings;
  store.subscribe(function (state, previous) {
    if (state.speechSettingsContextGeneration !== previous.speechSettingsContextGeneration) { key.value = ''; status.textContent = ''; store.set({userVoiceKeyProvider:null,userVoiceDirty:false}); }
    if (state.speechSettings !== previous.speechSettings || state.speechSettingsSaving !== previous.speechSettingsSaving || state.speechSettingsError !== previous.speechSettingsError || state.speechSettingsContextGeneration !== previous.speechSettingsContextGeneration) sync();
  });
  sync();
}
