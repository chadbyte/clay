// Developer-only export from an existing pinned PlantUML JAR and source checkout.
// Usage: node scripts/export-salt-assets.js JAR SOURCE_CHECKOUT OUTPUT_DIRECTORY
var fs = require('node:fs');
var path = require('node:path');
var os = require('node:os');
var child = require('node:child_process');
var crypto = require('node:crypto');
var jar = path.resolve(process.argv[2] || '');
var source = path.resolve(process.argv[3] || '');
var output = process.argv[4] && path.resolve(process.argv[4]);
var expectedHash = '3629c9cd017c7f73e6450396eea0040216c7e1eef8473ce33cc1aad469dab2f9';
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
if (!output || !fs.existsSync(jar) || sha(fs.readFileSync(jar)) !== expectedHash) throw new Error('Supply the pinned PlantUML 1.2026.8 JAR, its source checkout, and an output directory.');
fs.mkdirSync(output, { recursive: true });
var scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-salt-assets-'));
function run(command, args) {
  var result = child.spawnSync(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
}
function write(name, value) { fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n'); }
try {
  var names = fs.readFileSync(path.join(source, 'src/main/resources/openiconic/all.txt'), 'utf8').trim().split(/\s+/).sort();
  names.forEach(function (name) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid icon name.');
    fs.writeFileSync(path.join(scratch, name + '.puml'), '@startsalt\n{ <&' + name + '> }\n@endsalt');
  });
  run('java', ['-Djava.awt.headless=true', '-jar', jar, '-tsvg', path.join(scratch, '*.puml')]);
  var icons = {};
  names.forEach(function (name) {
    var svg = fs.readFileSync(path.join(scratch, name + '.svg'), 'utf8');
    if (!/data-diagram-type="SALT"/.test(svg)) throw new Error('Invalid icon reference: ' + name);
    icons[name] = Array.from(svg.matchAll(/<path\b[^>]*d="([^"]+)"/g)).map(function (match) { return match[1]; });
    if (!icons[name].length) throw new Error('Missing icon paths: ' + name);
  });
  write('salt-icons.json', icons);
  var colorSource = fs.readFileSync(path.join(source, 'src/main/java/net/sourceforge/plantuml/klimt/color/ColorTrieNode.java'), 'utf8');
  var colors = {};
  for (var color of colorSource.matchAll(/register\("([^"]+)", XColor\.from\(0x([0-9A-Fa-f]+)\)\)/g)) colors[color[1].toLowerCase()] = '#' + color[2].padStart(6, '0').toUpperCase();
  write('salt-colors.json', colors);
  run('javac', ['-cp', jar, '-d', scratch, path.join(__dirname, 'SaltFontMetrics.java')]);
  var profiles = [];
  ['SansSerif', 'Monospaced'].forEach(function (family) {
    [10, 12, 13, 14, 16, 18, 20].forEach(function (size) {
      var suffix = family === 'Monospaced' ? 'monospace' + (size === 12 ? '' : '-' + size) : size === 12 ? 'metrics' : String(size);
      var file = 'salt-font-' + suffix + '.bin.gz';
      run('java', ['-Djava.awt.headless=true', '-cp', jar + path.delimiter + scratch, 'SaltFontMetrics', path.join(output, file), String(size), family]);
      profiles.push({ file: file, family: family, size: size, sha256: sha(fs.readFileSync(path.join(output, file))) });
    });
  });
  write('salt-font-metrics.json', { referenceVersion: 'PlantUML 1.2026.8', referenceCommit: '149874a1bb2b64c42889d7178cb89f6647ac14bc', referenceJarSha256: expectedHash,
    profile: 'macOS, Java 15.0.2, logical SansSerif and Monospaced', styles: ['normal', 'bold', 'italic', 'boldItalic'],
    encoding: 'gzip; style-major BMP code points 0..65535; three big-endian float32 values per character: width, height, descent',
    generator: 'scripts/export-salt-assets.js and scripts/SaltFontMetrics.java', profiles: profiles,
    contents: 'Numerical measurements only; no font outlines. Complex-script shaping and supplementary-plane metrics are not covered.' });
  write('salt-assets.json', { referenceJarSha256: expectedHash, generator: 'scripts/export-salt-assets.js',
    icons: { count: names.length, source: 'PlantUML src/main/resources/openiconic; normalized paths rendered by the pinned JAR at origin (6,6)', license: 'MIT, copyright 2014 Waybury; LICENSES/open-iconic.txt', sha256: sha(fs.readFileSync(path.join(output, 'salt-icons.json'))) },
    colors: { source: 'PlantUML ColorTrieNode.java', license: 'GPL-3.0-or-later; LICENSES/plantuml-salt.txt', sha256: sha(fs.readFileSync(path.join(output, 'salt-colors.json'))) } });
  process.stdout.write('Exported assets to ' + output + '\n');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
