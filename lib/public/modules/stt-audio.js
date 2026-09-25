export async function captureSpeech(onAudio, trace) {
  trace = trace || function () {};
  var stage = 'capability-check';
  var Constructor = window.AudioContext || window.webkitAudioContext;
  trace(stage, { audioContext: !!Constructor, mediaDevices: !!navigator.mediaDevices, secureContext: window.isSecureContext });
  if (!Constructor || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Microphone recording is unavailable in this browser.');
  var context = new Constructor();
  trace('audio-context-created', { state: context.state, sampleRate: context.sampleRate });
  var stream; var node; var source; var sink; var closed = false;
  function close() {
    if (closed) return; closed = true;
    trace('audio-cleanup', { stage: stage, hasStream: !!stream, hasWorklet: !!node });
    if (node) node.disconnect(); if (source) source.disconnect(); if (sink) sink.disconnect();
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    context.close().catch(function () {});
  }
  try {
    stage = 'audio-context-resume'; trace(stage);
    await context.resume();
    stage = 'microphone-permission'; trace(stage, { state: context.state });
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    trace('microphone-granted', { tracks: stream.getTracks().length });
    stream.getTracks().forEach(function (track) {
      if (!track.addEventListener) return;
      ['ended', 'mute', 'unmute'].forEach(function (event) {
        track.addEventListener(event, function () { trace('microphone-track-' + event, { state: track.readyState }); });
      });
    });
    stage = 'audio-worklet-load'; trace(stage);
    await context.audioWorklet.addModule('/modules/stt-audio-worklet.js');
    stage = 'audio-worklet-create'; trace(stage);
    node = new AudioWorkletNode(context, 'clay-speech-pcm');
    var flushResolve;
    node.port.onmessage = function (event) {
      if (closed) return;
      if (event.data.pcm) onAudio(event.data.pcm);
      if (event.data.flushed && flushResolve) flushResolve();
    };
    source = context.createMediaStreamSource(stream);
    sink = context.createGain(); sink.gain.value = 0;
    source.connect(node); node.connect(sink); sink.connect(context.destination);
    stage = 'capturing'; trace('audio-connected', { state: context.state, sampleRate: context.sampleRate });
    return {
      abort: close,
      finish: async function () {
        if (closed) return;
        source.disconnect();
        await new Promise(function (resolve) {
          var timer = setTimeout(resolve, 250);
          flushResolve = function () { clearTimeout(timer); resolve(); };
          node.port.postMessage('flush');
        });
        close();
      }
    };
  } catch (error) { trace('audio-start-failed', { stage: stage, errorName: error.name }); close(); throw error; }
}

export function wavRecording(chunks) {
  var length = chunks.reduce(function (sum, chunk) { return sum + chunk.byteLength; }, 0);
  var header = new ArrayBuffer(44); var view = new DataView(header);
  function string(at, text) { for (var i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); }
  string(0, 'RIFF'); view.setUint32(4, 36 + length, true); string(8, 'WAVE'); string(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  string(36, 'data'); view.setUint32(40, length, true);
  return new Blob([header].concat(chunks), { type: 'audio/wav' });
}
