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
export async function loadSpeechSettings() {
  if (store.get('speechSettingsSaving')) return;
  var request = (store.get('speechSettingsRequest') || 0) + 1;
  store.set({ speechSettingsRequest: request });
  try {
    var response = await fetch('/api/speech/settings');
    if (!response.ok) throw new Error('Voice settings unavailable. Please try again.');
    var settings = await response.json();
    if (store.get('speechSettingsRequest') !== request) return;
    var previous = store.get('speechSettings');
    if ((previous && JSON.stringify(previous) !== JSON.stringify(settings)) ||
        (!previous && settings.selected !== 'browser')) stopSTT();
    if (!previous || JSON.stringify(previous) !== JSON.stringify(settings)) store.set({ speechSettings: settings, speechLang: settings.language || 'en-US', speechSettingsError: '' });
    else if (store.get('speechSettingsError')) store.set({ speechSettingsError: '' });
  } catch (error) { if (store.get('speechSettingsRequest') === request) store.set({ speechSettingsError: 'Voice settings unavailable. Please try again.' }); }
}
export async function saveSpeechSettings(change) {
  if (store.get('speechSettingsSaving')) throw new Error('Voice settings are being saved. Please wait.');
  stopSTT();
  store.set({ speechRetry: null, speechSettingsSaving: true, speechSettingsRequest: (store.get('speechSettingsRequest') || 0) + 1 });
  try {
    var response = await fetch('/api/speech/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save voice settings.');
    store.set({ speechSettings: result, speechLang: result.language || 'en-US', speechSettingsError: '' });
  } finally { store.set({ speechSettingsSaving: false }); }
  try { window.top.document.dispatchEvent(new window.top.Event('clay:speech-settings-saved')); } catch (error) { /* Standalone host. */ }
}
export async function saveSpeechLanguage(code) {
  await saveSpeechSettings({ language: code });
  window.dispatchEvent(new CustomEvent('clay:speech-language-saved', { detail: code }));
}
