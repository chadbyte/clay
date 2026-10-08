// Salt text layout uses the pinned reference metrics, without fonts or Java at runtime.
var fs = require('node:fs');
var path = require('node:path');
var zlib = require('node:zlib');
var profiles = {};
var colors = require('./assets/salt-colors.json');
var icons = require('./assets/salt-icons.json');
function color(value) {
  var hex = colors[value.toLowerCase()] || value.toUpperCase();
  if (!/^#(?:[A-F0-9]{3}|[A-F0-9]{6})$/.test(hex)) fail('Unsupported color: ' + value);
  return hex.replace(/^#(.)\1(.)\2(.)\3$/, '#$1$2$3');
}
function fail(message) { throw Object.assign(new Error(message), { status: 422 }); }
function parseLabel(value) {
  var heading = /^(={1,6})\s*(.*)$/.exec(value);
  var order = heading ? heading[1].length - 1 - (/^</.test(heading[2]) ? 1 : 0) : -1;
  var size = heading ? order <= 0 ? 16 : order === 1 ? 14 : order === 2 ? 13 : 12 : 12;
  if (heading) value = heading[2];
  var list = /^(\*+|#+)\s+(\S.*)$/.exec(value);
  if (list) value = list[2];
  value = value.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  value = value.replace(/<U\+([0-9a-f]{4,6})>/gi, function (_, cp) {
    var code = parseInt(cp, 16); if (code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) fail('Invalid Unicode code point.');
    return String.fromCodePoint(code);
  });
  var state = { color: '#000', bold: !!heading && order < 3, italic: !!heading && order >= 3, size: size };
  var runs = [];
  var formats = { '**': 'bold', '//': 'italic', '""': 'mono', '--': 'strike', '__': 'underline', '~~': 'wave' };
  var parts = value.split(/(<[^>]+>|\*\*|\/\/|""|--|__|~~)/g);
  parts.forEach(function (part, index) {
    if (!part) return;
    if (formats[part]) {
      var format = formats[part];
      var closing = parts.indexOf(part, index + 1);
      if (state[format] || closing > index && parts.slice(index + 1, closing).some(Boolean)) { state[format] = !state[format]; return; }
    }
    if (/^<&/.test(part)) {
      var icon = part.slice(2, -1); if (!icons[icon]) fail('Unknown built-in icon: ' + icon);
      runs.push(Object.assign({}, state, { text: '', icon: icon })); return;
    }
    if (/^<img:/i.test(part)) {
      var url = part.slice(5, -1);
      if (!/^https:\/\//i.test(url)) fail('Wireframe images require a public HTTPS URL.');
      runs.push(Object.assign({}, state, { text: '', imageUrl: url })); return;
    }
    var tag = /^<(\/?)(b|i|s|u|w|color|back|font|size)(?::([^>]+))?>$/i.exec(part);
    if (tag) {
      var name = tag[2].toLowerCase(); var end = !!tag[1];
      var key = { b: 'bold', i: 'italic', s: 'strike', u: 'underline', w: 'wave' }[name];
      if (key) { state[key] = !end; state[key + 'Color'] = !end && tag[3] ? color(tag[3]) : null; }
      else if (name === 'color') state.color = end ? '#000' : color(tag[3] || 'black');
      else if (name === 'back') state.background = end ? null : color(tag[3] || 'white');
      else if (name === 'font') { if (!end && !/^(monospaced?|sansserif|sans-serif)$/i.test(tag[3] || '')) fail('Unsupported font family.'); state.mono = !end && /^mono/i.test(tag[3]); }
      else if (name === 'size') { state.size = end ? size : Number(tag[3]); if ([10, 12, 13, 14, 16, 18, 20].indexOf(state.size) === -1) fail('Supported font sizes are 10, 12, 13, 14, 16, 18, and 20.'); }
      return;
    }
    if (/<\/?[a-z][^>]*>|<\$|\[\[/i.test(part)) fail('Unsupported embedded markup in wireframe text.');
    var previous = runs[runs.length - 1];
    if (previous && !previous.icon && !previous.imageUrl && JSON.stringify(Object.assign({}, previous, { text: '' })) === JSON.stringify(Object.assign({}, state, { text: '' }))) previous.text += part;
    else runs.push(Object.assign({}, state, { text: part }));
  });
  return { text: runs.map(function (r) { return r.text || r.icon || ''; }).join(''), runs: runs,
    list: list ? { type: list[1][0] === '*' ? 'bullet' : 'number', level: list[1].length } : null,
    bold: runs.some(function (r) { return r.bold; }), italic: runs.some(function (r) { return r.italic; }) };
}
function measureRun(run) {
  if (run.icon) return Object.assign({}, run, { width: 10, height: 8, descent: 0 });
  if (run.imageUrl) {
    if (!run.image) fail('Wireframe image was not resolved.');
    return Object.assign({}, run, { width: run.image.width, height: run.image.height, descent: 0 });
  }
  var profile = run.mono ? 'monospace' + (run.size && run.size !== 12 ? '-' + run.size : '') : !run.size || run.size === 12 ? 'metrics' : String(run.size);
  if (!profiles[profile]) profiles[profile] = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'assets/salt-font-' + profile + '.bin.gz')));
  var metrics = profiles[profile];
  var style = (run.bold ? 1 : 0) + (run.italic ? 2 : 0);
  var width = 0;
  var height = 0;
  var descent = 0;
  for (var c of run.text) {
    var cp = c.codePointAt(0);
    // Supplementary characters use the reference missing-glyph advance.
    if (cp > 65535) cp = 0xfffd;
    var offset = (style * 65536 + cp) * 12;
    width += metrics.readFloatBE(offset);
    height = Math.max(height, metrics.readFloatBE(offset + 4));
    descent = Math.max(descent, metrics.readFloatBE(offset + 8));
  }
  return Object.assign({}, run, { width: width, height: height, descent: descent });
}
function measureLabel(node, trim) {
  var runs = (node.runs || parseLabel(node.text || '').runs).map(function (r) { return Object.assign({}, r); });
  if (trim && runs.length) {
    runs[0].text = runs[0].text.trimStart();
    runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
  }
  runs = runs.filter(function (r) { return r.text || r.icon || r.imageUrl; });
  if (!runs.length) runs.push({ text: '\u00a0', bold: false, italic: false });
  runs = runs.filter(function (r) { return r.text || r.icon || r.imageUrl; }).map(function (r) {
    var measured = measureRun(r);
    var leading = /^ */.exec(r.text)[0];
    if (r.icon || r.imageUrl) return measured;
    measured.displayText = r.text.trim() || '\u00a0';
    measured.displayWidth = measureRun(Object.assign({}, r, { text: measured.displayText })).width;
    measured.leadingWidth = r.text.trim() ? measureRun(Object.assign({}, r, { text: leading })).width : 0;
    return measured;
  });
  var list = node.list;
  var indent = list ? list.type === 'number' ? measureRun({ text: '1. ', size: 12 }).width * list.level : list.level === 1 ? 12 : list.level * 8 : 0;
  return { runs: runs, list: list, indent: indent, width: indent + runs.reduce(function (sum, r) { return sum + r.width; }, 0),
    height: Math.max(0, runs.reduce(function (h, r) { return Math.max(h, r.height); }, 0)) };
}
module.exports = { color: color, icons: icons, parseLabel: parseLabel, measureLabel: measureLabel };
