// Query, ranking, and pagination for Project Logs.
//
// Extracted from project-logs-store.js so the store stays focused on records
// and stays inside the module size limit. Ranking uses the shared BM25 adapter,
// which wraps Clay's single ranking engine; the response shapes, filters,
// pagination, and tie-breaks are exactly what the store returned before.

var knowledgeSearch = require("./knowledge-search");

var MAX_PAGE = 50;
var DEFAULT_PAGE = 20;
var MAX_SNIPPET_CHARS = 320;

// Title and tags outrank body text, expressed as repetition for BM25.
var TITLE_WEIGHT = 3;
// A summary is a human-written distillation of the whole record, so it ranks
// between the title and the raw body.
var SUMMARY_WEIGHT = 2;
var TAG_WEIGHT = 2;
var BODY_WEIGHT = 1;

// Locale-independent lexical order over UTF-16 code units.
//
// An opaque ref is base64url, so it contains both "-" (0x2D) and "_" (0x5F).
// String.prototype.localeCompare applies collation rules that order those two
// the other way round from code-unit order, and the result varies by ICU data,
// so it cannot be the basis of a documented deterministic tie-break. This
// matches the default Array.prototype.sort ordering exactly.
function compareRefs(a, b) {
  var left = String(a);
  var right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

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

function contextMode(options) {
  var value = options && options.contextMode;
  return value === "all" || value === "current" || value === "project" ? value : "all";
}

function matchesContext(entry, options) {
  var mode = contextMode(options);
  var changeSetId = entry && entry.context && entry.context.changeSetId;
  if (options && options.exactChangeSet === true) {
    return !!changeSetId && changeSetId === options.currentChangeSetId;
  }
  if (mode === "all") return true;
  if (mode === "project") return !changeSetId;
  return !changeSetId || changeSetId === options.currentChangeSetId;
}

function listEntries(entries, args, cleanLine, validateKind) {
  var options = args || {};
  var kind = options.kind ? validateKind(options.kind, null) : null;
  var tag = options.tag ? cleanLine(String(options.tag), 40).toLowerCase() : null;
  var priority = options.priority ? String(options.priority) : null;
  var filtered = entries.filter(function (entry) {
    // Exact match on the project's own vocabulary. A well-formed category this
    // project has never used simply matches nothing.
    if (kind && entry.category !== kind) return false;
    if (priority && entry.priority !== priority) return false;
    if (tag && entry.tags.indexOf(tag) === -1) return false;
    if (!matchesContext(entry, options)) return false;
    return true;
  });
  var result = page(filtered, options);
  return {
    entries: result.items.map(summarize),
    nextCursor: result.nextCursor,
    total: result.total,
  };
}

function projectEntry(entry) {
  return {
    id: entry.ref,
    fields: [
      { text: entry.title, weight: TITLE_WEIGHT },
      { text: entry.summary || "", weight: SUMMARY_WEIGHT },
      { text: (entry.tags || []).join(" "), weight: TAG_WEIGHT },
      { text: entry.body, weight: BODY_WEIGHT },
    ],
    meta: entry,
  };
}

// The ledger row. Everything needed to understand an entry at a glance, and
// never the body: a list must not dump record contents.
function summarize(entry) {
  return {
    ref: entry.ref,
    kind: entry.kind,
    category: entry.category,
    priority: entry.priority,
    title: entry.title,
    summary: entry.summary || "",
    tags: entry.tags,
    createdAt: entry.createdAt,
    createdBy: entry.createdBy,
    updatedAt: entry.updatedAt,
    updatedBy: entry.updatedBy,
    revisions: entry.revisions,
    commentCount: entry.commentCount || 0,
    // How many comments still await Driver review. A count only: the ledger
    // never carries comment bodies.
    pendingFeedbackCount: entry.pendingFeedbackCount || 0,
    context: entry.context || null,
  };
}

function searchEntries(entries, args, cleanLine, validateKind) {
  var options = args || {};
  var query = cleanLine(options.query || "", 200);
  if (!query) throw new Error("A search query is required.");
  var kind = options.kind ? validateKind(options.kind, null) : null;
  var priority = options.priority ? String(options.priority) : null;
  var candidates = entries.filter(function (entry) {
    if (kind && entry.category !== kind) return false;
    if (priority && entry.priority !== priority) return false;
    if (!matchesContext(entry, options)) return false;
    return true;
  });

  var ranked = knowledgeSearch.rank(candidates, query, projectEntry, candidates.length);
  var hits = [];
  for (var i = 0; i < ranked.length; i++) {
    var entry = ranked[i].meta;
    var hit = summarize(entry);
    hit.score = ranked[i].score;
    hit.snippet = cleanLine(knowledgeSearch.snippet(entry.body, query, MAX_SNIPPET_CHARS), MAX_SNIPPET_CHARS);
    hits.push(hit);
  }
  // Deterministic ordering: score, then most recent, then a stable ref.
  hits.sort(function (a, b) {
    return b.score - a.score || b.updatedAt - a.updatedAt || compareRefs(a.ref, b.ref);
  });
  var result = page(hits, options);
  return { results: result.items, nextCursor: result.nextCursor, total: result.total };
}

module.exports = {
  compareRefs: compareRefs,
  MAX_PAGE: MAX_PAGE,
  DEFAULT_PAGE: DEFAULT_PAGE,
  MAX_SNIPPET_CHARS: MAX_SNIPPET_CHARS,
  TITLE_WEIGHT: TITLE_WEIGHT,
  SUMMARY_WEIGHT: SUMMARY_WEIGHT,
  TAG_WEIGHT: TAG_WEIGHT,
  BODY_WEIGHT: BODY_WEIGHT,
  parseLimit: parseLimit,
  encodeCursor: encodeCursor,
  decodeCursor: decodeCursor,
  page: page,
  contextMode: contextMode,
  matchesContext: matchesContext,
  summarize: summarize,
  listEntries: listEntries,
  searchEntries: searchEntries,
};
