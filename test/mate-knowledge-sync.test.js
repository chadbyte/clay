var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var mateSync = require("../lib/mate-knowledge-sync");
var knowledgeImport = require("../lib/knowledge-import");

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clay-sync-" + label + "-"));
}

function write(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function digest(topic) {
  return JSON.stringify({ date: "2026-04-09", type: "session", topic: topic });
}

function fixture(label) {
  var home = tmp(label);
  var mateDir = path.join(home, "mates", "mate_sync");
  fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });
  var baseDir = path.join(home, "knowledge");
  return {
    home: home,
    mateDir: mateDir,
    knowledge: path.join(mateDir, "knowledge"),
    baseDir: baseDir,
    scope: mateSync.scopeForMateDir(mateDir),
    importer: function () {
      return knowledgeImport.createKnowledgeImporter({
        scopeId: mateSync.scopeForMateDir(mateDir).scopeId,
        baseDir: baseDir,
      });
    },
  };
}

function sync(f, fileName, actor) {
  return mateSync.syncMateSource({ mateDir: f.mateDir, fileName: fileName, baseDir: f.baseDir, actor: actor });
}

function find(entries, importKey) {
  for (var i = 0; i < entries.length; i++) if (entries[i].importKey === importKey) return entries[i];
  return null;
}

var USER = { type: "user", userId: "u1", displayName: "Ada" };
var AGENT = { type: "agent", vendor: "claude" };

test("write-through creates, revises, and tombstones a knowledge file", function () {
  var f = fixture("file");
  var target = path.join(f.knowledge, "architecture.md");

  write(target, "# Architecture\nAppend-only.\n");
  var created = sync(f, "architecture.md", USER);
  assert.equal(created.created, 1);
  assert.equal(created.failed, 0);

  var entry = find(f.importer().entries(), "file:architecture.md");
  assert.equal(entry.kind, "knowledge-file");
  assert.equal(entry.content, "# Architecture\nAppend-only.\n");
  assert.equal(entry.actor.type, "user");
  assert.equal(entry.actor.userId, "u1");
  assert.equal(entry.actor.displayName, "Ada");

  // Repeated sync with no change writes nothing.
  var before = f.importer().stats().records;
  assert.equal(sync(f, "architecture.md", USER).unchanged, 1);
  assert.equal(sync(f, "architecture.md", USER).unchanged, 1);
  assert.equal(f.importer().stats().records, before, "idempotent sync appends no record");

  write(target, "# Architecture\nAppend-only, revised.\n");
  assert.equal(sync(f, "architecture.md", USER).revised, 1);
  var revised = find(f.importer().entries(), "file:architecture.md");
  assert.equal(revised.revisions, 2);
  assert.match(revised.content, /revised/);

  // Deleting the legacy file appends a tombstone rather than leaving it live.
  fs.unlinkSync(target);
  assert.equal(sync(f, "architecture.md", USER).deleted, 1);
  assert.equal(find(f.importer().entries(), "file:architecture.md"), null);
  var tombstoned = find(f.importer().entries({ includeDeleted: true }), "file:architecture.md");
  assert.equal(tombstoned.deleted, true);
  assert.equal(sync(f, "architecture.md", USER)["already-deleted"], 1, "a repeated delete sync is a no-op");

  // Recreating the file revives the record instead of duplicating it.
  write(target, "# Architecture\nBack again.\n");
  assert.equal(sync(f, "architecture.md", USER).revived, 1);
  var revived = find(f.importer().entries(), "file:architecture.md");
  assert.equal(revived.deleted, false);
  assert.match(revived.content, /Back again/);
  assert.equal(f.importer().entries().filter(function (e) { return e.importKey === "file:architecture.md"; }).length, 1);
});

test("nested Markdown sources use the same isolated record interface", function () {
  var f = fixture("nested-file"); var target = path.join(f.knowledge, "guides", "start.md");
  write(target, "# Start\nNested source.\n");
  var created = sync(f, "guides/start.md", USER); assert.equal(created.created, 1); assert.equal(created.failed, 0);
  var entry = find(f.importer().entries(), "file:guides/start.md");
  assert.equal(entry.content, "# Start\nNested source.\n"); assert.equal(entry.source.relPath, "knowledge/guides/start.md");
  fs.unlinkSync(target); var reconciled = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: { type: "system" } });
  assert.equal(reconciled.deleted, 1); assert.equal(find(f.importer().entries(), "file:guides/start.md"), null);
});

test("an emptied knowledge file becomes a tombstone, not a blank record", function () {
  var f = fixture("empty");
  write(path.join(f.knowledge, "notes.md"), "content\n");
  sync(f, "notes.md", USER);
  write(path.join(f.knowledge, "notes.md"), "   \n");
  var summary = sync(f, "notes.md", USER);
  assert.equal(summary.empty, 1);
  assert.equal(summary.deleted, 1);
  assert.equal(find(f.importer().entries(), "file:notes.md"), null);
});

test("journal appends mirror through and repeated sync is idempotent", function () {
  var f = fixture("journal");
  var journal = path.join(f.knowledge, "session-digests.jsonl");

  write(journal, digest("first") + "\n");
  assert.equal(sync(f, "session-digests.jsonl", AGENT).created, 1);

  fs.appendFileSync(journal, digest("second") + "\n");
  var second = sync(f, "session-digests.jsonl", AGENT);
  assert.equal(second.created, 1);
  assert.equal(second.unchanged, 1);

  var before = f.importer().stats().records;
  assert.equal(sync(f, "session-digests.jsonl", AGENT).unchanged, 2);
  assert.equal(f.importer().stats().records, before);

  var entries = f.importer().entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "session-digest");
  assert.equal(entries[0].actor.type, "agent");
  assert.equal(entries[0].actor.vendor, "claude");
});

test("digest deletion reconciles: the removed line is tombstoned, the rest stay live", function () {
  var f = fixture("delete");
  var journal = path.join(f.knowledge, "session-digests.jsonl");
  write(journal, digest("keep-one") + "\n" + digest("remove-me") + "\n" + digest("keep-two") + "\n");
  sync(f, "session-digests.jsonl", AGENT);
  assert.equal(f.importer().entries().length, 3);

  var removedKey = mateSync.journalKey("session-digests.jsonl", knowledgeImport.contentHash(digest("remove-me")));

  // Exactly what handleMemoryDelete does: splice the line and rewrite the file.
  var lines = fs.readFileSync(journal, "utf8").trim().split("\n");
  lines.splice(1, 1);
  fs.writeFileSync(journal, lines.join("\n") + "\n");

  var summary = sync(f, "session-digests.jsonl", USER);
  assert.equal(summary.deleted, 1, "the vanished line is tombstoned");
  assert.equal(summary.unchanged, 2, "surviving lines are untouched");
  assert.equal(summary.created, 0);

  var live = f.importer().entries();
  assert.equal(live.length, 2);
  assert.equal(find(live, removedKey), null, "a deleted memory is not left active");
  var tombstoned = find(f.importer().entries({ includeDeleted: true }), removedKey);
  assert.equal(tombstoned.deleted, true);
  assert.equal(tombstoned.actor.type, "agent", "original authorship is preserved");
  assert.equal(tombstoned.deletedBy.type, "user", "the deletion records who caused it");
  assert.equal(tombstoned.deletedBy.userId, "u1");
  assert.ok(tombstoned.deletedAt > 0);

  // Reconciling again changes nothing.
  var repeat = sync(f, "session-digests.jsonl", USER);
  assert.equal(repeat.deleted, 0);
  assert.equal(repeat["already-deleted"], 0);
  assert.equal(f.importer().entries().length, 2);

  // Emptying the journal entirely tombstones everything that remained.
  fs.unlinkSync(journal);
  var cleared = sync(f, "session-digests.jsonl", USER);
  assert.equal(cleared.deleted, 2);
  assert.equal(f.importer().entries().length, 0);
});

test("large sources are stored losslessly as chunks and reassemble exactly", function () {
  var f = fixture("chunks");
  // Deliberately larger than one record, with multibyte and escape-heavy text.
  var body = "";
  for (var i = 0; i < 4000; i++) body += "line " + i + " éü\"\\\t ends\n";
  assert.ok(body.length > knowledgeImport.MAX_CONTENT_CHARS * 3);
  write(path.join(f.knowledge, "big.md"), body);

  var summary = sync(f, "big.md", USER);
  assert.equal(summary.created, 1);
  assert.equal(summary.chunked, 1);
  assert.equal(summary.failed, 0, "a large source must not be reported as failed");

  var importer = f.importer();
  var entry = find(importer.entries(), "file:big.md");
  assert.equal(entry.chunked, true);
  assert.ok(entry.chunkCount > 3);
  assert.equal(entry.content, "", "no partial content masquerades as the whole source");

  var read = importer.readContent(entry);
  assert.equal(read.complete, true);
  assert.equal(read.content, body, "reassembly is byte-exact");
  assert.equal(knowledgeImport.contentHash(read.content), entry.contentHash);

  // Chunk records never surface as knowledge entries.
  assert.equal(importer.entries().length, 1);
  assert.ok(importer.entries({ includeChunks: true }).length > 4);
  assert.ok(importer.stats().chunks > 3);

  // Idempotent, and a revision re-chunks correctly.
  assert.equal(sync(f, "big.md", USER).unchanged, 1);
  write(path.join(f.knowledge, "big.md"), body + "one more line\n");
  assert.equal(sync(f, "big.md", USER).revised, 1);
  var revised = find(f.importer().entries(), "file:big.md");
  assert.equal(f.importer().readContent(revised).content, body + "one more line\n");

  // Shrinking back below the chunk threshold returns to inline content.
  write(path.join(f.knowledge, "big.md"), "small again\n");
  sync(f, "big.md", USER);
  var small = find(f.importer().entries(), "file:big.md");
  assert.equal(small.chunked, false);
  assert.equal(f.importer().readContent(small).content, "small again\n");
});

test("NUL and multibyte Unicode survive a chunked round trip exactly", function () {
  var f = fixture("nul");
  var NUL = String.fromCharCode(0);

  // Larger than one chunk, and deliberately hostile: NUL (which JSON escapes
  // rather than carries literally), astral-plane characters whose UTF-16
  // surrogate pairs can straddle a chunk boundary, combining marks, and every
  // C0 control character.
  var controls = "";
  for (var c = 0; c < 32; c++) controls += String.fromCharCode(c);
  var body = "";
  for (var i = 0; i < 900; i++) {
    body += "line " + i + " " + NUL + " ünïcode 漢字 🎉 é " + controls + " \\ \" \t end\n";
  }
  assert.ok(body.length > knowledgeImport.CHUNK_CHARS * 2, "the source must span several chunks");
  assert.ok(body.indexOf(NUL) !== -1);

  write(path.join(f.knowledge, "hostile.md"), body);
  var summary = sync(f, "hostile.md", USER);
  assert.equal(summary.created, 1);
  assert.equal(summary.chunked, 1);
  assert.equal(summary.failed, 0, "a representable source must never be reported as failed");
  assert.deepEqual(summary.errors, []);

  var importer = f.importer();
  var entry = find(importer.entries(), "file:hostile.md");
  assert.equal(entry.chunked, true);
  var read = importer.readContent(entry);
  assert.equal(read.complete, true);
  assert.equal(read.content, body, "reassembly is character-exact");
  assert.equal(read.content.length, body.length);
  assert.equal(Buffer.byteLength(read.content, "utf8"), Buffer.byteLength(body, "utf8"));
  assert.equal(read.content.indexOf(NUL), body.indexOf(NUL), "NUL is preserved, not stripped");
  assert.equal(knowledgeImport.contentHash(read.content), entry.contentHash);

  // Force a chunk boundary to fall inside a surrogate pair.
  var split = new Array(knowledgeImport.CHUNK_CHARS).join("a") + "🎉" + new Array(knowledgeImport.CHUNK_CHARS).join("b");
  var high = split.charCodeAt(knowledgeImport.CHUNK_CHARS - 1);
  var low = split.charCodeAt(knowledgeImport.CHUNK_CHARS);
  assert.ok(high >= 0xd800 && high <= 0xdbff, "the chunk boundary lands on a high surrogate");
  assert.ok(low >= 0xdc00 && low <= 0xdfff, "the next chunk starts with its low surrogate");
  assert.deepEqual(knowledgeImport.splitChunks(split).length, 2);
  write(path.join(f.knowledge, "surrogate.md"), split);
  var surrogateSummary = sync(f, "surrogate.md", USER);
  assert.equal(surrogateSummary.failed, 0);
  var surrogate = find(f.importer().entries(), "file:surrogate.md");
  assert.equal(f.importer().readContent(surrogate).content, split, "a split surrogate pair reassembles");

  // A NUL-bearing journal line, which is line-addressed rather than file-addressed.
  var line = JSON.stringify({ date: "2026-07-01", topic: "nul" + NUL + "topic", body: "漢字 🎉 " + new Array(20000).join("q") });
  write(path.join(f.knowledge, "session-digests.jsonl"), line + "\n");
  var journalSummary = sync(f, "session-digests.jsonl", AGENT);
  assert.equal(journalSummary.created, 1);
  assert.equal(journalSummary.chunked, 1);
  assert.equal(journalSummary.failed, 0);
  var journalEntry = f.importer().entries().filter(function (e) { return e.kind === "session-digest"; })[0];
  var journalRead = f.importer().readContent(journalEntry);
  assert.equal(journalRead.complete, true);
  assert.equal(journalRead.content, line);
  assert.equal(JSON.parse(journalRead.content).topic, "nul" + NUL + "topic", "NUL survives into the parsed record");

  // Idempotent: the same hostile source imports nothing on a second pass.
  var before = f.importer().stats().records;
  var repeat = sync(f, "hostile.md", USER);
  assert.equal(repeat.unchanged, 1);
  assert.equal(repeat.failed, 0);
  assert.equal(sync(f, "session-digests.jsonl", AGENT).unchanged, 1);
  assert.equal(f.importer().stats().records, before, "no record is appended for unchanged hostile content");
});

test("stored content always verifies against its own hash, chunked or inline", function () {
  var f = fixture("hash-invariant");
  var NUL = String.fromCharCode(0);
  write(path.join(f.knowledge, "small.md"), "inline " + NUL + " 漢字\n");
  write(path.join(f.knowledge, "session-digests.jsonl"), JSON.stringify({ date: "2026-07-02", t: NUL }) + "\n");
  var summary = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: USER });
  assert.equal(summary.failed, 0);

  var importer = f.importer();
  var entries = importer.entries({ includeChunks: true });
  assert.ok(entries.length >= 2);
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var read = importer.readContent(entry);
    assert.equal(read.complete, true, entry.importKey + " must verify");
    // The stored content hash is derived from what was written, never from a
    // fingerprint the caller supplied.
    if (!entry.chunked) {
      assert.equal(knowledgeImport.contentHash(entry.content), entry.contentHash, entry.importKey);
    }
    assert.equal(knowledgeImport.contentHash(read.content), entry.contentHash, entry.importKey);
  }

  var inline = find(importer.entries(), "file:small.md");
  assert.equal(inline.chunked, false);
  assert.equal(importer.readContent(inline).content, "inline " + NUL + " 漢字\n");

  // A corrupted inline record is caught rather than returned as complete.
  assert.equal(importer.readContent({ importKey: "x", chunked: false, content: "tampered", contentHash: "deadbeef" }).complete, false);
});

test("a missing chunk is reported, never returned as partial content", function () {
  var f = fixture("torn-chunk");
  var body = new Array(30000).join("x");
  write(path.join(f.knowledge, "big.md"), body);
  sync(f, "big.md", USER);

  var importer = f.importer();
  var entry = find(importer.entries(), "file:big.md");
  assert.equal(importer.readContent(entry).complete, true);

  // Tombstone one chunk behind the reader's back.
  importer.removeRecord(knowledgeImport.chunkKey("file:big.md", 1), { actor: { type: "system" } });
  var broken = knowledgeImport.createKnowledgeImporter({ scopeId: f.scope.scopeId, baseDir: f.baseDir });
  var read = broken.readContent(find(broken.entries(), "file:big.md"));
  assert.equal(read.complete, false);
  assert.equal(read.content, "", "no partial string is ever handed back");
  assert.equal(read.reason, "missing-chunk");
});

test("provenance is relative and carries no absolute filesystem path", function () {
  var f = fixture("provenance");
  write(path.join(f.knowledge, "notes.md"), "content\n");
  write(path.join(f.knowledge, "session-digests.jsonl"), digest("topic") + "\n");
  sync(f, "notes.md", USER);
  sync(f, "session-digests.jsonl", AGENT);

  var entries = f.importer().entries({ includeChunks: true, includeDeleted: true });
  assert.ok(entries.length >= 2);
  for (var i = 0; i < entries.length; i++) {
    var source = entries[i].source;
    if (!source) continue;
    assert.equal(source.path, undefined, "no absolute path key is persisted");
    var serialized = JSON.stringify(source);
    assert.equal(serialized.indexOf(f.home), -1, "no filesystem prefix leaks into provenance");
    assert.equal(serialized.indexOf(os.tmpdir()), -1);
  }

  var file = find(entries, "file:notes.md");
  assert.equal(file.source.relPath, "knowledge/notes.md");
  assert.equal(file.source.fileName, "notes.md");
  assert.equal(file.source.mateId, "mate_sync");
  assert.equal(file.source.namespace, "mate-knowledge");
  assert.ok(file.source.ownerKey);

  var journalEntry = f.importer().entries().filter(function (e) { return e.kind === "session-digest"; })[0];
  assert.equal(journalEntry.source.relPath, "knowledge/session-digests.jsonl");
  assert.equal(journalEntry.source.sourceDate, "2026-04-09");
  assert.equal(typeof journalEntry.source.lineIndex, "number");
});

test("identity and sticky notes are never mirrored", function () {
  var f = fixture("excluded");
  write(path.join(f.knowledge, "sticky-notes.md"), "- a note\n");
  write(path.join(f.knowledge, "base-template.md"), "# template\n");
  write(path.join(f.knowledge, "identity-backup.md"), "# identity\n");
  write(path.join(f.knowledge, "identity-history.jsonl"), JSON.stringify({ at: 1 }) + "\n");

  assert.equal(sync(f, "sticky-notes.md", USER).excluded, 1);
  assert.equal(sync(f, "base-template.md", USER).identitySkipped, 1);
  assert.equal(sync(f, "identity-backup.md", USER).identitySkipped, 1);
  assert.equal(sync(f, "identity-history.jsonl", USER).identitySkipped, 1);
  assert.equal(mateSync.sourceKindFor("sticky-notes.md"), null);

  var reconciled = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: USER });
  assert.equal(reconciled.created, 0);
  assert.equal(reconciled.excluded, 1);
  assert.equal(reconciled.identitySkipped, 3);
  assert.equal(f.importer().entries({ includeDeleted: true, includeChunks: true }).length, 0);
});

test("a file deleted while the daemon was stopped is tombstoned at startup", function () {
  var f = fixture("absent-file");
  write(path.join(f.knowledge, "keep.md"), "still here\n");
  write(path.join(f.knowledge, "gone.md"), "will be removed\n");
  write(path.join(f.knowledge, "session-digests.jsonl"), digest("a digest") + "\n");

  var first = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: AGENT });
  assert.equal(first.created, 3);
  assert.equal(f.importer().entries().length, 3);

  // Deleted by direct filesystem tooling, with no sync call for it.
  fs.unlinkSync(path.join(f.knowledge, "gone.md"));

  var restart = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: { type: "system" } });
  assert.equal(restart.deleted, 1, "the absent source is discovered from its own records");
  assert.equal(restart.unchanged, 2, "sources still on disk are untouched");
  assert.equal(restart.created, 0);

  var live = f.importer().entries();
  assert.equal(live.length, 2);
  assert.equal(find(live, "file:gone.md"), null, "no stale live record remains");
  assert.ok(find(live, "file:keep.md"));

  // History is retained, with the removal attributed.
  var tombstoned = find(f.importer().entries({ includeDeleted: true }), "file:gone.md");
  assert.equal(tombstoned.deleted, true);
  assert.equal(tombstoned.content, "will be removed\n", "the last known content is still readable");
  assert.equal(tombstoned.deletedBy.type, "system");
  assert.ok(tombstoned.revisions >= 2);

  // A second startup changes nothing.
  var before = f.importer().stats().records;
  var second = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: { type: "system" } });
  assert.equal(second.deleted, 0);
  assert.equal(second.unchanged, 2);
  assert.equal(f.importer().stats().records, before, "an idempotent restart appends nothing");
  assert.equal(f.importer().entries().length, 2);
});

test("a whole journal deleted while the daemon was stopped tombstones every line", function () {
  var f = fixture("absent-journal");
  var journal = path.join(f.knowledge, "session-digests.jsonl");
  write(journal, digest("one") + "\n" + digest("two") + "\n" + digest("three") + "\n");
  write(path.join(f.knowledge, "user-observations.jsonl"), JSON.stringify({ date: "2026-04-01", note: "keep me" }) + "\n");
  write(path.join(f.knowledge, "notes.md"), "unrelated\n");

  var first = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: AGENT });
  assert.equal(first.created, 5);

  fs.unlinkSync(journal);

  var restart = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: { type: "system" } });
  assert.equal(restart.deleted, 3, "every line of the missing journal is tombstoned");
  assert.equal(restart.unchanged, 2, "the other journal and the markdown file are untouched");

  var live = f.importer().entries();
  assert.equal(live.length, 2);
  assert.equal(live.filter(function (e) { return e.kind === "session-digest"; }).length, 0);
  assert.equal(live.filter(function (e) { return e.kind === "user-observation"; }).length, 1);
  assert.ok(find(live, "file:notes.md"));

  var withDeleted = f.importer().entries({ includeDeleted: true });
  assert.equal(withDeleted.filter(function (e) { return e.kind === "session-digest"; }).length, 3, "history is retained");

  var before = f.importer().stats().records;
  var second = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: { type: "system" } });
  assert.equal(second.deleted, 0);
  assert.equal(f.importer().stats().records, before);

  // Restoring the journal revives the lines rather than duplicating them.
  write(journal, digest("one") + "\n");
  var restored = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: AGENT });
  assert.equal(restored.revived, 1);
  assert.equal(restored.created, 0);
  assert.equal(f.importer().entries().filter(function (e) { return e.kind === "session-digest"; }).length, 1);
});

test("absent-source reconciliation ignores records from other namespaces and versions", function () {
  var f = fixture("namespaces");
  write(path.join(f.knowledge, "mine.md"), "mine\n");
  mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: AGENT });

  // Records that this module must never reconcile, all naming files that do
  // not exist on disk.
  var importer = f.importer();
  importer.importRecord({
    importKey: "logs:some-entry", kind: "decision", name: "elsewhere.md", content: "other subsystem",
    source: { namespace: "project-logs", sourceVersion: 1, relPath: "knowledge/elsewhere.md", fileName: "elsewhere.md" },
  });
  importer.importRecord({
    importKey: "file:future.md", kind: "knowledge-file", name: "future.md", content: "from a newer build",
    source: { namespace: mateSync.SOURCE_NAMESPACE, sourceVersion: mateSync.SOURCE_VERSION + 1, relPath: "knowledge/future.md", fileName: "future.md" },
  });
  importer.importRecord({
    importKey: "file:mismatched.md", kind: "knowledge-file", name: "mismatched.md", content: "inconsistent provenance",
    source: { namespace: mateSync.SOURCE_NAMESPACE, sourceVersion: mateSync.SOURCE_VERSION, relPath: "somewhere/else.md", fileName: "mismatched.md" },
  });
  importer.importRecord({
    importKey: "file:traversal.md", kind: "knowledge-file", name: "traversal.md", content: "unsafe name",
    source: { namespace: mateSync.SOURCE_NAMESPACE, sourceVersion: mateSync.SOURCE_VERSION, relPath: "knowledge/../escape.md", fileName: "../escape.md" },
  });

  assert.equal(mateSync.isMateSourceEntry(find(f.importer().entries(), "logs:some-entry")), false);
  assert.equal(mateSync.isMateSourceEntry(find(f.importer().entries(), "file:future.md")), false);
  assert.equal(mateSync.isMateSourceEntry(find(f.importer().entries(), "file:mismatched.md")), false);
  assert.equal(mateSync.isMateSourceEntry(find(f.importer().entries(), "file:traversal.md")), false);
  assert.equal(mateSync.isMateSourceEntry(find(f.importer().entries(), "file:mine.md")), true);

  var before = f.importer().entries().length;
  var restart = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: { type: "system" } });
  assert.equal(restart.deleted, 0, "foreign and future records are never tombstoned");
  assert.equal(f.importer().entries().length, before, "every foreign record is still live");
  assert.ok(find(f.importer().entries(), "logs:some-entry"));
  assert.ok(find(f.importer().entries(), "file:future.md"));
  assert.ok(find(f.importer().entries(), "file:mismatched.md"));
  assert.ok(find(f.importer().entries(), "file:traversal.md"));

  // The module's own record is still reconciled normally alongside them.
  fs.unlinkSync(path.join(f.knowledge, "mine.md"));
  var afterDelete = mateSync.reconcileMate({ mateDir: f.mateDir, baseDir: f.baseDir, actor: { type: "system" } });
  assert.equal(afterDelete.deleted, 1);
  assert.equal(find(f.importer().entries(), "file:mine.md"), null);
  assert.ok(find(f.importer().entries(), "file:future.md"), "a future-version record is still untouched");
});

test("a journal line from another namespace is not tombstoned by journal reconciliation", function () {
  var f = fixture("journal-namespace");
  var journal = path.join(f.knowledge, "session-digests.jsonl");
  write(journal, digest("mine") + "\n");
  sync(f, "session-digests.jsonl", AGENT);

  var importer = f.importer();
  importer.importRecord({
    importKey: "journal:session-digests.jsonl:foreignkey000000000000", kind: "session-digest",
    name: "session-digests.jsonl", content: "{\"foreign\":true}",
    source: { namespace: "some-other-subsystem", sourceVersion: 1, relPath: "knowledge/session-digests.jsonl", fileName: "session-digests.jsonl" },
  });

  // Emptying the journal must tombstone only this module's own line.
  fs.unlinkSync(journal);
  var summary = sync(f, "session-digests.jsonl", { type: "system" });
  assert.equal(summary.deleted, 1, "only the record this module imported is tombstoned");

  var live = f.importer().entries();
  assert.equal(live.length, 1);
  assert.equal(live[0].importKey, "journal:session-digests.jsonl:foreignkey000000000000");
});

test("sync is quiet and safe on bad input", function () {
  var f = fixture("safe");
  var absent = sync(f, "missing.md", USER);
  assert.equal(absent.deleted, 0, "a source that was never mirrored needs no tombstone");
  assert.equal(absent.absent, 1);
  assert.equal(sync(f, "notes.txt", USER).unsupported, 1);
  assert.equal(sync(f, "", USER).failed, 0);
  assert.equal(mateSync.syncMateSource({ mateDir: path.join(f.home, "not-a-mate"), fileName: "a.md" }).failed, 0);

  // A path-traversal file name is reduced to its basename before use.
  write(path.join(f.knowledge, "safe.md"), "ok\n");
  var traversal = mateSync.syncMateSource({
    mateDir: f.mateDir, fileName: "../../../etc/passwd", baseDir: f.baseDir, actor: USER,
  });
  assert.equal(traversal.created, 0);
  assert.equal(traversal.unsupported, 1);

  // A malformed journal line is counted, not fatal.
  write(path.join(f.knowledge, "session-digests.jsonl"), digest("good") + "\nnot json\n[1,2]\n");
  var summary = sync(f, "session-digests.jsonl", AGENT);
  assert.equal(summary.malformedLines, 2);
  assert.equal(summary.created, 1);
  assert.equal(summary.failed, 0);

  assert.doesNotThrow(function () { mateSync.syncQuietly({ mateDir: null, fileName: "a.md" }); });
});

test("scope derivation agrees between layouts and isolates users", function () {
  var home = tmp("scopes");
  var flat = path.join(home, "mates", "mate_x");
  var userOne = path.join(home, "mates", "user-one", "mate_x");
  fs.mkdirSync(flat, { recursive: true });
  fs.mkdirSync(userOne, { recursive: true });

  var flatScope = mateSync.scopeForMateDir(flat);
  var userScope = mateSync.scopeForMateDir(userOne);
  assert.notEqual(flatScope.scopeId, userScope.scopeId, "identical Mate ids under different roots do not collide");
  assert.equal(flatScope.mateId, "mate_x");
  assert.equal(userScope.mateId, "mate_x");

  // Derivation is a pure function of the path, so the importer and the bridge
  // always agree without sharing context.
  assert.equal(mateSync.scopeForMateDir(flat).scopeId, flatScope.scopeId);
  assert.equal(mateSync.scopeForMateDir(flat + path.sep).scopeId, flatScope.scopeId);
  assert.equal(mateSync.scopeForMateDir(path.join(home, "mates", "not-a-mate")), null);
});
