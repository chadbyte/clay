// Downsample microphone audio to mono 16 kHz PCM without retaining the recording.
class SpeechPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = []; this.phase = 0; this.sum = 0; this.count = 0;
    this.port.onmessage = function (event) {
      if (event.data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }); }
    }.bind(this);
  }
  flush() {
    if (!this.samples.length) return;
    var pcm = new Int16Array(this.samples); this.samples = [];
    this.port.postMessage({ pcm: pcm.buffer }, [pcm.buffer]);
  }
  process(inputs) {
    var channels = inputs[0];
    if (!channels || !channels[0]) return true;
    for (var i = 0; i < channels[0].length; i++) {
      var value = 0;
      for (var c = 0; c < channels.length; c++) value += channels[c][i] / channels.length;
      this.sum += value; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        var sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.samples.push(Math.round(sample * (sample < 0 ? 32768 : 32767)));
        this.phase -= sampleRate; this.sum = 0; this.count = 0;
      }
      if (this.samples.length >= 1600) this.flush();
    }
    return true;
  }
}
registerProcessor('clay-speech-pcm', SpeechPCMProcessor);
