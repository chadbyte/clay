import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { stopSTT } from './stt-controller.js';
export var speechLanguages = [
  ['en-US', 'English'], ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'],
  ['pt-BR', 'Portuguese'], ['it-IT', 'Italian'], ['nl-NL', 'Dutch'], ['pl-PL', 'Polish'],
  ['ru-RU', 'Russian'], ['uk-UA', 'Ukrainian'], ['tr-TR', 'Turkish'], ['ar-SA', 'Arabic'],
  ['hi-IN', 'Hindi'], ['id-ID', 'Indonesian'], ['vi-VN', 'Vietnamese'], ['th-TH', 'Thai'],
  ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese']
];
export function voiceModel() {
  var settings = store.get('speechSettings');
  return settings && settings.models.find(function (model) { return model.id === settings.selected; }) ||
    { id: 'browser', provider: 'browser', name: 'Browser speech', mode: 'live' };
}
export function voiceProvider(id) {
  var settings = store.get('speechSettings');
  return settings && settings.providers.find(function (provider) { return provider.id === id; });
}
function context() { return JSON.stringify([store.get('myUserId'), store.get('speechSettingsContextGeneration')]); }
function lostAccess() {
  store.set({speechPopup:null,speechRetry:null,speechSettings:null,speechSettingsSaving:false,speechSettingsError:'Sign in again to manage audio transcription keys.',speechSettingsContextGeneration:(store.get('speechSettingsContextGeneration') || 0)+1,speechSettingsRequest:(store.get('speechSettingsRequest') || 0)+1});
}
export async function loadSpeechSettings() {
  if (store.get('speechSettingsSaving')) return;
  var actor = context(), socket = getWs();
  var request = (store.get('speechSettingsRequest') || 0) + 1;
  store.set({ speechSettingsRequest: request });
  try {
    var response = await fetch('/api/speech/settings');
    if ((response.status === 401 || response.status === 403) && actor === context() && socket === getWs() && store.get('speechSettingsRequest') === request) { lostAccess(); return; }
    if (!response.ok) throw new Error('Voice settings unavailable. Please try again.');
    var settings = await response.json();
    if (actor !== context() || socket !== getWs() || store.get('speechSettingsRequest') !== request) return;
    var previous = store.get('speechSettings');
    if ((previous && JSON.stringify(previous) !== JSON.stringify(settings)) ||
        (!previous && settings.selected !== 'browser')) stopSTT();
    if (!previous || JSON.stringify(previous) !== JSON.stringify(settings)) store.set({ speechSettings: settings, speechLang: settings.language || 'en-US', speechSettingsError: '' });
    else if (store.get('speechSettingsError')) store.set({ speechSettingsError: '' });
  } catch (error) { if (actor === context() && socket === getWs() && store.get('speechSettingsRequest') === request) store.set({ speechSettingsError: 'Voice settings unavailable. Please try again.' }); }
}
export async function saveSpeechSettings(change) {
  if (store.get('speechSettingsSaving')) throw new Error('Voice settings are being saved. Please wait.');
  var actor = context(), socket = getWs(), request = (store.get('speechSettingsRequest') || 0) + 1;
  stopSTT();
  store.set({ speechRetry: null, speechSettingsSaving: true, speechSettingsRequest: request });
  try {
    var response = await fetch('/api/speech/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
    var result = await response.json();
    if (actor !== context() || socket !== getWs() || store.get('speechSettingsRequest') !== request) throw new Error('Account or connection changed. Reopen API connections.');
    if (response.status === 401 || response.status === 403) { lostAccess(); throw new Error('Sign in again to manage audio transcription keys.'); }
    if (!response.ok) throw new Error(result.error || 'Could not save voice settings.');
    store.set({ speechSettings: result, speechLang: result.language || 'en-US', speechSettingsError: '' });
  } finally { if (actor === context() && store.get('speechSettingsRequest') === request) store.set({ speechSettingsSaving: false }); }
  try { window.top.document.dispatchEvent(new window.top.Event('clay:speech-settings-saved')); } catch (error) { /* Standalone host. */ }
}
export async function saveSpeechLanguage(code) {
  await saveSpeechSettings({ language: code });
  window.dispatchEvent(new CustomEvent('clay:speech-language-saved', { detail: code }));
}

store.subscribe(function (state, previous) {
  if (state.myUserId !== previous.myUserId || state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration || state.currentSlug !== previous.currentSlug || state.connected === false && previous.connected !== false) {
    stopSTT();
    store.set({speechPopup:null,speechRetry:null,speechSettings:null,speechSettingsSaving:false,speechSettingsError:state.connected === false ? 'Reconnect before loading audio transcription providers.' : 'Account or connection changed. Reload providers to continue.',speechSettingsContextGeneration:(state.speechSettingsContextGeneration || 0)+1,speechSettingsRequest:(state.speechSettingsRequest || 0)+1});
  }
});
