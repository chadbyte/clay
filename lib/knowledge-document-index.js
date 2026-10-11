var crypto = require("crypto");
var markdown = require("./knowledge-markdown");

var MAX_INDEX_BYTES = 64 * 1024 * 1024;
var MAX_RESULT_LIMIT = 100;

function identity(file) {
  return file.common ? "shared:" + encodeURIComponent(file.ownMateId || "unknown") + ":" + encodeURIComponent(file.id || file.name) : "local:" + encodeURIComponent(file.id || file.name);
}

function createKnowledgeDocumentIndex(options) {
  var cache = {};

  function reconcile() {
    var listed = options.list(); var documents = []; var next = {}; var errors = []; var bytes = 0;
    for (var i = 0; i < listed.length; i++) {
      var file = listed[i]; var key = identity(file); var known = cache[key]; var content; var token = file.revision || null;
      if (file.size > options.maxDocumentBytes) { errors.push({ name: file.name, code: "TOO_LARGE", error: "Document exceeds the safe read limit." }); continue; }
      if (known && token && known.token === token) {
        if (bytes + known.bytes > MAX_INDEX_BYTES) { errors.push({ name: file.name, code: "INDEX_LIMIT", error: "Workspace Knowledge exceeds the safe index limit." }); continue; }
        next[key] = known; documents.push(known.document); bytes += known.bytes; continue;
      }
      try { content = options.read(file); } catch (error) { errors.push({ name: file.name, code: error.code || "READ_FAILED", error: error.message }); continue; }
      var size = Buffer.byteLength(content, "utf8");
      if (size > options.maxDocumentBytes) { errors.push({ name: file.name, code: "TOO_LARGE", error: "Document exceeds the safe read limit." }); continue; }
      if (bytes + size > MAX_INDEX_BYTES) { errors.push({ name: file.name, code: "INDEX_LIMIT", error: "Workspace Knowledge exceeds the safe index limit." }); continue; }
      token = token || crypto.createHash("sha256").update(content, "utf8").digest("hex");
      var parsed = file.itemType === "db" ? { links: [], headings: [], tags: [], properties: {}, propertyErrors: [] } : markdown.parse(content);
      var document = Object.assign({}, file, { key: key, content: content, parsed: parsed });
      next[key] = { token: token, bytes: size, document: document }; documents.push(document); bytes += size;
    }
    cache = next;
    return { documents: documents, errors: errors, complete: errors.length === 0, bytes: bytes };
  }

  function search(query, offset, limit) {
    var indexed = reconcile(); var needle = String(query || "").trim().toLowerCase().slice(0, 200); var matches = [];
    if (needle) for (var i = 0; i < indexed.documents.length; i++) {
      var file = indexed.documents[i]; var at = file.content.toLowerCase().indexOf(needle);
      if (file.name.toLowerCase().indexOf(needle) !== -1 || at !== -1) matches.push(Object.assign({}, file, { content: undefined, parsed: undefined, snippet: markdown.snippet(file.content, at === -1 ? 0 : at, needle) }));
    }
    var start = Math.max(0, Number(offset) || 0); var count = Math.max(1, Math.min(MAX_RESULT_LIMIT, Number(limit) || 50));
    return { files: matches.slice(start, start + count), total: matches.length, offset: start, limit: count, complete: indexed.complete, errors: indexed.errors };
  }

  return { reconcile: reconcile, search: search, identity: identity };
}

module.exports = { createKnowledgeDocumentIndex: createKnowledgeDocumentIndex, identity: identity, MAX_INDEX_BYTES: MAX_INDEX_BYTES, MAX_RESULT_LIMIT: MAX_RESULT_LIMIT };
