var test = require('node:test');
var assert = require('node:assert/strict');
var pathToFileURL = require('node:url').pathToFileURL;
var path = require('node:path');

test('voice input guards draft ownership, edits, errors and late callbacks', async function () {
  var previous = { window: global.window, document: global.document, MutationObserver: global.MutationObserver };
  var doc = new EventTarget(); doc.hidden = false; doc.body = {};
  var win = new EventTarget(); win.document = doc; win.top = win; win.Event = Event; win.isSecureContext = true;
  var instances = [];
  function Recognition() { instances.push(this); this.starts = 0; this.aborts = 0; }
  Recognition.prototype.start = function () { this.starts++; this.onstart(); };
  Recognition.prototype.abort = function () { this.aborts++; if (this.onend) this.onend(); };
  win.SpeechRecognition = Recognition;
  win.navigator = { userAgent: 'Arc/1 Chrome/130' };
  global.window = win; global.document = doc;
  var mutation;
  global.MutationObserver = function (callback) { mutation = callback; this.observe = function () {}; };
  var storeModule = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/store.js')).href);
  var api = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-controller.js')).href);
  var store = storeModule.store;
  function input(text) {
    var element = new EventTarget(); element.value = text; element.isConnected = true;
    element.closest = function () { return null; }; element.getClientRects = function () { return [1]; };
    return element;
  }
  function result(recognition, text) { recognition.onresult({ results: [[{ transcript: text }]] }); }
  try {
    storeModule.createStore({ activeSessionId: 1, speechLang: 'ko-KR' });
    api.initSpeechLifecycle();
    var project = input('Existing draft'); var home = input('Home draft'); var events = 0;
    project.addEventListener('input', function () { events++; });
    api.startSTT('project', project);
    var first = instances[0]; assert.equal(first.lang, 'ko-KR');
    result(first, 'hello'); assert.equal(project.value, 'Existing draft hello'); assert.equal(events, 1);
    result(first, 'hello world'); assert.equal(project.value, 'Existing draft hello world');
    project.value = 'My manual edit'; result(first, 'late');
    assert.equal(project.value, 'My manual edit'); assert.equal(store.get('speechActive'), null);
    assert.equal(first.starts, 1);

    api.startSTT('project', project); var second = instances[1];
    store.set({ activeSessionId: 2 }); result(second, 'wrong session');
    assert.equal(project.value, 'My manual edit'); assert.equal(store.get('speechActive'), null);

    api.startSTT('project', project); var third = instances[2];
    api.startSTT('home', home); var fourth = instances[3];
    assert.equal(third.aborts, 1); result(third, 'old'); result(fourth, 'new');
    assert.equal(home.value, 'Home draft new'); assert.equal(project.value, 'My manual edit');
    api.stopSTT(); home.value = ''; result(fourth, 'after send'); fourth.onend();
    assert.equal(home.value, ''); assert.equal(fourth.starts, 1);

    api.startSTT('home', home); var fifth = instances[4];
    fifth.onerror({ error: 'not-allowed' });
    assert.match(store.get('speechStatuses').home, /denied/); assert.equal(store.get('speechActive'), null);
    api.startSTT('home', home); var sixth = instances[5];
    sixth.onerror({ error: 'network' }); assert.match(store.get('speechStatuses').home, /could not be reached/);
    api.startSTT('home', home); home.disabled = true; mutation();
    assert.equal(store.get('speechActive'), null); home.disabled = false;
    api.startSTT('home', home); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(store.get('speechActive'), null); doc.hidden = false;
    api.startSTT('home', home); var last = instances[instances.length - 1]; last.onend();
    assert.equal(last.starts, 1); assert.equal(store.get('speechActive'), null);
    api.startSTT('project', project);
    home.matches = function () { return true; };
    var focus = new Event('focusin'); Object.defineProperty(focus, 'target', { value: home });
    doc.dispatchEvent(focus); assert.equal(store.get('speechActive'), null, 'focusing another composer stops recording');
    win.SpeechRecognition = null; api.startSTT('home', home);
    assert.match(store.get('speechStatuses').home, /unavailable/);
    win.SpeechRecognition = Recognition; win.isSecureContext = false; api.startSTT('home', home);
    assert.match(store.get('speechStatuses').home, /HTTPS/);
    win.isSecureContext = true; Recognition.prototype.start = function () { throw new Error('failed'); };
    api.startSTT('home', home); assert.equal(store.get('speechActive'), null);
    assert.match(store.get('speechStatuses').home, /could not start/);
  } finally {
    api.stopSTT(); global.window = previous.window; global.document = previous.document;
    global.MutationObserver = previous.MutationObserver;
  }
});
