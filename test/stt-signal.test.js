var test = require('node:test');
var assert = require('node:assert/strict');
var pathToFileURL = require('url').pathToFileURL;
var path = require('path');
function moduleURL(name) { return pathToFileURL(path.join(__dirname, '../lib/public/modules/' + name + '.js')).href; }

test('speech envelope reveals quiet speech, settles to silence and bounds retained history', async function () {
  var store = (await import(moduleURL('store'))).store;
  var sample = (await import(moduleURL('stt-signal'))).sampleSpeechSignal;
  var active = {}; store.set({ speechActive: active });
  var quiet = new Float32Array(1600); quiet.fill(0.01);
  sample(active, quiet, 16000, 1);
  assert.ok(active.audioSignal.envelope > 0.35);
  assert.equal(active.audioSignal.levels.length, 5);
  sample(active, new Float32Array(16000), 16000, 1);
  assert.ok(active.audioSignal.envelope < 0.00001);
  for (var i = 0; i < 100; i++) sample(active, quiet, 16000, 1);
  assert.equal(active.audioSignal.levels.length, 240);
  var old = active.audioSignal.updatedAt; store.set({ speechActive: null });
  sample(active, quiet, 16000, 1); assert.equal(active.audioSignal.updatedAt, old);
});

test('native visual capture releases a microphone granted after cancellation', async function () {
  var store = (await import(moduleURL('store'))).store;
  var start = (await import(moduleURL('stt-signal'))).startBrowserSpeechSignal;
  var originalWindow = global.window; var originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  var grant; var stopped = 0; var closed = 0;
  function Context() {}
  Context.prototype.resume = async function () {};
  Context.prototype.close = async function () { closed++; };
  global.window = { AudioContext: Context };
  Object.defineProperty(global, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: function () { return new Promise(function (resolve) { grant = resolve; }); }
  } } });
  try {
    var active = {}; store.set({ speechActive: active }); start(active);
    store.set({ speechActive: null }); active.visualCapture.abort();
    grant({ getTracks: function () { return [{ stop: function () { stopped++; } }]; } });
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.equal(stopped, 1); assert.equal(closed, 1);
  } finally {
    global.window = originalWindow;
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator); else delete global.navigator;
  }
});
