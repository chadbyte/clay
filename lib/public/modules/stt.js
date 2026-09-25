// Shared voice controls for project, DM and Home composers.
import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { initSpeechLifecycle, speechConstructor, setSpeechStatus, startSTT, stopSTT } from './stt-controller.js';
export { stopSTT } from './stt-controller.js';

var LANGUAGES = [
  ['en-US', 'English'], ['ko-KR', 'Korean'], ['ja-JP', 'Japanese'],
  ['zh-CN', 'Chinese'], ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German']
];

export function setSTTLang(code) {
  if (typeof code !== 'string' || !code) return;
  if (store.get('speechLang') !== code) stopSTT();
  store.set({ speechLang: code });
}
export function getSTTLang() { return store.get('speechLang') || 'en-US'; }
export function isSTTRecording() { return !!store.get('speechActive'); }
export function isSTTInitializing() {
  var active = store.get('speechActive');
  return !!active && !active.started;
}

async function saveLanguage(code, id) {
  if (store.get('speechLanguageSaving')) return;
  stopSTT();
  store.set({ speechLanguageSaving: true });
  try {
    // The profile PUT replaces the standalone profile, so preserve its other fields.
    var response = await fetch('/api/profile');
    if (!response.ok) throw new Error('Profile unavailable');
    var profile = await response.json();
    profile.lang = code;
    response = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
    if (!response.ok) throw new Error('Profile save failed');
    setSTTLang(code);
    window.dispatchEvent(new CustomEvent('clay:speech-language-saved', { detail: code }));
    setSpeechStatus(id, 'Voice language saved. Select the microphone to start.');
  } catch (error) {
    setSpeechStatus(id, 'Could not save voice language. Please try again.');
  } finally { store.set({ speechLanguageSaving: false }); }
}

function bindComposer(id, inputId, wrapperId) {
  var button = document.getElementById(id);
  var input = document.getElementById(inputId);
  var wrapper = document.getElementById(wrapperId);
  if (!button || !input || !wrapper || button.dataset.speechBound) return;
  button.dataset.speechBound = 'true';
  button.classList.add('stt-button');
  var group = document.createElement('span');
  group.className = 'stt-controls';
  button.before(group);
  group.appendChild(button);
  var select = document.createElement('select');
  select.id = id + '-language';
  select.className = 'stt-language';
  select.setAttribute('aria-label', 'Voice input language');
  select.title = 'Voice input language';
  LANGUAGES.forEach(function (language) {
    var option = document.createElement('option');
    option.value = language[0]; option.textContent = language[1]; select.appendChild(option);
  });
  group.appendChild(select);
  var status = document.createElement('div');
  status.id = id + '-status'; status.className = 'stt-status'; status.setAttribute('role', 'status');
  var privacy = document.createElement('div');
  privacy.id = id + '-privacy'; privacy.className = 'stt-privacy';
  privacy.textContent = 'Voice input may send audio to your browser’s recognition service. Text stays in your draft until you send it.';
  var details = document.createElement('details');
  details.className = 'stt-help';
  var summary = document.createElement('summary'); summary.textContent = 'About voice input';
  details.appendChild(summary); details.appendChild(privacy);
  wrapper.appendChild(status); wrapper.appendChild(details);
  button.setAttribute('aria-describedby', status.id + ' ' + privacy.id);
  button.title = 'Voice input — your browser may process audio remotely';
  button.addEventListener('click', function () {
    var active = store.get('speechActive');
    if (active && active.id === id) stopSTT();
    else startSTT(id, input);
  });
  select.addEventListener('change', function () { saveLanguage(select.value, id); });
  input.addEventListener('beforeinput', function () {
    var active = store.get('speechActive');
    if (active && active.id === id) stopSTT('Voice input stopped so you can edit your draft.');
  });
  input.addEventListener('input', function () {
    var active = store.get('speechActive');
    if (active && active.id === id && !active.writing) stopSTT();
  });
  function render() {
    var active = store.get('speechActive');
    var listening = !!active && active.id === id;
    button.disabled = input.disabled || input.readOnly;
    button.classList.toggle('stt-active', listening);
    button.setAttribute('aria-pressed', String(listening));
    button.setAttribute('aria-label', listening ? 'Stop voice input' : 'Start voice input');
    var label = listening ? 'square' : 'mic';
    if (button.dataset.speechIcon !== label) {
      button.dataset.speechIcon = label; button.innerHTML = iconHtml(label); refreshIcons();
    }
    select.value = getSTTLang();
    select.disabled = input.disabled || input.readOnly || !!store.get('speechLanguageSaving');
    var message = (store.get('speechStatuses') || {})[id] || '';
    if (!speechConstructor()) message = 'Voice input is unavailable in this browser. You can still type your message.';
    else if (!window.isSecureContext) message = 'Voice input requires a secure HTTPS connection.';
    status.textContent = message;
    status.hidden = !message;
  }
  store.subscribe(render);
  var availabilityObserver = new MutationObserver(render);
  availabilityObserver.observe(input, { attributes: true, attributeFilter: ["disabled", "readonly"] });
  render();
}

export function initSTT() {
  initSpeechLifecycle();
  bindComposer('stt-btn', 'input', 'input-wrapper');
  bindComposer('home-stt-btn', 'home-mate-chat-input', 'home-mate-chat-composer-frame');
}
