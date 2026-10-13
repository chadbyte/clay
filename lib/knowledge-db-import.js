var validation = require("./knowledge-db-validation");
var input = require("./knowledge-db-import-validation");

// importRecords({ databaseId, expectedDatabaseRevision, operationId, sourceNamespace,
// rows: [{ sourceKey, sourcePayload, values }], actor }) creates only unseen source rows.
// Both sourcePayload and supplied values are immutable import identity; corrections use CRUD.
// Record references can use sourceNamespace/sourceKey instead of id, including forward
// references within this batch. Cross-database sources must already be imported locally.
// readImportProgress({ databaseId, sourceNamespace, offset?, limit? }) returns native ids.
// Import mappings survive receipt expiry; replay with a fresh operation id and current revision.
// Limits: 100 rows / 256 KiB of row JSON per batch; shared 20000-record / 16 MiB
// aggregate bounds include archives, history, mappings and receipts (500 live / 24 hours).
// Each fresh operation retains one receipt and uses one canonical replacement; source
// replay preserves the revision. New rows also use the existing optional summary
// projection write. No filesystem input is accepted.
function attachKnowledgeDbImport(ctx) {
  function mappings(database) { return database.importMappings || []; }
  function index(database) {
    var out = new Map(); mappings(database).forEach(function (mapping) { out.set(input.identity(mapping.sourceNamespace, mapping.sourceKey), mapping); }); return out;
  }
  function convert(values, schema, databases, next, planned) {
    var fields = {}; schema.forEach(function (field) { fields[field.id] = field; });
    var out = Object.assign({}, values);
    Object.keys(out).forEach(function (fieldId) {
      var field = fields[fieldId]; var value = out[fieldId];
      if (!field || field.type !== "reference" || !value || !Object.prototype.hasOwnProperty.call(value, "sourceKey")) return;
      validation.plainObject(value, "Import reference");
      if (value.type !== "record" || value.id !== undefined) throw ctx.error("Source references require type record and no native id.", "INVALID");
      var databaseId = validation.id(value.databaseId || field.targetDatabaseId || next._id, "reference database id");
      var namespace = input.sourceText(value.sourceNamespace, "Reference source namespace", 120);
      var key = input.sourceText(value.sourceKey, "Reference source key", 200);
      var target = databases.find(function (database) { return database._id === databaseId; });
      var mapping = databaseId === next._id ? planned.get(input.identity(namespace, key)) : target && index(target).get(input.identity(namespace, key));
      if (!mapping) throw ctx.error("Reference source row is outside this Mate or has not been imported.", "FORBIDDEN_REFERENCE");
      out[fieldId] = { type: "record", databaseId: databaseId, id: mapping.recordId };
    });
    return out;
  }
  function importRecords(args) {
    // Snapshot caller-owned JSON before any asynchronous operation.
    var batch = ctx.clone(input.batch(args)); args = ctx.clone(args);
    var operationId = ctx.mutationId(args.operationId); var fingerprint = ctx.fingerprint("import", args);
    return ctx.serialize(args.databaseId, function () { return ctx.load(args.databaseId).then(async function (current) {
      var duplicate = ctx.receipt(current, operationId, fingerprint);
      if (duplicate) return Object.assign({}, duplicate, { projectionPending: current.projectionPending === true, projectionError: current.projectionError || null });
      if (current.archivedAt) throw ctx.error("Knowledge database is archived.", "ARCHIVED", current.revision);
      ctx.ensureRevision(args.expectedDatabaseRevision, current.revision, "database");
      var next = ctx.clone(current); var planned = index(current); var added = [];
      var resultMappings = batch.rows.map(function (row) {
        var identity = input.identity(batch.sourceNamespace, row.sourceKey); var existing = planned.get(identity);
        if (existing && existing.fingerprint !== row.fingerprint) throw ctx.error("Source row was already imported with a different payload: " + row.sourceKey, "IMPORT_SOURCE_CONFLICT");
        if (existing) return Object.assign({}, existing, { created: false });
        var mapping = { sourceNamespace: batch.sourceNamespace, sourceKey: row.sourceKey, fingerprint: row.fingerprint, recordId: ctx.newId("rec") };
        planned.set(identity, mapping); added.push({ row: row, mapping: mapping });
        return Object.assign({}, mapping, { created: true });
      });
      if (next.records.length + added.length > validation.MAX_RECORDS) throw ctx.error("Database exceeds the " + validation.MAX_RECORDS + " record limit (including archived records).", "LIMIT");
      var result = { databaseId: current._id, databaseRevision: current.revision, sourceNamespace: batch.sourceNamespace, createdCount: added.length, replayedCount: batch.rows.length - added.length, mappings: resultMappings };
      // Remember fresh replay operations too, so reusing an operation id with another
      // payload still conflicts. Preserve record values, archives and database revision.
      if (!added.length) {
        ctx.remember(next, operationId, fingerprint, result);
        await ctx.replace(current, next);
        return Object.assign(result, { projectionPending: current.projectionPending === true, projectionError: current.projectionError || null });
      }
      var databases = await ctx.all(); var at = Date.now(); var who = ctx.actor(args.actor);
      added.forEach(function (item) {
        next.records.push({ id: item.mapping.recordId, revision: 1, values: {}, archivedAt: null, createdAt: at, updatedAt: at, createdBy: who, updatedBy: who });
        next.recordHistory[item.mapping.recordId] = [];
      });
      var localDatabases = databases.filter(function (database) { return database._id !== next._id; }).concat([next]);
      var context = ctx.referenceContext(localDatabases, next);
      added.forEach(function (item, position) {
        var values = convert(item.row.values, current.schema, databases, next, planned);
        next.records[current.records.length + position].values = validation.normalizeValues(values, current.schema, context, null);
      });
      next.importMappings = mappings(next).concat(added.map(function (item) { return item.mapping; }));
      next.revision++; next.updatedAt = at; next.updatedBy = who; next.projectionPending = true; next.projectionError = null;
      result.databaseRevision = next.revision;
      ctx.remember(next, operationId, fingerprint, result);
      await ctx.replace(current, next);
      return ctx.finish(next, result, who);
    }); });
  }
  function readImportProgress(args) {
    var namespace = input.sourceText(args.sourceNamespace, "Source namespace", 120);
    var offset = args.offset === undefined ? 0 : args.offset; var limit = args.limit === undefined ? 100 : args.limit;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw ctx.error("Import progress requires a nonnegative integer offset and limit between 1 and 100.", "INVALID");
    return ctx.load(args.databaseId).then(function (database) {
      var rows = mappings(database).filter(function (mapping) { return mapping.sourceNamespace === namespace; });
      rows.sort(function (a, b) { return a.sourceKey === b.sourceKey ? 0 : a.sourceKey < b.sourceKey ? -1 : 1; });
      return { databaseId: database._id, databaseRevision: database.revision, sourceNamespace: namespace, total: rows.length, mappings: ctx.clone(rows.slice(offset, offset + limit)), nextOffset: offset + limit < rows.length ? offset + limit : null };
    });
  }
  return { importRecords: importRecords, readImportProgress: readImportProgress };
}

module.exports = { attachKnowledgeDbImport: attachKnowledgeDbImport, MAX_BATCH_ROWS: input.MAX_BATCH_ROWS, MAX_BATCH_BYTES: input.MAX_BATCH_BYTES };
