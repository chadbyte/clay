var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
async function run(f) {
  var count = 0, counter = 0;
  var mate = f.mates.createMate(f.mateCtx, {}), project = f.make('mate-' + mate.id, mate), databaseService = project.getKnowledgeDbService();
  async function read(op, id) { return f.call('read_mate_knowledge_control', { mateId: id || mate.id, operation: op }); }
  async function propose(op, id) {
    var inspected = await f.call('inspect_mate_knowledge_change', { mateId: id || mate.id, operation: op });
    if (!inspected.targetToken) return { promise: Promise.resolve(inspected) };
    var args = { targetToken: inspected.targetToken, requestId: 'knowledge_' + Date.now() + '_' + (++counter), why: 'Apply this exact fixture owner request' };
    var promise = f.call('control_mate_knowledge', args); await tick();
    var ids = Object.keys(f.sourceSession.pendingAskUser || {});
    return { args: args, promise: promise, id: ids[ids.length - 1] };
  }
  async function apply(op) { var p = await propose(op); if (p.id) { assert.equal(f.answer(p), true); } return p.promise; }
  async function success(op) { var result = await apply(op); assert.equal(result.status, 'completed', JSON.stringify(result)); count++; return result.result; }
  function cancel(p) { f.sourceSession.pendingAskUser[p.id].respond.cancel('Stale fixture review'); }
  var result = await success({ action: 'create_document', name: 'guide.md', content: '# Guide\nInitial content' });
  var doc = await read({ action: 'read_document', documentId: result.documentId }); assert.equal(doc.content, '# Guide\nInitial content'); count++;
  assert.ok((await read({ action: 'list_documents' })).documents.some(function (item) { return item.name === 'guide.md'; })); count++;
  var p = await propose({ action: 'update_document', documentId: doc.documentId, expectedRevision: doc.revision, content: '# Guide\nReviewed content' });
  assert.equal((await read({ action: 'read_document', name: 'guide.md' })).content, doc.content);
  assert.equal(f.answer(p, { readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: f.sourceSession.localId }), false);
  f.answer(p); result = await p.promise; assert.equal(result.status, 'completed'); count++;
  assert.equal(f.answer(p), false); assert.deepEqual(await f.call('control_mate_knowledge', p.args), result); count++;
  assert.equal((await f.call('control_mate_knowledge', Object.assign({}, p.args, { why: 'Different intent' }))).status, 'failed'); count++;
  doc = await read({ action: 'read_document', name: 'guide.md' });
  var history = await read({ action: 'document_history', documentId: doc.documentId }); assert.ok(history.versions.length); count++;
  var version = history.versions[0].version; assert.equal((await read({ action: 'read_document_version', documentId: doc.documentId, version: version })).content, '# Guide\nInitial content'); count++;
  await success({ action: 'restore_document', documentId: doc.documentId, version: version, expectedRevision: doc.revision });
  await success({ action: 'create_document', name: 'backlink.md', content: '[Guide](guide.md)' });
  doc = await read({ action: 'read_document', name: 'guide.md' });
  await success({ action: 'rename_document', documentId: doc.documentId, expectedRevision: doc.revision, newName: 'renamed.md' });
  assert.match((await read({ action: 'read_document', name: 'backlink.md' })).content, /renamed.md/); count++;
  doc = await read({ action: 'read_document', name: 'renamed.md' });
  await success({ action: 'delete_document', documentId: doc.documentId, expectedRevision: doc.revision });
  assert.ok((await read({ action: 'list_documents', deleted: true })).documents.some(function (item) { return item.id === doc.documentId; })); count++;
  history = await read({ action: 'document_history', documentId: doc.documentId });
  await success({ action: 'restore_document', documentId: doc.documentId, expectedRevision: null, version: history.versions[0].version });
  await success({ action: 'retry_document_sync', names: ['renamed.md'] });
  var schema = [{ id: 'title_field', name: 'Name', type: 'title', required: true }, { id: 'count_field', name: 'Count', type: 'number' }];
  result = await success({ action: 'create_database', name: 'Inventory', schema: schema }); var db = result.database;
  var dbId = db.id;
  async function current() { return (await read({ action: 'read_database', databaseId: dbId, includeArchived: true })).database; }
  assert.ok((await read({ action: 'list_databases' })).databases.some(function (item) { return item.id === dbId; })); count++;
  result = await success({ action: 'create_database_record', databaseId: dbId, expectedDatabaseRevision: db.revision, values: { title_field: 'First', count_field: 2 } }); var record = result.record;
  assert.equal(record.createdBy.userId, 'owner'); count++;
  var recordRead = await read({ action: 'read_database_record', databaseId: dbId, recordId: record.id }); assert.equal(recordRead.record.values.count_field, 2); count++;
  result = await success({ action: 'update_database_record', databaseId: dbId, recordId: record.id, expectedRevision: record.revision, values: { count_field: 4 } }); record = result.record;
  var query = await read({ action: 'query_database', databaseId: dbId, limit: 1 }); assert.equal(query.totals.sums.count_field, 4); assert.equal(query.totals.count, 1); count++;
  db = await current(); await success({ action: 'rename_database', databaseId: dbId, expectedRevision: db.revision, name: 'Reviewed inventory' });
  db = await current(); schema.push({ id: 'notes_field', name: 'Notes', type: 'text' }); await success({ action: 'update_database_schema', databaseId: dbId, expectedRevision: db.revision, schema: schema });
  db = await current(); await success({ action: 'save_table_view', databaseId: dbId, expectedRevision: db.revision, view: { id: 'fixture_view', name: 'Counts', type: 'table', columns: ['title_field', 'count_field'], filters: [], sorts: [{ fieldId: 'count_field', direction: 'desc' }] } });
  result = await success({ action: 'archive_database_record', databaseId: dbId, recordId: record.id, expectedRevision: record.revision }); record = result.record;
  assert.equal((await read({ action: 'query_database', databaseId: dbId })).totals.count, 0); count++;
  result = await success({ action: 'recover_database_record', databaseId: dbId, recordId: record.id, expectedRevision: record.revision }); record = result.record;
  db = await current(); await success({ action: 'archive_database', databaseId: dbId, expectedRevision: db.revision });
  assert.ok((await read({ action: 'list_databases', archived: true })).databases.some(function (item) { return item.id === dbId; })); count++;
  db = await current(); await success({ action: 'recover_database', databaseId: dbId, expectedRevision: db.revision });
  db = await current(); await success({ action: 'import_database_records', databaseId: dbId, expectedDatabaseRevision: db.revision, sourceNamespace: 'fixture', rows: [{ sourceKey: 'row-1', sourcePayload: { source: 'fixture' }, values: { title_field: 'Imported', count_field: 8 } }] });
  var progress = await read({ action: 'read_database_import_progress', databaseId: dbId, sourceNamespace: 'fixture' }); assert.equal(progress.total, 1); count++;
  await success({ action: 'retry_database_sync', databaseId: dbId });
  await success({ action: 'create_document', name: 'restricted/link.md', content: '[Guide](../renamed.md)' });
  var partialDoc = await read({ action: 'read_document', name: 'renamed.md' });
  p = await propose({ action: 'rename_document', documentId: partialDoc.documentId, expectedRevision: partialDoc.revision, newName: 'partially-renamed.md' });
  var restricted = path.join(f.mates.getMateDir(f.mateCtx, mate.id), 'knowledge/restricted'); fs.chmodSync(restricted, 0o500);
  try { f.answer(p); result = await p.promise; } finally { fs.chmodSync(restricted, 0o700); }
  assert.equal(result.status, 'failed', JSON.stringify(result)); assert.equal(result.persisted, true); assert.ok(result.result.linkUpdateFailures.length); count++;
  partialDoc = await read({ action: 'read_document', name: 'partially-renamed.md' });
  await success({ action: 'rename_document', documentId: partialDoc.documentId, expectedRevision: partialDoc.revision, newName: 'renamed.md' });
  var freshDoc = await read({ action: 'read_document', name: 'renamed.md' });
  p = await propose({ action: 'update_document', name: 'renamed.md', expectedRevision: freshDoc.revision, content: 'Rejected' }); f.answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); count++;
  p = await propose({ action: 'update_document', name: 'renamed.md', expectedRevision: freshDoc.revision, content: 'Stale' });
  project.getKnowledgeProductOperations().mutate({ action: 'update_document', name: 'renamed.md', expectedRevision: freshDoc.revision, content: 'Concurrent human edit' }, { type: 'user', userId: 'owner' });
  assert.equal(f.answer(p), false); cancel(p); await p.promise; count++;
  db = await current(); p = await propose({ action: 'rename_database', databaseId: dbId, expectedRevision: db.revision, name: 'Stale database' });
  await databaseService.rename({ databaseId: dbId, expectedRevision: db.revision, name: 'Concurrent database', operationId: 'human_' + Date.now() + '_rename', actor: { type: 'user', userId: 'owner' } });
  assert.equal(f.answer(p), false); cancel(p); await p.promise; count++;
  for (var change of ['sourceForeign', 'query', 'stop', 'sourceDeleted', 'targetDeleted', 'pending', 'owner']) {
    p = await propose({ action: 'create_document', name: 'guarded-' + change + '.md', content: 'Guarded' });
    var registry = f.mates.loadMates(f.mateCtx), generation = f.sourceSession._sdkQueryGeneration;
    if (change === 'sourceForeign') f.sourceSession._mcpForeignInput = true;
    if (change === 'query') f.sourceSession._sdkQueryGeneration++;
    if (change === 'stop') f.sourceSession.taskStopRequested = true;
    if (change === 'sourceDeleted' || change === 'targetDeleted') f.mates.saveMates(f.mateCtx, Object.assign({}, registry, { mates: registry.mates.filter(function (m) { return m.id !== (change === 'sourceDeleted' ? f.clay.id : mate.id); }) }));
    if (change === 'pending') f.mates.updateMate(f.mateCtx, mate.id, { lifecycleDeletion: { id: 'pending' } });
    if (change === 'owner') f.mates.saveMates(f.mateCtx, Object.assign({}, registry, { mates: registry.mates.map(function (m) { return m.id === mate.id ? Object.assign({}, m, { createdBy: 'foreign' }) : m; }) }));
    assert.equal(f.answer(p), false, change); cancel(p); await p.promise;
    assert.equal((await f.call('control_mate_knowledge', p.args).catch(function (error) { return { status: 'failed', error: error.message }; })).status, 'failed');
    f.sourceSession._mcpForeignInput = false; f.sourceSession._sdkQueryGeneration = generation; f.sourceSession.taskStopRequested = false; f.mates.saveMates(f.mateCtx, registry); count++;
  }
  var foreign = f.mates.createMate(f.mates.buildMateCtx('foreign'), {});
  assert.equal((await read({ action: 'list_databases' }, foreign.id)).status, 'failed'); count++;
  for (var operation of [{ action: 'create_document', name: '../escape.md', content: 'Unsafe' }, { action: 'create_document', name: 'rows.jsonl', content: '{}' }, { action: 'create_database', name: 'Invalid schema', schema: [{ id: 'bad_field', name: 'No title', type: 'number' }] }]) { assert.equal((await apply(operation)).status, 'failed'); count++; }
  db = await current(); assert.equal((await apply({ action: 'create_database_record', databaseId: dbId, expectedDatabaseRevision: db.revision, values: { title_field: 'Bad', count_field: 'not a number' } })).status, 'failed'); count++;
  var knowledgeDir = path.join(f.mates.getMateDir(f.mateCtx, mate.id), 'knowledge');
  p = await propose({ action: 'create_document', name: 'no-save.md', content: 'Cannot save' }); fs.chmodSync(knowledgeDir, 0o500);
  try { f.answer(p); result = await p.promise; } finally { fs.chmodSync(knowledgeDir, 0o700); }
  assert.equal(result.status, 'failed'); assert.equal(fs.existsSync(path.join(knowledgeDir, 'no-save.md')), false); count++;
  db = await current(); p = await propose({ action: 'rename_database', databaseId: dbId, expectedRevision: db.revision, name: 'No database save' });
  var storePath = path.join(knowledgeDir, '.clay-db/databases.db'); fs.chmodSync(storePath, 0o400);
  try { f.answer(p); result = await p.promise; } finally { fs.chmodSync(storePath, 0o600); }
  assert.equal(result.status, 'failed', JSON.stringify(result)); assert.notEqual((await current()).name, 'No database save'); count++;
  var scope = require('../../lib/mate-knowledge-sync').scopeForMateDir(f.mates.getMateDir(f.mateCtx, mate.id));
  var projectionStore = require('../../lib/knowledge-record-store').createRecordStore({ scopeId: scope.scopeId });
  fs.chmodSync(projectionStore.filePath, 0o400);
  try {
    result = await apply({ action: 'create_document', name: 'pending-index.md', content: 'Saved with pending index' });
    assert.equal(result.status, 'completed'); assert.equal(result.persisted, true); assert.equal(result.result.indexSyncPending, true); assert.ok(fs.existsSync(path.join(knowledgeDir, 'pending-index.md'))); count++;
    db = await current(); result = await apply({ action: 'rename_database', databaseId: dbId, expectedRevision: db.revision, name: 'Saved with pending projection' });
    assert.equal(result.status, 'completed'); assert.equal(result.result.projectionPending, true); count++;
  } finally { fs.chmodSync(projectionStore.filePath, 0o600); }
  result = await success({ action: 'retry_document_sync', names: ['pending-index.md'] }); assert.equal(result.indexSyncPending, false);
  result = await success({ action: 'retry_database_sync', databaseId: dbId }); assert.equal(result.projectionPending, false);
  var metaKey = require('node:crypto').createHash('sha256').update(path.resolve(f.mates.getMateDir(f.mateCtx, mate.id))).digest('hex').slice(0, 24);
  var metadataDirectory = path.join(f.mates.getMateDir(f.mateCtx, mate.id), '.clay/knowledge-documents', metaKey);
  p = await propose({ action: 'create_document', name: 'saved-before-metadata-error.md', content: 'Actual saved bytes' }); fs.chmodSync(metadataDirectory, 0o500);
  try { f.answer(p); result = await p.promise; } finally { fs.chmodSync(metadataDirectory, 0o700); }
  assert.equal(result.status, 'failed'); assert.equal(result.persisted, 'unknown'); assert.equal(fs.readFileSync(path.join(knowledgeDir, 'saved-before-metadata-error.md'), 'utf8'), 'Actual saved bytes'); count++;
  assert.deepEqual(await f.call('control_mate_knowledge', p.args), result); count++;
  // Real shared production serialization holds mutations without mocking storage/services.
  var storage = require('../../lib/knowledge-db-storage').createKnowledgeDbStorage({ projectDir: f.mates.getMateDir(f.mateCtx, mate.id) });
  for (var race of ['foreign', 'stop', 'pending', 'deleted', 'owner']) {
    var release, held = storage.serialize(dbId, function () { return new Promise(function (resolve) { release = resolve; }); }); await tick();
    db = await current(); p = await propose({ action: 'rename_database', databaseId: dbId, expectedRevision: db.revision, name: 'Refused after await ' + race });
    f.answer(p); await tick();
    var savedRegistry = f.mates.loadMates(f.mateCtx);
    if (race === 'foreign') f.sourceSession._mcpForeignInput = true;
    if (race === 'stop') f.sourceSession.taskStopRequested = true;
    if (race === 'pending') f.mates.updateMate(f.mateCtx, mate.id, { lifecycleDeletion: { id: 'pending-race' } });
    if (race === 'deleted') f.mates.saveMates(f.mateCtx, Object.assign({}, savedRegistry, { mates: savedRegistry.mates.filter(function (m) { return m.id !== mate.id; }) }));
    if (race === 'owner') f.mates.saveMates(f.mateCtx, Object.assign({}, savedRegistry, { mates: savedRegistry.mates.map(function (m) { return m.id === mate.id ? Object.assign({}, m, { createdBy: 'foreign' }) : m; }) }));
    release(); await held; result = await p.promise;
    f.sourceSession._mcpForeignInput = false; f.sourceSession.taskStopRequested = false; f.mates.saveMates(f.mateCtx, savedRegistry);
    assert.equal(result.status, 'failed', race); assert.equal(result.persisted, false); assert.equal((await current()).revision, db.revision); count++;
  }
  var releaseConflict, heldConflict = storage.serialize(dbId, function () { return new Promise(function (resolve) { releaseConflict = resolve; }); }); await tick();
  db = await current(); p = await propose({ action: 'update_database_record', databaseId: dbId, recordId: record.id, expectedRevision: record.revision, values: { count_field: 9 } });
  var humanConflict = databaseService.rename({ databaseId: dbId, expectedRevision: db.revision, name: 'Fresh human revision', operationId: 'human_' + Date.now() + '_conflict' });
  f.answer(p); await tick(); releaseConflict(); await heldConflict; await humanConflict; result = await p.promise;
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'STALE'); assert.equal(result.persisted, false); count++;
  var bound = f.controls.bind({ projectSlug: 'clay-source', projectOwnerId: 'owner', mateId: f.clay.id, session: f.sourceSession });
  var readAfterAwait = bound.readMateKnowledgeControl({ mateId: mate.id, operation: { action: 'list_databases' } }); f.sourceSession._mcpForeignInput = true;
  await assert.rejects(readAfterAwait, /private|Foreign|owner-authored/i); f.sourceSession._mcpForeignInput = false; count++;
  var projected = f.mateKnowledge.bind({ projectSlug: 'clay-source', projectOwnerId: 'owner', isMate: true, mateId: f.clay.id, session: f.sourceSession });
  assert.ok(projected.listMateKnowledge({ mateId: mate.id }).entries.length); count++;
  f.sourceSession._mcpForeignInput = true; assert.throws(function () { projected.listMateKnowledge({ mateId: mate.id }); }, /private|Foreign|owner-authored/i); f.sourceSession._mcpForeignInput = false; count++;
  f.mates.updateMate(f.mateCtx, mate.id, { lifecycleDeletion: { id: 'withheld' } }); assert.throws(function () { projected.listMateKnowledge({ mateId: mate.id }); }, /Mate not found/);
  var restoreRegistry = f.mates.loadMates(f.mateCtx); restoreRegistry.mates.forEach(function (m) { if (m.id === mate.id) delete m.lifecycleDeletion; }); f.mates.saveMates(f.mateCtx, restoreRegistry); count++;
  assert.equal((await f.call('inspect_mate_knowledge_change', { mateId: mate.id, operation: { action: 'create_document', name: 'large.md', content: 'x'.repeat(1401) } })).status, 'failed'); count++;
  assert.equal((await f.call('inspect_mate_knowledge_change', { mateId: mate.id, operation: { action: 'drop_database', databaseId: dbId } })).status, 'failed'); count++;
  var attached = require('../../lib/project-workspace-query').attachProjectWorkspaceQuery({ service: f.workspace, controlService: f.controls, sm: f.source.sm, projectSlug: 'clay-source', getProjectOwnerId: function () { return 'owner'; }, isMate: true, mateId: f.clay.id });
  var native = attached.createMcpServer(f.yoke.createAdapters().adapters.claude, f.sourceSession).tools;
  ['read_mate_knowledge_control', 'inspect_mate_knowledge_change', 'control_mate_knowledge'].forEach(function (name) {
    [native, attached.getDynamicToolDefs(f.sourceSession), attached.getBridgeTools(f.sourceSession, function (v) { return v; })].forEach(function (tools) { assert.ok(tools.some(function (tool) { return tool.name === name; })); });
    assert.equal(f.source.sdk.checkToolWhitelist('mcp__clay-workspace__' + name, {}).behavior, 'allow');
    assert.ok(require('../../lib/claude-hook-installer').CLAY_MANAGED_ALLOW.includes('mcp__clay-workspace__' + name));
  }); count++;
  for (var denied of [f.target, project]) {
    var s = denied.sm.createSessionRaw({ ownerId: 'owner' }); s._sdkQueryGeneration = 1;
    assert.equal((await denied.getMcpBridgeHandler(s.localId, true, 1).listTools()).some(function (t) { return t.name === 'control_mate_knowledge'; }), false); count++;
  }
  var bridgeCatalog = await f.source.getMcpBridgeHandler(f.sourceSession.localId, true, f.sourceSession._sdkQueryGeneration).listTools();
  assert.match(JSON.stringify(bridgeCatalog.find(function (tool) { return tool.name === 'inspect_mate_knowledge_change'; }).inputSchema), /create_database/); count++;
  var retryOperation = { action: 'create_database', name: 'Durable query retry' };
  p = await propose(retryOperation); f.answer(p); result = await p.promise; assert.equal(result.status, 'completed');
  var durableId = result.result.database.id, durableRequest = p.args.requestId, sizeBeforeRetry = (await read({ action: 'list_databases' })).databases.length;
  f.sourceSession._sdkQueryGeneration++;
  var newBridge = f.source.getMcpBridgeHandler(f.sourceSession.localId, true, f.sourceSession._sdkQueryGeneration);
  async function newCall(name, args) { return JSON.parse((await newBridge.callTool('clay-workspace', name, args)).content[0].text); }
  var retried = await newCall('inspect_mate_knowledge_change', { mateId: mate.id, operation: retryOperation });
  var retryPromise = newCall('control_mate_knowledge', { targetToken: retried.targetToken, requestId: durableRequest, why: 'Retry the exact reviewed create after query rebinding' }); await tick();
  var reviewIds = Object.keys(f.sourceSession.pendingAskUser || {}); f.answer({ id: reviewIds[reviewIds.length - 1] }); result = await retryPromise;
  assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.result.database.id, durableId);
  assert.equal((await newCall('read_mate_knowledge_control', { mateId: mate.id, operation: { action: 'list_databases' } })).databases.length, sizeBeforeRetry); count++;
  var different = await newCall('inspect_mate_knowledge_change', { mateId: mate.id, operation: { action: 'create_database', name: 'Different payload same durable request' } });
  var mismatch = newCall('control_mate_knowledge', { targetToken: different.targetToken, requestId: durableRequest + 'fresh', why: 'Use a fresh local receipt before durable mismatch check' }); await tick();
  // A changed payload with the original durable operation id must fail in a fresh query.
  var mismatchIds = Object.keys(f.sourceSession.pendingAskUser || {}); f.answer({ id: mismatchIds[mismatchIds.length - 1] }, f.ws, 'Keep unchanged'); await mismatch;
  f.sourceSession._sdkQueryGeneration++;
  newBridge = f.source.getMcpBridgeHandler(f.sourceSession.localId, true, f.sourceSession._sdkQueryGeneration);
  different = await newCall('inspect_mate_knowledge_change', { mateId: mate.id, operation: { action: 'create_database', name: 'Different payload same durable request' } });
  mismatch = newCall('control_mate_knowledge', { targetToken: different.targetToken, requestId: durableRequest, why: 'Verify exact durable receipt payload binding' }); await tick();
  mismatchIds = Object.keys(f.sourceSession.pendingAskUser || {}); f.answer({ id: mismatchIds[mismatchIds.length - 1] }); result = await mismatch;
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'IDEMPOTENCY_MISMATCH'); assert.equal(result.persisted, false); count++;
  console.log(count + ' production Mate Knowledge scenarios passed');
}
module.exports = { run: run };
