var crypto = require('crypto');
var runtimes = new WeakMap();
function runtime(manager) {
  if (!runtimes.has(manager)) runtimes.set(manager, 'runtime:' + crypto.randomUUID());
  return runtimes.get(manager);
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function mateStamp(mate) { return JSON.stringify([mate.id, mate.createdBy || null, mate.createdAt || null, mate.builtinKey || null]); }
function describe(domain, entry, project, slug, session) {
  var op = entry.op || entry.intent || {}, base = project && { projectSlug: slug, runtimeId: runtime(project.getSessionManager()) };
  if (domain === 'screen' && op.action === 'dismiss_notifications') return { kind: 'notifications', items: entry.snapshot.notifications.map(function (item) { return { id: item.id, revision: item.controlRevision }; }) };
  if (domain === 'knowledge') {
    var snapshot = entry.snapshot || {};
    return Object.assign({ kind: 'knowledge', object: op.recordId ? 'record' : op.databaseId ? 'database' : 'document', objectId: op.recordId || op.databaseId || snapshot.documentId || null, revision: String(op.recordId ? op.expectedRevision : snapshot.revision || ''), databaseId: op.databaseId || null, databaseRevision: op.databaseId ? String(snapshot.revision) : null, name: snapshot.name || op.name || null }, base);
  }
  if (domain === 'mate' && entry.mate) return { kind: 'mate', mateId: entry.mate.id, mateStamp: mateStamp(entry.mate) };
  if (domain === 'records' && op.ref) return Object.assign({ kind: 'record', area: op.area, ref: op.ref, revision: String(op.expectedRevision) }, base);
  if (domain === 'workspace' && op.domain === 'git' && op.paths.length === 1) { var file = entry.snapshot.status.files.find(function (item) { return item.path === op.paths[0]; }); return Object.assign({ kind: 'git', path: file.path, repository: digest(entry.snapshot.gitDirectory), revision: digest([entry.snapshot.status.oid, entry.snapshot.index, file]) }, base); }
  if (domain === 'workspace' && op.domain === 'git') return Object.assign({ kind: 'git-set', repository: digest(entry.snapshot.gitDirectory), files: op.paths.map(function (name) { var file = entry.snapshot.status.files.find(function (item) { return item.path === name; }); return { path: name, revision: digest([entry.snapshot.status.oid, entry.snapshot.index, file]) }; }) }, base);
  if (domain === 'workspace' && op.domain === 'terminal' && op.id) return Object.assign({ kind: 'terminal', id: op.id, identity: entry.snapshot.identity, revision: digest(entry.snapshot) }, base);
  if (domain === 'workspace' && op.domain === 'files') return Object.assign({ kind: 'file', path: op.path, revision: digest(entry.snapshot) }, base);
  if (domain === 'schedule' && op.id) return Object.assign({ kind: 'schedule', id: op.id, revision: String(op.revision), sessionId: session.localId, sessionOriginId: session.sessionOriginId }, base);
  if (session && slug && session.sessionOriginId) return { kind: 'session', projectSlug: slug, sessionId: session.localId, sessionOriginId: session.sessionOriginId };
  return base ? Object.assign({ kind: 'project' }, base) : null;
}
module.exports = { runtime: runtime, digest: digest, describe: describe };
