// Server-owned Scheduled Tasks results inside the Project Logs record stream.
// This capability is never exposed through the human or agent write surfaces.

var crypto = require("crypto");
var recordStore = require("./knowledge-record-store");
var logsSchema = require("./project-logs-schema");
var logsSnapshot = require("./project-logs-snapshot");

var ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
var OUTCOMES = ["completed", "failed", "needs-input", "interrupted", "skipped-busy"];

function clean(value, max) {
  return logsSchema.cleanLine(typeof value === "string" ? value : "", max);
}

function normalizeMetadata(value) {
  var source = value || {};
  if (!ID_PATTERN.test(source.runId || "") || !ID_PATTERN.test(source.scheduleId || "")) return null;
  if (OUTCOMES.indexOf(source.outcome) === -1) return null;
  return {
    runId: source.runId,
    scheduleId: source.scheduleId,
    outcome: source.outcome,
    ownerId: source.ownerId ? clean(String(source.ownerId), 120) : null,
    driverOriginId: clean(source.driverOriginId || "", 200) || null,
    workerOriginId: clean(source.workerOriginId || "", 200) || null,
    driverProviderSessionId: clean(source.driverProviderSessionId || "", 200) || null,
    workerProviderSessionId: clean(source.workerProviderSessionId || "", 200) || null,
    startedAt: Number(source.startedAt) || null,
    finishedAt: Number(source.finishedAt) || null,
  };
}

function visibleTo(metadata, viewerId) {
  if (!metadata || viewerId === undefined) return true;
  return (metadata.ownerId || null) === (viewerId || null);
}

function outcomeLabel(outcome) {
  if (outcome === "completed") return "Completed";
  if (outcome === "needs-input") return "Needs input";
  if (outcome === "interrupted") return "Interrupted";
  if (outcome === "skipped-busy") return "Skipped";
  return "Failed";
}

function fallbackSummary(outcome) {
  if (outcome === "completed") return "The scheduled task completed successfully.";
  if (outcome === "needs-input") return "The scheduled task is waiting for user input or permission.";
  if (outcome === "interrupted") return "The scheduled task was interrupted before completion.";
  if (outcome === "skipped-busy") return "The scheduled occurrence was skipped because an earlier run was still active.";
  return "The scheduled task failed.";
}

function rootId(scopeId, runId) {
  var digest = crypto.createHash("sha256").update(scopeId + "\u0000scheduled-result\u0000" + runId).digest("base64url");
  return "sresult-" + digest.substring(0, 24);
}

function attachScheduledResultStore(ctx) {
  function resultRecord(runId) {
    var records = ctx.store.all();
    for (var i = 0; i < records.length; i++) {
      if (records[i].op === "create" && records[i].scheduledResult && records[i].scheduledResult.runId === runId) return records[i];
    }
    return null;
  }

  function create(input, context) {
    var data = input || {};
    var metadata = normalizeMetadata(data);
    if (!metadata) throw new Error("Scheduled result identity is invalid.");
    var existing = resultRecord(metadata.runId);
    if (existing) return { entry: ctx.read(ctx.refFor(existing.rootId || existing.id), false), created: false };
    var name = clean(data.name || "Scheduled task", 160) || "Scheduled task";
    var reason = clean(data.summary || data.reason || "", 400);
    var summary = reason || fallbackSummary(metadata.outcome);
    var title = name + " · " + outcomeLabel(metadata.outcome);
    var body = "## Scheduled result\n\n" + summary + "\n\n" +
      "- Outcome: " + outcomeLabel(metadata.outcome) + "\n" +
      "- Run: `" + metadata.runId + "`\n" +
      (metadata.startedAt ? "- Started: " + new Date(metadata.startedAt).toISOString() + "\n" : "") +
      (metadata.finishedAt ? "- Finished: " + new Date(metadata.finishedAt).toISOString() + "\n" : "");
    var id = rootId(ctx.scopeId, metadata.runId);
    var snapshot = logsSnapshot.cloneSnapshot({ category: "scheduled-result", priority: metadata.outcome === "failed" ? "important" : "normal", title: title, summary: summary, body: body, tags: ["scheduled-task", metadata.outcome], links: [] });
    ctx.store.append({
      id: id, rootId: id, op: "create", scope: ctx.scopeId,
      kind: snapshot.category, priority: snapshot.priority, title: snapshot.title,
      summary: snapshot.summary, body: snapshot.body, tags: snapshot.tags,
      links: snapshot.links, snapshot: snapshot,
      author: logsSchema.normalizeAuthor({ type: "system", displayName: "Scheduled Tasks" }),
      context: context || null, scheduledResult: metadata, at: metadata.finishedAt || Date.now(),
    });
    return { entry: ctx.read(ctx.refFor(id), false), created: true };
  }

  function hasRead(root, readerId) {
    var records = ctx.store.all();
    for (var i = 0; i < records.length; i++) {
      if (records[i].rootId === root && records[i].op === "scheduled-result-read" && (records[i].readerId || null) === (readerId || null)) return true;
    }
    return false;
  }

  function unread(viewerId, options) {
    var entries = ctx.entries(false, viewerId);
    var refs = [];
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].scheduledResult) continue;
      if (ctx.matchesContext && !ctx.matchesContext(entries[i], options || {})) continue;
      var located = ctx.findChain(entries[i].ref);
      if (located && !hasRead(located.rootId, viewerId)) refs.push(entries[i].ref);
    }
    return { count: refs.length, newestRef: refs.length ? refs[0] : null, refs: refs };
  }

  function markRead(ref, viewerId, options) {
    var entry = ctx.read(ref, false, viewerId);
    if (!entry || !entry.scheduledResult) throw new Error("Scheduled result not found.");
    var located = ctx.findChain(ref);
    if (!located) throw new Error("Scheduled result not found.");
    if (!hasRead(located.rootId, viewerId)) {
      ctx.store.append({ id: recordStore.newRecordId(), rootId: located.rootId, op: "scheduled-result-read", scope: ctx.scopeId, readerId: viewerId || null, at: Date.now() });
    }
    return unread(viewerId, options);
  }

  return { create: create, markRead: markRead, unread: unread };
}

module.exports = { attachScheduledResultStore: attachScheduledResultStore, normalizeMetadata: normalizeMetadata, visibleTo: visibleTo };
