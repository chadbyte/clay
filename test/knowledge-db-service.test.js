var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

function fixture(t, options) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-knowledge-db-")); var clayHome = path.join(root, "clay-home"); var projectDir = path.join(root, "mate-a"); fs.mkdirSync(projectDir, { recursive: true });
  var previous = process.env.CLAY_HOME; process.env.CLAY_HOME = clayHome;
  t.after(function () { if (previous === undefined) delete process.env.CLAY_HOME; else process.env.CLAY_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); });
  var service = require("../lib/knowledge-db-service").createKnowledgeDbService(Object.assign({ projectDir: projectDir, authorizeTextReference: function (id) { return id === "text_doc-123"; } }, options || {}));
  return { root: root, projectDir: projectDir, service: service };
}
var operationSequence = 0;
function op(prefix) { operationSequence++; return prefix + "_" + Date.now() + "_" + String(operationSequence).padStart(8, "0"); }
async function created(service, name) { return service.create({ name: name || "Cases", operationId: op("create") }); }

test("Knowledge database persists aggregate state, stable ids, history, archive, and idempotency", async function (t) {
  var f = fixture(t); var made = await created(f.service); var db = made.database; assert.match(db.id, /^db_/); assert.equal(db.schema[0].type, "title");
  var schema = db.schema.concat([{ id: "fld_number1", name: "Score", type: "number", required: false }, { id: "fld_bool001", name: "Open", type: "boolean", required: false }]);
  var changed = await f.service.updateSchema({ databaseId: db.id, expectedRevision: db.revision, schema: schema, operationId: op("schema") }); db = changed.database;
  var recordOperation = op("record1");
  var one = await f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: (function () { var value = {}; value[db.schema[0].id] = "Alpha"; value.fld_number1 = 4; value.fld_bool001 = true; return value; })(), operationId: recordOperation });
  var duplicate = await f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: (function () { var value = {}; value[db.schema[0].id] = "Alpha"; value.fld_number1 = 4; value.fld_bool001 = true; return value; })(), operationId: recordOperation });
  assert.equal(duplicate.record.id, one.record.id); assert.equal((await f.service.query({ databaseId: db.id })).totals.count, 1);
  var updated = await f.service.updateRecord({ databaseId: db.id, recordId: one.record.id, expectedRevision: one.record.revision, values: { fld_number1: 7 }, operationId: op("update") });
  assert.equal(updated.record.values[db.schema[0].id], "Alpha"); assert.equal(updated.record.values.fld_number1, 7);
  var archived = await f.service.archiveRecord({ databaseId: db.id, recordId: one.record.id, expectedRevision: updated.record.revision, operationId: op("archive") }); assert.ok(archived.record.archivedAt);
  var recovered = await f.service.recoverRecord({ databaseId: db.id, recordId: one.record.id, expectedRevision: archived.record.revision, operationId: op("recover") }); assert.equal(recovered.record.archivedAt, null);
  var reopened = require("../lib/knowledge-db-service").createKnowledgeDbService({ projectDir: f.projectDir, authorizeTextReference: function () { return false; } });
  var detail = await reopened.readRecord({ databaseId: db.id, recordId: one.record.id }); assert.equal(detail.record.values.fld_number1, 7); assert.equal(detail.history.length, 3);
  assert.equal(reopened.filename, path.join(f.projectDir, "knowledge", ".clay-db", "databases.db"));
});

test("Knowledge database rejects stale concurrent writes, invalid types, unsafe keys, and destructive schema changes", async function (t) {
  var f = fixture(t); var db = (await created(f.service)).database; var title = db.schema[0].id;
  await assert.rejects(f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: { bad: "x" }, operationId: op("unknown") }), /Unknown/);
  var schema = db.schema.concat([{ id: "fld_number1", name: "Amount", type: "number" }, { id: "fld_date0001", name: "Due", type: "date" }]); db = (await f.service.updateSchema({ databaseId: db.id, expectedRevision: db.revision, schema: schema, operationId: op("schema") })).database;
  await assert.rejects(f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: Object.assign((function () { var value = {}; value[title] = "Bad"; return value; })(), { fld_number1: Infinity }), operationId: op("infinite") }), /finite/);
  await assert.rejects(f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: Object.assign((function () { var value = {}; value[title] = "Bad date"; return value; })(), { fld_date0001: "2026-02-31" }), operationId: op("baddate") }), /Date value/);
  var unsafe = Object.create(null); unsafe["__proto__"] = "x"; await assert.rejects(f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: unsafe, operationId: op("unsafe") }), /object|unsafe/);
  var one = await f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: (function () { var value = { fld_number1: 2 }; value[title] = "One"; return value; })(), operationId: op("one") });
  var a = f.service.updateRecord({ databaseId: db.id, recordId: one.record.id, expectedRevision: 1, values: { fld_number1: 3 }, operationId: op("writea") });
  var b = f.service.updateRecord({ databaseId: db.id, recordId: one.record.id, expectedRevision: 1, values: { fld_number1: 4 }, operationId: op("writeb") });
  var results = await Promise.allSettled([a, b]); assert.equal(results.filter(function (item) { return item.status === "fulfilled"; }).length, 1); assert.equal(results.filter(function (item) { return item.status === "rejected" && item.reason.code === "STALE"; }).length, 1);
  var read = await f.service.read({ databaseId: db.id }); var destructive = read.database.schema.map(function (field) { return field.id === "fld_number1" ? Object.assign({}, field, { type: "text" }) : field; });
  await assert.rejects(f.service.updateSchema({ databaseId: db.id, expectedRevision: read.database.revision, schema: destructive, operationId: op("destroy") }), function (cause) { return cause.code === "DESTRUCTIVE_SCHEMA"; });
});

test("Knowledge database validates owner-scoped references and deterministic saved table queries", async function (t) {
  var f = fixture(t); var first = (await created(f.service)).database; var other = (await f.service.create({ name: "People", operationId: op("create2") })).database; var otherTitle = other.schema[0].id;
  var person = await f.service.createRecord({ databaseId: other.id, expectedDatabaseRevision: other.revision, values: (function () { var value = {}; value[otherTitle] = "Ada"; return value; })(), operationId: op("person") });
  var schema = first.schema.concat([{ id: "fld_score01", name: "Score", type: "number" }, { id: "fld_record1", name: "Person", type: "reference", target: "record", targetDatabaseId: other.id }, { id: "fld_textref", name: "Brief", type: "reference", target: "text" }]);
  first = (await f.service.updateSchema({ databaseId: first.id, expectedRevision: first.revision, schema: schema, operationId: op("schema2") })).database; var title = first.schema[0].id;
  async function add(label, score, operationId) { var values = { fld_score01: score, fld_record1: { type: "record", databaseId: other.id, id: person.record.id }, fld_textref: { type: "text", id: "text_doc-123" } }; values[title] = label; var current = (await f.service.read({ databaseId: first.id })).database; return f.service.createRecord({ databaseId: first.id, expectedDatabaseRevision: current.revision, values: values, operationId: operationId }); }
  await add("Low", 2, op("low")); await add("High", 9, op("high"));
  var current = (await f.service.read({ databaseId: first.id })).database; var view = { id: "view_scores1", name: "High scores", columns: [title, "fld_score01", "fld_record1"], filters: [{ fieldId: "fld_score01", op: "gte", value: 5 }], sorts: [{ fieldId: "fld_score01", direction: "desc" }] };
  await f.service.saveView({ databaseId: first.id, expectedRevision: current.revision, view: view, operationId: op("view") });
  var page = await f.service.query({ databaseId: first.id, viewId: view.id, limit: 1 }); assert.equal(page.records.length, 1); assert.equal(page.records[0].values[title], "High"); assert.equal(page.totals.count, 1); assert.equal(page.totals.sums.fld_score01, 9); assert.equal(page.nextCursor, null); assert.deepEqual(page.records[0].references.map(function (reference) { return reference.status; }), ["available", "available"]);
  var archivedPerson = await f.service.archiveRecord({ databaseId: other.id, recordId: person.record.id, expectedRevision: person.record.revision, operationId: op("archiveperson") }); assert.ok(archivedPerson.record.archivedAt); var honest = await f.service.query({ databaseId: first.id, viewId: view.id }); assert.equal(honest.records[0].references[0].status, "archived");
  current = (await f.service.read({ databaseId: first.id })).database;
  var bad = {}; bad[title] = "Leak"; bad.fld_record1 = { type: "record", databaseId: "db_outside-12345678", id: "rec_outside-12345678" };
  await assert.rejects(f.service.createRecord({ databaseId: first.id, expectedDatabaseRevision: current.revision, values: bad, operationId: op("leak") }), function (cause) { return cause.code === "FORBIDDEN_REFERENCE"; });
});

test("Knowledge database keeps canonical success visible when summary projection fails and retries it", async function (t) {
  var attempts = 0; var f = fixture(t, { projectSummary: function () { attempts++; if (attempts === 1) throw new Error("mirror offline"); } });
  var made = await created(f.service); assert.equal(made.projectionPending, true); assert.match(made.projectionError, /offline/);
  var read = await f.service.read({ databaseId: made.database.id }); assert.equal(read.database.projectionPending, true); assert.match(read.database.projectionError, /offline/);
  var retried = await f.service.retryProjection({ databaseId: made.database.id, actor: { type: "system" } }); assert.equal(retried.projectionPending, false);
  assert.equal((await f.service.read({ databaseId: made.database.id })).database.projectionPending, false);
});

test("Knowledge database rejects a symlinked metadata directory", async function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-knowledge-db-link-")); t.after(function () { fs.rmSync(root, { recursive: true, force: true }); }); var projectDir = path.join(root, "mate"); var outside = path.join(root, "outside"); fs.mkdirSync(path.join(projectDir, "knowledge"), { recursive: true }); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(projectDir, "knowledge", ".clay-db"));
  var service = require("../lib/knowledge-db-service").createKnowledgeDbService({ projectDir: projectDir }); await assert.rejects(service.list({}), function (cause) { return cause.code === "UNSAFE_PATH"; });
});

test("Knowledge database filters use operator-specific values, null range semantics, and bounded query shapes", async function (t) {
  var f = fixture(t); var db = (await created(f.service)).database; var title = db.schema[0].id;
  var schema = db.schema.concat([{ id: "fld_tags000", name: "Tags", type: "multi-select", options: [{ id: "opt_red000", name: "Red" }, { id: "opt_blue00", name: "Blue" }] }, { id: "fld_score00", name: "Score", type: "number" }]);
  db = (await f.service.updateSchema({ databaseId: db.id, expectedRevision: db.revision, schema: schema, operationId: op("filter-schema") })).database;
  var firstValues = { fld_tags000: ["opt_red000"], fld_score00: null }; firstValues[title] = "Null score"; await f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: firstValues, operationId: op("null-row") });
  db = (await f.service.read({ databaseId: db.id })).database; var secondValues = { fld_tags000: ["opt_blue00", "opt_red000"], fld_score00: 4 }; secondValues[title] = "Scored"; await f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: secondValues, operationId: op("score-row") });
  var contains = await f.service.query({ databaseId: db.id, filters: [{ fieldId: "fld_tags000", op: "contains", value: "opt_red000" }] }); assert.equal(contains.totals.count, 2);
  var range = await f.service.query({ databaseId: db.id, filters: [{ fieldId: "fld_score00", op: "lt", value: 10 }] }); assert.deepEqual(range.records.map(function (record) { return record.values[title]; }), ["Scored"]);
  await assert.rejects(f.service.query({ databaseId: db.id, limit: 1.5 }), /integer/);
  await assert.rejects(f.service.query({ databaseId: db.id, filters: new Array(21).fill({ fieldId: "fld_score00", op: "gt", value: 0 }) }), function (cause) { return cause.code === "LIMIT"; });
});

test("Knowledge database protects recoverable values and fixed reference targets during schema changes", async function (t) {
  var f = fixture(t); var source = (await created(f.service, "Source")).database; var target = (await f.service.create({ name: "Target", operationId: op("target-db") })).database; var other = (await f.service.create({ name: "Other", operationId: op("other-db") })).database;
  var personValues = {}; personValues[target.schema[0].id] = "Person"; var person = await f.service.createRecord({ databaseId: target.id, expectedDatabaseRevision: target.revision, values: personValues, operationId: op("person") });
  var schema = source.schema.concat([{ id: "fld_status0", name: "Status", type: "select", options: [{ id: "opt_open00", name: "Open" }] }, { id: "fld_owner00", name: "Owner", type: "reference", target: "record", targetDatabaseId: target.id }]);
  source = (await f.service.updateSchema({ databaseId: source.id, expectedRevision: source.revision, schema: schema, operationId: op("protected-schema") })).database; var values = { fld_status0: "opt_open00", fld_owner00: { type: "record", databaseId: target.id, id: person.record.id } }; values[source.schema[0].id] = "Case"; var row = await f.service.createRecord({ databaseId: source.id, expectedDatabaseRevision: source.revision, values: values, operationId: op("protected-row") }); await f.service.archiveRecord({ databaseId: source.id, recordId: row.record.id, expectedRevision: row.record.revision, operationId: op("protected-archive") });
  source = (await f.service.read({ databaseId: source.id })).database; var removedOption = source.schema.map(function (field) { return field.id === "fld_status0" ? Object.assign({}, field, { options: [] }) : field; }); await assert.rejects(f.service.updateSchema({ databaseId: source.id, expectedRevision: source.revision, schema: removedOption, operationId: op("remove-option") }), function (cause) { return cause.code === "DESTRUCTIVE_SCHEMA"; });
  var changedTarget = source.schema.map(function (field) { return field.id === "fld_owner00" ? Object.assign({}, field, { targetDatabaseId: other.id }) : field; }); await assert.rejects(f.service.updateSchema({ databaseId: source.id, expectedRevision: source.revision, schema: changedTarget, operationId: op("change-target") }), function (cause) { return cause.code === "DESTRUCTIVE_SCHEMA"; });
  var invalidValues = {}; invalidValues[source.schema[0].id] = "Leak"; invalidValues.fld_owner00 = { type: "record", databaseId: other.id, id: person.record.id }; await assert.rejects(f.service.createRecord({ databaseId: source.id, expectedDatabaseRevision: source.revision, values: invalidValues, operationId: op("wrong-target") }), /does not match/);
  var required = source.schema.concat([{ id: "fld_required", name: "Required", type: "text", required: true }]); await assert.rejects(f.service.updateSchema({ databaseId: source.id, expectedRevision: source.revision, schema: required, operationId: op("required-field") }), function (cause) { return cause.code === "DESTRUCTIVE_SCHEMA"; });
});

test("Knowledge database reconciles archived view fields and enforces retry identity and aggregate bounds", async function (t) {
  var f = fixture(t, { maxAggregateBytes: 8000 }); var db = (await created(f.service)).database; var textField = { id: "fld_notes00", name: "Notes", type: "text" }; db = (await f.service.updateSchema({ databaseId: db.id, expectedRevision: db.revision, schema: db.schema.concat([textField]), operationId: op("view-schema") })).database;
  var view = { id: "view_notes0", name: "Notes", type: "table", columns: [db.schema[0].id, textField.id], filters: [{ fieldId: textField.id, op: "contains", value: "x" }], sorts: [{ fieldId: textField.id, direction: "asc" }] }; db = (await f.service.saveView({ databaseId: db.id, expectedRevision: db.revision, view: view, operationId: op("notes-view") })).database;
  var archivedSchema = db.schema.map(function (field) { return field.id === textField.id ? Object.assign({}, field, { archived: true }) : field; }); db = (await f.service.updateSchema({ databaseId: db.id, expectedRevision: db.revision, schema: archivedSchema, operationId: op("archive-field") })).database; var saved = db.views.filter(function (item) { return item.id === view.id; })[0]; assert.deepEqual(saved.filters, []); assert.deepEqual(saved.sorts, []); assert.deepEqual(saved.columns, [db.schema[0].id]);
  var retry = op("same-id"); var recordValues = {}; recordValues[db.schema[0].id] = "First"; await f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: recordValues, operationId: retry }); recordValues[db.schema[0].id] = "Different"; await assert.rejects(f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: recordValues, operationId: retry }), function (cause) { return cause.code === "IDEMPOTENCY_MISMATCH"; });
  await assert.rejects(async function () { return f.service.rename({ databaseId: db.id, expectedRevision: db.revision, name: "Old", operationId: "old_" + (Date.now() - 90000000) + "_1" }); }, function (cause) { return cause.code === "OPERATION_EXPIRED"; });
  db = (await f.service.read({ databaseId: db.id })).database; var large = {}; large[db.schema[0].id] = "x".repeat(7000); await assert.rejects(f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: large, operationId: op("aggregate-limit") }), function (cause) { return cause.code === "LIMIT"; }); assert.equal((await f.service.query({ databaseId: db.id })).totals.count, 1);
});

test("Knowledge database retains every live retry receipt and fingerprints nested record fields", async function (t) {
  var actualNow = Date.now; var clock = actualNow(); Date.now = function () { return clock; }; t.after(function () { Date.now = actualNow; }); var projectionFails = true; var f = fixture(t, { projectSummary: function () { if (projectionFails) throw new Error("summary offline"); } }); var createOperation = op("durable-create");
  var made = await f.service.create({ name: "Receipts", schema: [{ id: "fld_title000", name: "Name", type: "title", required: true }, { id: "operationId", name: "Operation note", type: "text" }], operationId: createOperation }); var db = made.database; assert.equal(made.projectionPending, true);
  projectionFails = false; await f.service.retryProjection({ databaseId: db.id }); var duplicate = await f.service.create({ name: "Receipts", schema: [{ id: "fld_title000", name: "Name", type: "title", required: true }, { id: "operationId", name: "Operation note", type: "text" }], operationId: createOperation }); assert.equal(duplicate.database.id, db.id); assert.equal(duplicate.projectionPending, false);
  var values = { fld_title000: "One", operationId: "first nested value" }; var nestedOperation = op("nested-field"); var createdRecord = await f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: values, operationId: nestedOperation });
  values.operationId = "different nested value"; await assert.rejects(f.service.createRecord({ databaseId: db.id, expectedDatabaseRevision: db.revision, values: values, operationId: nestedOperation }), function (cause) { return cause.code === "IDEMPOTENCY_MISMATCH"; });
  db = (await f.service.read({ databaseId: db.id })).database; for (var i = 0; i < 498; i++) { var renamed = await f.service.rename({ databaseId: db.id, expectedRevision: db.revision, name: "Receipts " + i, operationId: op("capacity-" + i) }); db = renamed.database; }
  await assert.rejects(f.service.rename({ databaseId: db.id, expectedRevision: db.revision, name: "Over capacity", operationId: op("capacity-over") }), function (cause) { return cause.code === "IDEMPOTENCY_CAPACITY"; });
  var retriedCreate = await f.service.create({ name: "Receipts", schema: [{ id: "fld_title000", name: "Name", type: "title", required: true }, { id: "operationId", name: "Operation note", type: "text" }], operationId: createOperation }); assert.equal(retriedCreate.database.id, db.id); assert.equal((await f.service.list({})).databases.length, 1); assert.equal(createdRecord.record.values.operationId, "first nested value");
  clock += require("../lib/knowledge-db-service").IDEMPOTENCY_WINDOW_MS + 1; var afterExpiry = await f.service.rename({ databaseId: db.id, expectedRevision: db.revision, name: "Capacity reopened", operationId: op("after-expiry") }); assert.equal(afterExpiry.database.name, "Capacity reopened"); await assert.rejects(async function () { return f.service.create({ name: "Receipts", operationId: createOperation }); }, function (cause) { return cause.code === "OPERATION_EXPIRED"; });
});
