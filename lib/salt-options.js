// Read only bounded display directives; never evaluate PlantUML preprocessing.
var color = require('./salt-text').color;
function parse(body) {
  var options = { scale: 1, background: '#FFFFFF' };
  body = body.replace(/^[ \t]*legend[ \t]*\n([\s\S]*?)^[ \t]*end[ \t]*legend[ \t]*$/gim, function (_, value) { options.legend = value.trim(); return ''; });
  body = body.replace(/^[ \t]*(title|header|footer|caption)[ \t]+([^\n]+)$/gim, function (_, name, value) { options[name.toLowerCase()] = value.trim(); return ''; });
  body = body.replace(/^\s*!option handwritten (true|false)[ \t]*$/gim, function (_, value) { options.handwritten = value === 'true'; return ''; });
  body = body.replace(/<style>\s*saltDiagram\s*\{([^}]*)\}\s*<\/style>/gi, function (_, contents) {
    contents.trim().split(/\n/).forEach(function (line) { setting(line.trim()); }); return '';
  });
  function setting(line) {
    var m = /^(BackgroundColor|dpi|defaultFontName|Fontname|FontSize|FontStyle|LineThickness|LineColor)\s+(\S+)$/i.exec(line);
    if (!m) throw new Error('Unsupported Salt display setting: ' + line);
    if (/^BackgroundColor$/i.test(m[1])) options.background = color(m[2]);
    if (/^dpi$/i.test(m[1])) options.scale = Number(m[2]) / 96;
    // The reference Salt renderer ignores these font and stroke style settings.
  }
  body = body.replace(/^\s*skinparam[ \t]+([^\n]+)$/gim, function (_, value) { setting(value.trim()); return ''; });
  body = body.replace(/^\s*scale[ \t]+([\d.]+)[ \t]*$/gim, function (_, value) { options.scale = Number(value); return ''; });
  if (!Number.isFinite(options.scale) || options.scale <= 0 || options.scale > 8) throw new Error('Salt scale must be greater than zero and at most 8.');
  return { body: body, options: options };
}
module.exports = { parse: parse };
