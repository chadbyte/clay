var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var skills = require("../lib/yoke/skill-discovery");
var renderer = require("../lib/plantuml-renderer");

test("clay-sketch is available without user installation and can be explicitly loaded", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-sketch-skill-"));
  try {
    var discovered = skills.discoverSkills(root, { homeDir: root });
    var sketch = skills.indexSkills(discovered)["clay-sketch"];
    assert.equal(sketch.source, "clay-builtin");
    assert.equal(sketch.path, fs.realpathSync(path.join(__dirname, "../lib/bundled-skills/clay-sketch/SKILL.md")));
    var content = skills.readReferencedSkills("Use $clay-sketch for this page", discovered);
    assert.match(content, /<shared-skill name="clay-sketch" source="clay-builtin">/);
    assert.match(content, /present_wireframe/);
    assert.match(content, /```clay-sketch/);
    assert.deepEqual(fs.readdirSync(root), [], "discovery must not install anything in the user's home");

    var override = path.join(root, ".agents", "skills", "clay-sketch");
    fs.mkdirSync(override, { recursive: true });
    fs.writeFileSync(path.join(override, "SKILL.md"), "---\nname: clay-sketch\ndescription: Project-specific sketch guidance\n---\nProject layout rules\n");
    var selected = skills.indexSkills(skills.discoverSkills(root, { homeDir: root }))["clay-sketch"];
    assert.equal(selected.source, "agents-project", "project guidance retains precedence over bundled defaults");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the bundled skill's whole-page example renders with the built-in engine", async function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/bundled-skills/clay-sketch/SKILL.md"), "utf8");
  var examples = Array.from(source.matchAll(/```clay-sketch\n([\s\S]*?)\n```/g));
  assert.ok(examples.length > 0);
  for (var i = 0; i < examples.length; i++) {
    var svg = await renderer.renderPlantUml(examples[i][1]);
    assert.match(svg, /<svg/);
    if (i === 0) {
      assert.match(svg, /Navigation/);
      assert.match(svg, /Create project/);
      assert.match(svg, /Mobile app/);
    } else {
      assert.match(svg, /width="1440" height="900"/);
      assert.match(svg, /MCP connections/);
    }
  }
});
