// Durable operation identities and independent closure proofs survive config-save failures.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
function attachLifecycleOperations(ctx) {
  function operations() { return ctx.config().projectLifecycleOperations || {}; }
  function proofFile(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid lifecycle operation identity.');
    return path.join(ctx.storageDir, 'project-lifecycle-operations', id + '.json');
  }
  function closed(op) {
    try { var proof = JSON.parse(fs.readFileSync(proofFile(op.id), 'utf8')); return proof.id === op.id && proof.targets === JSON.stringify(op.targets); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  function confirmClosed(op) {
    var file = proofFile(op.id); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ id: op.id, targets: JSON.stringify(op.targets) }), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }
  function partial(op, error) {
    return { ok: false, status: 'failed', action: op.action, outcome: op.restoration ? 'restoration_publication_pending' : op.action === 'remove' ? 'removal_reserved_runtime_pending' : 'publication_pending', persisted: true,
      retrySafe: false, recoveryAction: 'reconcile', operationId: op.id, slug: op.slug, error: error || 'The saved operation needs explicit owner-reviewed reconciliation.' };
  }
  function begin(next, project, action, result, correlation, targets) {
    var id = crypto.randomUUID();
    if (action === 'remove') { project.lifecycleState = 'removing'; project.lifecycleOperationId = id; }
    var op = { id: id, action: action, slug: project.slug, projectKnowledgeId: project.projectKnowledgeId, ownerId: correlation ? correlation.ownerId : project.ownerId || null,
      sourceKey: correlation && correlation.sourceKey || null, expected: JSON.stringify(project), directory: ctx.directory(project.path), targets: targets || [], result: result,
      correlation: correlation ? { key: correlation.key, fingerprint: correlation.fingerprint, ownerId: correlation.ownerId, sourceKey: correlation.sourceKey } : null, phase: 'pending' };
    var all = Object.assign({}, next.projectLifecycleOperations || {});
    if (Object.keys(all).length >= 5000) throw new Error('Lifecycle operation capacity reached.');
    all[id] = op; next.projectLifecycleOperations = all;
    ctx.record(next, correlation, partial(op), project, action); return op;
  }
  function exact(op) {
    var project = ctx.find(op.slug);
    if (!project || project.projectKnowledgeId !== op.projectKnowledgeId || JSON.stringify(project) !== op.expected || JSON.stringify(ctx.directory(project.path)) !== JSON.stringify(op.directory)) throw new Error('The exact saved registration changed. Recovery will not overwrite or delete it.');
    return project;
  }
  function inspect(slug, id, principal) {
    var op = id ? operations()[id] : Object.values(operations()).reverse().find(function (item) { return item.slug === slug && item.phase === 'pending'; });
    var current = ctx.find(slug);
    if (!op || op.slug !== slug || (op.ownerId !== (principal.userId || null) && (!current || current.ownerId !== principal.userId))) throw new Error('No owned lifecycle operation is available.');
    var conflict = op.phase !== 'completed' && JSON.stringify(current) !== op.expected;
    return { registrationTitle: current && current.ownerId === principal.userId ? current.title || current.slug : undefined, conflict: conflict, operationId: op.id, action: op.action, phase: op.phase, runtimeClosureConfirmed: op.action === 'remove' && closed(op), revision: JSON.stringify([op, current]) };
  }
  function complete(next, op, project) {
    var all = Object.assign({}, next.projectLifecycleOperations);
    all[op.id] = Object.assign({}, op, { phase: 'completed' }); next.projectLifecycleOperations = all;
    ctx.record(next, op.correlation, Object.assign({}, op.result, { operationId: op.id }), project, op.action);
  }
  async function reconcile(slug, id, principal, authorize, validate, restore) {
    var info = inspect(slug, id, principal), op = operations()[info.operationId];
    if (op.phase === 'completed') return Object.assign({}, op.result, { operationId: op.id });
    if (validate) validate();
    try {
      if (op.action === 'remove' && !op.restoration) {
        await ctx.relay().closeProjectLifecycle(op.targets, closed(op));
        if (ctx.relay().getProjectLifecycleTargets(slug).length) throw new Error('A live project or worktree runtime appeared during closure.');
        confirmClosed(op);
        authorize();
        var registration = ctx.find(slug);
        if (restore) {
          if (!registration || registration.ownerId !== principal.userId || registration.projectKnowledgeId !== op.projectKnowledgeId || registration.lifecycleOperationId !== op.id) throw new Error('The saved registration no longer belongs to this recovery operation or owner.');
        } else exact(op);
        var next = ctx.snapshot();
        var project = next.projects.find(function (item) { return item.slug === op.slug; });
        if (restore) {
          delete project.lifecycleState; delete project.lifecycleOperationId; project.lifecycleExecutionPaused = true;
          if (JSON.stringify(ctx.directory(project.path)) !== JSON.stringify(op.directory)) throw new Error('The project directory identity changed; restoration was refused.');
          var restored = Object.assign({}, op, { restoration: true, expected: JSON.stringify(project), result: { ok: true, status: 'superseded', originalAction: 'remove', slug: op.slug, registrationRestored: true, executionPaused: true, semantics: 'Registration restored. Queued and scheduled execution stays paused until the owner explicitly sends a new message.' } });
          next.projectLifecycleOperations = Object.assign({}, next.projectLifecycleOperations); next.projectLifecycleOperations[op.id] = restored; ctx.save(next); op = restored;
          ctx.publishRuntime(project, 'recovered'); authorize(); exact(op);
          next = ctx.snapshot(); complete(next, op, project); ctx.save(next); ctx.publish();
          return Object.assign({}, restored.result, { status: 'completed', action: 'recover_registration', originalOutcome: 'superseded', operationId: op.id });
        }
        next.projects = next.projects.filter(function (item) { return item.slug !== op.slug; });
        next.removedProjects = (next.removedProjects || []).filter(function (item) { return item.path !== project.path; }).concat([{ path: project.path, title: project.title || null, icon: project.icon || null, userId: op.ownerId, projectKnowledgeId: project.projectKnowledgeId, removedAt: Date.now() }]).slice(-20);
        complete(next, op, project); ctx.save(next);
      } else {
        if (restore && !op.restoration) throw new Error('Only a pending removal can restore its registration.');
        authorize(); var current = ctx.find(op.slug), currentRevision = JSON.stringify(current);
        if (currentRevision !== op.expected) {
          if (!current || current.projectKnowledgeId !== op.projectKnowledgeId || current.ownerId !== principal.userId || JSON.stringify(ctx.directory(current.path)) !== JSON.stringify(op.directory)) throw new Error('The saved publication target was replaced or transferred.');
          ctx.publishRuntime(current, 'recovered'); authorize();
          if (JSON.stringify(ctx.find(op.slug)) !== currentRevision) throw new Error('Registration changed during publication reconciliation.');
          op = Object.assign({}, op, { result: { ok: true, status: 'superseded', slug: op.slug, persisted: true, currentRegistrationRetained: true } });
        } else {
          exact(op); ctx.publishRuntime(current, op.restoration ? 'recovered' : op.action); authorize(); exact(op);
        }
        var updated = ctx.snapshot(); complete(updated, op, current); ctx.save(updated);
      }
      ctx.publish(); return Object.assign({}, op.result, { operationId: op.id });
    } catch (error) { error.lifecycleResult = Object.assign({}, error.lifecycleResult || {}, partial(op, error.message)); throw error; }
  }
  return { begin: begin, partial: partial, exact: exact, closed: closed, confirmClosed: confirmClosed, inspect: inspect, complete: complete, reconcile: reconcile };
}
module.exports = { attachLifecycleOperations: attachLifecycleOperations };
