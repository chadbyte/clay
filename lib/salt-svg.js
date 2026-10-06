// Geometry adapted from PlantUML 1.2026.8 Salt, (c) Arnaud Roques, GPL-3.0-or-later.
// See LICENSES/plantuml-salt.txt. Rendering is local and bounded; image bytes are pre-resolved.
var layout = require('./salt-layout');
var shapes = require('./salt-svg-shapes');
var overlays = require('./salt-overlays');
function renderSaltSvg(root) {
  layout.measure(root);
  require('./salt-screen').apply(root);
  var out = [];
  var scale = (root.options || {}).scale || 1;
  var s = shapes.createShapes(out, scale, (root.options || {}).handwritten);
  var front = [];
  function grid(node, x, y) {
    var horizontal = new Set();
    var vertical = new Set();
    var rows = node.heights.length;
    var cols = node.columns.length;
    var style = node.style;
    if (/[+#^]/.test(style)) {
      for (var c = 0; c < cols; c++) { horizontal.add('0,' + c); horizontal.add(rows + ',' + c); }
      for (var r = 0; r < rows; r++) { vertical.add(r + ',0'); vertical.add(r + ',' + cols); }
    }
    node.rows.forEach(function (row, r) {
      row.forEach(function (child, c) {
        if (child.type === 'span') return;
        var end = c + (child.span || 1);
        if (/[#-]/.test(style)) for (var cc = c; cc < end; cc++) { horizontal.add(r + ',' + cc); horizontal.add((r + 1) + ',' + cc); }
        if (/[#!]/.test(style)) { vertical.add(r + ',' + c); vertical.add(r + ',' + end); }
      });
    });
    function referenceOrder(set) {
      var capacity = 16;
      while (set.size > capacity * 0.75) capacity *= 2;
      function bucket(key) {
        var p = key.split(',').map(Number);
        var hash = p[0] * 47 + p[1];
        return (hash ^ (hash >>> 16)) & (capacity - 1);
      }
      return Array.from(set).sort(function (a, b) { return bucket(a) - bucket(b); });
    }
    referenceOrder(horizontal).forEach(function (key) {
      var p = key.split(',').map(Number);
      s.line(x + node.xs[p[1]], y + node.ys[p[0]], x + node.xs[p[1] + 1], y + node.ys[p[0]]);
    });
    referenceOrder(vertical).forEach(function (key) {
      var p = key.split(',').map(Number);
      s.line(x + node.xs[p[1]], y + node.ys[p[0]], x + node.xs[p[1]], y + node.ys[p[0] + 1]);
    });
    if (node.title) {
      s.rect(x + 6, y, node.titleLabel.width, node.titleLabel.height, '#FFF', '#FFF');
      s.label(node.titleLabel, x + 6, y);
    }
  }
  function tabs(node, x, y) {
    var offset = 0;
    node.items.forEach(function (child) {
      var w = child.width;
      var h = child.height;
      if (node.vertical) {
        s.label(child.label, x, y + offset + 2);
        s.line(x, y + offset, x + node.width, y + offset);
        s.line(x, y + offset, x, y + offset + h + 5);
        s.line(x, y + offset + h + 5, x + node.width, y + offset + h + 5);
        s.line(x + node.width, y + offset + h + 5, x + node.width, y + offset + h + 15);
        offset += h + 15;
      } else {
        s.label(child.label, x + offset + 2, y);
        s.line(x + offset, y, x + offset, y + h);
        s.line(x + offset, y, x + offset + w + 5, y);
        s.line(x + offset + w + 5, y, x + offset + w + 5, y + h);
        s.line(x + offset + w + 5, y + h, x + offset + w + 15, y + h);
        offset += w + 15;
      }
    });
  }
  function draw(node, x, y, w, h) {
    if (node.screen) {
      if (/[+#^]/.test(node.style)) s.rect(x, y, w, h);
      if (node.title) s.label(node.titleLabel, x + node.screen.padding, y + 2);
      if (/[#-]/.test(node.style)) node.screen.horizontal.forEach(function (yy) { s.line(x, y + yy, x + w, y + yy, '#AAA'); });
      if (/[#!]/.test(node.style)) node.screen.vertical.forEach(function (line) { s.line(x + line.x, y + line.y, x + line.x, y + line.y + line.height, '#AAA'); });
      node.screen.cells.forEach(function (cell) { draw(cell.node, x + cell.x, y + cell.y, cell.width, cell.height); });
      return;
    }
    if (node.type === 'container') {
      if (node.style[0] === 'T') return require('./salt-tree').draw(node, x, y, s, draw);
      if (node.style === '/') return tabs(node, x, y);
      if (node.style === '*') {
        s.rect(x, y, w, h, '#DDD');
        var mx = x;
        node.items.forEach(function (child) { s.label(child.label, mx, y); mx += child.width + 10; });
        front.push(function () { overlays.menu(node, x, y, s); });
        return;
      }
      node.rows.forEach(function (row, r) {
        row.forEach(function (child, c) {
          if (child.type === 'span') return;
          draw(child, x + node.xs[c] + 1, y + node.ys[r] + 1 + (r === 0 ? node.titleLabel.height / 2 : 0), node.xs[c + (child.span || 1)] - node.xs[c] - 1, node.heights[r] - 1);
        });
      });
      grid(node, x, y);
      if (node.scroll) { overlays.scroll(node, x, y, s); front.push(function () { overlays.scroll(node, x, y, s); }); }
      return;
    }
    if (node.type === 'space') return;
    if (node.type === 'sprite') {
      for (var xx = 0; xx < node.width; xx++) for (var yy = 0; yy < node.height; yy++) {
        if (node.pixels[yy][xx] === 'X') s.rect(x + xx, y + yy, 0.5, 0.5, s.lastInk() || '#000', '#000', 0, 0.5);
      }
      return;
    }
    if (node.type === 'separator') {
      var yy = y + h / 2 - (node.style === '==' ? 1 : 0);
      s.line(x, yy, x + w, yy, '#AAA', node.style === '~~' ? 1.5 : 1, node.style === '..' ? '1,2' : null);
      if (node.style === '==') s.line(x, yy + 2, x + w, yy + 2, '#AAA');
      return;
    }
    var label = node.label;
    if (node.type === 'button') {
      s.rect(x + 2.5, y + 2.5, node.width - 5, node.height - 5, '#EEE', '#000', 5, 2.5);
      s.label(label, x + (node.width - label.width) / 2, y + 4.5);
    } else if (node.type === 'input') {
      s.label(label, x + 3, y);
      s.line(x + 1, y + label.height, x + node.width - 2, y + label.height);
      s.line(x + 1, y + label.height - 3, x + 1, y + label.height - 1);
      s.line(x + node.width - 2, y + label.height - 3, x + node.width - 2, y + label.height - 1);
    } else if (node.type === 'select') {
      s.rect(x, y, node.width - 1, node.height - 1, '#EEE');
      s.label(label, x + 2, y + 2);
      var xx = x + node.width - 12;
      s.line(xx, y, xx, y + node.height - 1);
      s.polygon([[xx + 3, y + 6], [xx + 9, y + 6], [xx + 6, y + label.height - 2]]);
      overlays.dropdown(node, x, y, s);
      front.push(function () { overlays.dropdown(node, x, y, s); });
    } else if (node.type === 'checkbox' || node.type === 'radio') {
      s.label(label, x + 20, y);
      if (node.type === 'radio') {
        s.ellipse(x + 2, y + (node.height - 10) / 2, 10, 10);
        if (node.checked) s.ellipse(x + 5, y + (node.height - 4) / 2, 4, 4, '#000');
      } else {
        s.rect(x + 2, y + (node.height - 10) / 2, 10, 10, 'none', '#000', 0, 1.5);
        if (node.checked) s.polygon([[x + 3, y + 6], [x + 6, y + 9], [x + 13, y], [x + 6, y + 7]], 1.5);
      }
    } else s.label(label, x, y);
  }
  var decorated = require('./salt-chrome').decorate(root, function (x, y) { draw(root, x, y, root.width, root.height); }, s);
  decorated.draw(root.options.screen ? 1 : 5, root.options.screen ? 1 : 5);
  front.forEach(function (drawOverlay) { drawOverlay(); });
  var margin = out.length ? 1 : 0;
  var width = Math.floor(Math.max(decorated.width + 10, s.bounds.x) + margin);
  var height = Math.floor(Math.max(decorated.height + 10, s.bounds.y) + margin);
  if (root.options.screen) {
    width = root.options.screen.width; height = root.options.screen.height;
    if (s.bounds.x > width || s.bounds.y > height) throw Object.assign(new Error('Clay screen layout: drawing extends outside the canvas. Increase its dimensions or simplify the contents.'), { status: 422 });
  }
  width = Math.round(width * scale * 1000) / 1000; height = Math.round(height * scale * 1000) / 1000;
  if (width > 8192 || height > 8192) throw Object.assign(new Error('Wireframe exceeds the 8192-pixel canvas limit.'), { status: 413 });
  var background = (root.options || {}).background || '#FFFFFF';
  if (background !== '#FFFFFF') out.unshift('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="' + background + '" stroke="none"/>');
  out.unshift('<svg xmlns="http://www.w3.org/2000/svg"' + (root.options.screen ? ' data-clay-screen="true"' : '') + ' width="' + width + '" height="' + height + '" viewBox="0 0 ' + Math.floor(width) + ' ' + Math.floor(height) + '" preserveAspectRatio="none" style="width:' + Math.floor(width) + 'px;height:' + Math.floor(height) + 'px;background:' + ((root.options || {}).background || '#FFFFFF') + '" role="img" aria-label="Wireframe"><g font-family="sans-serif" lengthAdjust="spacing">');
  out.push('</g></svg>');
  return out.join('');
}
module.exports = { renderSaltSvg: renderSaltSvg };
