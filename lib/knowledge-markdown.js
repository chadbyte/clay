var path = require("path");

function slug(value) {
  return String(value || "").trim().toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}

function frontmatter(content) {
  var text = String(content || "");
  if (text.indexOf("---\n") !== 0) return { properties: {}, tags: [], end: 0, errors: [] };
  var close = text.indexOf("\n---\n", 4);
  if (close === -1 || close > 8192) return { properties: {}, tags: [], end: 0, errors: ["Frontmatter is missing its closing --- line."] };
  var properties = {}; var errors = []; var lines = text.slice(4, close).split("\n");
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].trim() || /^\s*#/.test(lines[i])) continue;
    var match = /^([A-Za-z][A-Za-z0-9_-]{0,63}):\s*(.*)$/.exec(lines[i]);
    if (!match) { errors.push("Invalid property on line " + (i + 2) + "."); continue; }
    var value = match[2].trim();
    if (value.length > 500) errors.push("Property " + match[1] + " is too long.");
    else properties[match[1]] = value;
  }
  var tags = [];
  if (properties.tags) {
    var raw = properties.tags.replace(/^\[/, "").replace(/\]$/, "").split(",");
    for (var t = 0; t < raw.length; t++) {
      var tag = raw[t].trim().replace(/^#/, "");
      if (/^[\p{L}\p{N}_/-]{1,64}$/u.test(tag) && tags.indexOf(tag) === -1) tags.push(tag);
      else if (tag) errors.push("Invalid tag: " + tag);
    }
  }
  return { properties: properties, tags: tags, end: close + 5, errors: errors };
}

function ignoredRanges(text) {
  var ranges = []; var lines = text.split("\n"); var offset = 0; var fence = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]; var marker = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker && (!fence || marker[2][0] === fence.marker && marker[2].length >= fence.length && /^\s*$/.test(marker[3]))) {
      if (!fence) fence = { marker: marker[2][0], length: marker[2].length, start: offset };
      else { ranges.push([fence.start, offset + line.length]); fence = null; }
    }
    if (!fence) {
      var cursor = 0;
      while (cursor < line.length) {
        var opener = /`+/.exec(line.slice(cursor)); if (!opener) break;
        var start = cursor + opener.index; var run = opener[0]; var close = line.indexOf(run, start + run.length);
        if (close === -1) { cursor = start + run.length; continue; }
        ranges.push([offset + start, offset + close + run.length]); cursor = close + run.length;
      }
    }
    offset += line.length + 1;
  }
  if (fence) ranges.push([fence.start, text.length]);
  return ranges;
}

function escaped(text, start) {
  var slashes = 0;
  for (var i = start - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function inside(ranges, start) {
  for (var i = 0; i < ranges.length; i++) if (start >= ranges[i][0] && start < ranges[i][1]) return true;
  return false;
}

function parse(content) {
  var text = String(content || ""); var ignored = ignoredRanges(text); var links = []; var headings = []; var match;
  var headingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
  while ((match = headingPattern.exec(text))) {
    if (!inside(ignored, match.index)) headings.push({ depth: match[1].length, text: match[2].trim(), slug: slug(match[2]), offset: match.index });
  }
  var wiki = /(!)?\[\[([^\]\n]+)\]\]/g;
  while ((match = wiki.exec(text))) {
    if (inside(ignored, match.index) || escaped(text, match.index)) continue;
    var parts = match[2].split("|"); var target = parts[0].trim(); var alias = parts.length > 1 ? parts.slice(1).join("|").trim() : "";
    var hash = target.indexOf("#");
    var wikiTarget = hash === -1 ? target : target.slice(0, hash);
    links.push({ kind: match[1] ? "embed" : "wiki", target: wikiTarget, heading: hash === -1 ? "" : target.slice(hash + 1), alias: alias,
      start: match.index, end: match.index + match[0].length, raw: match[0], external: /^[a-z][a-z0-9+.-]*:/i.test(wikiTarget) || wikiTarget.indexOf("//") === 0 });
  }
  var markdown = /(!)?\[([^\]\n]*)\]\(([^)\n]+)\)/g;
  while ((match = markdown.exec(text))) {
    if (inside(ignored, match.index) || escaped(text, match.index)) continue;
    var destination = match[3].trim().replace(/^<|>$/g, ""); var hashAt = destination.indexOf("#");
    links.push({ kind: match[1] ? "image" : "markdown", target: hashAt === -1 ? destination : destination.slice(0, hashAt), heading: hashAt === -1 ? "" : destination.slice(hashAt + 1), alias: match[2],
      start: match.index, end: match.index + match[0].length, raw: match[0], external: /^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.indexOf("//") === 0 });
  }
  links.sort(function (a, b) { return a.start - b.start; });
  var meta = frontmatter(text); var tags = meta.tags.slice(); var tagPattern = /(^|\s)#([\p{L}\p{N}_/-]{1,64})/gu;
  while ((match = tagPattern.exec(text))) if (!inside(ignored, match.index) && tags.indexOf(match[2]) === -1) tags.push(match[2]);
  return { links: links, headings: headings, properties: meta.properties, tags: tags, propertyErrors: meta.errors };
}

function normalizeTarget(sourceName, target) {
  var raw = String(target || "").trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.indexOf("//") === 0) return null;
  try { raw = decodeURIComponent(raw); } catch (error) {}
  raw = raw.replace(/\\/g, "/");
  if (!/\.md$/i.test(raw)) raw += ".md";
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourceName), raw)).replace(/^\.\//, "");
}

function resolveLink(sourceName, link, documents, sourceId) {
  if (link.external) return null;
  if (!link.target && link.heading) {
    var self = documents.filter(function (item) { return sourceId ? item.id === sourceId : item.name === sourceName; });
    return self.length === 1 ? self[0] : null;
  }
  var target = normalizeTarget(sourceName, link.target);
  if (!target) return null;
  var exact = documents.filter(function (item) { return item.name.toLowerCase() === target.toLowerCase(); });
  if (exact.length === 1) return exact[0];
  if (link.target.indexOf("/") === -1 && link.target.indexOf("\\") === -1) {
    var base = path.posix.basename(target).toLowerCase();
    var named = documents.filter(function (item) { return path.posix.basename(item.name).toLowerCase() === base; });
    if (named.length === 1) return named[0];
  }
  return null;
}

function snippet(content, offset, needle) {
  var raw = String(content || ""); var at = typeof offset === "number" ? offset : raw.toLowerCase().indexOf(String(needle || "").toLowerCase());
  if (at < 0) at = 0; var start = Math.max(0, at - 70); var end = Math.min(raw.length, at + 150); var text = raw.slice(start, end).replace(/\s+/g, " ").trim();
  return (start ? "…" : "") + text + (end < raw.length ? "…" : "");
}

module.exports = { parse: parse, slug: slug, normalizeTarget: normalizeTarget, resolveLink: resolveLink, snippet: snippet };
