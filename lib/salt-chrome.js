// Diagram decoration geometry adapted from PlantUML 1.2026.8 (GPL-3.0-or-later).
var text = require('./salt-text');
function decorate(root, draw, shapes) {
  var options = root.options || {};
  var block = { width: root.width, height: root.height, draw: draw };
  function add(name, top) {
    if (!options[name]) return;
    var small = name === 'header' || name === 'footer';
    var padding = name === 'title' || name === 'legend' ? 5 : 0;
    var margin = name === 'legend' ? 12 : name === 'title' ? 5 : name === 'caption' ? 1 : 0;
    var labels = options.labels[name].map(function (parsed) {
      parsed.runs.forEach(function (run) { run.size = small ? 10 : 14; run.bold = name === 'title' || run.bold; run.color = small ? '#888' : run.color; });
      return text.measureLabel(parsed);
    });
    var textWidth = Math.max.apply(null, labels.map(function (label) { return label.width; }));
    var textHeight = labels.reduce(function (sum, label) { return sum + label.height; }, 0);
    var width = textWidth + 2 * (padding + margin) + 1;
    var height = textHeight + 2 * (padding + margin) + 1;
    var previous = block;
    block = { width: Math.max(previous.width, width), height: previous.height + height, draw: function (x, y) {
      var bx = x + (name === 'header' ? blockWidth - width : (blockWidth - width) / 2);
      var by = y + (top ? 0 : previous.height);
      previous.draw(x + (blockWidth - previous.width) / 2, y + (top ? height : 0));
      if (name === 'legend') shapes.rect(bx + margin, by + margin, textWidth + 2 * padding, textHeight + 2 * padding, '#DDD', '#000', 7.5);
      var yy = by + padding + margin;
      labels.forEach(function (label) {
        var offset = name === 'legend' ? 0 : name === 'header' ? textWidth - label.width : (textWidth - label.width) / 2;
        shapes.label(label, bx + margin + padding + offset, yy); yy += label.height;
      });
    } };
    var blockWidth = block.width;
  }
  add('legend', false); add('title', true); add('caption', false); add('header', true); add('footer', false);
  return block;
}
module.exports = { decorate: decorate };
