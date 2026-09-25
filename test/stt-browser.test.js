var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var pathToFileURL = require('node:url').pathToFileURL;

function load() { return import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-browser.js')).href); }
function browser(ua, brands, palette) {
  return { navigator: { userAgent: ua, userAgentData: { brands: (brands || []).map(function (brand) { return { brand: brand }; }) } },
    isSecureContext: true, SpeechRecognition: function () {}, document: { documentElement: {} },
    getComputedStyle: function () { return { getPropertyValue: function () { return palette || ''; } }; } };
}

test('Arc identity is presentation-only and does not block an exposed speech API', async function () {
  var api = await load();
  var win = browser('Chrome/130 Safari/537', ['Chromium', 'Google Chrome'], '#fff');
  assert.equal(api.browserSpeechInfo(win).id, 'arc');
  assert.equal(api.browserSpeechInfo(win).available, true);
  assert.equal(api.browserSpeechInfo(win).reason, '');
  assert.equal(api.browserSpeechInfo(browser('Arc/1 Chrome/130')).available, true);
  assert.equal(api.browserSpeechInfo(browser('Chrome/130', ['Arc'])).id, 'arc');
  var late = browser('Chrome/130');
  assert.equal(api.browserSpeechInfo(late).id, 'chrome');
  late.getComputedStyle = win.getComputedStyle;
  assert.equal(api.browserSpeechInfo(late).id, 'arc', 'late palette is re-evaluated');
});

test('browser identity handles Chromium variants, Safari, Firefox and unknown clients', async function () {
  var api = await load();
  [['Chrome/130 Safari/537 Edg/130', 'edge'], ['Chrome/130 OPR/100', 'opera'],
    ['Version/18 Safari/600', 'safari'], ['Firefox/130', 'firefox'], ['CriOS/130 Safari/600', 'chrome'],
    ['Chromium/130', 'chromium'], ['', 'browser']].forEach(function (entry) {
    assert.equal(api.browserSpeechInfo(browser(entry[0])).id, entry[1]);
  });
  assert.equal(api.browserSpeechInfo(browser('Chrome/130', ['Brave'])).id, 'brave');
  var win = browser('Chrome/130');
  delete win.SpeechRecognition;
  assert.equal(api.browserSpeechInfo(win).available, false);
  win.webkitSpeechRecognition = function () {};
  assert.equal(api.browserSpeechInfo(win).available, true);
  win.isSecureContext = false;
  assert.match(api.browserSpeechInfo(win).reason, /HTTPS/);
});

test('Browser speech precedes OpenAI while preserving the remaining catalog order', async function () {
  var api = await load();
  var models = [{ provider: 'soniox' }, { provider: 'openai' }, { provider: 'browser' }, { provider: 'deepgram' }];
  assert.deepEqual(models.slice().sort(api.compareSpeechModels).map(function (model) { return model.provider; }),
    ['browser', 'openai', 'soniox', 'deepgram']);
  assert.equal(models[0].provider, 'soniox');
});

test('a saved browser selection cannot start recognition when the API is absent', async function () {
  var originalWindow = global.window; var originalDocument = global.document;
  var storeApi = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/store.js')).href);
  var controller = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-controller.js')).href);
  try {
    var starts = 0;
    global.window = browser('Chrome/130', [], '#fff');
    delete global.window.SpeechRecognition;
    global.document = { hidden: false };
    storeApi.createStore({});
    controller.startSTT('test', { isConnected: true, closest: function () { return null; }, getClientRects: function () { return [1]; } });
    assert.equal(starts, 0);
    assert.match(storeApi.store.get('speechErrors').test.message, /unavailable here/);
  } finally { global.window = originalWindow; global.document = originalDocument; }
});
