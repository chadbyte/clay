var providerError = require('./speech-transcribe').providerError;

// Interpolate the shared 16 kHz PCM stream to OpenAI's required 24 kHz,
// carrying sample position across chunks so chunk boundaries do not lose audio.
function pcmResampler() {
  var count = 0; var tick = 0; var previous = 0;
  return function (bytes, flush) {
    var samples = [];
    for (var at = 0; at < bytes.length; at += 2) {
      var current = bytes.readInt16LE(at);
      while (tick <= count * 3) {
        var fraction = (tick - (count - 1) * 3) / 3;
        samples.push(count ? Math.round(previous + (current - previous) * fraction) : current);
        tick += 2;
      }
      previous = current; count++;
    }
    if (flush) while (tick < count * 3) { samples.push(previous); tick += 2; }
    var output = Buffer.alloc(samples.length * 2);
    samples.forEach(function (sample, index) { output.writeInt16LE(sample, index * 2); });
    return output;
  };
}

function openOpenAIStream(model, key, language, events, Socket) {
  var socket = new Socket('wss://api.openai.com/v1/realtime?intent=transcription', {
    headers: { Authorization: 'Bearer ' + key }, handshakeTimeout: 15000, maxPayload: 1024 * 1024
  });
  var ended = false; var ready = false; var finishing = false; var timer;
  var partial = ''; var itemId = null; var committedId = null; var completed = new Map();
  var bytesSent = 0; var resample = pcmResampler();
  function send(message) { socket.send(JSON.stringify(message)); }
  function fail(error) {
    if (ended) return;
    ended = true; clearTimeout(timer); socket.terminate(); events.error(error);
  }
  function done(text) {
    if (ended) return;
    ended = true; clearTimeout(timer); events.done(text.trim()); socket.close();
  }
  function failure(message) {
    var code = message.error && message.error.code;
    if (code === 'invalid_api_key') return providerError(401);
    if (code === 'insufficient_quota' || code === 'rate_limit_exceeded') return providerError(429);
    if (code === 'model_not_found') return new Error('GPT Live Transcribe is unavailable for this OpenAI project. Check model access.');
    return new Error('OpenAI could not complete live transcription. Check your API key, model access and connection.');
  }
  function append(bytes) {
    if (bytes.length) send({ type: 'input_audio_buffer.append', audio: bytes.toString('base64') });
  }
  socket.on('open', function () {
    if (ended) return;
    send({ type: 'session.update', session: { type: 'transcription', audio: { input: {
      format: { type: 'audio/pcm', rate: 24000 },
      transcription: { model: model.model, languages: [language.toLowerCase().split('-')[0]] },
      turn_detection: null
    } } } });
  });
  socket.on('message', function (raw) {
    if (ended) return;
    try {
      var message = JSON.parse(raw.toString());
      if (message.type === 'error' || message.type === 'conversation.item.input_audio_transcription.failed') { fail(failure(message)); return; }
      if (message.type === 'session.updated' && !ready) { ready = true; events.ready(); }
      else if (message.type === 'conversation.item.input_audio_transcription.delta') {
        if (!itemId) itemId = message.item_id;
        if (message.item_id !== itemId) return;
        partial += message.delta || ''; events.text(partial);
      } else if (message.type === 'input_audio_buffer.committed') {
        committedId = message.item_id;
        if (finishing && completed.has(committedId)) done(completed.get(committedId));
      } else if (message.type === 'conversation.item.input_audio_transcription.completed') {
        if (!itemId) itemId = message.item_id;
        if (message.item_id !== itemId) return;
        completed.set(message.item_id, message.transcript || '');
        if (finishing && message.item_id === committedId) done(message.transcript || '');
      }
    } catch (error) { fail(providerError(502)); }
  });
  socket.on('error', function () { fail(new Error('Could not connect to OpenAI live transcription. Please try again.')); });
  socket.on('unexpected-response', function (request, response) { response.resume(); fail(providerError(response.statusCode)); });
  socket.on('close', function () { if (!ended) fail(new Error('The OpenAI live connection ended unexpectedly. Your draft has been preserved.')); });
  return {
    audio: function (bytes) {
      if (ended || finishing || !ready || socket.readyState !== 1) return;
      if (socket.bufferedAmount > 1024 * 1024) { fail(new Error('The connection is too slow for live transcription.')); return; }
      bytesSent += bytes.length; append(resample(bytes, false));
    },
    finish: function () {
      if (ended || finishing || !ready) return;
      finishing = true;
      if (!bytesSent) { done(''); return; }
      // OpenAI requires at least 100 ms per commit; pad only very short captures.
      if (bytesSent < 3200) append(resample(Buffer.alloc(3200 - bytesSent), false));
      append(resample(Buffer.alloc(0), true));
      timer = setTimeout(function () { fail(new Error('OpenAI transcription timed out. Your draft has been preserved.')); }, 20000);
      send({ type: 'input_audio_buffer.commit' });
    },
    abort: function () { ended = true; clearTimeout(timer); socket.terminate(); }
  };
}
module.exports = { openOpenAIStream: openOpenAIStream, pcmResampler: pcmResampler };
