var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var EventEmitter = require('events');
var catalog = require('../lib/speech-catalog');
var attachSpeechStore = require('../lib/speech-store').attachSpeechStore;
var transcribe = require('../lib/speech-transcribe').transcribe;
var openSpeechStream = require('../lib/speech-stream').openSpeechStream;

test('speech credentials are encrypted, bound to owner/provider, and never returned publicly', function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-speech-test-'));
  try {
    var storage = attachSpeechStore(root);
    assert.equal(storage.view('alice').language, 'en-US');
    storage.update('alice', { language: 'fr-FR' });
    assert.equal(attachSpeechStore(root).view('alice').language, 'fr-FR');
    assert.equal(storage.view('bob').language, 'en-US');
    storage.update('alice', { provider: 'groq', key: 'secret-alice' });
    storage.update('bob', { provider: 'groq', key: 'secret-bob' });
    storage.update('alice', { selected: 'groq-turbo' });
    assert.equal(storage.key('alice', 'groq'), 'secret-alice');
    assert.equal(storage.key('bob', 'groq'), 'secret-bob');
    assert.equal(storage.key('alice', 'openai'), null);
    assert.equal(JSON.stringify(storage.view('alice')).includes('secret-alice'), false);
    var file = path.join(root, 'speech/alice.json');
    var raw = fs.readFileSync(file, 'utf8'); assert.equal(raw.includes('secret-alice'), false);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    var stolen = JSON.parse(raw); fs.writeFileSync(path.join(root, 'speech/mallory.json'), JSON.stringify(stolen));
    assert.throws(function () { storage.key('mallory', 'groq'); });
    storage.update('alice', { provider: 'groq', key: null });
    assert.equal(storage.key('alice', 'groq'), null);
    assert.equal(storage.view('alice').selected, 'groq-turbo', 'deletion must not silently select another provider');
    assert.throws(function () { storage.update('alice', { selected: 'groq-turbo' }); });
    assert.throws(function () { storage.update('../bob', { selected: 'browser' }); });
    assert.throws(function () { storage.update('alice', { provider: 'flux', key: 'no' }); });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('recorded providers send the correct key, model, language and audio', async function () {
  for (var id of ['openai-transcribe', 'openai-whisper', 'groq-whisper', 'groq-turbo', 'elevenlabs-file', 'deepgram-file']) {
    var model = catalog.findModel(id); var call;
    var output = await transcribe(model, 'private-key', Buffer.from('audio'), 'fr-FR', new AbortController().signal,
      async function (url, options) {
        call = { url: url, options: options };
        return { ok: true, json: async function () { return model.provider === 'deepgram' ? { results: { channels: [{ alternatives: [{ transcript: 'bonjour' }] }] } } : { text: 'bonjour' }; } };
      });
    assert.equal(output, 'bonjour');
    if (model.provider === 'deepgram') { assert.match(call.url, /language=fr/); assert.equal(call.options.headers.Authorization, 'Token private-key'); }
    else {
      assert.equal(call.options.body.get(model.provider === 'elevenlabs' ? 'model_id' : 'model'), model.model);
      assert.equal(call.options.body.get(model.provider === 'elevenlabs' ? 'language_code' : (id === 'openai-transcribe' ? 'languages[]' : 'language')), 'fr');
      assert.equal(await call.options.body.get('file').text(), 'audio');
    }
  }
});

test('Soniox retrieves async text and cleans remote recording and job', async function () {
  var calls = [];
  var output = await transcribe(catalog.findModel('soniox-file'), 'key', Buffer.from('audio'), 'en-US', new AbortController().signal,
    async function (url, options) {
      calls.push({ url: url, options: options });
      var data = options.method === 'POST' ? { id: url.endsWith('/files') ? 'file1' : 'job1' } : url.endsWith('/transcript') ? { text: 'hello' } : { status: 'completed' };
      return { ok: true, json: async function () { return data; } };
    });
  assert.equal(output, 'hello');
  assert.equal(calls.filter(function (call) { return call.options.method === 'DELETE'; }).length, 2);
  assert.equal(JSON.parse(calls[1].options.body).file_id, 'file1');
});

test('provider errors do not expose raw provider data or keys', async function () {
  await assert.rejects(transcribe(catalog.findModel('groq-turbo'), 'private', Buffer.alloc(1), 'en-US', new AbortController().signal,
    async function () { return { ok: false, status: 401, text: async function () { return 'private'; } }; }), /rejected your API key/);
});

function fakeSocket() {
  var instance;
  function Socket(url, options) { EventEmitter.call(this); this.url = url; this.options = options; this.readyState = 1; this.sent = []; instance = this; }
  Object.setPrototypeOf(Socket.prototype, EventEmitter.prototype);
  Socket.prototype.send = function (data) { this.sent.push(data); };
  Socket.prototype.close = function () { this.readyState = 3; };
  Socket.prototype.terminate = Socket.prototype.close;
  return { Socket: Socket, get: function () { return instance; } };
}

test('Soniox streaming replaces partial tokens and finalizes without duplication', function () {
  var fake = fakeSocket(); var updates = []; var final;
  var stream = openSpeechStream(catalog.findModel('soniox-live'), 'key', 'en-US', {
    ready: function () {}, text: function (text) { updates.push(text); }, done: function (text) { final = text; }, error: function (error) { throw error; }
  }, fake.Socket);
  var socket = fake.get(); socket.emit('open');
  function emit(data) { socket.emit('message', Buffer.from(JSON.stringify(data))); }
  emit({ tokens: [{ text: 'hel', is_final: false }] });
  emit({ tokens: [{ text: 'hello', is_final: true }, { text: ' wor', is_final: false }] });
  stream.finish(); assert.equal(socket.sent[socket.sent.length - 1], '');
  emit({ tokens: [{ text: ' world', is_final: true }, { text: '<end>', is_final: true }], finished: true });
  assert.deepEqual(updates, ['hel', 'hello wor', 'hello world']); assert.equal(final, 'hello world');
});

test('Soniox startup failures explain billing, permissions and model access without exposing raw data', function () {
  [
    [402, 'organization_balance_exhausted', /credit balance is empty/],
    [402, 'project_monthly_budget_exhausted', /project has reached its monthly budget/],
    [403, 'permission_denied', /permission for live transcription/],
    [400, 'model_not_available', /model is unavailable/],
    [429, 'unknown', /limit was reached/],
    [401, 'unknown', /rejected your API key/],
    [502, 'unknown', /could not complete/]
  ].forEach(function (scenario) {
    var fake = fakeSocket(); var errors = []; var diagnostics = [];
    openSpeechStream(catalog.findModel('soniox-live'), 'private-key', 'en-US', {
      ready: function () {}, text: function () {}, done: function () { assert.fail('Must not complete on error'); },
      diagnostic: function (stage, details) { diagnostics.push({ stage: stage, details: details }); },
      error: function (error) { errors.push(error.message); }
    }, fake.Socket);
    var socket = fake.get(); socket.emit('open');
    socket.emit('message', Buffer.from(JSON.stringify({ error_code: scenario[0], error_type: scenario[1], error_message: 'private-key raw provider details' })));
    socket.emit('close');
    assert.equal(errors.length, 1); assert.match(errors[0], scenario[2]);
    assert.doesNotMatch(errors[0], /private-key|raw provider details/); assert.equal(socket.readyState, 3);
    assert.ok(diagnostics.some(function (entry) { return entry.stage === 'upstream-error-response' && entry.details.status === scenario[0]; }));
    assert.doesNotMatch(JSON.stringify(diagnostics), /private-key|raw provider details/);
  });
});

test('ElevenLabs manual commit and Deepgram final segments produce complete text', function () {
  ['elevenlabs-live', 'deepgram-live'].forEach(function (id) {
    var fake = fakeSocket(); var final; var ready = 0;
    var stream = openSpeechStream(catalog.findModel(id), 'key', 'en-US', {
      ready: function () { ready++; }, text: function () {}, done: function (text) { final = text; }, error: function (error) { throw error; }
    }, fake.Socket);
    var socket = fake.get(); socket.emit('open');
    function emit(data) { socket.emit('message', Buffer.from(JSON.stringify(data))); }
    if (id === 'elevenlabs-live') emit({ message_type: 'session_started' });
    assert.equal(ready, 1); stream.audio(Buffer.from([1, 0])); stream.finish();
    if (id === 'elevenlabs-live') {
      assert.equal(JSON.parse(socket.sent[socket.sent.length - 1]).commit, true);
      emit({ message_type: 'committed_transcript', text: 'hello world' });
    } else {
      emit({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'hello world' }] } });
      emit({ type: 'Metadata' });
    }
    assert.equal(final, 'hello world');
  });
});
