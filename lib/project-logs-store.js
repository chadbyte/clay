// Project Logs projection over the Clay-wide knowledge record backend.

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var recordStore = require("./knowledge-record-store");
var logsQuery = require("./project-logs-query");
var logsSchema = require("./project-logs-schema");
var logsSnapshot = require("./project-logs-snapshot");
var logsComments = require("./project-logs-comments");
var logsVersioning = require("./project-logs-versioning");
var logsRoot = require("./project-logs-root");
var logContext = require("./project-log-context");
var contextState = require("./project-logs-context-state");

var MAX_SUMMARY_CHARS = logsSchema.MAX_SUMMARY_CHARS;
var MAX_COMMENT_CHARS = 4000;
var MAX_COMMENTS = 200;
var MAX_FEEDBACK_ITEMS = 25;
var MAX_FEEDBACK_BODY_CHARS = 600;
var MAX_TITLE_CHARS = 200;
var MAX_BODY_CHARS = 20000;
var MAX_TAGS = 12;
var MAX_TAG_CHARS = 40;
var MAX_LINKS = 20;
var MAX_LINK_CHARS = 200;
var MAX_PAGE = logsQuery.MAX_PAGE;
var REF_PATTERN = /^log:[A-Za-z0-9_-]{24}$/;

var cleanText = logsSchema.cleanText;
var cleanLine = logsSchema.cleanLine;
var normalizeAuthor = logsSchema.normalizeAuthor;
var normalizeTags = logsSchema.normalizeTags;
var normalizeLinks = logsSchema.normalizeLinks;

var page = logsQuery.page;

// Filters accept any well-formed category. An unknown but valid one matches
// nothing, which is a real answer. A supplied malformed one is an error:
// silently dropping it would widen the result set to everything the caller is
// authorized to see, which is the opposite of failing closed, and it would give
// an agent no signal that its filter was wrong.
function validateKind(kind, fallback) {
  if (kind === undefined || kind === null || kind === "") return fallback || null;
  return logsSchema.normalizeCategory(kind);
}


function createProjectLogsStore(opts) {
  var options = opts || {};
  var root = options.root ? path.resolve(options.root) : logsRoot.resolveProjectRoot(options.cwd, options.runGit);
  var scopeId = options.projectKnowledgeId
    ? logsRoot.scopeIdForKnowledgeId(options.projectKnowledgeId)
    : logsRoot.scopeIdForRoot(root);
  var store = recordStore.createRecordStore({ scopeId: scopeId, baseDir: options.baseDir });
  var contexts = contextState.attachContextState(store, scopeId);

  function refFor(rootId) {
    var digest = crypto.createHash("sha256").update(scopeId + "\u0000" + String(rootId)).digest("base64url");
    return "log:" + digest.substring(0, 24);
  }

  function chains() {
    var records = store.all();
    var byRoot = new Map();
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      var rootId = record.rootId || record.id;
      if (!byRoot.has(rootId)) byRoot.set(rootId, []);
      byRoot.get(rootId).push(record);
    }
    return byRoot;
  }

  function fold(rootId, chain, knownContextStates) {
    var history = logsSnapshot.revisions(chain, MAX_LINKS);
    if (!history.started || history.revisions.length === 0) return null;
    var last = history.revisions[history.revisions.length - 1];
    var first = history.revisions[0];
    var originRecord = null;
    for (var ci = 0; ci < chain.length; ci++) {
      if (chain[ci].id === first.sourceRecordId) { originRecord = chain[ci]; break; }
    }

    if (!logsSchema.safeCategory(first.snapshot.category)) return null;
    if (!first.snapshot.title || !first.snapshot.title.trim()) return null;

    var revisionForRecordId = {};
    for (var v = 0; v < history.revisions.length; v++) {
      var source = history.revisions[v].sourceRecordId;
      if (source) revisionForRecordId[source] = history.revisions[v].revision;
    }

    var thread = logsComments.comments(chain, {
      maxComments: MAX_COMMENTS,
      revisionForRecordId: revisionForRecordId,
    });

    var entry = {
      ref: refFor(rootId),
      kind: last.snapshot.category,
      category: last.snapshot.category,
      priority: last.snapshot.priority,
      title: last.snapshot.title,
      summary: last.snapshot.summary,
      body: last.snapshot.body,
      tags: last.snapshot.tags.slice(),
      links: last.snapshot.links.slice(),
      comments: thread,
      createdAt: first.at,
      createdBy: first.author,
      updatedAt: last.at,
      updatedBy: last.author,
      revisions: history.revisions.length,
      deleted: !!history.deleted,
      deletedAt: history.deleted ? history.deleted.at : null,
      deletedBy: history.deleted ? history.deleted.author : null,
      context: logContext.normalizeRecordContext(originRecord && originRecord.context),
    };
    if (entry.context.changeSetId) {
      var states = knownContextStates || contexts.states();
      entry.context.status = states[entry.context.changeSetId] || entry.context.status;
    }
    // Entries written before summaries existed get a deterministic one derived
    // from their own body. Nothing on disk is rewritten.
    entry.summary = logsSchema.fallbackSummary(entry);
    entry.commentCount = thread.length;
    entry.pendingFeedbackCount = logsComments.pendingReviewCount(thread);
    // Bounded revision metadata, never bodies, so the detail view can show a
    // history timeline without a second round trip.
    entry.history = history.revisions.map(logsSnapshot.describeRevision);
    return entry;
  }

  function entries(includeDeleted) {
    var out = [];
    var states = contexts.states();
    chains().forEach(function (chain, rootId) {
      var entry = fold(rootId, chain, states);
      if (!entry) return;
      if (entry.deleted && !includeDeleted) return;
      out.push(entry);
    });
    // Latest canonical update first, ref as a deterministic tie-break. Only a
    // revision moves updatedAt, so comments and clarify/decline never promote.
    out.sort(function (a, b) { return b.updatedAt - a.updatedAt || logsQuery.compareRefs(a.ref, b.ref); });
    return out;
  }

  function findChain(ref) {
    if (typeof ref !== "string" || !REF_PATTERN.test(ref)) return null;
    var found = null;
    chains().forEach(function (chain, rootId) {
      if (found) return;
      if (refFor(rootId) === ref) found = { rootId: rootId, chain: chain };
    });
    return found;
  }

  function read(ref, includeDeleted) {
    var located = findChain(ref);
    if (!located) return null;
    var entry = fold(located.rootId, located.chain);
    if (!entry) return null;
    if (entry.deleted && !includeDeleted) return null;
    return entry;
  }

  function requireLive(ref) {
    var located = findChain(ref);
    if (!located) throw new Error("Log entry not found.");
    var entry = fold(located.rootId, located.chain);
    if (!entry || entry.deleted) throw new Error("Log entry not found.");
    return located;
  }

  function create(input, author, context) {
    var data = input || {};
    var validated = logsSchema.validateNewRecord(data);
    var title = cleanLine(data.title || "", MAX_TITLE_CHARS);
    if (!title) throw new Error("A log title is required.");
    var summary = cleanLine(data.summary || "", MAX_SUMMARY_CHARS);
    if (!summary) throw new Error("A one or two sentence summary is required so the entry is understandable from a list.");
    var id = recordStore.newRecordId();
    var snapshot = logsSnapshot.cloneSnapshot({
      category: validated.category,
      priority: validated.priority,
      title: title,
      summary: summary,
      body: cleanText(data.body || "", MAX_BODY_CHARS),
      tags: normalizeTags(data.tags),
      links: normalizeLinks(data.links),
    });
    store.append({
      id: id,
      rootId: id,
      op: "create",
      scope: scopeId,
      // Legacy field names are kept so an older build still reads this record.
      kind: snapshot.category,
      priority: snapshot.priority,
      title: snapshot.title,
      summary: snapshot.summary,
      body: snapshot.body,
      tags: snapshot.tags,
      links: snapshot.links,
      snapshot: snapshot,
      author: normalizeAuthor(author),
      context: logContext.normalizeRecordContext(context),
      at: Date.now(),
    });
    return read(refFor(id), false);
  }

  // Build the complete snapshot a revision will store, from the current state
  // plus the requested changes. Every new canonical edit is self-contained.
  function nextSnapshot(current, validated, data) {
    var snapshot = logsSnapshot.cloneSnapshot(current);
    if (validated.category !== undefined) snapshot.category = validated.category;
    if (validated.priority !== undefined) snapshot.priority = validated.priority;
    if (validated.title !== undefined) {
      snapshot.title = cleanLine(validated.title, MAX_TITLE_CHARS);
      if (!snapshot.title) throw new Error("A log title cannot be emptied.");
    }
    if (validated.summary !== undefined) {
      snapshot.summary = cleanLine(validated.summary, MAX_SUMMARY_CHARS);
      if (!snapshot.summary) throw new Error("A log summary cannot be emptied.");
    }
    if (data.body !== undefined) snapshot.body = cleanText(data.body || "", MAX_BODY_CHARS);
    if (data.tags !== undefined) snapshot.tags = normalizeTags(data.tags);
    return snapshot;
  }

  function currentSnapshot(ref) {
    var entry = read(ref, false);
    if (!entry) throw new Error("Log entry not found.");
    return logsSnapshot.cloneSnapshot(entry);
  }

  function update(ref, changes, author, context) {
    var located = requireLive(ref);
    var data = changes || {};
    var validated = logsSchema.validateRevision(data);
    var current = currentSnapshot(ref);
    var snapshot = nextSnapshot(current, validated, data);
    if (logsSnapshot.sameSnapshot(current, snapshot)) {
      throw new Error("An update requires at least one changed field.");
    }
    appendRevision(located.rootId, "update", snapshot, author, { context: logContext.normalizeRecordContext(context) });
    return read(ref, false);
  }

  // One append per canonical revision, always carrying a complete snapshot.
  // Legacy field names ride along so an older build can still read the record.
  function appendRevision(rootId, op, snapshot, author, extra) {
    var record = {
      id: recordStore.newRecordId(),
      rootId: rootId,
      op: op,
      scope: scopeId,
      kind: snapshot.category,
      priority: snapshot.priority,
      title: snapshot.title,
      summary: snapshot.summary,
      body: snapshot.body,
      tags: snapshot.tags,
      links: snapshot.links,
      snapshot: snapshot,
      author: normalizeAuthor(author),
      at: Date.now(),
    };
    var keys = Object.keys(extra || {});
    for (var i = 0; i < keys.length; i++) record[keys[i]] = extra[keys[i]];
    store.append(record);
    return record;
  }

  // Human participation. Append-only for this slice: no edit, no delete, and
  // never a canonical revision. The author is supplied by the authorization
  // layer, never by the caller's payload.
  function comment(ref, input, author, context) {
    var located = requireLive(ref);
    var data = input || {};
    var body = cleanText(data.body || "", MAX_COMMENT_CHARS);
    if (!body) throw new Error("A comment body is required.");
    var existing = read(ref, false);
    if (existing && existing.comments.length >= MAX_COMMENTS) {
      throw new Error("This entry already has the maximum of " + MAX_COMMENTS + " comments.");
    }
    store.append({
      id: recordStore.newRecordId(),
      rootId: located.rootId,
      op: "comment",
      scope: scopeId,
      body: body,
      author: normalizeAuthor(author),
      context: logContext.normalizeRecordContext(context),
      at: Date.now(),
    });
    return read(ref, false);
  }

  function link(ref, links, author, context) {
    var located = requireLive(ref);
    var normalized = normalizeLinks(links);
    if (normalized.length === 0) throw new Error("At least one link reference is required.");
    var current = currentSnapshot(ref);
    var snapshot = logsSnapshot.cloneSnapshot(current);
    for (var i = 0; i < normalized.length && snapshot.links.length < MAX_LINKS; i++) {
      var exists = false;
      for (var j = 0; j < snapshot.links.length; j++) {
        if (snapshot.links[j].ref === normalized[i].ref) { exists = true; break; }
      }
      if (!exists) snapshot.links.push(normalized[i]);
    }
    if (logsSnapshot.sameSnapshot(current, snapshot)) {
      throw new Error("Those links are already attached to this entry.");
    }
    appendRevision(located.rootId, "link", snapshot, author, { context: logContext.normalizeRecordContext(context) });
    return read(ref, false);
  }

  function remove(ref, author, context) {
    var located = requireLive(ref);
    store.append({
      id: recordStore.newRecordId(),
      rootId: located.rootId,
      op: "delete",
      scope: scopeId,
      author: normalizeAuthor(author),
      context: logContext.normalizeRecordContext(context),
      at: Date.now(),
    });
    return read(ref, true);
  }

  // Filtering, ranking, and pagination live in project-logs-query.js so this
  // module stays focused on records. Ranking is the shared BM25 engine.
  // The project's category vocabulary, derived from its own live non-deleted
  // entries. A category that only exists on deleted entries disappears; a
  // revision that changes category updates the vocabulary without rewriting a
  // single historical record. A shared project shares this list because it
  // shares this store.
  function categories(options) {
    var seen = {};
    var out = [];
    var live = entries(false);
    for (var i = 0; i < live.length; i++) {
      if (!logsQuery.matchesContext(live[i], options || {})) continue;
      var value = live[i].category;
      if (!value || seen[value]) continue;
      seen[value] = true;
      out.push(value);
    }
    out.sort();
    return out;
  }

  var versioning = logsVersioning.attachVersioning({
    read: read,
    requireLive: requireLive,
    findChain: findChain,
    appendRevision: appendRevision,
    nextSnapshot: nextSnapshot,
    cleanText: cleanText,
    maxLinks: MAX_LINKS,
    maxResponseChars: MAX_COMMENT_CHARS,
    scopeId: scopeId,
    store: store,
    normalizeAuthor: normalizeAuthor,
  });

  // Every comment still awaiting Driver review, across every live entry, in
  // one pass over the projection. The exact total is always reported; only the
  // returned summaries are clamped, so a pending comment on an old entry can
  // never be invisible.
  function feedback(args) {
    var options2 = args || {};
    var limit = Number(options2.limit);
    if (!Number.isFinite(limit)) limit = MAX_FEEDBACK_ITEMS;
    limit = Math.max(1, Math.min(MAX_FEEDBACK_ITEMS, Math.floor(limit)));
    var live = entries(false);
    var out = [];
    var total = 0;
    for (var i = 0; i < live.length; i++) {
      if (!logsQuery.matchesContext(live[i], options2)) continue;
      var awaiting = logsComments.pendingReviewComments(live[i].comments);
      for (var j = 0; j < awaiting.length; j++) {
        total++;
        if (out.length >= limit) continue;
        var body = awaiting[j].body || "";
        out.push({
          ref: live[i].ref,
          title: live[i].title,
          category: live[i].category,
          priority: live[i].priority,
          commentId: awaiting[j].id,
          status: awaiting[j].status,
          author: awaiting[j].author,
          at: awaiting[j].at,
          body: body.length > MAX_FEEDBACK_BODY_CHARS
            ? body.substring(0, MAX_FEEDBACK_BODY_CHARS) + "..."
            : body,
        });
      }
    }
    return { feedback: out, total: total, truncated: total > out.length };
  }

  function list(args) {
    var options2 = args || {};
    var result = logsQuery.listEntries(entries(options2.includeDeleted === true), options2, cleanLine, validateKind);
    result.categories = categories(options2);
    return result;
  }

  function search(args) {
    var result = logsQuery.searchEntries(entries(false), args || {}, cleanLine, validateKind);
    result.categories = categories(args || {});
    return result;
  }

  // The blame view: every canonical revision in causal order with its author
  // and the fields it changed, reconstructed from the append-only chain.
  // Metadata only: no bodies, so history never dumps the record.
  function history(ref, args) {
    var located = findChain(ref);
    if (!located) throw new Error("Log entry not found.");
    var reconstructed = logsSnapshot.revisions(located.chain, MAX_LINKS);
    var revisions = reconstructed.revisions.map(logsSnapshot.describeRevision);
    if (reconstructed.deleted) {
      revisions.push({
        revision: revisions.length + 1,
        op: "delete",
        at: reconstructed.deleted.at,
        author: reconstructed.deleted.author,
        changed: [],
        revertedFrom: null,
        reason: null,
        commentId: null,
        reconstructed: false,
      });
    }
    var result = page(revisions, args || {});
    return { ref: ref, revisions: result.items, nextCursor: result.nextCursor, total: result.total };
  }

  function stats() {
    var base = store.stats();
    return {
      root: root,
      scopeId: scopeId,
      filePath: base.filePath,
      records: base.records,
      skippedRecords: base.skipped,
      entries: entries(false).length,
    };
  }

  return {
    root: root,
    scopeId: scopeId,
    filePath: store.filePath,
    categories: categories,
    feedback: feedback,
    create: create,
    update: update,
    comment: comment,
    review: versioning.review,
    revert: versioning.revert,
    readRevision: versioning.readRevision,
    link: link,
    remove: remove,
    setContextState: contexts.set,
    read: read,
    list: list,
    search: search,
    history: history,
    stats: stats,
  };
}

module.exports = {
  SEED_CATEGORIES: logsSchema.SEED_CATEGORIES,
  MAX_CATEGORY_CHARS: logsSchema.MAX_CATEGORY_CHARS,
  PRIORITIES: logsSchema.PRIORITIES,
  MAX_SUMMARY_CHARS: MAX_SUMMARY_CHARS,
  MAX_COMMENT_CHARS: MAX_COMMENT_CHARS,
  MAX_COMMENTS: MAX_COMMENTS,
  MAX_TITLE_CHARS: MAX_TITLE_CHARS,
  MAX_BODY_CHARS: MAX_BODY_CHARS,
  MAX_PAGE: MAX_PAGE,
  REF_PATTERN: REF_PATTERN,
  resolveProjectRoot: logsRoot.resolveProjectRoot,
  scopeIdForRoot: logsRoot.scopeIdForRoot,
  createProjectLogsStore: createProjectLogsStore,
};
