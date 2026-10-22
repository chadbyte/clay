var fs = require("node:fs");
var path = require("node:path");
var sanitizeHtml = require("sanitize-html");
var catalog = require("./catalog.cjs");
var markedPromise = import("marked").then(function (module) { return module.marked; });

var contentCandidates = [path.join(process.cwd(), "apps/docs/content"), path.join(process.cwd(), "content"), path.join(__dirname, "../content")];
var contentDirectory = contentCandidates.find(function (candidate) { return fs.existsSync(candidate); }) || contentCandidates[0];
var documentOrder = catalog.documents.map(function (document) { return document.slug; });
var documentMeta = {};
catalog.documents.forEach(function (document) { documentMeta[document.slug] = document; });

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripLeadingMarkdownTitle(source) {
  return source.replace(/^\s*#\s+[^\n]+\n+/, "");
}

function slugifyHeading(value) {
  return value.toLowerCase().trim().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-");
}

async function renderMarkdown(source) {
  var marked = await markedPromise;
  var seenIds = {};
  var headingData = [];
  function uniqueHeadingId(text) {
    var baseId = slugifyHeading(text) || "section";
    var id = baseId;
    var suffix = 2;
    while (seenIds[id]) { id = baseId + "-" + suffix; suffix += 1; }
    seenIds[id] = true;
    return id;
  }
  var renderer = new marked.Renderer();
  renderer.heading = function (token) {
    var id = uniqueHeadingId(token.text);
    var label = token.text.replace(/<[^>]+>/g, "").replace(/[*_`~\[\]()]/g, "").trim();
    if (token.depth > 1) headingData.push({ text: label, id: id });
    var inline = this.parser.parseInline(token.tokens || []);
    var escapedId = escapeAttribute(id);
    return "<h" + token.depth + " id=\"" + escapedId + "\"><a class=\"heading-anchor\" href=\"#" + escapedId + "\" aria-label=\"Link to section\">#</a>" + inline + "</h" + token.depth + ">";
  };
  renderer.image = function (href, title, text) {
    if (href && typeof href === "object") { text = href.text; title = href.title; href = href.href; }
    return "<img src=\"" + escapeAttribute(href) + "\" alt=\"" + escapeAttribute(text || "") + "\"" + (title ? " title=\"" + escapeAttribute(title) + "\"" : "") + " loading=\"lazy\" decoding=\"async\">";
  };
  var rawHtml = marked.parse(source, { renderer: renderer, gfm: true, breaks: false });
  return {
    html: sanitizeHtml(rawHtml, {
      allowedTags: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "a", "strong", "em", "del", "code", "pre", "blockquote", "hr", "br", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "img"],
      allowedAttributes: { a: ["href", "title", "target", "rel", "class", "aria-label"], h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], h5: ["id"], h6: ["id"], code: ["class"], th: ["align"], td: ["align"], img: ["src", "alt", "title", "loading", "decoding"] },
      allowedSchemes: ["http", "https", "mailto"],
      allowedSchemesByTag: { img: ["http", "https"] },
      allowProtocolRelative: false
    }),
    headings: headingData
  };
}

async function getDocument(slug) {
  var meta = documentMeta[slug];
  if (!meta) return null;
  var source = fs.readFileSync(path.join(contentDirectory, slug + ".md"), "utf8");
  var rendered = await renderMarkdown(stripLeadingMarkdownTitle(source));
  return { slug: slug, title: meta.title, group: meta.group, description: meta.description, legacy: !!meta.legacy, canonicalSlug: meta.canonicalSlug, html: rendered.html, headings: rendered.headings, searchText: source.replace(/[\[\]()*_`#>-]/g, " ") };
}

async function getDocuments() { return Promise.all(documentOrder.map(function (slug) { return getDocument(slug); })); }

function getDocumentSummary(slug, document) {
  var meta = document || documentMeta[slug];
  var source = fs.readFileSync(path.join(contentDirectory, slug + ".md"), "utf8");
  return { slug: slug, title: meta.title, group: meta.group, description: meta.description, legacy: !!meta.legacy, canonicalSlug: meta.canonicalSlug, searchText: source.replace(/[\[\]()*_`#>-]/g, " ") };
}

async function getDocumentSummaries() { return documentOrder.map(function (slug) { return getDocumentSummary(slug); }); }

function getGroups() { return catalog.groups; }

function getNavigationDocuments(documents) { return (documents || []).filter(function (document) { return !document.legacy; }); }

module.exports = { getDocument: getDocument, getDocuments: getDocuments, getDocumentSummaries: getDocumentSummaries, getGroups: getGroups, getNavigationDocuments: getNavigationDocuments, documentOrder: documentOrder, renderMarkdown: renderMarkdown, stripLeadingMarkdownTitle: stripLeadingMarkdownTitle };
