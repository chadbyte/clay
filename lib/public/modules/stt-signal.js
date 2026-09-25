import { store } from './store.js';

// Keep only a short perceptual envelope, never microphone samples.
export function sampleSpeechSignal(active, samples, sampleRate, divisor) {
  if (store.get('speechActive') !== active) return;
  var signal = active.audioSignal || (active.audioSignal = { levels: [], envelope: 0, updatedAt: 0 });
  var step = Math.max(1, Math.round(sampleRate / 50));
  for (var offset = 0; offset < samples.length; offset += step) {
    var end = Math.min(samples.length, offset + step); var energy = 0; var peak = 0;
    for (var i = offset; i < end; i++) {
      var value = Math.abs(samples[i] / divisor); energy += value * value; peak = Math.max(peak, value);
    }
    var amplitude = Math.sqrt(energy / (end - offset)) * 0.8 + peak * 0.2;
    var db = 20 * Math.log10(Math.max(0.000001, amplitude));
    var target = Math.max(0, Math.min(1, (db + 58) / 46));
    signal.envelope += (target - signal.envelope) * (target > signal.envelope ? 0.72 : 0.22);
    signal.levels.push(signal.envelope);
  }
  if (signal.levels.length > 240) signal.levels.splice(0, signal.levels.length - 240);
  signal.updatedAt = Date.now();
}

// Native recognition exposes no PCM; this local analyser supplies its visual feedback.
export function startBrowserSpeechSignal(active) {
  var Constructor = window.AudioContext || window.webkitAudioContext;
  if (!Constructor || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  var context; var source; var stream; var timer; var stopped = false; var closed = false;
  function closeContext() {
    if (context && !closed) { closed = true; context.close().catch(function () {}); }
  }
  function abort() {
    stopped = true; clearInterval(timer);
    if (source) { source.disconnect(); source = null; }
    if (stream) { stream.getTracks().forEach(function (track) { track.stop(); }); stream = null; }
    closeContext();
  }
  active.visualCapture = { abort: abort };
  try {
    context = new Constructor();
    var permission = navigator.mediaDevices.getUserMedia({ audio: true });
    permission.then(function (value) {
      stream = value;
      if (stopped || store.get('speechActive') !== active) abort();
    }, function () {});
    Promise.all([context.resume(), permission]).then(function () {
      if (stopped || store.get('speechActive') !== active) { abort(); return; }
      var analyser = context.createAnalyser(); analyser.fftSize = 2048;
      source = context.createMediaStreamSource(stream); source.connect(analyser);
      var samples = new Float32Array(analyser.fftSize);
      timer = setInterval(function () {
        if (store.get('speechActive') !== active) { abort(); return; }
        analyser.getFloatTimeDomainData(samples);
        sampleSpeechSignal(active, samples, samples.length * 50, 1);
      }, 20);
    }).catch(abort);
  } catch (error) { abort(); }
}
