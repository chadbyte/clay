function attachScheduledMessageQueue(ctx) {
  var users = ctx.users;
  var pendingMessageQueue = ctx.pendingMessageQueue;
  function queueActor(actorId) {
    return users.isMultiUser() ? users.findUserById(actorId) : { id: "default" };
  }
  function queueItemForJob(session, job, actorId) {
    if (!pendingMessageQueue || !session || !job) return null;
    var actor = queueActor(actorId || (job.payload && job.payload.actorId));
    var items = pendingMessageQueue.list(session, actor);
    for (var i = 0; i < items.length; i++) {
      if (items[i].schedule && items[i].schedule.jobId === job.id && items[i].schedule.revision === job.payload.revision) return items[i];
    }
    return null;
  }
  function validateQueueControl(session, job, actorId, correlation, requireQueueRevision) {
    if (!pendingMessageQueue) return null;
    if (requireQueueRevision && (!correlation || correlation.queueRevision == null || Number(correlation.queueRevision) !== pendingMessageQueue.getRevision())) {
      throw new Error("The scheduled-message queue is stale.");
    }
    var actor = queueActor(actorId || (job.payload && job.payload.actorId));
    var item = queueItemForJob(session, job, actorId);
    if (!item || item.actorId !== actor.id || ["cancelled", "consumed", "failed"].indexOf(item.state) >= 0) {
      throw new Error("The scheduled queue item is no longer available.");
    }
    return item;
  }
  return { actor: queueActor, item: queueItemForJob, validate: validateQueueControl };
}
module.exports = { attachScheduledMessageQueue: attachScheduledMessageQueue };
