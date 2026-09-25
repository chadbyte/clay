var test = require('node:test');
var assert = require('node:assert/strict');
var EventEmitter = require('events');
var catalog = require('../lib/speech-catalog');
var openSpeechStream = require('../lib/speech-stream').openSpeechStream;
var pcmResampler = require('../lib/speech-openai-stream').pcmResampler;

function fixture() {
  var socket; var ready = 0; var text = []; var done = []; var errors = [];
  function Socket(url, options) { EventEmitter.call(this); socket = this; this.url = url; this.options = options; this.readyState = 1; this.bufferedAmount = 0; this.sent = []; }
  Object.setPrototypeOf(Socket.prototype, EventEmitter.prototype);
  Socket.prototype.send = function (value) { this.sent.push(JSON.parse(value)); };
  Socket.prototype.close = function () { this.readyState = 3; this.emit('close'); };
  Socket.prototype.terminate = Socket.prototype.close;
  var stream = openSpeechStream(catalog.findModel('openai-live'), 'private-key', 'fr-FR', {
    ready: function () { ready++; }, text: function (value) { text.push(value); },
    done: function (value) { done.push(value); }, error: function (error) { errors.push(error.message); }
  }, Socket);
  return { stream: stream, socket: socket, text: text, done: done, errors: errors,
    ready: function () { return ready; },
    emit: function (message) { socket.emit('message', Buffer.from(JSON.stringify(message))); } };
}

test('OpenAI PCM conversion preserves duration and values across arbitrary chunk boundaries', function () {
  var input = Buffer.alloc(32000);
  for (var i = 0; i < 16000; i++) input.writeInt16LE(Math.round(Math.sin(i / 30) * 16000), i * 2);
  var all = pcmResampler()(input, true);
  var convert = pcmResampler(); var parts = [];
  for (var at = 0; at < input.length; at += 142) parts.push(convert(input.subarray(at, at + 142), false));
  parts.push(convert(Buffer.alloc(0), true));
  assert.equal(all.length, 48000); assert.deepEqual(Buffer.concat(parts), all);
  assert.equal(all.readInt16LE(0), input.readInt16LE(0));
  assert.equal(all.readInt16LE(6), input.readInt16LE(4));
});

test('OpenAI live waits for setup, streams partial text and replaces it with the committed final transcript', function () {
  var f = fixture(); var model = catalog.findModel('openai-live');
  assert.equal(model.provider, 'openai'); assert.equal(model.mode, 'live');
  assert.equal(f.socket.url, 'wss://api.openai.com/v1/realtime?intent=transcription');
  assert.equal(f.socket.options.headers.Authorization, 'Bearer private-key');
  f.socket.emit('open');
  var config = f.socket.sent[0].session.audio.input;
  assert.equal(config.format.rate, 24000); assert.equal(config.turn_detection, null);
  assert.deepEqual(config.transcription, { model: 'gpt-live-transcribe', languages: ['fr'] });
  assert.equal(f.ready(), 0); f.stream.audio(Buffer.alloc(3200)); assert.equal(f.socket.sent.length, 1);
  f.emit({ type: 'session.updated' }); f.emit({ type: 'session.updated' }); assert.equal(f.ready(), 1);
  f.stream.audio(Buffer.alloc(3200));
  f.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'Bon' });
  f.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'jour' });
  assert.deepEqual(f.text, ['Bon', 'Bonjour']);
  f.stream.finish(); f.stream.finish();
  assert.equal(f.socket.sent.filter(function (message) { return message.type === 'input_audio_buffer.commit'; }).length, 1);
  var bytes = f.socket.sent.filter(function (message) { return message.audio; }).reduce(function (sum, message) { return sum + Buffer.from(message.audio, 'base64').length; }, 0);
  assert.equal(bytes, 4800);
  f.emit({ type: 'input_audio_buffer.committed', item_id: 'one' });
  f.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'other', transcript: 'Wrong' });
  assert.deepEqual(f.done, []);
  f.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: 'Bonjour!' });
  assert.deepEqual(f.done, ['Bonjour!']); assert.deepEqual(f.errors, []); assert.equal(f.socket.readyState, 3);
});

test('OpenAI handles empty and short captures and completion arriving before commit acknowledgement', function () {
  var empty = fixture(); empty.socket.emit('open'); empty.emit({ type: 'session.updated' }); empty.stream.finish();
  assert.deepEqual(empty.done, ['']); assert.equal(empty.socket.sent.length, 1);
  var f = fixture(); f.socket.emit('open'); f.emit({ type: 'session.updated' });
  f.stream.audio(Buffer.alloc(2)); f.stream.finish();
  var bytes = f.socket.sent.filter(function (message) { return message.audio; }).reduce(function (sum, message) { return sum + Buffer.from(message.audio, 'base64').length; }, 0);
  assert.equal(bytes, 4800);
  f.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: 'Hi' });
  assert.deepEqual(f.done, []); f.emit({ type: 'input_audio_buffer.committed', item_id: 'one' });
  assert.deepEqual(f.done, ['Hi']);
});

test('OpenAI errors and cancellation stop the stream without exposing upstream secrets or late text', function () {
  ['invalid_api_key', 'insufficient_quota', 'model_not_found', 'unknown'].forEach(function (code) {
    var f = fixture(); f.socket.emit('open');
    f.emit({ type: 'error', error: { code: code, message: 'private-key secret' } });
    assert.equal(f.errors.length, 1); assert.doesNotMatch(f.errors[0], /private-key|secret/);
    f.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'late' });
    assert.deepEqual(f.text, []); assert.deepEqual(f.done, []);
  });
  var f = fixture(); f.stream.abort(); f.socket.emit('open');
  f.emit({ type: 'session.updated' }); assert.equal(f.ready(), 0); assert.deepEqual(f.errors, []);
});
