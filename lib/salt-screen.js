// Optional Clay screen geometry. Plain Salt keeps its reference layout.
function fail(message) { throw Object.assign(new Error('Clay screen layout: ' + message), { status: 422 }); }
function parse(source) {
  var screen = null;
  var rules = Object.create(null);
  source.replace(/^[ \t]*'[ \t]*@clay-(canvas|layout)[ \t]+([^\r\n]*)/gm, function (_, kind, value) {
    if (kind === 'canvas') {
      if (screen) fail('use one canvas declaration.');
      var dimensions = /^(\d+)\s+(\d+)\s*$/.exec(value);
      if (!dimensions) fail('canvas requires width and height in pixels.');
      screen = { width: Number(dimensions[1]), height: Number(dimensions[2]), rules: rules };
      if (screen.width < 240 || screen.height < 240 || screen.width > 4096 || screen.height > 4096) fail('canvas dimensions must be 240–4096 pixels.');
    } else {
      var parts = value.trim().split(/\s+/);
      var key = parts.shift();
      if (!/^root(?:\.\d+\.\d+)*$/.test(key) || rules[key]) fail('layout paths must be unique, such as root.1.0.');
      var rule = {};
      parts.forEach(function (part) {
        var pair = /^(padding|gap|columns|rows)=(.+)$/.exec(part);
        if (!pair || rule[pair[1]] !== undefined) fail('use padding, gap, columns or rows once per layout.');
        if (/padding|gap/.test(pair[1])) {
          if (!/^\d+$/.test(pair[2]) || Number(pair[2]) > 128) fail('padding and gap must be 0–128 pixels.');
          rule[pair[1]] = Number(pair[2]);
        } else {
          var tracks = pair[2].split(',');
          if (tracks.length > 64 || tracks.some(function (track) { return !/^(auto|\*|\d+)$/.test(track) || (/^\d+$/.test(track) && (Number(track) < 1 || Number(track) > 4096)); })) fail('tracks must be auto, *, or 1–4096 pixels.');
          rule[pair[1]] = tracks;
        }
      });
      rules[key] = rule;
    }
    return '';
  });
  if (!screen && Object.keys(rules).length) fail('layout rules require a canvas declaration.');
  return screen;
}
function normal(node) { return node.type === 'container' && !/^[T/*]/.test(node.style) && !node.scroll; }
function tracks(spec, minimum, total, gap, name) {
  if (spec && spec.length !== minimum.length) fail(name + ' track count does not match its layout.');
  var sizes = minimum.map(function (min, i) {
    var track = spec ? spec[i] : 'auto';
    if (/^\d+$/.test(track) && Number(track) + .01 < min) fail(name + ' track ' + (i + 1) + ' needs at least ' + Math.ceil(min) + ' pixels.');
    return /^\d+$/.test(track) ? Number(track) : min;
  });
  if (total !== undefined) {
    var remaining = total - sizes.reduce(function (a, b) { return a + b; }, 0) - gap * (sizes.length - 1);
    if (remaining < -.01) fail(name + ' overflows by ' + Math.ceil(-remaining) + ' pixels. Increase the canvas/track or simplify its contents.');
    var flexible = sizes.map(function (_, i) { return spec && spec[i] === '*' ? i : -1; }).filter(function (i) { return i >= 0; });
    flexible.forEach(function (i) { sizes[i] += remaining / flexible.length; });
  }
  return sizes;
}
function prepare(node, screen, key, used) {
  if (!normal(node)) { if (screen.rules[key]) fail(key + ' must target a regular layout container.'); return; }
  var rule = screen.rules[key] || {};
  used.add(key);
  var padding = rule.padding === undefined ? 16 : rule.padding;
  var gap = rule.gap === undefined ? 12 : rule.gap;
  var columns = Array(node.columns.length).fill(0), rows = Array(node.rows.length).fill(0);
  node.rows.forEach(function (row, r) { row.forEach(function (child, c) {
    if (child.type === 'span') return;
    prepare(child, screen, key + '.' + r + '.' + c, used);
    if (!child.span) columns[c] = Math.max(columns[c], child.width);
    rows[r] = Math.max(rows[r], child.height);
  }); });
  node.rows.forEach(function (row) { row.forEach(function (child, c) {
    if (!child.span || child.type === 'span') return;
    var available = columns.slice(c, c + child.span).reduce(function (a, b) { return a + b; }, 0) + gap * (child.span - 1);
    columns[c + child.span - 1] += Math.max(0, child.width - available);
  }); });
  columns = tracks(rule.columns, columns, undefined, gap, key + ' columns');
  rows = tracks(rule.rows, rows, undefined, gap, key + ' rows');
  node.screen = { key: key, padding: padding, gap: gap, rule: rule, columns: columns, rows: rows };
  node.width = columns.reduce(function (a, b) { return a + b; }, 0) + gap * (columns.length - 1) + padding * 2;
  node.height = rows.reduce(function (a, b) { return a + b; }, 0) + gap * (rows.length - 1) + padding * 2 + node.titleLabel.height;
}
function place(node, width, height) {
  if (!node.screen) return;
  var box = node.screen, p = box.padding, gap = box.gap;
  node.width = width; node.height = height;
  var cols = tracks(box.rule.columns, box.columns, width - p * 2, gap, box.key + ' columns');
  var rows = tracks(box.rule.rows, box.rows, height - p * 2 - node.titleLabel.height, gap, box.key + ' rows');
  var y = p + node.titleLabel.height;
  box.cells = []; box.vertical = []; box.horizontal = [];
  node.rows.forEach(function (row, r) {
    var x = p;
    row.forEach(function (child, c) {
      if (child.type !== 'span') {
        var w = cols.slice(c, c + (child.span || 1)).reduce(function (a, b) { return a + b; }, 0) + gap * ((child.span || 1) - 1);
        var yy = child.type === 'container' ? y : y + Math.max(0, (rows[r] - child.height) / 2);
        if (child.type === 'input') child.width = w;
        box.cells.push({ node: child, x: x, y: yy, width: w, height: rows[r] });
        place(child, w, rows[r]);
        if (c > 0) box.vertical.push({ x: x - gap / 2, y: y - gap / 2, height: rows[r] + gap });
      }
      x += cols[c] + gap;
    });
    if (r > 0) box.horizontal.push(y - gap / 2);
    y += rows[r] + gap;
  });
}
function apply(root) {
  var screen = root.options.screen;
  if (!screen) return;
  if (!normal(root)) fail('the canvas needs a regular outer container.');
  if (root.options.scale !== 1 || ['title', 'header', 'footer', 'caption', 'legend'].some(function (key) { return root.options[key]; })) fail('put headings inside the canvas; scale and outside annotations are not supported in screen mode.');
  var used = new Set(); prepare(root, screen, 'root', used);
  Object.keys(screen.rules).forEach(function (key) { if (!used.has(key)) fail('no container at ' + key + '.'); });
  place(root, screen.width - 2, screen.height - 2);
}
module.exports = { parse: parse, apply: apply };
