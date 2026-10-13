var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var child = require("child_process");
var Datastore = require("@seald-io/nedb");
var storageModule = require("../lib/knowledge-db-import-storage");
var serviceModule = require("../lib/knowledge-db-service");
var sequence = 0;
function op() { return "storage_" + Date.now() + "_" + (++sequence); }
function deferred() { var resolve; var promise = new Promise(function (done) { resolve = done; }); return { promise: promise, resolve: resolve }; }
function fixture(t, settings) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-db-storage-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  return { root: root, service: serviceModule.createKnowledgeDbService(Object.assign({ projectDir: root }, settings)) };
}
async function database(service, name) {
  return (await service.create({ name: name, schema: [{ id: "fld_title00", name: "Title", type: "title", required: true }, { id: "fld_notes00", name: "Notes", type: "text" }], operationId: op() })).database;
}
function rows(offset, count, narrative) {
  var out = [];
  for (var i = offset; i < offset + count; i++) { var values = { fld_title00: "Synthetic " + i }; if (narrative) values.fld_notes00 = "n".repeat(narrative); out.push({ sourceKey: String(i), sourcePayload: { original: values }, values: values }); }
  return out;
}
async function args(service, db, batch) { return { databaseId: db.id, expectedDatabaseRevision: (await service.read({ databaseId: db.id })).database.revision, sourceNamespace: "synthetic", rows: batch, operationId: op() }; }
async function seed(service, db) { for (var i = 0; i < 300; i += 100) await service.importRecords(await args(service, db, rows(i, 100, 1000))); }
function durableReplay(root, requests) {
  var script = 'var assert=require("assert/strict");var service=require(process.argv[1]).createKnowledgeDbService({projectDir:process.argv[2]});var requests=JSON.parse(process.argv[3]);(async function(){var store=await service.initialize();assert.equal(store._autocompactionIntervalId,null);assert.equal(service.listCached({}).databases.length,requests.length);for(var request of requests){var result=await service.importRecords(request);assert.equal(result.createdCount,1);assert.equal((await service.query({databaseId:request.databaseId})).totals.count,1);assert.equal((await service.readImportProgress({databaseId:request.databaseId,sourceNamespace:"synthetic"})).total,1);}process.stdout.write("durable");})().catch(function(e){console.error(e);process.exit(1);});';
  assert.equal(child.execFileSync(process.execPath, ["-e", script, path.resolve(__dirname, "../lib/knowledge-db-service.js"), root, JSON.stringify(requests)], { encoding: "utf8" }), "durable");
}

test("shared storage gate holds failed-write reload ahead of concurrent writes and reads to another database", async function (t) {
  var f = fixture(t, { projectSummary: function () {} }); var s = f.service; var a = await database(s, "A"); var b = await database(s, "B");
  // A second service facade must share exactly the same storage gate.
  var other = serviceModule.createKnowledgeDbService({ projectDir: f.root, projectSummary: function () {} });
  var entered = deferred(); var release = deferred(); var events = []; var originalUpdate = Datastore.prototype.updateAsync; var originalLoad = Datastore.prototype.loadDatabaseAsync; var fail = true;
  Datastore.prototype.updateAsync = function (query, value, options) {
    if (this.filename !== s.filename) return originalUpdate.call(this, query, value, options);
    events.push("write:" + query._id);
    if (query._id !== a.id || !fail) return originalUpdate.call(this, query, value, options);
    fail = false; var persistence = this.persistence; var originalPersist = persistence.persistNewStateAsync;
    persistence.persistNewStateAsync = async function () { entered.resolve(); await release.promise; throw new Error("injected canonical persistence failure"); };
    return originalUpdate.call(this, query, value, options).finally(function () { persistence.persistNewStateAsync = originalPersist; });
  };
  Datastore.prototype.loadDatabaseAsync = function () {
    if (this.filename !== s.filename) return originalLoad.call(this);
    events.push("reload:start"); return originalLoad.call(this).then(function (value) { events.push("reload:end"); return value; });
  };
  t.after(function () { release.resolve(); Datastore.prototype.updateAsync = originalUpdate; Datastore.prototype.loadDatabaseAsync = originalLoad; });
  var aArgs = await args(s, a, rows(0, 1)); var bArgs = await args(s, b, rows(0, 1));
  var aWrite = s.importRecords(aArgs); var aOutcome = aWrite.then(function (result) { return { result: result }; }, function (cause) { return { cause: cause }; });
  await entered.promise;
  assert.equal(s.listCached({}).databases.find(function (db) { return db.id === a.id; }).recordCount, 0);
  var bWrite = other.importRecords(bArgs); var observed = s.query({ databaseId: a.id });
  await new Promise(function (done) { setImmediate(done); }); assert.ok(!events.includes("write:" + b.id));
  release.resolve(); var results = await Promise.all([aOutcome, bWrite, observed]);
  assert.match(results[0].cause.message, /injected canonical persistence failure/); assert.equal(results[1].createdCount, 1); assert.equal(results[2].totals.count, 0);
  assert.ok(events.indexOf("reload:end") < events.indexOf("write:" + b.id));
  var retried = await s.importRecords(aArgs); assert.equal(retried.createdCount, 1); assert.equal(retried.databaseRevision, 2);
  assert.equal((await other.importRecords(bArgs)).mappings[0].recordId, results[1].mappings[0].recordId);
  assert.equal((await s.readStorageStatus()).recoveries, 1);
  Datastore.prototype.updateAsync = originalUpdate; Datastore.prototype.loadDatabaseAsync = originalLoad;
  durableReplay(f.root, [aArgs, bArgs]);
});

test("compaction failure preserves canonical successes and retries under the shared gate including projection failure", async function (t) {
  var projectionFails = false; var f = fixture(t, { projectSummary: function (summary) { if (projectionFails && summary.name === "A") throw new Error("injected summary failure"); } }); var s = f.service;
  var a = await database(s, "A"); var b = await database(s, "B"); await seed(s, a);
  var originalCompact = Datastore.prototype.compactDatafileAsync; var originalUpdate = Datastore.prototype.updateAsync; var entered = deferred(); var release = deferred(); var hold = false; var failing = true; var compacting = false; var attempts = 0;
  Datastore.prototype.compactDatafileAsync = async function () {
    if (this.filename !== s.filename) return originalCompact.call(this);
    assert.equal(compacting, false); compacting = true; attempts++;
    try { if (hold) { hold = false; entered.resolve(); await release.promise; } if (failing) throw new Error("injected compaction failure"); return await originalCompact.call(this); }
    finally { compacting = false; }
  };
  Datastore.prototype.updateAsync = function (query, value, options) { if (this.filename === s.filename) assert.equal(compacting, false); return originalUpdate.call(this, query, value, options); };
  t.after(function () { release.resolve(); Datastore.prototype.compactDatafileAsync = originalCompact; Datastore.prototype.updateAsync = originalUpdate; });
  for (var i = 0; i < 8 && !attempts; i++) await s.importRecords(await args(s, a, rows(0, 100, 1000)));
  assert.ok(attempts > 0); var failedStatus = await s.readStorageStatus(); assert.equal(failedStatus.maintenancePending, true); assert.match(failedStatus.maintenanceError, /injected compaction failure/);
  var aArgs = await args(s, a, rows(300, 1, 1000)); var bArgs = await args(s, b, rows(0, 1));
  hold = true; projectionFails = true; var aWrite = s.importRecords(aArgs); await entered.promise; var bWrite = s.importRecords(bArgs);
  await new Promise(function (done) { setImmediate(done); }); assert.equal(compacting, true); release.resolve();
  var results = await Promise.all([aWrite, bWrite]); assert.equal(results[0].createdCount, 1); assert.equal(results[0].projectionPending, true); assert.match(results[0].projectionError, /injected summary failure/); assert.equal(results[1].createdCount, 1);
  assert.equal((await s.query({ databaseId: a.id })).totals.count, 301); assert.equal((await s.query({ databaseId: b.id })).totals.count, 1);
  assert.equal((await s.importRecords(aArgs)).mappings[0].recordId, results[0].mappings[0].recordId);
  failing = false; projectionFails = false;
  var retried = await s.retryProjection({ databaseId: a.id }); assert.equal(retried.projectionPending, false);
  var status = await s.readStorageStatus(); assert.equal(status.maintenancePending, false); assert.equal(status.maintenanceError, null); assert.ok(status.compactions > 0); assert.ok(status.failedCompactions >= 2);
  assert.ok(status.journalBytes <= Math.max(storageModule.MIN_COMPACTION_BYTES, status.liveBytes * 4));
});

test("persistent compaction failure bounds further growth by rejecting before the next canonical write", async function (t) {
  var f = fixture(t); var s = f.service; var db = await database(s, "Bounded failure"); await seed(s, db);
  var originalCompact = Datastore.prototype.compactDatafileAsync;
  Datastore.prototype.compactDatafileAsync = function () { if (this.filename === s.filename) return Promise.reject(new Error("maintenance unavailable")); return originalCompact.call(this); };
  t.after(function () { Datastore.prototype.compactDatafileAsync = originalCompact; });
  var blockedArgs; var priorWrites;
  for (var i = 0; i < 20; i++) {
    var request = await args(s, db, rows(0, 100, 1000)); priorWrites = (await s.readStorageStatus()).successfulWrites;
    try { var result = await s.importRecords(request); assert.equal(result.createdCount, 0); }
    catch (cause) { assert.equal(cause.code, "STORAGE_MAINTENANCE_BLOCKED"); blockedArgs = request; break; }
  }
  assert.ok(blockedArgs); var status = await s.readStorageStatus(); assert.equal(status.successfulWrites, priorWrites); assert.equal(status.maintenancePending, true);
  assert.ok(status.journalBytes <= Math.max(storageModule.FAILURE_HEADROOM_BYTES, storageModule.FAILURE_AMPLIFICATION * status.liveBytes) + status.liveBytes);
  var previousSize = status.journalBytes;
  await assert.rejects(s.importRecords(blockedArgs), function (cause) { return cause.code === "STORAGE_MAINTENANCE_BLOCKED"; }); assert.equal((await s.readStorageStatus()).journalBytes, previousSize);
  Datastore.prototype.compactDatafileAsync = originalCompact;
  var resumed = await s.importRecords(blockedArgs); assert.equal(resumed.createdCount, 0); assert.equal((await s.query({ databaseId: db.id })).totals.count, 300); assert.equal((await s.readStorageStatus()).maintenancePending, false);
});

test("failed crash-safe compaction leaves canonical data and receipts durable despite a stale temporary file", async function (t) {
  var libraryStorage = require("@seald-io/nedb/lib/storage"); var originalRewrite = libraryStorage.crashSafeWriteFileLinesAsync;
  var f = fixture(t, { projectSummary: function () {} }); var s = f.service; var a = await database(s, "A"); var b = await database(s, "B"); await seed(s, a); var failures = 0;
  libraryStorage.crashSafeWriteFileLinesAsync = async function (filename, lines, modes) {
    if (filename !== s.filename) return originalRewrite.call(this, filename, lines, modes);
    failures++; await fs.promises.writeFile(filename + "~", lines.join("\n") + "\n"); throw new Error("injected failure before compaction rename");
  };
  t.after(function () { libraryStorage.crashSafeWriteFileLinesAsync = originalRewrite; });
  for (var i = 0; i < 8 && !failures; i++) { var replay = await s.importRecords(await args(s, a, rows(0, 100, 1000))); assert.equal(replay.createdCount, 0); }
  assert.ok(failures); assert.ok(fs.statSync(s.filename + "~").size > 0); assert.equal((await s.readStorageStatus()).maintenancePending, true);
  var bArgs = await args(s, b, rows(0, 1)); var added = await s.importRecords(bArgs); assert.equal(added.createdCount, 1);
  assert.equal((await s.importRecords(bArgs)).mappings[0].recordId, added.mappings[0].recordId);
  var backup = fs.mkdtempSync(path.join(os.tmpdir(), "clay-db-maintenance-backup-")); t.after(function () { fs.rmSync(backup, { recursive: true, force: true }); });
  fs.cpSync(path.join(f.root, "knowledge"), path.join(backup, "knowledge"), { recursive: true });
  var script = 'var assert=require("assert/strict");var service=require(process.argv[1]).createKnowledgeDbService({projectDir:process.argv[2]});var ids=JSON.parse(process.argv[3]);var request=JSON.parse(process.argv[4]);(async function(){assert.equal((await service.query({databaseId:ids[0]})).totals.count,300);assert.equal((await service.query({databaseId:ids[1]})).totals.count,1);assert.equal((await service.readImportProgress({databaseId:ids[0],sourceNamespace:"synthetic"})).total,300);assert.equal((await service.importRecords(request)).createdCount,1);assert.equal((await service.readStorageStatus()).maintenancePending,false);process.stdout.write("restored");})().catch(function(e){console.error(e);process.exit(1);});';
  assert.equal(child.execFileSync(process.execPath, ["-e", script, path.resolve(__dirname, "../lib/knowledge-db-service.js"), backup, JSON.stringify([a.id, b.id]), JSON.stringify(bArgs)], { encoding: "utf8" }), "restored");
  libraryStorage.crashSafeWriteFileLinesAsync = originalRewrite;
  await s.retryProjection({ databaseId: a.id }); assert.equal((await s.readStorageStatus()).maintenancePending, false); assert.equal(fs.existsSync(s.filename + "~"), false);
});
