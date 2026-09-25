var WebSocket = require('ws');
var providerError = require('./speech-transcribe').providerError;

function streamError(model, message) {
  var status = Number(message.error_code) || 502;
  if (model.provider !== 'soniox') return providerError(status);
  var reasons = {
    unauthenticated: 'Soniox rejected the API key. Check the key in Voice input settings.',
    permission_denied: 'The Soniox key does not have permission for live transcription. Check its permissions in Soniox Console.',
    organization_balance_exhausted: 'Your Soniox credit balance is empty. Add credits in Soniox Console to use voice input.',
    organization_monthly_budget_exhausted: 'Your Soniox organization has reached its monthly budget. Check its billing limits.',
    project_monthly_budget_exhausted: 'Your Soniox project has reached its monthly budget. Check its billing limits.',
    model_not_available: 'The selected Soniox model is unavailable for your project or region. Check model access in Soniox Console.',
    invalid_request: 'Soniox rejected the live transcription configuration. Try another voice model.',
    limit_exceeded: 'Your Soniox request limit was reached. Wait for other transcriptions to finish and try again.',
    request_timeout: 'Soniox timed out waiting for microphone audio. Check your microphone and connection, then try again.',
    service_unavailable: 'Soniox is temporarily unavailable. Please try again later.'
  };
  var reason = Object.prototype.hasOwnProperty.call(reasons, message.error_type) ? reasons[message.error_type] : null;
  if (!reason && status === 402) reason = 'Soniox requires available credits and budget. Check billing in Soniox Console.';
  return reason ? new Error(reason) : providerError(status);
}

function openSpeechStream(model, key, language, events, Socket) {
  Socket = Socket || WebSocket;
  if (model.provider === 'openai') return require('./speech-openai-stream').openOpenAIStream(model, key, language, events, Socket);
  var code = language.split('-')[0];
  var url; var options = { handshakeTimeout: 15000, maxPayload: 1024 * 1024 };
  if (model.provider === 'soniox') url = 'wss://stt-rt.soniox.com/transcribe-websocket';
  else if (model.provider === 'elevenlabs') {
    url = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=manual&language_code=' + encodeURIComponent(code);
    options.headers = { 'xi-api-key': key };
  } else if (model.provider === 'deepgram') {
    url = 'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&language=' + encodeURIComponent(code);
    options.headers = { Authorization: 'Token ' + key };
  } else throw new Error('This model does not support live transcription');
  var socket = new Socket(url, options);
  var finalText = ''; var ended = false; var finishing = false; var finishTimer;
  function diagnostic(stage, details) { if (events.diagnostic) events.diagnostic(stage, details); }
  function fail(error) { if (!ended) { ended = true; clearTimeout(finishTimer); socket.terminate(); events.error(error); } }
  function done() { if (!ended) { ended = true; clearTimeout(finishTimer); events.done(finalText.trim()); socket.close(); } }
  function emit(partial) { events.text((finalText + partial).trim()); }
  socket.on('open', function () {
    if (ended) return;
    diagnostic('upstream-websocket-open');
    if (model.provider === 'soniox') socket.send(JSON.stringify({ api_key: key, model: model.model,
      audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1, language_hints: [code], enable_endpoint_detection: true }));
    if (model.provider === 'soniox') diagnostic('soniox-config-sent');
    if (model.provider !== 'elevenlabs') events.ready();
  });
  socket.on('message', function (raw) {
    if (ended) return;
    try {
      var message = JSON.parse(raw.toString());
      if (message.error || message.error_code || message.error_type || message.type === 'Error' || /error|rate_limited|quota_exceeded/.test(message.message_type || '')) {
        diagnostic('upstream-error-response', { status: Number(message.error_code) || 502 });
        fail(streamError(model, message)); return;
      }
      if (model.provider === 'soniox') {
        var partial = '';
        (message.tokens || []).forEach(function (token) {
          if (/^<.*>$/.test(token.text)) return;
          if (token.is_final) finalText += token.text; else partial += token.text;
        });
        emit(partial);
        if (message.finished) done();
      } else if (model.provider === 'elevenlabs') {
        if (message.message_type === 'session_started') events.ready();
        if (message.message_type === 'partial_transcript') emit(message.text || '');
        if (message.message_type === 'committed_transcript') {
          finalText += (message.text || '') + ' '; emit('');
          if (finishing) done();
        }
      } else if (message.type === 'Results') {
        var text = message.channel.alternatives[0].transcript || '';
        if (message.is_final) { finalText += text + (text ? ' ' : ''); emit(''); }
        else emit(text);
      } else if (message.type === 'Metadata' && finishing) done();
    } catch (error) { fail(providerError(502)); }
  });
  socket.on('error', function () { diagnostic('upstream-transport-error'); fail(providerError(502)); });
  socket.on('unexpected-response', function (request, response) { diagnostic('upstream-handshake-rejected', { status: response.statusCode }); response.resume(); fail(providerError(response.statusCode)); });
  socket.on('close', function (code) {
    diagnostic('upstream-websocket-close', { status: code });
    if (!ended) {
      if (finishing && model.provider === 'deepgram') done();
      else fail(new Error('The live connection ended unexpectedly. Your draft has been preserved.'));
    }
  });
  return {
    audio: function (bytes) {
      if (ended || finishing || socket.readyState !== 1) return;
      if (socket.bufferedAmount > 1024 * 1024) { fail(new Error('The connection is too slow for live transcription.')); return; }
      if (model.provider === 'elevenlabs') socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: bytes.toString('base64'), sample_rate: 16000 }));
      else socket.send(bytes);
    },
    finish: function () {
      if (ended || finishing) return;
      finishing = true;
      finishTimer = setTimeout(function () { fail(new Error('Transcription timed out. Your draft has been preserved.')); }, 20000);
      if (model.provider === 'soniox') socket.send('');
      else if (model.provider === 'deepgram') socket.send(JSON.stringify({ type: 'CloseStream' }));
      else socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16000 }));
    },
    abort: function () { ended = true; clearTimeout(finishTimer); socket.terminate(); }
  };
}
module.exports = { openSpeechStream: openSpeechStream };
