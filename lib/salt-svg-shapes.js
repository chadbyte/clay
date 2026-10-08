// Reference SVG primitives; text is escaped and images contain resolved PNG bytes.
function escape(value) { return String(value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]; }); }
function createShapes(out, scale, handwritten) {
  scale = scale || 1;
  function number(value) { return String(Math.round(value * scale * 1000) / 1000); }
  var ink = '#000';
  var bounds = { x: 0, y: 0 };
  var filters = Object.create(null);
  function include(x, y) { bounds.x = Math.max(bounds.x, x); bounds.y = Math.max(bounds.y, y); }
  function rect(x, y, w, h, fill, stroke, radius, thickness) {
    include(x + w, y + h);
    if (handwritten) {
      var points = require('./salt-hand').rect(w, h, radius).map(function (p) { return [p[0] + x, p[1] + y]; });
      out.push('<polygon points="' + points.map(function (p) { return p.map(number).join(','); }).join(' ') + '" fill="' + (fill || 'none') + '" stroke="' + (stroke || '#000') + '" stroke-width="' + number(thickness || 1) + '" stroke-linejoin="miter" stroke-miterlimit="10"/>'); return;
    }
    out.push('<rect x="' + number(x) + '" y="' + number(y) + '" width="' + number(w) + '" height="' + number(h) + '" fill="' + (fill || 'none') + '" stroke="' + (stroke || '#000') + '" stroke-width="' + number(thickness || 1) + '"' + (radius ? ' rx="' + number(radius) + '" ry="' + number(radius) + '"' : '') + '/>');
  }
  function line(x, y, xx, yy, stroke, thickness, dash) {
    include(x, y); include(xx, yy);
    if (handwritten) {
      var points = require('./salt-hand').line(xx - x, yy - y);
      out.push('<path d="' + points.map(function (p, i) { return (i ? 'L' : 'M') + number(p[0] + x) + ',' + number(p[1] + y); }).join(' ') + '" fill="none" stroke="' + (stroke || '#000') + '" stroke-width="' + number(thickness || 1) + '"/>'); return;
    }
    out.push('<line x1="' + number(x) + '" y1="' + number(y) + '" x2="' + number(xx) + '" y2="' + number(yy) + '" stroke="' + (stroke || '#000') + '" stroke-width="' + number(thickness || 1) + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>');
  }
  function ellipse(x, y, w, h, fill) {
    include(x + w, y + h);
    out.push('<ellipse cx="' + number(x + w / 2) + '" cy="' + number(y + h / 2) + '" rx="' + number(w / 2) + '" ry="' + number(h / 2) + '" fill="' + (fill || 'none') + '" stroke="#000" stroke-width="' + number(1.5) + '"/>');
  }
  function polygon(points, thickness) {
    points.forEach(function (p) { include(p[0], p[1]); });
    out.push('<polygon points="' + points.map(function (p) { return p.map(number).join(','); }).join(' ') + '" fill="#000" stroke="#000" stroke-linejoin="miter" stroke-miterlimit="10" stroke-width="' + number(thickness || 1) + '"/>');
  }
  function path(d, fill, stroke, maxX, maxY) {
    include(maxX, maxY);
    out.push('<path d="' + d.replace(/-?\d+(?:\.\d+)?/g, function (n) { return number(Number(n)); }) + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + number(1) + '"' : '') + '/>');
  }
  function label(label, x, y) {
    include(x + label.width, y + label.height - Math.min(...label.runs.map(function (r) { return r.descent || 0; })));
    if (label.list) {
      var level = label.list.level;
      if (label.list.type === 'number') {
        var prefix = require('./salt-text').measureLabel(require('./salt-text').parseLabel('1. '));
        var start = x + label.indent - prefix.width;
        labelText(prefix.runs[0], start, y + label.height - prefix.runs[0].descent);
      } else if (level === 1) out.push('<ellipse cx="' + number(x + 5.5) + '" cy="' + number(y + label.height - 7.5) + '" rx="' + number(2.5) + '" ry="' + number(2.5) + '" fill="#000"/>');
      else out.push('<rect x="' + number(x + level * 8 - 7) + '" y="' + number(y + label.height - 10) + '" width="' + number(3.5) + '" height="' + number(3.5) + '" fill="#000"/>');
      x += label.indent;
    }
    label.runs.forEach(function (run) {
      ink = run.color || '#000';
      if (run.icon) {
        var iy = y + Math.max(0, label.height - 11);
        require('./salt-text').icons[run.icon].forEach(function (d) {
          var axis = 0;
          var moved = d.replace(/-?\d+(?:\.\d+)?/g, function (n) { return number(Number(n) + (axis++ % 2 ? iy - 6 : x - 6)); });
          out.push('<path d="' + moved + '" fill="' + (run.color || '#000') + '"/>');
        });
      }
      if (run.image) out.push('<image x="' + number(x) + '" y="' + number(y + label.height - run.height) + '" width="' + number(run.width) + '" height="' + number(run.height) + '" href="' + run.image.data + '"/>');
      if (run.displayText) labelText(run, x, y + label.height - run.descent);
      x += run.width;
    });
  }
  function labelText(run, x, baseline) {
    var decoration = run.wave ? 'wavy underline' : run.underline && !run.underlineColor ? 'underline' : run.strike && !run.strikeColor ? 'line-through' : '';
    var filter = '';
    if (run.background) {
      var id = filters[run.background];
      if (!id) { id = 'salt-back-' + Object.keys(filters).length; filters[run.background] = id; out.push('<defs><filter id="' + id + '" x="0" y="0" width="1" height="1"><feFlood flood-color="' + run.background + '" result="flood"/><feComposite in="SourceGraphic" in2="flood" operator="over"/></filter></defs>'); }
      filter = ' filter="url(#' + id + ')"';
    }
    out.push('<text x="' + number(x + run.leadingWidth) + '" y="' + number(baseline) + '" fill="' + (run.color || '#000') + '" font-size="' + number(run.size || 12) + '"' + (run.displayText.length > 1 ? ' textLength="' + number(run.displayWidth) + '"' : '') + (run.bold ? ' font-weight="700"' : '') + (run.italic ? ' font-style="italic"' : '') + (run.mono ? ' font-family="monospace"' : '') + (decoration ? ' text-decoration="' + decoration + '"' : '') + filter + '>' + escape(run.displayText) + '</text>');
    var size = run.size || 12;
    if (run.strike && run.strikeColor) line(x + run.leadingWidth, baseline - size / 4, x + run.leadingWidth + run.displayWidth, baseline - size / 4, run.strikeColor, size / 28);
    if (run.underline && run.underlineColor) line(x + run.leadingWidth, baseline + size / 14, x + run.leadingWidth + run.displayWidth, baseline + size / 14, run.underlineColor, size / 28);
  }
  return { lastInk: function () { return ink; }, path: path, bounds: bounds, rect: rect, line: line, ellipse: ellipse, polygon: polygon, label: label };
}
module.exports = { createShapes: createShapes };
