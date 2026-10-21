var fs = require("node:fs");
var path = require("node:path");

function localAttributes(html) {
  var attributes = [];
  var pattern = /\b(href|src)\s*=\s*["']([^"']+)["']/gi;
  var match;
  while ((match = pattern.exec(html))) attributes.push({ name: match[1].toLowerCase(), value: match[2] });
  return attributes;
}

function isLocalUrl(value) {
  return value.charAt(0) === "/" || value.charAt(0) === "#" || !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function decodeFragment(fragment, source) {
  try { return decodeURIComponent(fragment); } catch (error) { throw new Error(source + " has an invalid encoded fragment: #" + fragment); }
}

function documentBySlug(documents) {
  var result = {};
  documents.forEach(function (document) { result[document.slug] = document; });
  return result;
}

function validateLocalAttribute(attribute, sourceDocument, documents, publicDirectory) {
  var value = attribute.value;
  if (!isLocalUrl(value) || value.indexOf("//") === 0) return;
  var hashIndex = value.indexOf("#");
  var locationWithQuery = hashIndex < 0 ? value : value.slice(0, hashIndex);
  var queryIndex = locationWithQuery.indexOf("?");
  var location = queryIndex < 0 ? locationWithQuery : locationWithQuery.slice(0, queryIndex);
  var fragment = hashIndex < 0 ? "" : decodeFragment(value.slice(hashIndex + 1), sourceDocument.slug);
  var targetSlug = sourceDocument.slug;
  if (location === "" || location === ".") {
    targetSlug = sourceDocument.slug;
  } else if (location === "/") {
    if (fragment) throw new Error(sourceDocument.slug + " links to an unknown home fragment: #" + fragment);
    return;
  } else if (location.indexOf("/docs/") === 0) {
    var route = location.slice("/docs/".length).replace(/\/$/, "");
    if (!documents[route]) throw new Error(sourceDocument.slug + " links to unknown documentation route: " + location);
    targetSlug = route;
  } else if (location.charAt(0) === "/") {
    var assetPath = decodeFragment(location.slice(1), sourceDocument.slug);
    var publicRoot = path.resolve(publicDirectory);
    var asset = path.resolve(publicRoot, assetPath);
    if (asset !== publicRoot && asset.indexOf(publicRoot + path.sep) !== 0) throw new Error(sourceDocument.slug + " references public asset outside public directory: " + value);
    if (!fs.existsSync(asset) || !fs.statSync(asset).isFile()) throw new Error(sourceDocument.slug + " references missing public asset: " + location);
    return;
  } else {
    throw new Error(sourceDocument.slug + " contains unsupported local URL: " + value);
  }
  if (!fragment) return;
  var target = documents[targetSlug];
  var headings = new Set(target.headings.map(function (heading) { return heading.id; }));
  if (!headings.has(fragment)) throw new Error(sourceDocument.slug + " links to missing fragment " + value + " on " + targetSlug);
}

function validateCatalog(catalog, contentDirectory) {
  var markdownFiles = fs.readdirSync(contentDirectory).filter(function (file) { return file.endsWith(".md"); });
  var catalogSlugs = new Set(catalog.documents.map(function (document) { return document.slug; }));
  markdownFiles.forEach(function (file) {
    var slug = file.slice(0, -3);
    if (!catalogSlugs.has(slug)) throw new Error("Markdown file is not cataloged: " + file);
  });
  catalog.documents.forEach(function (document) {
    var source = path.join(contentDirectory, document.slug + ".md");
    if (!fs.existsSync(source)) throw new Error(document.slug + " is cataloged but has no Markdown source");
    if (!String(document.title || "").trim() || !String(document.description || "").trim()) throw new Error(document.slug + " must have a nonempty title and description");
  });
  ["title", "description"].forEach(function (field) {
    var values = {};
    catalog.documents.forEach(function (document) {
      var value = document[field];
      if (!values[value]) values[value] = [];
      values[value].push(document);
    });
    Object.keys(values).forEach(function (value) {
      var duplicates = values[value];
      if (duplicates.length < 2) return;
      var allowed = duplicates.every(function (document) { return document.legacy && document.canonicalSlug && document.canonicalSlug !== document.slug; });
      if (!allowed) throw new Error("Catalog " + field + " must be unique: " + value);
    });
  });
}

function validateRenderedDocuments(documents, catalog, contentDirectory, publicDirectory) {
  validateCatalog(catalog, contentDirectory);
  var bySlug = documentBySlug(documents);
  documents.forEach(function (document) {
    localAttributes(document.html).forEach(function (attribute) { validateLocalAttribute(attribute, document, bySlug, publicDirectory); });
  });
  return true;
}

module.exports = { validateCatalog: validateCatalog, validateRenderedDocuments: validateRenderedDocuments };
