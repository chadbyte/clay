var crypto = require('crypto');
var path = require('path');
var input = require('./clay-mate-knowledge-input');
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function text(value, max) { return typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function attachClayMateKnowledge(ctx) {
  var state = ctx.state;
  function resolve(mateId) {
    var principal = ctx.authorize(), owner = principal.userId || principal.singleUserOwnerId || 'default';
    var mate = ctx.resolveMate(owner, mateId), project = ctx.getProjects().get('mate-' + mateId);
    if (!mate || mate.lifecycleDeletion || principal.userId && mate.createdBy !== owner || !project) throw new Error('Mate Knowledge is unavailable for this owner.');
    var status = project.getStatus(), directory = ctx.getMateDir && ctx.getMateDir(owner, mateId);
    if (!status.isMate || status.mateId !== mateId || status.projectOwnerId !== owner || !directory || path.resolve(status.path) !== path.resolve(directory)) throw new Error('Mate Knowledge runtime ownership or directory changed.');
    project.getSessionManager().sessions.forEach(function (s) { if (s.sessionVisibility === 'shared' || s.ownerId && s.ownerId !== owner) throw new Error('Mate Knowledge runtime is not owner-private.'); });
    var documents = project.getKnowledgeProductOperations && project.getKnowledgeProductOperations(), db = project.getKnowledgeDbService && project.getKnowledgeDbService();
    if (!documents || !db) throw new Error('Mate Knowledge services are unavailable.');
    return { mate: mate, project: project, documents: documents, db: db, owner: owner, actor: { type: principal.userId ? 'user' : 'system', userId: principal.userId, displayName: null } };
  }
  function targetCheck(target) {
    var live = resolve(target.mateId);
    if (live.project !== target.project || live.db !== target.db || fingerprint(live.mate) !== target.registry) throw new Error('Mate Knowledge target changed. Inspect again.');
    return live;
  }
  function cachedDatabase(live, id) {
    var db = live.db.listCached({}).databases.concat(live.db.listCached({ archived: true }).databases).find(function (item) { return item.id === id; });
    if (!db) throw new Error('Knowledge database is unavailable.');
    return { id: db.id, revision: db.revision, archivedAt: db.archivedAt };
  }
  async function read(args) {
    if (!args || Object.keys(args).some(function (key) { return key !== 'mateId' && key !== 'operation'; }) || !text(args.mateId, 100)) throw new Error('Choose an exact owner-private Mate and typed Knowledge query.');
    var op = JSON.parse(JSON.stringify(input.readSchema.parse(args.operation))), live = resolve(args.mateId);
    var target = { mateId: args.mateId, project: live.project, db: live.db, registry: fingerprint(live.mate) };
    var result = input.READS[op.action] ? await live.db[input.READS[op.action]](op) : live.documents.query(op);
    targetCheck(target);
    return result;
  }
  async function inspect(args) {
    if (!args || Object.keys(args).some(function (key) { return key !== 'mateId' && key !== 'operation'; }) || !text(args.mateId, 100)) throw new Error('Choose an exact owner-private Mate and typed Knowledge change.');
    var op = JSON.parse(JSON.stringify(input.writeSchema.parse(args.operation))), live = resolve(args.mateId);
    var target = { mateId: args.mateId, project: live.project, db: live.db, registry: fingerprint(live.mate), op: op, created: Date.now() };
    if (input.WRITES[op.action]) {
      if (op.databaseId) { await live.db.read({ databaseId: op.databaseId, includeArchived: true }); target.snapshot = cachedDatabase(live, op.databaseId); }
    } else target.snapshot = live.documents.snapshot(op);
    targetCheck(target);
    var exact = JSON.stringify(op);
    if (exact.length > 1400) throw new Error('The exact Knowledge change is too large for the existing owner review; use smaller existing product operations.');
    if (state.targets.size >= 100) state.targets.delete(state.targets.keys().next().value);
    var token = 'knowledge-control:' + crypto.randomUUID(); target.presentationValid = function () { check(target); }; state.targets.set(token, target);
    return { targetToken: token, mateId: args.mateId, operation: op, revision: target.snapshot, expiresInSeconds: 300 };
  }
  function check(target) {
    var live = targetCheck(target);
    if (Date.now() - target.created > 300000) throw new Error('Knowledge inspection expired.');
    var snapshot = input.WRITES[target.op.action] ? target.op.databaseId && cachedDatabase(live, target.op.databaseId) : live.documents.snapshot(target.op);
    if (fingerprint(snapshot || null) !== fingerprint(target.snapshot || null)) throw new Error('Knowledge revision changed. Inspect and review again.');
    return live;
  }
  function act(args) {
    ctx.authorize();
    if (!args || Object.keys(args).some(function (key) { return ['targetToken', 'requestId', 'why'].indexOf(key) < 0; }) || !text(args.targetToken, 100) || !text(args.requestId, 128) || !text(args.why, 300)) throw new Error('Use an exact Knowledge token, requestId and reason.');
    args = Object.assign({}, args);
    var target = state.targets.get(args.targetToken), key = fingerprint(args), previous = state.requests.get(args.requestId);
    if (!target) throw new Error('Inspect this exact Knowledge operation first.');
    if (previous) { if (previous.key !== key) throw new Error('requestId already names another Knowledge operation.'); return previous.promise.then(function (result) { targetCheck(target); return result; }); }
    if (state.requests.size >= 100) throw new Error('Too many Knowledge requests in this query.');
    var stamp = /^[A-Za-z][A-Za-z0-9-]*_(\d{13})_[A-Za-z0-9_-]{1,80}$/.exec(args.requestId);
    if (input.WRITES[target.op.action] && !stamp) throw new Error('Database requestId must use prefix_<13-digit creation time>_<unique suffix> for the existing durable retry window.');
    var operationId = 'clay_' + (stamp ? stamp[1] : target.created) + '_' + fingerprint([ctx.sourceKey, args.requestId]).slice(0, 40);
    var persisted = false;
    var promise = Promise.resolve().then(async function () {
      check(target);
      var question = 'Apply this exact Mate Knowledge change:\n' + JSON.stringify(target.op) + (target.op.action === 'rename_document' ? '\nExisting local backlinks follow the Knowledge workbench rename behavior.' : '') + '\nMate: ' + target.mateId + '\nWhy: ' + args.why;
      if (question.length > 2000) throw new Error('The exact change must fit the existing owner review.');
      var response = await ctx.review(question, function () { check(target); });
      if (response.status !== 'submitted' || !response.answers.control || response.answers.control.length !== 1 || response.answers.control[0] !== 'Apply exact change') return { status: 'cancelled' };
      var live = check(target), op = Object.assign({}, target.op), result;
      if (input.WRITES[op.action]) {
        var parameters = Object.assign({}, op, { operationId: operationId, actor: live.actor, revalidate: function (current, phase) {
          if (phase === 'saved') persisted = true;
          targetCheck(target);
          if (current && target.snapshot && current.revision !== target.snapshot.revision) throw Object.assign(new Error('Knowledge database revision changed after review.'), { code: 'STALE' });
          if (phase === 'saving') persisted = 'unknown';
        } }); delete parameters.action;
        result = await live.db[input.WRITES[op.action]](parameters);
      } else { persisted = 'unknown'; result = live.documents.mutate(op, live.actor); }
      persisted = true; targetCheck(target);
      if (result.linkUpdateFailures && result.linkUpdateFailures.length) return { status: 'failed', persisted: true, operationId: operationId, retrySafe: false, error: 'The document was renamed, but some backlink updates failed.', result: result };
      return { status: 'completed', persisted: true, operationId: operationId, result: result };
    }).catch(function (error) { return { status: 'failed', persisted: error.persisted === undefined ? persisted : error.persisted, operationId: operationId, retrySafe: false, code: error.code || 'FAILED', error: error.message }; });
    state.requests.set(args.requestId, { key: key, promise: promise });
    return promise;
  }
  return { readMateKnowledgeControl: read, inspectMateKnowledgeChange: inspect, actMateKnowledge: act };
}
module.exports = { attachClayMateKnowledge: attachClayMateKnowledge };
