var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var renderer = require('../lib/plantuml-renderer');
var parser = require('../lib/salt-parser');
var sample = '@startsalt\n{+\n[Continue]\n}\n@endsalt';

test('wireframe aliases, bare Salt, BOM and source bounds', function () {
  ['a.puml', 'a.PU', 'a.uml', 'a.plantuml', 'a.salt'].forEach(function (file) { assert.ok(renderer.isPlantUmlFile(file)); });
  assert.equal(renderer.isPlantUmlFile('a.puml.js'), false);
  assert.equal(renderer.prepareSource('{ [OK] }', 'a.salt'), '@startsalt\n{ [OK] }\n@endsalt');
  assert.equal(renderer.prepareSource('\uFEFF' + sample, 'a.puml'), sample);
  assert.throws(function () { renderer.prepareSource('', 'a.puml'); }, /empty/);
  assert.throws(function () { renderer.prepareSource('hello', 'a.puml'); }, /@startsalt/);
  assert.throws(function () { renderer.prepareSource(sample + '\n' + sample, 'a.puml'); }, /one diagram/);
  assert.throws(function () { renderer.prepareSource('é'.repeat(50001), 'a.puml'); }, /too large/);
});
test('whole-page rendering works with no external executable or Java configuration', async function () {
  var oldPath = process.env.PATH;
  var oldJar = process.env.CLAY_PLANTUML_JAR;
  process.env.PATH = '';
  delete process.env.CLAY_PLANTUML_JAR;
  try {
    var svg = await renderer.renderPlantUml(fs.readFileSync(path.join(__dirname, '../docs/examples/clay-workbench.puml'), 'utf8'));
    ['Your connections', 'Search connections', 'New conversation', 'MCP &amp; Skills'].forEach(function (text) { assert.ok(svg.includes(text), text); });
    assert.match(svg, /^<svg/);
    assert.doesNotMatch(svg, /script|foreignObject|xlink:href|NaN|undefined/);
  } finally {
    process.env.PATH = oldPath;
    if (oldJar !== undefined) process.env.CLAY_PLANTUML_JAR = oldJar;
  }
});
test('parser retains nested rows, columns, controls, quoted delimiters, group titles and formatting', function () {
  var tree = parser.parseSalt('@startsalt\n{+\n{^"Account"\nName | "Chad | {hello}   "\n[X] Enabled | () Radio\n}\n{/ <b>Overview | Settings }\n^Select^\n}\n@endsalt');
  assert.equal(tree.rows.length, 3);
  var group = tree.rows[0][0];
  assert.equal(group.title, 'Account'); assert.equal(group.rows[0][1].type, 'input');
  assert.equal(group.rows[0][1].text, 'Chad | {hello}');
  assert.equal(group.rows[0][1].charLength, 'Chad | {hello}   '.length);
  assert.equal(group.rows[1][0].checked, true); assert.equal(group.rows[1][1].type, 'radio');
  assert.equal(tree.rows[1][0].style, '/'); assert.equal(tree.rows[1][0].rows[0][0].bold, true);
  assert.equal(tree.rows[2][0].type, 'select');
});
test('renderer draws built-in control shapes and escapes user labels', async function () {
  var svg = await renderer.renderPlantUml('@startsalt\n{#\n[Save & continue] | "Name"\n[X] Checked | (X) Selected\n^Choose^ | **Heading**\n..\n.\n}\n@endsalt');
  assert.match(svg, /Save &amp; continue/); assert.match(svg, /<ellipse/); assert.match(svg, /font-weight="700"/);
  assert.match(svg, /stroke-dasharray/); assert.doesNotMatch(svg, /NaN|undefined/);
});
test('Salt supports empty cells and multiline nested column formatting', function () {
  var tree = parser.parseSalt('@startsalt\n{\n{ Left }\n|\n{ Right }\n|\n\nNext\n}\n@endsalt');
  assert.equal(tree.rows[0].length, 3); assert.equal(tree.rows[0][0].rows[0][0].text, 'Left');
  assert.equal(tree.rows[0][2].text, 'Next');
  tree = parser.parseSalt('@startsalt\n{ | Name |\n}\n@endsalt');
  assert.equal(tree.rows[0].length, 3);
});
test('compatible startuml salt wrapper works; other UML types are explicitly unsupported', async function () {
  assert.match(await renderer.renderPlantUml('@startuml\nsalt\n{ [OK] }\n@enduml'), />OK</);
  await assert.rejects(renderer.renderPlantUml('@startuml\nAlice -> Bob : Hello\n@enduml'), /Other PlantUML diagram types are not supported/);
});
test('unsupported and malformed input fails clearly rather than silently producing a diagram', async function () {
  for (var body of ['{ [OK]', '{ "Unclosed }', '{ {T\n+ Tree\n}', '{ * }', '{ [Unclosed }', '{ <img:remote> }', '{ foo } trailing', '{* File | Edit\nOpen | Save }', '{ bad\u0000text }']) {
    await assert.rejects(renderer.renderPlantUml('@startsalt\n' + body + '\n@endsalt'), undefined, body);
  }
});
test('includes, directives and environment macros cannot access files or network', async function () {
  for (var body of ['!include /private/secret\n{ [OK] }', '!includeurl https://example.com/a\n{ [OK] }', '{ %getenv("SECRET") }', '!define BUTTON [OK]\n{ BUTTON }']) {
    await assert.rejects(renderer.renderPlantUml('@startsalt\n' + body + '\n@endsalt'), /not supported/);
  }
});
test('nesting, cells, columns, dimensions and cancellation are bounded', async function () {
  for (var body of ['{'.repeat(26) + ' Label ' + '}'.repeat(26), '{ ' + Array(66).fill('Cell').join(' | ') + ' }', '{\n' + Array(2002).fill('Cell').join('\n') + '\n}', '{ ' + 'W'.repeat(2000) + ' }', '{^"' + 'W'.repeat(2000) + '"\nHi\n}', '{/ ' + 'W'.repeat(2000) + ' }']) {
    await assert.rejects(renderer.renderPlantUml('@startsalt\n' + body + '\n@endsalt'), /deep|many|limit/);
  }
  var controller = new AbortController();
  var pending = renderer.renderPlantUml(sample, { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, function (error) { return error.status === 499; });
});
