var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var child = require("child_process");
var Datastore = require("@seald-io/nedb");
var serviceModule = require("../lib/knowledge-db-service");
var imports = require("../lib/knowledge-db-import");
var storageModule = require("../lib/knowledge-db-storage-nedb-maintenance");
var sequence = 0;
function op() { return "import_" + Date.now() + "_" + (++sequence); }
function fixture(t, options) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-import-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  return { root: root, filename: path.join(root, "knowledge", ".clay-db", "databases.db"), service: serviceModule.createKnowledgeDbService(Object.assign({ projectDir: root }, options)) };
}
function schema(extra) { return [{ id: "fld_title00", name: "Title", type: "title", required: true }].concat(extra || []); }
async function database(service, name, extra) { return (await service.create({ name: name, schema: schema(extra), operationId: op() })).database; }
function row(key, values) { return { sourceKey: String(key), sourcePayload: { key: String(key), original: values }, values: values }; }
async function request(service, db, rows, namespace) {
  var revision = (await service.read({ databaseId: db.id })).database.revision;
  return service.importRecords({ databaseId: db.id, expectedDatabaseRevision: revision, sourceNamespace: namespace || "synthetic", rows: rows, operationId: op() });
}
async function rejects(work, code) { await assert.rejects(async function () { return work(); }, function (cause) { return cause.code === code; }); }
async function scan(service, db, count) {
  var cursor = null; var ids = new Set();
  do { var page = await service.query({ databaseId: db.id, limit: 100, cursor: cursor }); assert.equal(page.totals.count, count); page.records.forEach(function (record) { assert.ok(!ids.has(record.id)); ids.add(record.id); }); cursor = page.nextCursor; } while (cursor);
  assert.equal(ids.size, count);
}
function isolated(script, args) {
  return JSON.parse(child.execFileSync(process.execPath, ["-e", script, path.resolve(__dirname, "../lib/knowledge-db-service.js")].concat(args), { encoding: "utf8", maxBuffer: 1024 * 1024 }));
}

test("production import covers vocabulary, finance relationships, exact scans and isolated restart/backup replay", async function (t) {
  var f = fixture(t, { projectSummary: function () {} }); var service = f.service; var writes = 0; var aggregateBytes = 0; var original = Datastore.prototype.updateAsync;
  Datastore.prototype.updateAsync = function (query, value, options) { if (this.filename === f.filename) { writes++; aggregateBytes = Math.max(aggregateBytes, Buffer.byteLength(JSON.stringify(value))); } return original.call(this, query, value, options); };
  t.after(function () { Datastore.prototype.updateAsync = original; });
  var vocabulary = await database(service, "Vocabulary", [{ id: "fld_notes00", name: "Definition", type: "text" }]);
  var initialWrites = writes; var start = Date.now(); var firstRows; var firstResult; var firstRequest;
  for (var offset = 0; offset < 8563; offset += 100) {
    var rows = [];
    for (var i = offset; i < Math.min(offset + 100, 8563); i++) rows.push(row(i, { fld_title00: "Synthetic word " + i, fld_notes00: "A synthetic definition with context.\n\tUsage example " + i + ": " + "meaning ".repeat(20) }));
    var revision = (await service.read({ databaseId: vocabulary.id })).database.revision;
    var args = { databaseId: vocabulary.id, expectedDatabaseRevision: revision, sourceNamespace: "vocabulary", rows: rows, operationId: op() };
    var result = await service.importRecords(args);
    assert.equal(result.createdCount, rows.length); assert.equal(result.databaseRevision, revision + 1);
    if (!offset) { firstRows = rows; firstResult = result; firstRequest = args; }
  }
  assert.equal(writes - initialWrites, 172);
  t.diagnostic("8563 vocabulary aggregate bytes: " + aggregateBytes);
  var exactReplay = await service.importRecords(firstRequest); assert.deepEqual(exactReplay.mappings, firstResult.mappings); assert.equal(exactReplay.databaseRevision, firstResult.databaseRevision); assert.equal(writes - initialWrites, 172);
  assert.equal((await service.query({ databaseId: vocabulary.id })).totals.count, 8563);
  var firstId = firstResult.mappings[0].recordId;
  await service.updateRecord({ databaseId: vocabulary.id, recordId: firstId, expectedRevision: 1, values: { fld_notes00: "Human correction\n\tkept" }, operationId: op() });
  await service.archiveRecord({ databaseId: vocabulary.id, recordId: firstResult.mappings[1].recordId, expectedRevision: 1, operationId: op() });
  var beforeReplay = writes; var replay = await request(service, vocabulary, firstRows, "vocabulary"); assert.equal(replay.createdCount, 0); assert.equal(writes, beforeReplay + 1);
  assert.equal((await service.readRecord({ databaseId: vocabulary.id, recordId: firstId })).record.values.fld_notes00, "Human correction\n\tkept");
  assert.equal((await service.query({ databaseId: vocabulary.id, archived: true })).totals.count, 1);
  await scan(service, vocabulary, 8562);
  var progress = await service.readImportProgress({ databaseId: vocabulary.id, sourceNamespace: "vocabulary", limit: 100 }); assert.equal(progress.total, 8563); assert.equal(progress.nextOffset, 100);
  var mappingCount = 0; var mappingOffset = 0;
  do { var mappings = await service.readImportProgress({ databaseId: vocabulary.id, sourceNamespace: "vocabulary", offset: mappingOffset }); mappingCount += mappings.mappings.length; mappingOffset = mappings.nextOffset; } while (mappingOffset !== null);
  assert.equal(mappingCount, 8563);
  var categories = await database(service, "Categories"); var spenders = await database(service, "Spenders");
  var category = await request(service, categories, [row("food", { fld_title00: "Food" }), row("travel", { fld_title00: "Travel" })], "categories");
  await request(service, spenders, [row("person", { fld_title00: "Synthetic person" })], "spenders");
  var finance = await database(service, "Transactions", [{ id: "fld_amount0", name: "Amount", type: "number" }, { id: "fld_category", name: "Category", type: "reference", target: "record", targetDatabaseId: categories.id }, { id: "fld_spender", name: "Spender", type: "reference", target: "record", targetDatabaseId: spenders.id }]);
  var financeRows = []; var expectedSum = 0;
  for (var j = 0; j < 537; j++) { expectedSum += j; financeRows.push(row(j, { fld_title00: "Transaction " + j, fld_amount0: j, fld_category: { type: "record", sourceNamespace: "categories", sourceKey: "food" }, fld_spender: { type: "record", sourceNamespace: "spenders", sourceKey: "person" } })); }
  var financeWrites = writes;
  for (var n = 0; n < financeRows.length; n += 100) await request(service, finance, financeRows.slice(n, n + 100), "finance");
  assert.equal(writes - financeWrites, 12); await scan(service, finance, 537);
  var totals = await service.query({ databaseId: finance.id }); assert.equal(totals.totals.sums.fld_amount0, expectedSum); assert.equal(totals.records[0].references.length, 2); assert.ok(totals.records[0].references.every(function (reference) { return reference.status === "available"; }));
  await service.archiveRecord({ databaseId: categories.id, recordId: category.mappings[0].recordId, expectedRevision: 1, operationId: op() });
  assert.equal((await service.query({ databaseId: finance.id })).records[0].references[0].status, "archived");
  var current = (await service.read({ databaseId: vocabulary.id })).database;
  var ordinary = await service.createRecord({ databaseId: current.id, expectedDatabaseRevision: current.revision, values: { fld_title00: "Normal CRUD", fld_notes00: "After import" }, operationId: op() });
  var updated = await service.updateRecord({ databaseId: current.id, recordId: ordinary.record.id, expectedRevision: 1, values: { fld_notes00: "Updated" }, operationId: op() }); assert.equal(updated.record.revision, 2);
  var storageStatus = await service.readStorageStatus();
  assert.equal(storageStatus.maintenancePending, false); assert.ok(storageStatus.compactions > 0);
  assert.ok(storageStatus.journalBytes <= Math.max(storageModule.MIN_COMPACTION_BYTES, storageStatus.liveBytes * 4));
  assert.ok(storageStatus.peakJournalBytes <= Math.max(storageModule.MIN_COMPACTION_BYTES, storageStatus.liveBytes * 4));
  var replayFile = path.join(f.root, "replay.json"); fs.writeFileSync(replayFile, JSON.stringify({ databaseId: vocabulary.id, firstId: firstId, rows: firstRows, oldOperationId: firstRequest.operationId, count: 8563 }));
  var restartScript = 'var fs = require("fs"); var assert = require("assert/strict"); var mod = require(process.argv[1]); var data = JSON.parse(fs.readFileSync(process.argv[3])); Date.now = function () { return Number(process.argv[4]); }; (async function () { var s = mod.createKnowledgeDbService({projectDir:process.argv[2]}); var db = (await s.read({databaseId:data.databaseId})).database; var result = await s.importRecords({databaseId:db.id, expectedDatabaseRevision:db.revision, operationId:"resume_"+Date.now()+"_fresh", sourceNamespace:"vocabulary", rows:data.rows}); assert.equal(result.createdCount,0); assert.equal(result.replayedCount,100); assert.equal((await s.read({databaseId:db.id})).database.revision,db.revision); var record = await s.readRecord({databaseId:db.id,recordId:data.firstId}); assert.equal(record.record.values.fld_notes00,"Human correction\\n\\tkept"); assert.equal(record.history.length,1); assert.equal((await s.query({databaseId:db.id})).totals.count,data.count); await assert.rejects(async function(){return s.importRecords({databaseId:db.id, expectedDatabaseRevision:db.revision, operationId:data.oldOperationId, sourceNamespace:"vocabulary", rows:data.rows});},function(e){return e.code==="OPERATION_EXPIRED";}); process.stdout.write(JSON.stringify({count:data.count, replayed:result.replayedCount})); })().catch(function(e){console.error(e);process.exit(1);});';
  var future = String(Date.now() + serviceModule.IDEMPOTENCY_WINDOW_MS + 10000);
  assert.equal(isolated(restartScript, [f.root, replayFile, future]).replayed, 100);
  var backup = fs.mkdtempSync(path.join(os.tmpdir(), "clay-import-backup-")); t.after(function () { fs.rmSync(backup, { recursive: true, force: true }); });
  fs.cpSync(path.join(f.root, "knowledge"), path.join(backup, "knowledge"), { recursive: true });
  assert.equal(isolated(restartScript, [backup, replayFile, future]).count, 8563);
  t.diagnostic(JSON.stringify({ rows: 8563, financeRows: 537, elapsedMs: Date.now() - start, maximumAggregateBytes: aggregateBytes, peakJournalBytes: storageStatus.peakJournalBytes, finalJournalBytes: storageStatus.journalBytes, afterRestartFileBytes: fs.statSync(f.filename).size, liveBytes: storageStatus.liveBytes, compactions: storageStatus.compactions, vocabularyCanonicalWrites: 86, vocabularyProjectionWrites: 86, financeCanonicalWrites: 6, financeProjectionWrites: 6 }));
});

test("import validates every row atomically, same-batch forward references, conflicts, revisions and archives", async function (t) {
  var f = fixture(t); var s = f.service; var db = await database(s, "References", [{ id: "fld_related", name: "Related", type: "reference", target: "record" }]);
  var rows = [row("first", { fld_title00: "First", fld_related: { type: "record", sourceNamespace: "synthetic", sourceKey: "second" } }), row("second", { fld_title00: "Second" })];
  var original = await request(s, db, rows); var detail = await s.readRecord({ databaseId: db.id, recordId: original.mappings[0].recordId }); assert.equal(detail.record.values.fld_related.id, original.mappings[1].recordId); assert.equal(detail.record.references[0].status, "available");
  var revision = (await s.read({ databaseId: db.id })).database.revision;
  await rejects(function () { return s.importRecords({ databaseId: db.id, expectedDatabaseRevision: 1, sourceNamespace: "synthetic", rows: rows, operationId: op() }); }, "STALE");
  var changed = JSON.parse(JSON.stringify(rows)); changed[0].sourcePayload.newContent = true;
  await rejects(function () { return request(s, db, changed); }, "IMPORT_SOURCE_CONFLICT");
  var changedValues = JSON.parse(JSON.stringify(rows)); changedValues[0].values.fld_title00 = "Changed";
  await rejects(function () { return request(s, db, changedValues); }, "IMPORT_SOURCE_CONFLICT");
  await rejects(function () { return request(s, db, [row("third", { fld_title00: "Third" }), row("invalid", { fld_title00: 42 })]); }, "INVALID");
  await rejects(function () { return request(s, db, [row("third", { fld_title00: "Third" }), row("missing", { fld_title00: "Missing", fld_related: { type: "record", sourceNamespace: "synthetic", sourceKey: "absent" } })]); }, "FORBIDDEN_REFERENCE");
  await rejects(function () { return request(s, db, [row("external", { fld_title00: "External", fld_related: { type: "record", databaseId: "db_outside123", id: "rec_outside1" } })]); }, "FORBIDDEN_REFERENCE");
  assert.equal((await s.read({ databaseId: db.id })).database.revision, revision); assert.equal((await s.readImportProgress({ databaseId: db.id, sourceNamespace: "synthetic" })).total, 2); assert.equal((await s.query({ databaseId: db.id })).totals.count, 2);
  var archived = await s.archiveRecord({ databaseId: db.id, recordId: original.mappings[1].recordId, expectedRevision: 1, operationId: op() });
  await request(s, db, rows); assert.ok((await s.readRecord({ databaseId: db.id, recordId: archived.record.id })).record.archivedAt);
  var recovered = await s.recoverRecord({ databaseId: db.id, recordId: archived.record.id, expectedRevision: 2, operationId: op() }); assert.equal(recovered.record.archivedAt, null); assert.equal((await s.readRecord({ databaseId: db.id, recordId: archived.record.id })).history.length, 2);
  revision = (await s.read({ databaseId: db.id })).database.revision; await s.archive({ databaseId: db.id, expectedRevision: revision, operationId: op() });
  await rejects(function () { return s.importRecords({ databaseId: db.id, expectedDatabaseRevision: revision + 1, sourceNamespace: "synthetic", rows: rows, operationId: op() }); }, "ARCHIVED");
  assert.equal((await s.readImportProgress({ databaseId: db.id, sourceNamespace: "synthetic" })).total, 2);
});

test("finite batch, byte and aggregate envelopes and multiline text validation", async function (t) {
  var f = fixture(t, { maxAggregateBytes: 8000 }); var s = f.service; var db = await database(s, "Limits", [{ id: "fld_notes00", name: "Text", type: "text" }]);
  await rejects(function () { return request(s, db, new Array(101).fill(row("one", { fld_title00: "One" }))); }, "IMPORT_BATCH_LIMIT");
  await rejects(function () { return request(s, db, []); }, "IMPORT_BATCH_LIMIT");
  var huge = row("huge", { fld_title00: "Huge" }); huge.sourcePayload = "x".repeat(imports.MAX_BATCH_BYTES);
  await rejects(function () { return request(s, db, [huge]); }, "IMPORT_BYTES_LIMIT");
  var large = row("large", { fld_title00: "Large", fld_notes00: "x".repeat(7000) });
  await assert.rejects(async function () { return request(s, db, [large]); }, function (cause) { return cause.code === "LIMIT" && /8000 byte aggregate/.test(cause.message); });
  await rejects(function () { return request(s, db, [row("nul", { fld_title00: "Nul", fld_notes00: "a\u0000b" })]); }, "INVALID");
  await rejects(function () { return request(s, db, [row("control", { fld_title00: "Control", fld_notes00: "a\u000bb" })]); }, "INVALID");
  await rejects(function () { return request(s, db, [row("title", { fld_title00: "Title\n" })]); }, "INVALID");
  var text = " \n\tNarrative\r\nEnd\t "; var result = await request(s, db, [row("text", { fld_title00: "Text", fld_notes00: text })]); assert.equal((await s.readRecord({ databaseId: db.id, recordId: result.mappings[0].recordId })).record.values.fld_notes00, text);
  await rejects(function () { return request(s, db, [row("blank", { fld_title00: " " })]); }, "INVALID");
  var bad = row("json", { fld_title00: "Bad" }); bad.sourcePayload = { number: Infinity }; await rejects(function () { return request(s, db, [bad]); }, "INVALID");
  bad.sourcePayload = {}; bad.sourcePayload.self = bad.sourcePayload; await rejects(function () { return request(s, db, [bad]); }, "INVALID");
  await rejects(function () { return s.readImportProgress({ databaseId: db.id, sourceNamespace: "synthetic", limit: 101 }); }, "INVALID");
  assert.equal((await s.query({ databaseId: db.id })).totals.count, 1);
});

test("failed NeDB persistence leaves no in-memory import mappings or receipts and can retry", async function (t) {
  var f = fixture(t); var s = f.service; var db = await database(s, "Failure"); var original = Datastore.prototype.updateAsync; var fail = true;
  Datastore.prototype.updateAsync = function (query, value, options) {
    if (this.filename !== f.filename || !fail) return original.call(this, query, value, options);
    fail = false; var persistence = this.persistence; var persist = persistence.persistNewStateAsync;
    persistence.persistNewStateAsync = async function () { throw new Error("injected disk failure"); };
    return original.call(this, query, value, options).finally(function () { persistence.persistNewStateAsync = persist; });
  };
  t.after(function () { Datastore.prototype.updateAsync = original; });
  var args = { databaseId: db.id, expectedDatabaseRevision: db.revision, sourceNamespace: "synthetic", rows: [row("one", { fld_title00: "One" })], operationId: op() };
  await assert.rejects(s.importRecords(args), /injected disk failure/);
  assert.equal((await s.read({ databaseId: db.id })).database.revision, db.revision); assert.equal((await s.readImportProgress({ databaseId: db.id, sourceNamespace: "synthetic" })).total, 0); assert.equal((await s.query({ databaseId: db.id })).totals.count, 0);
  var result = await s.importRecords(args); assert.equal(result.createdCount, 1); assert.equal((await s.importRecords(args)).mappings[0].recordId, result.mappings[0].recordId);
});

test("measured 20000 row capacity retains finite bounds and live receipt budget", async function (t) {
  var f = fixture(t, { projectSummary: function () {} }); var s = f.service; var db = await database(s, "Capacity"); var start = Date.now(); var writes = 0; var largest = 0; var original = Datastore.prototype.updateAsync;
  Datastore.prototype.updateAsync = function (query, value, options) { if (this.filename === f.filename) { writes++; largest = Math.max(largest, Buffer.byteLength(JSON.stringify(value))); } return original.call(this, query, value, options); };
  t.after(function () { Datastore.prototype.updateAsync = original; });
  for (var offset = 0; offset < 20000; offset += 100) {
    var rows = []; for (var i = offset; i < offset + 100; i++) rows.push(row(i, { fld_title00: "Synthetic entry " + i }));
    try { await request(s, db, rows); } catch (cause) { t.diagnostic(JSON.stringify({ acceptedRows: offset, largestAggregateBytes: largest, elapsedMs: Date.now() - start, nextError: cause.message })); throw cause; }
  }
  assert.equal(writes, 400); var page = await s.query({ databaseId: db.id }); assert.equal(page.totals.count, 20000);
  await rejects(function () { return request(s, db, [row("overflow", { fld_title00: "Overflow" })]); }, "LIMIT");
  var current = (await s.read({ databaseId: db.id })).database;
  await rejects(function () { return s.createRecord({ databaseId: db.id, expectedDatabaseRevision: current.revision, values: { fld_title00: "Overflow CRUD" }, operationId: op() }); }, "LIMIT");
  await s.updateRecord({ databaseId: db.id, recordId: page.records[0].id, expectedRevision: 1, values: { fld_title00: "Corrected capacity entry" }, operationId: op() });
  assert.equal((await s.readImportProgress({ databaseId: db.id, sourceNamespace: "synthetic" })).total, 20000);
  var storageStatus = await s.readStorageStatus();
  assert.equal(storageStatus.maintenancePending, false); assert.ok(storageStatus.compactions > 0);
  assert.ok(storageStatus.journalBytes <= Math.max(storageModule.MIN_COMPACTION_BYTES, storageStatus.liveBytes * 4));
  assert.ok(storageStatus.peakJournalBytes <= Math.max(storageModule.MIN_COMPACTION_BYTES, storageStatus.liveBytes * 4));
  t.diagnostic(JSON.stringify({ rows: 20000, canonicalImportWrites: 200, projectionImportWrites: 200, aggregateBytes: largest, elapsedMs: Date.now() - start, peakJournalBytes: storageStatus.peakJournalBytes, finalJournalBytes: storageStatus.journalBytes, liveBytes: storageStatus.liveBytes, compactions: storageStatus.compactions, aggregateLimitBytes: serviceModule.MAX_AGGREGATE_BYTES }));
});

test("import survives ambiguous persisted success and keeps bounded summary projection behavior", async function (t) {
  var summaries = 0; var f = fixture(t, { projectSummary: function () { summaries++; } }); var s = f.service; var db = await database(s, "Ambiguous failure"); var original = Datastore.prototype.updateAsync; var fail = true;
  Datastore.prototype.updateAsync = function (query, value, options) {
    if (this.filename !== f.filename || !fail) return original.call(this, query, value, options);
    fail = false; var persistence = this.persistence; var persist = persistence.persistNewStateAsync;
    persistence.persistNewStateAsync = async function (docs) { await persist.call(this, docs); throw new Error("injected failure after append"); };
    return original.call(this, query, value, options).finally(function () { persistence.persistNewStateAsync = persist; });
  };
  t.after(function () { Datastore.prototype.updateAsync = original; });
  var args = { databaseId: db.id, expectedDatabaseRevision: db.revision, sourceNamespace: "synthetic", rows: [row("one", { fld_title00: "One" })], operationId: op() };
  await assert.rejects(s.importRecords(args), /injected failure after append/);
  var retried = await s.importRecords(args); assert.equal(retried.createdCount, 1); assert.equal(retried.databaseRevision, db.revision + 1); assert.equal(retried.projectionPending, true);
  assert.equal((await s.query({ databaseId: db.id })).totals.count, 1); assert.equal((await s.readImportProgress({ databaseId: db.id, sourceNamespace: "synthetic" })).total, 1);
  assert.equal(summaries, 1); await s.retryProjection({ databaseId: db.id }); assert.equal(summaries, 2);
  var writes = 0; Datastore.prototype.updateAsync = function (query, value, options) { if (this.filename === f.filename) writes++; return original.call(this, query, value, options); };
  var batch = []; for (var i = 0; i < 100; i++) batch.push(row("batch-" + i, { fld_title00: "Batch " + i }));
  var added = await request(s, db, batch); assert.equal(added.createdCount, 100); assert.equal(writes, 2); assert.equal(summaries, 3); assert.equal(added.projectionPending, false);
  await request(s, db, batch); assert.equal(writes, 3); assert.equal(summaries, 3);
});

test("imports serialize revision checks, snapshot input, separate namespaces and reject operation reuse", async function (t) {
  var f = fixture(t); var s = f.service; var db = await database(s, "Concurrency");
  var args = { databaseId: db.id, expectedDatabaseRevision: 1, sourceNamespace: "first-source", rows: [row("key", { fld_title00: "Original" })], operationId: op() };
  var pending = s.importRecords(args); args.rows[0].values.fld_title00 = "Caller changed input";
  var competing = s.importRecords({ databaseId: db.id, expectedDatabaseRevision: 1, sourceNamespace: "second-source", rows: [row("key", { fld_title00: "Competing" })], operationId: op() });
  var results = await Promise.allSettled([pending, competing]); assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].reason.code, "STALE");
  var first = results[0].value; assert.equal((await s.readRecord({ databaseId: db.id, recordId: first.mappings[0].recordId })).record.values.fld_title00, "Original");
  await rejects(function () { return s.importRecords(args); }, "IDEMPOTENCY_MISMATCH");
  var replayArgs = { databaseId: db.id, expectedDatabaseRevision: 2, sourceNamespace: "first-source", rows: [row("key", { fld_title00: "Original" })], operationId: op() };
  var replay = await s.importRecords(replayArgs); assert.equal(replay.createdCount, 0); assert.equal(replay.databaseRevision, 2);
  assert.deepEqual((await s.importRecords(replayArgs)).mappings, replay.mappings);
  replayArgs.rows.push(row("extra", { fld_title00: "Extra" }));
  await rejects(function () { return s.importRecords(replayArgs); }, "IDEMPOTENCY_MISMATCH");
  var second = await request(s, db, [row("key", { fld_title00: "Other source" })], "second-source"); assert.notEqual(second.mappings[0].recordId, first.mappings[0].recordId);
  var mixed = await request(s, db, [row("key", { fld_title00: "Original" }), row("new", { fld_title00: "New" })], "first-source"); assert.equal(mixed.createdCount, 1); assert.equal(mixed.replayedCount, 1); assert.equal(mixed.mappings[0].recordId, first.mappings[0].recordId);
  await rejects(function () { return request(s, db, [row("uncommitted", { fld_title00: "Uncommitted" }), row("key", { fld_title00: "Changed source" })], "first-source"); }, "IMPORT_SOURCE_CONFLICT");
  assert.equal((await s.query({ databaseId: db.id })).totals.count, 3); assert.equal((await s.readImportProgress({ databaseId: db.id, sourceNamespace: "first-source" })).total, 2);
  await rejects(function () { return request(s, db, [row("duplicate", { fld_title00: "A" }), row("duplicate", { fld_title00: "A" })]); }, "INVALID");
  await rejects(function () { return s.create({ name: "Name\n", operationId: op() }); }, "INVALID");
});
