// Reviewed assignment updates share the existing follow-up dispatch service.
function createFollowUpQueue(ctx) {
  var snapshots = new WeakMap(), scheduled = new WeakSet(), sourceWatches = new WeakMap();
  function source(record) {
    var current = ctx.exactSource(record);
    if (!current || current.session.taskStopRequested || current.session._pendingMessageDrainPaused || current.session._lastTurnInterrupted || current.session.abortController && current.session.abortController.signal.aborted || current.session._mentionInProgress || current.session.spawn) throw new Error('Source conversation stopped or changed. Request a new review.');
    return current;
  }
  function inspect(record, project) {
    var parent = ctx.records.find(function (item) {
      return item.sourceKey === record.sourceKey && item.delivery !== 'follow_up' && item.targetProjectSlug === record.targetProjectSlug &&
        item.targetSessionRef === record.targetSessionRef && (!record.parentAssignmentId || item.assignmentId === record.parentAssignmentId);
    });
    return project.inspectDelegatedFollowUp({ userId: record.userId, sourceMateId: record.sourceMateId,
      sourceProjectSlug: record.sourceProjectSlug, sourceSessionRef: record.sourceSessionRef }, record.targetSessionRef,
      { allowBusy: true, parentAssignmentId: parent && parent.assignmentId || null });
  }
  function remember(record, project, inspected) {
    var current = source(record);
    snapshots.set(record, { project: project, session: inspected.session, origin: inspected.session.sessionOriginId,
      linuxUser: inspected.linuxUser || null, source: current.session, sourceProject: current.project });
    record.targetSessionOriginId = inspected.session.sessionOriginId || null;
    record.targetLinuxUser = inspected.linuxUser || null;
    record.targetDirectory = project.getStatus().path || null;
    record.sourceDirectory = current.project.getStatus().path || null;
    record.sourceVisibility = current.session.sessionVisibility || null;
    record.sourceBuiltinKey = current.mate && current.mate.builtinKey || null;
    record.sourceSessionOriginId = current.session.sessionOriginId || null;
    record.sourceQueryGeneration = current.session._sdkQueryGeneration || null;
    var parent = ctx.records.find(function (item) { return item.sourceKey === record.sourceKey && item.delivery !== 'follow_up' &&
      item.targetProjectSlug === record.targetProjectSlug && item.targetSessionRef === record.targetSessionRef; });
    record.parentAssignmentId = parent && parent.assignmentId || null;
  }
  function validate(record, project, inspected) {
    var current = source(record), saved = snapshots.get(record);
    if (saved && (saved.project !== project || saved.session !== inspected.session || saved.origin !== inspected.session.sessionOriginId ||
        saved.linuxUser !== (inspected.linuxUser || null) || saved.source !== current.session || saved.sourceProject !== current.project) ||
        record.targetSessionOriginId && record.targetSessionOriginId !== inspected.session.sessionOriginId ||
        record.sourceSessionOriginId && record.sourceSessionOriginId !== current.session.sessionOriginId ||
        record.parentAssignmentId && (!inspected.session.assignment || inspected.session.assignment.assignmentId !== record.parentAssignmentId) ||
        record.sourceVisibility !== (current.session.sessionVisibility || null) ||
        record.targetDirectory !== (project.getStatus().path || null) || record.sourceDirectory !== (current.project.getStatus().path || null) ||
        record.sourceBuiltinKey !== (current.mate && current.mate.builtinKey || null) ||
        (record.targetLinuxUser || null) !== (inspected.linuxUser || null) ||
        (record.sourceQueryGeneration || null) !== (current.session._sdkQueryGeneration || null)) throw new Error('Follow-up identity or OS mapping changed. Request a new review.');
    return inspected;
  }
  function busy(session) { return !!(session.isProcessing || session._queryStarting || session._awaitingTurnResult); }
  function cleanup(record) {
    var unsubscribe = sourceWatches.get(record);
    if (unsubscribe) unsubscribe();
    sourceWatches.delete(record);
  }
  function track(record) {
    if (sourceWatches.has(record)) return;
    var current = source(record);
    if (typeof current.manager.subscribeSession !== 'function') return;
    var unsubscribe = current.manager.subscribeSession(current.session.localId, function () {
      if (record.status !== 'queued') return;
      try { validate(record, ctx.exactTarget(record), inspect(record, ctx.exactTarget(record))); } catch (error) { stop(record, 'interrupted', error); }
    });
    if (unsubscribe) sourceWatches.set(record, unsubscribe);
  }
  function first(record) {
    return ctx.records.filter(function (item) { return item.status === 'queued' && item.userId === record.userId &&
      item.targetProjectSlug === record.targetProjectSlug && item.targetSessionRef === record.targetSessionRef; })
      .sort(function (a, b) { return a.queueOrder - b.queueOrder; })[0];
  }
  function wake(record) { var next = first(record); if (next) schedule(next); }
  function stop(record, status, error) {
    try { ctx.settle(record, status, null, error.message); }
    catch (failure) { console.error('Follow-up status could not be persisted:', failure.message); }
  }
  function schedule(record) {
    if (record.status !== 'queued' || scheduled.has(record)) return;
    scheduled.add(record);
    setImmediate(function () {
      scheduled.delete(record);
      if (record.status !== 'queued') return;
      try {
        var project = ctx.exactTarget(record);
        if (!project) throw new Error('Target project access changed.');
        var inspected = validate(record, project, inspect(record, project));
        if (inspected.session._lastTurnInterrupted) throw new Error('Driver was stopped; explicit owner resumption is required.');
        if (first(record) !== record || busy(inspected.session)) return;
        Promise.resolve(ctx.approve(record)).catch(function (error) { stop(record, 'failed', error); });
      } catch (error) { stop(record, 'interrupted', error); }
    });
  }
  return { inspect: inspect, remember: remember, validate: validate, busy: busy, track: track, schedule: schedule, first: first, wake: wake, cleanup: cleanup };
}
module.exports = { createFollowUpQueue: createFollowUpQueue };
