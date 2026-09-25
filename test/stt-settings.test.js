var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var pathToFileURL = require('url').pathToFileURL;

test('a stale settings load cannot overwrite a newer model selection', async function () {
  var originalFetch = global.fetch; var originalWindow = global.window;
  var storeApi = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/store.js')).href);
  var api = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-settings.js')).href);
  var pending;
  global.window = { top: { document: new EventTarget(), Event: Event } };
  global.fetch = async function (url, options) {
    if (!options) return new Promise(function (resolve) { pending = resolve; });
    return { ok: true, json: async function () { return { selected: 'groq-turbo', configured: ['groq'], models: [] }; } };
  };
  try {
    storeApi.createStore({ speechSettings: { selected: 'browser' } });
    var loading = api.loadSpeechSettings();
    await api.saveSpeechSettings({ selected: 'groq-turbo' });
    pending({ ok: true, json: async function () { return { selected: 'browser', configured: [], models: [] }; } });
    await loading;
    assert.equal(storeApi.store.get('speechSettings').selected, 'groq-turbo');
    assert.equal(storeApi.store.get('speechSettingsSaving'), false);
  } finally { global.fetch = originalFetch; global.window = originalWindow; }
});

test('voice language defaults to English independently of legacy profile state', async function () {
  var originalFetch = global.fetch;
  var storeApi = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/store.js')).href);
  var api = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-settings.js')).href);
  var language;
  global.fetch = async function () { return { ok: true, json: async function () { return { selected: 'browser', language: language, models: [], configured: [] }; } }; };
  try {
    storeApi.createStore({ speechLang: 'ko-KR' });
    await api.loadSpeechSettings();
    assert.equal(storeApi.store.get('speechLang'), 'en-US');
    language = 'fr-FR';
    await api.loadSpeechSettings();
    assert.equal(storeApi.store.get('speechLang'), 'fr-FR');
  } finally { global.fetch = originalFetch; }
});
