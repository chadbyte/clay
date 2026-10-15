var validName = require('./knowledge-file-store').validName;
// Narrow operations over the same document store used by the Knowledge workbench.
function createKnowledgeProductOperations(ctx) {
  function find(args, deleted) {
    var item = args.documentId ? ctx.files.list().concat(deleted ? ctx.files.deleted() : []).find(function (entry) { return entry.id === args.documentId; }) : null;
    if (args.documentId && !item) throw Object.assign(new Error('Knowledge document not found.'), { code: 'ENOENT' });
    var name = args.name || item && item.name;
    if (!name || item && args.name && args.name !== item.name) throw new Error('Choose one exact Knowledge document.');
    if (item && item.deleted) return item;
    var current = ctx.files.read(name);
    if (current.itemType !== 'text') throw new Error('Legacy JSONL sources are read-only.');
    return current;
  }
  function read(args) { var item = find(args); return { documentId: item.id, name: item.name, revision: item.revision, content: item.content }; }
  function saved(item, who) { return Object.assign({ documentId: item.id, name: item.name, revision: item.revision, persisted: true }, ctx.mirror(who, [item.name])); }
  function snapshot(op) {
    if (op.action === 'retry_document_sync' && op.names.some(function (name) { return !validName(name); })) throw new Error('Invalid Knowledge source name.');
    if (op.action === 'create_document') return ctx.files.list().filter(function (item) { return item.name === op.name; });
    if (op.action === 'retry_document_sync') return ctx.files.list().filter(function (item) { return op.names.indexOf(item.name) >= 0; });
    var item = find(op, op.action === 'restore_document');
    var result = { documentId: item.id, name: item.name, revision: item.revision, deleted: !!item.deleted };
    if (op.action === 'restore_document') result.version = ctx.files.readHistory(item.id, op.version);
    if (op.action === 'rename_document') result.documents = ctx.files.list();
    return result;
  }
  function mutate(op, who) {
    if (op.action === 'create_document') return saved(ctx.files.save(op.name, op.content, null), who);
    if (op.action === 'retry_document_sync') return Object.assign({ persisted: true }, ctx.mirror(who, op.names));
    var item = find(op, op.action === 'restore_document');
    if (op.action === 'update_document') return saved(ctx.files.save(item.name, op.content, op.expectedRevision), who);
    if (op.action === 'rename_document') return ctx.rename({ from: item.name, name: op.newName, documentId: item.id, expectedRevision: op.expectedRevision }, who);
    if (op.action === 'delete_document') { ctx.files.remove(item.name, op.expectedRevision); return Object.assign({ documentId: item.id, name: item.name, persisted: true, deleted: true }, ctx.mirror(who, [item.name])); }
    if (op.action === 'restore_document') return saved(ctx.files.restore(item.id, op.version, item.name, item.deleted ? null : op.expectedRevision), who);
    throw new Error('Unsupported Knowledge document operation.');
  }
  function query(op) {
    if (op.action === 'list_documents') return { documents: op.deleted ? ctx.files.deleted() : ctx.files.list() };
    if (op.action === 'read_document') return read(op);
    var item = find(op, true);
    if (op.action === 'document_history') return { documentId: item.id, name: item.name, versions: ctx.files.history(item.id) };
    if (op.action === 'read_document_version') return Object.assign({ documentId: item.id, name: item.name }, ctx.files.readHistory(item.id, op.version));
    throw new Error('Unsupported Knowledge document query.');
  }
  return { query: query, snapshot: snapshot, mutate: mutate };
}
module.exports = { createKnowledgeProductOperations: createKnowledgeProductOperations };
