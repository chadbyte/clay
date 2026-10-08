// Development-only reference check. Java/PlantUML are never used by Clay at runtime.
// Usage: node scripts/check-salt-parity.js /path/to/plantuml.jar /tmp/clay-salt-parity
var fs = require('node:fs');
var path = require('node:path');
var crypto = require('node:crypto');
var child = require('node:child_process');
var renderer = require('../lib/plantuml-renderer');
var cases = require('../test/fixtures/salt-parity-cases');
var jar = process.argv[2];
var output = path.resolve(process.argv[3] || '/tmp/clay-salt-parity');
if (!jar || !fs.existsSync(jar)) throw new Error('Supply an existing reference PlantUML JAR; this script installs nothing.');
fs.mkdirSync(output, { recursive: true });
function escape(value) { return String(value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function decode(value) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, function (_, n) { return String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function inspect(svg) {
  var labels = Array.from(svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)).map(function (m) { return decode(m[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  var box = /viewBox="([^"]+)"/.exec(svg);
  return { labels: labels, viewBox: box ? box[1].split(/\s+/).map(Number) : null };
}
function words(labels) { return labels.join(' ').split(/\s+/).filter(Boolean).sort(); }
async function run() {
  var version = child.spawnSync('java', ['-jar', jar, '-version'], { encoding: 'utf8', timeout: 20000 });
  if (version.error || !/PlantUML version/.test(version.stdout || '')) throw version.error || new Error('Cannot identify reference renderer');
  var report = { reference: version.stdout, versionExit: version.status,
    jarSha256: crypto.createHash('sha256').update(fs.readFileSync(jar)).digest('hex'),
    checkedAt: new Date().toISOString(), cases: [] };
  var previous = null;
  if (process.argv.includes('--reuse-reference')) {
    try { previous = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8')); } catch (e) {}
  }
  var cards = [];
  for (var item of cases) {
    fs.writeFileSync(path.join(output, item.id + '.puml'), item.source);
    var cached = previous && previous.jarSha256 === report.jarSha256 && previous.cases.find(function (c) { return c.id === item.id && c.sourceSha256 === crypto.createHash('sha256').update(item.source).digest('hex'); });
    var reference = cached ? { stdout: fs.readFileSync(path.join(output, item.id + '.reference.svg'), 'utf8'), status: cached.referenceExit, stderr: cached.referenceStderr } : child.spawnSync('java', ['-Djava.awt.headless=true', '-DPLANTUML_SECURITY_PROFILE=SECURE', '-jar', jar, '-charset', 'UTF-8', '-tsvg', '-pipe'],
      { input: item.source, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
    var official = reference.stdout || '';
    var validReference = reference.status === 0 && /data-diagram-type="SALT"/.test(official) && !/Syntax Error|PSystemError|An error has occurr/i.test(official);
    var native = '';
    var error = null;
    try { native = await renderer.renderPlantUml(item.source, { imageLoader: function (url) {
      if (url !== 'https://plantuml.com/logo3.png') throw new Error('Missing recorded image fixture: ' + url);
      return fs.readFileSync(path.join(__dirname, '../test/fixtures/salt-official/logo3.png'));
    } }); } catch (e) { error = e.message; }
    fs.writeFileSync(path.join(output, item.id + '.reference.svg'), official);
    if (native) fs.writeFileSync(path.join(output, item.id + '.native.svg'), native);
    var ref = inspect(official);
    var own = inspect(native);
    var entry = { id: item.id, scope: item.scope, referenceValid: validReference, referenceExit: reference.status,
      referenceStderr: reference.stderr, nativeValid: !!native, nativeError: error,
      sourceSha256: crypto.createHash('sha256').update(item.source).digest('hex'),
      reference: ref, native: own, sameLabelSequence: JSON.stringify(ref.labels) === JSON.stringify(own.labels),
      sameWords: JSON.stringify(words(ref.labels)) === JSON.stringify(words(own.labels)),
      sameTextContent: ref.labels.join(' ').replace(/\s+/g, ' ') === own.labels.join(' ').replace(/\s+/g, ' '),
      sameDimensions: JSON.stringify(ref.viewBox) === JSON.stringify(own.viewBox) };
    report.cases.push(entry);
    cards.push('<section id="' + item.id + '"><h2>' + item.id + ' <small>' + item.scope + '</small></h2><p>' +
      escape(JSON.stringify({ referenceValid: validReference, nativeValid: !!native, textMatch: entry.sameTextContent, referenceSize: ref.viewBox, nativeSize: own.viewBox })) +
      '</p><div class="pair"><figure><figcaption>Official PlantUML · original dimensions</figcaption><div class="canvas reference">' + official +
      '</div></figure><figure><figcaption>Clay native · original dimensions</figcaption><div class="canvas native">' + (native || escape(error)) +
      '</div></figure></div><details><summary>Identical input</summary><pre>' + escape(item.source) + '</pre></details></section>');
    process.stdout.write(item.id + ': official=' + validReference + ' native=' + !!native + ' text=' + entry.sameTextContent + '\n');
  }
  var supported = report.cases.filter(function (c) { return (c.scope === 'supported' || c.scope === 'official'); });
  var comparable = supported.filter(function (c) { return c.referenceValid && c.nativeValid; });
  report.summary = { total: cases.length, supported: supported.length,
    referenceAccepted: supported.filter(function (c) { return c.referenceValid; }).length,
    nativeAccepted: supported.filter(function (c) { return c.nativeValid; }).length,
    comparable: comparable.length, sameWords: comparable.filter(function (c) { return c.sameWords; }).length,
    sameDimensions: comparable.filter(function (c) { return c.sameDimensions; }).length,
    extensions: report.cases.filter(function (c) { return c.scope === 'extension'; }).length,
    exclusionsRejected: report.cases.filter(function (c) { return c.scope === 'excluded' && c.referenceValid && !c.nativeValid; }).length };
  report.method = 'Compare render acceptance, normalized word inventories (not semantic equivalence), exact SVG dimensions; compare reference primitives in test/salt-parity.test.js and same-browser pixel differences in index.html. Reference failures are explicitly separate extensions; a passing CLI check alone is not a pixel-parity claim.';
  report.nativeFiles = fs.readdirSync(path.join(__dirname, '../lib')).filter(function (file) { return /^salt-.*\.js$/.test(file) || file === 'plantuml-renderer.js'; }).map(function (file) { return 'lib/' + file; }).concat(fs.readdirSync(path.join(__dirname, '../lib/assets')).filter(function (file) { return /^salt-/.test(file); }).map(function (file) { return 'lib/assets/' + file; })).map(function (file) {
    return { path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex') };
  });
  report.verdict = comparable.length && comparable.every(function (c) { return c.sameDimensions && c.sameWords; }) && supported.every(function (c) { return c.referenceValid && c.nativeValid; }) ? 'Dimensions and words match; browser pixel verification required' : 'Parity not achieved';
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  var html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>clay-sketch Salt parity review</title><style>body{font:14px system-ui;margin:24px;color:#222;background:#eee}nav{position:sticky;top:0;background:white;padding:12px;z-index:2}select{font:inherit}section{margin:24px 0;padding:16px;background:white}small{font-weight:400;color:#777}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;min-width:0}figcaption{margin-bottom:12px}.canvas{overflow:auto;border:1px solid #ccc;min-height:70px;padding:12px}svg{display:block;max-width:none}pre{white-space:pre-wrap}section:target{outline:2px solid #777}</style><nav><label>Case <select onchange="location.hash=this.value">' +
    cases.map(function (c) { return '<option value="' + c.id + '">' + c.id + '</option>'; }).join('') +
    '</select></label> <button id="fit" onclick="document.querySelectorAll(\'svg\').forEach(function(s){s.style.maxWidth=s.style.maxWidth?\'\':\'100%\';s.style.height=s.style.maxWidth?\'auto\':\'\';})">Toggle fit</button> <span id="bounds"></span></nav><h1>clay-sketch vs official Salt</h1><p>Same sources. Native rendering is not assumed equivalent. Scroll each image horizontally at original size, or toggle fit. Reference uses local Java only for development verification.</p>' + cards.join('') +
    '<script>document.fonts.ready.then(function(){var result=[];document.querySelectorAll("section").forEach(function(section){["reference","native"].forEach(function(engine){var svg=section.querySelector("."+engine+" svg");if(!svg)return;var box=svg.viewBox.baseVal;svg.querySelectorAll("text").forEach(function(t){var b=t.getBBox();if(b.x<box.x-1||b.y<box.y-1||b.x+b.width>box.width+1||b.y+b.height>box.height+1)result.push({id:section.id,engine:engine,text:t.textContent,bounds:[b.x,b.y,b.width,b.height]});});});});document.getElementById("bounds").textContent="Text outside canvas: "+JSON.stringify(result);});</script></html>';
  fs.writeFileSync(path.join(output, 'index.html'), html.replace('</html>', '<script src="parity-browser.js"></script></html>'));
  fs.copyFileSync(path.join(__dirname, '../test/fixtures/salt-parity-browser.js'), path.join(output, 'parity-browser.js'));
  process.stdout.write('Artifacts: ' + output + '\n');
  process.stdout.write(report.verdict + ': ' + JSON.stringify(report.summary) + '\n');
  if (report.verdict === 'Parity not achieved') process.exitCode = 1;
}
run().catch(function (error) { console.error(error); process.exitCode = 1; });
