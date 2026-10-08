// Adapted from PlantUML Salt ElementTree, GPL-3.0-or-later; see LICENSES/plantuml-salt.txt.
function measure(node) {
  node.columns = [];
  node.heights = [];
  node.rows.forEach(function (row) {
    row.forEach(function (item, c) { node.columns[c] = Math.max(node.columns[c] || 0, item.width + (c ? 0 : (item.level || 0) * 10)); });
    node.heights.push(Math.max(0, ...row.map(function (item) { return item.height; })));
  });
  node.width = node.columns.reduce(function (a, b) { return a + b; }, 0) + Math.max(0, node.columns.length - 1) * 10 + 2;
  node.height = node.heights.reduce(function (a, b) { return a + b; }, 0);
}
function draw(node, x, y, s, drawChild) {
  var cy = y;
  var skeleton = [];
  var rows = [y];
  var cols = [x, x + (node.columns[0] || 0) + 5];
  node.columns.slice(1).forEach(function (width) { cols.push(cols[cols.length - 1] + width + 10); });
  node.rows.forEach(function (row, r) {
    var cx = x;
    row.forEach(function (item, c) {
      drawChild(item, c ? cx : x + (item.level || 0) * 10, cy, item.width, item.height);
      cx += node.columns[c] + 10;
    });
    skeleton.push({ x: x + (row[0].level || 0) * 10 - 7, y: cy + node.heights[r] / 2 - 1 });
    cy += node.heights[r]; rows.push(cy);
  });
  skeleton.forEach(function (item, i) {
    if (skeleton[i + 1] && skeleton[i + 1].x > item.x) s.rect(item.x, item.y, 2, 2, 'none', '#888');
    var parent;
    for (var j = 0; j < i; j++) if (skeleton[j].x < item.x) parent = skeleton[j];
    if (parent) {
      s.line(parent.x + 1, parent.y + 3, parent.x + 1, item.y + 1, '#888');
      s.line(parent.x + 1, item.y + 1, item.x - 1, item.y + 1, '#888');
    }
  });
  var mode = node.style.slice(1);
  var right = cols[cols.length - 1];
  if (mode === '+') {
    s.line(x, y, right, y, '#888'); s.line(x, cy, right, cy, '#888');
    s.line(x, y, x, cy, '#888'); s.line(right, y, right, cy, '#888');
  }
  if (/[#-]/.test(mode)) rows.forEach(function (yy) { s.line(x, yy, right, yy, '#888'); });
  if (/[#!]/.test(mode)) cols.forEach(function (xx) { s.line(xx, y, xx, cy, '#888'); });
}
module.exports = { measure: measure, draw: draw };
