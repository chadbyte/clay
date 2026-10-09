// Read projection and authorization for Mate Knowledge.
//
// Reads the continuously synchronized Clay Knowledge records, never the legacy
// files. Chunk records and tombstones are excluded, chunked content is
// reassembled and hash-verified, and a record that cannot be read back exactly
// is refused rather than returned partially.
//
// Authorization mirrors project-logs-service.js: a caller never states who it
// is. An ordinary Mate is bound to its own scope and can express no other, and
// only the authoritative builtin Clay host agent receives same-user cross-Mate
// reads. No binding ever spans users.

var path = require("path");
var builtinMates = require("./builtin-mates");
var knowledgeImport = require("./knowledge-import");
var knowledgeSearch = require("./knowledge-search");
var mateSync = require("./mate-knowledge-sync");

var MAX_PAGE = 50;
var DEFAULT_PAGE = 20;
var MAX_QUERY_CHARS = 200;
var MAX_PREVIEW_CHARS = 240;
var MAX_SNIPPET_CHARS = 320;
// Reads are bounded and continuable rather than refused. A record larger than
// one response is returned as verified slices the caller can page through.
var DEFAULT_READ_CHARS = 8000;
var MAX_READ_CHARS = 40000;
var REF_PATTERN = /^know:[A-Za-z0-9_-]{24}$/;

// Name outranks body slightly; a Mate's knowledge file names are meaningful,
// while journal lines all share one file name and rank on content.
var NAME_WEIGHT = 2;
var BODY_WEIGHT = 1;

function parseLimit(value) {
  var limit = Number(value);
  if (!Number.isFinite(limit)) limit = DEFAULT_PAGE;
  return Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)));
}

function encodeCursor(offset) {
  return offset > 0 ? Buffer.from(String(offset), "utf8").toString("base64url") : null;
}

function decodeCursor(value) {
  if (!value) return 0;
  try {
    var parsed = Number(Buffer.from(String(value), "base64url").toString("utf8"));
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch (e) {
    return 0;
  }
}

function page(items, args) {
  var offset = decodeCursor(args && args.cursor);
  var limit = parseLimit(args && args.limit);
  return {
    items: items.slice(offset, offset + limit),
    nextCursor: offset + limit < items.length ? encodeCursor(offset + limit) : null,
    total: items.length,
  };
}

function parseOffset(value) {
  var offset = Number(value);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

function parseReadSize(value) {
  var size = Number(value);
  if (!Number.isFinite(size)) size = DEFAULT_READ_CHARS;
  return Math.max(1, Math.min(MAX_READ_CHARS, Math.floor(size)));
}

// Never end a slice inside a UTF-16 surrogate pair, so every slice is on its
// own a valid string and concatenating slices reproduces the source exactly.
function safeSliceEnd(text, end) {
  if (end >= text.length) return text.length;
  var code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) return end - 1;
  return end;
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  var text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.substring(0, max) : text;
}

function attachMateKnowledgeService(ctx) {
  var context = ctx || {};
  var getProjects = context.getProjects;
  var isMultiUser = context.isMultiUser;
  var resolveMate = context.resolveMate;
  var listMates = context.listMates || function () { return []; };
  var baseDir = context.baseDir;
  var importerCache = new Map();

  function importerForScope(scopeId) {
    if (context.openImporter) return context.openImporter(scopeId);
    if (!importerCache.has(scopeId)) {
      importerCache.set(scopeId, knowledgeImport.createKnowledgeImporter({ scopeId: scopeId, baseDir: baseDir }));
    }
    return importerCache.get(scopeId);
  }

  // --- Read projection --------------------------------------------------

  // Bring this exact Mate's records up to date with its legacy files before
  // reading them, so a direct filesystem edit or an offline deletion is visible
  // on the next tool call instead of only after a daemon restart. Only ever
  // called for a scope the principal is already authorized for. Reconciliation
  // is idempotent, so a no-op call appends nothing.
  // A reconciliation failure means the record for that source may no longer
  // match the legacy file. Presenting the previous record would be stale
  // content dressed as current, so every failure is attributed to a source and
  // that source is withheld. A failure that cannot be attributed withholds the
  // whole scope, because there is no way to know which record is stale.
  function refresh(mate) {
    if (context.syncBeforeRead === false || !mate.mateDir) {
      return { failed: 0, files: {}, scopeFailed: false };
    }
    var summary;
    try {
      summary = mateSync.reconcileMate({
        mateDir: mate.mateDir,
        mateName: mate.mateName,
        baseDir: baseDir,
        importer: importerForScope(mate.scopeId),
        actor: { type: "system" },
      });
    } catch (e) {
      return { failed: 1, files: {}, scopeFailed: true };
    }
    var failed = (summary && summary.failed) || 0;
    if (failed === 0) return { failed: 0, files: {}, scopeFailed: false };

    var files = {};
    var attributed = 0;
    var errors = (summary && summary.errors) || [];
    for (var i = 0; i < errors.length; i++) {
      var name = errors[i] && errors[i].file;
      // Only a plain basename is trusted as an identity; anything else is
      // treated as unattributable rather than matched loosely.
      if (typeof name !== "string" || !name || path.basename(name) !== name) continue;
      if (!files[name]) attributed++;
      files[name] = true;
    }
    return { failed: failed, files: files, scopeFailed: attributed < failed };
  }

  // entries() already excludes chunk records and tombstones. Chunked sources
  // are reassembled and hash-verified here; one that does not verify is
  // reported as degraded and left out of ranking rather than half-returned.
  function materialize(mate, refreshed) {
    var state = refreshed || refresh(mate);
    var degraded = state.failed;
    // An unattributable failure withholds every record in this scope.
    if (state.scopeFailed) return { items: [], degraded: degraded, scopeFailed: true };
    var importer = importerForScope(mate.scopeId);
    var live = importer.entries();
    var out = [];
    for (var i = 0; i < live.length; i++) {
      var entry = live[i];
      var sourceName = entry.source && entry.source.fileName;
      // Withhold the previous record for a source that just failed to reconcile.
      if (sourceName && state.files[sourceName]) continue;
      var read = importer.readContent(entry);
      if (!read.complete) {
        degraded++;
        continue;
      }
      out.push({
        ref: entry.ref,
        kind: entry.kind,
        name: entry.name,
        content: read.content,
        updatedAt: entry.updatedAt,
        revisions: entry.revisions,
        relPath: entry.source ? entry.source.relPath : null,
        sourceDate: entry.source ? entry.source.sourceDate || null : null,
        mateId: mate.mateId,
        mateName: mate.mateName || null,
      });
    }
    return { items: out, degraded: degraded, scopeFailed: false };
  }

  // Public shapes never carry the full body; read_knowledge does that.
  function summary(item, includeMate) {
    var out = {
      ref: item.ref,
      kind: item.kind,
      name: item.name,
      updatedAt: item.updatedAt,
      revisions: item.revisions,
      relPath: item.relPath,
      sourceDate: item.sourceDate,
      preview: clean(item.content, MAX_PREVIEW_CHARS),
    };
    if (includeMate) {
      out.mateId = item.mateId;
      out.mateName = item.mateName;
    }
    return out;
  }

  function projectItem(item) {
    return {
      id: item.ref,
      fields: [
        { text: item.name || "", weight: NAME_WEIGHT },
        { text: item.content || "", weight: BODY_WEIGHT },
      ],
      meta: item,
    };
  }

  function collect(mates) {
    var items = [];
    var degraded = 0;
    var degradedScopes = 0;
    for (var i = 0; i < mates.length; i++) {
      var result = materialize(mates[i]);
      degraded += result.degraded;
      if (result.scopeFailed) degradedScopes++;
      for (var j = 0; j < result.items.length; j++) items.push(result.items[j]);
    }
    return { items: items, degraded: degraded, degradedScopes: degradedScopes };
  }

  // How much of the candidate set could actually be indexed. Reported so an
  // incomplete search is stated rather than implied by an empty result.
  function coverageOf(candidates) {
    var incomplete = 0;
    for (var i = 0; i < candidates.length; i++) {
      if (!knowledgeSearch.coverage(projectItem(candidates[i]).fields).complete) incomplete++;
    }
    return incomplete;
  }

  function listFor(mates, args, includeMate) {
    var options = args || {};
    var collected = collect(mates);
    var items = collected.items;
    if (options.kind) {
      var kind = clean(String(options.kind), 60);
      items = items.filter(function (item) { return item.kind === kind; });
    }
    items.sort(function (a, b) {
      return b.updatedAt - a.updatedAt || knowledgeSearch.compareIds(a.ref, b.ref);
    });
    var result = page(items, options);
    return {
      entries: result.items.map(function (item) { return summary(item, includeMate); }),
      nextCursor: result.nextCursor,
      total: result.total,
      degraded: collected.degraded,
      degradedScopes: collected.degradedScopes,
    };
  }

  function searchFor(mates, args, includeMate) {
    var options = args || {};
    var query = clean(options.query || "", MAX_QUERY_CHARS);
    if (!query) throw new Error("A search query is required.");
    var collected = collect(mates);
    var candidates = collected.items;
    if (options.kind) {
      var kind = clean(String(options.kind), 60);
      candidates = candidates.filter(function (item) { return item.kind === kind; });
    }
    var ranked = knowledgeSearch.rank(candidates, query, projectItem, candidates.length);
    var hits = [];
    for (var i = 0; i < ranked.length; i++) {
      var item = ranked[i].meta;
      var hit = summary(item, includeMate);
      hit.score = ranked[i].score;
      hit.snippet = clean(knowledgeSearch.snippet(item.content, query, MAX_SNIPPET_CHARS), MAX_SNIPPET_CHARS);
      hits.push(hit);
    }
    hits.sort(function (a, b) {
      return b.score - a.score || b.updatedAt - a.updatedAt || knowledgeSearch.compareIds(a.ref, b.ref);
    });
    var result = page(hits, options);
    return {
      results: result.items,
      nextCursor: result.nextCursor,
      total: result.total,
      degraded: collected.degraded,
      degradedScopes: collected.degradedScopes,
      // Records whose searchable text exceeds what the index can cover. A term
      // appearing only past that bound cannot be ranked, so say so.
      incompleteCoverage: coverageOf(candidates),
      coveredCharsPerRecord: knowledgeSearch.MAX_INDEXED_CHARS,
    };
  }

  // A ref is resolved only inside the scopes this principal is authorized for,
  // so an opaque ref from elsewhere simply does not exist here.
  //
  // The whole source is always reassembled and hash-verified before any slicing,
  // so a bounded read is a window onto verified content, never a shortcut past
  // verification. A record larger than one response is continued through
  // nextOffset rather than refused.
  function readFor(mates, args, includeMate) {
    var options = args || {};
    var ref = options.ref;
    if (typeof ref !== "string" || !REF_PATTERN.test(ref)) throw new Error("A valid knowledge reference is required.");
    var offset = parseOffset(options.offset);
    var maxChars = parseReadSize(options.maxChars);
    for (var i = 0; i < mates.length; i++) {
      var state = refresh(mates[i]);
      var importer = importerForScope(mates[i].scopeId);
      var live = importer.entries();
      for (var j = 0; j < live.length; j++) {
        if (live[j].ref !== ref) continue;
        // A record whose source just failed to reconcile is refused rather than
        // served from the previous, possibly stale, content.
        if (state.scopeFailed) {
          throw new Error("This Mate's Knowledge could not be brought up to date, so reads are withheld.");
        }
        var failedName = live[j].source && live[j].source.fileName;
        if (failedName && state.files[failedName]) {
          throw new Error("The source of this knowledge record could not be brought up to date: " + failedName);
        }
        var read = importer.readContent(live[j]);
        if (!read.complete) {
          throw new Error("This knowledge record could not be read back completely: " + (read.reason || "unknown"));
        }
        var total = read.content.length;
        if (offset > total) throw new Error("Offset " + offset + " is beyond the end of this record (" + total + " characters).");
        var end = safeSliceEnd(read.content, Math.min(total, offset + maxChars));
        var slice = read.content.substring(offset, end);
        var out = summary({
          ref: live[j].ref,
          kind: live[j].kind,
          name: live[j].name,
          content: read.content,
          updatedAt: live[j].updatedAt,
          revisions: live[j].revisions,
          relPath: live[j].source ? live[j].source.relPath : null,
          sourceDate: live[j].source ? live[j].source.sourceDate || null : null,
          mateId: mates[i].mateId,
          mateName: mates[i].mateName || null,
        }, includeMate);
        delete out.preview;
        out.content = slice;
        out.offset = offset;
        out.totalChars = total;
        out.nextOffset = end < total ? end : null;
        // True only when this single response carried the whole record.
        out.complete = offset === 0 && end >= total;
        return out;
      }
    }
    throw new Error("Knowledge record not found.");
  }

  // --- Binding ----------------------------------------------------------

  function scopeForMate(mateDir, mateId, mateName) {
    var scope = mateSync.scopeForMateDir(mateDir);
    if (!scope || scope.mateId !== mateId) return null;
    return { scopeId: scope.scopeId, mateId: mateId, mateName: mateName || null, mateDir: scope.mateDir };
  }

  // Exact live Mate project and session identity, confirmed against the server
  // Mate registry. Anything that fails to line up yields no capability.
  function resolve(source) {
    if (!source || source.isMate !== true || !source.mateId) return null;
    var project = getProjects().get(source.projectSlug);
    if (!project) return null;
    var status = project.getStatus();
    if (!status || status.isMate !== true) return null;
    if (status.mateId !== source.mateId || status.projectOwnerId !== source.projectOwnerId) return null;
    if (source.session) {
      var manager = project.getSessionManager ? project.getSessionManager() : project.sm;
      if (!manager || !manager.sessions || manager.sessions.get(source.session.localId) !== source.session) return null;
    }
    if (typeof resolveMate !== "function") return null;
    var mate = resolveMate(source.projectOwnerId || null, source.mateId);
    if (!mate || mate.id !== source.mateId) return null;
    if (isMultiUser()) {
      if (!source.projectOwnerId) return null;
      if (mate.createdBy !== source.projectOwnerId) return null;
    }
    if (!status.path) return null;
    var own = scopeForMate(status.path, source.mateId, mate.name || null);
    if (!own) return null;

    var def = mate.builtinKey ? builtinMates.getBuiltinByKey(mate.builtinKey) : null;
    var isClay = !!(mate.builtinKey === "clay" && def && def.hostAgent === true);
    return { own: own, isClay: isClay, ownerId: source.projectOwnerId || null,
      databaseService: typeof project.getKnowledgeDbService === "function" ? project.getKnowledgeDbService() : null,
      actor: { type: "user", userId: source.session && source.session.ownerId || source.projectOwnerId || null, displayName: null } };
  }

  // A tool handler captured earlier stays valid only while its exact source
  // still resolves. Identity is re-derived on every call, so a session that has
  // since been dropped, a Mate that has been deleted, or a registry entry that
  // has changed hands loses the capability immediately rather than continuing
  // to work through a handler that was created while it was still live.
  function bind(source) {
    var initial = resolve(source);
    if (!initial) return null;

    function revalidate() {
      var current = resolve(source);
      if (!current) throw new Error("This Knowledge binding is no longer valid for the current session.");
      if (current.isClay !== initial.isClay || current.own.scopeId !== initial.own.scopeId || current.databaseService !== initial.databaseService) {
        throw new Error("This Knowledge binding is no longer valid for the current session.");
      }
      return current;
    }

    return initial.isClay ? createClayBound(revalidate, initial) : createMateBound(revalidate, initial);
  }

  // An ordinary Mate's own scope, and nothing else. There is no argument on
  // any tool that could widen it.
  function createMateBound(revalidate, initial) {
    function ownScope() {
      return [revalidate().own];
    }
    function db(method, args) {
      var current = revalidate(); if (!current.databaseService || typeof current.databaseService[method] !== "function") throw new Error("Knowledge databases are unavailable for this Mate.");
      return current.databaseService[method](Object.assign({}, args || {}, { actor: current.actor }));
    }
    return {
      isClay: false,
      mateId: initial.own.mateId,
      scopeId: initial.own.scopeId,
      listKnowledge: function (args) { return listFor(ownScope(), args || {}, false); },
      searchKnowledge: function (args) { return searchFor(ownScope(), args || {}, false); },
      readKnowledge: function (args) { return readFor(ownScope(), args || {}, false); },
      listDatabases: function (args) { return db("list", args); },
      createDatabase: function (args) { return db("create", args); },
      readDatabase: function (args) { return db("read", args); },
      renameDatabase: function (args) { return db("rename", args); },
      archiveDatabase: function (args) { return db("archive", args); },
      recoverDatabase: function (args) { return db("recover", args); },
      updateDatabaseSchema: function (args) { return db("updateSchema", args); },
      saveTableView: function (args) { return db("saveView", args); },
      queryDatabase: function (args) { return db("query", args); },
      createDatabaseRecord: function (args) { return db("createRecord", args); },
      readDatabaseRecord: function (args) { return db("readRecord", args); },
      updateDatabaseRecord: function (args) { return db("updateRecord", args); },
      archiveDatabaseRecord: function (args) { return db("archiveRecord", args); },
      recoverDatabaseRecord: function (args) { return db("recoverRecord", args); },
      retryDatabaseSync: function (args) { return db("retryProjection", args); },
    };
  }

  // Every Mate belonging to the same user, resolved fresh on each call so a
  // newly created or deleted Mate is reflected without a rebind. Never spans
  // users: the Mate list is derived from the bound owner id alone.
  function createClayBound(revalidate, initial) {
    function authorizedMates(mateId) {
      var current = revalidate();
      var ownerId = current.ownerId;
      var own = current.own;
      var out = [];
      var listed = listMates(ownerId) || [];
      for (var i = 0; i < listed.length; i++) {
        var entry = listed[i];
        if (!entry || !entry.id || !entry.dir) continue;
        if (isMultiUser() && ownerId && entry.createdBy && entry.createdBy !== ownerId) continue;
        var scope = scopeForMate(entry.dir, entry.id, entry.name || null);
        if (!scope) continue;
        out.push(scope);
      }
      if (out.length === 0) out.push(own);
      if (!mateId) return out;
      var wanted = String(mateId);
      var filtered = out.filter(function (scope) { return scope.mateId === wanted; });
      if (filtered.length === 0) throw new Error("Mate not found for the current user.");
      return filtered;
    }
    return {
      isClay: true,
      mateId: initial.own.mateId,
      scopeId: initial.own.scopeId,
      listMateKnowledge: function (args) {
        return listFor(authorizedMates(args && args.mateId), args || {}, true);
      },
      searchMateKnowledge: function (args) {
        return searchFor(authorizedMates(args && args.mateId), args || {}, true);
      },
      readMateKnowledge: function (args) {
        return readFor(authorizedMates(null), args || {}, true);
      },
    };
  }

  return { bind: bind };
}

module.exports = {
  MAX_PAGE: MAX_PAGE,
  MAX_READ_CHARS: MAX_READ_CHARS,
  DEFAULT_READ_CHARS: DEFAULT_READ_CHARS,
  REF_PATTERN: REF_PATTERN,
  NAME_WEIGHT: NAME_WEIGHT,
  BODY_WEIGHT: BODY_WEIGHT,
  attachMateKnowledgeService: attachMateKnowledgeService,
};
