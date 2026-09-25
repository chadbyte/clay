import { store } from './store.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { speechLanguages, voiceModel, loadSpeechSettings, saveSpeechSettings, saveSpeechLanguage } from './stt-settings.js';
import { stopSTT } from './stt-controller.js';

export function closeSpeechPicker() {
  var state = store.get('speechPopup');
  store.set({ speechPopup: null });
  if (state && state.anchor.isConnected) { state.anchor.setAttribute('aria-expanded', 'false'); state.anchor.focus(); }
}
function patch(values) { store.set({ speechPopup: Object.assign({}, store.get('speechPopup'), values) }); }
async function save(change, close) {
  patch({ busy: true, error: '' });
  try { await saveSpeechSettings(change); if (close) closeSpeechPicker(); else if (store.get('speechPopup')) patch({ provider: null, busy: false }); }
  catch (error) { if (store.get('speechPopup')) patch({ busy: false, error: error.message }); }
}
function render() {
  var previous = document.getElementById('speech-picker');
  var focusKey = previous && previous.contains(document.activeElement) && document.activeElement.dataset.focus;
  var keyInput = previous && previous.querySelector('#speech-api-key');
  var unsavedKey = keyInput ? keyInput.value : '';
  var previousProvider = previous && previous.dataset.provider;
  if (previous) previous.remove();
  var state = store.get('speechPopup'); if (!state) return;
  var settings = store.get('speechSettings');
  var popup = document.createElement('div'); popup.id = 'speech-picker'; popup.className = 'stt-picker';
  popup.dataset.provider = state.provider || '';
  popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-modal', 'true'); popup.setAttribute('aria-label', 'Voice input');
  var html = '<div class="stt-picker-heading"><strong>Voice input</strong><button type="button" data-action="close" data-focus="close" aria-label="Close voice input settings">' + iconHtml('x') + '</button></div>';
  html += '<div class="stt-mode-tabs" role="group" aria-label="Transcription mode"><button type="button" data-mode="live" aria-pressed="' + (state.mode === 'live') + '"><strong>Live</strong><span>Text appears as you speak.</span></button><button type="button" data-mode="recorded" aria-pressed="' + (state.mode === 'recorded') + '"><strong>After recording</strong><span>Stop recording to get text.</span></button></div>';
  if (settings) {
    html += '<div class="stt-model-list">';
    settings.models.filter(function (model) { return model.mode === state.mode; }).sort(function (a, b) {
      return Number(b.provider === 'openai') - Number(a.provider === 'openai');
    }).forEach(function (model) {
      var provider = settings.providers.find(function (item) { return item.id === model.provider; });
      var connected = !provider || settings.configured.indexOf(provider.id) >= 0;
      var mark = provider ? '<img src="' + provider.icon + '" alt="">' : '<span class="stt-browser-icon">' + iconHtml('mic') + '</span>';
      var label = provider ? provider.name + ' · ' + model.name : model.name;
      html += '<div class="stt-model-row"><button type="button" class="stt-model" data-model="' + model.id + '" data-focus="' + model.id + '" title="' + escapeHtml(label + ' — ' + model.description) + '" aria-label="' + escapeHtml(label) + '" aria-pressed="' + (model.id === settings.selected) + '">' + mark + '<span>' + escapeHtml(label) + '</span>' + (model.id === settings.selected ? '<span class="stt-model-check">' + iconHtml('check') + '</span>' : '') + '</button>';
      if (provider) html += '<button type="button" class="stt-key-toggle" data-provider="' + provider.id + '" data-focus="key-' + model.id + '" aria-label="' + (connected ? 'Manage ' : 'Connect ') + escapeHtml(provider.name) + ' API key" title="' + escapeHtml(provider.name) + ' API key">' + (connected ? iconHtml('key-round') : 'Connect') + '</button>';
      html += '</div>';
      if (provider && state.provider === provider.id && state.keyModel === model.id) {
        html += '<form class="stt-key-form"><label for="speech-api-key">' + escapeHtml(provider.name) + ' API key</label><input id="speech-api-key" name="key" type="password" autocomplete="off" spellcheck="false" placeholder="Enter API key" required maxlength="4096"><p>Stored privately on your Clay server. Audio is sent to ' + escapeHtml(provider.name) + '; usage is billed to your account.</p><div class="stt-key-actions"><a href="' + escapeHtml(provider.url) + '" target="_blank" rel="noopener noreferrer">Get key ↗</a><button type="button" data-action="remove"' + (!connected ? ' disabled' : '') + '>Remove</button><button type="submit">Save</button></div></form>';
      }
    });
    html += '</div><div class="stt-picker-footer"><label>Language<select aria-label="Voice input language" data-focus="language">';
    speechLanguages.forEach(function (lang) { html += '<option value="' + lang[0] + '"' + (lang[0] === store.get('speechLang') ? ' selected' : '') + '>' + lang[1] + '</option>'; });
    html += '</select></label></div>';
  } else html += '<p>Loading voice models…</p>';
  if (state.error || store.get('speechSettingsError')) html += '<p role="alert" class="stt-picker-error">' + escapeHtml(state.error || store.get('speechSettingsError')) + '</p><button type="button" data-action="reload">Reload settings</button>';
  popup.innerHTML = html;
  document.body.appendChild(popup); refreshIcons();
  if (state.busy) popup.querySelectorAll('button,input,select').forEach(function (el) { if (el.dataset.action !== 'close') el.disabled = true; });
  var bounds = state.anchor.getBoundingClientRect();
  popup.style.left = Math.max(8, Math.min(bounds.right - 324, window.innerWidth - 332)) + 'px';
  popup.style.bottom = Math.max(8, window.innerHeight - bounds.top + 8) + 'px';
  popup.style.maxHeight = Math.max(150, bounds.top - 16) + 'px';
  popup.addEventListener('click', function (event) {
    var button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.mode) patch({ mode: button.dataset.mode, provider: null, keyModel: null });
    else if (button.dataset.provider) {
      var keyModel = button.parentElement.querySelector('[data-model]').dataset.model;
      patch({ provider: state.provider === button.dataset.provider && state.keyModel === keyModel ? null : button.dataset.provider, keyModel: keyModel });
    }
    else if (button.dataset.model) {
      var model = settings.models.find(function (item) { return item.id === button.dataset.model; });
      if (model.provider !== 'browser' && settings.configured.indexOf(model.provider) < 0) patch({ provider: model.provider, keyModel: model.id });
      else save({ selected: model.id }, true);
    } else {
      var action = button.dataset.action;
      if (action === 'close') closeSpeechPicker();
      if (action === 'remove') save({ provider: state.provider, key: null }, false);
      if (action === 'reload') loadSpeechSettings();
    }
  });
  var form = popup.querySelector('form');
  if (form && previousProvider === state.provider) form.elements.key.value = unsavedKey;
  if (form) form.addEventListener('submit', function (event) {
    event.preventDefault(); var key = form.elements.key.value; form.elements.key.value = '';
    save({ provider: state.provider, key: key }, false);
  });
  var select = popup.querySelector('select');
  if (select) select.addEventListener('change', async function () {
    var code = select.value; patch({ busy: true });
    try { await saveSpeechLanguage(code); if (store.get('speechPopup')) patch({ busy: false, error: '' }); }
    catch (error) { if (store.get('speechPopup')) patch({ busy: false, error: error.message }); }
  });
  var focus = Array.from(popup.querySelectorAll('[data-focus]')).find(function (el) { return el.dataset.focus === focusKey && !el.disabled; });
  (form && previousProvider !== state.provider ? form.elements.key : (focus || popup.querySelector('input,button'))).focus();
}
export function openSpeechPicker(anchor) {
  if (store.get('speechPopup')) { closeSpeechPicker(); return; }
  stopSTT();
  anchor.setAttribute('aria-expanded', 'true');
  store.set({ speechPopup: { anchor: anchor, mode: voiceModel().mode, error: '', busy: false } });
  loadSpeechSettings();
}
export function initSpeechPicker() {
  store.subscribe(function (state, prev) {
    if (state.speechPopup !== prev.speechPopup || state.speechSettings !== prev.speechSettings || state.speechSettingsError !== prev.speechSettingsError || state.speechLang !== prev.speechLang) render();
    if (state.currentSlug !== prev.currentSlug || state.activeSessionId !== prev.activeSessionId || state.homeChatSessionId !== prev.homeChatSessionId) {
      if (state.speechPopup) closeSpeechPicker();
    }
  });
  document.addEventListener('pointerdown', function (event) {
    var state = store.get('speechPopup'); var popup = document.getElementById('speech-picker');
    if (state && popup && !popup.contains(event.target) && !state.anchor.contains(event.target)) closeSpeechPicker();
  });
  document.addEventListener('keydown', function (event) {
    if (!store.get('speechPopup')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSpeechPicker(); }
    if (event.key === 'Tab') {
      var popup = document.getElementById('speech-picker');
      var items = popup.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]');
      var first = items[0]; var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  window.addEventListener('resize', function () { if (store.get('speechPopup')) closeSpeechPicker(); });
}
