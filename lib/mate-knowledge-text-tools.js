// Session-bound text Knowledge mutations for one authorized Mate.
//
// This module deliberately uses the existing portable file store and
// write-through synchronizer. It never accepts a Mate, owner, or filesystem
// root from a tool caller; the caller supplies only a relative document name
// or the stable identity returned by the store.

var crypto = require("crypto");
var path = require("path");
var knowledgeFiles = require("./knowledge-file-store");
var mateSync = require("./mate-knowledge-sync");

function metadataRoot(baseDir, mateDir) {
  var key = crypto.createHash("sha256").update(path.resolve(mateDir)).digest("hex").slice(0, 24);
  return path.join(baseDir || path.join(mateDir, ".clay"), "knowledge-documents", key);
}

function failedSync(summary) {
  if (!summary) return { indexSyncPending: true, syncError: "Knowledge index synchronization returned no result." };
  if (summary.failed === 0) return { indexSyncPending: false, syncError: null };
  var error = summary.errors && summary.errors[0];
  return { indexSyncPending: true, syncError: error && error.message || "Knowledge index synchronization failed." };
}

function createMateKnowledgeTextTools(options) {
  var settings = options || {};
  var stores = new Map();

  function storeFor(mate) {
    if (!mate || typeof mate.mateDir !== "string") throw new Error("Knowledge text tools require an authorized Mate.");
    var directory = path.resolve(mate.mateDir);
    if (!stores.has(directory)) stores.set(directory, knowledgeFiles.createKnowledgeFileStore(directory, { metaDir: metadataRoot(settings.baseDir, directory) }));
    return stores.get(directory);
  }

  function find(store, input) {
    var args = input || {};
    var hasName = typeof args.name === "string" && args.name.length > 0;
    var hasId = typeof args.documentId === "string" && args.documentId.length > 0;
    if (!hasName && !hasId) throw new Error("A document name or stable document id is required.");
    var item = null;
    if (hasId) item = store.list().filter(function (entry) { return entry.id === args.documentId; })[0] || null;
    if (hasId && !item) throw Object.assign(new Error("Knowledge document not found."), { code: "ENOENT" });
    if (hasName) {
      var byName = store.read(args.name);
      if (item && item.id !== byName.id) throw new Error("The document name and id identify different documents.");
      item = byName;
    }
    if (!item) throw Object.assign(new Error("Knowledge document not found."), { code: "ENOENT" });
    if (hasId && !hasName) item = store.read(item.name);
    if (item.itemType !== "text") throw Object.assign(new Error("Only Markdown Knowledge documents are writable through these tools."), { code: "READ_ONLY" });
    return item;
  }

  function sync(mate, name, actor) {
    try {
      var summary = mateSync.syncMateSource({ mateDir: mate.mateDir, fileName: name, baseDir: settings.baseDir, actor: actor });
      return failedSync(summary);
    } catch (error) {
      return { indexSyncPending: true, syncError: error.message || "Knowledge index synchronization failed." };
    }
  }

  function read(mate, args) {
    var item = find(storeFor(mate), args);
    return { documentId: item.id, name: item.name, content: item.content, revision: item.revision };
  }

  function create(mate, args, actor) {
    var input = args || {};
    if (typeof input.name !== "string" || !input.name) throw new Error("A document name is required to create a Knowledge document.");
    if (typeof input.content !== "string") throw new Error("Document content is required.");
    var store = storeFor(mate);
    var saved = store.save(input.name, input.content, null);
    return Object.assign({ documentId: saved.id, name: saved.name, revision: saved.revision }, sync(mate, saved.name, actor));
  }

  function update(mate, args, actor) {
    var input = args || {};
    if (typeof input.expectedRevision !== "string" || !input.expectedRevision) throw Object.assign(new Error("A current document revision is required for updates."), { code: "STALE" });
    if (typeof input.content !== "string") throw new Error("Document content is required.");
    var store = storeFor(mate);
    var current = find(store, input);
    var saved = store.save(current.name, input.content, input.expectedRevision);
    return Object.assign({ documentId: saved.id, name: saved.name, revision: saved.revision }, sync(mate, saved.name, actor));
  }

  function history(mate, args) {
    var current = find(storeFor(mate), args);
    return { documentId: current.id, name: current.name, versions: storeFor(mate).history(current.id) };
  }

  function restore(mate, args, actor) {
    var input = args || {};
    if (typeof input.expectedRevision !== "string" || !input.expectedRevision) throw Object.assign(new Error("A current document revision is required for restore."), { code: "STALE" });
    if (typeof input.version !== "string" || !input.version) throw new Error("A history version is required.");
    var store = storeFor(mate);
    var current = find(store, input);
    var restored = store.restore(current.id, input.version, current.name, input.expectedRevision);
    return Object.assign({ documentId: restored.id, name: restored.name, revision: restored.revision }, sync(mate, restored.name, actor));
  }

  return { read: read, create: create, update: update, history: history, restore: restore };
}

module.exports = { createMateKnowledgeTextTools: createMateKnowledgeTextTools };
