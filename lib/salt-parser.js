// Clay's bounded parser for Salt wireframes; no PlantUML preprocessor execution.
function fail(message) { throw Object.assign(new Error(message), { status: 422 }); }
function tokenize(body) {
  var tokens = [];
  var text = '';
  var quoted = false;
  function flush() { if (text.trim()) tokens.push({ type: 'text', text: text.trim() }); text = ''; }
  for (var i = 0; i < body.length; i++) {
    var c = body[i];
    if (c === '"') quoted = !quoted;
    if (!quoted && (c === '{' || c === '}' || c === '|' || c === '\n')) {
      flush();
      var token = { type: c };
      if (c === '{') {
        token.style = '';
        if (/[#!+\-^/*ST]/.test(body[i + 1] || ' ')) token.style = body[++i];
        if (token.style === 'S' && /[I-]/.test(body[i + 1] || ' ')) token.style += body[++i];
        if (token.style === 'T' && /[!+#-]/.test(body[i + 1] || ' ')) token.style += body[++i];
        if (token.style === '^') {
          var title = /^[ \t]*"([^"\n]*)"/.exec(body.slice(i + 1));
          if (title) { token.title = title[1]; i += title[0].length; }
          else { var unquoted = /^[^\n|{}]*/.exec(body.slice(i + 1))[0]; token.title = unquoted.trim(); i += unquoted.length; }
        }
        if (body[i + 1] && !/[\s{}|]/.test(body[i + 1]) && !token.style) {
          fail('Unsupported Salt container. Use {, {+, {#, {!, {-, {^, {/, or {*.');
        }
      }
      tokens.push(token);
    } else text += c;
  }
  if (quoted) fail('Unclosed quoted text field.');
  flush();
  return tokens;
}

function label(text) {
  return require('./salt-text').parseLabel(text);
}
function widget(text) {
  var result = { type: 'label' };
  var match;
  if (text === '*') return { type: 'span' };
  if (/^[.!]?$/.test(text)) result.type = 'space';
  else if (/^(\.\.|==|~~|--).*\1$/.test(text) || /^(\.\.|==|~~|--)$/.test(text)) { result.type = 'separator'; result.style = text.slice(0, 2); text = ''; }
  else if ((match = /^\[([ X]?)\]\s*(.*)$/.exec(text))) { result.type = 'checkbox'; result.checked = /x/i.test(match[1]); text = match[2]; }
  else if ((match = /^\(([ X]?)\)\s*(.*)$/.exec(text))) { result.type = 'radio'; result.checked = /x/i.test(match[1]); text = match[2]; }
  else if ((match = /^\[([^\]]+)\]$/.exec(text))) { result.type = 'button'; text = match[1]; }
  else if ((match = /^"([^"\n]*)"$/.exec(text))) { result.type = 'input'; text = match[1]; }
  else if (/^\^.*\^$/.test(text)) {
    var choices = text.slice(1, -1).split('^').filter(Boolean);
    result.type = 'select'; result.options = choices.slice(1).map(label); text = choices[0] || '';
  }
  else if (!/^\[x\]/.test(text) && /^[\["^]|^\*/.test(text) && !/^\*\*[^*]+\*\*$/.test(text) && !/^\*+\s+/.test(text)) fail('Unsupported or incomplete control: ' + text.slice(0, 60));
  if (text === '*') return { type: 'span' };
  result.charLength = text.replace(/<&[-\w]+>/g, '00').replace(/<\/?(?:b|i|s|u|w|color|back|font|size)(?::[^>]+)?>/gi, '').length;
  return Object.assign(result, label(/^(button|input|select)$/.test(result.type) ? text.trim() : text));
}

function parseSalt(source) {
  var screen = require('./salt-screen').parse(source);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source)) fail("Wireframe source contains unsupported control characters.");
  var body;
  var match = /^\s*@startsalt(?:[ \t]+[\w-]+)?[ \t]*\r?\n([\s\S]*?)\r?\n\s*@endsalt\s*$/i.exec(source);
  if (match) body = match[1];
  else {
    match = /^\s*@startuml(?:[ \t]+[\w-]+)?[ \t]*\r?\n\s*salt\s*\r?\n([\s\S]*?)\r?\n\s*@enduml\s*$/i.exec(source);
    if (match) body = match[1];
  }
  if (body === undefined) fail('The built-in viewer supports Salt wireframes. Use @startsalt / @endsalt around a layout. Other PlantUML diagram types are not supported.');
  body = body.replace(/^[ \t]*'[^\n]*$/gm, '').replace(/\r/g, '');
  var settings = require('./salt-options').parse(body);
  body = settings.body;
  if (/^[ \t]*(?:!|skinparam\b|scale\b|sprite\b)|%[a-z_]+\s*\(/im.test(body)) fail('PlantUML preprocessing, includes, macros, and unrecognized directives are not supported in built-in wireframes.');
  var sprites = Object.create(null);
  var spriteCount = 0;
  body = body.replace(/<<([\w]*)\s*\n([.X\s]+?)\n\s*>>/g, function (_, name, pixels) {
    var rows = pixels.trim().split(/\n/).map(function (line) { return line.trim(); });
    if (!rows.length || rows.some(function (line) { return !/^[.X]+$/.test(line) || line.length !== rows[0].length; })) fail('Sprite rows must have equal widths and contain only . or X.');
    var id = '__clay_sprite_' + spriteCount++ + '__';
    sprites[id] = { type: 'sprite', pixels: rows, width: rows[0].length, height: rows.length };
    if (name) sprites['<<' + name + '>>'] = sprites[id];
    return id;
  });
  var tokens = tokenize(body);
  var index = 0;
  var count = 0;
  function skipNewlines() { while (tokens[index] && tokens[index].type === '\n') index++; }
  function container(depth) {
    if (depth > 24) fail('Wireframe nesting is too deep (24 levels maximum).');
    var start = tokens[index++];
    var node = { type: 'container', style: start.style, title: start.title || '', titleData: start.title ? label(start.title) : null, rows: [] };
    if (start.style[0] === 'S') { node.scroll = start.style; node.style = '+'; }
    var row = [];
    var expectsCell = false;
    function cell(value) {
      if (++count > 2000) fail('Wireframe has too many cells (2000 maximum).');
      if (row.length >= 64) fail('Wireframe has too many columns (64 maximum).');
      row.push(value); expectsCell = false;
    }
    function endRow() { if (expectsCell) cell(widget('.')); if (row.length) node.rows.push(row); row = []; }
    while (index < tokens.length) {
      var token = tokens[index];
      if (token.type === '}') {
        index++; endRow();
        if (node.style === '*') {
          node.popups = node.rows.slice(1); node.rows = node.rows.slice(0, 1);
          node.popups.forEach(function (items) {
            if (!node.rows[0].some(function (entry) { return entry.text === items[0].text; })) fail('Open menu must name an existing menu entry.');
          });
        }
        return node;
      }
      if (token.type === '\n') {
        if (node.style === '/' && row.length && !expectsCell) node.verticalTabs = true;
        index++;
        // A newline before/after a column separator is only formatting.
        skipNewlines();
        if (!expectsCell && (!tokens[index] || tokens[index].type !== '|')) endRow();
      } else if (token.type === '|') {
        if (!row.length || expectsCell) cell(widget('.'));
        expectsCell = true; index++;
      } else if (token.type === '{' || token.type === 'text') {
        if (row.length && !expectsCell) fail('Separate cells with | or a newline.');
        var value;
        if (token.type === '{') value = container(depth + 1);
        else { index++; value = sprites[token.text] ? Object.assign({}, sprites[token.text]) : widget(token.text); }
        if (node.style[0] === 'T' && !row.length && value.type === 'label') {
          var level = /^\+*/.exec(value.text)[0].length;
          value = Object.assign({ type: 'label', level: level }, label(value.text.slice(level).trim()));
        }
        if (value.type === 'span') {
          var previous = row[row.length - 1];
          while (previous && previous.type === 'span') previous = previous.owner;
          if (!previous) fail('A spanning cell needs a cell to its left.');
          previous.span = (previous.span || 1) + 1; value.owner = previous;
        }
        cell(value);
      } else fail('Unexpected Salt syntax.');
    }
    fail('Unclosed layout container. Add a closing }.');
  }
  skipNewlines();
  if (!tokens[index] || tokens[index].type !== '{') fail('A Salt layout must start with {.');
  var root = container(0);
  skipNewlines();
  if (index !== tokens.length) fail('Unexpected content after the layout. Use one outer container.');
  root.options = settings.options;
  if (screen) root.options.screen = screen;
  root.options.labels = {};
  ['title', 'header', 'footer', 'caption', 'legend'].forEach(function (name) { if (settings.options[name]) root.options.labels[name] = settings.options[name].split('\n').map(label); });
  return root;
}
module.exports = { parseSalt: parseSalt };
