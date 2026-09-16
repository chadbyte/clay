// Append-only Issue records, stored beside but separately from Project Logs.

var crypto = require("crypto");
var recordStore = require("./knowledge-record-store");
var schema = require("./issues-schema");
var issueComments = require("./issues-comments");

var REF = /^issue:[A-Za-z0-9_-]{24}$/;
var MAX_PAGE = 50;

function issueScopeIdForKnowledgeId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new Error("Invalid project knowledge id.");
  return "project/" + id + "/issues";
}

function createIssuesStore(options) {
  var opts = options || {};
  var knowledgeId = opts.projectKnowledgeId;
  var scopeId = issueScopeIdForKnowledgeId(knowledgeId);
  var records = recordStore.createRecordStore({ scopeId: scopeId, baseDir: opts.baseDir });

  function ref() {
    return "issue:" + crypto.randomBytes(18).toString("base64url").substring(0, 24);
  }
  function chainFor(id) {
    var all = records.all();
    var out = [];
    for (var i = 0; i < all.length; i++) if (all[i].rootId === id) out.push(all[i]);
    return out;
  }
  function snapshotFor(chain, revision) {
    var current = null;
    for (var i = 0; i < chain.length; i++) {
      if ((chain[i].op === "revision" || chain[i].op === "incorporate") && (!revision || chain[i].revision <= revision)) current = chain[i].snapshot;
    }
    return current ? schema.clone(current) : null;
  }
  function project(id, includeBody, includeDeleted) {
    var chain = chainFor(id);
    var revisions = chain.filter(function (record) { return record.op === "revision" || record.op === "incorporate"; });
    if (!revisions.length) return null;
    var latest = revisions[revisions.length - 1];
    var current = schema.clone(latest.snapshot);
    var deleted = chain.some(function (record) { return record.op === "delete"; });
    if (deleted && !includeDeleted) return null;
    var result = {
      ref: id, revision: latest.revision, title: current.title, summary: current.summary,
      resolutionSummary: current.resolutionSummary || "",
      type: current.type, priority: current.priority, status: current.status,
      createdAt: revisions[0].at, updatedAt: latest.at, createdBy: revisions[0].author,
      updatedBy: latest.author, context: current.context, linkedWorkSessions: current.linkedWorkSessions,
      resolutionHistory: current.resolutionHistory,
      comments: issueComments.comments(chain), deleted: deleted,
    };
    if (deleted) { var tombstone = chain.filter(function (record) { return record.op === "delete"; }).pop(); result.deletedAt = tombstone.at; result.deletedBy = tombstone.author; }
    if (current.verifiedCommit) result.verifiedCommit = current.verifiedCommit;
    if (current.closeReason) result.closeReason = current.closeReason;
    if (includeBody) result.body = current.body;
    return result;
  }
  function append(id, operation, snapshot, revision, author) {
    records.append({ id: recordStore.newRecordId(), rootId: id, op: operation, scope: scopeId,
      revision: revision, snapshot: schema.clone(snapshot), author: schema.clone(author), at: Date.now() });
  }
  function create(data, author, context, verifiedCommit) {
    var id = ref();
    var input = Object.assign({}, data || {});
    input.status = input.status === undefined ? "open" : input.status;
    input.context = schema.normalizeContext(context);
    if (input.status === "resolved") {
      if (!verifiedCommit) throw new Error("resolved issues require verified commit evidence.");
      if (typeof input.resolutionSummary !== "string" || !input.resolutionSummary.trim()) throw new Error("resolutionSummary is required when resolving an issue.");
      input.verifiedCommit = verifiedCommit;
    }
    var snap = schema.snapshot(input);
    if (snap.status === "resolved") {
      snap.resolutionHistory = [{ status: "resolved", resolutionSummary: snap.resolutionSummary, verifiedCommit: snap.verifiedCommit, at: Date.now() }];
    }
    append(id, "revision", snap, 1, author);
    return project(id, true);
  }
  function update(id, data, expectedRevision, author, context, verifiedCommit) {
    var current = project(id, true);
    if (!current) throw new Error("Issue not found.");
    if (expectedRevision !== current.revision) throw new Error("Issue revision conflict.");
    var input = Object.assign({}, data || {});
    input.context = schema.clone(current.context || null);
    if (input.status === "resolved") {
      if (!verifiedCommit) throw new Error("resolved issues require verified commit evidence.");
      input.verifiedCommit = verifiedCommit;
    }
    if (input.status === "open" || input.status === "in_progress") {
      input.resolutionHistory = current.resolutionHistory || [];
      delete input.verifiedCommit;
      delete input.resolutionSummary;
    }
    var snap = schema.snapshot(input, current);
    if (input.status === "resolved") {
      snap.resolutionHistory = (current.resolutionHistory || []).concat([{ status: "resolved", resolutionSummary: snap.resolutionSummary, verifiedCommit: snap.verifiedCommit, at: Date.now() }]);
    }
    append(id, "revision", snap, current.revision + 1, author);
    return project(id, true);
  }
  function comment(id, body, author) {
    var located = { rootId: id, chain: chainFor(id) };
    if (!project(id, false)) throw new Error("Issue not found.");
    var value = schema.text(body, "comment", 4000, true);
    var current = project(id, true);
    if ((current.comments || []).length >= 200) throw new Error("This issue already has the maximum of 200 comments.");
    records.append({ id: recordStore.newRecordId(), rootId: located.rootId, op: "comment", scope: scopeId,
      body: value, author: schema.clone(author), at: Date.now() });
    return project(id, true);
  }
  function review(id, commentId, action, response, author, revision) {
    var current = project(id, true);
    if (!current) throw new Error("Issue not found.");
    if (issueComments.ACTIONS.indexOf(action) === -1) throw new Error("Invalid issue comment action.");
    var exists = (current.comments || []).some(function (item) { return item.id === commentId && item.status === issueComments.STATUS_PENDING; });
    if (!exists) throw new Error("Issue comment is no longer awaiting review.");
    records.append({ id: recordStore.newRecordId(), rootId: id, op: "review", scope: scopeId,
      commentId: commentId, action: action, response: schema.text(response || "", "response", 4000, action !== "incorporate"), revision: revision || null,
      author: schema.clone(author), at: Date.now() });
    return project(id, true);
  }
  function incorporate(id, commentId, data, expectedRevision, response, author) {
    var current = project(id, true);
    if (!current) throw new Error("Issue not found.");
    if (current.revision !== expectedRevision) throw new Error("Issue revision conflict.");
    if (issueComments.ACTIONS.indexOf("incorporate") === -1) throw new Error("Invalid issue comment action.");
    if (!(current.comments || []).some(function (item) { return item.id === commentId && item.status === issueComments.STATUS_PENDING; })) throw new Error("Issue comment is no longer awaiting review.");
    var input = Object.assign({}, data || {}); input.context = schema.clone(current.context || null);
    var reviewResponse = schema.text(response || "", "response", 4000, false);
    var snapshot = schema.snapshot(input, current);
    var unchanged = snapshotFor(chainFor(id), current.revision);
    if (JSON.stringify(snapshot) === JSON.stringify(unchanged)) throw new Error("Issue incorporation must change the canonical Issue.");
    records.append({ id: recordStore.newRecordId(), rootId: id, op: "revision", scope: scopeId, snapshot: schema.clone(snapshot),
      review: { commentId: commentId, action: "incorporate", response: reviewResponse, revision: current.revision + 1 }, revision: current.revision + 1,
      author: schema.clone(author), at: Date.now() });
    return project(id, true);
  }
  function remove(id, author, expectedRevision) {
    var current = project(id, false);
    if (!current) throw new Error("Issue not found.");
    if (!Number.isInteger(expectedRevision)) throw new Error("expectedRevision is required.");
    if (current.revision !== expectedRevision) throw new Error("Issue revision conflict.");
    records.append({ id: recordStore.newRecordId(), rootId: id, op: "delete", scope: scopeId, author: schema.clone(author), at: Date.now() });
    return project(id, true, true);
  }
  function visible(options) {
    var opts2 = options || {};
    if (opts2.type !== undefined && schema.TYPES.indexOf(opts2.type) === -1) throw new Error("Invalid issue type filter.");
    if (opts2.status !== undefined && schema.STATUSES.indexOf(opts2.status) === -1) throw new Error("Invalid issue status filter.");
    if (opts2.priority !== undefined && schema.PRIORITIES.indexOf(opts2.priority) === -1) throw new Error("Invalid issue priority filter.");
    var all = records.all();
    var ids = {}; var order = [];
    for (var i = 0; i < all.length; i++) if ((all[i].op === "revision" || all[i].op === "incorporate") && !ids[all[i].rootId]) { ids[all[i].rootId] = true; order.push(all[i].rootId); }
    var out = [];
    for (var j = 0; j < order.length; j++) {
      var item = project(order[j], false);
      if (!item) continue;
      if (opts2.type && item.type !== opts2.type) continue;
      if (opts2.priority && item.priority !== opts2.priority) continue;
      if (opts2.status && item.status !== opts2.status) continue;
      if (opts2.changeSetId && (!item.context || item.context.changeSetId !== opts2.changeSetId)) continue;
      if (opts2.query) {
        var full = project(order[j], true);
        if ((full.title + " " + full.summary + " " + full.body).toLowerCase().indexOf(String(opts2.query).toLowerCase()) === -1) continue;
      }
      out.push(item);
    }
    out.sort(function (a, b) { return b.updatedAt - a.updatedAt || a.ref.localeCompare(b.ref); });
    var limit = Number(opts2.limit);
    if (!Number.isInteger(limit)) limit = 20;
    if (limit < 1 || limit > MAX_PAGE) throw new Error("Issue page limit must be between 1 and 50.");
    var offset = opts2.cursor === undefined || opts2.cursor === null || opts2.cursor === "" ? 0 : Number(opts2.cursor);
    if (!Number.isInteger(offset) || offset < 0) throw new Error("Invalid issue page cursor.");
    return { issues: out.slice(offset, offset + limit), total: out.length, nextCursor: offset + limit < out.length ? String(offset + limit) : null };
  }
  function read(id, includeDeleted) { if (!REF.test(id)) throw new Error("Invalid issue reference."); var result = project(id, true, includeDeleted === true); if (!result) throw new Error("Issue not found."); return result; }
  function history(id) {
    var chain = chainFor(id); if (!chain.length) throw new Error("Issue not found.");
    var previous = null;
    var revisions = chain.filter(function (r) { return r.op === "revision" || r.op === "incorporate"; }).map(function (r) {
      var keys = {};
      Object.keys(previous || {}).concat(Object.keys(r.snapshot || {})).forEach(function (key) { keys[key] = true; });
      var changed = Object.keys(keys).filter(function (key) {
        return JSON.stringify(previous && previous[key]) !== JSON.stringify(r.snapshot && r.snapshot[key]);
      });
      previous = r.snapshot;
      var item = { revision: r.revision, at: r.at, author: schema.clone(r.author), status: r.snapshot.status, changed: changed };
      if (r.review) item.review = schema.clone(r.review);
      return item;
    });
    var deleted = chain.filter(function (r) { return r.op === "delete"; }).pop();
    if (deleted) revisions.push({ revision: revisions.length + 1, op: "delete", at: deleted.at, author: schema.clone(deleted.author), changed: [] });
    return { ref: id, revisions: revisions, deleted: !!deleted };
  }
  function readRevision(id, revision) {
    if (!REF.test(id)) throw new Error("Invalid issue reference.");
    var chain = chainFor(id); var target = Number(revision); var found = null;
    for (var i = 0; i < chain.length; i++) if ((chain[i].op === "revision" || chain[i].op === "incorporate") && chain[i].revision === target) found = chain[i];
    if (!found) throw new Error("Issue revision not found.");
    var result = schema.clone(found.snapshot); result.ref = id; result.revision = target; result.author = schema.clone(found.author); result.at = found.at;
    if (found.review) result.review = schema.clone(found.review);
    return result;
  }
  return { scopeId: scopeId, filePath: records.filePath, create: create, update: update, comment: comment, review: review, incorporate: incorporate, remove: remove, list: visible, search: visible, read: read, history: history, readRevision: readRevision, records: records };
}

module.exports = { issueScopeIdForKnowledgeId: issueScopeIdForKnowledgeId, createIssuesStore: createIssuesStore, REF: REF };
