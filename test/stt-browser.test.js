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

test('voice controls cache the CSS identity probe across unrelated store updates and refresh on interaction', { timeout: 30000 }, async function () {
  var childProcess = require('node:child_process');
  var playwright = require('playwright');
  var server = childProcess.spawn(process.execPath, [path.join(__dirname, 'fixtures/history-replay-browser-server.js')]);
  var browser;
  try {
    var origin = await new Promise(function (resolve, reject) {
      server.once('error', reject);
      server.stdout.once('data', function (data) { resolve(String(data).trim()); });
    });
    browser = await playwright.chromium.launch();
    var page = await browser.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', function (error) { console.error('Voice fixture error: ' + error.message); });
    await page.addInitScript({ path: require.resolve('marked/marked.min.js') });
    await page.addInitScript(function () {
      window.lucide = { createIcons: function () {} };
      window.mermaid = { initialize: function () {} };
    });
    // The fixture disables sockets; block all non-fixture transport as well.
    await page.route('**/*', function (route) {
      return route.request().url().startsWith(origin + '/') ? route.continue() : route.abort();
    });
    await page.goto(origin);
    await page.waitForFunction('window.fixtureReady === true');
    var result = await page.evaluate(async function () {
      var store = (await import('/modules/store.js')).store;
      var probes = 0; var palette = '';
      var original = window.getComputedStyle;
      window.getComputedStyle = function (element, pseudo) {
        var style = original.call(window, element, pseudo);
        if (element !== document.documentElement) return style;
        return new Proxy(style, { get: function (target, key) {
          if (key === 'getPropertyValue') return function (name) {
            if (name === '--arc-palette-background') { probes++; return palette; }
            return target.getPropertyValue(name);
          };
          var value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      };
      store.set({ speechSettings: { selected: 'browser', models: [{ id: 'browser', provider: 'browser', name: 'Browser speech', mode: 'live' }], providers: [], configured: [] } });
      for (var i = 0; i < 100; i++) store.set({ currentFullText: 'Transcript update ' + i });
      var unrelated = probes;
      palette = '#abcdef'; window.dispatchEvent(new Event('focus'));
      var focused = { probes: probes, id: store.get('speechBrowserIdentity').id };
      palette = ''; document.getElementById('stt-btn-picker').click();
      var picked = { probes: probes, id: store.get('speechBrowserIdentity').id };
      (await import('/modules/stt-picker.js')).closeSpeechPicker(true);
      palette = '#abcdef';
      // A missing recognition API must remain a live capability failure, without microphone access.
      window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
      document.getElementById('stt-btn').click();
      var started = { probes: probes, id: store.get('speechBrowserIdentity').id, active: !!store.get('speechActive'), unavailable: !!document.getElementById('stt-browser-unavailable') };
      (await import('/modules/stt-picker.js')).closeSpeechPicker(true);
      return { unrelated: unrelated, focused: focused, picked: picked, started: started };
    });
    assert.equal(result.unrelated, 0, 'transcript/store updates never probe browser CSS');
    assert.ok(result.focused.probes > 0, 'focus explicitly refreshes identity');
    assert.equal(result.focused.id, 'arc');
    assert.ok(result.picked.probes > result.focused.probes, 'picker explicitly refreshes identity');
    assert.notEqual(result.picked.id, 'arc', 'removed Arc palette is observed');
    assert.ok(result.started.probes > result.picked.probes, 'start explicitly refreshes identity');
    assert.equal(result.started.id, 'arc');
    assert.equal(result.started.active, false);
    assert.equal(result.started.unavailable, true, 'runtime API removal is observed despite cached identity');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
