var z = require('zod');
var definitions = require('./mate-knowledge-mcp-server').getToolDefs(null, false);
var READS = { list_databases: 'list', read_database: 'read', query_database: 'query', read_database_record: 'readRecord', read_database_import_progress: 'readImportProgress' };
var WRITES = { create_database: 'create', rename_database: 'rename', archive_database: 'archive', recover_database: 'recover', update_database_schema: 'updateSchema', save_table_view: 'saveView', create_database_record: 'createRecord', update_database_record: 'updateRecord', archive_database_record: 'archiveRecord', recover_database_record: 'recoverRecord', retry_database_sync: 'retryProjection', import_database_records: 'importRecords' };
var document = { name: z.string().optional(), documentId: z.string().optional() };
function schema(action, fields) { return z.object(Object.assign({ action: z.literal(action) }, fields)).strict(); }
function databaseSchemas(names) {
  return Object.keys(names).map(function (name) {
    var fields = Object.assign({}, definitions.find(function (def) { return def.name === name; }).inputSchema);
    delete fields.operationId;
    return schema(name, fields);
  });
}
var readSchema = z.discriminatedUnion('action', [
  schema('list_documents', { deleted: z.boolean().optional() }), schema('read_document', document), schema('document_history', document),
  schema('read_document_version', Object.assign({}, document, { version: z.string() })),
].concat(databaseSchemas(READS)));
var writeSchema = z.discriminatedUnion('action', [
  schema('create_document', { name: z.string(), content: z.string() }),
  schema('update_document', Object.assign({}, document, { content: z.string(), expectedRevision: z.string() })),
  schema('rename_document', Object.assign({}, document, { newName: z.string(), expectedRevision: z.string() })),
  schema('delete_document', Object.assign({}, document, { expectedRevision: z.string() })),
  schema('restore_document', Object.assign({}, document, { version: z.string(), expectedRevision: z.string().nullable() })),
  schema('retry_document_sync', { names: z.array(z.string()).min(1).max(4) }),
].concat(databaseSchemas(WRITES)));
module.exports = { READS: READS, WRITES: WRITES, readSchema: readSchema, writeSchema: writeSchema };
