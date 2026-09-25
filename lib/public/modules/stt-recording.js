import { sampleSpeechSignal } from './stt-signal.js';
import { store } from './store.js';
import { speechTrace } from './stt-debug.js';
import { captureSpeech, wavRecording } from './stt-audio.js';
import { claimSpeech, currentSpeech, writeSpeech, usableSpeechInput, setSpeechStatus, stopSTT, failSTT, speechContext } from './stt-controller.js';

async function upload(active, blob) {
  if (!currentSpeech(active)) return;
  active.phase = 'transcribing'; store.set({ speechActive: active });
  setSpeechStatus(active.id, 'Transcribing…');
  speechTrace(active, 'upload-start', { bytes: blob.size });
  try {
    var response = await fetch('/api/speech/transcribe', { method: 'POST', signal: active.abortController.signal,
      headers: { 'Content-Type': 'audio/wav', 'X-Speech-Model': active.model.id, 'X-Speech-Language': active.language }, body: blob });
    var result = await response.json();
    speechTrace(active, 'upload-response', { status: response.status, transcriptCharacters: typeof result.text === 'string' ? result.text.length : 0 });
    if (!response.ok) throw new Error(result.error || 'Transcription failed. Please try again.');
    if (!currentSpeech(active)) return;
    writeSpeech(active, result.text || '');
    stopSTT(result.text ? 'Review your draft before sending.' : 'No speech detected. Try recording again.');
  } catch (error) {
    if (!currentSpeech(active)) return;
    var retry = { id: active.id, input: active.input, context: active.context, value: active.lastValue,
      model: active.model, language: active.language, blob: blob };
    failSTT(error.name === 'AbortError' ? 'Transcription timed out. Please try again.' : error.message);
    store.set({ speechRetry: retry });
    setTimeout(function () { if (store.get('speechRetry') === retry) store.set({ speechRetry: null }); }, 300000);
  }
}
function initialize(id, input, model, language) {
  var controller = new AbortController();
  var active = claimSpeech(id, input, { abort: function () {
    controller.abort(); clearInterval(active.clock);
    if (active.capture) active.capture.abort();
    if (active.socket) active.socket.close();
    active.chunks = [];
  } });
  active.model = model; active.language = language; active.abortController = controller;
  active.phase = 'starting'; active.chunks = []; active.bytes = 0;
  speechTrace(active, 'start', { language: language, mode: model.mode, secureContext: window.isSecureContext, documentHidden: document.hidden });
  active.timeout = setTimeout(function () { if (currentSpeech(active)) failSTT('Microphone or provider did not start. Please try again.'); }, 20000);
  return active;
}
function liveSocket(active) {
  return new Promise(function (resolve, reject) {
    speechTrace(active, 'websocket-connect');
    var socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/speech/live');
    active.socket = socket;
    socket.onopen = function () { speechTrace(active, 'websocket-open'); socket.send(JSON.stringify({ type: 'start', model: active.model.id, language: active.language })); };
    socket.onmessage = function (event) {
      if (!currentSpeech(active)) return;
      try {
        var data = JSON.parse(event.data);
        if (data.type === 'diagnostic') { speechTrace(active, 'server-stage', { stage: data.stage, status: data.status, audioChunks: data.audioChunks, bytes: data.bytes }); return; }
        if (data.type !== 'text' || !active.receivedText) speechTrace(active, 'websocket-message', { type: data.type, transcriptCharacters: typeof data.text === 'string' ? data.text.length : 0 });
        if (data.type === 'text') active.receivedText = true;
        if (data.type === 'ready') resolve();
        else if (data.type === 'text') writeSpeech(active, data.text);
        else if (data.type === 'done') { writeSpeech(active, data.text); stopSTT('Review your draft before sending.'); }
        else if (data.type === 'error') { reject(new Error(data.error)); failSTT(data.error); }
      } catch (error) { reject(error); failSTT('Invalid transcription response. Your draft has been preserved.'); }
    };
    socket.onerror = function () { speechTrace(active, 'websocket-error', { readyState: socket.readyState }); reject(new Error('Could not connect to voice input.')); if (currentSpeech(active)) failSTT('Could not connect to voice input.'); };
    socket.onclose = function (event) { speechTrace(active, 'websocket-close', { code: event && event.code, clean: event && event.wasClean, stillActive: store.get('speechActive') === active }); reject(new Error('Voice connection closed.')); if (currentSpeech(active)) failSTT('Voice connection closed. Your draft has been preserved.'); };
  });
}
export async function startRecording(id, input, model) {
  if (!usableSpeechInput(input)) { speechTrace(null, 'start-rejected', { reason: 'input not usable', selectedModel: model.id }); return; }
  if (!window.isSecureContext) { setSpeechStatus(id, 'Voice input requires a secure HTTPS connection.'); return; }
  var active = initialize(id, input, model, store.get('speechLang') || 'en-US');
  setSpeechStatus(id, 'Starting microphone…');
  try {
    // Ask for the microphone from the user gesture before waiting on the network.
    active.capture = await captureSpeech(function (pcm) {
      sampleSpeechSignal(active, new Int16Array(pcm), 16000, 32768);
      active.capturedChunks = (active.capturedChunks || 0) + 1;
      if (active.capturedChunks === 1 || active.capturedChunks % 50 === 0) speechTrace(active, 'audio-chunks', { capturedChunks: active.capturedChunks, sentBytes: active.bytes, chunkBytes: pcm.byteLength });
      if (!currentSpeech(active) || (active.phase !== 'recording' && active.phase !== 'finishing')) return;
      active.bytes += pcm.byteLength;
      if (active.bytes > 9600000) { finishRecording(); return; }
      if (model.mode === 'live') {
        if (active.socket.readyState !== 1 || active.socket.bufferedAmount > 1048576) { failSTT('The connection is too slow. Your draft has been preserved.'); return; }
        active.socket.send(pcm);
      } else active.chunks.push(pcm);
    }, function (event, details) { speechTrace(active, event, details); });
    if (!currentSpeech(active)) { active.capture.abort(); return; }
    if (model.mode === 'live') await liveSocket(active);
    if (!currentSpeech(active)) return;
    clearTimeout(active.timeout); active.started = true; active.phase = 'recording'; active.startTime = Date.now();
    speechTrace(active, 'recording-ready');
    active.clock = setInterval(function () {
      if (currentSpeech(active)) {
        store.set({ speechActive: active });
        if (Date.now() - active.startTime >= 300000) finishRecording();
      }
    }, 1000);
    store.set({ speechActive: active });
    setSpeechStatus(id, model.mode === 'live' ? 'Listening…' : 'Recording…');
  } catch (error) {
    speechTrace(active, 'startup-caught-error', { errorName: error.name, stillActive: store.get('speechActive') === active });
    if (currentSpeech(active)) failSTT(error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser settings to try again.' : 'Voice input could not start. Check your microphone, API key and connection.');
  }
}
export async function finishRecording() {
  var active = store.get('speechActive');
  if (!active || !active.model) { stopSTT(); return; }
  if (active.phase !== 'recording') return;
  speechTrace(active, 'finish-requested', { bytes: active.bytes });
  active.phase = 'finishing'; clearInterval(active.clock); store.set({ speechActive: active });
  await active.capture.finish();
  if (!currentSpeech(active)) return;
  active.phase = 'transcribing'; store.set({ speechActive: active });
  if (active.model.mode === 'live') {
    setSpeechStatus(active.id, 'Finishing transcription…');
    active.socket.send(JSON.stringify({ type: 'finish' }));
    active.timeout = setTimeout(function () { if (currentSpeech(active)) failSTT('Transcription timed out. Your draft has been preserved.'); }, 25000);
  } else {
    var blob = wavRecording(active.chunks); active.chunks = [];
    active.timeout = setTimeout(function () { active.abortController.abort(); }, 125000);
    await upload(active, blob);
  }
}
export function retryRecording() {
  var retry = store.get('speechRetry');
  if (!retry || retry.context !== speechContext() || retry.input.value !== retry.value || !usableSpeechInput(retry.input)) { store.set({ speechRetry: null }); return; }
  var active = initialize(retry.id, retry.input, retry.model, retry.language);
  clearTimeout(active.timeout);
  active.timeout = setTimeout(function () { active.abortController.abort(); }, 125000);
  upload(active, retry.blob);
}
