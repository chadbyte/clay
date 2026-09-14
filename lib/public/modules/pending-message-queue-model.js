export function activeQueueItems(items) {
  return (items || []).filter(function (item) { return item.state === "pending" || item.state === "claimed"; });
}

export function moveQueueId(ids, id, direction, targetId) {
  var next = (ids || []).slice();
  var from = next.indexOf(id);
  if (from < 0) return next;
  var to = targetId ? next.indexOf(targetId) : from + direction;
  if (to < 0 || to >= next.length || to === from) return next;
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export function matchesQueueContext(value, projectSlug, sessionId) {
  return !!value && value.projectSlug === projectSlug && String(value.sessionId) === String(sessionId);
}

export function canApplyQueueRevision(currentRevision, incomingRevision) {
  return Number(incomingRevision) >= Number(currentRevision);
}
