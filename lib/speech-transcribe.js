// Recorded audio adapters. No provider response body (which may contain private data) is logged.
function providerError(status) {
  var error = new Error(status === 401 || status === 403 ? 'The provider rejected your API key. Check its permissions in Voice input settings.' :
    status === 429 ? 'The provider limit was reached. Check your quota or try again later.' : 'The transcription provider could not complete the request. Please try again.');
  error.status = 502;
  return error;
}
async function transcribe(model, key, audio, language, signal, fetcher) {
  fetcher = fetcher || fetch;
  var languageCode = (language || 'en-US').split('-')[0];
  async function request(url, options) {
    var response = await fetcher(url, Object.assign({}, options, { signal: signal }));
    if (!response.ok) throw providerError(response.status);
    return response;
  }
  function form() { var data = new FormData(); data.append('file', new Blob([audio], { type: 'audio/wav' }), 'voice.wav'); return data; }
  if (model.provider === 'openai' || model.provider === 'groq') {
    var data = form(); data.append('model', model.model); data.append(model.model === 'gpt-transcribe' ? 'languages[]' : 'language', languageCode);
    var endpoint = model.provider === 'openai' ? 'https://api.openai.com/v1/audio/transcriptions' : 'https://api.groq.com/openai/v1/audio/transcriptions';
    var response = await request(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: data });
    return (await response.json()).text;
  }
  if (model.provider === 'elevenlabs') {
    var data = form(); data.append('model_id', model.model); data.append('language_code', languageCode);
    data.append('tag_audio_events', 'false'); data.append('diarize', 'false');
    var response = await request('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: data });
    return (await response.json()).text;
  }
  if (model.provider === 'deepgram') {
    var url = 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=' + encodeURIComponent(languageCode);
    var response = await request(url, { method: 'POST', headers: { Authorization: 'Token ' + key, 'Content-Type': 'audio/wav' }, body: audio });
    return (await response.json()).results.channels[0].alternatives[0].transcript;
  }
  if (model.provider !== 'soniox') throw new Error('Unsupported speech provider');
  var base = 'https://api.soniox.com/v1';
  var headers = { Authorization: 'Bearer ' + key };
  var fileId; var transcriptionId;
  try {
    var uploaded = await request(base + '/files', { method: 'POST', headers: headers, body: form() });
    fileId = (await uploaded.json()).id;
    var created = await request(base + '/transcriptions', { method: 'POST', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: model.model, file_id: fileId, language_hints: [languageCode] }) });
    transcriptionId = (await created.json()).id;
    for (;;) {
      var result = await request(base + '/transcriptions/' + encodeURIComponent(transcriptionId), { headers: headers });
      var state = await result.json();
      if (state.status === 'error') throw providerError(502);
      if (state.status === 'completed') break;
      await require('timers/promises').setTimeout(750, undefined, { signal: signal });
    }
    var transcript = await request(base + '/transcriptions/' + encodeURIComponent(transcriptionId) + '/transcript', { headers: headers });
    return (await transcript.json()).text;
  } finally {
    // Cleanup uses its own bounded signal, including when the user cancels the transcription.
    var paths = [];
    if (transcriptionId) paths.push('/transcriptions/' + encodeURIComponent(transcriptionId));
    if (fileId) paths.push('/files/' + encodeURIComponent(fileId));
    await Promise.allSettled(paths.map(function (path) {
      return fetcher(base + path, { method: 'DELETE', headers: headers, signal: AbortSignal.timeout(5000) });
    }));
  }
}
module.exports = { transcribe: transcribe, providerError: providerError };
