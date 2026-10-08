// Geometry adapted from PlantUML 1.2026.8 Salt, (c) Arnaud Roques, GPL-3.0-or-later.
// See LICENSES/plantuml-salt.txt. All distances retain reference fractional precision.
var text = require('./salt-text');
function measure(node) {
  measureNode(node);
  if (node.width > 8192 || node.height > 8192) throw Object.assign(new Error('Wireframe exceeds the 8192-pixel layout limit. Split it into smaller views.'), { status: 413 });
}
function measureNode(node) {
  if (node.type === 'sprite') return;
  if (node.type === 'span') { node.width = 0; node.height = 0; return; }
  if (node.type !== 'container') {
    var managed = /^(button|input|select)$/.test(node.type);
    node.label = text.measureLabel(node, managed);
    node.width = managed ? Math.max(node.label.width, node.charLength * 8) : node.label.width;
    node.height = node.label.height;
    if (node.type === 'button') { node.width += 9; node.height += 9; }
    if (node.type === 'input') { node.width += 6; node.height += 2; }
    if (node.type === 'select') { node.width += 16; node.height += 4; node.optionLabels = (node.options || []).map(function (option) { return text.measureLabel(option); }); }
    if (/^(radio|checkbox)$/.test(node.type)) node.width += 20;
    if (node.type === 'separator') { node.width = 10; node.height = 6; }
    return;
  }
  node.rows.forEach(function (row) { row.forEach(measure); });
  if (node.style[0] === 'T') return require('./salt-tree').measure(node);
  if (node.style === '/' || node.style === '*') {
    node.items = node.rows.flat();
    (node.popups || []).forEach(function (items) { items.slice(1).forEach(function (item) { measure(item); if (item.text === '-') { item.width = 10; item.height = 5; } }); });
    node.vertical = node.style === '/' && (node.verticalTabs || node.rows.length > 1);
    var gap = node.style === '/' ? 15 : 10;
    node.width = node.vertical ? Math.max(0, ...node.items.map(function (c) { return c.width; })) : node.items.reduce(function (sum, c) { return sum + c.width + gap; }, 0);
    node.height = node.vertical ? node.items.reduce(function (sum, c) { return sum + c.height + gap; }, 0) : Math.max(0, ...node.items.map(function (c) { return c.height; }));
    return;
  }
  node.titleLabel = node.title ? text.measureLabel(node.titleData || text.parseLabel(node.title)) : { width: 0, height: 0, runs: [] };
  var titleHeight = node.titleLabel.height;
  var cols = Math.max(1, ...node.rows.map(function (r) { return r.length; }));
  node.columns = Array(cols).fill(0);
  node.heights = Array(Math.max(1, node.rows.length)).fill(0);
  node.rows.forEach(function (row, r) {
    row.forEach(function (child, c) {
      if (child.type === 'span') return;
      if (!child.span) node.columns[c] = Math.max(node.columns[c], child.width + 2);
      node.heights[r] = Math.max(node.heights[r], child.height + 2 + (r === 0 ? titleHeight / 2 : 0));
    });
  });
  node.rows.forEach(function (row) { row.forEach(function (child, c) {
    if (!child.span) return;
    var available = node.columns.slice(c, c + child.span).reduce(function (a, b) { return a + b; }, 0);
    node.columns[c + child.span - 1] += Math.max(0, child.width + 2 - available);
  }); });
  node.xs = [0]; node.ys = [titleHeight / 2];
  node.columns.forEach(function (w) { node.xs.push(node.xs[node.xs.length - 1] + w); });
  node.heights.forEach(function (h) { node.ys.push(node.ys[node.ys.length - 1] + h); });
  node.width = node.xs[node.xs.length - 1];
  node.height = node.ys[node.ys.length - 1] + titleHeight;
  node.contentWidth = node.width; node.contentHeight = node.height;
  if (node.scroll && node.scroll !== 'S-') node.width += 30;
  if (node.scroll && node.scroll !== 'SI') node.height += 30;
}
module.exports = { measure: measure };
