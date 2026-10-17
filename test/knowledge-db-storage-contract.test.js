var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var child = require("child_process");
var createService = require("../lib/knowledge-db-service").createKnowledgeDbService;
var factory = require("../lib/knowledge-db-storage");
var createMemoryStorage = require("./fixtures/knowledge-db-memory-adapter.cjs").createMemoryStorage;
var sequence = 0;
function op() { return "contract_" + Date.now() + "_" + (++sequence); }
function fixture(t, engine) {
  if (engine === "memory") {
    var state = { values: new Map(), scopes: new Map(), ready: false };
    return { adapter: createMemoryStorage(state), other: createMemoryStorage(state) };
  }
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-adapter-contract-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var create = require("../lib/knowledge-db-storage-nedb").createKnowledgeDbNedbStorage;
  return { adapter: create({ projectDir: root }), other: create({ projectDir: root }) };
}
function schema(extra) { return [{ id: "fld_title00", name: "Title", type: "title", required: true }].concat(extra || []); }
async function db(service, name, extra) { return (await service.create({ name: name, schema: schema(extra), operationId: op() })).database; }
async function rejection(work, code) { await assert.rejects(async function () { return work(); }, function (cause) { return cause.code === code; }); }

["memory", "nedb"].forEach(function (engine) {
  test(engine + " adapter contract: detached snapshots, unique insertion, atomic revision CAS and shared callback scopes", async function (t) {
    var f = fixture(t, engine); var a = f.adapter; var b = f.other;
    assert.equal(a.isReady(), false); assert.equal(a.hasStore(), false); assert.deepEqual(a.getCached(), []);
    assert.equal(await a.initialize(), undefined); assert.equal(a.isReady(), true); assert.equal(a.hasStore(), true); assert.equal(await a.get("absent"), null);
    var value = { _id: "db_contract0", revision: 1, nested: { text: "Original" } };
    var insertion = a.insert(value); value.nested.text = "Caller mutation"; assert.equal(await insertion, undefined);
    assert.equal((await b.get(value._id)).nested.text, "Original");
    var read = await a.get(value._id); read.nested.text = "Read mutation";
    var listed = await b.list(); listed[0].nested.text = "List mutation";
    var cached = a.getCached(); cached[0].nested.text = "Cache mutation";
    assert.equal((await a.get(value._id)).nested.text, "Original");
    await rejection(function () { return b.insert(value); }, "ALREADY_EXISTS");
    assert.equal(await a.replaceIfRevision("absent", 1, { _id: "absent", revision: 2 }), false);
    await rejection(function () { return a.replaceIfRevision(value._id, 1, { _id: "another", revision: 2 }); }, "INVALID_STORAGE_ID");
    var outcomes = await Promise.all([a.replaceIfRevision(value._id, 1, { _id: value._id, revision: 2, nested: { text: "Winner A" } }), b.replaceIfRevision(value._id, 1, { _id: value._id, revision: 2, nested: { text: "Winner B" } })]);
    assert.equal(outcomes.filter(function (result) { return result; }).length, 1); assert.equal((await a.get(value._id)).revision, 2);
    var current = await a.get(value._id); current.status = "same revision status";
    assert.equal(await a.replaceIfRevision(value._id, 2, current), true); assert.equal((await b.get(value._id)).status, "same revision status");
    var enter; var release; var entered = new Promise(function (done) { enter = done; }); var barrier = new Promise(function (done) { release = done; }); var events = [];
    var first = a.serialize("shared", async function () { assert.equal(arguments.length, 0); enter(); await barrier; events.push("first"); var item = await a.get(value._id); item.status = "serialized"; await a.replaceIfRevision(item._id, item.revision, item); return "first result"; });
    await entered; var second = b.serialize("shared", async function () { events.push("second"); assert.equal((await b.get(value._id)).status, "serialized"); return "second result"; });
    assert.equal(await b.serialize("different", function () { return "different scope"; }), "different scope");
    assert.deepEqual(events, []); release(); assert.deepEqual(await Promise.all([first, second]), ["first result", "second result"]); assert.deepEqual(events, ["first", "second"]);
  });

  test(engine + " injected adapter runs domain CRUD, queries, schema, references, import replay, archive and projection", async function (t) {
    var actualNow = Date.now; var clock = actualNow(); Date.now = function () { return clock; }; t.after(function () { Date.now = actualNow; });
    var f = fixture(t, engine); var failProjection = false; var summaries = [];
    var service = createService({ storageAdapter: f.adapter, authorizeTextReference: function (id) { return id === "text_allowed1"; }, projectSummary: function (summary) { summaries.push(summary); if (failProjection) throw new Error("synthetic summary outage"); } });
    var other = createService({ storageAdapter: f.other, authorizeTextReference: function (id) { return id === "text_allowed1"; } });
    assert.equal(await service.initialize(), undefined); assert.equal(service.filename, undefined);
    var people = await db(service, "People"); var person = await service.createRecord({ databaseId: people.id, expectedDatabaseRevision: 1, values: { fld_title00: "Ada" }, operationId: op() });
    var cases = await db(service, "Cases", [{ id: "fld_notes00", name: "Notes", type: "text" }, { id: "fld_amount0", name: "Amount", type: "number" }, { id: "fld_parent0", name: "Parent", type: "reference", target: "record" }, { id: "fld_person0", name: "Person", type: "reference", target: "record", targetDatabaseId: people.id }, { id: "fld_textref", name: "Brief", type: "reference", target: "text" }]);
    var rows = [{ sourceKey: "one", sourcePayload: { original: "one" }, values: { fld_title00: "One", fld_notes00: "Original\n\ttext", fld_amount0: 5, fld_parent0: { type: "record", sourceNamespace: "source", sourceKey: "two" }, fld_person0: { type: "record", id: person.record.id, databaseId: people.id }, fld_textref: { type: "text", id: "text_allowed1" } } }, { sourceKey: "two", sourcePayload: { original: "two" }, values: { fld_title00: "Two", fld_amount0: 3 } }];
    var importArgs = { databaseId: cases.id, expectedDatabaseRevision: 1, operationId: op(), sourceNamespace: "source", rows: rows };
    var imported = await service.importRecords(importArgs); assert.equal(imported.createdCount, 2); assert.equal(imported.databaseRevision, 2);
    var firstId = imported.mappings[0].recordId; var secondId = imported.mappings[1].recordId;
    assert.equal((await service.readRecord({ databaseId: cases.id, recordId: firstId })).record.values.fld_parent0.id, secondId);
    var corrected = await service.updateRecord({ databaseId: cases.id, recordId: firstId, expectedRevision: 1, values: { fld_notes00: "Human\n\tcorrection" }, operationId: op() }); assert.equal(corrected.record.revision, 2);
    var exact = await other.importRecords(importArgs); assert.equal(exact.createdCount, 2); assert.equal(exact.mappings[0].recordId, firstId);
    var fresh = await service.importRecords(Object.assign({}, importArgs, { operationId: op(), expectedDatabaseRevision: 3 })); assert.equal(fresh.createdCount, 0); assert.equal(fresh.databaseRevision, 3);
    assert.equal((await service.readRecord({ databaseId: cases.id, recordId: firstId })).record.values.fld_notes00, "Human\n\tcorrection");
    var progress = await service.readImportProgress({ databaseId: cases.id, sourceNamespace: "source", limit: 1 }); assert.equal(progress.total, 2); assert.equal(progress.mappings[0].recordId, firstId); assert.equal(progress.nextOffset, 1);
    var changed = JSON.parse(JSON.stringify(rows)); changed[1].sourcePayload.original = "changed";
    await rejection(function () { return service.importRecords(Object.assign({}, importArgs, { operationId: op(), expectedDatabaseRevision: 3, rows: changed })); }, "IMPORT_SOURCE_CONFLICT");
    await rejection(function () { return service.importRecords(Object.assign({}, importArgs, { rows: changed })); }, "IDEMPOTENCY_MISMATCH");
    await rejection(function () { return service.importRecords(Object.assign({}, importArgs, { operationId: op(), expectedDatabaseRevision: 2 })); }, "STALE");
    await rejection(function () { return service.importRecords(Object.assign({}, importArgs, { operationId: op(), expectedDatabaseRevision: 3, rows: [{ sourceKey: "new", sourcePayload: {}, values: { fld_title00: "New" } }, { sourceKey: "bad", sourcePayload: {}, values: { fld_title00: 3 } }] })); }, "INVALID");
    await rejection(function () { return service.importRecords(Object.assign({}, importArgs, { operationId: op(), expectedDatabaseRevision: 3, rows: [{ sourceKey: "outside", sourcePayload: {}, values: { fld_title00: "Outside", fld_parent0: { type: "record", databaseId: "db_outside0", id: "rec_outside" } } }] })); }, "FORBIDDEN_REFERENCE");
    assert.equal((await service.query({ databaseId: cases.id })).totals.count, 2); assert.equal((await service.read({ databaseId: cases.id })).database.revision, 3);
    var archive = await service.archiveRecord({ databaseId: cases.id, recordId: secondId, expectedRevision: 1, operationId: op() }); assert.ok(archive.record.archivedAt);
    assert.equal((await service.query({ databaseId: cases.id })).records[0].references[0].status, "archived"); assert.equal((await service.query({ databaseId: cases.id, archived: true })).totals.count, 1);
    await service.recoverRecord({ databaseId: cases.id, recordId: secondId, expectedRevision: 2, operationId: op() }); assert.equal((await service.readRecord({ databaseId: cases.id, recordId: secondId })).history.length, 2);
    var revision = (await service.read({ databaseId: cases.id })).database.revision;
    var renamed = await service.rename({ databaseId: cases.id, expectedRevision: revision, name: "Renamed", operationId: op() }); assert.equal(renamed.database.name, "Renamed");
    var normal = await service.createRecord({ databaseId: cases.id, expectedDatabaseRevision: renamed.database.revision, values: { fld_title00: "Normal", fld_amount0: 12 }, operationId: op() }); assert.equal(normal.record.revision, 1);
    revision = (await service.read({ databaseId: cases.id })).database.revision;
    var view = { id: "view_amount0", name: "Amounts", columns: ["fld_title00", "fld_amount0"], filters: [{ fieldId: "fld_amount0", op: "gt", value: 4 }], sorts: [{ fieldId: "fld_amount0", direction: "desc" }] };
    var viewed = await service.saveView({ databaseId: cases.id, expectedRevision: revision, view: view, operationId: op() });
    var page = await service.query({ databaseId: cases.id, viewId: view.id, limit: 1 }); assert.equal(page.totals.count, 2); assert.equal(page.totals.sums.fld_amount0, 17); assert.equal(page.records[0].id, normal.record.id);
    var nextPage = await service.query({ databaseId: cases.id, viewId: view.id, limit: 1, cursor: page.nextCursor }); assert.equal(nextPage.records[0].id, firstId); assert.equal(nextPage.nextCursor, null);
    await rejection(function () { return service.updateSchema({ databaseId: cases.id, expectedRevision: viewed.database.revision, schema: viewed.database.schema.map(function (field) { return field.id === "fld_amount0" ? Object.assign({}, field, { type: "text" }) : field; }), operationId: op() }); }, "DESTRUCTIVE_SCHEMA");
    var schemaChanged = await service.updateSchema({ databaseId: cases.id, expectedRevision: viewed.database.revision, schema: viewed.database.schema.concat([{ id: "fld_extra00", name: "Extra", type: "boolean" }]), operationId: op() }); assert.equal(schemaChanged.database.schema.length, cases.schema.length + 1);
    var competing = await Promise.allSettled([service.updateRecord({ databaseId: cases.id, recordId: firstId, expectedRevision: 2, values: { fld_extra00: true }, operationId: op() }), other.updateRecord({ databaseId: cases.id, recordId: firstId, expectedRevision: 2, values: { fld_extra00: false }, operationId: op() })]);
    assert.equal(competing.filter(function (result) { return result.status === "fulfilled"; }).length, 1); assert.equal(competing.filter(function (result) { return result.status === "rejected" && result.reason.code === "STALE"; }).length, 1);
    failProjection = true; var projected = await service.updateRecord({ databaseId: cases.id, recordId: firstId, expectedRevision: 3, values: { fld_notes00: "Canonical despite outage" }, operationId: op() }); assert.equal(projected.projectionPending, true); assert.match(projected.projectionError, /outage/);
    assert.equal((await service.readRecord({ databaseId: cases.id, recordId: firstId })).record.values.fld_notes00, "Canonical despite outage");
    failProjection = false; assert.equal((await service.retryProjection({ databaseId: cases.id })).projectionPending, false); assert.ok(summaries.length > 0);
    revision = (await service.read({ databaseId: cases.id })).database.revision; await service.archive({ databaseId: cases.id, expectedRevision: revision, operationId: op() });
    await rejection(function () { return service.query({ databaseId: cases.id }); }, "ARCHIVED"); assert.equal((await service.readImportProgress({ databaseId: cases.id, sourceNamespace: "source" })).total, 2);
    var archived = (await service.list({ archived: true })).databases[0]; assert.equal(archived.id, cases.id); await service.recover({ databaseId: cases.id, expectedRevision: archived.revision, operationId: op() });
    assert.equal(service.listCached({}).databases.length, 2);
    clock += require("../lib/knowledge-db-service").IDEMPOTENCY_WINDOW_MS + 1;
    await rejection(function () { return service.importRecords(importArgs); }, "OPERATION_EXPIRED");
    var recoveredRevision = (await service.read({ databaseId: cases.id })).database.revision;
    var resumed = await service.importRecords(Object.assign({}, importArgs, { operationId: op(), expectedDatabaseRevision: recoveredRevision }));
    assert.equal(resumed.createdCount, 0); assert.equal(resumed.databaseRevision, recoveredRevision); assert.equal(resumed.mappings[0].recordId, firstId);
    assert.equal((await service.readRecord({ databaseId: cases.id, recordId: firstId })).record.values.fld_notes00, "Canonical despite outage");
  });
});

test("adapter validation rejects invalid injection and native-shaped CAS results clearly", async function () {
  assert.throws(function () { createService({ storageAdapter: {} }); }, function (cause) { return cause.code === "INVALID_STORAGE_ADAPTER" && /contractVersion/.test(cause.message); });
  assert.throws(function () { createService({ storageAdapter: { contractVersion: 1 } }); }, /initialize must be a function/);
  assert.throws(function () { createService({ storageFactory: 1 }); }, /storageFactory must be a synchronous function/);
  assert.throws(function () { createService({ storageFactory: function () { return Promise.resolve(createMemoryStorage()); } }); }, /contractVersion/);
  var bad = createMemoryStorage(); bad.diagnostics = true; assert.throws(function () { createService({ storageAdapter: bad }); }, /diagnostics must be a function/);
  var adapter = createMemoryStorage(); var s = createService({ storageAdapter: adapter }); var made = await db(s, "Bad CAS"); adapter.replaceIfRevision = function () { return Promise.resolve({ numAffected: 1 }); };
  await rejection(function () { return s.rename({ databaseId: made.id, expectedRevision: 1, name: "Invalid", operationId: op() }); }, "INVALID_STORAGE_ADAPTER");
  var nonAsync = createMemoryStorage(); nonAsync.get = function () { return null; }; await rejection(function () { return createService({ storageAdapter: nonAsync }).read({ databaseId: "db_missing0" }); }, "INVALID_STORAGE_ADAPTER");
  var wrongIdentity = createMemoryStorage(); wrongIdentity.get = function () { return Promise.resolve({ _id: "db_other000", revision: 1 }); }; await rejection(function () { return createService({ storageAdapter: wrongIdentity }).read({ databaseId: "db_missing0" }); }, "INVALID_STORAGE_ADAPTER");
  var wrongList = createMemoryStorage(); wrongList.list = function () { return Promise.resolve({}); }; await rejection(function () { return createService({ storageAdapter: wrongList }).list({}); }, "INVALID_STORAGE_ADAPTER");
});

test("factory injection and central production default seam retain application aggregate limits", async function () {
  var options; var adapter = createMemoryStorage();
  var service = createService({ projectDir: "logical-scope", storageFactory: function (input) { options = input; return adapter; }, maxAggregateBytes: 4000 });
  assert.deepEqual(options, { projectDir: "logical-scope" }); var made = await db(service, "Bounded");
  await rejection(function () { return service.createRecord({ databaseId: made.id, expectedDatabaseRevision: 1, values: { fld_title00: "x".repeat(3900) }, operationId: op() }); }, "LIMIT"); assert.equal((await service.query({ databaseId: made.id })).totals.count, 0);
  var originalFactory = factory.createDefaultKnowledgeDbStorage;
  try { factory.createDefaultKnowledgeDbStorage = function () { return createMemoryStorage(); }; var selected = createService({}); assert.equal((await db(selected, "Central seam")).name, "Central seam"); assert.equal(await selected.readStorageStatus(), null); }
  finally { factory.createDefaultKnowledgeDbStorage = originalFactory; }
});

test("alternate adapter imports and executes the domain module without loading NeDB or its adapter", function () {
  var script = 'var assert=require("assert/strict");var Module=require("module");var original=Module._load;Module._load=function(name,parent,main){if(name.indexOf("nedb")!==-1)throw new Error("NeDB dependency was loaded");return original.call(this,name,parent,main);};var create=require(process.argv[1]).createKnowledgeDbService;var memory=require(process.argv[2]).createMemoryStorage;var s=create({storageAdapter:memory()});(async function(){assert.equal(await s.initialize(),undefined);var db=(await s.create({name:"Independent",operationId:"create_"+Date.now()+"_one",schema:[{id:"fld_title00",name:"Title",type:"title",required:true}]})).database;var imported=await s.importRecords({databaseId:db.id,expectedDatabaseRevision:1,operationId:"import_"+Date.now()+"_one",sourceNamespace:"independent",rows:[{sourceKey:"one",sourcePayload:{original:true},values:{fld_title00:"One"}}]});assert.equal(imported.createdCount,1);assert.equal((await s.query({databaseId:db.id})).totals.count,1);assert.equal(await s.readStorageStatus(),null);process.stdout.write("independent");})().catch(function(e){console.error(e);process.exit(1);});';
  assert.equal(child.execFileSync(process.execPath, ["-e", script, path.resolve(__dirname, "../lib/knowledge-db-service.js"), path.resolve(__dirname, "fixtures/knowledge-db-memory-adapter.cjs")], { encoding: "utf8" }), "independent");
});
