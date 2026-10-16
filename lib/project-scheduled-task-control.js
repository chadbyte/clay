var crypto = require('crypto');
var authority = require('./canonical-clay-scheduling-authority');
var validation = require('./schedule-validation');
function attachScheduledTaskControl(ctx) {
  var drafts = new Map();
  function current(session, token) {
    var actor = authority.validate(token, ctx.slug, session);
    if (!ctx.available(session)) throw new Error('Scheduled Tasks requires an eligible owned project Driver session.');
    if (ctx.validateOwnerIdentity) ctx.validateOwnerIdentity(session);
    return actor;
  }
  function read(session, op, token) {
    var actor = current(session, token);
    if (op.action === 'list') return { records: ctx.records.list(session).filter(function (item) { return !ctx.multiUser() || item.ownerId === actor.userId; }), timezone: ctx.timezone };
    var result = ctx.records.read(session, op.id);
    if (!result.ok) throw new Error(result.error);
    if (ctx.multiUser() && result.record.ownerId !== actor.userId) throw new Error('This task belongs to another owner or requires workbench ownership setup.');
    return result;
  }
  function snapshot(session, op, token) {
    current(session, token);
    return op.action === 'propose' ? { draft: session.scheduledTaskDraft || null, interviewId: ctx.interviewId(session) } : read(session, { id: op.id }, token).record;
  }
  function prepare(session, op, token, requestId) {
    current(session, token);
    if (ctx.interviewId(session) || session.scheduledTaskDraft) throw new Error('Finish or cancel this Driver schedule draft before proposing another.');
    var checked = validation.validateScheduledTaskInput(op.data);
    if (!checked.ok || !checked.value.execution) throw new Error(checked.error || 'Choose Driver and Split Worker runtimes.');
    ctx.preflight(checked.value.execution.driver, null, true); ctx.preflight(checked.value.execution.worker, null, true);
    current(session, token);
    var begun = ctx.beginManual(session, requestId);
    if (!begun.ok) throw new Error(begun.error);
    var prior = session.scheduledTaskDraft;
    var draft = Object.assign({}, prior, checked.value, { canonicalScheduling: true, version: Number(prior.version || 0) + 1 });
    session.scheduledTaskDraft = draft;
    if (ctx.sm.saveSessionFile(session) !== true) { session.scheduledTaskDraft = prior; throw new Error('The canonical schedule proposal could not be saved.'); }
    if (drafts.size >= 100) drafts.delete(drafts.keys().next().value);
    drafts.set(draft.id, { session: session, token: token });
    ctx.publish(session, { open: true });
    return { status: 'proposed', persisted: true, proposalId: draft.id, version: draft.version, interviewId: draft.interviewId, sessionId: session.localId, guidance: 'The task has not been created. Open this selected Driver Scheduled Tasks workbench and use its final Create task control. No execution has started.' };
  }
  function actorForDraft(session, draft) {
    if (!draft.canonicalScheduling) return null;
    var grant = drafts.get(draft.id);
    if (!grant || grant.session !== session) throw new Error('This canonical schedule proposal needs a fresh live Clay query after reload.');
    return current(session, grant.token);
  }
  function apply(session, op, token, requestId) {
    var actor = current(session, token);
    if (op.action === 'propose') return prepare(session, op, token, requestId);
    var selected = read(session, op, token).record;
    if (selected.revision !== op.revision) throw new Error('Scheduled task revision changed.');
    if (!selected.ownerId && ctx.multiUser()) throw new Error('Claim legacy task ownership through the existing workbench first.');
    var record = ctx.registry.getById(op.id), result;
    current(session, token);
    if (op.action === 'update') {
      result = ctx.records.update(session, op.id, op.revision, op.data, actor);
      if (!result.ok) throw new Error(result.error);
      ctx.publishRecord(session, result.record);
      return { status: 'completed', persisted: true, record: result.record };
    }
    if (op.action === 'run') {
      result = ctx.execution.trigger(record, 'canonical-clay');
      if (!result.ok) return { status: 'failed', persisted: 'unknown', error: result.error, result: result };
      return { status: 'queued', persisted: true, result: result, guidance: 'The existing scheduled-task executor dispatched its Driver. Task completion requires its normal Worker and outcome reporting.' };
    }
    if (op.action === 'cancel') {
      var running = !!record.activeRun;
      if (running && !ctx.execution.stopRecord(record, 'The owner cancelled this scheduled task through Clay.')) throw new Error('The active scheduled run could not be stopped; task retained.');
      current(session, token);
      if (!ctx.registry.remove(record.id)) throw new Error('The scheduled task could not be cancelled.');
      return { status: 'completed', persisted: true, removed: true, runStopRequested: running };
    }
    var enabled = op.action === 'resume';
    result = ctx.registry.update(record.id, { enabled: enabled, updatedBy: actor });
    if (!result) throw new Error('The scheduled task state could not be saved.');
    ctx.publishRecord(session, ctx.records.read(session, op.id).record);
    return { status: 'completed', persisted: true, enabled: enabled };
  }
  return { authorize: current, read: read, snapshot: snapshot, apply: apply, actorForDraft: actorForDraft,
    creationId: function (draft) { return 'loop_clay_' + crypto.createHash('sha256').update(draft.id).digest('hex').slice(0, 32); } };
}
module.exports = { attachScheduledTaskControl: attachScheduledTaskControl };
