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
  function input(value) { var el = new EventTarget(); el.value = value; el.isConnected = true; el.style = {}; el.scrollHeight = 20; el.closest = function () { return null; }; el.getClientRects = function () { return [1]; }; el.focus = function () {}; return el; }
  global.window = win; global.document = { hidden: false }; global.AudioWorkletNode = Node;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async function () {
    return { getTracks: function () { return [{ stop: function () { stopped++; } }]; } };
  } } } });
  global.fetch = function () { return new Promise(function (resolve) { pending = resolve; }); };
  var storeApi = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/store.js')).href);
  var controller = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-controller.js')).href);
  var api = await import(pathToFileURL(path.join(__dirname, '../lib/public/modules/stt-recording.js')).href);
  var model = { id: 'groq-turbo', mode: 'recorded', provider: 'groq' };
  async function begin(el, id) { await api.startRecording(id || 'project', el, model); ports[ports.length - 1].onmessage({ data: { pcm: new Int16Array([10, 20]).buffer } }); }
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
    var projectSends = 0; el.value = '';
    await begin(el);
    assert.equal(api.hasRecordedSpeechFor(el), true);
    assert.equal(api.requestRecordedSend(el, function () { projectSends++; }), true);
    assert.equal(api.requestRecordedSend(el, function () { projectSends++; }), true, 'repeated Send joins the pending request');
    await tick(); pending({ ok: true, json: async function () { return { text: 'send this' }; } }); await tick(); await tick();
    assert.equal(el.value, 'send this'); assert.equal(projectSends, 1, 'project composer resumes once after transcription');
    var home = input(''); var homeSends = 0;
    await begin(home, 'home'); assert.equal(api.requestRecordedSend(home, function () { homeSends++; }), true);
    await tick(); pending({ ok: true, json: async function () { return { text: 'home voice' }; } }); await tick(); await tick();
    assert.equal(home.value, 'home voice'); assert.equal(homeSends, 1, 'Home composer uses the same guarded completion');
    await begin(el); assert.equal(api.requestRecordedSend(el, function () { projectSends++; }), true);
    await tick(); pending({ ok: true, json: async function () { return { text: '' }; } }); await tick();
    assert.equal(projectSends, 1, 'an empty transcript never sends an earlier draft');
    await begin(el); assert.equal(api.requestRecordedSend(el, function () { projectSends++; }), true);
    await tick(); pending({ ok: false, json: async function () { return { error: 'Quota exceeded' }; } }); await tick();
    assert.equal(projectSends, 1, 'a transcription failure preserves retry without sending');
    await begin(el); assert.equal(api.requestRecordedSend(el, function () { projectSends++; }), true);
    await tick(); controller.stopSTT(); el.value = 'manual edit'; pending({ ok: true, json: async function () { return { text: 'late send' }; } }); await tick();
    assert.equal(projectSends, 1, 'cancellation or a manual edit invalidates the pending send');
    await begin(el); assert.equal(api.requestRecordedSend(el, function () { projectSends++; }), true);
    await tick(); storeApi.store.set({ activeSessionId: 3 }); pending({ ok: true, json: async function () { return { text: 'stale context' }; } }); await tick();
    assert.equal(projectSends, 1, 'a session switch invalidates the pending send');
    await begin(el); assert.equal(api.requestRecordedSend(el, function () { projectSends++; }), true);
    await tick(); await begin(home, 'home'); pending({ ok: true, json: async function () { return { text: 'replaced recording' }; } }); await tick();
    assert.equal(projectSends, 1, 'a replacement recording invalidates the pending send');
    controller.stopSTT();
    var finishFailure = input('draft kept');
    await begin(finishFailure);
    var failedActive = storeApi.store.get('speechActive'); var captured = failedActive.capture;
    failedActive.capture = { abort: captured.abort, finish: async function () { throw new Error('Audio flush failed'); } };
    var beforeFinishFailureStopped = stopped;
    assert.equal(api.requestRecordedSend(finishFailure, function () { projectSends++; }), true);
    await tick(); await tick();
    assert.equal(projectSends, 1, 'a rejected recording finish never sends');
    assert.equal(finishFailure.value, 'draft kept', 'a rejected recording finish preserves the draft');
    assert.equal(storeApi.store.get('speechActive'), null, 'a rejected recording finish releases the active capture');
    assert.equal(stopped, beforeFinishFailureStopped + 1, 'a rejected recording finish releases its microphone track');
    assert.equal(storeApi.store.get('speechErrors').project.message, 'Audio flush failed');
    function node() { return { classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, style: {}, innerHTML: '', querySelector: function () { return null; }, appendChild: function () {} }; }
    function projectComposer(composerInput, sent) {
      var code = fs.readFileSync(path.join(__dirname, '../lib/public/modules/input.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{[^;]+;\n/gm, '').replace(/export /g, '');
      code += "\nglobalThis.__setComposerContext = function (value) { ctx = value; }; globalThis.__sendComposer = sendMessage; globalThis.__hasSendableContent = hasSendableContent;";
      var sandbox = {
        stopSTT: controller.stopSTT, hasRecordedSpeechFor: api.hasRecordedSpeechFor, requestRecordedSend: api.requestRecordedSend,
        window: {}, document: { getElementById: function () { return null; }, querySelector: function () { return null; } },
        setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval, console: console, CustomEvent: function () {},
        store: storeApi.store, iconHtml: function () { return ''; }, refreshIcons: function () {}, setRewindMode: function () {}, isRewindMode: function () { return false; },
        renderContextPicker: function () {}, checkForMention: function () { return {}; }, showMentionMenu: function () {}, hideMentionMenu: function () {}, isMentionMenuVisible: function () { return false; }, mentionMenuKeydown: function () { return false; }, setMentionAtIdx: function () {}, parseMentionFromInput: function () { return null; }, clearMentionState: function () {}, stickyReapplyMention: function () {}, sendMention: function () {}, sendUserMention: function () {}, renderMentionUser: function () {}, renderUserMention: function () {}, removeMentionChip: function () {},
        sendAcknowledgedMessage: function (payload) { sent.push(payload); }, mateAvatarUrl: function () { return ''; }, tuiIsActive: function () { return false; }, tuiSubmitText: function () {}, VENDOR_AVATARS: {}, VENDOR_NAMES: {}, showToast: function () {}, isShellCommandMode: function () { return false; }, submitShellCommand: function () { return false; }, showPasteModal: function () {}, prepareAutonomousPayload: function () { return true; },
      };
      vm.createContext(sandbox); vm.runInContext(code, sandbox);
      sandbox.__setComposerContext({ inputEl: composerInput, imagePreviewBar: node(), slashMenu: node(), slashCommands: function () { return []; }, ws: { send: function () {} }, connected: true, processing: false, isDebateEndedMode: function () { return false; }, isDebateConcludeMode: function () { return false; }, isDebateFloorMode: function () { return false; }, isDmMode: function () { return false; }, isMateDm: function () { return false; }, hideSuggestionChips: function () {}, currentMsgTs: null });
      return sandbox;
    }
    function homeComposer(composerInput, sent) {
      var code = fs.readFileSync(path.join(__dirname, '../lib/public/modules/home-mate-chat.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
      code += "\nrenderHomeChat = function () {}; resizeInput = function () {}; globalThis.__setHomeComposer = function (value) { inputEl = value; sendBtn = node(); }; globalThis.__sendHomeComposer = submitMessage;";
      var socket = { readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } };
      var sandbox = {
        stopSTT: controller.stopSTT, hasRecordedSpeechFor: api.hasRecordedSpeechFor, requestRecordedSend: api.requestRecordedSend, store: storeApi.store, getWs: function () { return socket; },
        createHomeDebateResponder: function () { return function () {}; }, createHomeMateProposalResponder: function () { return function () {}; }, hasPendingHomeDebateQuestion: function () { return false; }, followHomeChatNextRender: function () {}, node: node,
      };
      vm.createContext(sandbox); vm.runInContext(code, sandbox);
      sandbox.__setHomeComposer(composerInput);
      return sandbox;
    }
    var projectTransport = []; var projectInput = input('');
    var project = projectComposer(projectInput, projectTransport);
    storeApi.store.set({ currentSlug: 'project-a', activeSessionId: 4, connected: true, dmMode: false, homeChatMateId: null, homeChatSessionId: null });
    await begin(projectInput);
    assert.equal(project.__hasSendableContent(), true, 'a blank recorded project input becomes sendable');
    project.__sendComposer(); project.__sendComposer();
    assert.equal(projectTransport.length, 0, 'the project handler does not submit before transcription');
    await tick(); pending({ ok: true, json: async function () { return { text: 'project voice' }; } }); await tick(); await tick();
    assert.deepEqual(projectTransport.map(function (payload) { return payload.text; }), ['project voice'], 'the project handler submits the final transcript once through its normal transport');
    var homeTransport = []; var homeInput = input('');
    storeApi.store.set({ homeChatMateId: 'mate-1', homeChatSessionId: 'home-1', homeChatSessionModel: 'model-1', homeChatSessionModelLoading: false });
    var homeComposerApi = homeComposer(homeInput, homeTransport);
    await begin(homeInput, 'home');
    assert.equal(api.hasRecordedSpeechFor(homeInput), true, 'a blank recorded Home input becomes sendable');
    assert.equal(homeComposerApi.__sendHomeComposer(), true);
    assert.equal(homeComposerApi.__sendHomeComposer(), true, 'repeated Home Send joins the pending transcription');
    assert.equal(homeTransport.length, 0, 'the Home handler does not submit before transcription');
    await tick(); pending({ ok: true, json: async function () { return { text: 'home voice' }; } }); await tick(); await tick();
    assert.deepEqual(homeTransport.map(function (message) { return message.text; }), ['home voice'], 'the Home handler submits the final transcript once through its normal transport');
    projectInput.value = 'ordinary text';
    project.__sendComposer();
    assert.deepEqual(projectTransport.map(function (payload) { return payload.text; }), ['project voice', 'ordinary text'], 'normal text sending remains unchanged');
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
      assert.equal(el.value, 'manual edit');
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
