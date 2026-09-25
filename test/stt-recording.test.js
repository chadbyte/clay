var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var pathToFileURL = require('url').pathToFileURL;
var vm = require('vm');
var fs = require('fs');

test('audio worklet downsamples mono PCM accurately and WAV includes the complete payload', async function () {
  var Processor; var outputs = [];
  class Base { constructor() { this.port = { postMessage: function (value) { if (value.pcm) outputs.push(value.pcm); } }; } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/public/modules/stt-audio-worklet.js'), 'utf8'), {
    AudioWorkletProcessor: Base, sampleRate: 48000, registerProcessor: function (name, processor) { Processor = processor; }
  });
  var processor = new Processor(); var source = new Float32Array(48000); source.fill(0.5);
  processor.process([[source]]); processor.flush();
  assert.equal(outputs.reduce(function (size, output) { return size + output.byteLength; }, 0), 32000);
  var audio = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-audio.js')).href);
  var wav = Buffer.from(await audio.wavRecording(outputs).arrayBuffer());
  assert.equal(wav.length, 32044); assert.equal(wav.readUInt32LE(24), 16000); assert.equal(wav.readUInt32LE(40), 32000);
});

test('cloud dictation preserves edits, cancels stale uploads, retries safely and closes microphone tracks', async function () {
  var names = ['window', 'document', 'navigator', 'AudioWorkletNode', 'fetch', 'WebSocket', 'location']; var originals = {};
  names.forEach(function (name) { originals[name] = Object.getOwnPropertyDescriptor(global, name); });
  var ports = []; var stopped = 0; var pending;
  var log = console.log; var trace = console.trace; var diagnostics = [];
  console.log = function (line) { diagnostics.push(line); }; console.trace = function () {};
  var win = new EventTarget(); win.document = new EventTarget(); win.top = win; win.Event = Event; win.isSecureContext = true;
  function Context() { this.audioWorklet = { addModule: async function () {} }; this.destination = {}; }
  Context.prototype.resume = async function () {}; Context.prototype.close = async function () {};
  Context.prototype.createMediaStreamSource = function () { return { connect: function () {}, disconnect: function () {} }; };
  Context.prototype.createGain = function () { return { gain: {}, connect: function () {}, disconnect: function () {} }; };
  win.AudioContext = Context;
  function Node() {
    var port = { postMessage: function () { port.onmessage({ data: { flushed: true } }); } };
    this.port = port; this.connect = function () {}; this.disconnect = function () {}; ports.push(port);
  }
  function input(value) { var el = new EventTarget(); el.value = value; el.isConnected = true; el.closest = function () { return null; }; el.getClientRects = function () { return [1]; }; return el; }
  global.window = win; global.document = { hidden: false }; global.AudioWorkletNode = Node;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async function () {
    return { getTracks: function () { return [{ stop: function () { stopped++; } }]; } };
  } } } });
  global.fetch = function () { return new Promise(function (resolve) { pending = resolve; }); };
  var storeApi = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/store.js')).href);
  var controller = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-controller.js')).href);
  var api = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-recording.js')).href);
  var model = { id: 'groq-turbo', mode: 'recorded', provider: 'groq' };
  async function begin(el) { await api.startRecording('project', el, model); ports[ports.length - 1].onmessage({ data: { pcm: new Int16Array([10, 20]).buffer } }); }
  async function tick() { await new Promise(function (resolve) { setImmediate(resolve); }); }
  try {
    storeApi.createStore({ activeSessionId: 1, speechLang: 'en-US' }); var el = input('Draft');
    await begin(el); var finish = api.finishRecording(); await tick(); assert.equal(stopped, 1);
    controller.stopSTT(); el.value = 'Manually changed'; pending({ ok: true, json: async function () { return { text: 'late' }; } }); await finish;
    assert.equal(el.value, 'Manually changed');
    await begin(el); finish = api.finishRecording(); await tick();
    pending({ ok: false, json: async function () { return { error: 'Quota exceeded' }; } }); await finish;
    assert.ok(storeApi.store.get('speechRetry')); assert.equal(el.value, 'Manually changed');
    api.retryRecording(); await tick(); pending({ ok: true, json: async function () { return { text: 'hello' }; } }); await tick();
    assert.equal(el.value, 'Manually changed hello'); assert.equal(storeApi.store.get('speechActive'), null);
    await begin(el); finish = api.finishRecording(); await tick(); storeApi.store.set({ activeSessionId: 2 });
    pending({ ok: true, json: async function () { return { text: 'wrong session' }; } }); await finish;
    assert.equal(el.value, 'Manually changed hello'); assert.equal(storeApi.store.get('speechActive'), null);
    // A provider can reject before readiness or immediately after opening the stream.
    global.location = { protocol: 'https:', host: 'localhost' };
    var providerMessage = 'Your Soniox credit balance is empty. Add credits in Soniox Console to use voice input.';
    for (var readyFirst of [false, true]) {
      var liveSocket;
      global.WebSocket = function () { liveSocket = this; this.readyState = 1; this.bufferedAmount = 0; };
      global.WebSocket.prototype.send = function () {};
      global.WebSocket.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose(); };
      var beforeStopped = stopped;
      var starting = api.startRecording('project', el, { id: 'soniox-live', mode: 'live', provider: 'soniox' });
      await tick(); liveSocket.onopen();
      if (readyFirst) { liveSocket.onmessage({ data: JSON.stringify({ type: 'ready' }) }); await starting; }
      liveSocket.onmessage({ data: JSON.stringify({ type: 'error', error: providerMessage }) });
      await starting;
      assert.equal(storeApi.store.get('speechActive'), null);
      assert.equal(storeApi.store.get('speechStatuses').project, providerMessage);
      assert.equal(storeApi.store.get('speechErrors').project.message, providerMessage);
      // Late close/stop callbacks must leave the visible error intact.
      controller.stopSTT();
      assert.equal(storeApi.store.get('speechErrors').project.message, providerMessage);
      assert.equal(stopped, beforeStopped + 1);
      assert.equal(el.value, 'Manually changed hello');
    }
    assert.ok(diagnostics.some(function (line) { return line.includes('microphone-granted'); }));
    assert.ok(diagnostics.some(function (line) { return line.includes('websocket-close'); }));
    assert.ok(diagnostics.some(function (line) { return line.includes('audio-cleanup'); }));
    assert.doesNotMatch(diagnostics.join('\n'), /Manually changed|wrong session/);
    controller.setSpeechStatus('project', '');
    assert.equal(storeApi.store.get('speechErrors').project, null);
  } finally {
    controller.stopSTT();
    console.log = log; console.trace = trace;
    names.forEach(function (name) { if (originals[name]) Object.defineProperty(global, name, originals[name]); else delete global[name]; });
  }
});
