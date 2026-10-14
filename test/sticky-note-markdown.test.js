var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

async function loadMarkdownModule() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/sticky-note-markdown.js"), "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

function classList(names) {
  return {
    contains: function (name) { return names.indexOf(name) !== -1; },
  };
}

function textNode(text) {
  return { nodeType: 3, textContent: text };
}

function element(tagName, classes, children) {
  return {
    nodeType: 1,
    tagName: tagName,
    classList: classList(classes || []),
    childNodes: children || [],
    dataset: {},
    getAttribute: function () { return null; },
  };
}

test("sticky-note log chips serialize back to exact markdown references", async function () {
  var markdown = await loadMarkdownModule();
  var title = element("DIV", ["sn-title"], [textNode("Investigation")]);
  var chip = element("BUTTON", ["clayos-log-link"], [textNode("Log")]);
  chip.dataset.logRef = "log:AtK7V57km2QHpYCN6DQ_Xvov";
  var rendered = element("DIV", [], [title, element("BR"), chip]);
  rendered.querySelector = function () { return title; };
  assert.strictEqual(markdown.extractMarkdown(rendered), "Investigation\n`log:AtK7V57km2QHpYCN6DQ_Xvov`");
});

test("sticky-note markdown renders bare and bulleted checklist markers", async function () {
  var markdown = await loadMarkdownModule();
  var html = markdown.renderMiniMarkdown("Handoff\n[x] Done\n[ ] Next\n- [X] Also done\n- [ ] Later");
  assert.strictEqual((html.match(/role=\"checkbox\"/g) || []).length, 4);
  assert.strictEqual((html.match(/aria-checked=\"true\"/g) || []).length, 2);
  assert.strictEqual((html.match(/aria-checked=\"false\"/g) || []).length, 2);
});

test("sticky-note checklist state serializes back to markdown", async function () {
  var markdown = await loadMarkdownModule();
  var title = element("DIV", ["sn-title"], [textNode("Handoff")]);
  var checked = element("SPAN", ["sn-check", "checked"], [textNode("✓")]);
  var unchecked = element("SPAN", ["sn-check"], [textNode("☐")]);
  var rendered = element("DIV", [], [
    title,
    element("BR"),
    checked,
    textNode(" Done"),
    element("BR"),
    unchecked,
    textNode(" Next"),
  ]);
  rendered.querySelector = function () { return title; };
  assert.strictEqual(markdown.extractMarkdown(rendered), "Handoff\n- [x] Done\n- [ ] Next");
});

test("checklist mode keeps headings and fenced code out of the task list", async function () {
  var markdown = await loadMarkdownModule();
  var html = markdown.renderMiniMarkdown("Plan\nFirst task\n## Heading\n```js\nrun()\n```\n[x] Done", {
    checklistMode: true,
    checklistState: [false, true],
  });
  assert.strictEqual((html.match(/data-checklist-index=/g) || []).length, 2);
  assert.match(html, /data-checklist-index="0"/);
  assert.match(html, /data-checklist-index="5"[^>]*aria-checked="true"/);
  assert.match(html, /## Heading/);
  assert.match(html, /run\(\)/);
});

test("checklist mode preserves literal task markers in tilde fences", async function () {
  var markdown = await loadMarkdownModule();
  var html = markdown.renderMiniMarkdown("Plan\n~~~txt\n[ ] literal\n~~~\nTask", { checklistMode: true });
  assert.strictEqual((html.match(/role=\"checkbox\"/g) || []).length, 1);
  assert.match(html, /\[ \] literal/);
});

test("duplicate source identities match rendering across fenced lines and object-like text", async function () {
  var markdown = await loadMarkdownModule();
  var source = "Plan\nRepeated\n~~~txt\nRepeated\n~~~\nRepeated\n__proto__\nconstructor";
  var items = markdown.getChecklistItems(source);
  assert.deepEqual(items.map(function (item) { return item.key; }), ["Repeated\u00000", "Repeated\u00001", "__proto__\u00000", "constructor\u00000"]);
  var html = markdown.renderMiniMarkdown(source, { checklistMode: true, checklistState: { "Repeated\u00001": true } });
  assert.equal((html.match(/data-checklist-index=/g) || []).length, 4);
  assert.match(html, /data-checklist-index="4"[^>]*aria-checked="true"/);
});
