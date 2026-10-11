// Compatibility write-through bridge for Mate durable memory and knowledge.
//
// The startup importer alone goes stale the moment a Mate writes a digest or a
// user edits a knowledge file. This module keeps the Knowledge scope current
// after every known mutation, without changing how the legacy files are
// written. Legacy files stay authoritative and rollback-compatible; the new
// backend is a continuously reconciled mirror.
//
// Reconciliation is source-level, not event-level. A caller says "this source
// changed" and this module re-reads that one file and makes the scope match it:
// creating, revising, reviving, or tombstoning as required. That makes every
// call idempotent and makes deletions and rewrites work without the call site
// having to describe what changed.
//
// Identity is never mirrored. CLAUDE.md, base-template.md, identity-backup.md,
// and identity-history.jsonl define who a Mate is and remain canonical files.
// Sticky notes are a separate attention layer and are excluded too.

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");
var knowledgeImport = require("./knowledge-import");

var SOURCE_NAMESPACE = "mate-knowledge";
var SOURCE_VERSION = 3;
var MAX_SOURCE_BYTES = 64 * 1024 * 1024;

// Identity and template artifacts. Never mirrored, at any version.
var IDENTITY_FILES = ["base-template.md", "identity-backup.md", "identity-history.jsonl"];
// Sticky notes remain the separate attention layer, with their own store.
var EXCLUDED_FILES = ["sticky-notes.md"];

// Line-addressed journals get one record per line, keyed by line content.
var JOURNAL_KINDS = {
  "session-digests.jsonl": "session-digest",
  "user-observations.jsonl": "user-observation",
};

function matesHome() {
  return path.resolve(path.join(config.CONFIG_DIR, "mates"));
}

// Derived from the Mate storage root path alone, so the startup importer and
// the live bridge always agree on a scope without needing the same context.
function ownerKeyForRoot(matesRoot) {
  var resolved = path.resolve(matesRoot);
  var parent = path.dirname(resolved);
  var name = path.basename(resolved);
  if (parent === matesHome() && name.indexOf("mate_") !== 0) return "u-" + name;
  return "h-" + crypto.createHash("sha256").update(resolved).digest("hex").substring(0, 16);
}

function scopeIdFor(ownerKey, mateId) {
  return "mate/" + ownerKey + "/" + mateId;
}

// A Mate project's cwd is its Mate directory, so every call site can pass what
// it already has.
function scopeForMateDir(mateDir) {
  var resolved = path.resolve(mateDir);
  var mateId = path.basename(resolved);
  if (mateId.indexOf("mate_") !== 0) return null;
  var matesRoot = path.dirname(resolved);
  var ownerKey = ownerKeyForRoot(matesRoot);
  var parent = path.dirname(path.resolve(matesRoot));
  return {
    mateId: mateId,
    mateDir: resolved,
    matesRoot: matesRoot,
    ownerKey: ownerKey,
    userId: parent === matesHome() ? path.basename(matesRoot) : null,
    scopeId: scopeIdFor(ownerKey, mateId),
  };
}

function sourceKindFor(name) {
  if (IDENTITY_FILES.indexOf(name) !== -1) return null;
  if (EXCLUDED_FILES.indexOf(name) !== -1) return null;
  if (name === "memory-summary.md") return "memory-summary";
  if (JOURNAL_KINDS[name]) return JOURNAL_KINDS[name];
  if (/\.md$/.test(name)) return "knowledge-file";
  if (/\.jsonl$/.test(name)) return "knowledge-journal";
  return null;
}

function safeSourceName(value) {
  var name = String(value || "").replace(/\\/g, "/").replace(/^\.\//, ""); var parts = name.split("/");
  if (!name || name[0] === "/" || name.length > 500 || parts.length > 20) return null;
  if (parts.some(function (part) { return !part || part === "." || part === ".." || part.length > 120; })) return null;
  return parts.join("/");
}

function isJournal(name) {
  return !!JOURNAL_KINDS[name] || /\.jsonl$/.test(name);
}

function normalizeActor(actor) {
  var source = actor || {};
  var type = ["user", "agent", "system", "migration"].indexOf(source.type) !== -1 ? source.type : "system";
  return {
    type: type,
    userId: source.userId ? String(source.userId).substring(0, 120) : null,
    displayName: source.displayName ? String(source.displayName).substring(0, 120) : null,
    sessionKey: source.sessionKey ? String(source.sessionKey).substring(0, 200) : null,
    vendor: source.vendor ? String(source.vendor).substring(0, 40) : null,
  };
}

// Relative to the Mate directory. The scope already identifies the owner and
// the Mate, so an absolute filesystem path would add nothing but exposure.
function relativeSource(name) {
  return "knowledge/" + name;
}

function provenance(scope, name, extra) {
  var base = {
    namespace: SOURCE_NAMESPACE,
    sourceVersion: SOURCE_VERSION,
    relPath: relativeSource(name),
    fileName: name,
    ownerKey: scope.ownerKey,
    userId: scope.userId,
    mateId: scope.mateId,
    mateName: scope.mateName || null,
  };
  if (!extra) return base;
  return Object.assign(base, extra);
}

// Identify a live record that this module wrote, by provenance rather than by
// parsing an import key. A record from another namespace, or from a source
// version this build does not understand, is left strictly alone: reconciling
// it could tombstone something whose meaning we do not know.
function isMateSourceEntry(entry) {
  if (!entry || entry.deleted === true) return false;
  if (entry.kind === "chunk") return false;
  var source = entry.source;
  if (!source || source.namespace !== SOURCE_NAMESPACE) return false;
  if (typeof source.sourceVersion !== "number" || source.sourceVersion > SOURCE_VERSION) return false;
  var name = source.fileName;
  if (!name || typeof name !== "string") return false;
  // The source name and relative path must agree, so neither field alone is trusted.
  if (safeSourceName(name) !== name) return false;
  return source.relPath === relativeSource(name);
}

function fileKey(name) {
  return "file:" + name;
}

function journalKey(name, hash) {
  return "journal:" + name + ":" + hash.substring(0, 24);
}

function newSummary() {
  return {
    created: 0,
    revised: 0,
    revived: 0,
    unchanged: 0,
    deleted: 0,
    absent: 0,
    "already-deleted": 0,
    chunked: 0,
    malformedLines: 0,
    identitySkipped: 0,
    excluded: 0,
    unsupported: 0,
    empty: 0,
    failed: 0,
    errors: [],
  };
}

function record(summary, action) {
  if (summary[action] === undefined) summary[action] = 0;
  summary[action]++;
}

function readStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (e) {
    return null;
  }
}

function safeKnowledgeFileStat(root, name) {
  var parts = name.split("/"); var cursor = root;
  for (var i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]); var stat;
    try { stat = fs.lstatSync(cursor); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (stat.isSymbolicLink()) throw new Error("Knowledge source contains a symbolic link.");
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error("Knowledge source path is not a directory.");
    if (i === parts.length - 1 && !stat.isFile()) return null;
  }
  return fs.statSync(cursor);
}

// --- File-addressed sources -------------------------------------------

function syncFile(importer, scope, name, kind, filePath, stat, actor, summary) {
  if (!stat) {
    // The legacy file is gone. Tombstone rather than leaving stale content live.
    var removed = importer.removeRecord(fileKey(name), {
      actor: actor,
      source: provenance(scope, name, { type: kind, reason: "source-removed" }),
    });
    record(summary, removed.action);
    return;
  }
  if (stat.size > MAX_SOURCE_BYTES) {
    summary.failed++;
    summary.errors.push({ scopeId: scope.scopeId, file: name, message: "Source exceeds the maximum representable size." });
    return;
  }
  var content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    summary.failed++;
    summary.errors.push({ scopeId: scope.scopeId, file: name, message: "Unreadable source: " + e.message });
    return;
  }
  if (!content.trim()) {
    // An emptied file is a logical removal, not a blank record.
    var emptied = importer.removeRecord(fileKey(name), {
      actor: actor,
      source: provenance(scope, name, { type: kind, reason: "source-emptied" }),
    });
    summary.empty++;
    if (emptied.action === "deleted") summary.deleted++;
    return;
  }
  var result = importer.importRecord({
    importKey: fileKey(name),
    sourceHash: knowledgeImport.contentHash(content),
    kind: kind,
    name: name,
    content: content,
    at: Math.round(stat.mtimeMs),
    actor: actor,
    source: provenance(scope, name, {
      type: kind,
      sourceBytes: stat.size,
      sourceModifiedAt: stat.mtimeMs,
    }),
  });
  record(summary, result.action);
  if (content.length > knowledgeImport.MAX_CONTENT_CHARS) summary.chunked++;
  // Verified whenever something was actually written. An unchanged source was
  // already verified when it landed, so the steady-state path stays cheap.
  if (result.action !== "unchanged") verifyRoundTrip(importer, fileKey(name), scope, name, summary);
}

// --- Line-addressed journals ------------------------------------------

// Reconciles the whole journal: every present line is imported, and every line
// previously imported from this journal that is no longer present is
// tombstoned. A digest deleted through the memory UI therefore stops being a
// live memory instead of lingering in the new backend.
function syncJournal(importer, scope, name, kind, filePath, stat, actor, summary) {
  var raw = "";
  if (stat) {
    if (stat.size > MAX_SOURCE_BYTES) {
      summary.failed++;
      summary.errors.push({ scopeId: scope.scopeId, file: name, message: "Source exceeds the maximum representable size." });
      return;
    }
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      summary.failed++;
      summary.errors.push({ scopeId: scope.scopeId, file: name, message: "Unreadable source: " + e.message });
      return;
    }
  }

  var present = {};
  var lines = raw.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      summary.malformedLines++;
      continue;
    }
    // A journal entry is a plain object. An array or a bare scalar parses
    // cleanly but is not a record, so it is skipped rather than imported.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      summary.malformedLines++;
      continue;
    }
    var hash = knowledgeImport.contentHash(line);
    var key = journalKey(name, hash);
    present[key] = true;
    var result = importer.importRecord({
      importKey: key,
      sourceHash: hash,
      kind: kind,
      name: name,
      content: line,
      actor: actor,
      source: provenance(scope, name, {
        type: kind,
        lineIndex: i,
        sourceDate: typeof parsed.date === "string" ? parsed.date : null,
        sourceBytes: Buffer.byteLength(line, "utf8"),
        sourceModifiedAt: stat ? stat.mtimeMs : null,
      }),
    });
    record(summary, result.action);
    if (line.length > knowledgeImport.MAX_CONTENT_CHARS) summary.chunked++;
    if (result.action === "created" || result.action === "revived") {
      verifyRoundTrip(importer, key, scope, name, summary);
    }
  }

  // Every live line this module imported from this journal that the legacy
  // file no longer contains. Selected by provenance, so a record from another
  // namespace sharing a file name is never touched.
  var stale = [];
  var live = importer.entries();
  for (var e = 0; e < live.length; e++) {
    if (!isMateSourceEntry(live[e])) continue;
    if (live[e].source.fileName !== name) continue;
    if (present[live[e].importKey]) continue;
    stale.push(live[e].importKey);
  }
  for (var s = 0; s < stale.length; s++) {
    var removed = importer.removeRecord(stale[s], {
      actor: actor,
      source: provenance(scope, name, { type: kind, reason: "line-removed" }),
    });
    record(summary, removed.action);
  }
}

// No source may be reported as successfully mirrored while its content cannot
// be read back exactly.
function verifyRoundTrip(importer, importKey, scope, name, summary) {
  var entries = importer.entries();
  var entry = null;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].importKey === importKey) { entry = entries[i]; break; }
  }
  if (!entry) {
    summary.failed++;
    summary.errors.push({ scopeId: scope.scopeId, file: name, message: "Imported record is not readable: " + importKey });
    return;
  }
  var read = importer.readContent(entry);
  if (!read.complete) {
    summary.failed++;
    summary.errors.push({
      scopeId: scope.scopeId,
      file: name,
      message: (entry.chunked ? "Chunked source did not reassemble: " : "Stored source did not verify: ") + (read.reason || "unknown"),
    });
  }
}

// --- Public API --------------------------------------------------------

function importerFor(scope, baseDir) {
  return knowledgeImport.createKnowledgeImporter({ scopeId: scope.scopeId, baseDir: baseDir });
}

// Reconcile exactly one Mate knowledge source against the new backend. Safe to
// call after any legacy write, including a delete. Never throws.
function syncMateSource(opts) {
  var options = opts || {};
  var summary = options.summary || newSummary();
  try {
    var scope = options.scope || scopeForMateDir(options.mateDir);
    if (!scope) return summary;
    if (options.mateName) scope.mateName = options.mateName;
    var rawName = String(options.fileName || ""); var name = safeSourceName(rawName);
    if (!name) { if (rawName) summary.unsupported++; return summary; }
    if (IDENTITY_FILES.indexOf(name) !== -1) { summary.identitySkipped++; return summary; }
    if (EXCLUDED_FILES.indexOf(name) !== -1) { summary.excluded++; return summary; }
    var kind = sourceKindFor(name);
    if (!kind) { summary.unsupported++; return summary; }

    var actor = normalizeActor(options.actor);
    var importer = options.importer || importerFor(scope, options.baseDir);
    var knowledgeRoot = path.join(scope.mateDir, "knowledge"); var filePath = path.join(knowledgeRoot, name);
    var stat = safeKnowledgeFileStat(knowledgeRoot, name);

    if (isJournal(name)) syncJournal(importer, scope, name, kind, filePath, stat, actor, summary);
    else syncFile(importer, scope, name, kind, filePath, stat, actor, summary);
  } catch (e) {
    summary.failed++;
    summary.errors.push({ message: e.message });
  }
  return summary;
}

function reconcileSource(opts) {
  return syncMateSource(opts);
}

// Reconcile every durable source in one Mate directory, in both directions.
function reconcileMate(opts) {
  var options = opts || {};
  var summary = options.summary || newSummary();
  var scope = options.scope || scopeForMateDir(options.mateDir);
  if (!scope) return summary;
  if (options.mateName) scope.mateName = options.mateName;
  var knowledgeDir = path.join(scope.mateDir, "knowledge");
  var present = {};
  var entries = [];
  function discover(relative) {
    var folder = relative ? path.join(knowledgeDir, relative) : knowledgeDir; var children;
    try { children = fs.readdirSync(folder, { withFileTypes: true }); } catch (error) { return; }
    for (var d = 0; d < children.length; d++) {
      var name = relative ? relative + "/" + children[d].name : children[d].name; var stat;
      try { stat = fs.lstatSync(path.join(knowledgeDir, name)); } catch (error) { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) discover(name); else if (stat.isFile()) entries.push({ name: name });
    }
  }
  discover("");
  var importer = options.importer || importerFor(scope, options.baseDir);

  function reconcileOne(fileName) {
    syncMateSource({
      scope: scope,
      fileName: fileName,
      actor: options.actor,
      importer: importer,
      baseDir: options.baseDir,
      summary: summary,
    });
  }

  for (var i = 0; i < entries.length; i++) {
    // Recorded as present whatever its kind, so an excluded or unsupported file
    // that still exists is never mistaken for a deleted source.
    present[entries[i].name] = true;
    reconcileOne(entries[i].name);
  }

  var absent = {};
  var live = importer.entries();
  for (var e = 0; e < live.length; e++) {
    if (!isMateSourceEntry(live[e])) continue;
    var name = live[e].source.fileName;
    if (present[name] || absent[name]) continue;
    absent[name] = true;
  }
  var absentNames = Object.keys(absent);
  for (var a = 0; a < absentNames.length; a++) reconcileOne(absentNames[a]);
  return summary;
}

// Fire-and-forget wrapper for legacy write paths. A mirroring failure must
// never break the legacy write that already succeeded.
function syncQuietly(opts) {
  try {
    var summary = syncMateSource(opts);
    if (summary.failed > 0 && summary.errors.length > 0) {
      console.error("[knowledge-sync] Mate knowledge mirror failed:", summary.errors[0].message);
    }
    return summary;
  } catch (e) {
    console.error("[knowledge-sync] Mate knowledge mirror failed:", e.message);
    return null;
  }
}

module.exports = {
  SOURCE_NAMESPACE: SOURCE_NAMESPACE,
  SOURCE_VERSION: SOURCE_VERSION,
  MAX_SOURCE_BYTES: MAX_SOURCE_BYTES,
  IDENTITY_FILES: IDENTITY_FILES,
  EXCLUDED_FILES: EXCLUDED_FILES,
  JOURNAL_KINDS: JOURNAL_KINDS,
  ownerKeyForRoot: ownerKeyForRoot,
  scopeIdFor: scopeIdFor,
  scopeForMateDir: scopeForMateDir,
  sourceKindFor: sourceKindFor,
  isMateSourceEntry: isMateSourceEntry,
  normalizeActor: normalizeActor,
  newSummary: newSummary,
  fileKey: fileKey,
  journalKey: journalKey,
  importerFor: importerFor,
  syncMateSource: syncMateSource,
  reconcileSource: reconcileSource,
  reconcileMate: reconcileMate,
  syncQuietly: syncQuietly,
};
