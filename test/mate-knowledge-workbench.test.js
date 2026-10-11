var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var pathToFileURL = require("url").pathToFileURL;

var processHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-knowledge-test-home-"));
process.env.CLAY_HOME = processHome;

var attachKnowledge = require("../lib/project-knowledge").attachKnowledge;
var attachService = require("../lib/mate-knowledge-service").attachMateKnowledgeService;
var mateSync = require("../lib/mate-knowledge-sync");
var knowledgeMarkdown = require("../lib/knowledge-markdown");

test.after(function () { fs.rmSync(processHome, { recursive: true, force: true }); });

function fixture(t, common) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-knowledge-workbench-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var mateDir = path.join(root, "mates", "alice", "mate_test");
  var baseDir = path.join(root, "record-store");
  fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });
  var sent = [];
  var ws = { _clayUser: { id: "alice", displayName: "Alice" } };
  var commonFiles = common || [];
  var mates = {
    buildMateCtx: function () { return {}; }, isPromoted: function () { return false; },
    getCommonKnowledgeForMate: function () { return commonFiles.map(function (item) { return { name: item.name, ownMateId: item.ownMateId, common: true }; }); },
    readCommonKnowledgeFile: function (_ctx, owner, name) {
      var found = commonFiles.filter(function (item) { return item.ownMateId === owner && item.name === name; })[0];
      if (!found) throw new Error("Common file not found."); return found.content;
    },
    getMate: function () { return { name: "Test" }; }, promoteKnowledge: function () {}, depromoteKnowledge: function () {},
  };
  function attach() { return attachKnowledge({ cwd: mateDir, isMate: true, knowledgeBaseDir: baseDir,
    sendTo: function (_ws, msg) { sent.push(msg); }, matesModule: mates, getProjectOwnerId: function () { return "alice"; } }); }
  var attached = attach();
  function message(msg, actor) { sent.length = 0; attached.handleKnowledgeMessage(actor || ws, msg); return sent.slice(); }
  function restart() { attached = attach(); }
  return { root: root, baseDir: baseDir, mateDir: mateDir, ws: ws, sent: sent, message: message, restart: restart };
}

function result(messages, type) { return messages.filter(function (msg) { return msg.type === type; })[0]; }
function waitResult(fixtureValue, type) { return new Promise(function (resolve, reject) { var started = Date.now(); function check() { var found = result(fixtureValue.sent, type); if (found) { resolve(found); return; } if (Date.now() - started > 5000) { reject(new Error("Timed out waiting for " + type)); return; } setTimeout(check, 5); } check(); }); }

test("Mate Knowledge mutations are atomic, revision-guarded, owner-bound, and traversal-safe", function (t) {
  var f = fixture(t);
  var created = result(f.message({ type: "knowledge_save", requestId: "create", name: "notes.md", content: "# Notes\ninitial" }), "knowledge_saved");
  assert.ok(created.revision);
  assert.equal(fs.readFileSync(path.join(f.mateDir, "knowledge", "notes.md"), "utf8"), "# Notes\ninitial");
  assert.deepEqual(fs.readdirSync(path.join(f.mateDir, "knowledge")).filter(function (name) { return name.indexOf(".clay-knowledge-") === 0; }), []);

  var stale = result(f.message({ type: "knowledge_save", requestId: "stale", name: "notes.md", content: "lost", expectedRevision: "old" }), "knowledge_error");
  assert.equal(stale.code, "STALE");
  assert.equal(fs.readFileSync(path.join(f.mateDir, "knowledge", "notes.md"), "utf8"), "# Notes\ninitial");

  fs.unlinkSync(path.join(f.mateDir, "knowledge", "notes.md"));
  var removed = result(f.message({ type: "knowledge_save", requestId: "removed", name: "notes.md", content: "resurrected", expectedRevision: created.revision }), "knowledge_error");
  assert.equal(removed.code, "STALE");
  assert.equal(fs.existsSync(path.join(f.mateDir, "knowledge", "notes.md")), false);

  var recreated = result(f.message({ type: "knowledge_save", requestId: "recreate", name: "notes.md", content: "# Notes\ncurrent" }), "knowledge_saved");
  var renamed = result(f.message({ type: "knowledge_rename", requestId: "rename", from: "notes.md", name: "decisions.md", expectedRevision: recreated.revision }), "knowledge_renamed");
  assert.equal(renamed.name, "decisions.md");
  assert.equal(fs.existsSync(path.join(f.mateDir, "knowledge", "notes.md")), false);

  var traversal = result(f.message({ type: "knowledge_save", requestId: "traversal", name: "../escape.md", content: "bad" }), "knowledge_error");
  assert.equal(traversal.code, "FAILED");
  assert.equal(fs.existsSync(path.join(f.mateDir, "escape.md")), false);
  var forbidden = result(f.message({ type: "knowledge_delete", requestId: "forbidden", name: "decisions.md", expectedRevision: renamed.revision }, { _clayUser: { id: "bob" } }), "knowledge_error");
  assert.equal(forbidden.code, "FORBIDDEN");
});

test("JSONL Knowledge sources are readable but cannot be renamed or deleted", function (t) {
  var f = fixture(t); var journal = path.join(f.mateDir, "knowledge", "events.jsonl"); fs.writeFileSync(journal, '{"event":"kept"}\n');
  var read = result(f.message({ type: "knowledge_read", requestId: "read", name: "events.jsonl" }), "knowledge_content");
  assert.equal(read.writable, false);
  var rename = result(f.message({ type: "knowledge_rename", requestId: "rename", from: "events.jsonl", name: "events.md", expectedRevision: read.revision }), "knowledge_error");
  var remove = result(f.message({ type: "knowledge_delete", requestId: "delete", name: "events.jsonl", expectedRevision: read.revision }), "knowledge_error");
  assert.equal(rename.code, "READ_ONLY"); assert.equal(remove.code, "READ_ONLY"); assert.equal(fs.existsSync(journal), true);
});

test("Mate Knowledge refuses symlink files and symlink knowledge directories", function (t) {
  var f = fixture(t); var outside = path.join(f.root, "outside.md"); fs.writeFileSync(outside, "outside");
  fs.symlinkSync(outside, path.join(f.mateDir, "knowledge", "linked.md"));
  var fileError = result(f.message({ type: "knowledge_read", requestId: "file-link", name: "linked.md" }), "knowledge_error");
  assert.match(fileError.error, /safe regular file/);
  fs.unlinkSync(path.join(f.mateDir, "knowledge", "linked.md")); fs.rmdirSync(path.join(f.mateDir, "knowledge")); fs.symlinkSync(f.root, path.join(f.mateDir, "knowledge"));
  var directoryError = result(f.message({ type: "knowledge_save", requestId: "dir-link", name: "blocked.md", content: "bad" }), "knowledge_error");
  assert.match(directoryError.error, /safe directory/); assert.equal(fs.existsSync(path.join(f.root, "blocked.md")), false);
});

test("a workbench save and bounded content search use the isolated common Knowledge backend", function (t) {
  var f = fixture(t);
  var saved = result(f.message({ type: "knowledge_save", requestId: "parity", name: "architecture.md", content: "# Architecture\nQuasar indexing keeps durable replay fast." }), "knowledge_saved");
  assert.ok(saved.revision);
  var searchedFiles = result(f.message({ type: "knowledge_search", requestId: "file-search", query: "durable replay" }), "knowledge_search_results");
  assert.deepEqual(searchedFiles.files.map(function (file) { return file.name; }), ["architecture.md"]);
  var session = { localId: 1, ownerId: "alice" };
  var project = { getStatus: function () { return { slug: "mate-test", path: f.mateDir, projectOwnerId: "alice", isMate: true, mateId: "mate_test" }; }, getSessionManager: function () { return { sessions: new Map([[1, session]]) }; } };
  var service = attachService({ baseDir: f.baseDir, getProjects: function () { return new Map([["mate-test", project]]); }, isMultiUser: function () { return true; },
    resolveMate: function (userId, mateId) { return userId === "alice" && mateId === "mate_test" ? { id: mateId, name: "Test", createdBy: "alice", dir: f.mateDir } : null; } });
  var bound = service.bind({ projectSlug: "mate-test", projectOwnerId: "alice", isMate: true, mateId: "mate_test", session: session });
  var search = bound.searchKnowledge({ query: "quasar durable", limit: 10 }); assert.equal(search.results.length, 1);
  assert.equal(bound.readKnowledge({ ref: search.results[0].ref }).content, "# Architecture\nQuasar indexing keeps durable replay fast.");
});

test("a sync failure reports the disk commit and can be retried", function (t) {
  var f = fixture(t); var original = mateSync.syncMateSource;
  mateSync.syncMateSource = function () { return { failed: 1, errors: [{ message: "fixture index unavailable" }] }; };
  t.after(function () { mateSync.syncMateSource = original; });
  var saved = result(f.message({ type: "knowledge_save", requestId: "save", name: "offline-index.md", content: "saved canonical text" }), "knowledge_saved");
  assert.equal(saved.indexSyncPending, true); assert.match(saved.syncError, /fixture index unavailable/);
  assert.equal(fs.readFileSync(path.join(f.mateDir, "knowledge", "offline-index.md"), "utf8"), "saved canonical text");
  var failedRetry = result(f.message({ type: "knowledge_sync", requestId: "retry-1", names: ["offline-index.md"] }), "knowledge_error");
  assert.equal(failedRetry.diskCommitted, true); assert.equal(failedRetry.code, "SYNC_FAILED");
  mateSync.syncMateSource = original;
  var retried = result(f.message({ type: "knowledge_sync", requestId: "retry-2", names: ["offline-index.md"] }), "knowledge_synced");
  assert.deepEqual(retried.names, ["offline-index.md"]);
});

test("production Knowledge messages operate a persistent NeDB database without changing text documents", async function (t) {
  var f = fixture(t); fs.writeFileSync(path.join(f.mateDir, "knowledge", "kept.md"), "# Kept\nPortable text");
  var operationTime = Date.now();
  f.message({ type: "knowledge_db_create", requestId: "db-create", name: "Cases", operationId: "db-create_" + operationTime + "_1" }); var created = await waitResult(f, "knowledge_db_created"); var database = created.database; assert.match(database.id, /^db_/);
  var schema = database.schema.concat([{ id: "fld_score01", name: "Score", type: "number", required: false, archived: false }]); f.message({ type: "knowledge_db_schema_save", requestId: "schema", databaseId: database.id, expectedRevision: database.revision, schema: schema, operationId: "schema-save_" + operationTime + "_2" }); var schemaSaved = await waitResult(f, "knowledge_db_schema_saved"); database = schemaSaved.database;
  var values = { fld_score01: 8 }; values[database.schema[0].id] = "Alpha"; f.message({ type: "knowledge_db_record_create", requestId: "record", databaseId: database.id, expectedDatabaseRevision: database.revision, values: values, operationId: "record-create_" + operationTime + "_3" }); var record = await waitResult(f, "knowledge_db_record_created");
  f.message({ type: "knowledge_db_query", requestId: "query", databaseId: database.id, limit: 20 }); var queried = await waitResult(f, "knowledge_db_query_results"); assert.equal(queried.records[0].id, record.record.id); assert.equal(queried.totals.sums.fld_score01, 8);
  f.restart(); f.message({ type: "knowledge_db_record_read", requestId: "restart-read", databaseId: database.id, recordId: record.record.id }); var restarted = await waitResult(f, "knowledge_db_record_content"); assert.equal(restarted.record.values.fld_score01, 8);
  assert.equal(fs.readFileSync(path.join(f.mateDir, "knowledge", "kept.md"), "utf8"), "# Kept\nPortable text"); assert.ok(fs.existsSync(path.join(f.mateDir, "knowledge", ".clay-db", "databases.db")));
  f.message({ type: "knowledge_list", requestId: "list-with-db" }); var listed = result(f.sent, "knowledge_list"); assert.equal(listed.files.filter(function (item) { return item.id === database.id && item.itemType === "db"; }).length, 1);
});

test("nested documents keep stable identities and expose unopened workspace backlinks", function (t) {
  var f = fixture(t);
  var target = result(f.message({ type: "knowledge_save", requestId: "target", name: "areas/alpha/note.md", content: "# Note\nTarget text" }), "knowledge_saved");
  result(f.message({ type: "knowledge_save", requestId: "source", name: "maps/start.md", content: "See [[../areas/alpha/note#Note|the note]].\n\n```md\n[[../areas/alpha/note]]\n```" }), "knowledge_saved");
  var listed = result(f.message({ type: "knowledge_list", requestId: "list" }), "knowledge_list");
  assert.deepEqual(listed.files.map(function (file) { return file.name; }), ["areas/alpha/note.md", "maps/start.md"]);
  assert.equal(listed.files[0].folder, "areas/alpha"); assert.equal(listed.files[0].itemType, "text"); assert.equal(listed.files[0].id, target.id);
  var read = result(f.message({ type: "knowledge_read", requestId: "read", name: "areas/alpha/note.md", documentId: target.id }), "knowledge_content");
  assert.equal(read.backlinks.length, 1); assert.equal(read.backlinks[0].name, "maps/start.md"); assert.match(read.backlinks[0].snippet, /See/);

  fs.renameSync(path.join(f.mateDir, "knowledge", "areas", "alpha", "note.md"), path.join(f.mateDir, "knowledge", "areas", "alpha", "moved.md"));
  var afterExternalMove = result(f.message({ type: "knowledge_list", requestId: "moved" }), "knowledge_list");
  var moved = afterExternalMove.files.filter(function (file) { return file.name === "areas/alpha/moved.md"; })[0];
  assert.equal(moved.id, target.id, "an external rename is reconciled to the durable identity");
});

test("rename and move rewrite only links that resolved to the moved document", function (t) {
  var f = fixture(t);
  var first = result(f.message({ type: "knowledge_save", requestId: "first", name: "one/note.md", content: "# One" }), "knowledge_saved");
  result(f.message({ type: "knowledge_save", requestId: "second", name: "two/note.md", content: "# Two" }), "knowledge_saved");
  result(f.message({ type: "knowledge_save", requestId: "map", name: "map.md", content: "[[one/note|One]] [[two/note|Two]] [[note|Ambiguous]] `[[one/note]]`\n```\n[[one/note]]\n```" }), "knowledge_saved");
  var renamed = result(f.message({ type: "knowledge_rename", requestId: "move", documentId: first.id, from: "one/note.md", name: "archive/one.md", expectedRevision: first.revision }), "knowledge_renamed");
  assert.equal(renamed.updatedLinks, 1); assert.deepEqual(renamed.linkUpdateFailures, []);
  var map = result(f.message({ type: "knowledge_read", requestId: "map-read", name: "map.md" }), "knowledge_content");
  assert.match(map.content, /\[\[archive\/one\|One\]\]/); assert.match(map.content, /\[\[two\/note\|Two\]\]/); assert.match(map.content, /\[\[note\|Ambiguous\]\]/);
  assert.match(map.content, /`\[\[one\/note\]\]`/); assert.match(map.content, /```\n\[\[one\/note\]\]\n```/);
});

test("user-bound drafts survive service restart and report external conflicts", function (t) {
  var f = fixture(t); var saved = result(f.message({ type: "knowledge_save", requestId: "save", name: "draft.md", content: "disk v1" }), "knowledge_saved");
  var draft = result(f.message({ type: "knowledge_draft_save", requestId: "draft", documentId: saved.id, name: "draft.md", content: "local draft", baseRevision: saved.revision, cursor: { line: 0, ch: 5 } }), "knowledge_draft_saved");
  assert.ok(draft.savedAt); f.restart();
  fs.writeFileSync(path.join(f.mateDir, "knowledge", "draft.md"), "disk v2");
  var read = result(f.message({ type: "knowledge_read", requestId: "read", name: "draft.md", documentId: saved.id }), "knowledge_content");
  assert.equal(read.content, "disk v2"); assert.equal(read.recoveredDraft.content, "local draft"); assert.equal(read.recoveredDraft.baseRevision, saved.revision); assert.deepEqual(read.recoveredDraft.cursor, { line: 0, ch: 5 });
  var bobRead = result(f.message({ type: "knowledge_read", requestId: "bob", name: "draft.md", documentId: saved.id }, { _clayUser: { id: "bob" } }), "knowledge_content");
  assert.equal(bobRead.recoveredDraft, null, "drafts are bound to the authenticated user");
});

test("the reusable workspace index covers documents beyond one hundred and reconciles external edits", async function (t) {
  var f = fixture(t); var knowledge = path.join(f.mateDir, "knowledge");
  fs.writeFileSync(path.join(knowledge, "target.md"), "# Target");
  for (var i = 0; i < 105; i++) fs.writeFileSync(path.join(knowledge, "doc-" + String(i).padStart(3, "0") + ".md"), i === 104 ? "tailneedle [[target]]" : "ordinary " + i);
  var search = result(f.message({ type: "knowledge_search", requestId: "tail", query: "tailneedle", limit: 10 }), "knowledge_search_results");
  assert.equal(search.total, 1); assert.equal(search.files[0].name, "doc-104.md"); assert.equal(search.complete, true);
  f.message({ type: "knowledge_db_create", requestId: "db-search", name: "Ordinary database", operationId: "db-search_" + Date.now() + "_1" }); await waitResult(f, "knowledge_db_created");
  var page = result(f.message({ type: "knowledge_search", requestId: "page", query: "ordinary", offset: 100, limit: 10 }), "knowledge_search_results");
  assert.equal(page.total, 105); assert.equal(page.files.length, 5); assert.equal(page.files[4].itemType, "db"); assert.equal(page.offset, 100);
  var target = result(f.message({ type: "knowledge_read", requestId: "target", name: "target.md" }), "knowledge_content");
  assert.equal(target.backlinks.length, 1); assert.equal(target.backlinks[0].name, "doc-104.md");
  fs.writeFileSync(path.join(knowledge, "doc-104.md"), "changedtail [[target]]");
  var refreshed = result(f.message({ type: "knowledge_search", requestId: "changed", query: "changedtail" }), "knowledge_search_results");
  assert.equal(refreshed.files[0].name, "doc-104.md");
});

test("moving a document preserves resolved incoming and outgoing link meaning", function (t) {
  var f = fixture(t);
  var a = result(f.message({ type: "knowledge_save", requestId: "a", name: "folder/A.md", content: "[B](B.md)" }), "knowledge_saved");
  result(f.message({ type: "knowledge_save", requestId: "b", name: "folder/B.md", content: "# B" }), "knowledge_saved");
  result(f.message({ type: "knowledge_save", requestId: "map", name: "map.md", content: "[A](folder/A.md)" }), "knowledge_saved");
  var moved = result(f.message({ type: "knowledge_rename", requestId: "move-a", documentId: a.id, from: "folder/A.md", name: "other/A.md", expectedRevision: a.revision }), "knowledge_renamed");
  assert.equal(moved.linkUpdateFailures.length, 0); assert.equal(moved.updatedLinks, 2);
  assert.equal(result(f.message({ type: "knowledge_read", requestId: "read-a", name: "other/A.md" }), "knowledge_content").content, "[B](../folder/B.md)");
  assert.equal(result(f.message({ type: "knowledge_read", requestId: "read-map", name: "map.md" }), "knowledge_content").content, "[A](other/A.md)");
});

test("Markdown link parsing honors fence lengths, inline code, escapes, and external targets", function () {
  var parsed = knowledgeMarkdown.parse("````\n```\n[[hidden]]\n````\n`[[inline]]` \\[[escaped]] [web](https://example.com) [[shown]]");
  assert.deepEqual(parsed.links.map(function (link) { return link.target; }), ["https://example.com", "shown"]);
  assert.equal(parsed.links[0].external, true); assert.equal(parsed.links[1].external, false);
});

test("exact document identity keeps shared and local same-name documents distinct", function (t) {
  var common = [{ ownMateId: "mate_shared", name: "same.md", content: "[[shared-target]]" }, { ownMateId: "mate_shared", name: "shared-target.md", content: "# Shared" }];
  var f = fixture(t, common);
  var local = result(f.message({ type: "knowledge_save", requestId: "local", name: "same.md", content: "[[local-target]]" }), "knowledge_saved");
  result(f.message({ type: "knowledge_save", requestId: "target", name: "local-target.md", content: "# Local" }), "knowledge_saved");
  var listed = result(f.message({ type: "knowledge_list", requestId: "list" }), "knowledge_list").files;
  var shared = listed.filter(function (file) { return file.common && file.name === "same.md"; })[0];
  var sharedRead = result(f.message({ type: "knowledge_read", requestId: "shared", name: shared.name, documentId: shared.id, common: true, ownMateId: shared.ownMateId }), "knowledge_content");
  var localRead = result(f.message({ type: "knowledge_read", requestId: "local-read", name: "same.md", documentId: local.id }), "knowledge_content");
  assert.equal(sharedRead.outgoing[0].name, "shared-target.md"); assert.match(sharedRead.outgoing[0].documentKey, /^shared:/);
  assert.equal(localRead.outgoing[0].name, "local-target.md"); assert.match(localRead.outgoing[0].documentKey, /^local:/);
});

test("draft discovery, guarded discard, deleted history restore, and safe read limits use production messages", function (t) {
  var f = fixture(t); var first = result(f.message({ type: "knowledge_save", requestId: "first", name: "recover.md", content: "v1" }), "knowledge_saved");
  var second = result(f.message({ type: "knowledge_save", requestId: "second", name: "recover.md", content: "v2", expectedRevision: first.revision }), "knowledge_saved");
  result(f.message({ type: "knowledge_draft_save", requestId: "existing-draft", documentId: first.id, name: "recover.md", content: "draft v2", baseRevision: second.revision, clientVersion: 3 }), "knowledge_draft_saved");
  result(f.message({ type: "knowledge_draft_save", requestId: "new-draft", documentId: "draft:new", name: "nested/new.md", content: "unsaved", clientVersion: 3, newDocument: true }), "knowledge_draft_saved");
  var listed = result(f.message({ type: "knowledge_list", requestId: "draft-list" }), "knowledge_list");
  assert.ok(listed.drafts.some(function (draft) { return draft.documentId === "draft:new" && draft.name === "nested/new.md"; }));
  var discarded = result(f.message({ type: "knowledge_discard_draft", requestId: "discard", documentId: first.id, name: "recover.md", expectedRevision: second.revision, throughVersion: 3 }), "knowledge_draft_discarded");
  assert.equal(discarded.content, "v2"); assert.equal(discarded.removed, true);
  result(f.message({ type: "knowledge_delete", requestId: "delete", name: "recover.md", expectedRevision: second.revision }), "knowledge_deleted");
  var deleted = result(f.message({ type: "knowledge_deleted_list", requestId: "deleted" }), "knowledge_deleted_list"); assert.equal(deleted.files[0].id, first.id);
  var history = result(f.message({ type: "knowledge_history", requestId: "history", documentId: first.id }), "knowledge_history"); assert.ok(history.versions.length >= 2);
  var restored = result(f.message({ type: "knowledge_restore", requestId: "restore", documentId: first.id, version: history.versions[0].version, name: "recover.md" }), "knowledge_restored");
  assert.equal(restored.id, first.id);
  fs.writeFileSync(path.join(f.mateDir, "knowledge", "huge.md"), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  var huge = result(f.message({ type: "knowledge_read", requestId: "huge", name: "huge.md" }), "knowledge_error"); assert.equal(huge.code, "TOO_LARGE");
  var incomplete = result(f.message({ type: "knowledge_search", requestId: "huge-search", query: "recover" }), "knowledge_search_results");
  assert.equal(incomplete.complete, false); assert.equal(incomplete.errors[0].name, "huge.md");
});

test("metadata and history symlinks are refused without writes outside the store", function (t) {
  var f = fixture(t); var saved = result(f.message({ type: "knowledge_save", requestId: "one", name: "safe.md", content: "one" }), "knowledge_saved");
  var revised = result(f.message({ type: "knowledge_save", requestId: "two", name: "safe.md", content: "two", expectedRevision: saved.revision }), "knowledge_saved");
  var documentRoot = path.join(f.baseDir, "knowledge-documents", fs.readdirSync(path.join(f.baseDir, "knowledge-documents"))[0]);
  var historyRoot = path.join(documentRoot, "history"); var realHistory = path.join(documentRoot, "history-real"); fs.renameSync(historyRoot, realHistory);
  var outside = path.join(f.root, "outside-history"); fs.mkdirSync(outside); fs.symlinkSync(outside, historyRoot);
  var blocked = result(f.message({ type: "knowledge_save", requestId: "three", name: "safe.md", content: "three", expectedRevision: revised.revision }), "knowledge_error");
  assert.equal(blocked.code, "UNSAFE_PATH"); assert.deepEqual(fs.readdirSync(outside), []);
});

test("production client state preserves edits, selection, identity, and close semantics", async function () {
  var moduleUrl = pathToFileURL(path.join(__dirname, "../lib/public/modules/mate-knowledge-workbench-state.js")).href + "?test=" + Date.now();
  var stateApi = await import(moduleUrl);
  var local = { name: "same.md", common: false }; var sharedA = { name: "same.md", common: true, ownMateId: "mate_a" }; var sharedB = { name: "same.md", common: true, ownMateId: "mate_b" };
  var localId = stateApi.documentIdentity(local); var sharedAId = stateApi.documentIdentity(sharedA); var sharedBId = stateApi.documentIdentity(sharedB);
  assert.equal(new Set([localId, sharedAId, sharedBId]).size, 3);

  var state = stateApi.blankKnowledgeState();
  state.files = [local, sharedA, sharedB]; state.tabs = [localId]; state.selected = localId;
  state.drafts[localId] = { file: local, content: "submitted", savedContent: "old", revision: "r1", dirty: true, writable: true, version: 1 };
  var begun = stateApi.beginKnowledgeSave(state, localId, "save-1", "same.md");
  var edited = stateApi.editKnowledgeDraft(begun.state, localId, { content: "typed later", dirty: true });
  var otherId = "draft:other"; edited.drafts[otherId] = { file: { name: "other.md", common: false }, content: "other", dirty: false, writable: true, version: 0 }; edited.tabs.push(otherId);
  edited = stateApi.selectKnowledgeDocument(edited, otherId);
  var acknowledged = stateApi.applyKnowledgeSave(edited, begun.pending, { name: "same.md", revision: "r2" });
  assert.equal(acknowledged.drafts[localId].content, "typed later"); assert.equal(acknowledged.drafts[localId].dirty, true);
  assert.equal(acknowledged.drafts[localId].revision, "r2"); assert.equal(acknowledged.selected, otherId);

  var reading = stateApi.blankKnowledgeState(); reading.files = [sharedA, sharedB];
  var readA = stateApi.beginKnowledgeRead(reading, sharedA, "read-a", false);
  var readB = stateApi.beginKnowledgeRead(readA.state, sharedB, "read-b", false);
  var afterB = stateApi.applyKnowledgeRead(readB.state, readB.pending, { content: "B", writable: true });
  var afterA = stateApi.applyKnowledgeRead(afterB, readA.pending, { content: "A", writable: true });
  assert.equal(afterA.selected, sharedBId); assert.equal(afterA.drafts[sharedAId].writable, false); assert.equal(afterA.drafts[sharedBId].writable, false);

  var firstSame = stateApi.beginKnowledgeRead(stateApi.blankKnowledgeState(), sharedA, "old-read", false);
  var secondSame = stateApi.beginKnowledgeRead(firstSame.state, sharedA, "new-read", false);
  var newest = stateApi.applyKnowledgeRead(secondSame.state, secondSame.pending, { content: "new", writable: false });
  var ignoredOld = stateApi.applyKnowledgeRead(newest, firstSame.pending, { content: "old", writable: false });
  assert.equal(ignoredOld.drafts[sharedAId].content, "new");

  var cachedBase = Object.assign({}, readA.state, { drafts: Object.assign({}, readA.state.drafts), tabs: [] });
  cachedBase.drafts[otherId] = { file: { name: "other.md", common: false }, content: "cached", dirty: false, writable: true, version: 0 };
  var cached = stateApi.selectKnowledgeDocument(cachedBase, otherId);
  var late = stateApi.applyKnowledgeRead(cached, readA.pending, { content: "late", writable: false }); assert.equal(late.selected, otherId);

  var failed = stateApi.failKnowledgeRequest(begun.state, begun.pending, { error: "offline" });
  assert.equal(failed.drafts[localId].savingRequest, null); assert.equal(failed.drafts[localId].dirty, true);
  var offline = stateApi.failKnowledgeOffline(begun.state, localId, "Reconnect to save this document."); assert.equal(offline.drafts[localId].savingRequest, null);

  var closable = Object.assign({}, acknowledged); closable.drafts = Object.assign({}, acknowledged.drafts, { [otherId]: Object.assign({}, acknowledged.drafts[otherId], { dirty: false }) });
  var closed = stateApi.closeKnowledgeTab(closable, otherId); assert.equal(closed.tabs.indexOf(otherId), -1); assert.equal(closed.selected, localId);
  var reopened = stateApi.selectKnowledgeDocument(closed, otherId); assert.ok(reopened.tabs.indexOf(otherId) !== -1); assert.equal(reopened.selected, otherId);
  var refused = stateApi.closeKnowledgeTab(acknowledged, localId); assert.ok(refused.tabs.indexOf(localId) !== -1); assert.match(refused.drafts[localId].error, /Save this draft/);

  var conflictRead = stateApi.beginKnowledgeRead(stateApi.blankKnowledgeState(), { id: "doc-1", name: "conflict.md", common: false }, "conflict-read", false);
  var conflict = stateApi.applyKnowledgeRead(conflictRead.state, conflictRead.pending, { id: "doc-1", name: "conflict.md", content: "disk v2", revision: "r2", writable: true,
    recoveredDraft: { content: "local draft", baseRevision: "r1", clientVersion: 4 } });
  var conflictId = stateApi.documentIdentity({ id: "doc-1", name: "conflict.md", common: false }); assert.equal(conflict.drafts[conflictId].conflict, true);
  var discardPending = { documentId: conflictId, submittedVersion: conflict.drafts[conflictId].version || 0 };
  var discarded = stateApi.applyKnowledgeDiscard(conflict, discardPending, { content: "disk v2", revision: "r2" }); assert.equal(discarded.drafts[conflictId].dirty, false);
  var editedConflict = stateApi.editKnowledgeDraft(conflict, conflictId, { content: "typed during reload", dirty: true });
  var preserved = stateApi.applyKnowledgeDiscard(editedConflict, discardPending, { content: "disk v2", revision: "r2" }); assert.equal(preserved.drafts[conflictId].content, "typed during reload"); assert.equal(preserved.drafts[conflictId].conflict, true);
});
