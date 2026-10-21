var test = require("node:test");
var assert = require("node:assert/strict");
var content = require("../lib/content.cjs");
var catalog = require("../lib/catalog.cjs");
var fs = require("node:fs");
var path = require("node:path");
var siteConfig = require("../lib/site-config.cjs");
var sitemap = require("../scripts/generate-sitemap.cjs");
var validation = require("../lib/content-validation.cjs");

test("renderMarkdown keeps nested heading order and unique anchors", async function () {
  var rendered = await content.renderMarkdown("# Title\n\n> ## Nested heading\n\n## Duplicate\n\n### Duplicate\n\n## End");
  assert.deepEqual(rendered.headings.map(function (heading) { return heading.id; }), ["nested-heading", "duplicate", "duplicate-2", "end"]);
  assert.match(rendered.html, /<h1 id="title">/);
  assert.match(rendered.html, /<h2 id="nested-heading">/);
  assert.match(rendered.html, /<h3 id="duplicate-2">/);
  assert.match(rendered.html, /<h2 id="end">/);
});

test("renderMarkdown preserves formatted Markdown and sanitizes unsafe output", async function () {
  var rendered = await content.renderMarkdown("## *Formatted*\n\n- item\n\n```js\nvar answer = 42;\n```\n\n[good](https://example.com) [bad](javascript:alert(1))\n\n<script>alert(1)</script>");
  assert.match(rendered.html, /<em>Formatted<\/em>/);
  assert.match(rendered.html, /<ul>/);
  assert.match(rendered.html, /<pre><code class="language-js">/);
  assert.match(rendered.html, /<a href="https:\/\/example.com">good<\/a>/);
  assert.doesNotMatch(rendered.html, /javascript:/);
  assert.doesNotMatch(rendered.html, /<script>/);
});

test("every catalog file has one source title and one route-renderable body", async function () {
  var documents = await content.getDocuments();
  catalog.documents.forEach(function (document) {
    var source = fs.readFileSync(path.join(__dirname, "../content", document.slug + ".md"), "utf8");
    assert.equal((source.match(/^# .+$/gm) || []).length, 1, document.slug + " needs one source H1");
    var rendered = documents.find(function (item) { return item.slug === document.slug; });
    assert.equal((rendered.html.match(/<h1\b/g) || []).length, 0, document.slug + " must not duplicate the route H1");
    var ids = rendered.headings.map(function (heading) { return heading.id; });
    assert.equal(new Set(ids).size, ids.length, document.slug + " has duplicate heading anchors");
  });
});

test("catalog metadata and source files are complete and unique", function () {
  var slugs = catalog.documents.map(function (document) { return document.slug; });
  assert.equal(new Set(slugs).size, slugs.length);
  validation.validateCatalog(catalog, path.join(__dirname, "../content"));
  catalog.documents.forEach(function (document) { assert.ok(document.description.length >= 40); });
});

test("catalog descriptions match the delivered CLI scope and search ranks title matches", async function () {
  var search = await import("../components/document-search.js");
  var documents = [
    { slug: "automation-overlap", title: "Pause, skip, and overlap", description: "Understand scheduled overlap.", searchText: "scheduled starts" },
    { slug: "scheduled-tasks", title: "Project Scheduled Tasks", description: "Schedule project work.", searchText: "project scheduling" },
    { slug: "mate-schedules", title: "Private Mate messages", description: "Create recurring messages.", searchText: "scheduled Mate messages" }
  ];
  assert.equal(catalog.documents.find(function (document) { return document.slug === "cli-flags"; }).description, "Use documented Clay Studio server commands and CLI options.");
  assert.deepEqual(search.rankDocuments(documents, "scheduled").map(function (document) { return document.slug; }), ["scheduled-tasks", "automation-overlap", "mate-schedules"]);
  assert.equal(search.rankDocuments(documents, "scheduled").length, 3);
});

test("Markdown tables, safe assets, and links survive sanitization", async function () {
  var rendered = await content.renderMarkdown("# Title\n\n| Name | Value |\n| --- | --- |\n| Clay | [guide](/docs/getting-started) |\n\n![logo](/clay-studio-symbol.png) ![bad](javascript:alert(1))");
  assert.match(rendered.html, /<table>/);
  assert.match(rendered.html, /href="\/docs\/getting-started"/);
  assert.match(rendered.html, /src="\/clay-studio-symbol\.png"/);
  assert.doesNotMatch(rendered.html, /javascript:/);
});

test("all rendered local links, fragments, and assets are valid", async function () {
  var documents = await content.getDocuments();
  assert.equal(validation.validateRenderedDocuments(documents, catalog, path.join(__dirname, "../content"), path.join(__dirname, "../public")), true);
});

test("broken rendered fragments and missing assets are rejected", function () {
  var source = { slug: "getting-started", title: "Fixture", description: "Fixture", headings: [{ id: "present" }], html: "<a href=\"/docs/getting-started#missing%20section\">bad</a>" };
  assert.throws(function () { validation.validateRenderedDocuments([source], catalog, path.join(__dirname, "../content"), path.join(__dirname, "../public")); }, /missing fragment/);
  source.html = "<img src=\"/missing-fixture.png\">";
  assert.throws(function () { validation.validateRenderedDocuments([source], catalog, path.join(__dirname, "../content"), path.join(__dirname, "../public")); }, /missing public asset/);
});

test("home and query links validate while traversal paths are rejected", function () {
  var source = { slug: "getting-started", title: "Fixture", description: "Fixture", headings: [{ id: "present" }], html: "<a href=\"/?from=docs\">home</a><a href=\"/docs/getting-started?preview=1#present\">section</a>" };
  assert.equal(validation.validateRenderedDocuments([source], catalog, path.join(__dirname, "../content"), path.join(__dirname, "../public")), true);
  source.html = "<img src=\"/../package.json\">";
  assert.throws(function () { validation.validateRenderedDocuments([source], catalog, path.join(__dirname, "../content"), path.join(__dirname, "../public")); }, /outside public directory/);
  source.html = "<img src=\"/%2e%2e/package.json\">";
  assert.throws(function () { validation.validateRenderedDocuments([source], catalog, path.join(__dirname, "../content"), path.join(__dirname, "../public")); }, /outside public directory/);
});

test("public origin validation and SEO artifacts fail closed", function () {
  ["", "localhost:4318", "http://127.0.0.1:4318", "https://docs.example.test/path", "https://user:pass@example.test", "javascript:alert(1)"].forEach(function (value) { assert.equal(siteConfig.normalizePublicOrigin(value), "", value + " must not be public origin"); });
  assert.equal(siteConfig.normalizePublicOrigin("https://docs.example.test/"), "https://docs.example.test");
  var local = sitemap.buildArtifacts({ PUBLIC_DOCS_ORIGIN: "" });
  assert.doesNotMatch(local.sitemap, /<loc>/);
  assert.match(local.robots, /Disallow: \/\n/);
  var publicSite = sitemap.buildArtifacts({ PUBLIC_DOCS_ORIGIN: "https://docs.example.test/" });
  assert.match(publicSite.sitemap, /<loc>https:\/\/docs\.example\.test\/docs\/getting-started<\/loc>/);
  assert.doesNotMatch(publicSite.sitemap, /\/docs\/(sessions|mates|split-workers)<\/loc>/);
  assert.match(publicSite.robots, /Sitemap: https:\/\/docs\.example\.test\/sitemap\.xml/);
});
