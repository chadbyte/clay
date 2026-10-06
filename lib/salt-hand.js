// Adapted from PlantUML HandJiggle/URectangleHand by Adrian Vogt, GPL-3.0-or-later.
// See LICENSES/plantuml-salt.txt. Each translated reference graphic resets its seed.
function jiggle(x, y, variation) {
  var seed = (424242n ^ 25214903917n) & ((1n << 48n) - 1n);
  function bits(n) { seed = (seed * 25214903917n + 11n) & ((1n << 48n) - 1n); return Number(seed >> BigInt(48 - n)); }
  function random() { return (bits(26) * 134217728 + bits(27)) / 9007199254740992; }
  var points = [[x, y]];
  function lineTo(xx, yy) {
    var dx = Math.abs(xx - x); var dy = Math.abs(yy - y); var distance = Math.hypot(dx, dy);
    if (distance < 0.001) return;
    var segments = Math.round(distance / 10); var amount = variation;
    if (segments < 5) { segments = 5; amount /= 3; }
    for (var i = 0; i < segments; i++) {
      var offset = (random() - 0.5) * amount;
      points.push([x + (xx - x) / segments * i - offset * dy / distance, y + (yy - y) / segments * i - offset * dx / distance]);
    }
    points.push([xx, yy]); x = xx; y = yy;
  }
  function arc(a, b, cx, cy, rx, ry) {
    [(a + b) / 2, b].forEach(function (angle) { lineTo(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry); });
  }
  return { points: points, lineTo: lineTo, arc: arc };
}
function line(dx, dy) { var j = jiggle(0, 0, 2); j.lineTo(dx, dy); return j.points; }
function rect(w, h, radius) {
  var rx = Math.min(radius || 0, w / 2); var ry = Math.min(radius || 0, h / 2);
  var j = jiggle(rx, 0, 1.5);
  if (!radius) { j.lineTo(w, 0); j.lineTo(w, h); j.lineTo(0, h); j.lineTo(0, 0); }
  else {
    j.lineTo(w - rx, 0); j.arc(-Math.PI / 2, 0, w - rx, ry, rx, ry);
    j.lineTo(w, h - ry); j.arc(0, Math.PI / 2, w - rx, h - ry, rx, ry);
    j.lineTo(rx, h); j.arc(Math.PI / 2, Math.PI, rx, h - ry, rx, ry);
    j.lineTo(0, ry); j.arc(Math.PI, Math.PI * 1.5, rx, ry, rx, ry);
  }
  return j.points;
}
module.exports = { line: line, rect: rect };
