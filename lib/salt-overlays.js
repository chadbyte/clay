// Adapted from PlantUML Salt controls, GPL-3.0-or-later; see LICENSES/plantuml-salt.txt.
function dropdown(node, x, y, s) {
  var labels = node.optionLabels || [];
  if (!labels.length) return;
  var width = Math.max(node.width - 1, ...labels.map(function (l) { return l.width; }));
  var height = labels.reduce(function (a, l) { return a + l.height; }, 0);
  y += node.height - 1;
  s.rect(x, y, width - 1, height - 1, '#EEE');
  labels.forEach(function (label) { s.label(label, x, y); y += label.height; });
}
function menu(node, x, y, s) {
  (node.popups || []).forEach(function (items) {
    var offset = 0;
    for (var entry of node.items) { if (entry.text === items[0].text) break; offset += entry.width + 10; }
    var children = items.slice(1);
    var width = Math.max(0, ...children.map(function (item) { return item.width; }));
    var height = children.reduce(function (a, item) { return a + item.height; }, 0);
    var cy = y + node.height;
    s.rect(x + offset, cy, width, height, '#DDD');
    children.forEach(function (item) {
      if (item.text === '-') s.line(x + offset, cy + item.height / 2, x + offset + width, cy + item.height / 2);
      else s.label(item.label, x + offset, cy);
      cy += item.height;
    });
  });
}
function scroll(node, x, y, s) {
  var w = node.contentWidth; var h = node.contentHeight;
  function triangle(xx, yy, points) { s.path(points.map(function (p, i) { return (i ? 'L' : 'M') + (xx + p[0]) + ',' + (yy + p[1]); }).join(' ') + '', '#000', null, xx + 6, yy + 6); }
  if (node.scroll !== 'S-') {
    var vx = x + w + 4;
    s.rect(vx, y, 15, h);
    s.line(vx, y + 12, vx + 15, y + 12); s.line(vx, y + h - 12, vx + 15, y + h - 12);
    triangle(vx + 4, y + 4, [[3,0],[6,5],[0,5],[3,0]]);
    triangle(vx + 4, y + h - 8, [[3,5],[6,0],[0,0],[3,5]]);
  }
  if (node.scroll !== 'SI') {
    var hy = y + h + 4;
    s.rect(x, hy, w, 15);
    s.line(x + 12, hy, x + 12, hy + 15); s.line(x + w - 12, hy, x + w - 12, hy + 15);
    triangle(x + 4, hy + 4, [[0,3],[5,6],[5,0],[0,3]]);
    triangle(x + w - 8, hy + 4, [[5,3],[0,6],[0,0],[5,3]]);
  }
}
module.exports = { dropdown: dropdown, menu: menu, scroll: scroll };
