import { store } from './store.js';

export function createSpeechMeter(id) {
  var element = document.createElement('span'); element.className = 'stt-meter';
  element.setAttribute('aria-hidden', 'true');
  var canvas = document.createElement('canvas'); element.appendChild(canvas);
  var context = canvas.getContext('2d'); var frame = null; var paintedAt = 0; var heights = [];
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function paint(time) {
    frame = null;
    var active = store.get('speechActive');
    if (!active || active.id !== id || !element.isConnected || !context) return;
    frame = requestAnimationFrame(paint);
    if (time - paintedAt < (reduced ? 100 : 32)) return;
    paintedAt = time;
    var width = element.clientWidth; var height = element.clientHeight;
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
    var style = getComputedStyle(element);
    var gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, style.getPropertyValue('--brand-green').trim() || style.color);
    gradient.addColorStop(0.5, style.getPropertyValue('--brand-blue').trim() || style.color);
    gradient.addColorStop(1, style.getPropertyValue('--brand-green').trim() || style.color);
    context.fillStyle = gradient;
    var signal = active.audioSignal; var levels = signal ? signal.levels : [];
    var age = signal ? Date.now() - signal.updatedAt : 0;
    var fade = Math.max(0, 1 - Math.max(0, age - 250) / 900);
    var columns = Math.max(2, Math.floor(width / 4));
    var span = Math.round(Math.min(160, Math.max(80, columns)) * 1.25);
    var drift = reduced ? 0 : Math.min(1, age / 20);
    for (var x = 0; x < columns; x++) {
      var position = levels.length - span + x / (columns - 1) * (span - 1) + drift;
      var index = Math.floor(position); var fraction = position - index;
      var a = levels[index] || 0; var b = levels[Math.min(index + 1, levels.length - 1)] || 0;
      var target = (a + (b - a) * fraction) * fade;
      var previous = heights[x] || 0;
      var level = reduced ? target : previous + (target - previous) * (target > previous ? 0.5 : 0.24);
      heights[x] = level;
      var extent = 1 + level * (height * 0.46 - 1);
      var edge = Math.min(1, (x + 1) / 8, (columns - x) / 8);
      for (var y = 0; y <= height * 0.48; y += 3.2) {
        var density = Math.exp(-Math.pow(y / extent, 2) * 1.7);
        if (density < 0.035) continue;
        var radius = 0.35 + density * 0.65;
        context.globalAlpha = (0.12 + density * 0.78) * edge;
        context.beginPath(); context.arc((x + 0.5) * width / columns, height / 2 + y, radius, 0, Math.PI * 2); context.fill();
        if (y) { context.beginPath(); context.arc((x + 0.5) * width / columns, height / 2 - y, radius, 0, Math.PI * 2); context.fill(); }
      }
    }
    context.globalAlpha = 1;
  }
  return { element: element, update: function (active) {
    element.hidden = !active;
    if (active && frame === null) frame = requestAnimationFrame(paint);
    if (!active && frame !== null) { cancelAnimationFrame(frame); frame = null; heights = []; }
  } };
}
