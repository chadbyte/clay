var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var Datastore = require("@seald-io/nedb");
var validation = require("./knowledge-db-validation");

var MAX_HISTORY = 50;
var MAX_RECEIPTS = 500;
var MAX_PAGE = 100;
var MAX_FILTERS = 20;
var MAX_SORTS = 10;
var MAX_AGGREGATE_BYTES = 8 * 1024 * 1024;
var IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
var STORE_REGISTRY = {};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function error(message, code, currentRevision) { return Object.assign(new Error(message), { code: code || "FAILED", currentRevision: currentRevision }); }
function actor(input) { return { type: input && input.type === "system" ? "system" : "user", userId: input && input.userId || null, displayName: input && input.displayName || null }; }
function now() { return Date.now(); }
function newId(prefix) { return prefix + "_" + crypto.randomUUID(); }
function mutationId(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9-]*_\d{13}_[A-Za-z0-9_-]{1,80}$/.test(value)) throw error("Operation id must include its creation time and a unique suffix.", "INVALID_OPERATION_ID");
  var createdAt = Number(value.match(/_(\d{13})_/)[1]); var age = now() - createdAt;
  if (age > IDEMPOTENCY_WINDOW_MS) throw error("Operation id is outside the retry window.", "OPERATION_EXPIRED");
  if (age < -5 * 60 * 1000) throw error("Operation id creation time is in the future.", "INVALID_OPERATION_ID");
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  var out = {}; Object.keys(value).sort().forEach(function (key) { out[key] = canonical(value[key]); }); return out;
}
function fingerprint(label, args) { var envelope = Object.assign({}, args); delete envelope.actor; delete envelope.operationId; return crypto.createHash("sha256").update(label + ":" + JSON.stringify(canonical(envelope))).digest("hex"); }
function ensureRevision(value, current, label) {
  if (!Number.isInteger(value) || value < 1) throw error("A valid " + label + " revision is required.", "STALE", current);
  if (value !== current) throw error("This " + label + " changed since it was opened.", "STALE", current);
}
function receipt(database, operationId, expectedFingerprint) {
  var found = (database.receipts || []).filter(function (entry) { return entry.operationId === operationId; })[0];
  if (found && found.fingerprint !== expectedFingerprint) throw error("Operation id was already used with a different payload.", "IDEMPOTENCY_MISMATCH");
  return found ? clone(found.result) : null;
}
function remember(database, operationId, operationFingerprint, result) {
  var cutoff = now() - IDEMPOTENCY_WINDOW_MS;
  var active = (database.receipts || []).filter(function (entry) { return entry.at >= cutoff; });
  if (active.length >= MAX_RECEIPTS) throw error("Knowledge database retry capacity is full until an operation receipt expires.", "IDEMPOTENCY_CAPACITY");
  database.receipts = active.concat([{ operationId: operationId, fingerprint: operationFingerprint, at: now(), result: clone(result) }]);
}
function publicDatabase(database, includeRecords) {
  var out = { id: database._id, itemType: "db", name: database.name, revision: database.revision, archivedAt: database.archivedAt || null,
    createdAt: database.createdAt, updatedAt: database.updatedAt, createdBy: database.createdBy, updatedBy: database.updatedBy,
    schema: clone(database.schema), views: clone((database.views || []).filter(function (view) { return !view.archived; })), recordCount: database.records.filter(function (record) { return !record.archivedAt; }).length,
    projectionPending: database.projectionPending === true, projectionError: database.projectionError || null };
  if (includeRecords) out.records = clone(database.records);
  return out;
}
function publicRecord(record, references) { var out = clone(record); if (references && references.length) out.references = references; return out; }
function titleValue(database, record) {
  var field = database.schema.filter(function (entry) { return entry.type === "title" && !entry.archived; })[0];
  return field && record.values[field.id] || "Untitled";
}
function compareValues(a, b) {
  if (a === b) return 0; if (a === null || a === undefined) return 1; if (b === null || b === undefined) return -1;
  if (typeof a === "boolean") return a === false ? -1 : 1;
  if (typeof a === "number") return a < b ? -1 : 1;
  var left = Array.isArray(a) ? a.join("\u0000") : typeof a === "object" ? (a.id || "") : String(a);
  var right = Array.isArray(b) ? b.join("\u0000") : typeof b === "object" ? (b.id || "") : String(b);
  return left === right ? 0 : left < right ? -1 : 1;
}
function matches(record, filter) {
  var value = record.values[filter.fieldId]; var empty = value === null || value === undefined || value === "" || Array.isArray(value) && value.length === 0;
  if (filter.op === "empty") return empty; if (filter.op === "not-empty") return !empty;
  if (filter.op === "eq") return JSON.stringify(value) === JSON.stringify(filter.value);
  if (filter.op === "neq") return JSON.stringify(value) !== JSON.stringify(filter.value);
  if (filter.op === "contains") return Array.isArray(value) ? value.indexOf(filter.value) !== -1 : String(value || "").toLowerCase().indexOf(String(filter.value || "").toLowerCase()) !== -1;
  if (empty || filter.value === null || filter.value === undefined) return false;
  var comparison = compareValues(value, filter.value);
  return filter.op === "gt" ? comparison > 0 : filter.op === "gte" ? comparison >= 0 : filter.op === "lt" ? comparison < 0 : comparison <= 0;
}
function cursor(signature, offset) { return Buffer.from(JSON.stringify({ signature: signature, offset: offset }), "utf8").toString("base64url"); }
function decodeCursor(value, signature) {
  if (!value) return 0;
  try { var parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8")); if (parsed.signature !== signature || !Number.isInteger(parsed.offset) || parsed.offset < 0) throw new Error(); return parsed.offset; }
  catch (cause) { throw error("Query cursor is invalid for this query.", "INVALID_CURSOR"); }
}
function referenceStates(database, record, databases, settings) { var states = []; database.schema.forEach(function (field) { var value = record.values[field.id]; if (field.type !== "reference" || !value) return; if (value.type === "text") { var exists = typeof settings.authorizeTextReference === "function" && settings.authorizeTextReference(value.id) === true; states.push({ fieldId: field.id, type: "text", id: value.id, status: exists ? "available" : "missing" }); return; } var targetDatabase = databases.filter(function (item) { return item._id === value.databaseId; })[0]; var targetRecord = targetDatabase && targetDatabase.records.filter(function (item) { return item.id === value.id; })[0]; var status = !targetDatabase || !targetRecord ? "missing" : targetDatabase.archivedAt || targetRecord.archivedAt ? "archived" : "available"; states.push({ fieldId: field.id, type: "record", id: value.id, databaseId: value.databaseId, status: status, label: targetRecord ? titleValue(targetDatabase, targetRecord) : null }); }); return states; }
function queryRecords(database, args, databases, settings) {
  var options = args || {}; var view = null;
  if (options.viewId) { view = (database.views || []).filter(function (entry) { return entry.id === options.viewId && !entry.archived; })[0]; if (!view) throw error("Table view not found.", "NOT_FOUND"); }
  if (options.filters && (!Array.isArray(options.filters) || options.filters.length > MAX_FILTERS)) throw error("Query has too many filters.", "LIMIT");
  if (options.sorts && (!Array.isArray(options.sorts) || options.sorts.length > MAX_SORTS)) throw error("Query has too many sorts.", "LIMIT");
  var filters = options.filters ? options.filters.map(function (entry) { return validation.normalizeFilter(entry, database.schema); }) : view ? view.filters : [];
  var sorts = options.sorts ? options.sorts.map(function (entry) { return validation.normalizeSort(entry, database.schema); }) : view ? view.sorts : [];
  var signature = crypto.createHash("sha256").update(JSON.stringify({ databaseId: database._id, revision: database.revision, filters: filters, sorts: sorts, archived: options.archived === true })).digest("hex").slice(0, 20);
  var records = database.records.filter(function (record) { return options.archived === true ? !!record.archivedAt : !record.archivedAt; });
  records = records.filter(function (record) { return filters.every(function (filter) { return matches(record, filter); }); });
  records.sort(function (left, right) {
    for (var i = 0; i < sorts.length; i++) { var order = compareValues(left.values[sorts[i].fieldId], right.values[sorts[i].fieldId]); if (order) return sorts[i].direction === "desc" ? -order : order; }
    return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
  });
  var requestedLimit = options.limit === undefined ? 50 : options.limit;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_PAGE) throw error("Query limit must be an integer between 1 and " + MAX_PAGE + ".", "INVALID");
  var count = requestedLimit; var offset = decodeCursor(options.cursor, signature); var page = records.slice(offset, offset + count);
  var totals = { count: records.length, sums: {} };
  database.schema.forEach(function (field) { if (field.type !== "number" || field.archived) return; var sum = 0; var has = false; records.forEach(function (record) { if (typeof record.values[field.id] === "number") { sum += record.values[field.id]; has = true; } }); if (has) totals.sums[field.id] = sum; });
  return { databaseId: database._id, databaseRevision: database.revision, view: view ? clone(view) : null, records: page.map(function (record) { return publicRecord(record, referenceStates(database, record, databases, settings)); }), nextCursor: offset + count < records.length ? cursor(signature, offset + count) : null, totals: totals };
}

function createKnowledgeDbService(options) {
  var settings = options || {}; var projectDir = path.resolve(settings.projectDir); var projectReal = null; var knowledgeDir = path.join(projectDir, "knowledge"); var dataDir = path.join(knowledgeDir, ".clay-db"); var filename = path.join(dataDir, "databases.db");
  var aggregateLimit = Number.isInteger(settings.maxAggregateBytes) && settings.maxAggregateBytes > 1024 ? Math.min(MAX_AGGREGATE_BYTES, settings.maxAggregateBytes) : MAX_AGGREGATE_BYTES;
  var entry = STORE_REGISTRY[filename];
  if (!entry) { entry = { queues: {}, database: null, loading: null, ready: false }; STORE_REGISTRY[filename] = entry; }
  function safeDirectory(target, create) {
    var stat; try { stat = fs.lstatSync(target); } catch (cause) { if (!create || cause.code !== "ENOENT") throw cause; fs.mkdirSync(target, { recursive: true, mode: 0o700 }); stat = fs.lstatSync(target); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw error("Knowledge database path is unsafe.", "UNSAFE_PATH");
    var real = fs.realpathSync(target); if (real !== projectReal && !real.startsWith(projectReal + path.sep)) throw error("Knowledge database path escapes the Mate project.", "UNSAFE_PATH");
  }
  function open() {
    if (entry.loading) return entry.loading;
    entry.loading = Promise.resolve().then(function () { projectReal = fs.realpathSync(projectDir); safeDirectory(knowledgeDir, true); safeDirectory(dataDir, true); var stat; try { stat = fs.lstatSync(filename); } catch (cause) { if (cause.code !== "ENOENT") throw cause; }
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw error("Knowledge database file is unsafe.", "UNSAFE_PATH"); entry.database = new Datastore({ filename: filename }); return entry.database.loadDatabaseAsync(); }).then(function () { return entry.database.ensureIndexAsync({ fieldName: "_id", unique: true }); }).then(function () { entry.ready = true; return entry.database; }).catch(function (cause) { entry.database = null; entry.loading = null; entry.ready = false; throw cause; });
    return entry.loading;
  }
  function serialize(key, work) { var previous = entry.queues[key] || Promise.resolve(); var next = previous.catch(function () {}).then(work); entry.queues[key] = next.catch(function () {}); return next; }
  function load(id) { return open().then(function (store) { return store.findOneAsync({ _id: validation.id(id, "database id") }); }).then(function (found) { if (!found) throw error("Knowledge database not found.", "NOT_FOUND"); return found; }); }
  function all() { return open().then(function (store) { return store.findAsync({}); }); }
  function listCached(args) { var items = entry.database ? entry.database.getAllData() : []; return { databases: items.filter(function (item) { return args && args.archived === true ? !!item.archivedAt : !item.archivedAt; }).sort(function (a, b) { return b.updatedAt - a.updatedAt || (a._id === b._id ? 0 : a._id < b._id ? -1 : 1); }).map(function (item) { return publicDatabase(item, false); }) }; }
  function assertAggregate(next) { if (Buffer.byteLength(JSON.stringify(next), "utf8") > aggregateLimit) throw error("Knowledge database reached its storage limit.", "LIMIT"); }
  function replace(current, next) { assertAggregate(next); return entry.database.updateAsync({ _id: current._id, revision: current.revision }, next, {}).then(function (result) { if (result.numAffected !== 1) throw error("This database changed during the operation.", "STALE", current.revision); return next; }); }
  function projectionContent(value) { return JSON.stringify({ schemaVersion: 1, namespace: "knowledge-database-summary", databaseId: value._id, name: value.name, archived: !!value.archivedAt, revision: value.revision, fields: value.schema.filter(function (field) { return !field.archived; }).map(function (field) { return { id: field.id, name: field.name, type: field.type }; }), views: (value.views || []).filter(function (view) { return !view.archived; }).map(function (view) { return { id: view.id, name: view.name, type: "table" }; }), recordCount: value.records.filter(function (record) { return !record.archivedAt; }).length }); }
  function project(value, actorValue) {
    if (typeof settings.projectSummary !== "function") return Promise.resolve({ pending: false });
    return Promise.resolve().then(function () { return settings.projectSummary({ databaseId: value._id, name: value.name, revision: value.revision, archived: !!value.archivedAt, content: projectionContent(value), actor: actorValue }); }).then(function () {
      var clean = clone(value); clean.projectionPending = false; clean.projectionError = null; return entry.database.updateAsync({ _id: value._id, revision: value.revision }, clean, {}).then(function (result) { if (result.numAffected !== 1) return { pending: true, error: "A newer database revision still needs summary projection." }; return { pending: false }; });
    }).catch(function (cause) { var message = cause.message || "Knowledge database summary projection failed."; var failed = clone(value); failed.projectionPending = true; failed.projectionError = message; return entry.database.updateAsync({ _id: value._id, revision: value.revision }, failed, {}).then(function () { return { pending: true, error: message }; }, function () { return { pending: true, error: message }; }); });
  }
  function finish(value, result, actorValue) { return project(value, actorValue).then(function (projection) { return Object.assign({}, result, { projectionPending: projection.pending, projectionError: projection.error || null }); }); }
  function mutate(databaseId, args, label, fn) {
    var operationId = mutationId(args.operationId); var operationFingerprint = fingerprint(label, args); return serialize(databaseId, function () { return load(databaseId).then(function (current) {
      var duplicate = receipt(current, operationId, operationFingerprint); if (duplicate) return Object.assign({}, duplicate, { projectionPending: current.projectionPending === true, projectionError: current.projectionError || null });
      if (current.archivedAt && label !== "database") throw error("Knowledge database is archived.", "ARCHIVED", current.revision);
      var next = clone(current); var result = fn(next, current); next.projectionPending = true; next.projectionError = null; remember(next, operationId, operationFingerprint, result); return replace(current, next).then(function () { return finish(next, result, actor(args.actor)); });
    }); });
  }
  function create(args) {
    var input = args || {}; var operationId = mutationId(input.operationId); var operationFingerprint = fingerprint("create", input); return serialize("create:" + operationId, function () { return all().then(function (items) {
      var duplicate; var duplicateDatabase; items.some(function (item) { duplicate = receipt(item, operationId, operationFingerprint); if (duplicate) duplicateDatabase = item; return !!duplicate; }); if (duplicate) return Object.assign({}, duplicate, { projectionPending: duplicateDatabase.projectionPending === true, projectionError: duplicateDatabase.projectionError || null });
      var at = now(); var who = actor(input.actor); var titleId = newId("fld"); var schema = input.schema ? validation.normalizeSchema(input.schema) : validation.normalizeSchema([{ id: titleId, name: "Name", type: "title", required: true }]);
      var viewId = newId("view"); var item = { _id: newId("db"), name: validation.text(input.name, "Database name", 120, false), revision: 1, archivedAt: null, schema: schema,
        views: [{ id: viewId, name: "Table", type: "table", columns: schema.filter(function (field) { return !field.archived; }).map(function (field) { return field.id; }), filters: [], sorts: [], archived: false }], records: [], recordHistory: {}, databaseHistory: [], receipts: [], createdAt: at, updatedAt: at, createdBy: who, updatedBy: who, projectionPending: true, projectionError: null };
      var result = { database: publicDatabase(item, false) }; remember(item, operationId, operationFingerprint, result); assertAggregate(item); return open().then(function (store) { return store.insertAsync(item); }).then(function () { return finish(item, result, who); });
    }); });
  }
  function list(args) { return all().then(function (items) { return { databases: items.filter(function (item) { return args && args.archived === true ? !!item.archivedAt : !item.archivedAt; }).sort(function (a, b) { return b.updatedAt - a.updatedAt || (a._id === b._id ? 0 : a._id < b._id ? -1 : 1); }).map(function (item) { return publicDatabase(item, false); }) }; }); }
  function read(args) { return load(args.databaseId).then(function (item) { if (item.archivedAt && args.includeArchived !== true) throw error("Knowledge database is archived.", "ARCHIVED", item.revision); return { database: publicDatabase(item, false) }; }); }
  function rename(args) { return mutate(args.databaseId, args, "database", function (next, current) { ensureRevision(args.expectedRevision, current.revision, "database"); next.databaseHistory = next.databaseHistory.concat([{ revision: current.revision, at: now(), actor: actor(args.actor), action: "rename", name: current.name }]).slice(-MAX_HISTORY); next.name = validation.text(args.name, "Database name", 120, false); next.revision++; next.updatedAt = now(); next.updatedBy = actor(args.actor); return { database: publicDatabase(next, false) }; }); }
  function archive(args) { return mutate(args.databaseId, args, "database", function (next, current) { ensureRevision(args.expectedRevision, current.revision, "database"); next.archivedAt = args.recover === true ? null : now(); next.revision++; next.updatedAt = now(); next.updatedBy = actor(args.actor); next.databaseHistory = next.databaseHistory.concat([{ revision: current.revision, at: next.updatedAt, actor: next.updatedBy, action: args.recover === true ? "recover" : "archive" }]).slice(-MAX_HISTORY); return { database: publicDatabase(next, false) }; }); }
  function reconcileViews(views, schema) {
    var active = {}; var titleId = null; schema.forEach(function (field) { if (!field.archived) { active[field.id] = true; if (field.type === "title") titleId = field.id; } });
    return (views || []).map(function (view) { var clean = clone(view); clean.columns = clean.columns.filter(function (fieldId) { return active[fieldId]; }); if (!clean.columns.length && titleId) clean.columns = [titleId]; clean.filters = clean.filters.filter(function (filter) { return active[filter.fieldId]; }); clean.sorts = clean.sorts.filter(function (sort) { return active[sort.fieldId]; }); return clean; });
  }
  function updateSchema(args) { return mutate(args.databaseId, args, "schema", function (next, current) { ensureRevision(args.expectedRevision, current.revision, "database"); var schema = validation.normalizeSchema(args.schema); validation.assertCompatibleSchema(current.schema, schema, current.records); next.databaseHistory = next.databaseHistory.concat([{ revision: current.revision, at: now(), actor: actor(args.actor), action: "schema", schema: current.schema }]).slice(-MAX_HISTORY); next.schema = schema; next.views = reconcileViews(next.views, schema); next.revision++; next.updatedAt = now(); next.updatedBy = actor(args.actor); return { database: publicDatabase(next, false) }; }); }
  function saveView(args) { return mutate(args.databaseId, args, "view", function (next, current) { ensureRevision(args.expectedRevision, current.revision, "database"); var view = validation.normalizeView(args.view, current.schema); var index = next.views.findIndex(function (entry) { return entry.id === view.id; }); if (index === -1 && next.views.length >= validation.MAX_VIEWS) throw error("Database has too many views.", "LIMIT"); if (index === -1) next.views.push(view); else next.views[index] = view; next.revision++; next.updatedAt = now(); next.updatedBy = actor(args.actor); return { database: publicDatabase(next, false), view: clone(view) }; }); }
  function referenceContext(databases, current) { return { authorizeReference: function (reference) { if (reference.type === "text") return typeof settings.authorizeTextReference === "function" && settings.authorizeTextReference(reference.id) === true; var target = databases.filter(function (item) { return item._id === reference.databaseId; })[0]; return !!(target && target.records.some(function (record) { return record.id === reference.id; })); } }; }
  function createRecord(args) { return all().then(function (databases) { return mutate(args.databaseId, args, "record", function (next, current) { ensureRevision(args.expectedDatabaseRevision, current.revision, "database"); if (next.records.length >= validation.MAX_RECORDS) throw error("Database reached the record limit.", "LIMIT"); var at = now(); var who = actor(args.actor); var record = { id: newId("rec"), revision: 1, values: validation.normalizeValues(args.values || {}, current.schema, referenceContext(databases, current), null), archivedAt: null, createdAt: at, updatedAt: at, createdBy: who, updatedBy: who }; next.records.push(record); next.recordHistory[record.id] = []; next.revision++; next.updatedAt = at; next.updatedBy = who; return { databaseRevision: next.revision, record: publicRecord(record) }; }); }); }
  function updateRecord(args) { return all().then(function (databases) { return mutate(args.databaseId, args, "record", function (next, current) { var index = next.records.findIndex(function (record) { return record.id === validation.id(args.recordId, "record id"); }); if (index === -1) throw error("Knowledge database record not found.", "NOT_FOUND"); var before = next.records[index]; ensureRevision(args.expectedRevision, before.revision, "record"); if (before.archivedAt) throw error("Knowledge database record is archived.", "ARCHIVED", before.revision); next.recordHistory[before.id] = (next.recordHistory[before.id] || []).concat([{ revision: before.revision, at: now(), actor: actor(args.actor), action: "update", values: before.values }]).slice(-MAX_HISTORY); var record = clone(before); record.values = validation.normalizeValues(args.values || {}, current.schema, referenceContext(databases, current), record.values); record.revision++; record.updatedAt = now(); record.updatedBy = actor(args.actor); next.records[index] = record; next.revision++; next.updatedAt = record.updatedAt; next.updatedBy = record.updatedBy; return { databaseRevision: next.revision, record: publicRecord(record) }; }); }); }
  function archiveRecord(args) { return mutate(args.databaseId, args, "record", function (next) { var index = next.records.findIndex(function (record) { return record.id === validation.id(args.recordId, "record id"); }); if (index === -1) throw error("Knowledge database record not found.", "NOT_FOUND"); var before = next.records[index]; ensureRevision(args.expectedRevision, before.revision, "record"); next.recordHistory[before.id] = (next.recordHistory[before.id] || []).concat([{ revision: before.revision, at: now(), actor: actor(args.actor), action: args.recover === true ? "recover" : "archive", values: before.values, archivedAt: before.archivedAt }]).slice(-MAX_HISTORY); var record = clone(before); record.archivedAt = args.recover === true ? null : now(); record.revision++; record.updatedAt = now(); record.updatedBy = actor(args.actor); next.records[index] = record; next.revision++; next.updatedAt = record.updatedAt; next.updatedBy = record.updatedBy; return { databaseRevision: next.revision, record: publicRecord(record) }; }); }
  function readRecord(args) { return all().then(function (databases) { var item = databases.filter(function (entry) { return entry._id === validation.id(args.databaseId, "database id"); })[0]; if (!item) throw error("Knowledge database not found.", "NOT_FOUND"); var record = item.records.filter(function (entry) { return entry.id === validation.id(args.recordId, "record id"); })[0]; if (!record) throw error("Knowledge database record not found.", "NOT_FOUND"); return { database: publicDatabase(item, false), record: publicRecord(record, referenceStates(item, record, databases, settings)), title: titleValue(item, record), history: clone(item.recordHistory[record.id] || []) }; }); }
  function query(args) { return all().then(function (databases) { var item = databases.filter(function (entry) { return entry._id === validation.id(args.databaseId, "database id"); })[0]; if (!item) throw error("Knowledge database not found.", "NOT_FOUND"); if (item.archivedAt) throw error("Knowledge database is archived.", "ARCHIVED", item.revision); return queryRecords(item, args, databases, settings); }); }
  function retryProjection(args) { return serialize(args.databaseId, function () { return load(args.databaseId).then(function (item) { return finish(item, { database: publicDatabase(item, false) }, actor(args.actor)); }); }); }
  return { filename: filename, hasStore: function () { try { return fs.lstatSync(filename).isFile(); } catch (cause) { return false; } }, isReady: function () { return entry.ready === true; }, initialize: open, listCached: listCached, create: create, list: list, read: read, rename: rename, archive: archive, recover: function (args) { return archive(Object.assign({}, args, { recover: true })); }, updateSchema: updateSchema, saveView: saveView, createRecord: createRecord, updateRecord: updateRecord, archiveRecord: archiveRecord, recoverRecord: function (args) { return archiveRecord(Object.assign({}, args, { recover: true })); }, readRecord: readRecord, query: query, retryProjection: retryProjection };
}

module.exports = { createKnowledgeDbService: createKnowledgeDbService, MAX_HISTORY: MAX_HISTORY, MAX_PAGE: MAX_PAGE, MAX_AGGREGATE_BYTES: MAX_AGGREGATE_BYTES, IDEMPOTENCY_WINDOW_MS: IDEMPOTENCY_WINDOW_MS };
