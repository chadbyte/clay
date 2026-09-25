// Compact shared voice controls for project, DM and Home composers.
import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { initSpeechLifecycle, speechConstructor, setSpeechStatus, startSTT, stopSTT } from './stt-controller.js';
import { startRecording, finishRecording, retryRecording } from './stt-recording.js';
import { voiceModel, voiceProvider, loadSpeechSettings } from './stt-settings.js';
import { openSpeechPicker, initSpeechPicker } from './stt-picker.js';
import { createSpeechMeter } from './stt-meter.js';
import { browserSpeechInfo } from './stt-browser.js';
export { stopSTT } from './stt-controller.js';

export function setSTTLang(code) {
  if (typeof code !== 'string' || !code) return;
  if (store.get('speechLang') !== code) stopSTT();
  store.set({ speechLang: code });
}
export function getSTTLang() { return store.get('speechLang') || 'en-US'; }
export function isSTTRecording() { return !!store.get('speechActive'); }
export function isSTTInitializing() { var active = store.get('speechActive'); return !!active && !active.started; }

function bindComposer(id, inputId, wrapperId) {
  var button = document.getElementById(id);
  var input = document.getElementById(inputId);
  var wrapper = document.getElementById(wrapperId);
  if (!button || !input || !wrapper || button.dataset.speechBound) return;
  var composer = document.getElementById(id === 'stt-btn' ? 'input-row' : 'home-mate-chat-composer') || wrapper;
  var toolbar = document.getElementById(id === 'stt-btn' ? 'input-bottom' : 'home-mate-chat-composer') || composer;
  button.dataset.speechBound = 'true'; button.classList.add('stt-button');
  var group = document.createElement('span'); group.className = 'stt-controls';
  button.before(group); group.appendChild(button);
  var picker = document.createElement('button'); picker.type = 'button'; picker.id = id + '-picker';
  picker.className = 'stt-picker-toggle'; picker.innerHTML = iconHtml('chevron-down');
  picker.setAttribute('aria-label', 'Choose voice model'); picker.setAttribute('aria-haspopup', 'dialog'); picker.setAttribute('aria-expanded', 'false');
  picker.title = 'Choose voice model'; group.appendChild(picker);
  picker.addEventListener('click', function () { openSpeechPicker(picker); });
  var row = document.createElement('div'); row.className = 'stt-progress'; row.hidden = true;
  var status = document.createElement('span'); status.id = id + '-status'; status.className = 'stt-status'; status.setAttribute('role', 'status');
  var timer = document.createElement('span'); timer.className = 'stt-timer'; timer.setAttribute('aria-hidden', 'true');
  var cancel = document.createElement('button'); cancel.type = 'button'; cancel.innerHTML = iconHtml('x');
  cancel.className = 'stt-cancel'; cancel.title = 'Cancel voice input'; cancel.setAttribute('aria-label', 'Cancel voice input');
  cancel.addEventListener('click', function () { stopSTT(); store.set({ speechRetry: null }); });
  var meter = createSpeechMeter(id);
  var retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
  retry.addEventListener('click', retryRecording);
  var account = document.createElement('a'); account.textContent = 'Provider account'; account.target = '_blank'; account.rel = 'noopener noreferrer';
  var dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', function () { setSpeechStatus(id, ''); });
  row.append(cancel, meter.element, timer, status, retry, account, dismiss); composer.prepend(row);
  button.setAttribute('aria-describedby', status.id);
  button.addEventListener('click', function () {
    var active = store.get('speechActive');
    if (active && active.id === id) {
      if (active.model && active.phase === 'recording') finishRecording(); else stopSTT();
      return;
    }
    var model = voiceModel(); var settings = store.get('speechSettings');
    if (model.provider === 'browser' && !browserSpeechInfo().available) { openSpeechPicker(picker); return; }
    if (model.provider !== 'browser' && (!settings || settings.configured.indexOf(model.provider) < 0)) { openSpeechPicker(picker); return; }
    if (model.provider === 'browser') startSTT(id, input); else startRecording(id, input, model);
  });
  input.addEventListener('beforeinput', function () {
    var active = store.get('speechActive');
    if (active && active.id === id) stopSTT('Voice input stopped so you can edit your draft.');
    store.set({ speechRetry: null });
  });
  input.addEventListener('input', function () {
    var active = store.get('speechActive');
    if (active && active.id === id && !active.writing) stopSTT();
  });
  function render() {
    var active = store.get('speechActive'); var own = !!active && active.id === id;
    var model = voiceModel(); var provider = voiceProvider(model.provider);
    var browser = model.provider === 'browser' ? browserSpeechInfo() : null;
    var pending = own && active.model && active.phase !== 'recording';
    composer.classList.toggle('stt-recording', own);
    row.classList.toggle('stt-progress-active', own);
    row.classList.toggle('stt-progress-pending', !!pending);
    var parent = own ? toolbar : composer;
    if (row.parentElement !== parent || row !== parent.firstElementChild) parent.prepend(row);
    meter.update(own ? active : null);
    picker.hidden = own;
    button.disabled = input.disabled || input.readOnly || !store.get('speechSettings');
    picker.disabled = input.disabled || input.readOnly || own;
    button.classList.toggle('stt-active', own);
    button.setAttribute('aria-pressed', String(own));
    var action = own ? (pending ? 'Cancel voice input' : (model.mode === 'recorded' ? 'Stop and transcribe' : 'Stop voice input')) : 'Start voice input';
    button.setAttribute('aria-label', action + ' · ' + (provider ? provider.name + ' · ' : '') + model.name);
    button.title = action + ' · ' + model.name;
    var signature = [own, pending, provider && provider.id, browser && browser.id].join(':');
    if (button.dataset.speechIcon !== signature) {
      button.dataset.speechIcon = signature;
      button.innerHTML = iconHtml(own ? (pending ? 'x' : 'square') : 'mic');
      if (!own && (provider || browser && browser.icon)) {
        var badge = document.createElement('img'); badge.className = 'stt-vendor-badge'; badge.src = provider ? provider.icon : browser.icon; badge.alt = ''; button.appendChild(badge);
      }
      refreshIcons();
    }
    var message = (store.get('speechStatuses') || {})[id] || '';
    var failure = (store.get('speechErrors') || {})[id];
    row.classList.toggle('stt-progress-error', !!failure);
    status.setAttribute('role', failure ? 'alert' : 'status');
    dismiss.hidden = !failure;
    account.hidden = !failure || !provider;
    if (provider) account.href = provider.url;
    if (model.provider === 'browser' && !speechConstructor()) message = 'Browser voice input is unavailable. Choose a connected speech provider or type your message.';
    if (!window.isSecureContext) message = 'Voice input requires a secure HTTPS connection.';
    status.textContent = message;
    timer.textContent = own && active.startTime ? Math.floor((Date.now() - active.startTime) / 60000) + ':' + String(Math.floor((Date.now() - active.startTime) / 1000) % 60).padStart(2, '0') : '';
    cancel.hidden = !own;
    var retryState = store.get('speechRetry'); retry.hidden = !retryState || retryState.id !== id;
    row.hidden = !own && !failure && retry.hidden;
  }
  store.subscribe(render);
  var observer = new MutationObserver(render);
  observer.observe(input, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
  render();
}
export function initSTT() {
  initSpeechLifecycle(); initSpeechPicker();
  bindComposer('stt-btn', 'input', 'input-wrapper');
  bindComposer('home-stt-btn', 'home-mate-chat-input', 'home-mate-chat-composer-frame');
  loadSpeechSettings();
  window.addEventListener('focus', loadSpeechSettings);
  try { window.top.document.addEventListener('clay:speech-settings-saved', loadSpeechSettings); } catch (error) { /* Cross-origin host. */ }
}
