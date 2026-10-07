var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var crypto = require('node:crypto');
var renderer = require('../lib/plantuml-renderer');
var cases = require('./fixtures/salt-parity-cases');
var manifest = require('./fixtures/salt-reference/manifest.json');
var officialPage = require('./fixtures/salt-official/manifest.json');
function decode(value) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, function (_, n) { return String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
// Compare all rendered primitives, not only dimensions or text inventories.
// Attribute serialization and independent shape ordering do not change geometry.
function primitives(svg) {
  var filters = {};
  for (var f of svg.matchAll(/<filter id="([^"]+)"([^>]+)>([\s\S]*?)<\/filter>/g)) filters[f[1]] = f[2] + f[3];
  return Array.from(svg.matchAll(/<(text|rect|line|ellipse|polygon|path|image)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)).map(function (match) {
    var attrs = {};
    for (var a of match[2].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    (attrs.style || '').split(';').forEach(function (part) {
      var pair = part.split(':'); if (pair.length === 2) attrs[pair[0]] = pair[1];
    });
    delete attrs.style;
    if (attrs.filter) { var id = /^url\(#(.+)\)$/.exec(attrs.filter)[1]; assert.ok(filters[id], 'filter must be defined'); attrs.filter = filters[id]; }
    if (match[1] === 'image') {
      assert.match(attrs.href || attrs['xlink:href'], /^data:image\/png;base64,/);
      // PNG encoders differ; decoded image pixels are compared by the browser harness.
      delete attrs.href; delete attrs['xlink:href'];
    }
    if (match[1] !== 'text') {
      if (!attrs.fill) attrs.fill = 'none';
      if (!attrs['stroke-width']) attrs['stroke-width'] = '1';
    }
    if (attrs.d) attrs.d = attrs.d.replace(/[ ,]+/g, ',').replace(/,?([MLCZ]),?/g, '$1');
    if (attrs.points) attrs.points = attrs.points.replace(/ /g, ',');
    return JSON.stringify([match[1], Object.keys(attrs).sort().map(function (key) { return [key, attrs[key]]; }), decode(match[3] || '')]);
  }).sort();
}
test('reference fixtures cover every supported corpus case', function () {
  assert.deepEqual(manifest.cases.map(function (c) { return c.id; }).sort(),
    cases.filter(function (c) { return (c.scope === 'supported' || c.scope === 'official'); }).map(function (c) { return c.id; }).sort());
});
test('all forty official page examples retain their recorded source and classification', async function () {
  assert.equal(officialPage.cases.length, 40);
  assert.equal(officialPage.cases.filter(function (item) { return item.scope === 'official'; }).length, 35);
  for (var item of officialPage.cases) {
    var source = fs.readFileSync(path.join(__dirname, 'fixtures/salt-official', item.sourceFile), 'utf8');
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), item.sourceSha256);
    if (item.scope === 'other-diagram') await assert.rejects(renderer.renderPlantUml(source), /Other PlantUML diagram types/);
  }
});
test('bundled reference assets match their recorded export hashes', function () {
  var assets = path.join(__dirname, '../lib/assets');
  var fonts = require('../lib/assets/salt-font-metrics.json');
  var other = require('../lib/assets/salt-assets.json');
  assert.equal(fonts.profiles.length, 14);
  fonts.profiles.concat([
    { file: 'salt-icons.json', sha256: other.icons.sha256 },
    { file: 'salt-colors.json', sha256: other.colors.sha256 }
  ]).forEach(function (entry) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(assets, entry.file))).digest('hex'), entry.sha256, entry.file);
  });
  assert.equal(Object.keys(require('../lib/assets/salt-icons.json')).length, 223);
});
manifest.cases.forEach(function (entry) {
  test('Salt reference geometry and formatting: ' + entry.id, async function () {
    var item = cases.find(function (c) { return c.id === entry.id; });
    assert.equal(crypto.createHash('sha256').update(item.source).digest('hex'), entry.sourceSha256, 'fixture input changed; regenerate with the pinned official renderer');
    var expected = fs.readFileSync(path.join(__dirname, 'fixtures/salt-reference', entry.id + '.svg'), 'utf8');
    var actual = await renderer.renderPlantUml(item.source, { imageLoader: function (url) {
      assert.equal(url, 'https://plantuml.com/logo3.png');
      return fs.readFileSync(path.join(__dirname, 'fixtures/salt-official/logo3.png'));
    } });
    assert.equal(/viewBox="([^"]+)"/.exec(actual)[1], /viewBox="([^"]+)"/.exec(expected)[1]);
    assert.match(actual, /font-family="sans-serif"/);
    assert.deepEqual(primitives(actual), primitives(expected));
  });
});
