var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var parser = require('../lib/salt-parser');
var layout = require('../lib/salt-layout');
var screen = require('../lib/salt-screen');
var renderer = require('../lib/plantuml-renderer');
var example = fs.readFileSync(path.join(__dirname, '../docs/examples/clay-mcp-screen.puml'), 'utf8');

test('screen canvas distributes region space without scaling text or buttons', async function () {
  var root = parser.parseSalt(example); layout.measure(root); screen.apply(root);
  var sidebar = root.screen.cells.find(function (cell) { return cell.x === 0 && cell.y === 64; });
  assert.equal(sidebar.width, 240);
  assert.equal(sidebar.height, 834);
  var svg = await renderer.renderPlantUml(example);
  var larger = await renderer.renderPlantUml(example.replace('1440 900', '1920 1080'));
  assert.match(svg, /width="1440" height="900"/);
  assert.match(larger, /width="1920" height="1080"/);
  function fonts(value) { return Array.from(value.matchAll(/font-size="([^"]+)"/g), function (m) { return m[1]; }); }
  function buttons(value) { return Array.from(value.matchAll(/<rect[^>]+width="([^"]+)"[^>]+height="([^"]+)"[^>]+fill="#EEE"/g), function (m) { return m[1] + ',' + m[2]; }); }
  assert.deepEqual(fonts(svg), fonts(larger));
  assert.deepEqual(buttons(svg), buttons(larger));
  assert.ok(buttons(svg).length > 0);
  assert.match(await renderer.renderPlantUml(example.replace('{+', '!option handwritten true\n{+')), /<polygon/);
});

test('plain Salt ignores ordinary comments and keeps its original layout', async function () {
  var plain = '@startsalt\n{ [Save] }\n@endsalt';
  assert.equal(await renderer.renderPlantUml(plain), await renderer.renderPlantUml(plain.replace('{', "' Design note\n{")));
});

test('screen directives reject invalid geometry, missing regions and overflow', async function () {
  var bad = [
    example.replace('1440 900', '9000 900'),
    example.replace('1440 900', '240 240'),
    example.replace('columns=240,*', 'columns=20,*'),
    example.replace('root.1.0 ', 'root.9.0 '),
    example.replace('gap=20', 'gap=999'),
    example.replace('columns=240,*', 'columns=240'),
    example.replace('columns=240,*', 'columns=NaN,*'),
    example.replace("' @clay-canvas 1440 900\n", ''),
    example.replace('{+', 'scale 2\n{+')
  ];
  for (var source of bad) await assert.rejects(renderer.renderPlantUml(source), /Clay screen layout/);
});
